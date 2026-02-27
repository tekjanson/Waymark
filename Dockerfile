FROM node:lts-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "server/index.js"]
