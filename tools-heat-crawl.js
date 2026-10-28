// Screenshot every screen of each game, keyed exactly like taps.js (game | visible heading)
const {chromium}=require('playwright'); const crypto=require('crypto'); const fs=require('fs');
const OUT='/home/claude/esv-game/ffh2/v/heat/'; const man={}; let OLD={}; try{OLD=Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(OUT+'index.json'))).filter(([k])=>k.startsWith('v1|')));}catch(e){}
const IG='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';
const KEY=`(()=>{const hs=document.querySelectorAll('h1, h2');for(const x of hs){const r=x.getBoundingClientRect();if(r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(x).visibility!=='hidden')return x.textContent.trim().slice(0,40);}return '';})()`;
async function snap(pg,game,ia){
  const h=await pg.evaluate(KEY); const k=game+'|'+h+(ia?'|inapp':''); if(man[k]) return;
  const app=(await pg.$('.app'))||(await pg.$('#app')); if(!app) return;
  const f=crypto.createHash('md5').update(k).digest('hex').slice(0,10)+'.jpg';
  await pg.evaluate(()=>window.scrollTo(0,0)); await pg.waitForTimeout(400);
  await app.screenshot({path:OUT+f,type:'jpeg',quality:70});
  const bb=await app.boundingBox(); man[k]={f,w:Math.round(bb.width),h:Math.round(bb.height)}; console.log(k);
}
async function clickNext(pg,mode,step){
  return await pg.evaluate(({mode,step})=>{
    const vis=b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&!b.disabled&&getComputedStyle(b).visibility!=='hidden'&&b.offsetParent!==null;};
    const pick=sel=>[...document.querySelectorAll(sel)].filter(vis);
    let c=pick('#start'); if(c.length){c[0].click();return 'start';}
    c=pick(mode==='no'||(mode==='mix'&&step%2)?'#no':'#yes'); if(c.length){c[0].click();return 'yn';}
    // fill any choice groups on the screen, then press the main button
    const age=pick('[data-age]'); if(age.length && !document.querySelector('.kidchip')) age[5%age.length].click();
    const groups=new Set(pick('.chip').map(x=>x.parentElement)); groups.forEach(g=>{ if(g.querySelector('[data-age]')) return; const ch=[...g.querySelectorAll('.chip')].filter(vis); if(ch.length&&!g.querySelector('.on,.sel,.active,[aria-pressed="true"]')) ch[step%ch.length].click(); });
    pick('.choice,.toy,.opt,.pick,.ans,[data-dq]').slice(0,1).forEach(x=>x.click());
    c=[]; for(const sel of ['#go','#startBtn','#agesNext','#next','#unlock','.b.yes','.btn.primary','.btn','.b.wide']){ c=pick(sel).filter(b=>!/back|mute|music|undo|restart|resume|iconbtn|linkbtn/i.test(b.id+' '+b.className)); if(c.length) break; }
    if(!c.length) c=pick('button').filter(b=>!/back|mute|music|undo|restart|resume|iconbtn|linkbtn/i.test(b.id+' '+b.className)&&!/^‹|Start again/.test(b.textContent.trim()));
    if(!c.length) return false; c[0].click(); return (c[0].id||c[0].className||c[0].textContent).slice(0,30);
  },{mode,step});
}
(async()=>{const b=await chromium.launch();
for(const [u,game,mode,ia] of [['/play?intro=1','v2intro','yes',0],['/play','v2','yes',0],['/play','v2','no',0],['/play','v2','mix',0],['/play?intro=1','v2intro','yes',1],['/play','v2','yes',1],['/play','v2','no',1],['/play','v2','mix',1]]){
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true,...(ia?{userAgent:IG}:{})});const pg=await ctx.newPage();
  await pg.goto('http://localhost:10123'+u+(u.includes('?')?'&':'?')+'tester=1');await pg.waitForTimeout(2500);
  let last='',same=0;
  for(let i=0;i<70;i++){ await snap(pg,game,ia); const r=await clickNext(pg,mode,i); await pg.waitForTimeout(1800);
    const h=await pg.evaluate(KEY); if(h===last){ if(++same>4) break; } else {same=0; last=h;} if(!r) break; }
  await ctx.close(); }
Object.assign(man,OLD);fs.writeFileSync(OUT+'index.json',JSON.stringify(man)); await b.close(); console.log(Object.keys(man).length,'screens');})();
