FROM node:20-bullseye

# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev \
    libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# Safer defaults for student code (C & C++).
# - turn on ASan/UBSan
# - keep frame pointers for better stacks
# - avoid CPU-specific codegen so binaries run everywhere
ENV CFLAGS="-std=c17 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -march=x86-64 -mtune=generic"
ENV CXXFLAGS="-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -march=x86-64 -mtune=generic"

# Make sanitizer output strict and readable
ENV ASAN_OPTIONS="detect_leaks=1:halt_on_error=1:color=always"
ENV UBSAN_OPTIONS="print_stacktrace=1:color=always"

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
