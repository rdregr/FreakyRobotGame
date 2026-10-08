'use strict';
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));
const rooms=new Map(),users=new Map();
const MAPS=['Factory','Neon Rooftops','Bunker','Frostbite'];
const OPS=['Rivet','Bulwark','Volt','Patch','Pyre','Wraith','Atlas','Glitch','Vector','Echo'];
const LIMIT=4, MAX_SCORE=10;
const WORLD_SIZE=80;
const SPAWNS={0:[[9,9],[11,16]],1:[[70,70],[68,63]]};
const safe=v=>String(v??'Pilot').replace(/[<>]/g,'').slice(0,18);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const layouts={
 'Factory':[[15,15,8,6],[52,50,9,7],[32,10,5,16],[38,53,6,15],[24,37,12,5],[55,25,9,7]],
 'Neon Rooftops':[[15,10,9,10],[56,10,9,10],[15,56,9,10],[56,56,9,10],[34,31,12,12]],
 'Bunker':[[19,8,4,25],[19,46,4,25],[55,8,4,25],[55,46,4,25],[8,35,20,4],[52,35,20,4],[34,22,11,5],[34,53,11,5]],
 'Frostbite':[[13,17,12,10],[53,17,12,10],[13,53,12,10],[53,53,12,10],[35,30,10,16]]
};
function walls(map){return [{x:0,z:0,w:2,d:80},{x:0,z:78,w:80,d:2},{x:78,z:0,w:2,d:80},{x:0,z:0,w:80,d:2},...layouts[map].map(([x,z,w,d])=>({x,z,w,d}))]}
function collision(r,x,z){return walls(r.map).some(w=>x>w.x-.52&&x<w.x+w.w+.52&&z>w.z-.52&&z<w.z+w.d+.52)}
function spawn(r,team,index){const [x,z]=SPAWNS[team][index%2];return {x,z}}
function state(r){return {code:r.code,mode:r.mode,map:r.map,started:r.started,score:r.score,win:r.win,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,team:p.team,op:p.op,x:p.x,z:p.z,yaw:p.yaw,y:p.y,hp:p.hp,kills:p.kills,deaths:p.deaths,dead:p.dead,abilityUntil:p.abilityUntil,shieldUntil:p.shieldUntil,cloakUntil:p.cloakUntil,empUntil:p.empUntil})),events:r.events.slice(-6),decoys:r.decoys||[],worldSize:WORLD_SIZE}}
function publish(r){io.to(r.code).emit('state',state(r))}
function notice(r,msg){r.events.push(msg);if(r.events.length>30)r.events.shift();io.to(r.code).emit('notice',msg)}
function code(){let c;do{c=Math.random().toString(36).slice(2,6).toUpperCase()}while(rooms.has(c));return c}
function reset(r){r.score=[0,0];r.win=null;r.started=false;for(const p of r.players.values()){p.hp=100;p.y=0;p.vy=0;p.kills=0;p.deaths=0;p.dead=false;p.lastAbility=0;Object.assign(p,spawn(r,p.team,[...r.players.values()].filter(q=>q.team===p.team).indexOf(p)))}r.started=r.players.size===(r.mode==='2v2'?4:2);publish(r)}
function leave(s){const u=users.get(s.id);if(!u)return;users.delete(s.id);const r=rooms.get(u.code);if(!r)return;r.players.delete(s.id);s.leave(r.code);if(!r.players.size){rooms.delete(r.code);return}r.started=false;r.win=null;notice(r,'A player left. Waiting for players.');publish(r)}
function join(s,r,name,op){leave(s);const max=r.mode==='2v2'?4:2;if(r.players.size>=max)return s.emit('notice','Lobby full');const team=r.mode==='1v1'?r.players.size:r.players.size%2;const index=[...r.players.values()].filter(p=>p.team===team).length;const pos=spawn(r,team,index);const p={id:s.id,name:safe(name),op:OPS.includes(op)?op:'Rivet',team,...pos,yaw:team===0?Math.PI/4:-Math.PI*3/4,hp:100,y:0,vy:0,kills:0,deaths:0,dead:false,lastShot:0,lastMove:Date.now(),lastAbility:0,abilityUntil:0,shieldUntil:0,cloakUntil:0,empUntil:0};r.players.set(s.id,p);users.set(s.id,{code:r.code});s.join(r.code);s.emit('joined',{id:s.id,code:r.code});r.started=r.players.size===max;notice(r,p.name+' joined '+(team===0?'Blue':'Red'));publish(r)}
function damage(r,attacker,target,amount){if(!r.started||r.win!==null||target.dead||target.team===attacker.team)return false;let dmg=amount;if(Date.now()<target.shieldUntil)dmg=Math.ceil(dmg*.25);target.hp=Math.max(0,target.hp-dmg);if(target.hp===0){target.dead=true;target.deaths++;attacker.kills++;r.score[attacker.team]++;notice(r,attacker.name+' eliminated '+target.name);if(r.score[attacker.team]>=MAX_SCORE){r.win=attacker.team;r.started=false;notice(r,(r.win===0?'BLUE':'RED')+' TEAM WINS!')}else{const victimId=target.id;setTimeout(()=>{if(!r.players.has(victimId)||r.win!==null)return;target.hp=100;target.dead=false;const teammates=[...r.players.values()].filter(q=>q.team===target.team);Object.assign(target,spawn(r,target.team,teammates.indexOf(target)));publish(r)},2400)}}return true}
function rayHit(r,p,range,halfAngle){let best=null,dist=range;for(const q of r.players.values()){if(q.id===p.id||q.team===p.team||q.dead)continue;const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz),angle=Math.atan2(dx,dz),err=Math.atan2(Math.sin(angle-p.yaw),Math.cos(angle-p.yaw));if(d>=dist||Math.abs(err)>halfAngle+Math.atan2(.45,d))continue;let blocked=false;for(let t=.6;t<d-.5;t+=.3){if(collision(r,p.x+Math.sin(angle)*t,p.z+Math.cos(angle)*t)){blocked=true;break}}if(!blocked){best=q;dist=d}}return best}
io.on('connection',s=>{
 s.on('create',({name,op,mode,map}={})=>{mode=mode==='2v2'?'2v2':'1v1';map=MAPS.includes(map)?map:'Factory';const c=code(),r={code:c,mode,map,players:new Map(),started:false,score:[0,0],win:null,events:[],decoys:[]};rooms.set(c,r);join(s,r,name,op)});
 s.on('join',({code:c,name,op}={})=>{const r=rooms.get(String(c||'').toUpperCase());if(!r)return s.emit('notice','Lobby not found');join(s,r,name,op)});
 s.on('move',d=>{const r=rooms.get(users.get(s.id)?.code),p=r?.players.get(s.id);if(!p||!r.started||p.dead)return;const now=Date.now(),dt=clamp((now-p.lastMove)/1000,0,.08);p.lastMove=now;let dx=clamp(Number(d?.dx)||0,-1,1),dz=clamp(Number(d?.dz)||0,-1,1);const mag=Math.hypot(dx,dz);if(mag>1){dx/=mag;dz/=mag}let speed=d?.slide?10:d?.sprint?8:5.5;if(now<p.abilityUntil&&p.op==='Rivet')speed*=1.5;const nx=p.x+dx*speed*dt,nz=p.z+dz*speed*dt;if(!collision(r,nx,p.z))p.x=nx;if(!collision(r,p.x,nz))p.z=nz;if(Number.isFinite(d?.yaw))p.yaw=clamp(d.yaw,-1e6,1e6);if(d?.jump&&p.y<=.02)p.vy=7.5;p.vy-=19*dt;p.y=Math.max(0,p.y+p.vy*dt);if(p.y===0)p.vy=0;});
 s.on('fire',d=>{const r=rooms.get(users.get(s.id)?.code),p=r?.players.get(s.id);if(!p||!r.started||p.dead||r.win!==null)return;const now=Date.now(),interval=now<p.abilityUntil&&p.op==='Rivet'?110:210;if(now-p.lastShot<interval)return;p.lastShot=now;const pitch=clamp(Number(d?.pitch)||0,-1.25,1.25);let hit=false,headshot=false,target=null,best=45;
 const vx=Math.sin(p.yaw)*Math.cos(pitch),vz=Math.cos(p.yaw)*Math.cos(pitch),vy=Math.sin(pitch);
 for(const q of r.players.values()){if(q.id===p.id||q.team===p.team||q.dead)continue;const dx=q.x-p.x,dz=q.z-p.z,dy=q.y+1.3-(p.y+1.55),along=dx*vx+dz*vz+dy*vy;if(along<=0||along>=best)continue;const off=Math.hypot(dx-vx*along,dz-vz*along,dy-vy*along);if(off>.72)continue;let blocked=false;for(let t=.6;t<along-.5;t+=.35)if(collision(r,p.x+vx*t,p.z+vz*t)){blocked=true;break}if(!blocked){target=q;best=along;headshot=dy-vy*along>-.2&&dy-vy*along<.2&&q.y+1.9-(p.y+1.55+vy*along)<.33}}
 for(const d of r.decoys||[]){if(d.team===p.team)continue;const dx=d.x-p.x,dz=d.z-p.z,dy=1.3-(p.y+1.55),along=dx*vx+dz*vz+dy*vy;if(along<=0||along>=best)continue;const off=Math.hypot(dx-vx*along,dz-vz*along,dy-vy*along);if(off<.8){d.hp-=25;target=null;hit=true;best=along}}
 if(target)hit=damage(r,p,target,headshot?42:25);io.to(r.code).emit('shot',{id:p.id,x:p.x,z:p.z,y:p.y,yaw:p.yaw,pitch,hit,headshot});publish(r)});
 s.on('ability',()=>{const r=rooms.get(users.get(s.id)?.code),p=r?.players.get(s.id);if(!p||!r.started||p.dead)return;const now=Date.now();const cds={Rivet:15000,Bulwark:18000,Volt:12000,Patch:16000,Pyre:18000,Wraith:20000,Atlas:17000,Glitch:20000,Vector:18000,Echo:16000};if(now-p.lastAbility<cds[p.op])return;if(now<p.empUntil)return;p.lastAbility=now;let affected=0;
 if(p.op==='Rivet')p.abilityUntil=now+4500;
 if(p.op==='Bulwark')p.shieldUntil=now+5000;
 if(p.op==='Volt'){const nx=p.x+Math.sin(p.yaw)*5,nz=p.z+Math.cos(p.yaw)*5;if(!collision(r,nx,nz)){p.x=nx;p.z=nz}for(const q of r.players.values())if(q.team!==p.team&&!q.dead&&Math.hypot(q.x-p.x,q.z-p.z)<2.6){damage(r,p,q,30);affected++}}
 if(p.op==='Patch')for(const q of r.players.values())if(q.team===p.team&&!q.dead&&Math.hypot(q.x-p.x,q.z-p.z)<9){q.hp=Math.min(100,q.hp+45);affected++}
 if(p.op==='Pyre')for(const q of r.players.values())if(q.team!==p.team&&!q.dead&&Math.hypot(q.x-(p.x+Math.sin(p.yaw)*8),q.z-(p.z+Math.cos(p.yaw)*8))<5){damage(r,p,q,45);affected++}
 if(p.op==='Wraith')p.cloakUntil=now+5000;
 if(p.op==='Atlas')for(const q of r.players.values())if(q.team!==p.team&&!q.dead&&Math.hypot(q.x-p.x,q.z-p.z)<5){damage(r,p,q,50);affected++}
 if(p.op==='Glitch')for(const q of r.players.values())if(q.team!==p.team&&!q.dead&&Math.hypot(q.x-p.x,q.z-p.z)<11){q.empUntil=now+5000;affected++}
 if(p.op==='Vector'){const q=rayHit(r,p,38,.05);if(q){damage(r,p,q,75);affected++}}
 if(p.op==='Echo'){r.decoys=r.decoys||[];r.decoys.push({id:'decoy_'+s.id+'_'+now,owner:p.id,team:p.team,name:p.name+'?',x:p.x+Math.cos(p.yaw)*1.4,z:p.z-Math.sin(p.yaw)*1.4,y:0,yaw:p.yaw,hp:50,expires:now+8000});}
 io.to(r.code).emit('ability_fx',{id:p.id,op:p.op,x:p.x,z:p.z,affected});publish(r)});
 s.on('chat',msg=>{const r=rooms.get(users.get(s.id)?.code),p=r?.players.get(s.id);if(r&&p)io.to(r.code).emit('chat',{name:p.name,text:String(msg??'').slice(0,120)})});
 s.on('rematch',()=>{const r=rooms.get(users.get(s.id)?.code);if(r&&r.win!==null)reset(r)});
 s.on('leave',()=>leave(s));s.on('disconnect',()=>leave(s));
});
setInterval(()=>{for(const r of rooms.values()){if(r.decoys){r.decoys=r.decoys.filter(d=>d.expires>Date.now()&&d.hp>0);for(const d of r.decoys){d.x+=Math.sin(d.yaw)*.065;d.z+=Math.cos(d.yaw)*.065;if(collision(r,d.x,d.z))d.yaw+=1.8}}if(r.players.size)publish(r)}},100);
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('FREAKYROBOTGAME V2 running'));
