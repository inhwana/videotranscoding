// Import all the packages and relevant functions from them
const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");
const { AssemblyAI } = require("assemblyai");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

// import functions from the gemini module
const { model, initialiseGemini } = require("./gemini.js");

// functions from the auth module
const {
  cognitoSignUp,
  cognitoLogin,
  confirmWithCode,
  verifyToken,
} = require("./auth.js");

// functions from the secrets module
const { getSecrets } = require("./secrets.js");

// functions from the db module
const {
  initialiseVideoTable,
  addVideo,
  updateVideoStatus,
  addTranscript,
} = require("./db.js");

// functions from the cache module
const {
  getUsersVideos,
  getVideo,
  invalidateUserVideosCache,
  invalidateVideoCache,
  initialiseMemcached,
} = require("./cache.js");

// parameters module
const { getParameters } = require("./parameters.js");

// Function which basically contains the whole functionality of the app
async function bootstrap() {
  // create new express app and use json
  const app = express();
  app.use(express.json());

  // initialise a new S3 client
  const s3Client = new S3Client({ region: "ap-southeast-2" });

  // get parameters and secrets
  const { bucketName, presignedUrlExpiry } = await getParameters();
  const { clientId, clientSecret, assemblyApiKey } = await getSecrets();

  // initialise memCache, the video table, and gemini model
  await initialiseMemcached();
  await initialiseVideoTable();
  await initialiseGemini();

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
      });
      const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });
      console.log(presignedURL);

      await addVideo({
        id: videoId,
        userId: req.user.sub,
        originalFileName: filename,
        storedFileName,
        uploadTimestamp: Date.now(),
        status: "uploading",
      });

      await invalidateUserVideosCache(req.user.sub);

      res.json({ url: presignedURL, videoId });
    } catch (err) {
      console.log(err);
    }
  });

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
            outputStream.end();
            resolve();
          })
          .pipe(outputStream, { end: false });
      });

      await Promise.all([ffmpegPromise, uploads3.done()]);

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: transcodedKey,
        ResponseContentDisposition:
          'attachment; filename="transcodedvideo.mp4"',
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });

      await updateVideoStatus(videoId, "completed", transcodedKey);
      await invalidateVideoCache(videoId);
      await invalidateUserVideosCache(req.user.sub);

      res.json({ url: downloadUrl });
    } catch (err) {
      console.error("Transcode error:", err);
      await updateVideoStatus(videoId, "failed", null);
      await invalidateVideoCache(videoId); // ADD THIS
      await invalidateUserVideosCache(req.user.sub); // ADD THIS
      res.status(500).json({ error: `Transcoding failed: ${err.message}` });
    }
  });










// this is the login thing that you should do/check/add your aws thing to!!
app.post("/", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { clientId, clientSecret } = await getSecrets();
    const result = await cognitoLogin(
      clientId,
      clientSecret,
      username,
      password
    );
    // if (result.ChallengeName === "EMAIL_OTP") {
    //   res.json({
    //     ChallengeName: result.ChallengeName,
    //     Session: result.Session,
    //     Username: username
    //   });
    // } else {
    //   res.status(400).json({ error: "MFA did not work" });
    // }

    res.json({
    ChallengeName: result.ChallengeName,
    Session: result.Session,
    Username: result.Username
      /*idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      refreshToken: result.AuthenticationResult.RefreshToken,*/
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: "Login failed" });
  }
});


app.post("/mfa", async (req, res) => {
  const { ChallengeName,code } = req.body;

  try{
    const { clientId, clientSecret } = await getSecrets();
    await mfaconfirm(clientId, clientSecret, code, ChallengeName, session, username);
    //res.json({ success: true, message: "MFA Success" });
    res.json({
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      refreshToken: result.AuthenticationResult.RefreshToken,
    });
  } catch (error){
    console.log(error);
    res.status(400).json({ error: "Confirmation failed" });
  }

});



/*
  app.post("/", async (req, res) => {
    const { username, password } = req.body;

    try {
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
  });*/

  app.post("/confirm", async (req, res) => {
    const { username, code } = req.body;
    try {
      // const { clientId, clientSecret } = await getSecrets();
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

  const transcriptionClient = new AssemblyAI({
    apiKey: assemblyApiKey,
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

      if (videoMetadata.transcript) {
        console.log("using database transcript!!");
        transcriptText = videoMetadata.transcript;
      } else {
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: audioKey,
        });

        const audioUrl = await S3Presigner.getSignedUrl(s3Client, command, {
          expiresIn: presignedUrlExpiry,
        });

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

        await addTranscript(transcriptText, videoId);
        await invalidateVideoCache(videoId);
      }

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

      try {
        await s3Client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: audioKey })
        );
      } catch (err) {
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

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: audioKey,
        ResponseContentDisposition:
          'attachment; filename="extracted-audio.mp3"',
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });

      await updateVideoStatus(videoId, "audio_ready", audioKey);
      await invalidateVideoCache(videoId);
      await invalidateUserVideosCache(req.user.sub);

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
