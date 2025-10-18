// Import all the packages and relevant functions from them
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const S3Presigner = require("@aws-sdk/s3-request-presigner");

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
const { initialiseVideoTable } = require("./db.js");

// functions from the cache module

// parameters module
const { getParameters } = require("./parameters.js");

// Function which basically contains the whole functionality of the app
async function bootstrap() {
  // create new express app and use json
  const app = express();
  app.use(express.json());

  const cors = require("cors");

  app.use(
    cors({
      origin: "http://localhost:5173",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  // initialise a new S3 client
  const s3Client = new S3Client({ region: "ap-southeast-2" });
  const sqsClient = new SQSClient({ region: "ap-southeast-2" });

  // get parameters and secrets
  const { bucketName, presignedUrlExpiry, userPoolId } = await getParameters();
  const { assemblyApiKey, geminiApiKey, clientId } = await getSecrets();

  // initialise memCache, the video table, and gemini model

  app.use((req, res, next) => {
    console.log("Incoming headers:", req.headers);
    next();
  });

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

      const metadataResponse = await fetch(
        "http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({
            id: videoId,
            userid: req.user.sub,
            originalFileName: filename,
            storedFileName,
            uploadTimestamp: Date.now(),
            status: "uploading",
          }),
        }
      );
      console.log("Metadata response status:", metadataResponse.status);
      const text = await metadataResponse.text();
      console.log("Metadata response body:", text);
      if (!metadataResponse.ok) {
        throw new Error("Failed to add video metadata");
      }

      // send back the presigned url so the user can upload their video, and add to the queue baby
      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ videoId, taskType: "transcode" }),
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
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/users/${req.user.sub}/videos`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch videos from metadata");
      }
      const videos = await metadataResponse.json();
      res.json(videos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not fetch videos" });
    }
  });

  app.get("/health", (req, res) => res.sendStatus(200));

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
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch video metadata");
      }

      const videoMetadata = await metadataResponse.json();
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
      const updateResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "queued", outputFileName: null }),
        }
      );
      if (!updateResponse.ok) {
        throw new Error("Failed to update video status");
      }

      res.json({ success: true });
      // transcode the video to mp4
    } catch (err) {
      // send back the errors if there are any, and invalidate the caches too
      console.error("Transcode error:", err);
      await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({ status: "failed", outputFileName: null }),
        }
      ).catch(console.error);

      res
        .status(500)
        .json({ error: `Transcoding was not successful ${err.message}` });
    }
  });

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });

  app.post("/transcribe", verifyToken, async (req, res) => {
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    try {
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch video metadata");
      }
      const videoMetadata = await metadataResponse.json();

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

      const updateResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({ status: "queued", outputFileName: null }),
        }
      );
      if (!updateResponse.ok) {
        throw new Error("Failed to update video status");
      }

      // Old
      res.json({
        success: true,
        transcript: transcriptText,
        summary: summary,
        transcriptId: transcriptId,
      });
      // New
      const transcriptResponse = await fetch(
        `http://ec2-54-252-191-77.../videos/${videoId}/transcript`,
        { headers: { Authorization: req.headers.authorization } }
      );
      const transcriptData = transcriptResponse.ok
        ? await transcriptResponse.json()
        : null;
      res.json({
        success: true,
        transcript: transcriptData?.transcript || null,
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
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch video metadata");
      }
      const videoMetadata = await metadataResponse.json();
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

      const updateResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({ status: "queued", outputFileName: null }),
        }
      );
      if (!updateResponse.ok) {
        throw new Error("Failed to update video status");
      }

      // Invalidate caches via Metadata service
      await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/invalidate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({ userId: req.user.sub }),
        }
      ).catch(console.error);

      res.json({
        success: true,
        message: "Audio extraction queued successfully",
      });
    } catch (err) {
      console.error("Audio extraction error:", err);
      res.status(500).json({
        error: "Audio extraction failed",
      });
    }
  });

  app.get("/videos/:videoId/download", verifyToken, async (req, res) => {
    const { videoId } = req.params;

    try {
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch video metadata");
      }
      const videoMetadata = await metadataResponse.json();

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      if (
        videoMetadata.status !== "transcoded" ||
        !videoMetadata.outputFileName
      ) {
        return res.status(400).json({ error: "Video not ready for download" });
      }

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: videoMetadata.outputFileName,
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      res.json({ downloadUrl });
    } catch (err) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Failed to generate download URL" });
    }
  });
  app.get("/videos/:videoId", verifyToken, async (req, res) => {
    try {
      const metadataResponse = await fetch(
        `http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${req.params.videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization, // Forward the JWT
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch video metadata");
      }
      const video = await metadataResponse.json();
      if (!video || video.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }
      res.json(video);
    } catch (err) {
      console.error("Video fetch error:", err);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });
}

bootstrap();
