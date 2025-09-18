FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
    build-essential g++ make cmake \
    libgmp-dev libboost-all-dev \
 && rm -rf /var/lib/apt/lists/*

# Remove the strict CFLAGS/CXXFLAGS you added earlier (with -Werror).
# Optionally keep mild ones; not required:
# ENV CFLAGS="-O2 -g"
# ENV CXXFLAGS="-O2 -g"

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm i --production
COPY cc-runner.js ./cc-runner.js

RUN useradd -m runner && chown -R runner:runner /app
USER runner

ENV PORT=8083
EXPOSE 8083
CMD ["npm","start"]
