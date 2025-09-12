# ---- Java + Node base ----
FROM node:20-bullseye

# Install JDK for javac and curl for fetching jars
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Node deps (no lockfile) ----
COPY package.json ./
RUN npm install --omit=dev

# ---- App files ----
COPY java-runner.js ./

# ---- Build runner.jar (UTF-8) ----
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java \
 && jar --create --file runner.jar -C out .

# ---- Libraries (JDBC + Local WebSocket support via single jar) ----
RUN mkdir -p /app/libs && \
    curl -fSL -o /app/libs/mysql-connector-j-8.4.0.jar \
      https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar && \
    curl -fSL -o /app/libs/Java-WebSocket-1.5.6.jar \
      https://repo1.maven.org/maven2/org/java-websocket/Java-WebSocket/1.5.6/Java-WebSocket-1.5.6.jar && \
    curl -fSL -o /app/libs/slf4j-api-2.0.12.jar \
      https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar && \
    curl -fSL -o /app/libs/slf4j-simple-2.0.12.jar \
      https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/2.0.12/slf4j-simple-2.0.12.jar && \
      # PostgreSQL
curl -fSL -o /app/libs/postgresql-42.7.3.jar \
  https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar && \
# SQLite
curl -fSL -o /app/libs/sqlite-jdbc-3.46.0.0.jar \
  https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.46.0.0/sqlite-jdbc-3.46.0.0.jar && \
# H2
curl -fSL -o /app/libs/h2-2.2.224.jar \
  https://repo1.maven.org/maven2/com/h2database/h2/2.2.224/h2-2.2.224.jar && \
# SQL Server
curl -fSL -o /app/libs/mssql-jdbc-12.6.1.jre11.jar \
  https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc/12.6.1.jre11/mssql-jdbc-12.6.1.jre11.jar && \
# MariaDB
curl -fSL -o /app/libs/mariadb-java-client-3.4.1.jar \
  https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.4.1/mariadb-java-client-3.4.1.jar


      

# ---- Runtime env ----
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
