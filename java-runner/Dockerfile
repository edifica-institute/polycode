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
      https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.4.1/mariadb-java-client-3.4.1.jar && \



      # Connection pool
    curl -fSL -o /app/libs/HikariCP-5.1.0.jar \
      https://repo1.maven.org/maven2/com/zaxxer/HikariCP/5.1.0/HikariCP-5.1.0.jar && \
    # Jdbi (core + SQL object)
    curl -fSL -o /app/libs/jdbi3-core-3.45.1.jar \
      https://repo1.maven.org/maven2/org/jdbi/jdbi3-core/3.45.1/jdbi3-core-3.45.1.jar && \
    curl -fSL -o /app/libs/jdbi3-sqlobject-3.45.1.jar \
      https://repo1.maven.org/maven2/org/jdbi/jdbi3-sqlobject/3.45.1/jdbi3-sqlobject-3.45.1.jar && \
    # Flyway (JDBC-agnostic)
    curl -fSL -o /app/libs/flyway-core-10.17.0.jar \
      https://repo1.maven.org/maven2/org/flywaydb/flyway-core/10.17.0/flyway-core-10.17.0.jar && \
    # Jackson (JSON)
    curl -fSL -o /app/libs/jackson-annotations-2.17.1.jar \
      https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-annotations/2.17.1/jackson-annotations-2.17.1.jar && \
    curl -fSL -o /app/libs/jackson-core-2.17.1.jar \
      https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-core/2.17.1/jackson-core-2.17.1.jar && \
    curl -fSL -o /app/libs/jackson-databind-2.17.1.jar \
      https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-databind/2.17.1/jackson-databind-2.17.1.jar && \
    # Javalin (tiny web framework)
    curl -fSL -o /app/libs/javalin-6.1.6.jar \
      https://repo1.maven.org/maven2/io/javalin/javalin/6.1.6/javalin-6.1.6.jar && \
    # Commons CSV
    curl -fSL -o /app/libs/commons-csv-1.11.0.jar \
      https://repo1.maven.org/maven2/org/apache/commons/commons-csv/1.11.0/commons-csv-1.11.0.jar && \


      # Kotlin stdlib (required by Javalin)
curl -fSL -o /app/libs/kotlin-stdlib-1.9.24.jar \
  https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/1.9.24/kotlin-stdlib-1.9.24.jar && \
curl -fSL -o /app/libs/kotlin-stdlib-jdk8-1.9.24.jar \
  https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-jdk8/1.9.24/kotlin-stdlib-jdk8-1.9.24.jar && \
# Jetty 11 (matches Jakarta Servlet 5)
curl -fSL -o /app/libs/jetty-server-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-server/11.0.24/jetty-server-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-http-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-http/11.0.24/jetty-http-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-io-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-io/11.0.24/jetty-io-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-util-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-util/11.0.24/jetty-util-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-security-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-security/11.0.24/jetty-security-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-servlet-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-servlet/11.0.24/jetty-servlet-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-webapp-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-webapp/11.0.24/jetty-webapp-11.0.24.jar && \
# Jakarta Servlet API (needed by Jetty/Javalin)
curl -fSL -o /app/libs/jakarta.servlet-api-5.0.0.jar \
  https://repo1.maven.org/maven2/jakarta/servlet/jakarta.servlet-api/5.0.0/jakarta.servlet-api-5.0.0.jar && \
# Javalin itself
curl -fSL -o /app/libs/javalin-6.1.6.jar \
  https://repo1.maven.org/maven2/io/javalin/javalin/6.1.6/javalin-6.1.6.jar && \

  # === Extras: pool, SQL helpers, web, JSON, CSV, migration, mail, YAML, HTML, Excel ===
# HikariCP (pool)
curl -fSL -o /app/libs/HikariCP-5.1.0.jar \
  https://repo1.maven.org/maven2/com/zaxxer/HikariCP/5.1.0/HikariCP-5.1.0.jar && \
# Jdbi core + SQL object + Jackson plugin
curl -fSL -o /app/libs/jdbi3-core-3.45.1.jar \
  https://repo1.maven.org/maven2/org/jdbi/jdbi3-core/3.45.1/jdbi3-core-3.45.1.jar && \
curl -fSL -o /app/libs/jdbi3-sqlobject-3.45.1.jar \
  https://repo1.maven.org/maven2/org/jdbi/jdbi3-sqlobject/3.45.1/jdbi3-sqlobject-3.45.1.jar && \
curl -fSL -o /app/libs/jdbi3-jackson2-3.45.1.jar \
  https://repo1.maven.org/maven2/org/jdbi/jdbi3-jackson2/3.45.1/jdbi3-jackson2-3.45.1.jar && \
# Flyway (migrations)
curl -fSL -o /app/libs/flyway-core-10.17.0.jar \
  https://repo1.maven.org/maven2/org/flywaydb/flyway-core/10.17.0/flyway-core-10.17.0.jar && \
# Jackson (JSON)
curl -fSL -o /app/libs/jackson-annotations-2.17.1.jar \
  https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-annotations/2.17.1/jackson-annotations-2.17.1.jar && \
curl -fSL -o /app/libs/jackson-core-2.17.1.jar \
  https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-core/2.17.1/jackson-core-2.17.1.jar && \
curl -fSL -o /app/libs/jackson-databind-2.17.1.jar \
  https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-databind/2.17.1/jackson-databind-2.17.1.jar && \
# Commons CSV
curl -fSL -o /app/libs/commons-csv-1.11.0.jar \
  https://repo1.maven.org/maven2/org/apache/commons/commons-csv/1.11.0/commons-csv-1.11.0.jar && \
# Javalin + deps (Kotlin + Jetty + Servlet API)
curl -fSL -o /app/libs/kotlin-stdlib-1.9.24.jar \
  https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/1.9.24/kotlin-stdlib-1.9.24.jar && \
curl -fSL -o /app/libs/kotlin-stdlib-jdk8-1.9.24.jar \
  https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-jdk8/1.9.24/kotlin-stdlib-jdk8-1.9.24.jar && \
curl -fSL -o /app/libs/jetty-server-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-server/11.0.24/jetty-server-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-http-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-http/11.0.24/jetty-http-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-io-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-io/11.0.24/jetty-io-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-util-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-util/11.0.24/jetty-util-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-security-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-security/11.0.24/jetty-security-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-servlet-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-servlet/11.0.24/jetty-servlet-11.0.24.jar && \
curl -fSL -o /app/libs/jetty-webapp-11.0.24.jar \
  https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-webapp/11.0.24/jetty-webapp-11.0.24.jar && \
curl -fSL -o /app/libs/jakarta.servlet-api-5.0.0.jar \
  https://repo1.maven.org/maven2/jakarta/servlet/jakarta.servlet-api/5.0.0/jakarta.servlet-api-5.0.0.jar && \
curl -fSL -o /app/libs/javalin-6.1.6.jar \
  https://repo1.maven.org/maven2/io/javalin/javalin/6.1.6/javalin-6.1.6.jar && \
# jOOQ (SQL DSL)
curl -fSL -o /app/libs/jooq-3.19.10.jar \
  https://repo1.maven.org/maven2/org/jooq/jooq/3.19.10/jooq-3.19.10.jar && \
# MyBatis (mapper)
curl -fSL -o /app/libs/mybatis-3.5.15.jar \
  https://repo1.maven.org/maven2/org/mybatis/mybatis/3.5.15/mybatis-3.5.15.jar && \
# Liquibase (migrations alt)
curl -fSL -o /app/libs/liquibase-core-4.27.0.jar \
  https://repo1.maven.org/maven2/org/liquibase/liquibase-core/4.27.0/liquibase-core-4.27.0.jar && \
# Jakarta Mail (email) + Activation API
curl -fSL -o /app/libs/jakarta.mail-2.0.3.jar \
  https://repo1.maven.org/maven2/com/sun/mail/jakarta.mail/2.0.3/jakarta.mail-2.0.3.jar && \
curl -fSL -o /app/libs/jakarta-activation-api-2.1.2.jar \
  https://repo1.maven.org/maven2/jakarta/activation/jakarta.activation-api/2.1.2/jakarta.activation-api-2.1.2.jar && \
# SnakeYAML (YAML)
curl -fSL -o /app/libs/snakeyaml-2.2.jar \
  https://repo1.maven.org/maven2/org/yaml/snakeyaml/2.2/snakeyaml-2.2.jar && \
# Jsoup (HTML)
curl -fSL -o /app/libs/jsoup-1.18.1.jar \
  https://repo1.maven.org/maven2/org/jsoup/jsoup/1.18.1/jsoup-1.18.1.jar && \
# Apache POI (Excel) - minimal set
curl -fSL -o /app/libs/poi-5.2.5.jar \
  https://repo1.maven.org/maven2/org/apache/poi/poi/5.2.5/poi-5.2.5.jar && \
curl -fSL -o /app/libs/poi-ooxml-5.2.5.jar \
  https://repo1.maven.org/maven2/org/apache/poi/poi-ooxml/5.2.5/poi-ooxml-5.2.5.jar && \
curl -fSL -o /app/libs/xmlbeans-5.1.1.jar \
  https://repo1.maven.org/maven2/org/apache/xmlbeans/xmlbeans/5.1.1/xmlbeans-5.1.1.jar && \
curl -fSL -o /app/libs/commons-io-2.15.1.jar \
  https://repo1.maven.org/maven2/commons-io/commons-io/2.15.1/commons-io-2.15.1.jar && \
curl -fSL -o /app/libs/commons-collections4-4.4.jar \
  https://repo1.maven.org/maven2/org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar && \
curl -fSL -o /app/libs/commons-compress-1.26.2.jar \
  https://repo1.maven.org/maven2/org/apache/commons/commons-compress/1.26.2/commons-compress-1.26.2.jar && \
curl -fSL -o /app/libs/curvesapi-1.07.jar \
  https://repo1.maven.org/maven2/com/github/virtuald/curvesapi/1.07/curvesapi-1.07.jar && \


  # JUnit 5 (standalone console runner + all deps)
curl -fSL -o /app/libs/junit-platform-console-standalone-1.10.2.jar \
  https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/1.10.2/junit-platform-console-standalone-1.10.2.jar








      

# ---- Runtime env ----
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
