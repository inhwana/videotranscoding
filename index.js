const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

//AWS S3
const S3 = require("@aws-sdk/client-s3"); // AWS S3
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const bucketName = "n10851879-test"; // Test Bucket Name
s3Client = new S3.S3Client({ region: "ap-southeast-2" });

//AWS Secrets
const SecretsManager = require("@aws-sdk/client-secrets-manager");
const { cognitoSignUp, cognitoLogin, confirmWithCode } = require("./auth.js");
const { getSecrets } = require("./secrets.js");

const cors = require("cors");

async function bootstrap() {
  //Default
  const app = express();

  app.use(express.json()); // To get forms from EJS
  dotenv.config(); // Configuratio

  // const clientId = "dktj13anu4sv0m465jemi791c";
  // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

  const { clientId, clientSecret } = await getSecrets();

  //S3 Upload
  app.post("/upload", async (req, res) => {
    // Return Upload Presigned URL
    const { filename } = req.body;
    //const {filename, contentType} = req.body
    try {
      const command = new S3.PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        //ContentType: contentType
      });
      const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      console.log(presignedURL);
      //console.log("Received:", filename, contentType);
      res.json({ url: presignedURL });
    } catch (err) {
      console.log(err);
    }
  });

  // Transcode the video from S3
  app.post("/transcode", async (req, res) => {
    const { filename } = req.body;
    let transcodedkey = `transcoded${filename}`;
    let S3Object;

    // Create and send a command to read an object, Download the video from S3
    try {
      S3Object = await s3Client.send(
        new S3.GetObjectCommand({
          Bucket: bucketName,
          Key: filename,
        })
      );

      console.log("S3 Object:", S3Object);

      const videoStream = new PassThrough();
      S3Object.Body.pipe(videostream);

      const outputStream = new PassThrough();

      //Creating Upload, uploading mp4 video
      const uploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: transcodedkey,
          Body: videostream,
          ContentType: "video/mp4",
        },
      });

      // Transcoding Using FFMPEG
      // Wrap in a promise so we can wait for ffmpeg completion
      await new Promise((resolve, reject) => {
        ffmpeg(videoStream)
          .outputOptions("-movflags frag_keyframe+empty_moov")
          .videoCodec("libx264")
          .format("mp4")
          .on("start", (cmd) => console.log("FFmpeg started:", cmd))
          .on("error", (err) => {
            console.error("FFmpeg error:", err.message);
            reject(err);
          })
          .on("end", () => {
            console.log("Transcoding Complete");
            resolve();
          })
          .pipe(outputStream, { end: true });
      });

      // Start Uploading
      await uploads3.done();

      // Create a pre-signed URL for reading an object
      const command = new S3.GetObjectCommand({
        Bucket: bucketName,
        Key: transcodedkey,
        ResponseContentDisposition:
          'attachment; filename="transcodedvideo.mp4"', // Used for directly downloading from presigned URL
      });
      const downloadpresignedURL = await S3Presigner.getSignedUrl(
        s3Client,
        command,
        { expiresIn: 3600 }
      );
      res.json({ url: downloadpresignedURL });
      console.log(downloadpresignedURL);

      // Delete Original Video
      const data = await s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: filename,
        })
      );
      console.log("Success. Object deleted.", data);
      // Delete Original Video
    } catch (err) {
      console.log(err);
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
