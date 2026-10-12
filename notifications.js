'use strict';
(() => {
  const list=document.querySelector('#system-notification-list');
  const empty=document.querySelector('#system-notifications-empty');
  const count=document.querySelector('#system-notification-count');
  const announcement=document.querySelector('#system-notification-announcement');
  const notifications=new Map();
  let revision=0,unsubscribe=null;
  const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
  function normalize(input){
    if(typeof input==='string'){try{input=JSON.parse(input);}catch{return null;}}
    if(!input||typeof input!=='object'||Array.isArray(input))return null;
    const title=text(input.title,240);if(!title)return null;
    const rawTime=input.timestamp??input.receivedAt;
    const parsed=typeof rawTime==='number'?rawTime:Date.parse(rawTime);
    const timestamp=new Date(parsed).getTime();
    const suppliedId=typeof input.id==='string'||typeof input.id==='number'?String(input.id).slice(0,160):'';
    return {
      id:suppliedId||(typeof crypto.randomUUID==='function'?crypto.randomUUID():`system-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      title,message:text(input.message??input.body,2400),source:text(input.source,80)||'System',
      appId:text(input.appId,80),timestamp:Number.isFinite(timestamp)?timestamp:Date.now()
    };
  }
  function bell(){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4');svg.append(path);return svg;
  }
  function render(){
    list.replaceChildren();
    const entries=[...notifications.values()].sort((a,b)=>b.timestamp-a.timestamp);
    for(const item of entries){
      const card=document.createElement('article');card.className='system-notification';card.setAttribute('role','listitem');card.dataset.notificationId=item.id;
      const icon=document.createElement('span');icon.className='notification-icon';icon.setAttribute('aria-hidden','true');
      const app=typeof apps!=='undefined'&&Object.hasOwn(apps,item.appId)?apps[item.appId]:null;
      const shortcut=typeof shortcuts!=='undefined'?shortcuts.find(entry=>entry.id===item.appId):null;
      icon.append(app||shortcut?artNode((app||shortcut).art):bell());
      const copy=document.createElement('div');copy.className='notification-copy';
      const meta=document.createElement('div');meta.className='notification-meta';
      const source=document.createElement('span');source.textContent=item.source;
      const time=document.createElement('time'),date=new Date(item.timestamp);time.dateTime=date.toISOString();time.textContent=date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});time.title=date.toLocaleString();
      const title=document.createElement('h3');title.textContent=item.title;
      meta.append(source,time);copy.append(meta,title);
      if(item.message){const message=document.createElement('p');message.className='notification-message';message.textContent=item.message;copy.append(message);}
      card.append(icon,copy);list.append(card);
    }
    list.hidden=!entries.length;empty.hidden=!!entries.length;count.hidden=!entries.length;count.textContent=String(entries.length);count.setAttribute('aria-label',`${entries.length} notifications`);
  }
  function push(input){
    const item=normalize(input);if(!item)return false;
    notifications.set(item.id,item);revision++;render();announcement.textContent=`New notification: ${item.title}`;return true;
  }
  function remove(id){const removed=notifications.delete(String(id));if(removed){revision++;render();}return removed;}
  function replace(input){
    let entries=input;if(typeof entries==='string'){try{entries=JSON.parse(entries);}catch{return false;}}
    if(!Array.isArray(entries))return false;
    notifications.clear();for(const entry of entries){const item=normalize(entry);if(item)notifications.set(item.id,item);}
    revision++;render();return true;
  }
  async function refresh(){
    const host=window.RESTRODevice;if(typeof host?.getNotifications!=='function')return;
    const requestedAtRevision=revision;
    try{const entries=await host.getNotifications();if(revision===requestedAtRevision)replace(entries);}catch{/* Keep the last delivered notifications during a temporary connection failure. */}
  }
  window.RestroNotifications=Object.freeze({push,remove,replace,refresh});
  window.addEventListener('restro:notification',event=>push(event.detail));
  window.addEventListener('restro:notification-removed',event=>remove(event.detail?.id??event.detail));
  window.addEventListener('restro:notifications',event=>replace(event.detail));
  function disconnectHost(){try{unsubscribe?.();}catch{}unsubscribe=null;}
  function connectHost(){
    disconnectHost();
    const host=window.RESTRODevice;
    if(typeof host?.subscribeNotifications==='function'){
      try{const stop=host.subscribeNotifications(update=>{
        if(update?.type==='remove')remove(update.id);
        else if(Array.isArray(update)||update?.type==='snapshot')replace(Array.isArray(update)?update:update.notifications);
        else push(update?.notification??update);
      });if(typeof stop==='function')unsubscribe=stop;}catch{}
    }
    refresh();
  }
  window.addEventListener('restro:device-ready',connectHost);
  window.addEventListener('pagehide',disconnectHost,{once:true});
  render();connectHost();
})();
