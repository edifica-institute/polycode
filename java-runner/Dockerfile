FROM node:20-bullseye
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install --omit=dev

# App files
COPY java-runner.js ./

# === NEW: copy the Java launcher sources and build runner.jar ===
COPY io /app/io
RUN javac -d out io/polycode/*.java && \
    jar --create --file runner.jar -C out .

ENV PORT=8081
EXPOSE 8081
CMD ["npm","start"]
  
