# ---------- Base image ----------
FROM node:20-bullseye

# Toolchains & runtimes for all languages
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \        # Java (javac/java)
    build-essential g++ \            # C/C++
    gfortran \                       # Fortran
    python3 python3-pip \            # Python 3
    php-cli \                        # PHP
    mono-complete \                  # C# (mcs + mono runtime)
    bwbasic \                        # BASIC (Bywater BASIC interpreter)
    ca-certificates bash coreutils procps \
 && rm -rf /var/lib/apt/lists/*

# ---------- App setup ----------
WORKDIR /app

# Copy package files & install backend deps (see package.json below)
COPY package.json ./
RUN npm ci --omit=dev || npm i --omit=dev

# Copy server code (your Express + plugins live in /server)
COPY server ./server

# Runtime env (Render will inject $PORT; code should use process.env.PORT)
ENV NODE_ENV=production
ENV SANDBOX=local
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server/boot.js"]
