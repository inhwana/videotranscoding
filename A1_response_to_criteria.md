Assignment 1 - REST API Project - Response to Criteria
================================================

Overview
------------------------------------------------

- **Name:** In Hwa Na
- **Student number:** n10851879
- **Application name:** videotranscoding
- **Two line description:** This app transcodes and change to mp4 files, videos that users upload.
                            Uers can download the video that has been transcoded.

Core criteria
------------------------------------------------

### Containerise the app

- **ECR Repository name:**
- **Video timestamp:**
- **Relevant files:**
    - 

### Deploy the container

- **EC2 instance ID:**
- **Video timestamp:**

### User login

- **One line description:** Used passport and express-session for the login.
- **Video timestamp:**
- **Relevant files:**
    - passport.config.js
    - index.js 22

### REST API

- **One line description:**
- **Video timestamp:**
- **Relevant files:**
    - 

### Data types

- **One line description:**
- **Video timestamp:**
- **Relevant files:**
    - 

#### First kind

- **One line description:** Video files
- **Type:** Unstructured
- **Rationale:** Videos are too large for database.  No need for additional functionality.
- **Video timestamp:**
- **Relevant files:**
    - /upload
    - /index.js 42

#### Second kind

- **One line description:**
- **Type:**
- **Rationale:**
- **Video timestamp:**
- **Relevant files:**
  - 

### CPU intensive task

 **One line description:**: Used FFMpeg to transcode a video uploaded by the user.
- **Video timestamp:** 
- **Relevant files:**
    - index.js 67

### CPU load testing

 **One line description:** Videos are uploaded and requests to transcode to a new format via the web client.
- **Video timestamp:** 
- **Relevant files:**
    - index.js

Additional criteria
------------------------------------------------

### Extensive REST API features

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 

### External API(s)

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 

### Additional types of data

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 

### Custom processing

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 

### Infrastructure as code

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 

### Web client

- **One line description:** Have used ejs files to create the front end for the web app.
- **Video timestamp:**
- **Relevant files:**
    - /views/download.ejs
    - /views/login.ejs
    - /views/register.ejs
    - /views/upload.ejs

### Upon request

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
    - 