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











const cognitoSignUp = async (
  clientId,
  clientSecret,
  username,
  password,
  email
) => {
  // initialise a cognito identity provider client and create a new cognito command
  const client = new Cognito.CognitoIdentityProviderClient({
    region: "ap-southeast-2",
  });

  const command = new Cognito.SignUpCommand({
    ClientId: clientId,
    SecretHash: generateSecretHash(clientId, clientSecret, username),
    Username: username,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });

  const res = await client.send(command);
  console.log(res);
};

const confirmWithCode = async (
  clientId,
  clientSecret,
  username,
  confirmationCode
) => {
  const client = new Cognito.CognitoIdentityProviderClient({
    region: "ap-southeast-2",
  });
  const command2 = new Cognito.ConfirmSignUpCommand({
    ClientId: clientId,
    SecretHash: generateSecretHash(clientId, clientSecret, username),
    Username: username,
    ConfirmationCode: confirmationCode,
  });

  const res2 = await client.send(command2);
  console.log(res2);
};

let idVerifier;
const cognitoLogin = async (clientId, clientSecret, username, password) => {
  //PRAC
  const client = new Cognito.CognitoIdentityProviderClient({
    region: "ap-southeast-2",
  });

  // Actual Login (PRAC)
  const command = new Cognito.InitiateAuthCommand({
    AuthFlow: Cognito.AuthFlowType.USER_PASSWORD_AUTH,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
      SECRET_HASH: generateSecretHash(clientId, clientSecret, username),
    },
    ClientId: clientId, // Which cognito app client to use aws console.
  });
 // Send login request to cognito
 // Res is the respond
 const res = await client.send(command);
 console.log(res);
  
 if (res.ChallengeName === "EMAIL_MFA")
  {
    return {
      ChallengeName: res.ChallengeName,
      Session: res.Session,
      Username: username
    }
  }
}
/*const cognitoLogin = async (clientId, clientSecret, username, password) => {
  const client = new Cognito.CognitoIdentityProviderClient({
    region: "ap-southeast-2",
  });

  if (!idVerifier) {
    idVerifier = jwt.CognitoJwtVerifier.create({
      userPoolId: "ap-southeast-2_VOCBnVFNo",
      tokenUse: "id",
      clientId: clientId,
    });
  }

  const command = new Cognito.InitiateAuthCommand({
    AuthFlow: Cognito.AuthFlowType.USER_PASSWORD_AUTH,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
      SECRET_HASH: generateSecretHash(clientId, clientSecret, username),
    },
    ClientId: clientId,
  });

  const res = await client.send(command);
  console.log(res);

  const IdToken = res.AuthenticationResult.IdToken;
  const IdTokenVerifyResult = await idVerifier.verify(IdToken);
  console.log(IdTokenVerifyResult);

  return res;
};*/


const mfaconfirm = async(clientId, clientSecret,code, challengeName) =>{
  const command = new Cognito.RespondToAuthChallengeCommandInput({
    ChallengeName:challengeName,
    ClientId:clientId,
    ChallengeResponses:[{EMAIL_MFA_CODE: code,USERNAME: username}]
  });
  
  const res = await client.send(command);
   // TOKEN RESPONSE
   const IdToken = res.AuthenticationResult.IdToken; // This is the output of only a small part
   const IdTokenVerifyResult = await idVerifier.verify(IdToken);
   console.log(IdTokenVerifyResult);
   return res
  
  }







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
  mfaconfirm
}
