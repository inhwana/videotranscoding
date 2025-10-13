# Dockerfile for video-service
FROM node:20

WORKDIR /app

# Install FFmpeg (system-level dep)
RUN apt-get update && apt-get install -y ffmpeg

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]