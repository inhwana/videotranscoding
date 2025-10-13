# Dockerfile for auth-service
FROM node:20-alpine  

WORKDIR /app

# Copy package.json and install deps
COPY package.json package-lock.json ./
RUN npm install --production  # Only prod deps to keep image small

# Copy source code
COPY . .

# Expose port (your app listens on 3000, but you can change)
EXPOSE 3000

# Start command
CMD ["node", "index.js"]