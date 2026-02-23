const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const client = new SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    const response = await client.send(
      new GetParametersCommand({ Names: ["/n11908157/user-pool-id"] })
    );
    return { userPoolId: response.Parameters[0].Value };
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
