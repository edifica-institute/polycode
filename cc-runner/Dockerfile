FROM node:20-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ make \
    ca-certificates bash coreutils procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production

COPY cc-runner.js ./cc-runner.js
RUN useradd -m runner && chown -R runner:runner /app
USER runner

ENV PORT=8083
EXPOSE 8083
CMD ["node","cc-runner.js"]
