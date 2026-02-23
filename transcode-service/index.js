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


//Default
// const app = express ();
// app.use(express.static('client'));
// app.use(express.json()) // For parsing json

//AWS
const bucketName = 'n10851879-test'
const s3Client = new S3.S3Client({ region: 'ap-southeast-2'})




// Read Messgae from queue

async function main() {

    /* Practical Example
   // Receive a message from the queue
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

   // Delete the message after dealt with.
   const deleteCommand = new SQS.DeleteMessageCommand({
      QueueUrl: sqsQueueUrl,
      ReceiptHandle: Messages[0].ReceiptHandle,
   });
   const deleteResponse = await client.send(deleteCommand);
   console.log("Deleting the message", deleteResponse);
   */
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
    const tasktype = body.taskType;



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

    /*
    // Create a pre-signed URL for reading an object
    const command = new S3.GetObjectCommand({
            Bucket: bucketName,
            Key: transcodedkey,
            ResponseContentDisposition: 'attachment; filename="transcodedvideo.mp4"', // Used for directly downloading from presigned URL
        });
    const downloadpresignedURL = await S3Presigner.getSignedUrl(s3Client, command, {expiresIn: 3600} );
    res.json({url :downloadpresignedURL})*/




    



    // Delete Original Video    
    // const data = await s3Client.send(new DeleteObjectCommand({
    //     Bucket: bucketName,
    //     Key: inputKey
    // }));
    // console.log("Success. Object deleted.", data);
    // Delete Original Video





    

    //Metadata with manny 
    const metadataUpdateResponse = await fetch(
        //`http://ec2-54-252-191-77.ap-southeast-2.compute.amazonaws.com:3000/videos/${videoId}/status`,
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






/*
    // Transcode using S3
    ffmpeg(video)
    .output(outputpath)
    .videoCodec('libx264') //LOW CPU TESTING
    //.videoCodec('libx265')
    //.audioCodec('aac')
    //.videoBitrate('1000k')//10000Max
    //.addOptions([
    //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
    //])
    .on('end', () => {
    console.log('Transcoding complete.');
    fs.unlinkSync(inputpath)
    })
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    })
    .run();}



    catch (err) {
        console.log(err);
    }
*/


    // Upload to New S3




    // OR send Message to API





    // OR Send Pre Signed URL(Donwload) to MAIN API 



}


//main()
// async function loop() {
//   while (true) {
//     await main();
//   }
// }








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









/*

// Transcode the video from S3
app.post('/transcode', async (req,res) =>{
    const {filename} = req.body
    let transcodedkey = `transcoded${filename}`
    let response

    // Create and send a command to read an object, Download the video from S3
    try {
        response = await s3Client.send(
            new S3.GetObjectCommand({
                Bucket: bucketName,
                Key: filename,
            }))
    const video = response.Body
    const videostream = new PassThrough()

    //Creating Upload, uploading mp4 video
    const uploads3 = new Upload({
        client: s3Client,
        params: {
            Bucket: bucketName,
            Key:transcodedkey,
            Body: videostream,
            ContentType: 'video/mp4'
        }
    })

    // Transcoding Using FFMPEG
    ffmpeg(video)
    .outputOptions('-movflags frag_keyframe+empty_moov') // Used because MP4 does not work well with streams
    .videoCodec('libx264')
    .format('mp4')
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    return;
    })
    .pipe(videostream, {end: true})

    // Start Uploading
    await uploads3.done()

    // Create a pre-signed URL for reading an object
    const command = new S3.GetObjectCommand({
            Bucket: bucketName,
            Key: transcodedkey,
            ResponseContentDisposition: 'attachment; filename="transcodedvideo.mp4"', // Used for directly downloading from presigned URL
        });
    const downloadpresignedURL = await S3Presigner.getSignedUrl(s3Client, command, {expiresIn: 3600} );
    res.json({url :downloadpresignedURL})

    // Delete Original Video    
    const data = await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: filename
    }));
    console.log("Success. Object deleted.", data);
    // Delete Original Video 

    }catch (err) {
        console.log(err);
    }
})

     

// const PORT = 3000
// app.listen(PORT, ()=>{
//     console.log("Server listening on PORT:", PORT)
// })*/