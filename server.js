const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const rooms = new Map();

function getRoom(roomCode) {
  const key = String(roomCode || 'MAIN').toUpperCase();
  if (!rooms.has(key)) {
    rooms.set(key, {
      code: key,
      host: null,
      clients: new Map(),
      state: null
    });
  }
  return rooms.get(key);
}

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToPlayers(room, payload) {
  for (const [, client] of room.clients) {
    if (!client.isHost) safeSend(client.ws, payload);
  }
}

function removeClient(room, clientId) {
  const client = room.clients.get(clientId);
  if (!client) return;

  const wasHost = client.isHost;
  room.clients.delete(clientId);

  if (wasHost && room.host === clientId) {
    room.host = null;
    for (const [, other] of room.clients) {
      safeSend(other.ws, { type: 'hostOffline' });
    }
  } else {
    if (room.host && room.clients.has(room.host)) {
      const hostClient = room.clients.get(room.host);
      safeSend(hostClient.ws, { type: 'leave', clientId });
    }
  }

  if (room.clients.size === 0) {
    rooms.delete(room.code);
  }
}

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, decodeURIComponent(reqPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomCode = (url.searchParams.get('room') || 'MAIN').toUpperCase();
  const isHost = url.searchParams.get('host') === '1';
  const room = getRoom(roomCode);

  const clientId = `c_${Math.random().toString(36).slice(2, 10)}`;
  const client = {
    id: clientId,
    ws,
    roomCode,
    isHost,
    name: isHost ? 'Host' : 'Guest',
    watcher: false,
    joinedAt: Date.now()
  };

  if (isHost) {
    if (room.host && room.clients.has(room.host)) {
      safeSend(ws, { type: 'error', message: 'Host already exists for this room.' });
      ws.close();
      return;
    }
    room.host = clientId;
  }

  room.clients.set(clientId, client);

  safeSend(ws, {
    type: 'joined',
    room: roomCode,
    clientId,
    isHost,
    hostOnline: !!room.host
  });

  if (!isHost && room.state) {
    safeSend(ws, { type: 'state', data: room.state });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'intro') {
      client.name = String(msg.name || 'Guest').trim() || 'Guest';
      client.watcher = !!msg.watcher;
      client.joinedAt = Number(msg.joinedAt) || Date.now();

      if (room.host && room.clients.has(room.host)) {
        const hostClient = room.clients.get(room.host);
        safeSend(hostClient.ws, {
          type: 'intro',
          clientId: client.id,
          name: client.name,
          watcher: client.watcher,
          joinedAt: client.joinedAt
        });
      }

      if (room.state) {
        safeSend(ws, { type: 'state', data: room.state });
      }
      return;
    }

    if (msg.type === 'state') {
      if (!client.isHost) return;
      room.state = msg.data;
      broadcastToPlayers(room, { type: 'state', data: room.state });
      return;
    }

    if (msg.type === 'throwRequest') {
      if (!room.host || !room.clients.has(room.host)) return;
      const hostClient = room.clients.get(room.host);
      safeSend(hostClient.ws, {
        type: 'throwRequest',
        actor: String(msg.actor || ''),
        targetName: String(msg.targetName || ''),
        clientId: client.id
      });
      return;
    }
  });

  ws.on('close', () => {
    removeClient(room, clientId);
  });

  ws.on('error', () => {
    removeClient(room, clientId);
  });
});

server.listen(PORT, () => {
  console.log(`Hot Potato Retro server running on http://localhost:${PORT}`);
});
