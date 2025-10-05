SSM = require("@aws-sdk/client-ssm");

const parameterNames = [
  "/n11908157/bucket_name",
  "/n11908157/presigned-url-expiry",
];

const client = new SSM.SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    response = await client.send(
      new SSM.GetParametersCommand({
        Names: [parameterNames],
      })
    );

    const params = {};

    for (const param of response.Parameters) {
      params[param.Name] = param.Value;
    }

    const bucketName = param["/n11908157/bucket_name"];
    const presignedUrlExpiry = parseInt(
      params["/n11908157/presigned-url-expiry"],
      10
    );
    console.log(bucketName, presignedUrlExpiry);
    return { bucketName, presignedUrlExpiry };
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
