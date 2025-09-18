FROM node:20-bullseye

# Toolchains for C/C++
 RUN apt-get update && apt-get install -y \
     build-essential g++ make cmake \
     libgmp-dev \
     libboost-all-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev || npm i --production

# App code
COPY cc-runner.js ./cc-runner.js

# Non-root
RUN useradd -m runner && chown -R runner:runner /app
USER runner

ENV PORT=8083
EXPOSE 8083
CMD ["npm","start"]
