const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

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

function createRoomId() {
  return `sala-${randomUUID().slice(0, 8)}`;
}

function normalizeRoomName(name, roomId) {
  const value = String(name || "").trim().slice(0, 42);
  return value || `Sala ${roomId.replace("sala-", "")}`;
}

function normalizeRoomLimit(limit) {
  const value = Number(limit);

  if (!Number.isFinite(value)) {
    return 8;
  }

  return Math.min(Math.max(Math.round(value), 2), 50);
}

function getRoom(roomId, options = {}) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      name: normalizeRoomName(options.name, roomId),
      limit: normalizeRoomLimit(options.limit),
      clients: new Map(),
    });
  }

  return rooms.get(roomId);
}

function sendEvent(client, message) {
  client.write(`data: ${JSON.stringify(message)}\n\n`);
}

function broadcast(roomId, message, exceptPeerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.clients.forEach((client, peerId) => {
    if (peerId !== exceptPeerId) {
      sendEvent(client.response, message);
    }
  });
}

function sendTo(roomId, peerId, message) {
  const client = rooms.get(roomId)?.clients.get(peerId);
  if (client) {
    sendEvent(client.response, message);
  }
}

function getPeerList(room) {
  return [...room.clients.entries()].map(([id, client]) => ({
    id,
    profile: client.profile,
  }));
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

  if (request.method === "POST" && url.pathname === "/rooms") {
    try {
      const data = await readJson(request);
      const roomId = createRoomId();
      const room = getRoom(roomId, {
        name: data.name,
        limit: data.limit,
      });

      response.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ id: room.id, name: room.name, limit: room.limit }));
    } catch (error) {
      response.writeHead(400);
      response.end(error.message);
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/room") {
    const roomId = url.searchParams.get("room");
    const room = roomId ? getRoom(roomId) : null;

    if (!room) {
      response.writeHead(404);
      response.end("Sala nao encontrada");
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      id: room.id,
      name: room.name,
      limit: room.limit,
      count: room.clients.size,
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    const roomId = url.searchParams.get("room");
    const peerId = url.searchParams.get("peer");
    const profile = {
      name: String(url.searchParams.get("name") || "Convidado").slice(0, 32),
      photo: "",
    };

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

    if (!room.clients.has(peerId) && room.clients.size >= room.limit) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      sendEvent(response, { type: "room-full", room: { id: room.id, name: room.name, limit: room.limit } });
      response.end();
      return;
    }

    room.clients.set(peerId, { response, profile });

    sendEvent(response, {
      type: "connected",
      room: { id: room.id, name: room.name, limit: room.limit },
      peers: getPeerList(room).filter((peer) => peer.id !== peerId),
    });
    broadcast(roomId, { type: "peer-joined", from: peerId, profile }, peerId);

    request.on("close", () => {
      room.clients.delete(peerId);
      broadcast(roomId, { type: "peer-left", from: peerId }, peerId);

      if (room.clients.size === 0) {
        rooms.delete(roomId);
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/signal") {
    try {
      const message = await readJson(request);
      const { room, to, from, type, profile } = message;

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

      if (type === "profile-updated" && profile) {
        const client = rooms.get(room)?.clients.get(from);
        if (client) {
          client.profile = {
            name: String(profile.name || "Convidado").slice(0, 32),
            photo: String(profile.photo || "").slice(0, 180000),
          };
        }
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
