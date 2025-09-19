FROM node:20-bullseye

# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev \
    libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# --- ADD THESE TWO LINES ---
# Surface beginner mistakes as hard errors; avoid CPU-specific codegen.
# keep the non -Werror CFLAGS/CXXFLAGS above, then add:
# Warnings ON (not -Werror), sanitizers ON, plain logs (no ANSI colors)
ENV BASE_C_WARN="-std=c17 -O1 -g -fno-omit-frame-pointer -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -fdiagnostics-color=never"
ENV BASE_CXX_WARN="-std=c++20 -O1 -g -fno-omit-frame-pointer -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -fdiagnostics-color=never"
ENV SAN="-fsanitize=address,undefined -fno-sanitize-recover=all -no-pie"

ENV CFLAGS="$BASE_C_WARN $SAN"
ENV CXXFLAGS="$BASE_CXX_WARN $SAN"

# Short, colorless, first-error-only sanitizer messages
ENV ASAN_OPTIONS="color=never:detect_leaks=1:halt_on_error=1:allocator_may_return_null=1:verbosity=0:print_summary=1:exitcode=66:strip_path_prefix=/tmp/ccjobs/"
ENV UBSAN_OPTIONS="print_stacktrace=0:halt_on_error=1:report_error_type=1:print_summary=1"


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
