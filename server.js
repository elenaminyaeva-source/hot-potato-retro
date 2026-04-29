const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(express.static('.'));  // Serve index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();  // room -> {hostAlive: bool, clients: Set<ws>, state: {}}

server.on('upgrade', (request, socket, head) => {
  const { url } = request;
  const params = new URLSearchParams(url.split('?')[1]);
  const room = params.get('room')?.toUpperCase() || 'MAIN';
  const isHost = params.get('host') === '1';

  if (!rooms.has(room)) rooms.set(room, { hostAlive: false, clients: new Set(), state: null });

  const roomData = rooms.get(room);
  const ws = new WebSocket(request);
  roomData.clients.add(ws);
  ws.roomData = roomData;
  ws.isHost = isHost;
  if (isHost) roomData.hostAlive = true;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'state' && ws.isHost) {
      roomData.state = msg.data;
      roomData.clients.forEach(c => { if (!c.isHost && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({type: 'state', data})); });
    } else if (msg.type === 'throwRequest') {
      roomData.clients.forEach(c => { if (c.isHost && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg)); });
    } else if (msg.type === 'intro') {
      roomData.clients.forEach(c => { if (!c.isHost && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({type: 'joined', hostOnline: roomData.hostAlive})); });
    }
  });

  ws.on('close', () => {
    roomData.clients.delete(ws);
    if (ws.isHost) roomData.hostAlive = false;
    if (roomData.clients.size === 0) rooms.delete(room);
  });

  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hot Potato WS on *:${PORT}`));
