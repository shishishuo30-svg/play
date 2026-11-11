'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createServer } = require('./server');
const RoomClient = require('../miniprogram/shared/room-client');
const Core = require('../miniprogram/shared/game');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pages = [];
  const errors = [];
  function makePage(storage = new Map()) {
    const platform = {
      request(options) {
        fetch(options.url, { method: options.method, headers: options.header,
          body: options.method === 'POST' ? JSON.stringify(options.data) : undefined })
          .then(async response => options.success({ statusCode: response.status, data: await response.json() }))
          .catch(options.fail);
      },
      getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
      showToast: value => errors.push(value.title), showModal: value => errors.push(value.content)
    };
    let page;
    vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/game/index.js'), 'utf8'), {
      Page(value) { page = value; }, wx: platform,
      require(name) {
        if (name === '../../shared/game.js') return Core;
        if (name === '../../config.js') return { serverUrl: base };
        if (name === '../../shared/room-client.js') return class extends RoomClient {
          constructor(options) { super({ ...options, platform }); }
        };
        throw new Error(`Unexpected import: ${name}`);
      }
    });
    page.setData = function(values) { Object.assign(this.data, values); };
    pages.push(page);
    page.onLoad();
    return page;
  }
  async function sync(page) {
    const client = page.roomClient;
    client.accept(await client.request(`/api/rooms/${client.session.room}`));
  }
  try {
    const storage = new Map(), host = makePage(storage), guest = makePage();
    assert.equal(host.data.handoffVisible, false);
    await host.connectRoom();
    assert.equal(host.data.online, true);
    assert.equal(host.locked, true);
    await guest.connectRoom(host.onlineState.room);
    await sync(host);
    assert.equal(host.locked, false);
    assert.equal(guest.locked, true);
    assert.equal(host.data.models.length, 0);
    const event = { currentTarget: { dataset: { row: 0, col: 0 } } };
    host.onCellLongPress(event);
    assert(host.flags[0].has('0,0'));
    host.onCellTap(event);
    assert.equal(host.game.boards[1].guessCount, 0, '长按不猜击');
    host.onCellLongPress(event);
    assert(!host.flags[0].has('0,0'));
    host.onCellTouchStart();
    await host.fireOnline(0, 0);
    await sync(guest);
    assert.equal(host.game.turn, 1);
    assert.equal(guest.game.turn, 1);
    assert.equal(guest.locked, false);
    assert.equal(host.game.boards[1].guessCount, 1);
    assert(guest.game.boards.every(board => board.ships.every(ship => !ship.cells)));
    host.onHide();
    assert.equal(host.roomClient.polling, false);
    host.onShow();
    assert.equal(host.roomClient.polling, true);
    host.onUnload();
    const restored = makePage(storage);
    await sync(restored);
    assert.equal(restored.roomClient.session.room, guest.roomClient.session.room);
    assert.equal(restored.game.boards[1].guessCount, 1);
    await restored.restartOnline();
    await sync(guest);
    await guest.restartOnline();
    await sync(restored);
    assert.equal(restored.onlineState.round, 2);
    assert.equal(restored.flags[0].size, 0);
    assert.equal(restored.game.boards[1].guessCount, 0);
    guest.leaveRoom();
    assert.equal(guest.data.online, false);
    assert.equal(guest.roomClient.session, null);
    assert.equal(guest.roomClient.polling, false);
    assert.deepEqual(errors, []);
    console.log('Mini program tests passed: real server room flow, sync, flags, hidden planes, restore, lifecycle, restart and leave.');
  } finally {
    pages.forEach(page => page.onUnload());
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
