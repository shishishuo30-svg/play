'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Core = require('../shared/game.js');

function createServer() {
  const rooms = new Map();
  function view(room, player) {
    const game = room.game;
    return { room: room.code, player, ready: room.tokens.length === 2, revision: room.revision, round: room.round,
      restartVotes: room.restartVotes, lastResult: room.lastResult,
      game: { ...game, boards: game.boards.map(board => ({ ...board,
        ships: board.ships.map(ship => game.over ? ship : { id: ship.id, destroyed: ship.destroyed })
      })) } };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const allowedOrigins = [`http://${req.headers.host}`, `https://${req.headers.host}`, process.env.PUBLIC_ORIGIN].filter(Boolean);
        if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return send(403, { error: '请从当前游戏地址操作' });
        let body = {};
        if (req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 4096) return send(413, { error: '请求过大' });
          }
          try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: '请求格式错误' }); }
          if (!body || typeof body !== 'object') return send(400, { error: '请求格式错误' });
        } else if (req.method !== 'GET') return send(405, { error: '不支持的请求' });
        const now = Date.now();
        for (const [code, room] of rooms) if (now - room.touched > 2 * 60 * 60 * 1000) rooms.delete(code);
        if (url.pathname === '/api/rooms' && req.method === 'POST') {
          if (rooms.size >= 100) return send(503, { error: '房间已满，请稍后再试' });
          let code;
          do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
          const token = crypto.randomBytes(24).toString('hex');
          const room = { code, tokens: [token], game: Core.createGame(), revision: 0, round: 1, restartVotes: [], lastResult: null, touched: now };
          rooms.set(code, room);
          return send(200, { ...view(room, 0), token });
        }
        const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|fire|restart))?$/);
        const room = match && rooms.get(match[1]);
        if (!room) return send(404, { error: '房间不存在或已过期' });
        const action = match[2];
        if (action === 'join' && req.method === 'POST') {
          if (room.tokens.length >= 2) return send(409, { error: '房间已满' });
          const token = crypto.randomBytes(24).toString('hex');
          room.tokens.push(token); room.revision++; room.touched = now;
          return send(200, { ...view(room, 1), token });
        }
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const player = room.tokens.indexOf(token);
        if (player < 0) return send(403, { error: '房间凭证无效，请重新加入' });
        room.touched = now;
        if (!action && req.method === 'GET') return send(200, view(room, player));
        if (action === 'fire' && req.method === 'POST') {
          if (room.tokens.length < 2) return send(409, { error: '等待另一位玩家加入' });
          if (body.revision !== room.revision) return send(409, { error: '棋盘已更新，请重试' });
          if (room.game.turn !== player) return send(409, { error: '尚未轮到你' });
          const result = Core.fire(room.game, body.row, body.col);
          if (!result.ok) return send(409, { error: result.reason === 'repeat' ? '这格已经猜过了' : '无法猜击此格' });
          room.lastResult = result; room.revision++;
          return send(200, view(room, player));
        }
        if (action === 'restart' && req.method === 'POST') {
          if (!room.restartVotes.includes(player)) room.restartVotes.push(player);
          if (room.restartVotes.length === 2) {
            room.game = Core.createGame(); room.restartVotes = []; room.lastResult = null; room.round++;
          }
          room.revision++;
          return send(200, view(room, player));
        }
        return send(405, { error: '不支持的请求' });
      }
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      let file;
      if (url.pathname === '/' || url.pathname === '/index.html') file = path.join(__dirname, 'index.html');
      else if (url.pathname === '/shared/game.js') file = path.join(__dirname, '../shared/game.js');
      else if (url.pathname === '/app.js') file = path.join(__dirname, 'app.js');
      else if (/^\/assets\/plane-(north|east|south|west)\.png$/.test(url.pathname)) file = path.join(__dirname, url.pathname);
      else { res.writeHead(404); return res.end('Not found'); }
      const data = await fs.promises.readFile(file);
      res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (error) {
      if (!res.headersSent) send(500, { error: '服务暂时不可用，请重试' });
      else res.end();
    }
  });
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => {
    console.log(`本机：http://localhost:${server.address().port}`);
    for (const addresses of Object.values(os.networkInterfaces())) for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`同一 Wi-Fi 的设备打开：http://${address.address}:${server.address().port}`);
    }
  });
}
module.exports = { createServer };
