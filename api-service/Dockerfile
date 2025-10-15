FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN apk update && \ 
    apk add ffmpeg
CMD ["node", "index.js"] 
EXPOSE 3000