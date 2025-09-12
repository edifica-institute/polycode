# ---- Java + Node base ----
FROM node:20-bullseye

# Install JDK, curl, and GUI bits (Xvfb + fonts) for Swing/AWT
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless curl ca-certificates \
    xvfb libxext6 libxrender1 libxtst6 libxi6 \
    fontconfig fonts-dejavu \
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

# Use bash + pipefail for safer chained commands
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ---- 1) Core JDBC drivers + logging + local WebSocket ----
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
  curl -fSL --retry 5 -o /app/libs/Java-WebSocket-1.5.6.jar \
    https://repo1.maven.org/maven2/org/java-websocket/Java-WebSocket/1.5.6/Java-WebSocket-1.5.6.jar; \
  curl -fSL --retry 5 -o /app/libs/slf4j-api-2.0.12.jar \
    https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar; \
  curl -fSL --retry 5 -o /app/libs/slf4j-simple-2.0.12.jar \
    https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/2.0.12/slf4j-simple-2.0.12.jar

# ---- 2) Pool + Jdbi + Flyway + JSON/CSV ----
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

# ---- 3) Javalin + Kotlin + Jetty + Servlet ----
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

# ---- 3b) Jetty WebSocket (for Javalin WS) ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/websocket-core-common-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/websocket/core/websocket-core-common/11.0.24/websocket-core-common-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/websocket-core-server-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/websocket/core/websocket-core-server/11.0.24/websocket-core-server-11.0.24.jar; \
  curl -fSL --retry 5 -o /app/libs/websocket-jetty-server-11.0.24.jar \
    https://repo1.maven.org/maven2/org/eclipse/jetty/websocket/jetty/websocket-jetty-server/11.0.24/websocket-jetty-server-11.0.24.jar

# ---- 4) Utilities: jOOQ, MyBatis, Liquibase, Mail, YAML, HTML, Excel ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/jooq-3.19.10.jar \
    https://repo1.maven.org/maven2/org/jooq/jooq/3.19.10/jooq-3.19.10.jar; \
  curl -fSL --retry 5 -o /app/libs/mybatis-3.5.15.jar \
    https://repo1.maven.org/maven2/org/mybatis/mybatis/3.5.15/mybatis-3.5.15.jar; \
  curl -fSL --retry 5 -o /app/libs/liquibase-core-4.27.0.jar \
    https://repo1.maven.org/maven2/org/liquibase/liquibase-core/4.27.0/liquibase-core-4.27.0.jar; \
  # Jakarta Mail (API + implementation via Eclipse Angus)
  curl -fSL --retry 5 -o /app/libs/jakarta.mail-api-2.1.2.jar \
    https://repo1.maven.org/maven2/jakarta/mail/jakarta.mail-api/2.1.2/jakarta.mail-api-2.1.2.jar; \
  curl -fSL --retry 5 -o /app/libs/jakarta.mail-2.0.4.jar \
    https://repo1.maven.org/maven2/org/eclipse/angus/jakarta.mail/2.0.4/jakarta.mail-2.0.4.jar; \
  # YAML/HTML/Excel helpers
  curl -fSL --retry 5 -o /app/libs/snakeyaml-2.2.jar \
    https://repo1.maven.org/maven2/org/yaml/snakeyaml/2.2/snakeyaml-2.2.jar; \
  curl -fSL --retry 5 -o /app/libs/jsoup-1.18.1.jar \
    https://repo1.maven.org/maven2/org/jsoup/jsoup/1.18.1/jsoup-1.18.1.jar; \
  curl -fSL --retry 5 -o /app/libs/poi-5.2.5.jar \
    https://repo1.maven.org/maven2/org/apache/poi/poi/5.2.5/poi-5.2.5.jar; \
  curl -fSL --retry 5 -o /app/libs/poi-ooxml-5.2.5.jar \
    https://repo1.maven.org/maven2/org/apache/poi/poi-ooxml/5.2.5/poi-ooxml-5.2.5.jar; \
  curl -fSL --retry 5 -o /app/libs/xmlbeans-5.1.1.jar \
    https://repo1.maven.org/maven2/org/apache/xmlbeans/xmlbeans/5.1.1/xmlbeans-5.1.1.jar; \
  curl -fSL --retry 5 -o /app/libs/commons-io-2.15.1.jar \
    https://repo1.maven.org/maven2/commons-io/commons-io/2.15.1/commons-io-2.15.1.jar; \
  curl -fSL --retry 5 -o /app/libs/commons-collections4-4.4.jar \
    https://repo1.maven.org/maven2/org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar; \
  curl -fSL --retry 5 -o /app/libs/commons-compress-1.26.2.jar \
    https://repo1.maven.org/maven2/org/apache/commons/commons-compress/1.26.2/commons-compress-1.26.2.jar; \
  curl -fSL --retry 5 -o /app/libs/curvesapi-1.07.jar \
    https://repo1.maven.org/maven2/com/github/virtuald/curvesapi/1.07/curvesapi-1.07.jar

# ---- 5) JUnit 5 console (standalone) ----
RUN set -eux; \
  curl -fSL --retry 5 -o /app/libs/junit-platform-console-standalone-1.10.2.jar \
    https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/1.10.2/junit-platform-console-standalone-1.10.2.jar

# ---- Xvfb wrapper so Swing runs without runner changes ----
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'export DISPLAY=${DISPLAY:-:99}' \
  'Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac >/dev/null 2>&1 &' \
  'exec "$@"' > /usr/local/bin/with-xvfb \
  && chmod +x /usr/local/bin/with-xvfb

# ---- Runtime env ----
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["with-xvfb","npm","start"]
