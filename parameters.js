SSM = require("@aws-sdk/client-ssm");

const parameterName = "/n11908157/bucket_name";
const demoParameterName = "/n11908157/demo";
const client = new SSM.SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    response = await client.send(
      new SSM.GetParametersCommand({
        Names: [parameterName, demoParameterName],
      })
    );

    console.log(response.Parameters);
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
