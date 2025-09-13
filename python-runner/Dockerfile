# python-runner/Dockerfile
FROM node:18-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    PATH="/opt/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ---- System deps ----
# - python3/venv/pip: run Python code + venv
# - BLAS/LAPACK: numpy/scipy
# - fonts: matplotlib text
# - unixODBC: pyodbc for SQL Server ODBC
# - build-essential, gcc/g++, make: occasional wheel builds
# - curl/gnupg: add Microsoft repo (optional but useful for msodbcsql)
# - tini: clean PID 1
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      unixodbc unixodbc-dev \
      build-essential gcc g++ make \
      curl ca-certificates gnupg \
      tini && \
    rm -rf /var/lib/apt/lists/*

# ---- OPTIONAL (recommended for full SQL Server ODBC) ----
# Installs Microsoft's ODBC driver (msodbcsql18) + tools.
# If this block ever fails due to Debian base changes, comment it out:
# pyodbc will still work for many cases, but full SQL Server connectivity usually
# needs msodbcsql. You may also switch to msodbcsql17 if 18 isn't available.
RUN set -eux; \
    . /etc/os-release; \
    if [ "${ID}" = "debian" ]; then \
      curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg; \
      echo "deb [signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/${VERSION_CODENAME}/prod ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/microsoft-prod.list; \
      apt-get update || true; \
      ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 mssql-tools18 || \
      (echo "msodbcsql18 not available; trying msodbcsql17..." && \
       ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql17 mssql-tools); \
      rm -rf /var/lib/apt/lists/*; \
    fi

# ---- Python venv + packages ----
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel && \
    /opt/venv/bin/pip install --no-cache-dir \
      # Scientific / DS stack
      numpy pandas matplotlib scipy scikit-learn seaborn sympy networkx statsmodels pillow \
      # HTTP / utils
      requests \
      # Relational DBs
      "psycopg[binary]>=3.1,<4" SQLAlchemy>=2.0,<3.0 \
      mysql-connector-python==8.3.* PyMySQL==1.1.* \
      pyodbc>=5.1,<6.0 \
      duckdb>=1.0,<2.0 \
      # No-client SQLite is stdlib: import sqlite3
      # No-client Oracle thin driver
      oracledb>=2.0,<3.0 \
      # NoSQL
      pymongo>=4.6,<5.0 \
      redis>=5.0,<6.0

WORKDIR /app

# ---- Node deps for the runner server ----
COPY package.json ./
RUN npm install --omit=dev

# ---- Runner code ----
COPY python-runner.js ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
