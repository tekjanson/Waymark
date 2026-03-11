FROM node:lts-alpine
WORKDIR /app

# Git hash + repo URL baked at build time (no .git in container)
ARG GIT_HASH=""
ARG GIT_REPO=""

COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/

# Write build-info.json so the server can read it without git
RUN printf '{"hash":"%s","repo":"%s","builtAt":"%s"}\n' \
      "$GIT_HASH" "$GIT_REPO" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > server/build-info.json

EXPOSE 3000
CMD ["node", "server/index.js"]
