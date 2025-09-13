FROM node:18-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    PATH="/opt/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      unixodbc unixodbc-dev tdsodbc freetds-dev \
      build-essential gcc g++ make \
      curl ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Python venv + packages
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
      "psycopg[binary]>=3.1,<4" \
      "SQLAlchemy>=2.0,<3.0" \
      mysql-connector-python==8.3.* \
      PyMySQL==1.1.* \
      "pyodbc>=5.1,<6.0" \
      "duckdb>=1.0,<2.0" \
      "oracledb>=2.0,<3.0" \
      "pymongo>=4.6,<5.0" \
      "redis>=5.0,<6.0"

WORKDIR /app

# ── CERTS: bake Aiven CA and register into system trust store ────────────────
# 1) put the PEM into the OS trust location (must end with .crt), then update
COPY aiven-ca.pem /usr/local/share/ca-certificates/aiven-ca.crt
RUN update-ca-certificates

# 2) keep a direct copy too (backward compatibility with code using ssl_ca=)
COPY aiven-ca.pem /etc/ssl/certs/aiven-ca.pem

# 3) make sure all common clients & OpenSSL see the system bundle
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    MYSQL_SSL_CA=/etc/ssl/certs/aiven-ca.pem

# Node deps for runner
COPY package.json ./
RUN npm install --omit=dev

# Runner
COPY python-runner.js ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
