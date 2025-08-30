const express = require('express')
const multer = require('multer')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')
//Default
const app = express()
app.set("view engine", "ejs")

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
app.get('/', (req,res) =>{
    res.render("index")
})














// //F1
// app.post('/', upload.single("video"), (req,res)=>{
//     const inputpath = req.file.path
//     const outputfilename = req.body.filename + '.mp4'
//     const outputpath = path.join('upload', outputfilename)
//     ffmpeg(inputpath)
//     .output(outputpath)
//     //.videoCodec('libx264') LOW CPU TESTING
//     .videoCodec('libx265')
//     //.audioCodec('aac')
//     //.videoBitrate('10000k')
//     //.audioBitrate('192k') 
//     //.size('3480x2160')
//     //.addOptions([
//     //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
//     //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
//     //])
//     .on('end', () => {
//     console.log('Transcoding complete.');
//     fs.unlinkSync(inputpath)
//     res.redirect('/download')
//     })
//     .on('error', (err) => {
//     console.error('Error:', err.message);
//     res.status(500).send("Transcoding Failed :(")
//     })
//     .run();
// })

// //Download page 
// app.get('/download', (req,res)=>{
//     res.render(download)
// })
// //app.post()






//F2 Works
// app.post('/', upload.single("video"), (req,res)=>{
//     const inputpath = req.file.path
//     const outputfilename = req.file.filename.split('.')[0] + '.mp4';
//     const outputpath = `converted/${req.file.filename}.mp4`;
//     ffmpeg(inputpath)
//     .output(outputpath)
//     //.videoCodec('libx264') LOW CPU TESTING
//     .videoCodec('libx265')
//     //.audioCodec('aac')
//     //.videoBitrate('10000k')
//     //.audioBitrate('192k') 
//     //.size('3480x2160')
//     //.addOptions([
//     //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
//     //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
//     //])
//     .on('end', () => {
//     console.log('Transcoding complete.');
//     fs.unlinkSync(inputpath)
//     res.render('success', { downloadPath: `/download/${req.file.filename}.mp4` });
//     })
//     .on('error', (err) => {
//     console.error('Error:', err.message);
//     res.status(500).send("Transcoding Failed :(")
//     })
//     .run();
// })

// app.get('/download/:filename', (req, res) => {
//   const filePath = path.join(__dirname, 'converted', req.params.filename);
//   res.download(filePath);
// });





//Final3
app.post('/', upload.single("video"), (req,res)=>{
    const inputpath = req.file.path
    const outputfilename = req.body.filename + '.mp4'
    const outputpath = `upload/${outputfilename}`
    ffmpeg(inputpath)
    .output(outputpath)
    //.videoCodec('libx264') LOW CPU TESTING
    .videoCodec('libx265')
    //.audioCodec('aac')
    //.videoBitrate('10000k')
    //.audioBitrate('192k') 
    //.size('3480x2160')
    //.addOptions([
    //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
    //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
    //])
    .on('end', () => {
    console.log('Transcoding complete.');
    fs.unlinkSync(inputpath)
    res.render('download', { downloadPath: `/upload/${outputfilename}` });
    })
    .on('error', (err) => {
    console.error('Error:', err.message);
    res.status(500).send("Transcoding Failed :(")
    })
    .run();
})

// Download
app.get('/upload/:filename', (req, res) => {
  const filepath = path.join(__dirname, 'upload', req.params.filename);
  res.download(filepath);
});




//test1
// app.post('/', upload.single("video"), (req,res)=>{
//     const inputpath = req.file.path
//     const outputfilename = req.body.filename + '.mp4'
//     const outputpath = path.join('upload', outputfilename)
//     ffmpeg(inputpath)
//     .output(outputpath)
//     //.videoCodec('libx264') LOW CPU TESTING
//     .videoCodec('libx265')
//     //.audioCodec('aac')
//     //.videoBitrate('10000k')
//     //.audioBitrate('192k') 
//     //.size('3480x2160')
//     //.addOptions([
//     //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
//     //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
//     //])
//     .on('end', () => {
//     console.log('Transcoding complete.');
//     fs.unlinkSync(inputpath)
//     //res.redirect('/download')
//     res.render('download', { downloadPath: `/download/${outputfilename}.mp4` });
//     })
//     .on('error', (err) => {
//     console.error('Error:', err.message);
//     res.status(500).send("Transcoding Failed :(")
//     })
//     .run();
// })

// app.get('/download/:filename', (req, res) => {
//   const filePath = path.join(__dirname, 'converted', req.params.filename);
//   res.download(filePath);
// });

//Download page 
// app.get('/download:filename', (req,res)=>{
//     res.send(`${filename}`)
//     //res.render(download)
// })
//app.post()






// //test 2
// app.post('/', upload.single("video"), (req,res)=>{
//     const inputpath = req.file.path
//     //const outputfilename = req.body.filename + '.mp4'
//     const outputfilename = req.file.filename.split('.')[0] + '.mp4';
//     const outputpath = path.join('upload', outputfilename)
//     ffmpeg(inputpath)
//     .output(outputpath)
//     //.videoCodec('libx264') LOW CPU TESTING
//     .videoCodec('libx265')
//     //.audioCodec('aac')
//     //.videoBitrate('10000k')
//     //.audioBitrate('192k') 
//     //.size('3480x2160')
//     //.addOptions([
//     //'-preset', 'veryslow',  // Pass the preset as a custom FFmpeg option
//     //'-threads', '1',        // Force single-thread encoding for maximum CPU usage
//     //])
//     .on('end', () => {
//     console.log('Transcoding complete.');
//     fs.unlinkSync(inputpath)
//     //res.redirect('/download')
//     res.render('download', { downloadPath: `/download/${outputfilename}.mp4` });
//     })
//     .on('error', (err) => {
//     console.error('Error:', err.message);
//     res.status(500).send("Transcoding Failed :(")
//     })
//     .run();
// })

// app.get('/download/:filename', (req, res) => {
//   const filePath = path.join(__dirname, 'converted', req.params.filename);
//   res.download(filePath);
// });

// //Download page 
// // app.get('/download:filename', (req,res)=>{
// //     res.send(`${filename}`)
// //     //res.render(download)
// // })
// //app.post()


//Default
app.listen(3000)
console.log("Port Connected")