import postgres from 'npm:postgres@3.4.5';
import webpush from 'npm:web-push@3.6.7';
(function(){
const sql=postgres(Deno.env.get('SUPABASE_DB_URL'),{prepare:false,max:1,idle_timeout:20,connect_timeout:15});
const ORIGIN='https://arnoldsuheth.github.io';
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const hash=async(s)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const validEncrypted=p=>p&&/^[A-Za-z0-9_-]{16}$/.test(p.iv)&&typeof p.data==='string'&&/^[A-Za-z0-9_-]+$/.test(p.data)&&p.data.length<2600;
async function config(){
 let [c]=await sql`select * from lifetrail_push.config where id=true`;
 if(!c.vapid){
  const keys=webpush.generateVAPIDKeys();
  await sql`update lifetrail_push.config set vapid=${sql.json(keys)} where id=true and vapid is null`;
  [c]=await sql`select * from lifetrail_push.config where id=true`
 }
 return c
}
function validSubscription(s){
 try{
  const u=new URL(s.endpoint);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname)&&s.endpoint.length<2048&&/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh)&&/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth)
 }catch{return false}
}
function validSchedule(a){
 if(!Array.isArray(a)||a.length>500)return false;
 return a.every(e=>e&&/^[\w-]{1,120}$/.test(e.id)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.h)&&validEncrypted(e.payload)&&
 ((typeof e.d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.d))||(Array.isArray(e.days)&&e.days.length>0&&e.days.length<=7&&e.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6)))&&
 (!e.skip||Array.isArray(e.skip)&&e.skip.length<=32&&e.skip.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))))
}
function localClock(tz,at=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
 const day=p.year+'-'+p.month+'-'+p.day;
 return {day,weekday:new Date(day+'T12:00:00Z').getUTCDay(),minute:Number(p.hour)*60+Number(p.minute)}
}
async function send(c,d,event,day,payload){
 const claims=await sql`
 insert into lifetrail_push.deliveries(device,event,day) values(${d.id},${event},${day})
 on conflict(device,event,day) do update set state='sending',attempts=lifetrail_push.deliveries.attempts+1,lease_until=now()+interval '90 seconds'
 where lifetrail_push.deliveries.state<>'sent' and lifetrail_push.deliveries.attempts<3 and lifetrail_push.deliveries.lease_until<now()
 returning event`;
 if(!claims.length)return 'duplicate';
 try{
  await webpush.sendNotification(d.subscription,JSON.stringify({encrypted:payload,tag:event+'-'+day}),{vapidDetails:{subject:ORIGIN+'/app-lifetrail-juliana/',publicKey:c.vapid.publicKey,privateKey:c.vapid.privateKey},TTL:600,urgency:'high',timeout:10000});
  await sql`update lifetrail_push.deliveries set state='sent',sent_at=now(),error_code=null where device=${d.id} and event=${event} and day=${day}`;
  return 'sent'
 }catch(e){
  const code=Number(e.statusCode)||0;
  await sql`update lifetrail_push.deliveries set state='retry',error_code=${code} where device=${d.id} and event=${event} and day=${day}`;
  if(code===404||code===410)await sql`update lifetrail_push.devices set active=false where id=${d.id}`;
  return 'failed'
 }
}
async function dispatch(c){
 const devices=await sql`select * from lifetrail_push.devices where active=true`;
 const counts={sent:0,failed:0,duplicate:0};
 for(const d of devices){
  const now=localClock(d.timezone);
  for(const e of d.schedule){
   if(e.d?e.d!==now.day:!e.days.includes(now.weekday))continue;
   if(e.skip?.includes(now.day))continue;
   const [h,m]=e.h.split(':').map(Number),late=now.minute-h*60-m;
   if(late<0||late>10)continue;
   const state=await send(c,d,e.id+'-'+e.h,now.day,e.payload);counts[state]++
  }
  const tests=await sql`select * from lifetrail_push.tests where device=${d.id} and sent=false and due<=now() and due>now()-interval '10 minutes'`;
  for(const t of tests){
   const state=await send(c,d,'test-'+t.id,'test',t.payload);counts[state]++;
   if(state==='sent')await sql`update lifetrail_push.tests set sent=true where id=${t.id}`
  }
 }
 await sql`delete from lifetrail_push.deliveries where lease_until<now()-interval '14 days'`;
 await sql`delete from lifetrail_push.tests where due<now()-interval '1 day'`;
 await sql`delete from lifetrail_push.rates where expires<now()`;
 return counts
}
Deno.serve(async req=>{
 try{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  const path=new URL(req.url).pathname.split('/').pop();
  const c=await config();
  if(path==='dispatch'){
   const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
   if(await hash(token)!==await hash(c.cron_token))return respond({error:'Não autorizado'},401);
   return respond(await dispatch(c))
  }
  if(req.headers.get('origin')!==ORIGIN)return respond({error:'Origem inválida'},403);
  if(req.method==='GET'&&path==='key')return respond({key:c.vapid.publicKey});
  if(req.method!=='POST')return respond({error:'Método inválido'},405);
  if(Number(req.headers.get('content-length'))>1500000)return respond({error:'Arquivo muito grande'},413);
  const raw=await req.text();if(raw.length>1500000)return respond({error:'Arquivo muito grande'},413);
  const b=JSON.parse(raw);
  if(path==='enroll'){
   const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
   const bucket=await hash(ip+':'+Math.floor(Date.now()/900000));
   const [rate]=await sql`insert into lifetrail_push.rates(bucket,expires) values(${bucket},now()+interval '15 minutes') on conflict(bucket) do update set count=lifetrail_push.rates.count+1 returning count`;
   if(rate.count>8)return respond({error:'Aguarde 15 minutos e tente novamente.'},429);
   if(!validSubscription(b.subscription)||!validSchedule(b.schedule)||!/^[0-9a-f-]{36}$/.test(b.id)||!/^[a-f0-9]{64}$/.test(b.token))return respond({error:'Dados inválidos'},400);
   try{new Intl.DateTimeFormat('pt-BR',{timeZone:b.timezone}).format()}catch{return respond({error:'Fuso inválido'},400)}
   const ph=await hash(String(b.code||'').trim()),th=await hash(b.token);
   const ok=await sql.begin(async tx=>{
    const [allowed]=await tx`update lifetrail_push.config set pair_hash=null,pair_until=null where id=true and pair_hash=${ph} and pair_until>now() returning id`;
    if(!allowed)return false;
    await tx`insert into lifetrail_push.devices(id,token_hash,subscription,timezone,schedule) values(${b.id},${th},${tx.json(b.subscription)},${b.timezone},${tx.json(b.schedule)})`;
    return true
   });
   return ok?respond({ok:true}):respond({error:'Código inválido ou expirado.'},401)
  }
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(token))return respond({error:'Ative este aparelho primeiro.'},401);
  const [device]=await sql`select * from lifetrail_push.devices where token_hash=${await hash(token)} and active=true`;
  if(!device)return respond({error:'Ative este aparelho novamente.'},401);
  if(path==='sync'){
   if(!validSchedule(b.schedule)||!validSubscription(b.subscription))return respond({error:'Dados inválidos'},400);
   try{new Intl.DateTimeFormat('pt-BR',{timeZone:b.timezone}).format()}catch{return respond({error:'Fuso inválido'},400)}
   await sql`update lifetrail_push.devices set schedule=${sql.json(b.schedule)},subscription=${sql.json(b.subscription)},timezone=${b.timezone},updated_at=now() where id=${device.id}`;
   return respond({ok:true,count:b.schedule.length})
  }
  if(path==='test'){
   if(!validEncrypted(b.payload))return respond({error:'Teste inválido'},400);
   const recent=await sql`select id from lifetrail_push.tests where device=${device.id} and due>now()-interval '1 minute'`;
   if(recent.length)return respond({error:'Um teste já está a caminho. Aguarde até 2 minutos.'},429);
   await sql`insert into lifetrail_push.tests(device,payload) values(${device.id},${sql.json(b.payload)})`;
   return respond({ok:true,delay:120})
  }
  if(path==='disable'){
   await sql`update lifetrail_push.devices set active=false,schedule='[]'::jsonb where id=${device.id}`;
   return respond({ok:true})
  }
  return respond({error:'Não encontrado'},404)
 }catch(e){console.error('Life Trail push request failed',e?.name||'Error');return respond({error:'Não foi possível concluir. Tente novamente.'},500)}
});
})();
