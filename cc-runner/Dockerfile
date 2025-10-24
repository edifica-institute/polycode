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

#ENV CFLAGS="-std=c17 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Werror -march=x86-64 -mtune=generic"
#ENV CXXFLAGS="-std=c++17 -O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Werror -march=x86-64 -mtune=generic"
# --------------------------
# NOTE: intentionally no -std flags here; your runner supplies them.
ENV CFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wint-conversion -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=sign-conversion -march=x86-64 -mtune=generic"
ENV CXXFLAGS="-O1 -g -Wall -Wextra -Wpedantic -Wformat=2 -Wshadow -Wconversion -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=sign-conversion -D_GLIBCXX_ASSERTIONS -march=x86-64 -mtune=generic"


WORKDIR /app

# Install deps first (better layer caching)
#COPY package*.json ./
#RUN npm ci --omit=dev || npm i --production


# Install deps first (better layer caching)
COPY package.json ./
# Copy lockfile only if it exists (pattern is okay; if it doesn't exist, the build still succeeds)
COPY package-lock.json* npm-shrinkwrap.json* ./

# Use npm ci if a lockfile is present, otherwise use npm install
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      echo "Lockfile found → npm ci --omit=dev"; \
      npm ci --omit=dev; \
    else \
      echo "No lockfile → npm install --omit=dev"; \
      npm install --omit=dev; \
    fi


# App code
COPY cc-runner.js ./cc-runner.js

# Non-root
RUN useradd -m runner && chown -R runner:runner /app
USER runner

ENV PORT=8083
EXPOSE 8083
CMD ["npm","start"]
