FROM node:20-bullseye

# Toolchains & runtimes for all languages
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
    build-essential \
    gfortran \
    python3 python3-pip \
    php-cli \
    mono-complete \
    bwbasic \
    ca-certificates bash coreutils procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend deps (needs package.json below)
# Copy package manifests (copy lockfile too if it exists)
COPY package*.json ./

# If a lockfile exists, use `npm ci`; otherwise use `npm i`
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm i --omit=dev; \
    fi

# Server code
COPY server ./server


ENV NODE_ENV=production
ENV SANDBOX=local
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server/boot.js"]
