const Core = require('../../shared/game.js');
const RoomClient = require('../../shared/room-client.js');
const config = require('../../config.js');

Page({
  data: {
    online: false, connecting: false, roomCode: '', onlineStatus: '创建房间后，把 6 位房间号发给朋友即可加入。',
    turnLabel: 'P1 猜击',
    columns: 'ABCDEFGHIJKL'.split(''),
    rows: Array.from({ length: Core.SIZE }, (_, index) => String(index + 1).padStart(2, '0')),
    boardRows: [],
    models: [], resultVisible: false, resultText: '', nextLabel: '',
    player: 0,
    targetPlayer: 1,
    playerOneActive: true,
    playerTwoActive: false,
    title: '飞行员 02 的空域',
    shotCount: 0,
    scoreOne: 0,
    scoreTwo: 0,
    fleet: [],
    gameOver: false,
    winner: null,
    handoffVisible: true,
    handoffTitle: 'P1 准备出击',
    handoffText: '请把设备交给飞行员 01。对方棋盘在你确认后才会显示。',
    handoffButton: '开始猜击　→',
    handoffIcon: '✈️'
  },

  onLoad() {
    this.networkBusy = false;
    this.roomClient = new RoomClient({
      serverUrl: config.serverUrl,
      cloudEnv: config.cloudEnv,
      cloudFunction: config.cloudFunction,
      onState: state => this.applyOnline(state),
      onError: error => { this.locked = true; this.setData({ onlineStatus: `${error.message}，正在重试。` }); }
    });
    this.startGame();
    this.setData({ handoffVisible: false });
    if (this.roomClient.restore()) {
      this.locked = true;
      this.setData({ online: true, onlineStatus: '正在恢复房间连接…' });
    }
  },

  onShow() { if (this.roomClient) this.roomClient.start(); },
  onHide() { if (this.roomClient) this.roomClient.stop(); },
  onUnload() { if (this.roomClient) { this.roomClient.stop(); this.roomClient.generation++; } },

  buildRows(board) {
    return board.shots.map((row, rowIndex) => ({
      id: rowIndex,
      cells: row.map((state, colIndex) => {
        const cell = { row: rowIndex, col: colIndex, className: 'cell', mark: '' };
        if (!state && !this.game.over && this.flags[this.displayPlayer].has(`${rowIndex},${colIndex}`)) { cell.className += ' cell-flag'; cell.mark = '⚑'; }
        if (state === 'miss') cell.className += ' cell-miss';
        if (state === 'hit') { cell.className += ' cell-hit'; cell.mark = '✓'; }
        if (state === 'explosion') { cell.className += ' cell-explosion'; cell.mark = '💥'; }
        if (state === 'wreck') {
          cell.className += ' cell-wreck';
          const ship = board.ships.find(item => item.destroyed && item.cells.some(part => part.row === rowIndex && part.col === colIndex));
          const part = ship && ship.cells.find(piece => piece.row === rowIndex && piece.col === colIndex).part;
          if (part === 'wing') { cell.className += ' wreck-wing'; cell.mark = '◈'; }
          else if (part === 'tail') { cell.className += ' wreck-tail'; cell.mark = '◆'; }
          else if (part === 'head') { cell.mark = '✈'; }
          else { cell.className += ' wreck-body'; cell.mark = '▰'; }
        }
        return cell;
      })
    }));
  },

  renderGame() {
    const game = this.game;
    const player = this.displayPlayer;
    const targetPlayer = 1 - player;
    const board = game.boards[targetPlayer];
    const shotCount = board.guessCount;
    const scoreOne = game.boards[1].ships.filter(ship => ship.destroyed).length;
    const scoreTwo = game.boards[0].ships.filter(ship => ship.destroyed).length;
    this.setData({
      models: board.ships.filter(()=>game.over).map(ship=>{
        const top=Math.min(...ship.cells.map(c=>c.row)),left=Math.min(...ship.cells.map(c=>c.col));
        const shape=Core.orientedShape(ship.orientation);
        return {id:ship.id,src:`/assets/plane-${ship.orientation}.png`,style:`top:${top/12*100}%;left:${left/12*100}%;width:${shape.width/12*100}%;height:${shape.height/12*100}%`};
      }),
      player,
      targetPlayer,
      playerOneActive: game.turn === 0 && !game.over,
      playerTwoActive: game.turn === 1 && !game.over,
      turnLabel: game.over ? `P${game.winner+1} 获胜` : this.data.online ? !this.onlineState || !this.onlineState.ready ? '等待玩家加入' : game.turn === player ? '轮到你猜击' : '等待对手猜击' : `P${player+1} 猜击`,
      title: `飞行员 0${targetPlayer + 1} 的空域`,
      shotCount,
      scoreOne,
      scoreTwo,
      fleet: board.ships.map((ship, index) => ({ id: index, destroyed: ship.destroyed, slots: [0, 1, 2] })),
      boardRows: this.buildRows(board),
      gameOver: game.over,
      winner: game.winner
    });
  },

  showPass(title, text, button, icon) {
    this.setData({
      handoffVisible: true,
      handoffTitle: title,
      handoffText: text,
      handoffButton: button || '开始猜击　→',
      handoffIcon: icon || '✈️'
    });
  },

  startGame() {
    if (this.data.online) { this.restartOnline(); return; }
    this.game = Core.createGame();
    this.flags = [new Set(), new Set()];
    this.displayPlayer=0; this.locked=false; this.setData({resultVisible:false});
    this.renderGame();
    this.showPass('P1 准备出击', '请把设备交给飞行员 01。对方棋盘在你确认后才会显示。', '开始猜击　→', '✈️');
  },

  onCellTap(event) {
    if (this.longPressed) { this.longPressed = false; return; }
    if (this.data.handoffVisible || this.game.over || this.locked) return;
    const row = Number(event.currentTarget.dataset.row);
    const col = Number(event.currentTarget.dataset.col);
    if (this.flags[this.displayPlayer].has(`${row},${col}`)) {
      wx.showToast({ title: '请先长按取消红旗', icon: 'none' }); return;
    }
    if (this.data.online) { this.fireOnline(row, col); return; }
    const result = Core.fire(this.game, row, col);
    if (!result.ok) {
      if (result.reason === 'repeat') wx.showToast({ title: '这格已经猜过了', icon: 'none' });
      return;
    }
    this.locked=true;
    this.renderGame();
    const detail=result.kind==='miss'?'没有命中，这格变为空心。':result.kind==='hit'?'命中机身！红色 ✓ 已留下线索。':'击中机头！飞机已击毁，游戏结束后显形。';
    this.setData({resultVisible:true,resultText:`P${result.player+1} · ${this.data.columns[col]}${row+1}：${detail}`+(result.gameOver?` P${result.player+1} 击毁三架飞机，获得胜利！`:''),nextLabel:result.gameOver?'再来一局 ↻':`交给 P${this.game.turn+1} →`});
  },

  onCellTouchStart() { this.longPressed = false; },

  onCellLongPress(event) {
    if (this.data.handoffVisible || this.game.over || (!this.data.online && this.locked)) return;
    const row = Number(event.currentTarget.dataset.row), col = Number(event.currentTarget.dataset.col);
    if (this.game.boards[1-this.displayPlayer].shots[row][col]) return;
    const key = `${row},${col}`, flags = this.flags[this.displayPlayer];
    if (flags.has(key)) flags.delete(key); else flags.add(key);
    this.longPressed = true;
    this.renderGame();
  },

  reviewBoard() { if (this.game.over) { this.displayPlayer = 1-this.displayPlayer; this.renderGame(); } },

  nextTurn() {
    if (this.data.online) { this.restartOnline(); return; }
    if(this.game.over){this.startGame();return;}
    this.showPass(`把设备交给 P${this.game.turn+1}`,'确认已交到下一位玩家手中，再开始下一回合。',`开始 P${this.game.turn+1} 回合 →`);
    this.displayPlayer=this.game.turn; this.locked=false;
    this.setData({resultVisible:false}); this.renderGame();
  },

  continueGame() {
    if (this.game.over) {
      this.startGame();
      return;
    }
    this.setData({ handoffVisible: false });
  },

  confirmRestart() {
    if (this.data.online) { this.restartOnline(); return; }
    wx.showModal({
      title: '重新开始对局？',
      content: '当前比分和所有猜击记录都会清空。',
      confirmText: '重新开始',
      confirmColor: '#79e2c2',
      success: result => { if (result.confirm) this.startGame(); }
    });
  },

  onRoomInput(event) { this.setData({ roomCode: event.detail.value }); },
  createRoom() { this.connectRoom(); },
  joinRoom() { this.connectRoom(this.data.roomCode.trim()); },

  async connectRoom(code) {
    if (this.data.connecting || this.data.online) return;
    this.setData({ connecting: true });
    try { await this.roomClient.connect(code); }
    catch (error) { wx.showModal({ title: '联机提示', content: error.message, showCancel: false }); }
    finally { this.setData({ connecting: false }); }
  },

  applyOnline(state) {
    const previous = this.onlineState;
    if (!previous || previous.round !== state.round) this.flags = [new Set(), new Set()];
    this.onlineState = state;
    this.game = state.game;
    if (!this.game.over || !previous || previous.revision !== state.revision) this.displayPlayer = state.player;
    this.locked = !state.ready || this.game.over || this.game.turn !== state.player || this.networkBusy;
    const status = this.game.over ? `P${this.game.winner+1} 获胜，双方飞机已显形` : !state.ready ? '等待朋友加入' : this.game.turn === state.player ? '轮到你猜击' : '等待对手猜击';
    const result = state.lastResult;
    this.setData({
      online: true, handoffVisible: false,
      onlineStatus: `房间 ${state.room} · 你是 P${state.player+1} · ${status}` + (state.restartVotes.length ? ' · 有人申请新对局，双方同意后开始' : ''),
      resultVisible: !!result || state.restartVotes.length > 0,
      resultText: result ? `P${result.player+1} · ${this.data.columns[result.col]}${result.row+1}：${result.kind === 'miss' ? '未命中' : result.kind === 'hit' ? '命中机身 ✓' : '命中机头，击毁飞机'}。${this.game.over ? '游戏结束，可查看双方空域。' : '飞机在游戏结束后显形。'}` : '等待双方同意新对局。',
      nextLabel: state.restartVotes.includes(state.player) ? '已申请，等待对方同意' : '申请 / 同意新对局'
    });
    this.renderGame();
  },

  async fireOnline(row, col) {
    if (this.networkBusy || !this.onlineState || !this.onlineState.ready || this.game.turn !== this.displayPlayer) return;
    this.networkBusy = true; this.locked = true;
    try { await this.roomClient.fire(row, col); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    finally {
      this.networkBusy = false;
      if (this.data.online) this.locked = !this.onlineState || !this.onlineState.ready || this.game.over || this.game.turn !== this.roomClient.session.player;
    }
  },

  async restartOnline() {
    if (this.networkBusy) return;
    this.networkBusy = true;
    try { await this.roomClient.action('restart'); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    finally {
      this.networkBusy = false;
      if (this.data.online) this.locked = !this.onlineState || !this.onlineState.ready || this.game.over || this.game.turn !== this.roomClient.session.player;
    }
  },

  leaveRoom() {
    this.roomClient.leave(); this.onlineState = null;
    this.setData({ online: false, onlineStatus: '已返回本机双人，可重新创建或加入房间。' });
    this.startGame();
  }
});
