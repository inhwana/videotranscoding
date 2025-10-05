const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { v4: uuidv4 } = require("uuid");
//AWS S3
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");

const bucketName = "n10851879-test"; // Test Bucket Name
const s3Client = new S3Client({ region: "ap-southeast-2" });

const { AssemblyAI } = require("assemblyai");
const { model } = require("./gemini.js");

//AWS Secrets
const SecretsManager = require("@aws-sdk/client-secrets-manager");
const {
  cognitoSignUp,
  cognitoLogin,
  confirmWithCode,
  verifyToken,
} = require("./auth.js");
const { getSecrets } = require("./secrets.js");

const cors = require("cors");

const {
  initDb,
  initialiseVideoTable,
  addVideo,
  updateVideoStatus,
  getUsersVideos,
  getVideo,
  addTranscript,
} = require("./db.js");

const { getParameters } = require("./parameters.js");

async function bootstrap() {
  //Default
  const app = express();

  app.use(express.json()); // To get forms from EJS
  dotenv.config(); // Configuratio

  await getParameters();

  // const clientId = "dktj13anu4sv0m465jemi791c";
  // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

  const { clientId, clientSecret, rdsUsername, rdsPassword } =
    await getSecrets();
  console.log(rdsUsername, rdsPassword, clientId, clientSecret);
  await initialiseVideoTable();
  //S3 Upfload
  app.post("/upload", verifyToken, async (req, res) => {
    const { filename } = req.body;

    const videoId = uuidv4();
    const storedFileName = `${videoId}-${Date.now()}.${filename
      .split(".")
      .pop()}`;
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: storedFileName,
        //ContentType: contentType
      });
      const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      console.log(presignedURL);
      // Store metadata in RDS
      await addVideo({
        id: videoId,
        userId: req.user.sub,
        originalFileName: filename,
        storedFileName,
        uploadTimestamp: Date.now(),
        status: "uploading",
      });
      //console.log("Received:", filename, contentType);
      res.json({ url: presignedURL, videoId });
    } catch (err) {
      console.log(err);
    }
  });

  // Get user's video history
  app.get("/videos", verifyToken, async (req, res) => {
    try {
      const videos = await getUsersVideos(req.user.sub);
      res.json(videos);
    } catch (err) {
      console.error("Error fetching videos:", err);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.post("/transcode", verifyToken, async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      const videoMetadata = await getVideo(videoId);

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      const storedFileName = videoMetadata.storedfilename;
      const transcodedKey = `transcoded-${storedFileName.replace(
        /\.[^/.]+$/,
        ".mp4"
      )}`;

      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: storedFileName,
        })
      );

      const inputStream = response.Body;
      if (!inputStream) throw new Error("No video data received from S3");

      const outputStream = new PassThrough();

      const uploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: transcodedKey,
          Body: outputStream,
          ContentType: "video/mp4",
        },
      });

      await updateVideoStatus(videoId, "transcoding", null);

      // Fix: Handle the promise chain properly
      const ffmpegPromise = new Promise((resolve, reject) => {
        ffmpeg(inputStream)
          .videoCodec("libx264")
          .audioCodec("aac") // Add audio codec
          .outputOptions([
            "-movflags frag_keyframe+empty_moov",
            "-preset fast", // Faster encoding
            "-crf 23",
          ])
          .format("mp4")
          .on("start", (cmd) => console.log("FFmpeg started:", cmd))
          .on("progress", (progress) => {
            console.log(`Processing: ${progress.percent}% done`);
          })
          .on("error", (err) => {
            console.error("FFmpeg error:", err.message);
            reject(err);
          })
          .on("end", () => {
            console.log("Transcoding complete");
            outputStream.end(); // Important: Close the output stream
            resolve();
          })
          .pipe(outputStream, { end: false }); // Don't auto-end the stream
      });

      // Wait for both to complete
      await Promise.all([ffmpegPromise, uploads3.done()]);

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: transcodedKey,
        ResponseContentDisposition:
          'attachment; filename="transcodedvideo.mp4"',
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });

      await updateVideoStatus(videoId, "completed", transcodedKey);

      res.json({ url: downloadUrl });
    } catch (err) {
      console.error("Transcode error:", err);
      await updateVideoStatus(videoId, "failed", null);
      res.status(500).json({ error: `Transcoding failed: ${err.message}` });
    }
  });

  // this is the login thing that you should do/check/add your aws thing to!!
  app.post("/", async (req, res) => {
    const { username, password } = req.body;

    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      const result = await cognitoLogin(
        clientId,
        clientSecret,
        username,
        password
      );
      res.json({
        idToken: result.AuthenticationResult.IdToken,
        accessToken: result.AuthenticationResult.AccessToken,
        refreshToken: result.AuthenticationResult.RefreshToken,
      });
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: "Login failed" });
    }
  });

  app.post("/confirm", async (req, res) => {
    const { username, code } = req.body;
    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      await confirmWithCode(clientId, clientSecret, username, code);
      res.json({ success: true, message: "Confirmation successful" });
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: "Confirmation failed" });
    }
  });

  app.post("/register", async (req, res) => {
    const { username, password, email } = req.body;

    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      await cognitoSignUp(clientId, clientSecret, username, password, email);
      res.json({
        success: true,
        message: "Registration successful, confirm your email",
      });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: "Registration failed" });
    }
  });

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });

  const checkIfAudioInS3 = async (videoId, userSub) => {
    const videoMetadata = await getVideo(videoId);

    if (!videoMetadata || videoMetadata.userid !== userSub) {
      throw new Error("Video not found or unauthorised");
    }

    const storedFileName = videoMetadata.storedfilename;

    const audioKey = `${storedFileName.replace(/\.[^/.]+$/, ".mp3")}`;

    try {
      await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: audioKey,
        })
      );

      return audioKey;
    } catch (err) {
      const code = err && (err.Code || err.name || err.code);
      if (
        code !== "NotFound" &&
        code !== "NoSuchKey" &&
        !(err.$metadata && err.$metadata.httpStatusCode === 404)
      ) {
        throw err;
      }
    }

    const videoResponse = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: storedFileName,
      })
    );
    const inputStream = videoResponse.Body;
    if (!inputStream) throw new Error("No video data received from S3");

    const outputStream = new PassThrough();
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: audioKey,
        Body: outputStream,
        ContentType: "audio/mpeg",
      },
    });

    const ffmpegPromise = new Promise((resolve, reject) => {
      ffmpeg(inputStream)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate("192k")
        .format("mp3")
        .on("start", (cmd) => console.log("ffmpeg started:", cmd))
        .on("error", (err) => {
          console.error("ffmpeg error extracting audio:", err);
          reject(err);
        })
        .on("end", () => {
          console.log("ffmpeg finished extracting audio:", audioKey);
          resolve();
        })
        .pipe(outputStream, { end: true });
    });

    await Promise.all([ffmpegPromise, upload.done()]);

    try {
      await updateVideoStatus(videoId, "audio_ready", audioKey);
    } catch (e) {
      console.warn("updateVideoStatus(audio_ready) failed:", e.message || e);
    }

    return audioKey;
  };

  const transcriptionClient = new AssemblyAI({
    apiKey: "a62e91c5e6e541529d3f040fa45a753e",
  });

  app.post("/transcribe", verifyToken, async (req, res) => {
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      const videoMetadata = await getVideo(videoId);

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      const storedFileName = videoMetadata.storedfilename;
      const audioKey = storedFileName.replace(/\.[^/.]+$/, ".mp3");

      // Check if audio exists
      try {
        await s3Client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: audioKey })
        );
      } catch (err) {
        return res.status(400).json({
          error:
            "Audio not extracted. Please extract audio first using /extract-audio endpoint",
        });
      }

      let transcriptText;
      let transcriptId = null;

      // Check if transcript already exists in database
      if (videoMetadata.transcript) {
        console.log("using database transcript!!");
        transcriptText = videoMetadata.transcript;
      } else {
        // Generate presigned URL for AssemblyAI
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: audioKey,
        });

        const audioUrl = await S3Presigner.getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });

        // Transcribe with AssemblyAI
        const transcript = await transcriptionClient.transcripts.transcribe({
          audio: audioUrl,
          speech_model: "best",
        });

        if (transcript.status === "error") {
          throw new Error(transcript.error || "Transcription failed");
        }

        if (!transcript.text) {
          throw new Error("No transcription text received");
        }

        transcriptText = transcript.text;
        transcriptId = transcript.id;

        // Save transcript to database
        await addTranscript(transcriptText, videoId);
      }

      // Generate summary using Gemini
      let summary = "No summary available";
      try {
        const summaryResult = await model.generateContent(
          `Provide a concise summary (2-3 sentences) of this video transcript:\n\n${transcriptText}`
        );
        summary = summaryResult.response.text();
      } catch (geminiError) {
        summary = "Summary generation failed";
      }

      res.json({
        success: true,
        transcript: transcriptText,
        summary: summary,
        transcriptId: transcriptId,
      });
    } catch (err) {
      console.error("Transcription error:", err);
      res.status(500).json({
        error: "Transcription failed",
      });
    }
  });

  app.post("/extract-audio", verifyToken, async (req, res) => {
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      const videoMetadata = await getVideo(videoId);

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      const storedFileName = videoMetadata.storedfilename;
      const audioKey = storedFileName.replace(/\.[^/.]+$/, ".mp3");

      // Check if audio already exists
      try {
        await s3Client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: audioKey })
        );
      } catch (err) {
        // Audio doesn't exist, extract it
        const videoResponse = await s3Client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: storedFileName })
        );

        const inputStream = videoResponse.Body;
        if (!inputStream) throw new Error("No video data received from S3");

        const outputStream = new PassThrough();

        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: bucketName,
            Key: audioKey,
            Body: outputStream,
            ContentType: "audio/mpeg",
          },
        });

        await new Promise((resolve, reject) => {
          ffmpeg(inputStream)
            .noVideo()
            .audioCodec("libmp3lame")
            .audioBitrate("192k")
            .format("mp3")
            .on("error", reject)
            .on("end", resolve)
            .pipe(outputStream, { end: true });
        });

        await upload.done();
      }

      // Generate download URL
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: audioKey,
        ResponseContentDisposition:
          'attachment; filename="extracted-audio.mp3"',
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });

      await updateVideoStatus(videoId, "audio_ready", audioKey);

      res.json({
        success: true,
        message: "Audio extracted successfully",
        downloadUrl: downloadUrl,
      });
    } catch (err) {
      console.error("Audio extraction error:", err);
      res.status(500).json({
        error: "Audio extraction failed",
      });
    }
  });
}

bootstrap();
