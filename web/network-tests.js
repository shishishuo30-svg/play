'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('./server');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, body, token, expected = 200) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  }
  try {
    for (const file of ['/', '/app.js', '/shared/game.js', '/assets/plane-north.png']) assert.equal((await fetch(base + file)).status, 200);
    const httpsOrigin = `https://${new URL(base).host}`;
    assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: httpsOrigin, 'Content-Type': 'application/json' }, body: '{}' })).status, 200, '支持 HTTPS 反向代理来源');
    assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403, '拒绝其他网站来源');
    const host = await request('/api/rooms', {});
    const route = `/api/rooms/${host.room}`;
    assert.equal(host.ready, false);
    await request(route + '/fire', { row: 0, col: 0, revision: 0 }, host.token, 409);
    const guest = await request(route + '/join', {});
    assert.equal(guest.player, 1);
    await request(route + '/join', {}, undefined, 409);
    await request(route, undefined, 'wrong', 403);
    let state = await request(route, undefined, host.token);
    assert.equal(state.ready, true);
    assert(state.game.boards.every(board => board.ships.every(ship => !ship.cells && !ship.head && !ship.orientation)));
    await request(route + '/fire', { row: 0, col: 0, revision: state.revision }, guest.token, 409);
    await request(route + '/fire', { row: 0, col: 0, revision: -1 }, host.token, 409);
    const tokens = [host.token, guest.token];
    const positions = [0, 0];
    let sawDestroyed = false;
    while (!state.game.over) {
      const player = state.game.turn, cell = positions[player]++;
      state = await request(route + '/fire', { row: Math.floor(cell / 12), col: cell % 12, revision: state.revision }, tokens[player]);
      const synced = await request(route, undefined, tokens[1-player]);
      assert.deepEqual(synced.game, state.game);
      if (!state.game.over) {
        for (const board of state.game.boards) {
          assert(board.ships.every(ship => !ship.cells && !ship.head && !ship.orientation));
          assert(!board.shots.flat().includes('wreck'));
          if (board.ships.some(ship => ship.destroyed)) sawDestroyed = true;
        }
      }
    }
    assert(sawDestroyed);
    assert(state.game.boards.every(board => board.ships.every(ship => ship.cells.length === 10)));
    await request(route + '/fire', { row: 11, col: 11, revision: state.revision }, tokens[state.game.turn], 409);
    const voted = await request(route + '/restart', {}, host.token);
    assert.equal(voted.game.over, true);
    assert.deepEqual(voted.restartVotes, [0]);
    const restarted = await request(route + '/restart', {}, guest.token);
    assert.equal(restarted.game.over, false);
    assert.equal(restarted.game.turn, 0);
    assert.equal(restarted.round, 2);
    assert(restarted.game.boards.every(board => board.guessCount === 0 && board.ships.every(ship => !ship.cells)));
    console.log('Network tests passed: two players, turn validation, hidden positions, full match, sync, reconnect and restart.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
