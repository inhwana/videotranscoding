const SecretsManager = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManager.SecretsManagerClient({
    region: "ap-southeast-2"
})



const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

// store secrets in memory!
let clientSecret;
let clientId;

const getSecrets = async () => { 
    try {
        const secretCommand = new GetSecretValueCommand({ SecretId: "n11908157-secretForClient" })
        const secretResponse = await client.send(secretCommand)
        clientSecret = secretResponse.SecretString;


        const idCommand = new GetSecretValueCommand({ SecretId: "n11908157-clientId" })
        const idResponse = await client.send(idCommand)
        clientId = idResponse.SecretString;

        console.log("fetched secrets!!")
    }
    catch (err) {
        console.error(err);
        process.exit(1)

    }
   
}

module.exports = {clientId, clientSecret, getSecrets}