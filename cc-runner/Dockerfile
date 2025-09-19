# Dockerfile — cc-runner with GCC + ASan/UBSan
FROM node:20-bullseye

# Avoid interactive tz prompts etc.
ENV DEBIAN_FRONTEND=noninteractive

# System deps: compilers + sanitizer runtimes + bash
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ \
    libasan6 libubsan1 \
    ca-certificates curl bash \
 && rm -rf /var/lib/apt/lists/*

# Workdir & app
WORKDIR /app
COPY package*.json ./  2>/dev/null || true
RUN npm pkg set type=module 2>/dev/null || true
RUN npm install --omit=dev 2>/dev/null || true

# Copy runner
COPY cc-runner.js ./cc-runner.js

# Runtime env (can be overridden)
ENV PORT=8083 \
    JOB_ROOT=/tmp/ccjobs \
    CC_CPU_SECS=10 \
    CC_OUTPUT_MAX=$((256*1024)) \
    CC_STDIN_MAX=$((128*1024)) \
    CC_FILE_MAX=$((256*1024))

# Healthcheck (optional)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||8083) + '/api/cc/run',{method:'POST',headers:{'content-type':'application/json'},body:'{\"lang\":\"c\",\"code\":\"int main(){return 0;}\"}' }).then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

EXPOSE 8083
CMD ["node", "cc-runner.js"]
