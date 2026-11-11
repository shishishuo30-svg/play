'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Core = require('../shared/game');

const elements = new Map(), timers = new Map();
let nextTimer = 0, shots = 0;
function element() {
  return { hidden: true, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    setAttribute() {}, querySelector() { return this; }, focus() {}, innerHTML: '', textContent: '' };
}
const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll() { return []; } };
const window = { PlaneDuelCore: { ...Core, fire(...args) { shots++; return Core.fire(...args); } }, addEventListener() {} };
vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'), 'utf8'), {
  window, document, location: { protocol: 'file:' }, sessionStorage: { getItem() { return null; } },
  setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
  clearTimeout(id) { timers.delete(id); }
});
const board = elements.get('board');
const cell = { disabled: false, dataset: { row: '0', col: '0' } };
const event = { button: 0, clientX: 10, clientY: 10, target: { closest() { return cell; } } };
function longPress() {
  board.handlers.pointerdown(event);
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === 550);
  assert(entry, '长按计时器存在');
  timers.delete(entry[0]); entry[1].fn();
}
longPress();
assert(board.innerHTML.includes('已标记红旗'));
board.handlers.click(event);
assert.equal(shots, 0, '长按不会猜击');
board.handlers.pointerdown(event);
board.handlers.click(event);
assert.equal(shots, 0, '短按红旗格不会误猜击');
longPress();
assert(!board.innerHTML.includes('已标记红旗'));
board.handlers.click(event);
assert.equal(shots, 0, '取消红旗不会猜击');
board.handlers.pointerdown(event);
board.handlers.pointermove({ clientX: 100, clientY: 100 });
board.handlers.click(event);
assert.equal(shots, 0, '滑动取消长按且不猜击');
board.handlers.pointerdown(event);
board.handlers.click(event);
assert.equal(shots, 1, '普通短按猜击');
console.log('Client tests passed: long press flag, cancel flag, no accidental shots, movement cancellation and short tap.');
