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

async function bootstrap() {
  //Default
  const app = express();

  app.use(express.json()); // To get forms from EJS
  dotenv.config(); // Configuratio

  const data = await getVideo("e3b7def5-c33a-4c3c-a939-3a5efc71b10d");
  console.log(data);
  // const clientId = "dktj13anu4sv0m465jemi791c";
  // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

  const { clientId, clientSecret, rdsUsername, rdsPassword } =
    await getSecrets();
  console.log(rdsUsername, rdsPassword, clientId, clientSecret);
  await initialiseVideoTable();
  //S3 Upload
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

  // Transcode the video from S3
  app.post("/transcode", verifyToken, async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      const videoMetadata = await getVideo(videoId);
      console.log("VideoId:", videoId);
      console.log("Video metadata from DB:", videoMetadata);
      console.log("req.user:", req.user);

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      const storedFileName = videoMetadata.storedfilename;
      const transcodedKey = `transcoded-${storedFileName}`;

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

      const ffmpegPromise = new Promise((resolve, reject) => {
        ffmpeg(inputStream)
          .outputOptions("-movflags frag_keyframe+empty_moov")
          .videoCodec("libx264")
          .format("mp4")
          .on("start", (cmd) => console.log("FFmpeg started:", cmd))
          .on("error", (err) => {
            console.error("FFmpeg error:", err.message, err.stack);
            reject(err);
          })
          .on("end", () => {
            console.log("Transcoding complete");
            resolve();
          })
          .pipe(outputStream, { end: true });
      });

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

      // await s3Client.send(
      //   new DeleteObjectCommand({
      //     Bucket: bucketName,
      //     Key: storedFileName,
      //   })
      // );
      console.log("Original file deleted:", storedFileName);

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

      // Save transcript to database
      await addTranscript(transcript.text, videoId);

      // Generate summary using Gemini
      let summary = "No summary available";
      try {
        const summaryResult = await model.generateContent(
          `Provide a concise summary (2-3 sentences) of this video transcript:\n\n${transcript.text}`
        );
        summary = summaryResult.response.text();
      } catch (geminiError) {
        summary = "Summary generation failed";
      }

      res.json({
        success: true,
        transcript: transcript.text,
        summary: summary,
        transcriptId: transcript.id,
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
    console.log("🔍 [DEBUG] Audio extraction requested for videoId:", videoId);

    if (!videoId) {
      console.log("❌ [DEBUG] No videoId provided");
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      console.log("🔍 [DEBUG] Fetching video metadata from database...");
      const videoMetadata = await getVideo(videoId);
      console.log(
        "🔍 [DEBUG] Video metadata:",
        JSON.stringify(videoMetadata, null, 2)
      );

      if (!videoMetadata) {
        console.log("❌ [DEBUG] No video metadata found");
        return res.status(404).json({ error: "Video not found" });
      }

      if (videoMetadata.userid !== req.user.sub) {
        console.log(
          "❌ [DEBUG] User unauthorized. Video user:",
          videoMetadata.userid,
          "Request user:",
          req.user.sub
        );
        return res.status(403).json({ error: "Unauthorized" });
      }

      const storedFileName = videoMetadata.storedfilename;
      const audioKey = storedFileName.replace(/\.[^/.]+$/, ".mp3");

      console.log("🔍 [DEBUG] Stored filename:", storedFileName);
      console.log("🔍 [DEBUG] Target audio key:", audioKey);

      // Check if audio already exists in S3
      console.log("🔍 [DEBUG] Checking if audio exists in S3...");
      try {
        const headCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: audioKey,
        });
        await s3Client.send(headCommand);
        console.log("✅ [DEBUG] Audio already exists in S3");

        // Generate download URL for existing audio
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

        return res.json({
          success: true,
          message: "Audio already exists",
          audioKey: audioKey,
          downloadUrl: downloadUrl,
        });
      } catch (s3Error) {
        console.log(
          "🔍 [DEBUG] Audio not found in S3, will extract. S3 error:",
          s3Error.name,
          s3Error.message
        );
      }

      // Audio doesn't exist, extract it from video
      console.log("🔍 [DEBUG] Fetching video from S3...");
      let videoResponse;
      try {
        videoResponse = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: storedFileName,
          })
        );
        console.log("✅ [DEBUG] Video fetched from S3 successfully");
      } catch (s3Error) {
        console.log("❌ [DEBUG] Failed to fetch video from S3:", s3Error);
        return res.status(500).json({
          error: "Failed to fetch video file from storage",
          details: s3Error.message,
        });
      }

      const inputStream = videoResponse.Body;
      if (!inputStream) {
        console.log("❌ [DEBUG] No input stream received from S3");
        throw new Error("No video data received from S3");
      }

      console.log("🔍 [DEBUG] Setting up FFmpeg for audio extraction...");
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

      // Add stream monitoring
      let bytesProcessed = 0;
      inputStream.on("data", (chunk) => {
        bytesProcessed += chunk.length;
        console.log(
          `📥 [DEBUG] Video stream data: ${chunk.length} bytes (total: ${bytesProcessed})`
        );
      });

      inputStream.on("end", () => {
        console.log(
          `✅ [DEBUG] Video stream ended. Total bytes: ${bytesProcessed}`
        );
      });

      inputStream.on("error", (err) => {
        console.log("❌ [DEBUG] Video stream error:", err);
      });

      console.log("🔍 [DEBUG] Starting FFmpeg process...");
      const ffmpegPromise = new Promise((resolve, reject) => {
        const ffmpegProcess = ffmpeg(inputStream)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate("192k")
          .format("mp3")
          .on("start", (commandLine) => {
            console.log("🎬 [DEBUG] FFmpeg started with command:", commandLine);
          })
          .on("codecData", (data) => {
            console.log("📊 [DEBUG] Input codec data:", data);
          })
          .on("progress", (progress) => {
            console.log(`📈 [DEBUG] FFmpeg progress:`, progress);
          })
          .on("stderr", (stderrLine) => {
            console.log("📝 [DEBUG] FFmpeg stderr:", stderrLine);
          })
          .on("error", (err, stdout, stderr) => {
            console.log("❌ [DEBUG] FFmpeg error:", err.message);
            console.log("❌ [DEBUG] FFmpeg stdout:", stdout);
            console.log("❌ [DEBUG] FFmpeg stderr:", stderr);
            reject(err);
          })
          .on("end", (stdout, stderr) => {
            console.log("✅ [DEBUG] FFmpeg process completed successfully");
            console.log("✅ [DEBUG] FFmpeg final stdout:", stdout);
            console.log("✅ [DEBUG] FFmpeg final stderr:", stderr);
            resolve();
          });

        console.log("🔍 [DEBUG] Piping FFmpeg output to S3 upload stream...");
        ffmpegProcess.pipe(outputStream, { end: true });
      });

      console.log("🔍 [DEBUG] Waiting for FFmpeg and S3 upload to complete...");
      await Promise.all([ffmpegPromise, upload.done()]);
      console.log(
        "✅ [DEBUG] Audio extraction and upload completed successfully"
      );

      // Verify the audio file was uploaded
      console.log("🔍 [DEBUG] Verifying audio upload...");
      try {
        const verifyCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: audioKey,
        });
        await s3Client.send(verifyCommand);
        console.log("✅ [DEBUG] Audio file verified in S3");
      } catch (verifyError) {
        console.log("❌ [DEBUG] Failed to verify audio upload:", verifyError);
        throw new Error("Audio upload verification failed");
      }

      // Generate presigned URL for the new audio file
      const downloadCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: audioKey,
        ResponseContentDisposition:
          'attachment; filename="extracted-audio.mp3"',
      });

      const downloadUrl = await S3Presigner.getSignedUrl(
        s3Client,
        downloadCommand,
        {
          expiresIn: 3600,
        }
      );

      console.log("🔍 [DEBUG] Updating database status...");
      await updateVideoStatus(videoId, "audio_ready", audioKey);
      console.log("✅ [DEBUG] Database status updated");

      res.json({
        success: true,
        message: "Audio extracted successfully",
        audioKey: audioKey,
        downloadUrl: downloadUrl,
      });
    } catch (err) {
      console.error("❌ [DEBUG] FINAL ERROR in audio extraction:", err);
      console.error("❌ [DEBUG] Error stack:", err.stack);
      res.status(500).json({
        error: "Audio extraction failed",
        details: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  });
}

bootstrap();
