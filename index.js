const express = require('express')
const multer = require('multer')
const ffmpeg = require('fluent-ffmpeg')
const session = require('express-session')
const dotenv = require('dotenv')
const fs = require('fs')
const path = require('path')

//AWS S3
const S3 = require("@aws-sdk/client-s3") // AWS S3
const S3Presigner = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage")
const { PassThrough } = require('stream');
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const bucketName = 'n10851879-test' // Test Bucket Name
s3Client = new S3.S3Client({ region: 'ap-southeast-2'})

//AWS Secrets
const SecretsManager = require("@aws-sdk/client-secrets-manager");
const { cognitoSignUp } = require("./auth.js")
const { getSecrets } = require("./secrets.js")

// router for routes// Delete this line maybe...


//Default
const app = express()
app.set("view engine", "ejs")
app.use(express.urlencoded({ extended: true })); // To get forms from EJS
dotenv.config() // Configuratio
app.use(express.json()) // For parsing json


//Multer
/*const storage = multer.diskStorage({
    destination: (req, file, cb) =>{
        cb(null, 'upload')
    },
    filename: (req, file, cb) => {
        console.log(file)
        cb(null, Date.now() + path.extname(file.originalname))
    }
})
const upload = multer({storage: storage})

//Create uplaod file if doesnt exist
if(!fs.existsSync("upload")){fs.mkdirSync("upload")}*/






//Upload page
app.get('/upload',(req,res) =>{
    res.render("upload")
})

//S3 Upload
app.post('/upload',checkauthenticated, async (req,res)=>{
    // Return Upload Presigned URL
    const {filename} = req.body
    //const {filename, contentType} = req.body
    try {
        const command = new S3.PutObjectCommand({
                Bucket: bucketName,
                Key: filename,
                //ContentType: contentType
            });
        const presignedURL = await S3Presigner.getSignedUrl(s3Client, command, {expiresIn: 3600} );
        console.log(presignedURL);
        //console.log("Received:", filename, contentType);
        res.json({url :presignedURL})
    } catch (err) {
        console.log(err);
    }
})

// Transcode the video from S3
app.post('/transcode',checkauthenticated, async (req,res) =>{
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
    .on('start', cmd => console.log('FFmpeg started:', cmd))
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    return;
    })
    .on('end', ()=>{
        console.log("Transcoding Complete")
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
    console.log(downloadpresignedURL)

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

/*
//Upload Video Transcoding, Used AI to find the ffmpeg setting to create high CPU usage.
app.post('/upload',upload.single("video"), (req,res)=>{
    const inputpath = req.file.path
    const outputfilename = req.body.filename + '.mp4'
    const outputpath = `upload/${outputfilename}`
    ffmpeg(inputpath)
    .output(outputpath)
    .videoCodec('libx264') //LOW CPU TESTING
    //.videoCodec('libx265') UNCOMMENT
    //.audioCodec('aac') UNCOMMENT
    //.videoBitrate('1000k')//10000Max UNCOMMENT
    //.audioBitrate('192k') 
    //.size('3480x2160')
    // .addOptions([ UNCOMMENT
    // '-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
    // //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
    // ])
    .on('end', async() => {
    console.log('Transcoding complete.');
    fs.unlinkSync(inputpath)
    const filestream = fs.createReadStream(outputpath)
    s3Client = new S3.S3Client({ region: 'ap-southeast-2' });
    try {
    const response = await s3Client.send(
        new S3.PutObjectCommand({
            Bucket: bucketName,
            Key: outputfilename,
            Body: filestream
        })
    );
    console.log(response);
    } catch (err) {
        console.log(err);
    }
    res.render('download', { downloadPath: `/download/${outputfilename}` });
    })
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    })
    .run();
})

// function checkauthenticated(req, res, next) {
//   if (req.session && req.session.user) {
//     return next()
//   }

//   res.redirect('/login')
// }

// function checknotauthenticated(req, res, next) {
//   if (req.session && req.session.user) {
//     return res.redirect('/upload')
//   }
//   next()
// }


// Download
app.get('/download/:filename',(req, res) => {
  const filepath = path.join(__dirname, 'upload', req.params.filename);
  res.download(filepath);
});
*/

//Login
app.get('/',(req, res)=>{    
    res.render("login")
})

// this is the login thing that you should do/check/add your aws thing to!!
app.post('/',(req, res)=>{
    res.render("upload")

})


//Register
app.get('/register' ,(req, res)=>{    
    res.render("register")
})

app.post('/register', async(req, res)=>{
    const {username, password, email} = req.body;
    console.log("Password received:", password);
    console.log("Length:", password.length);
    console.log("Has uppercase:", /[A-Z]/.test(password));
    console.log("Has lowercase:", /[a-z]/.test(password));
    console.log("Has number:", /[0-9]/.test(password));
    console.log("Has special:", /[^A-Za-z0-9]/.test(password));

    try {
        // const clientId = "dktj13anu4sv0m465jemi791c";
        // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"

        const {clientId, clientSecret} = await getSecrets();
        await cognitoSignUp(clientId, clientSecret, username, password, email)
      
        // res.redirect('/')
    } catch (error) {
        console.log(error)
        // res.redirect('/register')
    }


})













//Default
// app.listen(3000, () => {
//     getClientSecret();
//     getClientId();
// })
// console.log("Port Connected")

async function startServer() {
  const { clientId, clientSecret } = await getSecrets(); // <-- destructure from result

    // const clientId = "dktj13anu4sv0m465jemi791c";
    // const clientSecret = "6stus15j84852ob1064hfepfchosrgk65231fanpqjq8qr03qo6"


  // Configure session middleware with the clientSecret
  app.use(session({
    secret: clientSecret,   // <-- important!
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // change to true if using HTTPS
  }));

 


  app.get('/', (req, res) => {
    res.send(`ClientId: ${clientId}`);
  });

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

startServer();

