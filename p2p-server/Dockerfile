FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY src ./src

# data/ volume mount point for persistent notification buffer + history
RUN mkdir -p /app/data

ENV PORT=8090
ENV NOTIFICATION_BUFFER_FILE=/app/data/notification-buffer.json
ENV NOTIFICATION_HISTORY_FILE=/app/data/notification-history.jsonl
EXPOSE 8090

CMD ["node", "src/server.mjs"]
