FROM node:20-bullseye

# JDK (for javac/java) + GCC (for C) + certs
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install --omit=dev

# App files
COPY java-runner.js ./
# ⬅️ IMPORTANT: copy the new C plugin into the image
COPY c-plugin.js ./

# Build runner.jar (Java launcher)
COPY io /app/io
RUN javac -encoding UTF-8 -d out io/polycode/*.java && \
    jar --create --file runner.jar -C out .

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
# You can omit this; Render sets PORT at runtime and your code already reads it.
# ENV PORT=8081

EXPOSE 8081
CMD ["npm","start"]
