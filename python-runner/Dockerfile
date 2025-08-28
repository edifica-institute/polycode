# python-runner/Dockerfile
FROM node:18-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    PATH="/opt/venv/bin:${PATH}"

# System deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgomp1 libopenblas0 liblapack3 \
      fonts-dejavu-core \
      tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create venv and install packages into it
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel && \
    /opt/venv/bin/pip install --no-cache-dir \
      numpy pandas matplotlib scipy scikit-learn \
      seaborn sympy networkx requests \
      statsmodels pillow
# If you *really* need to enforce a python3 name, use a conditional symlink:
# RUN [ -e /opt/venv/bin/python3 ] || ln -s /opt/venv/bin/python /opt/venv/bin/python3

WORKDIR /app

# Node deps for the runner server
COPY package.json ./
RUN npm install --omit=dev

# Runner code
COPY python-runner.js ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "python-runner.js"]
