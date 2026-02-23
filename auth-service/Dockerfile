FROM node:20-alpine  

WORKDIR /app


COPY package.json package-lock.json ./
RUN npm install --production  # Only prod deps to keep image small


COPY . .

EXPOSE 3000

# Start command
CMD ["node", "index.js"]