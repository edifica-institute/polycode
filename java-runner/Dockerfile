FROM node:20-bullseye

# Install JDK for javac + curl to fetch the JDBC jar
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install --omit=dev

# App files
COPY java-runner.js ./

# === Build runner.jar (UTF-8) ===
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java && \
    jar --create --file runner.jar -C out .

# === JDBC drivers (add more jars here as needed) ===
RUN mkdir -p /app/libs && \
    curl -L -o /app/libs/mysql-connector-j-8.4.0.jar \
      https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar

# Environment tuning
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
