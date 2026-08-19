FROM node:22-alpine

WORKDIR /app
COPY package.json server.js index.html styles.css app.js ./

ENV HOST=0.0.0.0
ENV PORT=5173

EXPOSE 5173
CMD ["node", "server.js"]
