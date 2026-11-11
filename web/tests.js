(function (root) {
  const Core = typeof require === 'function' ? require('../shared/game.js') : root.PlaneDuelCore;
  const assert = (condition, message) => { if (!condition) throw new Error(`测试失败：${message}`); };
  function seeded(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  for (let seed = 1; seed <= 120; seed++) {
    const board = Core.createBoard(seeded(seed));
    assert(board.ships.length === 3, `seed ${seed}: 生成三架飞机`);
    const occupied = new Set();
    board.ships.forEach(ship => {
      assert(ship.cells.length === 10, `seed ${seed}: 飞机有十个部位格`);
      assert(ship.cells.filter(cell => cell.part === 'head').length === 1, `seed ${seed}: 每架只有一个机头`);
      ship.cells.forEach(cell => {
        const key = `${cell.row},${cell.col}`;
        assert(!occupied.has(key), `seed ${seed}: 飞机不可重叠`);
        occupied.add(key);
      });
    });
    const cells = [...occupied].map(key => key.split(',').map(Number));
    for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
      const [r1, c1] = cells[a]; const [r2, c2] = cells[b];
      const differentShips = !board.ships.some(ship => ship.cells.some(cell => cell.row === r1 && cell.col === c1) && ship.cells.some(cell => cell.row === r2 && cell.col === c2));
      if (differentShips) assert(Math.max(Math.abs(r1-r2), Math.abs(c1-c2)) > 1, `seed ${seed}: 不同飞机保持一格间隔`);
    }
  }

  const game = Core.createGame(seeded(88));
  const board = game.boards[1];
  const body = board.ships[0].cells.find(cell => cell.part === 'body');
  const bodyShot = Core.fire(game, body.row, body.col);
  assert(bodyShot.kind === 'hit' && game.turn === 1, '机身命中显示命中并切换回合');
  game.turn = 0;
  assert(Core.fire(game, body.row, body.col).reason === 'repeat' && game.turn === 0, '重复点击不消耗回合');
  const miss = (() => { for(let row=0;row<12;row++) for(let col=0;col<12;col++) if(!board.ships.some(ship=>ship.cells.some(cell=>cell.row===row&&cell.col===col))&&!board.shots[row][col]) return {row,col}; })();
  const missShot = Core.fire(game, miss.row, miss.col);
  assert(missShot.kind === 'miss' && game.turn === 1, '空格命中判定并切换回合');
  assert(Core.fire(game, 12, 0).reason === 'invalid', '越界点击被拒绝');
  const destroy = (whichPlayer) => {
    game.turn = whichPlayer;
    const target = game.boards[1 - whichPlayer];
    for (const ship of target.ships.filter(item => !item.destroyed)) {
      game.turn = whichPlayer;
      const shot = Core.fire(game, ship.head.row, ship.head.col);
      assert(shot.kind === 'destroyed', '命中机头直接摧毁飞机');
      assert(target.shots[ship.head.row][ship.head.col] === 'explosion', '命中机头保留爆炸标记');
      assert(ship.cells.filter(cell => cell.part !== 'head').every(cell => !['wreck','explosion'].includes(target.shots[cell.row][cell.col])), '击毁后不揭示其他部位');
    }
  };
  destroy(0);
  assert(game.over && game.winner === 0, '先击毁三架飞机者胜利');
  assert(Core.fire(game, 0, 0).reason === 'over', '游戏结束后不能继续射击');
  const report = 'Plane Duel tests passed: 120 seeded layouts and game rules.';
  if (typeof console !== 'undefined') console.log(report);
  if (typeof module === 'object' && module.exports) module.exports = report;
})(typeof globalThis !== 'undefined' ? globalThis : this);
