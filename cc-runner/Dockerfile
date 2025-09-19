FROM node:20-bullseye

# Toolchains for C/C++
RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev \
    libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# --- ADD THESE TWO LINES ---
# Surface beginner mistakes as hard errors; avoid CPU-specific codegen.
ENV MALLOC_CHECK_=3
ENV GLIBC_TUNABLES="glibc.malloc.check=3"
ENV MALLOC_PERTURB_=204

# --------------------------
# NOTE: intentionally no -std flags here; your runner supplies them.
#ENV CFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Werror -Wno-error=unused-variable -Wno-error=unused-but-set-variable -march=x86-64 -mtune=generic"
#ENV CXXFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Werror -Wno-error=unused-variable -Wno-error=unused-but-set-variable -D_GLIBCXX_ASSERTIONS -march=x86-64 -mtune=generic"

ENV CFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion \
 -Werror -Wno-error=unused-variable -Wno-error=unused-but-set-variable \
 -Wno-error=misleading-indentation -Wno-error=missing-braces -Wno-error=missing-field-initializers \
 -march=x86-64 -mtune=generic"

ENV CXXFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion \
 -Werror -Wno-error=unused-variable -Wno-error=unused-but-set-variable \
 -Wno-error=misleading-indentation -Wno-error=missing-braces -Wno-error=missing-field-initializers \
 -D_GLIBCXX_ASSERTIONS -march=x86-64 -mtune=generic"



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
