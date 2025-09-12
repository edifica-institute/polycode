# ---- Java + Node base ----
FROM node:20-bullseye

# Headful JDK (Swing/AWT), X server + VNC + noVNC + fonts + WM + runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk \
    xvfb x11vnc novnc \
    openbox xauth \
    fonts-dejavu-core \
    libgtk-3-0 libasound2 libxi6 libxtst6 libxrender1 \
    curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Node deps ----
COPY package.json ./
ENV NODE_ENV=production
RUN npm install --omit=dev

# ---- App files ----
COPY java-runner.js ./

# ---- Build runner.jar (UTF-8) ----
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java \
 && jar --create --file runner.jar -C out .

# Use bash + pipefail for safer chained commands
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ---- 1) Core JDBC drivers + logging ----
RUN set -eux; mkdir -p /app/libs; \
  curl -fSL --retry 5 -o /app/libs/mysql-connector-j-8.4.0.jar \
    https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar; \
  curl -fSL --retry 5 -o /app/libs/postgresql-42.7.3.jar \
    https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar; \
  curl -fSL --retry 5 -o /app/libs/sqlite-jdbc-3.46.0.0.jar \
    https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.46.0.0/sqlite-jdbc-3.46.0.0.jar; \
  curl -fSL --retry 5 -o /app/libs/h2-2.2.224.jar \
    https://repo1.maven.org/maven2/com/h2database/h2/2.2.224/h2-2.2.224.jar; \
  curl -fSL --retry 5 -o /app/libs/mssql-jdbc-12.6.1.jre11.jar \
    https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc/12.6.1.jre11/mssql-jdbc-12.6.1.jre11.jar; \
  curl -fSL --retry 5 -o /app/libs/mariadb-java-client-3.4.1.jar \
    https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.4.1/mariadb-java-client-3.4.1.jar; \
  curl -fSL --retry 5 -o /app/libs/slf4j-api-2.0.12.jar \
    https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar; \
  curl -fSL --retry 5 -o /app/libs/slf4j-simple-2.0.12.jar \
    https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/2.0.12/slf4j-simple-2.0.12.jar

# ---- 2) Pool + Jdbi + Flyway + Jackson + CSV (stable) ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/HikariCP-5.1.0.jar \
    https://repo1.maven.org/maven2/com/zaxxer/HikariCP/5.1.0/HikariCP-5.1.0.jar; \
  curl -fSL --retry 5 -o /app/libs/jdbi3-core-3.45.1.jar \
    https://repo1.maven.org/maven2/org/jdbi/jdbi3-core/3.45.1/jdbi3-core-3.45.1.jar; \
  curl -fSL --retry 5 -o /app/libs/jdbi3-sqlobject-3.45.1.jar \
    https://repo1.maven.org/maven2/org/jdbi/jdbi3-sqlobject/3.45.1/jdbi3-sqlobject-3.45.1.jar; \
  curl -fSL --retry 5 -o /app/libs/jdbi3-jackson2-3.45.1.jar \
    https://repo1.maven.org/maven2/org/jdbi/jdbi3-jackson2/3.45.1/jdbi3-jackson2-3.45.1.jar; \
  curl -fSL --retry 5 -o /app/libs/flyway-core-10.17.0.jar \
    https://repo1.maven.org/maven2/org/flywaydb/flyway-core/10.17.0/flyway-core-10.17.0.jar; \
  curl -fSL --retry 5 -o /app/libs/jackson-annotations-2.17.1.jar \
    https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-annotations/2.17.1/jackson-annotations-2.17.1.jar; \
  curl -fSL --retry 5 -o /app/libs/jackson-core-2.17.1.jar \
    https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-core/2.17.1/jackson-core-2.17.1.jar; \
  curl -fSL --retry 5 -o /app/libs/jackson-databind-2.17.1.jar \
    https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-databind/2.17.1/jackson-databind-2.17.1.jar; \
  curl -fSL --retry 5 -o /app/libs/jackson-datatype-jsr310-2.17.1.jar \
    https://repo1.maven.org/maven2/com/fasterxml/jackson/datatype/jackson-datatype-jsr310/2.17.1/jackson-datatype-jsr310-2.17.1.jar; \
  curl -fSL --retry 5 -o /app/libs/commons-csv-1.11.0.jar \
    https://repo1.maven.org/maven2/org/apache/commons/commons-csv/1.11.0/commons-csv-1.11.0.jar

# ---- 3) Optional lightweight web stack (Javalin + Jetty) ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/kotlin-stdlib-1.9.24.jar \
    https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/1.9.24/kotlin-stdlib-1.9.24.jar; \
  curl -fSL --retry 5 -o /app/libs/kotlin-stdlib-jdk8-1.9.24.jar \
    https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-jdk8/1.9.24/kotlin-stdlib-jdk8-1.9.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-server-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-server/11.0.24/jetty-server-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-http-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-http/11.0.24/jetty-http-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-io-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-io/11.0.24/jetty-io-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-util-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-util/11.0.24/jetty-util-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-security-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-security/11.0.24/jetty-security-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-servlet-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-servlet/11.0.24/jetty-servlet-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jetty-webapp-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-webapp/11.0.24/jetty-webapp-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/jakarta.servlet-api-5.0.0.jar \
    https://repo1.maven.org/maven2/jakarta/servlet/jakarta.servlet-api/5.0.0/jakarta.servlet-api-5.0.0.jar; \
  curl -fSL --retry 5 -o /app/libs/javalin-6.1.6.jar \
    https://repo1.maven.org/maven2/io/javalin/javalin/6.1.6/javalin-6.1.6.jar

# ---- 4) JUnit console (optional) ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/junit-platform-console-standalone-1.10.2.jar \
    https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/1.10.2/junit-platform-console-standalone-1.10.2.jar

# ---- Entrypoint that starts Xvfb + WM + VNC + Node ----
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# ---- Runtime env ----
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DISPLAY=:99 \
    NO_AT_BRIDGE=1 \
    _JAVA_AWT_WM_NONREPARENTING=1 \
    PORT=8081

EXPOSE 8081
# (5900 is used internally by x11vnc; expose if you want raw VNC access)
# EXPOSE 5900

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

CMD ["/app/entrypoint.sh"]
