# python-runner/Dockerfile
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

# Make the Aiven CA available at a fixed location and set default env
COPY certs/aiven-ca.pem /etc/ssl/certs/aiven-ca.pem
ENV MYSQL_SSL_CA=/etc/ssl/certs/aiven-ca.pem


# Node deps for runner
COPY package.json ./
RUN npm install --omit=dev

# Runner
COPY python-runner.js ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
