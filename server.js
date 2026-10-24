// Zero-dependency server: static game + ranking API + WebSocket room relay
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const PORT=process.env.PORT||3000,DB=path.join(__dirname,'ranks.json');
let R=[];try{R=JSON.parse(fs.readFileSync(DB))}catch(e){}
const html=zlib.gzipSync(fs.readFileSync(path.join(__dirname,'index.html'))),hits={};
const J=(s,c,o)=>{s.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'});s.end(JSON.stringify(o||{}))};
const srv=http.createServer((q,s)=>{
 const u=new URL(q.url,'http://x').pathname;
 if(u=='/healthz')return s.end('ok');
 if(u=='/api/rank'&&q.method=='GET')return J(s,200,R.slice(0,20));
 if(u=='/api/score'&&q.method=='POST'){
  const ip=(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0],now=Date.now();
  if(hits[ip]&&now-hits[ip]<8000)return J(s,429);hits[ip]=now;
  let b='';q.on('data',c=>{b+=c;if(b.length>600)q.destroy()});
  q.on('end',()=>{try{const d=JSON.parse(b),sc=Math.floor(+d.score),n=String(d.name||'').replace(/[<>&"'`]/g,'').slice(0,12)||'NONAME';
   if(!(sc>=0&&sc<=20000))return J(s,400);
   R.push({n,s:sc,m:Math.min(11,Math.max(0,d.m|0)),t:now});R.sort((a,b)=>b.s-a.s);R=R.slice(0,100);
   fs.writeFile(DB,JSON.stringify(R),()=>{});J(s,200,{ok:1})}catch(e){J(s,400)}});return}
 if(u=='/'||u=='/index.html'){s.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Content-Encoding':'gzip','Cache-Control':'public,max-age=300'});return s.end(html)}
 s.writeHead(404);s.end('not found')});

/* ---- minimal WebSocket (RFC6455, text frames < 64KB) ---- */
srv.on('upgrade',(q,sock)=>{
 if(q.url!='/ws'||!q.headers['sec-websocket-key'])return sock.destroy();
 sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
 const c={sock,buf:Buffer.alloc(0),room:null,seat:-1,last:0,n:'',m:0};
 sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>70000)return sock.destroy();let f;while(f=frame(c)){
  if(f.op==8){sock.end();return}if(f.op==9){sock.write(Buffer.concat([Buffer.from([138,f.p.length]),f.p]));continue}
  if(f.op==1){try{onMsg(c,JSON.parse(f.p.toString()))}catch(e){}}}});
 sock.on('close',()=>drop(c));sock.on('error',()=>sock.destroy())});
function frame(c){const b=c.buf;if(b.length<2)return;const op=b[0]&15;let len=b[1]&127,o=2;
 if(len==126){if(b.length<4)return;len=b.readUInt16BE(2);o=4}else if(len==127){c.sock.destroy();return}
 const mk=b[1]&128;if(mk)o+=4;if(b.length<o+len)return;
 const p=Buffer.from(b.slice(o,o+len));if(mk)for(let i=0;i<len;i++)p[i]^=b[o-4+i%4];
 c.buf=b.slice(o+len);return{op,p}}
function send(c,o){if(!c)return;const p=Buffer.from(JSON.stringify(o)),n=p.length;if(n>65000)return;
 try{c.sock.write(Buffer.concat([n<126?Buffer.from([129,n]):Buffer.from([129,126,n>>8,n&255]),p]))}catch(e){}}

/* ---- rooms: seat 0 is host, host runs the game, server only relays ---- */
const rooms={},nm=v=>String(v||'').replace(/[<>&"'`]/g,'').slice(0,10)||'PLAYER',mm=v=>(((v|0)%12)+12)%12;
const seats=r=>r.s.map(x=>x&&{n:x.n,m:x.m});
function lob(r){r.s.forEach((x,i)=>x&&send(x,{t:'lobby',code:r.code,me:i,tok:x.tok,seats:seats(r)}))}
const tk=()=>crypto.randomBytes(8).toString('hex');
function drop(c){const r=c.room;if(!r)return;if(r.go&&!c.away){c.away=setTimeout(()=>leave(c),45000);if(c.seat>0)send(r.s[0],{t:'away',s:c.seat});return}leave(c)}
function leave(c){clearTimeout(c.away);const r=c.room;if(!r)return;c.room=null;
 if(c.seat==0){r.s.forEach(x=>{if(x&&x!==c){send(x,{t:'closed'});x.room=null}});delete rooms[r.code]}
 else{r.s[c.seat]=null;if(r.go)send(r.s[0],{t:'left',s:c.seat});else lob(r)}}
function onMsg(c,d){const r=c.room,now=Date.now();
 if(!r){
  if(d.t=='create'){let code;do code=String(1000+Math.random()*9000|0);while(rooms[code]);
   c.tok=tk();c.n=nm(d.n);c.m=mm(d.m);c.seat=0;c.room=rooms[code]={code,s:[c,null,null,null],go:0};lob(c.room)}
  else if(d.t=='join'){const q=rooms[String(d.code)];if(!q||q.go)return send(c,{t:'err',x:'ルームが見つからないか、開始済みです'});
   const i=q.s.indexOf(null);if(i<0)return send(c,{t:'err',x:'満員です'});
   c.tok=tk();c.n=nm(d.n);c.m=mm(d.m);c.seat=i;c.room=q;q.s[i]=c;lob(q)}
  else if(d.t=='rejoin'){const q=rooms[String(d.code)],i=q?q.s.findIndex(x=>x&&x.tok&&x.tok==d.tok):-1;if(i<0)return send(c,{t:'err',x:'復帰できませんでした'});
   const o=q.s[i];clearTimeout(o.away);o.room=null;try{o.sock.destroy()}catch(e){}
   c.n=o.n;c.m=o.m;c.tok=o.tok;c.seat=i;c.room=q;q.s[i]=c;send(c,{t:'rejoined',me:i,code:q.code});if(i>0)send(q.s[0],{t:'resync'})}
  return}
 if(d.t=='bye'){leave(c);return}
 if(d.t=='pick'&&!r.go){c.m=mm(d.m);lob(r)}
 else if(d.t=='start'&&c.seat==0&&!r.go){r.go=1;const o={t:'go',seats:seats(r)};r.s.forEach(x=>send(x,o))}
 else if(d.t=='again'&&c.seat==0&&r.go){r.go=0;lob(r)}
 else if(d.t=='in'&&c.seat>0&&r.go)send(r.s[0],{t:'in',s:c.seat,d:d.d})
 else if(d.t=='st'&&c.seat==0&&r.go){if(d.to>0)send(r.s[d.to|0],{t:'st',d:d.d});else r.s.forEach((x,i)=>i&&send(x,{t:'st',d:d.d}))}
 else if(d.t=='chat'&&now-c.last>700){c.last=now;const x=String(d.x||'').replace(/[<>]/g,'').slice(0,40);
  if(x)r.s.forEach(y=>send(y,{t:'chat',s:c.seat,n:c.n,k:d.k?1:0,x}))}}
srv.listen(PORT,()=>console.log('NEO BLACKJACK on :'+PORT));
