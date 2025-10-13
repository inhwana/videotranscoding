const express = require("express");
const router = express.Router();

const Cognito = require("@aws-sdk/client-cognito-identity-provider");
const jwt = require("aws-jwt-verify");
const crypto = require("crypto");
const { getSecrets } = require("./secrets.js");
const { getParameters } = require("./parameters.js");

// create a bash64 HMAC-SHA256 hash of username and client id for Amazon Cognito
const generateSecretHash = (clientId, clientSecret, userName) => {
  // initialise the hasher, with the client's secret being the key
  const hasher = crypto.createHmac("sha256", clientSecret);

  // hash the client ID and the user's username as the secret and return
  const message = `${userName}${clientId}`;
  hasher.update(message);

  return hasher.digest("base64");
};

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const { clientId } = await getSecrets();
  const { userPoolId } = await getParameters();
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const verifier = jwt.CognitoJwtVerifier.create({
      userPoolId: userPoolId,
      tokenUse: "id",
      clientId: clientId,
    });
    const payload = await verifier.verify(token);
    req.user = payload;
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = {
  generateSecretHash,
  cognitoSignUp,
  cognitoLogin,
  confirmWithCode,
  verifyToken,
};
