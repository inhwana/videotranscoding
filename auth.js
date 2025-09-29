const express = require('express');
const router = express.Router();

const Cognito = require("@aws-sdk/client-cognito-identity-provider");
const crypto = require("crypto");



// create a bash64 HMAC-SHA256 hash of username and client id for Amazon Cognito
const generateSecretHash = (clientId, clientSecret, userName) => {

    // initialise the hasher, with the client's secret being the key
    const hasher = crypto.createHmac("sha256",  clientSecret)

    // hash the client ID and the user's username as the secret and return
    const message = `${userName}${clientId}`
    hasher.update(message);

    return hasher.digest('base64')
    
}

const cognitoSignUp = async (clientId, clientSecret, username, password, email) => {
    // initialise a cognito identity provider client and create a new cognito command
    const client = new Cognito.CognitoIdentityProviderClient({region: 'ap-southeast-2'})

    const command = new Cognito.SignUpCommand({
        ClientId: clientId,
        SecretHash: generateSecretHash(clientId, clientSecret, username),
        Username: username,
        Password: password,
        UserAttributes: [{ Name: "email", Value: email }],
    })

    const res = await client.send(command);
    console.log(res)
}


module.exports = {generateSecretHash, cognitoSignUp}

