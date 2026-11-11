(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlaneDuelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 12;
  const FLEET_SIZE = 3;
  const ORIENTATIONS = ['north', 'east', 'south', 'west'];
  const SHAPE = [
    [0, 2, 'head'], [1, 0, 'wing'], [1, 1, 'wing'], [1, 2, 'body'],
    [1, 3, 'wing'], [1, 4, 'wing'], [2, 2, 'body'],
    [3, 1, 'tail'], [3, 2, 'body'], [3, 3, 'tail']
  ];

  function rotate(row, col, orientation) {
    if (orientation === 'east') return [col, -row];
    if (orientation === 'south') return [-row, -col];
    if (orientation === 'west') return [-col, row];
    return [row, col];
  }

  function orientedShape(orientation) {
    const cells = SHAPE.map(([row, col, part]) => {
      const [r, c] = rotate(row, col, orientation);
      return { row: r, col: c, part };
    });
    const minRow = Math.min(...cells.map(cell => cell.row));
    const minCol = Math.min(...cells.map(cell => cell.col));
    const normalized = cells.map(cell => ({ ...cell, row: cell.row - minRow, col: cell.col - minCol }));
    return {
      height: Math.max(...normalized.map(cell => cell.row)) + 1,
      width: Math.max(...normalized.map(cell => cell.col)) + 1,
      cells: normalized
    };
  }

  function createBoard(random, restart) {
    const rand = random || Math.random;
    const ships = [];
    const occupied = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    for (let shipIndex = 0; shipIndex < FLEET_SIZE; shipIndex++) {
      let placed = false;
      for (let attempt = 0; attempt < 25000 && !placed; attempt++) {
        const orientation = ORIENTATIONS[Math.floor(rand() * ORIENTATIONS.length)];
        const shape = orientedShape(orientation);
        const top = Math.floor(rand() * (SIZE - shape.height + 1));
        const left = Math.floor(rand() * (SIZE - shape.width + 1));
        const cells = shape.cells.map(cell => ({ ...cell, row: cell.row + top, col: cell.col + left }));
        const fits = cells.every(cell => {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const row = cell.row + dr;
              const col = cell.col + dc;
              if (row >= 0 && row < SIZE && col >= 0 && col < SIZE && occupied[row][col]) return false;
            }
          }
          return true;
        });
        if (!fits) continue;
        cells.forEach(cell => { occupied[cell.row][cell.col] = true; });
        const head = cells.find(cell => cell.part === 'head');
        ships.push({ id: shipIndex + 1, orientation, head: { row: head.row, col: head.col }, cells, destroyed: false });
        placed = true;
      }
      if (!placed) {
        if ((restart || 0) < 50) return createBoard(rand, (restart || 0) + 1);
        throw new Error('无法生成布局，请重试');
      }
    }
    return { ships, guessCount: 0, shots: Array.from({ length: SIZE }, () => Array(SIZE).fill('')) };
  }

  function createGame(random) {
    return { size: SIZE, turn: 0, winner: null, over: false, boards: [createBoard(random), createBoard(random)] };
  }

  function fire(game, row, col) {
    if (!game || game.over) return { ok: false, reason: 'over' };
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
      return { ok: false, reason: 'invalid' };
    }
    const player = game.turn;
    const target = 1 - player;
    const board = game.boards[target];
    if (board.shots[row][col]) return { ok: false, reason: 'repeat' };
    board.guessCount++;
    let hitShip = null;
    let hitCell = null;
    for (const ship of board.ships) {
      hitCell = ship.cells.find(cell => cell.row === row && cell.col === col);
      if (hitCell) { hitShip = ship; break; }
    }
    if (!hitShip) {
      board.shots[row][col] = 'miss';
      game.turn = target;
      return { ok: true, kind: 'miss', player, target, row, col };
    }
    if (hitCell.part !== 'head') {
      board.shots[row][col] = 'hit';
      game.turn = target;
      return { ok: true, kind: 'hit', player, target, row, col, shipId: hitShip.id };
    }
    hitShip.destroyed = true;
    board.shots[row][col] = 'explosion';
    const destroyed = board.ships.filter(ship => ship.destroyed).length;
    if (destroyed === FLEET_SIZE) {
      game.over = true;
      game.winner = player;
    } else {
      game.turn = target;
    }
    return { ok: true, kind: 'destroyed', player, target, row, col, shipId: hitShip.id, destroyed, gameOver: game.over };
  }

  return { SIZE, FLEET_SIZE, ORIENTATIONS, orientedShape, createBoard, createGame, fire };
});
