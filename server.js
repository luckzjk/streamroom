const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const root = __dirname;
const rooms = new Map();
const iceServers = [
  { urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" },
];

if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({
    urls: process.env.TURN_URL,
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }

  return rooms.get(roomId);
}

function sendEvent(client, message) {
  client.write(`data: ${JSON.stringify(message)}\n\n`);
}

function broadcast(roomId, message, exceptPeerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.forEach((client, peerId) => {
    if (peerId !== exceptPeerId) {
      sendEvent(client, message);
    }
  });
}

function sendTo(roomId, peerId, message) {
  const client = rooms.get(roomId)?.get(peerId);
  if (client) {
    sendEvent(client, message);
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Payload muito grande."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function serveFile(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/config") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ iceServers }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    const roomId = url.searchParams.get("room");
    const peerId = url.searchParams.get("peer");

    if (!roomId || !peerId) {
      response.writeHead(400);
      response.end("room e peer sao obrigatorios");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": conectado\n\n");

    const room = getRoom(roomId);
    room.set(peerId, response);

    sendEvent(response, {
      type: "connected",
      peers: [...room.keys()].filter((id) => id !== peerId),
    });
    broadcast(roomId, { type: "peer-joined", from: peerId }, peerId);

    request.on("close", () => {
      room.delete(peerId);
      broadcast(roomId, { type: "peer-left", from: peerId }, peerId);

      if (room.size === 0) {
        rooms.delete(roomId);
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/signal") {
    try {
      const message = await readJson(request);
      const { room, to, from, type } = message;

      if (!room || !from || !type) {
        response.writeHead(400);
        response.end("Mensagem invalida");
        return;
      }

      if (to && to !== "all") {
        sendTo(room, to, message);
      } else {
        broadcast(room, message, from);
      }

      response.writeHead(204);
      response.end();
    } catch (error) {
      response.writeHead(400);
      response.end(error.message);
    }
    return;
  }

  if (request.method === "GET") {
    serveFile(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(port, host, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}/`);

  console.log(`StreamRoom rodando em http://127.0.0.1:${port}/`);
  addresses.forEach((address) => console.log(`Na rede local: ${address}`));
});
