const SecretsManager = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManager.SecretsManagerClient({
  region: "ap-southeast-2",
});

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

// store secrets in memory!
let clientSecret;
let clientId;

let cachedSecrets = null;
const getSecrets = async () => {
  if (cachedSecrets) return cachedSecrets;

  try {
    const secretCommand = new GetSecretValueCommand({
      SecretId: "n11908157-secretForClient",
    });
    const secretResponse = await client.send(secretCommand);
    const parsedSecret = JSON.parse(secretResponse.SecretString);
    clientSecret = parsedSecret.clientSecret;

    const idCommand = new GetSecretValueCommand({
      SecretId: "n11908157-clientId",
    });
    const idResponse = await client.send(idCommand);
    const parsedId = JSON.parse(idResponse.SecretString);
    clientId = parsedId.clientId;

    const rdsCommand = new GetSecretValueCommand({
      SecretId: "n11908157-rds-credentials",
    });

    const rdsResponse = await client.send(rdsCommand);

    const parsedRds = JSON.parse(rdsResponse.SecretString);
    const rdsUsername = parsedRds.username;
    const rdsPassword = parsedRds.password;

    return (cachedSecrets = {
      clientSecret,
      clientId,
      rdsUsername,
      rdsPassword,
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

module.exports = { getSecrets };
