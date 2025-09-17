FROM node:20-bullseye


# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake util-linux \
    libgmp-dev \
    libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# Turn on sanitizers and helpful defaults for *both* languages.
# (Runner appends env flags at the end, so these "win".)
ENV CFLAGS="-std=c17 -O1 -g -fno-omit-frame-pointer \
  -fsanitize=address,undefined -fno-sanitize-recover=all \
  -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Werror \
  -march=x86-64 -mtune=generic"

ENV CXXFLAGS="-std=c++20 -O1 -g -fno-omit-frame-pointer \
  -fsanitize=address,undefined -fno-sanitize-recover=all \
  -D_GLIBCXX_ASSERTIONS \
  -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Werror \
  -march=x86-64 -mtune=generic"

# (Optional but nice: make ASan/UBSan logs clearer)
ENV ASAN_OPTIONS="detect_leaks=0:abort_on_error=1:strict_string_checks=1"
ENV UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1"







# Give sanitized binaries some headroom by default (runner can still override)
# (≈ 1 GiB; used by cc-runner via process.env.CC_VMEM_KB)
ENV CC_VMEM_KB=1048576

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev || npm i --production

# App code
COPY cc-runner.js ./cc-runner.js

# Non-root
RUN useradd -m runner && chown -R runner:runner /app
USER runner

ENV NODE_ENV=production
ENV PORT=8083
EXPOSE 8083

CMD ["npm", "start"]
