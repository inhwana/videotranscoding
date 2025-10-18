// Import all the packages and relevant functions from them
const express = require("express");

// functions from the secrets module
const { getSecrets } = require("./secrets.js");

// functions from the db module
const {
  initialiseVideoTable,
  addVideo,
  updateVideoStatus,
  addTranscript,
  getTranscript,
} = require("./db.js");

// functions from the cache module
const {
  getUsersVideos,
  getVideo,
  invalidateUserVideosCache,
  invalidateVideoCache,
  initialiseMemcached,
} = require("./cache.js");

const { verifyToken } = require("./auth.js");
// parameters module
const { getParameters } = require("./parameters.js");

// Function which basically contains the whole functionality of the app
async function bootstrap() {
  // create new express app and use json
  const app = express();
  app.use(express.json());

  try {
    // initialise memCache, the video table, and gemini model
    await initialiseMemcached();
    await initialiseVideoTable();
  } catch {
    err.console.log(err);
  }

  // endpoint for users to upload video files
  //S3 Upfload

  app.get("/users/:userId/videos", verifyToken, async (req, res) => {
    try {
      const videos = await getUsersVideos(req.params.userId);
      res.json(videos);
    } catch (err) {
      console.error("Error fetching user videos:", err);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  // Endpoint to get single video metadata
  app.get("/videos/:videoId", verifyToken, async (req, res) => {
    try {
      const video = await getVideo(req.params.videoId);
      if (!video) return res.status(404).json({ error: "Video not found" });
      if (video.userid !== req.user.sub) {
        console.error(
          `User mismatch: DB userid=${video.userid}, req.user.sub=${req.user.sub}`
        );
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }

      res.json(video);
    } catch (err) {
      console.error("Error fetching video:", err);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });

  // Endpoint to add video metadata
  app.post("/upload", verifyToken, async (req, res) => {
    const metadata = req.body; // { id, userId, originalFileName, storedFileName, uploadTimestamp, status }
    try {
      // Use your existing addVideo from db.js (cache.js doesn't have add, but invalidates after)
      await addVideo(metadata);
      await invalidateUserVideosCache(metadata.userid);
      res.json({ success: true, videoId: metadata.id });
    } catch (err) {
      console.error("Error adding video:", err);
      res.status(500).json({ error: "Failed to add video" });
    }
  });

  // Endpoint to update video status
  app.put("/videos/:videoId/status", verifyToken, async (req, res) => {
    const { status, outputFileName } = req.body;
    try {
      // Use your existing updateVideoStatus from db.js

      await updateVideoStatus(req.params.videoId, status, outputFileName);
      await invalidateVideoCache(req.params.videoId);
      // Optionally get video to invalidate user cache
      const video = await getVideo(req.params.videoId);
      if (video) await invalidateUserVideosCache(video.userid);
      res.json({ success: true });
    } catch (err) {
      console.error("Error updating video status:", err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // Additional endpoints if needed (e.g., for transcripts, if Processing calls this)
  app.post("/videos/:videoId/transcript", verifyToken, async (req, res) => {
    const { transcript } = req.body;
    try {
      await addTranscript(transcript, req.params.videoId);
      await invalidateVideoCache(req.params.videoId); // Invalidate cache after update
      res.json({ success: true });
    } catch (err) {
      console.error("Error adding transcript:", err);
      res.status(500).json({ error: "Failed to add transcript" });
    }
  });

  app.get("/videos/:videoId/transcript", verifyToken, async (req, res) => {
    try {
      const transcript = await getTranscript(req.params.videoId);
      if (!transcript)
        return res.status(404).json({ error: "Transcript not found" });
      res.json(transcript);
    } catch (err) {
      console.error("Error fetching transcript:", err);
      res.status(500).json({ error: "Failed to fetch transcript" });
    }
  });
  app.get("/health", (req, res) => res.sendStatus(200));
  app.listen(3000, () => {
    console.log("API service running on port 3000");
  });
}

bootstrap();
