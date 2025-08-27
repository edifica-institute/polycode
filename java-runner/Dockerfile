FROM node:20-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk build-essential ca-certificates util-linux \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# --- CACHE BUST so c-plugin.js always refreshes ---
ARG C_PLUGIN_BUILD=2025-08-26-01

# App files
COPY java-runner.js ./
COPY c-plugin.js ./

# Java launcher
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java && \
    jar --create --file runner.jar -C out .

# Preload helper
COPY stdin_notify.c ./
RUN gcc -shared -fPIC -O2 -ldl -o libstdin_notify.so stdin_notify.c

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV NODE_ENV=production

EXPOSE 8081
CMD ["npm","start"]
