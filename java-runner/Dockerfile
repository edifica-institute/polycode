FROM node:20-bullseye
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY java-runner.js ./
ENV PORT=8081
EXPOSE 8081
CMD ["npm","start"]
