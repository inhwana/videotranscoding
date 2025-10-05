SSM = require("@aws-sdk/client-ssm");

const parameterNames = [
  "/n11908157/bucket_name",
  "/n11908157/presigned-url-expiry",
  "/n11908157/user-pool-id",
  "/n11908157/memcached-address",
];

const client = new SSM.SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    response = await client.send(
      new SSM.GetParametersCommand({
        Names: parameterNames,
      })
    );

    const params = {};

    for (const param of response.Parameters) {
      params[param.Name] = param.Value;
    }

    const bucketName = params["/n11908157/bucket_name"];
    const presignedUrlExpiry = parseInt(
      params["/n11908157/presigned-url-expiry"],
      10
    );

    const userPoolId = params["/n11908157/user-pool-id"];

    const memcachedAddress = params["/n11908157/memcached-address"];
    console.log(bucketName, presignedUrlExpiry);
    return { bucketName, presignedUrlExpiry, userPoolId, memcachedAddress };
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
