SSM = require("@aws-sdk/client-ssm");

const client = new SSM.SSMClient({ region: "ap-southeast-2" });

async function getParameters() {
  try {
    response = await client.send(
      new SSM.GetParametersCommand({ Names: ["/n11908157/user-pool-id"] })
    );
    return { userPoolId: response.Parameters[0].Value };
  } catch (error) {
    console.log(error);
  }
}

module.exports = { getParameters };
