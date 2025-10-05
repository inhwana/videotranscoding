// cache.js
const Memcached = require("memcached");
const util = require("node:util");
const { getVideoDB, getUsersVideosDB } = require("./db.js");

const memcachedAddress = "your-cache.cfg.apse2.cache.amazonaws.com:11211";
const memcached = new Memcached(memcachedAddress);

// Promisify methods
memcached.aGet = util.promisify(memcached.get);
memcached.aSet = util.promisify(memcached.set);
memcached.aDel = util.promisify(memcached.del);

// Cached version of getVideo
async function getVideo(videoId) {
  const cacheKey = `video:${videoId}`;

  try {
    const cached = await memcached.aGet(cacheKey);
    if (cached) {
      console.log("🎯 Cache HIT for video:", videoId);
      return JSON.parse(cached);
    }

    console.log("❌ Cache MISS for video:", videoId);
    const video = await getVideoDB(videoId);

    // Cache for 5 minutes
    if (video) {
      await memcached.aSet(cacheKey, JSON.stringify(video), 300);
    }
    return video;
  } catch (error) {
    console.error("Cache error, falling back to DB:", error);
    return await getVideoDB(videoId); // Fallback to DB
  }
}

// Cached version of getUsersVideos
async function getUsersVideos(userId) {
  const cacheKey = `user_videos:${userId}`;

  try {
    const cached = await memcached.aGet(cacheKey);
    if (cached) {
      console.log("🎯 Cache HIT for user videos:", userId);
      return JSON.parse(cached);
    }

    console.log("❌ Cache MISS for user videos:", userId);
    const videos = await getUsersVideosDB(userId);

    // Cache for 1 minute (frequently updated)
    await memcached.aSet(cacheKey, JSON.stringify(videos), 60);
    return videos;
  } catch (error) {
    console.error("Cache error, falling back to DB:", error);
    return await getUsersVideosDB(userId);
  }
}

// Cache invalidation
async function invalidateVideoCache(videoId) {
  try {
    await memcached.aDel(`video:${videoId}`);
    console.log("🗑️ Invalidated video cache:", videoId);
  } catch (error) {
    console.error("Error invalidating cache:", error);
  }
}

async function invalidateUserVideosCache(userId) {
  try {
    await memcached.aDel(`user_videos:${userId}`);
    console.log("🗑️ Invalidated user videos cache:", userId);
  } catch (error) {
    console.error("Error invalidating cache:", error);
  }
}

module.exports = {
  getVideo,
  getUsersVideos,
  invalidateVideoCache,
  invalidateUserVideosCache,
  memcached, // export for direct access if needed
};
