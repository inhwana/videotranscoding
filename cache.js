// cache.js
const Memcached = require("memcached");
const util = require("node:util");
const { getVideoDB, getUsersVideosDB } = require("./db.js");

const memcachedAddress =
  "n11908157-a2.km2jzi.cfg.apse2.cache.amazonaws.com:11211";
const memcached = new Memcached(memcachedAddress);

// Promisify methods
memcached.aGet = util.promisify(memcached.get);
memcached.aSet = util.promisify(memcached.set);
memcached.aDel = util.promisify(memcached.del);

// Add connection event logging
memcached.on("issue", function (details) {
  console.log("🔴 Memcached issue:", details);
});

memcached.on("reconnecting", function (details) {
  console.log("🔄 Memcached reconnecting:", details);
});

memcached.on("reconnect", function (details) {
  console.log("✅ Memcached reconnected:", details);
});

memcached.on("remove", function (details) {
  console.log("🗑️ Memcached server removed:", details);
});

// Cached version of getVideo
async function getVideo(videoId) {
  const cacheKey = `video:${videoId}`;
  console.log(`🔍 [CACHE] Looking up video: ${videoId}`);

  try {
    console.log(`📦 [CACHE] Checking cache for key: ${cacheKey}`);
    const cached = await memcached.aGet(cacheKey);

    if (cached) {
      console.log(`🎯 [CACHE] HIT for video: ${videoId}`);
      const parsed = JSON.parse(cached);
      console.log(`📊 [CACHE] Retrieved video data:`, {
        id: parsed.id,
        status: parsed.status,
        hasTranscript: !!parsed.transcript,
      });
      return parsed;
    }

    console.log(`❌ [CACHE] MISS for video: ${videoId}`);
    console.log(`🗄️ [CACHE] Falling back to database...`);
    const video = await getVideoDB(videoId);

    if (video) {
      console.log(`💾 [CACHE] Retrieved from DB, caching for 5 minutes:`, {
        id: video.id,
        status: video.status,
        filename: video.storedfilename,
      });
      await memcached.aSet(cacheKey, JSON.stringify(video), 300);
      console.log(`✅ [CACHE] Successfully cached video: ${videoId}`);
    } else {
      console.log(`⚠️ [CACHE] No video found in DB for: ${videoId}`);
    }

    return video;
  } catch (error) {
    console.error(`🚨 [CACHE] Error for video ${videoId}:`, error.message);
    console.log(`🔄 [CACHE] Falling back to direct DB call...`);
    return await getVideoDB(videoId);
  }
}

// Cached version of getUsersVideos
async function getUsersVideos(userId) {
  const cacheKey = `user_videos:${userId}`;
  console.log(`🔍 [CACHE] Looking up videos for user: ${userId}`);

  try {
    console.log(`📦 [CACHE] Checking cache for key: ${cacheKey}`);
    const cached = await memcached.aGet(cacheKey);

    if (cached) {
      const videos = JSON.parse(cached);
      console.log(
        `🎯 [CACHE] HIT for user ${userId}, found ${videos.length} videos`
      );
      return videos;
    }

    console.log(`❌ [CACHE] MISS for user videos: ${userId}`);
    console.log(`🗄️ [CACHE] Falling back to database...`);
    const videos = await getUsersVideosDB(userId);

    console.log(
      `💾 [CACHE] Retrieved ${videos.length} videos from DB, caching for 1 minute`
    );
    await memcached.aSet(cacheKey, JSON.stringify(videos), 60);
    console.log(
      `✅ [CACHE] Successfully cached ${videos.length} videos for user: ${userId}`
    );

    return videos;
  } catch (error) {
    console.error(`🚨 [CACHE] Error for user ${userId}:`, error.message);
    console.log(`🔄 [CACHE] Falling back to direct DB call...`);
    return await getUsersVideosDB(userId);
  }
}

// Cache invalidation with logging
async function invalidateVideoCache(videoId) {
  const cacheKey = `video:${videoId}`;
  try {
    console.log(`🗑️ [CACHE] Invalidating cache for video: ${videoId}`);
    await memcached.aDel(cacheKey);
    console.log(`✅ [CACHE] Successfully invalidated video cache: ${videoId}`);
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
    console.log(`🗑️ [CACHE] Invalidating cache for user videos: ${userId}`);
    await memcached.aDel(cacheKey);
    console.log(
      `✅ [CACHE] Successfully invalidated user videos cache: ${userId}`
    );
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
