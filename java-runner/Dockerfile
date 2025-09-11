# ---- Java + Node base ----
FROM node:20-bullseye

# Install JDK for javac and curl for fetching jars
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Node deps ----
# If you have package-lock.json, you can switch to: npm ci --omit=dev
COPY package.json ./
RUN npm install --omit=dev

# ---- App files ----
COPY java-runner.js ./

# ---- Build runner.jar (UTF-8) ----
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java \
 && jar --create --file runner.jar -C out .

# ---- Libraries (JDBC + Local WebSocket support) ----
# MySQL Connector/J and Tyrus jars go to /app/libs
RUN mkdir -p /app/libs && \
    curl -fSL -o /app/libs/mysql-connector-j-8.4.0.jar \
      https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar && \
    curl -fSL -o /app/libs/tyrus-standalone-client-jdk-2.1.4.jar \
      https://repo1.maven.org/maven2/org/glassfish/tyrus/tyrus-standalone-client-jdk/2.1.4/tyrus-standalone-client-jdk-2.1.4.jar && \
    curl -fSL -o /app/libs/tyrus-standalone-server-2.1.4.jar \
      https://repo1.maven.org/maven2/org/glassfish/tyrus/bundles/tyrus-standalone-server/2.1.4/tyrus-standalone-server-2.1.4.jar

# ---- Runtime env ----
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
