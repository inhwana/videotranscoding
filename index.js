const express = require('express')
const multer = require('multer')
const ffmpeg = require('fluent-ffmpeg')
const session = require('express-session')
const dotenv = require('dotenv')
const fs = require('fs')
const path = require('path')
const S3 = require("@aws-sdk/client-s3") // AWS S3
const bucketName = 'n10851879-test' // Test Bucket Name
const SecretsManager = require("@aws-sdk/client-secrets-manager");
const { cognitoSignUp } = require("./auth.js")

// router for routes


//Default
const app = express()
app.set("view engine", "ejs")
app.use(express.urlencoded({ extended: true })); // To get forms from EJS
dotenv.config() // Configuratio



/////


// hi inhwa


//Multer
const storage = multer.diskStorage({
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
if(!fs.existsSync("upload")){fs.mkdirSync("upload")}






//Upload page
app.get('/upload',(req,res) =>{
    res.render("upload")
})

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

function checkauthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next()
  }

  res.redirect('/login')
}

function checknotauthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/upload')
  }
  next()
}


// Download
app.get('/download/:filename',(req, res) => {
  const filepath = path.join(__dirname, 'upload', req.params.filename);
  res.download(filepath);
});


//Login
app.get('/',(req, res)=>{    
    res.render("login")
})

// this is the login thing that you should do/check/add your aws thing to!!
app.post('/', ),(req, res)=>{
    res.render("upload")

}


//Register
app.get('/register' ,(req, res)=>{    
    res.render("register")
})

app.post('/register', async(req, res)=>{
    const {username, password, email} = req.body;
    try {

        cognitoSignUp(username, password, email)
      
        res.redirect('/')
    } catch (error) {
        res.redirect('/register')
    }
    console.log(users)

})











const client = new SecretsManager.SecretsManagerClient({
    region: "ap-southeast-2"
})



const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

// store secrets in memory!
let clientSecret;
let clientId;

const getSecrets = async () => { 
    try {
        const secretCommand = new GetSecretValueCommand({ SecretId: "n11908157-secretForClient" })
        const secretResponse = await client.send(secretCommand)
        clientSecret = secretResponse.SecretString;


        const idCommand = new GetSecretValueCommand({ SecretId: "n11908157-clientId" })
        const idResponse = await client.send(idCommand)
        clientId = idResponse.SecretString;

        console.log("fetched secrets!!")
    }
    catch (err) {
        console.error(err);
        process.exit(1)

    }
   
}


async function getClientSecret() {
    try {
        response = await client.send(
            new SecretsManager.GetSecretValueCommand({
                SecretId: "n11908157-secretForClient"
            })
        )
        clientSecret = response.SecretString;
        console.log(clientSecret)
    }
    catch(error) {
        console.log(error)
    }
}



async function getClientId() {
    try {
        response = await client.send(
            new SecretsManager.GetSecretValueCommand({
                SecretId: "n11908157-clientId"
            })
        )
        clientId = response.SecretString;
        console.log(clientId)
    }
    catch(error) {
        console.log(error)
    }
}


//Default
// app.listen(3000, () => {
//     getClientSecret();
//     getClientId();
// })
// console.log("Port Connected")

async function startServer() {
  await getSecrets();

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