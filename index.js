const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const dotenv = require("dotenv");

const { v4: uuidv4 } = require("uuid");
//AWS S3
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");

const bucketName = "n10851879-test"; // Test Bucket Name
const s3Client = new S3Client({ region: "ap-southeast-2" });

//AWS Secrets
const SecretsManager = require("@aws-sdk/client-secrets-manager");
const {
  cognitoSignUp,
  cognitoLogin,
  confirmWithCode,
  verifyToken,
} = require("./auth.js");
const { getSecrets } = require("./secrets.js");

const cors = require("cors");

const {
  initDb,
  initialiseVideoTable,
  addVideo,
  updateVideoStatus,
  getUsersVideos,
  getVideo,
} = require("./db.js");

async function bootstrap() {
  //Default
  const app = express();

  app.use(express.json()); // To get forms from EJS
  dotenv.config(); // Configuratio

  // const clientId = "dktj13anu4sv0m465jemi791c";
  // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

  const { clientId, clientSecret, rdsUsername, rdsPassword } =
    await getSecrets();
  console.log(rdsUsername, rdsPassword, clientId, clientSecret);
  await initialiseVideoTable();
  //S3 Upload
  app.post("/upload", verifyToken, async (req, res) => {
    // Return Upload Presigned URL
    const { filename } = req.body;
    //const {filename, contentType} = req.body
    const videoId = uuidv4();
    const storedFileName = `${videoId}-${Date.now()}.${filename
      .split(".")
      .pop()}`;
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: storedFileName,
        //ContentType: contentType
      });
      const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      console.log(presignedURL);
      // Store metadata in RDS
      await addVideo({
        id: videoId,
        userId: req.user.sub,
        originalFileName: filename,
        storedFileName,
        uploadTimestamp: Date.now(),
        status: "uploading",
      });
      //console.log("Received:", filename, contentType);
      res.json({ url: presignedURL, videoId });
    } catch (err) {
      console.log(err);
    }
  });

  // Get user's video history
  app.get("/videos", verifyToken, async (req, res) => {
    try {
      const videos = await getUsersVideos(req.user.sub);
      res.json(videos);
    } catch (err) {
      console.error("Error fetching videos:", err);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  // Transcode the video from S3
  app.post("/transcode", verifyToken, async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }
    try {
      const videoMetadata = await getVideo(videoId);
      console.log("VideoId:", videoId);
      console.log("Video metadata from DB:", videoMetadata);
      console.log("req.user:", req.user);
      if (!videoMetadata || videoMetadata.userid !== req.user.sub) {
        return res
          .status(403)
          .json({ error: "Video not found or unauthorized" });
      }
      const storedFileName = videoMetadata.storedfilename;
      const transcodedkey = `transcoded${storedFileName}`;
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: storedFileName,
        })
      );
      const videoStream = response.Body;
      if (!videoStream) {
        throw new Error("No video data received from S3");
      }
      const outputStream = new PassThrough();
      const uploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: transcodedkey,
          Body: outputStream,
          ContentType: "video/mp4",
        },
      });

      await updateVideoStatus(videoId, "transcoding", null);
      await new Promise((resolve, reject) => {
        ffmpeg(videoStream)
          .outputOptions("-movflags frag_keyframe+empty_moov")
          .videoCodec("libx264")
          .format("mp4")
          .on("start", (cmd) => console.log("FFmpeg started:", cmd))
          .on("error", (err) => {
            console.error("FFmpeg error:", err.message);
            updateVideoStatus(videoId, "failed", null);
            reject(err);
          })
          .on("end", () => {
            console.log("Transcoding complete");
            resolve();
          })
          .pipe(outputStream, { end: true });
      });

      await uploads3.done();

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: transcodedkey,
        ResponseContentDisposition:
          'attachment; filename="transcodedvideo.mp4"',
      });

      await updateVideoStatus(videoId, "completed", transcodedkey);
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: storedFileName,
        })
      );

      console.log("Original file deleted:", storedFileName);

      const downloadpresignedURL = await S3Presigner.getSignedUrl(
        s3Client,
        command,
        {
          expiresIn: 3600,
        }
      );
      console.log("Transcode download URL:", downloadpresignedURL);

      await updateVideoStatus(videoId, "completed", transcodedkey);

      res.json({ url: downloadpresignedURL });
    } catch (err) {
      console.error("Transcode error:", err);
      await updateVideoStatus(videoId, "failed", null);
      res.status(500).json({ error: `Transcoding failed: ${err.message}` });
    }
  });
  // this is the login thing that you should do/check/add your aws thing to!!
  app.post("/", async (req, res) => {
    const { username, password } = req.body;

    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      const result = await cognitoLogin(
        clientId,
        clientSecret,
        username,
        password
      );
      res.json({
        idToken: result.AuthenticationResult.IdToken,
        accessToken: result.AuthenticationResult.AccessToken,
        refreshToken: result.AuthenticationResult.RefreshToken,
      });
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: "Login failed" });
    }
  });

  app.post("/confirm", async (req, res) => {
    const { username, code } = req.body;
    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      await confirmWithCode(clientId, clientSecret, username, code);
      res.json({ success: true, message: "Confirmation successful" });
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: "Confirmation failed" });
    }
  });

  app.post("/register", async (req, res) => {
    const { username, password, email } = req.body;

    try {
      // const clientId = "dktj13anu4sv0m465jemi791c";
      // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

      const { clientId, clientSecret } = await getSecrets();
      await cognitoSignUp(clientId, clientSecret, username, password, email);
      res.json({
        success: true,
        message: "Registration successful, confirm your email",
      });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: "Registration failed" });
    }
  });

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

bootstrap();
