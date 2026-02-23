FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production  # ← Faster, safer
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]