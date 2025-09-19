FROM node:20-bullseye

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=8083 \
    JOB_ROOT=/tmp/ccjobs \
    CC_CPU_SECS=10 \
    CC_OUTPUT_MAX=262144 \
    CC_STDIN_MAX=131072 \
    CC_FILE_MAX=262144

# compilers + sanitizer runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ libasan6 libubsan1 bash ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy deps (works with or without lockfile)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# Copy runner source
COPY cc-runner.js ./cc-runner.js

EXPOSE 8083

# Optional: quick health probe that compiles & runs a 1-liner
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8083)+'/api/cc/selftest').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "cc-runner.js"]
