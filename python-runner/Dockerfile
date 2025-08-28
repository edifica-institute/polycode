# python-runner/Dockerfile
FROM node:18-slim

# ---- Runtime env ----
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg

# ---- System deps ----
# - python3 + pip
# - libgomp/openblas/lapack for numpy/scipy/sklearn wheels
# - fonts (for matplotlib text)
# - tini (clean PID1)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Node deps for the runner server ----
COPY package.json ./
RUN npm install --omit=dev

# ---- Python packages (common classroom stack) ----
# Trim this list later if you want a smaller image.
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir \
      numpy pandas matplotlib scipy scikit-learn \
      seaborn sympy networkx requests \
      statsmodels pillow

# ---- Runner code ----
COPY python-runner.js ./

# ---- Start ----
# Render sets PORT; your server binds to 0.0.0.0:PORT in python-runner.js
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
