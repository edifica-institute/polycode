# python-runner Dockerfile (separate Render service)
FROM node:20-bullseye-slim

# Install Python 3 (for running user code) and tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY python-runner.js ./

EXPOSE ${PORT}
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","python-runner.js"]
