// Tap map for the Future Family Holidays games (added 28 Oct 2026).
// Records where people tap, whether the tap hit something that does anything, swipe attempts
// and "rage taps" (3+ quick taps in one spot). Anonymous: position as a fraction of the game card, no text typed.
(function(){
  if (!/^https?:/.test(location.protocol)) return;
  var q = [], last = [], down = null, T0 = Date.now();
  function ls(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function ss(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
  function game(){ return /[?&]game=v1/.test(location.search) || /\/play\/(v1|vote-game)/.test(location.pathname) ? 'v1'
    : (/[?&]intro=1/.test(location.search) || /\/play\/(go|start)/.test(location.pathname)) ? 'v2intro' : 'v2'; }
  function screen(){
    var s = '';
    try { if (typeof S !== 'undefined' && S) { s = S.screen || S.phase || ''; if (typeof S.i === 'number' && (S.screen === 'card' || S.phase)) s += ':' + (S.i + 1); } } catch(e){}
    var hs = document.querySelectorAll('h1, h2'), h = null;
    for (var i = 0; i < hs.length; i++) { var r = hs[i].getBoundingClientRect(); if (r.width && r.height && r.bottom > 0 && r.top < innerHeight && getComputedStyle(hs[i]).visibility !== 'hidden') { h = hs[i]; break; } }
    return { s: s, h: h ? h.textContent.trim().slice(0, 40) : '' };
  }
  function box(){ var a = document.querySelector('.app') || document.getElementById('app') || document.body; return a.getBoundingClientRect(); }
  function desc(el){
    if (!el || el.nodeType !== 1) return '';
    var d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    var c = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (c.length) d += '.' + c.join('.');
    return d.slice(0, 50);
  }
  var LIVE = 'button,a,input,select,textarea,label,summary,[role=button],[onclick],.clk,.chip,.b,[data-dq],[data-dv],.mute,.back,#back,video[controls]';
  function push(name, props){
    var sc = screen();
    props.game = game(); props.scr = sc.s; props.h = sc.h; props.v = props.game === 'v1' ? 'v1' : 'v2';
    props.intro = props.game === 'v2intro' ? 1 : 0;
    q.push({ name: name, t: Date.now() - T0, at: new Date().toISOString(), props: props });
    if (q.length >= 20) flush(false);
  }
  function flush(beacon){
    if (!q.length) return;
    var body = JSON.stringify({ device: ls('esv_ffh_device') || 'anon', session: ss('esv_ffh_session') || ('t' + T0),
      tester: ls('esv_ffh_tester') === '1', page: location.href.split('#')[0], events: q.splice(0, 50) });
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/ffh/events', new Blob([body], { type: 'application/json' }));
      else fetch('/api/ffh/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
    } catch(e){}
  }
  document.addEventListener('pointerdown', function(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now(), el: e.target };
  }, true);
  document.addEventListener('pointerup', function(e){
    if (!down) return;
    var b = box(), dx = e.clientX - down.x, dy = e.clientY - down.y, el = down.el;
    var fx = Math.round(((down.x - b.left) / Math.max(1, b.width)) * 100) / 100;
    var fy = Math.round(((down.y - b.top) / Math.max(1, b.height)) * 100) / 100;
    var live = el && el.closest ? el.closest(LIVE) : null;
    var disabled = !!(live && (live.disabled || live.getAttribute('aria-disabled') === 'true'));
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
      // a drag: horizontal on the photo = trying to swipe the card
      var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (dir === 'left' || dir === 'right') push('swipe_try', { x: fx, y: fy, dir: dir, on: desc(el), ms: Date.now() - down.t });
    } else {
      push('tap', { x: fx, y: fy, hit: live && !disabled ? desc(live) : '', dead: live && !disabled ? 0 : 1, on: desc(el), off: down.y > b.bottom || down.y < b.top || down.x < b.left || down.x > b.right ? 1 : 0, disabled: disabled ? 1 : 0 });
      var now = Date.now();
      last = last.filter(function(p){ return now - p.t < 900 && Math.abs(p.x - down.x) < 40 && Math.abs(p.y - down.y) < 40; });
      last.push({ t: now, x: down.x, y: down.y });
      if (last.length === 3) push('rage_tap', { x: fx, y: fy, on: desc(el), dead: live && !disabled ? 0 : 1 });
    }
    down = null;
  }, true);
  setInterval(function(){ flush(false); }, 5000);
  document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', function(){ flush(true); });
})();
