'use strict';
const crypto = require('crypto');
const Core = require('./game');
const EXPIRY = 2 * 60 * 60 * 1000;
class RuleError extends Error {}

function createHandler(repository, options = {}) {
  const now = options.now || Date.now;
  const code = options.code || (() => String(crypto.randomInt(100000, 1000000)));
  const token = options.token || (() => crypto.randomBytes(24).toString('hex'));
  function view(room, player, includeToken = false) {
    const game = room.game;
    return { ok: true, state: {
      room: room.code, player, ready: room.members.length === 2, revision: room.revision,
      round: room.round, restartVotes: room.restartVotes, lastResult: room.lastResult,
      ...(includeToken ? { token: room.members[player].token } : {}),
      game: { ...game, boards: game.boards.map(board => ({ ...board,
        ships: board.ships.map(ship => game.over ? ship : { id: ship.id, destroyed: ship.destroyed })
      })) }
    } };
  }
  return async (event, openid) => {
    try {
      if (!openid) throw new RuleError('请从微信小程序进入游戏');
      if (!event || !['create', 'join', 'state', 'fire', 'restart'].includes(event.action)) throw new RuleError('无效的房间操作');
      if (event.action === 'create') {
        for (let attempt = 0; attempt < 10; attempt++) {
          const roomCode = code();
          const response = await repository.transaction(roomCode, existing => {
            if (existing && now() < existing.expiresAt) return { response: null };
            const room = { code: roomCode, members: [{ openid, token: token() }], game: Core.createGame(),
              revision: 0, round: 1, restartVotes: [], lastResult: null, expiresAt: now() + EXPIRY };
            return { save: room, response: view(room, 0, true) };
          });
          if (response) return response;
        }
        throw new RuleError('房间创建繁忙，请稍后重试');
      }
      if (typeof event.room !== 'string' || !/^\d{6}$/.test(event.room)) throw new RuleError('请输入 6 位房间号');
      return await repository.transaction(event.room, room => {
        if (!room || now() >= room.expiresAt) throw new RuleError('房间不存在或已过期');
        let player = room.members.findIndex(member => member.openid === openid);
        if (event.action === 'join') {
          if (player < 0) {
            if (room.members.length >= 2) throw new RuleError('房间已满');
            player = room.members.length;
            room.members.push({ openid, token: token() });
            room.revision++;
          }
          room.expiresAt = now() + EXPIRY;
          return { save: room, response: view(room, player, true) };
        }
        if (player < 0 || event.token !== room.members[player].token) throw new RuleError('房间凭证无效，请重新加入');
        if (event.action === 'state') {
          if (room.expiresAt - now() < EXPIRY / 2) {
            room.expiresAt = now() + EXPIRY;
            return { save: room, response: view(room, player) };
          }
          return { response: view(room, player) };
        }
        if (event.action === 'fire') {
          if (room.members.length < 2) throw new RuleError('等待朋友加入');
          if (event.revision !== room.revision) throw new RuleError('棋盘已更新，请重试');
          if (room.game.turn !== player) throw new RuleError('尚未轮到你');
          const result = Core.fire(room.game, event.row, event.col);
          if (!result.ok) throw new RuleError(result.reason === 'repeat' ? '这格已经猜过了' : '无法猜击此格');
          room.lastResult = result;
        } else {
          if (!room.restartVotes.includes(player)) room.restartVotes.push(player);
          if (room.restartVotes.length === 2) {
            room.game = Core.createGame(); room.round++; room.restartVotes = []; room.lastResult = null;
          }
        }
        room.revision++;
        room.expiresAt = now() + EXPIRY;
        return { save: room, response: view(room, player) };
      });
    } catch (error) {
      if (!(error instanceof RuleError)) console.error('planeDuel cloud error:', error);
      return { ok: false, error: error instanceof RuleError ? error.message : '云端服务暂时不可用，请确认云函数和数据库已配置' };
    }
  };
}
module.exports = { createHandler };
