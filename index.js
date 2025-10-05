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

  // endpoint for users to upload video files
  //S3 Upfload
  app.post("/upload", verifyToken, async (req, res) => {
    const { filename } = req.body;

    // create a name for the file
    const videoId = uuidv4();
    const storedFileName = `${videoId}-${Date.now()}.${filename
      .split(".")
      .pop()}`;

    try {
      // create a new command to put video
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: storedFileName,
      });

      // get a presigned URL so that the client can insert a file to the s3 bucket
      const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });

      // update the database with the information of the video
      await addVideo({
        id: videoId,
        userId: req.user.sub,
        originalFileName: filename,
        storedFileName,
        uploadTimestamp: Date.now(),
        status: "uploading",
      });

      // invalidate the cache
      await invalidateUserVideosCache(req.user.sub);

      // send back the presigned url so the user can upload their video
      res.json({ url: presignedURL, videoId });
    } catch (err) {
      console.log(err);
    }
  });

  // get metadata of videos
  app.get("/videos", verifyToken, async (req, res) => {
    try {
      // call the getUsersVideos function from the backend
      const videos = await getUsersVideos(req.user.sub);
      res.json(videos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not fetch videos" });
    }
  });

  // change the format of the uploaded video
  app.post("/transcode", verifyToken, async (req, res) => {
    // get the videoId from the client
    const { videoId } = req.body;

    // throw an error if none is returned
    if (!videoId) {
      return res.status(400).json({ error: "You need to upload a video" });
    }

    try {
      // retrieve video metadata form the database
      const videoMetadata = await getVideo(videoId);

      // if there is no record of the video in the table, or the video does not
      // belong to the user, an error is
      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "video not found or does not belong to you" });
      }

      // get the storedFilename from the video's metadata
      const storedFileName = videoMetadata.storedfilename;
      const transcodedKey = `transcoded-${storedFileName.replace(
        /\.[^/.]+$/,
        ".mp4"
      )}`;

      // get the stored, uploaded, untranscoded video
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: storedFileName,
        })
      );

      // define input and output streams and make sure the video is actually
      // retrieved from s3
      const inputStream = response.Body;
      if (!inputStream) {
        throw new Error("Couldn't retrieve data from S3");
      }
      const outputStream = new PassThrough();

      // start a new upload for the transcoded video
      const uploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: transcodedKey,
          Body: outputStream,
          ContentType: "video/mp4",
        },
      });

      // update the status of the video in the table to transcoding
      await updateVideoStatus(videoId, "transcoding", null);

      // transcode the video to mp4
      const ffmpegPromise = new Promise((resolve, reject) => {
        ffmpeg(inputStream)
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([
            "-movflags frag_keyframe+empty_moov",
            "-preset fast",
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

      // wait until the video is transcoded and uploaded to s3
      await Promise.all([ffmpegPromise, uploads3.done()]);

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: transcodedKey,
        ResponseContentDisposition:
          'attachment; filename="transcodedvideo.mp4"',
      });

      // get the presigned download url
      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });

      // update the video status in table, which means that the caches are no
      // longer valid as well
      await updateVideoStatus(videoId, "completed", transcodedKey);
      await invalidateVideoCache(videoId);
      await invalidateUserVideosCache(req.user.sub);

      // send back the download url to the user so they may download the
      // transcoded video
      res.json({ url: downloadUrl });
    } catch (err) {
      // send back the errors if there are any, and invalidate the caches too
      console.error("Transcode error:", err);
      await updateVideoStatus(videoId, "failed", null);
      await invalidateVideoCache(videoId);
      await invalidateUserVideosCache(req.user.sub);
      res
        .status(500)
        .json({ error: `Transcoding was not successful ${err.message}` });
    }
  });

  app.get("/download/:videoId", verifyToken, async (req, res) => {
    const { videoId } = req.params;
    const { bucketName, presignedUrlExpiry } = await getParameters();

    try {
      // Get video details from database
      const video = await getVideo(videoId);

      // Log the video object for debugging
      console.log("Video metadata:", video);

      // Check if video exists and status is "completed"
      if (!video || video.status !== "completed") {
        return res.status(400).json({ error: "Video not ready or not found" });
      }

      // Check if storedFileName exists
      if (!video.storedfilename) {
        return res.status(400).json({ error: "Video file name is missing" });
      }

      // Check authorization: user owns the video or is in Admins group
      if (
        video.userid !== req.user.sub &&
        !req.user.groups.includes("Admins")
      ) {
        return res.status(403).json({ error: "Video belongs to someone else" });
      }

      // Generate presigned URL for S3 download
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: video.storedfilename,
        ResponseContentDisposition: `attachment; filename="${video.originalFileName}"`,
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: presignedUrlExpiry,
      });

      // Respond with the presigned URL
      res.json({ url: downloadUrl });
    } catch (err) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Failed to generate download URL" });
    }
  });
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
