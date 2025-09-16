const express = require('express')
const multer = require('multer')
const ffmpeg = require('fluent-ffmpeg')
const bcrypt = require('bcrypt')
const passport = require('passport')
const flash = require('express-flash')
const session = require('express-session')
const dotenv = require('dotenv')
const fs = require('fs')
const path = require('path')
const initializepassport = require('./passportconfig')
//Default
const app = express()
app.set("view engine", "ejs")
app.use(express.urlencoded({ extended: true })); // To get forms from EJS
dotenv.config() // Configuratio


//wassup inhwa

/////
initializepassport(
    passport, 
    username =>  users.find(user => user.username === username),
    id => users.find(user => user.id === id),
)
app.use(flash())
app.use(session({
    secret: process.env.SESSIONKEY,
    resave: false,
    saveUninitialized: false
}))
const users =[]
app.use(passport.initialize())
app.use(passport.session())
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
app.get('/upload', checkauthenticated,(req,res) =>{
    res.render("upload")
})

//Upload Video Transcoding, Used AI to find the ffmpeg setting to create high CPU usage.
app.post('/upload', checkauthenticated,upload.single("video"), (req,res)=>{
    const inputpath = req.file.path
    const outputfilename = req.body.filename + '.mp4'
    const outputpath = `upload/${outputfilename}`
    ffmpeg(inputpath)
    .output(outputpath)
    //.videoCodec('libx264') //LOW CPU TESTING
    .videoCodec('libx265')
    .audioCodec('aac')
    .videoBitrate('1000k')//10000Max
    //.audioBitrate('192k') 
    //.size('3480x2160')
    .addOptions([
    '-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
    //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
    ])
    .on('end', () => {
    console.log('Transcoding complete.');
    fs.unlinkSync(inputpath)
    res.render('download', { downloadPath: `/download/${outputfilename}` });
    })
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    })
    .run();
})

// Download
app.get('/download/:filename', checkauthenticated,(req, res) => {
  const filepath = path.join(__dirname, 'upload', req.params.filename);
  res.download(filepath);
});











//Login
app.get('/', checknotauthenticated,(req, res)=>{    
    res.render("login")
})

app.post('/', checknotauthenticated,passport.authenticate('local',{
    successRedirect:'/upload',
    failureRedrect:'/login',
    failureFlash:true
}),(req, res)=>{
    res.render("upload")
})






//Register
app.get('/register',checknotauthenticated ,(req, res)=>{    
    res.render("register")
})

app.post('/register',checknotauthenticated,async(req, res)=>{
    try {
        const hashedpassword = await bcrypt.hash(req.body.password,10)
        users.push({
            id: Date.now().toString(),
            username: req.body.username,
            password: hashedpassword,
        })
        res.redirect('/')
    } catch (error) {
        res.redirect('/register')
    }
    console.log(users)

})








function checkauthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }

  res.redirect('/login')
}

function checknotauthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/')
  }
  next()
}



//Default
app.listen(3000)
console.log("Port Connected")