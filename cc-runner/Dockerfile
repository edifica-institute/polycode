FROM node:20-bullseye

# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev \
    libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# --- ADD THESE TWO LINES ---
# Surface beginner mistakes as hard errors; avoid CPU-specific codegen.
ENV CFLAGS="-std=c17 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Werror -march=x86-64 -mtune=generic"
ENV CXXFLAGS="-std=c++17 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Werror -march=x86-64 -mtune=generic"
# --------------------------

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
