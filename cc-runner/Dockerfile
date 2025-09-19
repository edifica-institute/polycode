FROM node:20-bullseye

# Toolchains for C/C++ + util-linux for `script` (PTY)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential g++ make cmake \
    libgmp-dev \
    libboost-all-dev \
    util-linux \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Safer defaults. Do NOT set -std here so the runner can choose (C17/C++20).
# Keep these strict-but-helpful warnings; runner already strips -Werror.
ENV CFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -march=x86-64 -mtune=generic"
ENV CXXFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -march=x86-64 -mtune=generic"

# Match runner defaults (optional, just explicit)
ENV CC_ENABLE_SAN=1
ENV CC_USE_STDBUF=0

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

# Use whatever you prefer; both work:
# CMD ["node","cc-runner.js"]
CMD ["npm","start"]
