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

  const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    try {
      const response = await fetch(
        "http://manny-inhwa-auth-sc.cab432-utfaygk6rl32luiw:3000/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }
      );

      if (!response.ok) throw new Error("Invalid token");
      const { user } = await response.json();

      req.user = user;
      next();
    } catch (err) {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

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
        "http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/upload",
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
        throw new Error("failed to add video metadata :(");
      }
      console.log(storedFileName);
      // send back the presigned url so the user can upload their video, and add to the queue baby

      res.json({ url: presignedURL, videoId, storedFileName });
    } catch (err) {
      console.log(err);
    }
  });

  // get metadata of videos
  app.get("/videos", verifyToken, async (req, res) => {
    try {
      const metadataResponse = await fetch(
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/users/${req.user.sub}/videos`,
        {
          headers: {
            Authorization: req.headers.authorization,
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("can't fetch video metadata");
      }
      const videos = await metadataResponse.json();
      res.json(videos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "couldn't fetch videos" });
    }
  });

  app.get("/health", (req, res) => res.sendStatus(200));

  app.post("/transcode", verifyToken, async (req, res) => {
    const { videoId, storedFileName } = req.body;
    if (!videoId || !storedFileName)
      return res.status(400).json({ error: "Missing video information" });
    const queueUrl =
      "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";

    const updateResponse = await fetch(
      `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}/status`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization,
        },
        body: JSON.stringify({ status: "transcoding", outputFileName: null }),
      }
    );

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          videoId,
          storedFileName,
          taskType: "transcode",
        }),
      })
    );

    res.json({ message: "Transcoding queued!" });
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
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization,
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
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}/status`,
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
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}/transcript`,
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
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization,
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("can't fetch video metadata");
      }
      const videoMetadata = await metadataResponse.json();
      const storedFileName = videoMetadata.storedfilename;
      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Not authorized or video not found" });
      }

      const queueUrl =
        "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            videoId,
            storedFileName,
            taskType: "extract-audio",
          }),
        })
      );

      const updateResponse = await fetch(
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}/status`,
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
        throw new Error("Can't fetch video status");
      }

      // Invalidate caches via Metadata service
      await fetch(
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}/invalidate`,
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
        message: "queued up audio extraction successfully",
      });
    } catch (err) {
      console.error("Audio extraction error:", err);
      res.status(500).json({
        error: "failed to extract audio!",
      });
    }
  });

  app.get("/videos/:videoId/download", verifyToken, async (req, res) => {
    const { videoId } = req.params;

    try {
      const metadataResponse = await fetch(
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization,
          },
        }
      );
      if (!metadataResponse.ok) {
        throw new Error("can't fetch video metadata");
      }
      const videoMetadata = await metadataResponse.json();

      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "video not found or unauthorized" });
      }
      console.log("video metadata on download:", videoMetadata);

      if (
        videoMetadata.status !== "transcoded" ||
        !videoMetadata.outputfilename
      ) {
        return res.status(400).json({ error: "Video not ready for download" });
      }

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: videoMetadata.outputfilename,
      });

      const downloadUrl = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
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
        `http://manny-inhwa-metadata.cab432-utfaygk6rl32luiw:3000/videos/${req.params.videoId}`,
        {
          headers: {
            Authorization: req.headers.authorization,
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
