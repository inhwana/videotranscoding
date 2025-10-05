SSM = require("@aws-sdk/client-ssm");

const parameterName = "/n11908157/bucket_name";
const client = new SSM.SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    response = await client.send(
      new SSM.GetParameterCommand({
        Name: parameterName,
      })
    );

    console.log(response.Parameter.Value);
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
