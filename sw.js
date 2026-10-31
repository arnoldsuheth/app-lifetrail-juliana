
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function decrypt(p){
 const db=await new Promise((ok,no)=>{const r=indexedDB.open('lifetrail-juliana-push',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
 const raw=await new Promise((ok,no)=>{const r=db.transaction('keys','readonly').objectStore('keys').get('payload');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});db.close();
 const key=await crypto.subtle.importKey('raw',decode(raw),'AES-GCM',false,['decrypt']);
 return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(p.iv)},key,decode(p.data))))
}
self.addEventListener('push',e=>e.waitUntil((async()=>{
 let p={},m={t:'Você tem um lembrete no Life Trail. Toque para ver.',ir:'rotina'};
 try{p=e.data.json();if(p.encrypted)m=await decrypt(p.encrypted)}catch(x){}
 const route=['rotina','inicio','treino','perfil','biblia'].includes(m.ir)?m.ir:'rotina';
 await self.registration.showNotification('Life Trail · Juliana',{body:(m.hora?m.hora+' · ':'')+String(m.t).slice(0,250),icon:'icon-192-v2.png',badge:'icon-192-v2.png',tag:p.tag||'lifetrail',data:{url:new URL('./#'+route,self.registration.scope).href}})
})()));
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil((async()=>{
  const base=new URL(self.registration.scope),url=new URL(e.notification.data?.url||'./#rotina',base);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(w=>w.url.startsWith(base.href));
  if(existing){await existing.navigate(url.href);await existing.focus()}else await self.clients.openWindow(url.href)
 })())
});
