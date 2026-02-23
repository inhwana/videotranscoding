//const express = require('express')
const ffmpeg = require('fluent-ffmpeg')
const S3 = require("@aws-sdk/client-s3");
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage")
const { PassThrough } = require('stream');
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");

//SQS
const SQS = require("@aws-sdk/client-sqs");
//const sqsQueueUrl = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/n10851879-test-queue";
//New mannyinhwa sqsURL
const sqsQueueUrl = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/manny-inhwa-transcode-queue";



const client = new SQS.SQSClient({
  region: "ap-southeast-2",
});


//AWS
const bucketName = 'n10851879-test'
s3Client = new S3.S3Client({ region: 'ap-southeast-2'})




// Read Messgae from queue

async function main() {

   
  try{
    const receiveCommand = new SQS.ReceiveMessageCommand({
      MaxNumberOfMessages: 1,
      QueueUrl: sqsQueueUrl,
      WaitTimeSeconds: 20, // how long to wait for a message before returning if none.
      VisibilityTimeout: 20, // overrides the default for the queue?  
   });


    const receiveResponse = await client.send(receiveCommand);
    console.log("Receiving a message", receiveResponse);

    // If there are no messages then you'll still get a result back.
    Messages = receiveResponse.Messages;
    if (!Messages) {
       console.log("No messages");
       return;
    }



    // Retrieve the first message from the body
    console.log("Message contents:", Messages[0].Body);
    const body = JSON.parse(Messages[0].Body);
    //const filename = body.filename
    const videoId = body.videoId;
    const inputKey = body.storedFileName; 
    //console.log("the input key is:" + inputKey)
    //const tasktype = body.taskType;



    //console.log("Filename " +  filename)
    //await transcode(filename);
  
        await transcode(inputKey, videoId)
        await new Promise(resolve => setTimeout(resolve, 20000));
    // for (const message of data.Messages) {
    //   const body = JSON.parse(message.Body);
    //   const s3Key = body.s3Key;

    // Delete the message after dealt with.
   const deleteCommand = new SQS.DeleteMessageCommand({
      QueueUrl: sqsQueueUrl,
      ReceiptHandle: Messages[0].ReceiptHandle,
   });
   const deleteResponse = await client.send(deleteCommand);
   console.log("Deleting the message", deleteResponse);
  }catch(error){ 
    console.log(error)
  }  
}






async function transcode(inputKey, videoId){
    // Get from S3
    //let transcodedkey = `transcoded${inputKey}`
    let response
    try {
        response = await s3Client.send(
            new S3.GetObjectCommand({
                Bucket: bucketName,
                Key: inputKey,
            }))
    const video = response.Body

    const videostream = new PassThrough()
    let outputKey = inputKey.replace(/.[^/.]+$/, ".mp4");
    console.log("Transcoding outputkey: " + outputKey)


    //Creating Upload, uploading mp4 video
    const uploads3 = new Upload({
        client: s3Client,
        params: {
            Bucket: bucketName,
            Key: outputKey,
            Body: videostream,
            ContentType: 'video/mp4'
        }
    })

    // Transcoding Using FFMPEG
    ffmpeg(video)
    .outputOptions('-movflags frag_keyframe+empty_moov') // Used because MP4 does not work well with streams
    //.addOption('-preset', 'slow')
    .videoCodec('libx265')
    .audioCodec('aac')
    .videoBitrate('10000k')
    .format('mp4')
    .on('error', (err) => {
    console.error('Error:', err.message);
    return;
    })
    .pipe(videostream, {end: true})

    // Start Uploading
    await uploads3.done()




    



    // Delete Original Video    
    const data = await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: inputKey
    }));
    console.log("Success. Object deleted.", data);
    // Delete Original Video



    

    //Metadata with manny 
    const metadataUpdateResponse = await fetch(
        `http://manny-metadata-balancer-1636907737.ap-southeast-2.elb.amazonaws.com:3000/videos/${videoId}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "transcoded", outputFileName: outputKey }),
        }
      );
     if(!metadataUpdateResponse.ok)
     {
        throw new Error("Failed to update video metadata status")
     }

    }catch (err) {
        console.log(err);
    }


}



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async function loop() {
    while (true) {
      await main();
      await sleep(5000); // wait 5 seconds before polling again
    }
  }
loop();
