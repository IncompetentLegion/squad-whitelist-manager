FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data

ENV DB_PATH=/data/whitelist.db
ENV NODE_ENV=production
EXPOSE 36419

CMD ["node", "server.js"]
