const express = require('express');
const router = express.Router();

const Cognito = require("@aws-sdk/client-cognito-identity-provider");
const crypto = require("crypto");

const clientId = "dktj13anu4sv0m465jemi791c";
const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"


// create a bash64 HMAC-SHA256 hash of username and client id for Amazon Cognito
const generateSecretHash = (clientId, clientSecret, userName) => {

    // initialise the hasher, with the client's secret being the key
    const hasher = crypto.createHmac("sha256",  clientSecret)

    // hash the client ID and the user's username as the secret and return
    const message = `${userName}${clientID}`
    hasher.update(message);

    return hasher.digest('base64')
    
}

const cognitoSignUp = async () => {
    // initialise a cognito identity provider client and create a new cognito command
    const client = new Cognito.CognitoIdentityProviderClient({region: 'ap-southeast-2'})

    const commant = new Cognito.SignUpCommand({
        ClientId: clientId,
        SecretHash: secretHash(clientId, clientSecret, username),
        Username: username,
        Password: password,
        UserAttributes: [{ Name: "email", Value: email }],
    })

    const res = await client.send(command);
    console.log(res)
}


module.exports = {generateSecretHash, cognitoSignUp}

