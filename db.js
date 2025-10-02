const { Pool } = require("pg");
const { getSecrets } = require("./secrets.js");

let pool;

const initDb = async () => {
  if (!pool) {
    const { rdsUsername, rdsPassword } = await getSecrets();
    pool = new Pool({
      host: "database-1-instance-1.ce2haupt2cta.ap-southeast-2.rds.amazonaws.com",
      port: 5432,
      database: "cohort_2025",
      user: rdsUsername,
      password: rdsPassword,
      ssl: { rejectUnauthorized: false }, // Required for RDS
    });
  }
  return pool;
};

const initialiseVideoTable = async () => {
  const client = await initDb();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        userId TEXT,
        originalFileName TEXT,
        storedFileName TEXT,
        uploadTimestamp BIGINT,
        status TEXT,
        outputFileName TEXT,
        requestedFormat TEXT,
        transcript TEXT
      )
    `);
    console.log("Videos table initialized");
  } catch (err) {
    console.error("Error initializing videos table:", err);
    throw err;
  }
};

const getUsersVideos = async (userId) => {
  const client = await initDb();
  try {
    const res = await client.query(
      `SELECT id, userId, originalFileName, storedFileName, uploadTimestamp, status, outputFileName
       FROM videos
       WHERE userId = $1
       ORDER BY uploadTimestamp DESC`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error("Error fetching user videos:", err);
    throw err;
  }
};

const updateVideoStatus = async (id, status, outputFileName) => {
  const client = await initDb();
  try {
    await client.query(
      `UPDATE videos SET status = $1, outputFileName = $2 WHERE id = $3`,
      [status, outputFileName, id]
    );
  } catch (err) {
    console.error("Error updating video status:", err);
    throw err;
  }
};

const addVideo = async (metadata) => {
  const client = await initDb();
  const {
    id,
    userId,
    originalFileName,
    storedFileName,
    uploadTimestamp,
    status,
    outputFileName,
    requestedFormat,
  } = metadata;
  try {
    await client.query(
      `INSERT INTO videos (id, userId, originalFileName, storedFileName, uploadTimestamp, status, outputFileName, requestedFormat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        userId,
        originalFileName,
        storedFileName,
        uploadTimestamp,
        status,
        outputFileName || null,
        requestedFormat,
      ]
    );
  } catch (err) {
    console.error("Error adding video:", err);
    throw err;
  }
};

const getVideo = async (id) => {
  const client = await initDb();
  try {
    const res = await client.query(`SELECT * FROM videos WHERE id = $1`, [id]);
    return res.rows[0];
  } catch (err) {
    console.error("Error fetching video:", err);
    throw err;
  }
};

const addTranscript = async (transcript, id) => {
  const client = await initDb();
  try {
    await client.query(`UPDATE videos SET transcript = $1 WHERE id = $2`, [
      transcript,
      id,
    ]);
  } catch (err) {
    console.error("Error adding transcript:", err);
    throw err;
  }
};

const getTranscript = async (id) => {
  const client = await initDb();
  try {
    const res = await client.query(
      `SELECT transcript FROM videos WHERE id = $1`,
      [id]
    );
    return res.rows[0];
  } catch (err) {
    console.error("Error fetching transcript:", err);
    throw err;
  }
};

module.exports = {
  initDb,
  initialiseVideoTable,
  addVideo,
  updateVideoStatus,
  getVideo,
  getUsersVideos,
  addTranscript,
  getTranscript,
};
