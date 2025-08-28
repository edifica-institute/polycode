# python-runner/Dockerfile
FROM node:18-slim

# ---- Runtime env ----
# - Use headless mpl
# - Put the venv first on PATH so "python3" resolves to venv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    PATH="/opt/venv/bin:${PATH}"

# ---- System deps ----
# python3-venv to create the venv
# libgomp/openblas/lapack: needed by numpy/scipy/sklearn wheels
# fonts-dejavu: for matplotlib text rendering
# tini: clean PID 1
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ---- Create and prime virtualenv ----
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel && \
    # install your classroom stack in the venv
    /opt/venv/bin/pip install --no-cache-dir \
      numpy pandas matplotlib scipy scikit-learn \
      seaborn sympy networkx requests \
      statsmodels pillow && \
    # ensure "python3" exists in the venv for your runner's spawn('python3', ...)
    ln -s /opt/venv/bin/python /opt/venv/bin/python3

WORKDIR /app

# ---- Node deps for the runner server ----
COPY package.json ./
RUN npm install --omit=dev

# ---- Runner code ----
COPY python-runner.js ./

# ---- Start ----
# Your server binds to 0.0.0.0:$PORT inside python-runner.js
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
