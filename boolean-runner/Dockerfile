# Boolean Algebra service
FROM node:20-alpine
WORKDIR /app
COPY boolean-runner.js ./boolean-runner.js
RUN npm init -y && npm pkg set type=module && npm i express@4 cors
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
CMD ["node","boolean-runner.js"]
