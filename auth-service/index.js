// Import all the packages and relevant functions from them
const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");
const { AssemblyAI } = require("assemblyai");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

// import functions from the gemini module
const { model, initialiseGemini } = require("./gemini.js");

// functions from the auth module
const {
  cognitoSignUp,
  cognitoLogin,
  confirmWithCode,
  verifyToken,
} = require("./auth.js");

// functions from the secrets module
const { getSecrets } = require("./secrets.js");

// functions from the db module

// functions from the cache module

// parameters module
const { getParameters } = require("./parameters.js");

// Function which basically contains the whole functionality of the app
async function bootstrap() {
  // create new express app and use json
  const app = express();
  app.use(express.json());

  // initialise a new S3 client
  const s3Client = new S3Client({ region: "ap-southeast-2" });

  // get parameters and secrets
  const { bucketName, presignedUrlExpiry } = await getParameters();
  const { clientId, clientSecret, assemblyApiKey } = await getSecrets();

  // initialise memCache, the video table, and gemini model

  // login endpoint
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    // call pre-defied cognitoLogin function
    try {
      const result = await cognitoLogin(
        clientId,
        clientSecret,
        username,
        password
      );

      // send back the tokens!!
      res.json({
        idToken: result.AuthenticationResult.IdToken,
        accessToken: result.AuthenticationResult.AccessToken,
        refreshToken: result.AuthenticationResult.RefreshToken,
      });
    } catch (error) {
      // log the error
      console.log(error);
      res.status(400).json({ error: "Login failed" });
    }
  });

  // endpoint for users to confirm their email
  app.post("/confirm", async (req, res) => {
    // use confirm with code
    const { username, code } = req.body;
    try {
      // const { clientId, clientSecret } = await getSecrets();
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

  app.get("/health", (req, res) => res.sendStatus(200));

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

bootstrap();
