FROM node:lts-alpine
WORKDIR /app

# Git is needed for the github-source module (bare clone + archive)
RUN apk add --no-cache git

# Git hash + repo URL baked at build time (no .git in container)
ARG GIT_HASH=""
ARG GIT_REPO=""


COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/

# Create directories for github-source (bare repo clone + extracted checkouts)
RUN mkdir -p server/.git-repo server/.git-checkout

# Write build-info.json so the server can read it without git
RUN printf '{"hash":"%s","repo":"%s","builtAt":"%s"}\n' \
      "$GIT_HASH" "$GIT_REPO" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > server/build-info.json

EXPOSE 3000
CMD ["node", "server/index.js"]
