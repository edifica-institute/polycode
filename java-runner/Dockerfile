FROM node:20-bullseye

# Install only what's needed: JDK for javac + JRE for running
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install --omit=dev

# App files
COPY java-runner.js ./

# === Copy launcher sources and build runner.jar (force UTF-8) ===
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java && \
    jar --create --file runner.jar -C out .

# Environment tuning
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
