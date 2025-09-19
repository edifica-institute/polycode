FROM node:20-bullseye

# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev libboost-all-dev \
    libasan6 libubsan1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Compiler flags (warnings on; NOT errors). Sanitizers enabled. ---
ENV CFLAGS="-std=c17  -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -march=x86-64 -mtune=generic -fsanitize=address,undefined -fno-omit-frame-pointer"
ENV CXXFLAGS="-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion               -march=x86-64 -mtune=generic -fsanitize=address,undefined -fno-omit-frame-pointer"

# Sanitizer runtime behavior
ENV ASAN_OPTIONS="halt_on_error=1:abort_on_error=1:detect_leaks=0"
ENV UBSAN_OPTIONS="print_stacktrace=1"

# Runner limits (give ASan enough virtual memory)
ENV CC_VMEM_KB=0
ENV CC_CPU_SECS=10
ENV CC_FSIZE_KB=1048576
ENV CC_TIMEOUT_S=300
ENV CC_COMPILE_TIMEOUT_S=60

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
