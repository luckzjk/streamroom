FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=5173

EXPOSE 5173
CMD ["node", "server/server.js"]
