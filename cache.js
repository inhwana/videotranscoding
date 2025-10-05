// cache.js
const Memcached = require("memcached");
const util = require("node:util");
const { getVideoDB, getUsersVideosDB } = require("./db.js");
const { getParameters } = require("./parameters.js");
const test = require("node:test");

let memcached;

const initialiseMemcached = async () => {
  const { memcachedAddress } = await getParameters();
  memcached = new Memcached(memcachedAddress);
  console.log(memcachedAddress);
  // Promisify methods
  memcached.aGet = util.promisify(memcached.get.bind(memcached));
  memcached.aSet = util.promisify(memcached.set.bind(memcached));
  memcached.aDel = util.promisify(memcached.del.bind(memcached));
  await testConnection();
};

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
      console.log(`No video found in the database for: ${videoId}`);
    }

    return video;
  } catch (error) {
    console.error(`error getting the video ${videoId}:`, error.message);
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
    console.error(
      `There was an error retrieving the videos for user ${userId}:`,
      error.message
    );

    return await getUsersVideosDB(userId);
  }
}

async function invalidateVideoCache(videoId) {
  const cacheKey = `video:${videoId}`;
  try {
    await memcached.aDel(cacheKey);
  } catch (error) {
    console.error(` Error invalidating the cache:`, error.message);
  }
}

async function invalidateUserVideosCache(userId) {
  const cacheKey = `user_videos:${userId}`;
  try {
    await memcached.aDel(cacheKey);
  } catch (error) {
    console.error(`error invalidating cache ${userId}:`, error.message);
  }
}

// Test connection on startup
async function testConnection() {
  try {
    await memcached.aSet("test", "connected", 10);
    const result = await memcached.aGet("test");
    console.log("connected to the cache!");
  } catch (error) {
    console.error("error connecting to cache:", error.message);
  }
}

module.exports = {
  getVideo,
  getUsersVideos,
  invalidateVideoCache,
  invalidateUserVideosCache,
  memcached,
  initialiseMemcached,
};
