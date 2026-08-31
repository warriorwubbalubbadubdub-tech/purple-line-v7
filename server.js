'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT) || 8080;
const INDEX_FILE = path.join(__dirname, 'index(9).html');
const STALE_MS = 20000;
const ROOM_CAPACITY = { '2009': 2, '2011': 4 };

const rooms = new Map();
const clients = new Map();

function isPrivateAddress(address) {
  if (!address) return false;
  let ip = address.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.includes(':')) {
    const first = ip.split(':')[0].toLowerCase();
    const n = parseInt(first || '0', 16);
    return (n >= 0xfc00 && n <= 0xfdff) || ip.startsWith('fe80:');
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 ||
         (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
         (parts[0] === 192 && parts[1] === 168) ||
         parts[0] === 127;
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1000000) {
        req.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { members: new Map() });
  return rooms.get(roomId);
}

function cleanRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const now = Date.now();
  for (const [id, member] of room.members) {
    if (now - member.ts > STALE_MS) room.members.delete(id);
  }
  if (room.members.size === 0) rooms.delete(roomId);
}

function snapshot(roomId) {
  cleanRoom(roomId);
  const room = rooms.get(roomId);
  const members = {};
  if (room) {
    for (const [id, member] of room.members) members[id] = member.status;
  }
  return { roomId, members };
}

function broadcast(roomId) {
  const message = `data: ${JSON.stringify(snapshot(roomId))}\n\n`;
  const set = clients.get(roomId);
  if (!set) return;
  for (const res of set) {
    try { res.write(message); } catch {}
  }
}

function removeMember(roomId, memberId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(memberId);
  if (room.members.size === 0) rooms.delete(roomId);
  broadcast(roomId);
}

function localAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (!item.internal && isPrivateAddress(item.address)) result.push(item.address);
    }
  }
  return [...new Set(result)];
}

const server = http.createServer(async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (!isPrivateAddress(remote)) return json(res, 403, { error: 'LAN-only room server.' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (req.method === 'GET' && url.pathname === '/') {
    fs.createReadStream(INDEX_FILE)
      .on('error', () => json(res, 500, { error: 'index(9).html is missing.' }))
      .pipe(res);
    return;
  }

  if (parts[0] === 'room' && parts[1]) {
    const roomId = parts[1];
    if (!ROOM_CAPACITY[roomId]) return json(res, 404, { error: "That room code doesn't exist." });

    if (req.method === 'POST' && parts[2] === 'join') {
      try {
        const body = await parseBody(req);
        const memberId = String(body.memberId || '');
        if (!/^m-[a-z0-9]{4,20}$/.test(memberId)) return json(res, 400, { error: 'Invalid member.' });
        cleanRoom(roomId);
        const room = getRoom(roomId);
        if (!room.members.has(memberId) && room.members.size >= ROOM_CAPACITY[roomId]) {
          return json(res, 409, { error: `That room is full (${ROOM_CAPACITY[roomId]}/${ROOM_CAPACITY[roomId]}).` });
        }
        room.members.set(memberId, { ts: Date.now(), status: body.status || {} });
        broadcast(roomId);
        return json(res, 200, snapshot(roomId));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    if (req.method === 'POST' && parts[2] === 'status') {
      try {
        const body = await parseBody(req);
        const memberId = String(body.memberId || '');
        const room = rooms.get(roomId);
        if (!room || !room.members.has(memberId)) return json(res, 404, { error: 'You are not in this room.' });
        room.members.set(memberId, { ts: Date.now(), status: body.status || {} });
        broadcast(roomId);
        return json(res, 200, snapshot(roomId));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    if (req.method === 'POST' && parts[2] === 'leave') {
      try {
        const body = await parseBody(req);
        removeMember(roomId, String(body.memberId || ''));
        return json(res, 200, snapshot(roomId));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    if (req.method === 'GET' && parts[2] === 'events') {
      const memberId = url.searchParams.get('member') || '';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });
      if (!clients.has(roomId)) clients.set(roomId, new Set());
      clients.get(roomId).add(res);
      res.write(`data: ${JSON.stringify(snapshot(roomId))}\n\n`);
      const cleanup = () => {
        const set = clients.get(roomId);
        if (set) {
          set.delete(res);
          if (!set.size) clients.delete(roomId);
        }
      };
      req.on('close', cleanup);
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, lanOnly: true });
  json(res, 404, { error: 'Not found.' });
});

setInterval(() => {
  for (const roomId of rooms.keys()) {
    const before = JSON.stringify(snapshot(roomId));
    cleanRoom(roomId);
    const after = JSON.stringify(snapshot(roomId));
    if (before !== after) broadcast(roomId);
  }
}, 5000).unref();

server.listen(PORT, HOST, () => {
  console.log('Purple Line LAN Room server is running.');
  console.log(`Host PC:  http://localhost:${PORT}/`);
  for (const ip of localAddresses()) console.log(`Wi-Fi:     http://${ip}:${PORT}/`);
  console.log('Only private/LAN client addresses are accepted.');
  console.log('Press Ctrl+C to stop.');
});
