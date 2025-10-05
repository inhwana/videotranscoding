// cache.js
const Memcached = require("memcached");
const util = require("node:util");
const { getVideoDB, getUsersVideosDB } = require("./db.js");
const { getParameters } = require("./parameters.js");

const { memcachedAddress } = getParameters();
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
      const parsed = JSON.parse(cached);

      return parsed;
    }

    const video = await getVideoDB(videoId);

    if (video) {
      await memcached.aSet(cacheKey, JSON.stringify(video), 300);
    } else {
      console.log(`⚠️ [CACHE] No video found in DB for: ${videoId}`);
    }

    return video;
  } catch (error) {
    console.error(`🚨 [CACHE] Error for video ${videoId}:`, error.message);
    return await getVideoDB(videoId);
  }
}

// Cached version of getUsersVideos
async function getUsersVideos(userId) {
  const cacheKey = `user_videos:${userId}`;

  try {
    const cached = await memcached.aGet(cacheKey);

    if (cached) {
      const videos = JSON.parse(cached);

      return videos;
    }

    const videos = await getUsersVideosDB(userId);

    await memcached.aSet(cacheKey, JSON.stringify(videos), 60);

    return videos;
  } catch (error) {
    console.error(`🚨 [CACHE] Error for user ${userId}:`, error.message);

    return await getUsersVideosDB(userId);
  }
}

// Cache invalidation with logging
async function invalidateVideoCache(videoId) {
  const cacheKey = `video:${videoId}`;
  try {
    await memcached.aDel(cacheKey);
  } catch (error) {
    console.error(
      `🚨 [CACHE] Error invalidating video ${videoId}:`,
      error.message
    );
  }
}

async function invalidateUserVideosCache(userId) {
  const cacheKey = `user_videos:${userId}`;
  try {
    await memcached.aDel(cacheKey);
  } catch (error) {
    console.error(
      `🚨 [CACHE] Error invalidating user videos ${userId}:`,
      error.message
    );
  }
}

// Test connection on startup
async function testConnection() {
  try {
    console.log("🧪 [CACHE] Testing memcached connection...");
    await memcached.aSet("test", "connected", 10);
    const result = await memcached.aGet("test");
    console.log("✅ [CACHE] Connection test successful:", result);
  } catch (error) {
    console.error("🚨 [CACHE] Connection test failed:", error.message);
  }
}

// Run connection test when module loads
testConnection();

module.exports = {
  getVideo,
  getUsersVideos,
  invalidateVideoCache,
  invalidateUserVideosCache,
  memcached,
};
