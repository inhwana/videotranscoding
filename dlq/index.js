const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

exports.handler = async (event) => {
  for (const record of event.Records) {
    try {
      const failMessage = JSON.parse(record.body);
      console.log("DLQ message:", failMessage);

      console.log(
        "Message:",
        record.messageId,
        "Number of attempts:",
        record.attributes.ApproximateReceiveCount
      );
    } catch (err) {
      console.error("Error processing DLQ message:", err);
      throw err;
    }
  }
};
