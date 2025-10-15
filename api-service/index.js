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
const { SendMessageCommand, SQSClient } = require("@aws-sdk/client-sqs");

// import functions from the gemini module
const { model, initialiseGemini } = require("./gemini.js");

// functions from the auth module
const { verifyToken } = require("./auth.js");

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
  const sqsClient = new SQSClient({ region: "ap-southeast-2" });

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

    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

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

      // send back the presigned url so the user can upload their video, and add to the queue baby
      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ videoId, taskType: "extract-audio" }),
        })
      );

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

      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ videoId, taskType: "transcode" }),
        })
      );
      // update the status of the video in the table to transcoding
      await updateVideoStatus(videoId, "queued", null);

      // transcode the video to mp4
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
      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ videoId, taskType: "transcribe" }),
        })
      );

      await updateVideoStatus(videoId, "queued", null);

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

      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ videoId, taskType: "extract-audio" }),
        })
      );

      await updateVideoStatus(videoId, "queued", null);
      await invalidateVideoCache(videoId);
      await invalidateUserVideosCache(req.user.sub);

      res.json({
        success: true,
        message: "Audio extracted successfully",
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
