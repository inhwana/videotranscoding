const { Pool } = require("pg");
const { getSecrets } = require("./secrets.js");

const initDb = async () => {
  if (!pool) {
    const { rdsUsername, rdsPassword } = await getSecrets();
    pool = new Pool({
      host: "database-1-instance-1.ce2haupt2cta.ap-southeast-2.rds.amazonaws.com",
      port: 5432,
      database: "cohort_2025",
      user: rdsUsername,
      password: rdsPassword,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await pool.connect();
      console.log("Connected to RDS PostgreSQL");
    } catch (err) {
      console.error("RDS connection error:", err);
      throw err;
    }
  }
  return pool;
};

const initialiseVideoTable = async () => {
  const client = await initDb();
  try {
    const schemaCheck = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 's142')`
    );
    if (!schemaCheck.rows[0].exists) {
      console.error("Schema s142 does not exist");
      throw new Error("Schema s142 does not exist");
    }

    // Check if videos table exists
    const tableCheck = await client.query(
      `SELECT EXISTS (
         SELECT 1 
         FROM information_schema.tables 
         WHERE table_schema = 's142' 
         AND table_name = 'videos'
       )`
    );
    if (tableCheck.rows[0].exists) {
      console.log("s142 schema already has a videos table");
      return;
    }

    // Create videos table (should not reach here given current permissions)
    await client.query(`
      CREATE TABLE s142.videos (
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
    console.log("Videos table created!!");
  } catch (err) {
    console.error("Error initializing videos table:", err);
    throw err;
  }
};

const getUsersVideosDB = async (userId) => {
  const client = await initDb();
  try {
    const res = await client.query(
      `SELECT id, userId, originalFileName, storedFileName, uploadTimestamp, status, outputFileName
       FROM s142.videos
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
      `UPDATE s142.videos SET status = $1, outputFileName = $2 WHERE id = $3`,
      [status, outputFileName, id]
    );
    console.log("Updated video status:", { id, status, outputFileName });
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
      `INSERT INTO s142.videos (id, userId, originalFileName, storedFileName, uploadTimestamp, status, outputFileName, requestedFormat)
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
    console.log("Video added to RDS:", { id, userId, storedFileName });
  } catch (err) {
    console.error("Error adding video:", err);
    throw err;
  }
};

const getVideoDB = async (id) => {
  const client = await initDb();
  try {
    const res = await client.query(`SELECT * FROM s142.videos WHERE id = $1`, [
      id,
    ]);
    return res.rows[0];
  } catch (err) {
    console.error("Error fetching video:", err);
    throw err;
  }
};

const addTranscript = async (transcript, id) => {
  const client = await initDb();
  try {
    await client.query(`UPDATE s142.videos SET transcript = $1 WHERE id = $2`, [
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
      `SELECT transcript FROM s142.videos WHERE id = $1`,
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
  getVideoDB,
  getUsersVideosDB,
  addTranscript,
  getTranscript,
};
