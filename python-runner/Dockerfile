# ─────────────────────────────────────────────────────────────────────────────
# Polycode Python runner (Node entrypoint + Python venv)
# Drop-in replacement: includes MySQL, psycopg2 & psycopg (binary), Mongo, Redis
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    PATH="/opt/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps (keep slim; no DB client CLIs needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      unixodbc unixodbc-dev tdsodbc freetds-dev \  # pyodbc / MSSQL
      build-essential gcc g++ make \               # build tools (safe to keep)
      curl ca-certificates tzdata \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Create venv and preinstall Python packages students need
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel && \
    /opt/venv/bin/pip install --no-cache-dir \
      numpy \
      pandas \
      matplotlib \
      scipy \
      scikit-learn \
      seaborn \
      sympy \
      networkx \
      statsmodels \
      pillow \
      requests \
      # --- DB drivers (preinstalled) ---
      "SQLAlchemy>=2.0,<3.0" \
      mysql-connector-python==8.3.* \
      PyMySQL==1.1.* \
      psycopg2-binary==2.9.9 \           # enables:  import psycopg2
      "psycopg[binary]>=3.1,<4" \         # enables:  import psycopg  (v3)
      "pyodbc>=5.1,<6.0" \
      "duckdb>=1.0,<2.0" \
      "oracledb>=2.0,<3.0" \
      "pymongo>=4.6,<5.0" \
      "redis>=5.0,<6.0"

WORKDIR /app

# ── Trust store: bake your Aiven CA once and expose via common envs ──────────
# Provide aiven-ca.pem alongside this Dockerfile at build time.
COPY aiven-ca.pem /usr/local/share/ca-certificates/aiven-ca.crt
RUN update-ca-certificates
# Optional direct copy for libraries that take an explicit path
COPY aiven-ca.pem /etc/ssl/certs/aiven-ca.pem

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    MYSQL_SSL_CA=/etc/ssl/certs/aiven-ca.pem

# Node deps for the runner
COPY package.json ./
RUN npm install --omit=dev

# Runner entry
COPY python-runner.js ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
