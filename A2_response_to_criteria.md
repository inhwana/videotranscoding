    Assignment 2 - Cloud Services Exercises - Response to Criteria

================================================

## Instructions

- Keep this file named A2_response_to_criteria.md, do not change the name
- Upload this file along with your code in the root directory of your project
- Upload this file in the current Markdown format (.md extension)
- Do not delete or rearrange sections. If you did not attempt a criterion, leave it blank
- Text inside [ ] like [eg. S3 ] are examples and should be removed

## Overview

- **Name:** Manny Go
- **Student number:** n11908157
- **Partner name (if applicable):** In Hwa Na
- **Student number:** n10851879
- **Application name:** Video Transcoding
- **Two line description:** We created a video processing web application that can transcode, transcribe audio using the Gemini API, and extract audios.
- **EC2 instance name or ID:** mannyinhwa

---

### Core - First data persistence service

- **AWS service name:** [S3]
- **What data is being stored?:** [video files]
- **Why is this service suited to this data?:** [S3 allows us to store large files.]
- **Why is are the other services used not suitable for this data?:** [Because other services such as DynamoDB cannot store large data types like video files.]
- **Bucket/instance/table name:** [n10851879-test]
- **Video timestamp:** 01:50, 02:30
- **Relevant files:**
  -index.js 77, 187

### Core - Second data persistence service

- **AWS service name:** [RDS]
- **What data is being stored?:** [video metadata]
- **Why is this service suited to this data?:** [Because our data is related]
- **Why is are the other services used not suitable for this data?:** []
- **Bucket/instance/table name:** "database-1-instance-1.ce2haupt2cta.ap-southeast-2.rds.amazonaws.com",
- **Video timestamp:** 02:42
- **Relevant files:**
  -index.js, db.js

### Third data service

- **AWS service name:** []
- **What data is being stored?:** []
- **Why is this service suited to this data?:** []
- **Why is are the other services used not suitable for this data?:** []
- **Bucket/instance/table name:**
- **Video timestamp:**
- ## **Relevant files:**

### S3 Pre-signed URLs

- **S3 Bucket names:** [n10851879-test]
- **Video timestamp:** 01:45, 02:17
- **Relevant files:**
  -index.js 81, 194

### In-memory cache

- **ElastiCache instance name:** n11908157-a2
- **What data is being cached?:** Video metadata
- **Why is this data likely to be accessed frequently?:** Because the metadata is used to identify the users and the titles of the video to be manipulated
- **Video timestamp:** 05:11
- ## **Relevant files:** db.js, cache.js

### Core - Statelessness

- **What data is stored within your application that is not stored in cloud data services?:** [eg. intermediate video files that have been transcoded but not stabilised]
- **Why is this data not considered persistent state?:** [eg. intermediate files can be recreated from source if they are lost]
- **How does your application ensure data consistency if the app suddenly stops?:** [eg. journal used to record data transactions before they are done. A separate task scans the journal and corrects problems on startup and once every 5 minutes afterwards. ]
- ## **Relevant files:**

### Graceful handling of persistent connections

- **Type of persistent connection and use:** [eg. server-side-events for progress reporting]
- **Method for handling lost connections:** [eg. client responds to lost connection by reconnecting and indicating loss of connection to user until connection is re-established ]
- ## **Relevant files:**

### Core - Authentication with Cognito

- **User pool name:** [manny-inhwa-app-pool]
- **How are authentication tokens handled by the client?:** [eg. Response to login request sets a cookie containing the token.]
- **Video timestamp:** 00:53
- ## **Relevant files:** 
- auth.js

### Cognito multi-factor authentication

- **What factors are used for authentication:** [eg. password, SMS code]
- **Video timestamp:**
- ## **Relevant files:**

### Cognito federated identities

- **Identity providers used:**
- **Video timestamp:**
- ## **Relevant files:**

### Cognito groups

- **How are groups used to set permissions?:** [eg. 'admin' users can delete and ban other users]
- **Video timestamp:**
- ## **Relevant files:**

### Core - DNS with Route53

- **Subdomain**: [mannyinhwa.cab432.com]
- **Video timestamp:**

### Parameter store

- **Parameter names:** [eg. n1234567/base_url]
- **Video timestamp:** 03:23
- ## **Relevant files:**
- parameters.js

### Secrets manager

- **Secrets names:** [eg. n1234567-youtube-api-key]
- **Video timestamp:** 04:30
- ## **Relevant files:**
- secrets.js

### Infrastructure as code

- **Technology used:**
- **Services deployed:**
- **Video timestamp:**
- ## **Relevant files:**

### Other (with prior approval only)

- **Description:**
- **Video timestamp:**
- ## **Relevant files:**

### Other (with prior permission only)

- **Description:**
- **Video timestamp:**
- ## **Relevant files:**
