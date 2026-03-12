FROM node:lts-alpine
WORKDIR /app

# Git hash + repo URL baked at build time (no .git in container)
ARG GIT_HASH=""
ARG GIT_REPO=""

# GitHub source mode: when set, the container can serve frontend files
# directly from the GitHub repo at any commit hash, instead of using
# the baked-in public/ directory.
ARG GITHUB_SOURCE=""
ARG GITHUB_OWNER=""
ARG GITHUB_REPO_NAME=""
ARG GITHUB_REF="main"

COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/

# Create cache directory for GitHub source mode
RUN mkdir -p server/.github-cache

# Write build-info.json so the server can read it without git
RUN printf '{"hash":"%s","repo":"%s","builtAt":"%s"}\n' \
      "$GIT_HASH" "$GIT_REPO" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > server/build-info.json

# Pass GitHub source args as ENV defaults (can be overridden at runtime)
ENV GITHUB_SOURCE=$GITHUB_SOURCE
ENV GITHUB_OWNER=$GITHUB_OWNER
ENV GITHUB_REPO=$GITHUB_REPO_NAME
ENV GITHUB_REF=$GITHUB_REF

EXPOSE 3000
CMD ["node", "server/index.js"]
