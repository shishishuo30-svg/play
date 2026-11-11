
(() => {
  'use strict';
  const Core = window.PlaneDuelCore;
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), overlay = $('handoff'), toastEl = $('toast');
  const colNames = 'ABCDEFGHIJKL';
  let game = Core.createGame();
  let displayPlayer=0, locked=false;
  let toastTimer = 0;
  let axisReady = false;
  let flags = [new Set(), new Set()];
  let session = null, netState = null, pollTimer = 0, busy = false;
  let press = null, suppressClick = false;

  function makeAxes() {
    if (axisReady) return;
    $('colAxis').innerHTML = Array.from({length:Core.SIZE}, (_,i)=>`<span>${colNames[i]}</span>`).join('');
    $('rowAxis').innerHTML = Array.from({length:Core.SIZE}, (_,i)=>`<span>${String(i+1).padStart(2,'0')}</span>`).join('');
    axisReady = true;
  }
  function shipAt(board,row,col) {
    return board.ships.find(ship=>ship.destroyed&&ship.cells.some(cell=>cell.row===row&&cell.col===col));
  }
  function render() {
    makeAxes();
    const player=displayPlayer,target=1-player,board=game.boards[target];
    $('player0').classList.toggle('active',game.turn===0&&!game.over);
    $('player1').classList.toggle('active',game.turn===1&&!game.over);
    for(let i=0;i<2;i++) $('player'+i).querySelector('small').textContent=game.over?'对局结束':session&&!netState?.ready?'等待加入':game.turn===i?'正在猜击':session?'等待回合':'等待交接';
    $('boardTitle').textContent=`飞行员 ${target+1} 的空域`;
    $('turnPill').textContent=`P${player+1} 猜击`;
    if(session) $('turnPill').textContent=game.over?`P${game.winner+1} 获胜`:!netState?.ready?'等待玩家加入':game.turn===session.player?'轮到你猜击':'等待对手猜击';
    $('turnPill').classList.toggle('safe',game.over);
    $('shotCount').textContent=`已猜 ${board.guessCount} 格`;
    $('score').innerHTML=`${game.boards[1].ships.filter(ship=>ship.destroyed).length} <span>击落</span> : ${game.boards[0].ships.filter(ship=>ship.destroyed).length} <span>击落</span>`;
    boardEl.setAttribute('aria-label',`飞行员 ${target+1} 的隐藏空域，飞行员 ${player+1} 正在猜击`);
    let html='';
    for(let row=0;row<Core.SIZE;row++) for(let col=0;col<Core.SIZE;col++){
      const state=board.shots[row][col];
      const ship=state==='wreck'?shipAt(board,row,col):null;
      const part=ship&&ship.cells.find(cell=>cell.row===row&&cell.col===col)?.part;
      let classes='cell',mark='';
      if(state==='miss') classes+=' miss';
      else if(state==='hit'){classes+=' body-hit';mark='<span class="mark" aria-hidden="true">✓</span>';}
      else if(state==='wreck'){classes+=` wreck wreck-${part||'body'}`;mark=`<span class="partmark" aria-hidden="true">${part==='body'?'▰':part==='wing'?'◈':part==='tail'?'◆':'✈'}</span>`;}
      else if(state==='explosion'){classes+=' explosion';mark='<span class="mark" aria-hidden="true">💥</span>';}
      const flagged=!state&&flags[player].has(`${row},${col}`)&&!game.over;
      if(flagged){classes+=' flagged';mark='<span class="flag" aria-hidden="true">⚑</span>';}
      const disabled=!!state||game.over||(!session&&locked);
      const desc=state==='miss'?'未命中':state==='hit'?'命中机身，方向线索':state==='explosion'?'机头命中，飞机已击毁':state==='wreck'?'已揭示的飞机部位':'尚未猜测';
      html+=`<button class="${classes}" type="button" role="gridcell" data-row="${row}" data-col="${col}" aria-label="${colNames[col]}${row+1}，${flagged?'已标记红旗，再次长按取消':desc}" ${disabled?'disabled':''}>${mark}</button>`;
    }
    board.ships.filter(()=>game.over).forEach(ship=>{
      const top=Math.min(...ship.cells.map(c=>c.row)),left=Math.min(...ship.cells.map(c=>c.col));
      const shape=Core.orientedShape(ship.orientation);
      html+=`<img class="plane-model" alt="已击毁飞机" src="assets/plane-${ship.orientation}.png" style="top:${top/12*100}%;left:${left/12*100}%;width:${shape.width/12*100}%;height:${shape.height/12*100}%">`;
    });
    boardEl.innerHTML=html;
    document.querySelectorAll('[data-fleet]').forEach((fleet,index)=>{
      const ship=board.ships[index];
      fleet.innerHTML=`<span class="${ship.destroyed?'down':''}">✈ ${ship.destroyed?'已击毁':'未击毁'}</span>`;
      fleet.setAttribute('aria-label',`${game.boards[target].ships.filter(ship=>ship.destroyed).length} / 3 架飞机已击毁`);
    });
    $('resetBtn').disabled=false;
    $('reviewBtn').hidden=!game.over;
  }
  function showToast(message) {
    toastEl.textContent=message; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),1800);
  }
  function hideHandoff() { overlay.hidden=true; }
  function showHandoff(title,message,button='开始猜击　→',icon='✈️') {
    $('dialogTitle').textContent=title; $('dialogText').textContent=message;
    $('continueBtn').textContent=button; $('dialogIcon').textContent=icon;
    overlay.hidden=false; $('continueBtn').focus();
  }
  function onFire(event) {
    if(suppressClick){suppressClick=false;return;}
    const cell=event.target.closest('button[data-row]');
    if(!cell||locked||!overlay.hidden) return;
    const row=Number(cell.dataset.row),col=Number(cell.dataset.col);
    if(flags[displayPlayer].has(`${row},${col}`)){showToast('请先长按取消红旗，再猜击');return;}
    if(session){fireOnline(row,col);return;}
    const result=Core.fire(game,Number(cell.dataset.row),Number(cell.dataset.col));
    if(!result.ok){ if(result.reason==='repeat') showToast('这格已经猜过了'); return; }
    locked=true;
    render();
    if(result.kind==='miss') showToast(`P${result.player+1}：空域，换人猜击`);
    else if(result.kind==='hit') showToast(`P${result.player+1}：命中机身！记下线索，换人猜击`);
    else showToast(`P${result.player+1} 击毁一架飞机！`);
    const detail=result.kind==='miss'?'没有命中，这格变为空心。':result.kind==='hit'?'命中机身！红色 ✓ 已留下线索。':'击中机头！飞机已击毁，游戏结束后显形。';
    $('resultText').textContent=`P${result.player+1} · ${colNames[result.col]}${result.row+1}：${detail}`+(result.gameOver?` P${result.player+1} 已击毁三架飞机，获得胜利！`:'');
    $('nextBtn').textContent=result.gameOver?'再来一局 ↻':`交给 P${game.turn+1} →`;
    $('resultPanel').hidden=false;
  }
  $('nextBtn').addEventListener('click',()=>{
    if(session){restartOnline();return;}
    if(game.over){newGame();return;}
    showHandoff(`把设备交给 P${game.turn+1}`,'确认已交到下一位玩家手中，再开始下一回合。',`开始 P${game.turn+1} 回合 →`);
    displayPlayer=game.turn; locked=false; $('resultPanel').hidden=true; render();
  });
  function newGame() {
    if(session){restartOnline();return;}
    flags=[new Set(),new Set()];
    game=Core.createGame(); displayPlayer=0; locked=false; $('resultPanel').hidden=true; render();
    showHandoff('P1 准备出击','请把设备交给飞行员 01。对方棋盘在你确认后才会显示。','开始猜击　→','✈️');
  }
  boardEl.addEventListener('click',onFire);
  function cancelPress(){if(press) clearTimeout(press.timer);press=null;}
  boardEl.addEventListener('pointerdown',event=>{
    suppressClick=false;
    const cell=event.target.closest('button[data-row]');
    if(!cell||cell.disabled||event.button!==0||!overlay.hidden) return;
    cancelPress();
    const row=Number(cell.dataset.row),col=Number(cell.dataset.col);
    press={x:event.clientX,y:event.clientY,timer:setTimeout(()=>{
      const key=`${row},${col}`,set=flags[displayPlayer];
      if(set.has(key))set.delete(key);else set.add(key);
      suppressClick=true;press=null;render();
    },550)};
  });
  boardEl.addEventListener('pointermove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10){cancelPress();suppressClick=true;}});
  window.addEventListener('pointerup',cancelPress);
  window.addEventListener('pointercancel',cancelPress);
  window.addEventListener('blur',cancelPress);
  boardEl.addEventListener('contextmenu',event=>event.preventDefault());
  $('reviewBtn').addEventListener('click',()=>{displayPlayer=1-displayPlayer;render();});
  function saveSession(){try{if(session)sessionStorage.setItem('plane-duel-room',JSON.stringify(session));else sessionStorage.removeItem('plane-duel-room');}catch{}}
  async function api(endpoint,body,active=session){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6000);
    try{
      const response=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(active?{Authorization:`Bearer ${active.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'请求失败');
      return data;
    } finally{clearTimeout(timeout);}
  }
  function applyOnline(data){
    if(netState&&data.revision<netState.revision)return;
    const changed=!netState||data.revision!==netState.revision;
    if(netState&&data.round!==netState.round)flags=[new Set(),new Set()];
    netState=data;game=data.game;if(!game.over||changed)displayPlayer=session.player;
    locked=!data.ready||game.turn!==session.player||game.over||busy;
    overlay.hidden=true;
    $('localMode').hidden=false;
    $('createRoom').disabled=true;$('joinRoom').disabled=true;
    const state=game.over?`P${game.winner+1} 获胜，双方飞机已显形`:!data.ready?'等待另一台设备加入':game.turn===session.player?'轮到你猜击':'等待对手猜击';
    $('networkStatus').textContent=`房间 ${session.room} · 你是 P${session.player+1} · ${state}`+(data.restartVotes.length?' · 已有人申请新对局，双方点击「新对局」后开始':'');
    const result=data.lastResult;
    $('resultPanel').hidden=!result&&!data.restartVotes.length;
    $('resultText').textContent=result?`P${result.player+1} · ${colNames[result.col]}${result.row+1}：${result.kind==='miss'?'未命中':result.kind==='hit'?'命中机身 ✓':'机头命中，击毁一架飞机'}。${game.over?'游戏结束，可切换查看双方空域。':'飞机将在游戏结束后显形。'}`:'等待双方同意新对局。';
    $('nextBtn').textContent=data.restartVotes.includes(session.player)?'已申请，等待对方同意':'申请 / 同意新对局';
    if(changed)render();
  }
  function schedulePoll(){
    clearTimeout(pollTimer);
    if(!session)return;
    pollTimer=setTimeout(async()=>{
      const active=session;
      try{const data=await api(`/api/rooms/${active.room}`,undefined,active);if(session===active)applyOnline(data);}
      catch(error){if(session===active){locked=true;$('networkStatus').textContent=`连接中断：${error.message}。正在重试；返回本机双人可退出房间。`;}}
      finally{if(session===active)schedulePoll();}
    },800);
  }
  async function connect(join){
    if(location.protocol==='file:'){showToast('联机需先运行 node web/server.js，再打开局域网地址');return;}
    const code=$('roomCode').value.trim();
    if(join&&!/^\d{6}$/.test(code)){showToast('请输入 6 位房间号');return;}
    if(busy)return;busy=true;
    try{
      const data=await api(join?`/api/rooms/${code}/join`:'/api/rooms',{},null);
      session={room:data.room,token:data.token,player:data.player};netState=null;flags=[new Set(),new Set()];saveSession();busy=false;
      applyOnline(data);schedulePoll();
    }catch(error){showToast(error.message);}finally{busy=false;}
  }
  async function fireOnline(row,col){
    if(busy||!netState?.ready||game.turn!==session.player)return;
    const active=session;busy=true;locked=true;
    try{const data=await api(`/api/rooms/${active.room}/fire`,{row,col,revision:netState.revision},active);if(session===active)applyOnline(data);}
    catch(error){showToast(error.message);}
    finally{busy=false;if(session===active)locked=!netState?.ready||game.turn!==session.player||game.over;}
  }
  async function restartOnline(){
    if(busy)return;
    const active=session;busy=true;
    try{const data=await api(`/api/rooms/${active.room}/restart`,{},active);if(session===active)applyOnline(data);}
    catch(error){showToast(error.message);}finally{busy=false;}
  }
  $('createRoom').addEventListener('click',()=>connect(false));
  $('joinRoom').addEventListener('click',()=>connect(true));
  $('localMode').addEventListener('click',()=>{
    session=null;netState=null;saveSession();clearTimeout(pollTimer);busy=false;
    $('localMode').hidden=true;$('createRoom').disabled=false;$('joinRoom').disabled=false;
    $('networkStatus').textContent='已返回本机双人。创建或加入房间可开始局域网对战。';newGame();
  });
  $('continueBtn').addEventListener('click',()=>{ if(game.over) newGame(); else hideHandoff(); });
  $('resetBtn').addEventListener('click',newGame);
  render();
  try{
    const saved=JSON.parse(sessionStorage.getItem('plane-duel-room'));
    if(saved&&/^\d{6}$/.test(saved.room)&&typeof saved.token==='string'&&(saved.player===0||saved.player===1)&&location.protocol!=='file:'){
      session=saved;overlay.hidden=true;locked=true;$('localMode').hidden=false;schedulePoll();
    }
  }catch{}
})();

