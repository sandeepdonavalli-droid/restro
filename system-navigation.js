'use strict';
(() => {
  const bar=document.querySelector('#system-navigation');
  const shell=document.querySelector('.app-shell');
  const lock=document.querySelector('#screen-lock-dialog');
  const recents=document.querySelector('#recents-dialog');
  const recentList=document.querySelector('#recent-apps-list');
  const recentApps=new Map();
  const dialogs=[...document.querySelectorAll('dialog')];
  const navigation=[...bar.querySelectorAll('.system-control')];
  let locked=false;
  try{locked=sessionStorage.getItem('restro.screenLocked')==='true';}catch{}

  function closeViews(){
    for(const dialog of dialogs)if(dialog.open&&dialog!==lock)dialog.close();
    endDrag(true);setArranging(false);
  }
  function syncLock(){
    const time=document.querySelector('#clock .clock-text');
    document.querySelector('#lock-clock').textContent=time.textContent;
    document.querySelector('#lock-clock').dateTime=document.querySelector('#clock').dateTime;
    document.querySelector('#lock-restaurant').textContent=document.querySelector('#restaurant-name').textContent;
  }
  function remember(dialog){
    const appIds={'settings-dialog':'settings','analytics-dialog':'analytics','help-dialog':'help','qr-studio-dialog':'qr-studio'};
    const controls={'calculator-dialog':'calculator','camera-dialog':'camera'};
    const insightViews={'order-details-dialog':{id:'last-order',name:'Last order',symbol:'receipt'},'most-sold-dialog':{id:'most-sold',name:'Most sold items',symbol:'chef'}};
    if(insightViews[dialog.id]){
      const view=insightViews[dialog.id],key=`insight:${view.id}`;recentApps.delete(key);recentApps.set(key,{insightId:view.id,name:view.name,symbol:view.symbol});
      if(recentApps.size>8)recentApps.delete(recentApps.keys().next().value);return;
    }
    const appId=appIds[dialog.id];let control=controls[dialog.id],name;
    if(appId&&!isInstalledApp(appId))return;
    if(appId)name=apps[appId].name;
    else if(dialog.id==='device-settings-dialog'){
      name=document.querySelector('#device-settings-title').textContent;
      control={'Wi-Fi':'wifi','Bluetooth':'bluetooth','Pager Hub':'pager-hub'}[name];
    }else if(control)name=control==='calculator'?'Calculator':'Camera';
    if(!name||!appId&&!control)return;
    const key=appId||control;recentApps.delete(key);recentApps.set(key,{appId,control,name});
    if(recentApps.size>8)recentApps.delete(recentApps.keys().next().value);
  }
  function positionBar(){
    const opened=dialogs.filter(dialog=>dialog.open);
    const active=locked?lock:opened.at(-1);
    // Native modal dialogs make their siblings inert. Keep the system controls
    // inside the active dialog so Back and Home work there as well.
    (active||shell).append(bar);
    alignBannerText();
  }
  const observer=new MutationObserver(records=>{
    for(const record of records)if(record.target.open)remember(record.target);
    if(locked&&!lock.open)lock.showModal();
    positionBar();
  });
  for(const dialog of dialogs)observer.observe(dialog,{attributes:true,attributeFilter:['open']});

  async function nativeAction(method){
    const host=window.RESTRODevice;
    if(typeof host?.[method]!=='function')return false;
    try{return await host[method]()!==false;}catch{return false;}
  }
  // ---------- App switcher (Apple-style): slide through cards, swipe up to close ----------
  function openRecent(recent){
    recents.close();
    if(recent.insightId)window.RestroInsights.openDetail(recent.insightId);
    else if(recent.appId)openApp(recent.appId);
    else if(recent.control==='pager-hub')window.RestroPagerHub?.open();
    else document.querySelector(`[data-control="${recent.control}"]`)?.click();
  }
  function recentIcon(recent){
    return recent.insightId?artNode({symbol:recent.symbol}):recent.appId?artNode(apps[recent.appId].art)
      :recent.control==='pager-hub'?artNode(shortcuts.find(item=>item.id==='pager-hub').art)
      :document.querySelector(`[data-control="${recent.control}"] .quick-control-icon`)?.cloneNode(true)||document.createElement('span');
  }
  function closeRecent(key,item){
    recentApps.delete(key);
    item.classList.add('switcher-gone');
    setTimeout(()=>{item.remove();if(!recentApps.size)renderRecents();},260);
  }
  function renderRecents(){
    recentList.replaceChildren();
    if(!recentApps.size){
      const message=document.createElement('p');message.className='recent-apps-empty';message.textContent='No recent apps';recentList.append(message);return;
    }
    // Oldest on the left, most recent on the right (like iPhone/iPad).
    for(const [key,recent] of recentApps){
      const item=document.createElement('div');item.className='switcher-item';item.setAttribute('role','listitem');
      const label=document.createElement('div');label.className='switcher-label';
      const small=recentIcon(recent);small.setAttribute('aria-hidden','true');small.classList.add('switcher-label-icon');
      const name=document.createElement('span');name.textContent=recent.name;label.append(small,name);
      const card=document.createElement('button');card.type='button';card.className='switcher-card';
      card.setAttribute('aria-label',`Open ${recent.name}. Swipe up or press Delete to close.`);
      const bar=document.createElement('span');bar.className='switcher-card-bar';bar.textContent=recent.name;
      const body=document.createElement('span');body.className='switcher-card-body';
      const big=recentIcon(recent);big.setAttribute('aria-hidden','true');big.classList.add('switcher-card-icon');body.append(big);
      card.append(bar,body);item.append(label,card);recentList.append(item);

      // Swipe up to close; tap to open.
      let start=null,dy=0,moved=false;
      card.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY,t:performance.now(),id:event.pointerId};dy=0;moved=false;});
      card.addEventListener('pointermove',event=>{
        if(!start||event.pointerId!==start.id)return;
        const dx=event.clientX-start.x,dyNow=event.clientY-start.y;
        if(!moved&&Math.abs(dyNow)>8&&Math.abs(dyNow)>Math.abs(dx)){moved=true;card.setPointerCapture(event.pointerId);item.classList.add('switcher-dragging');}
        if(!moved)return;
        dy=Math.min(0,dyNow);item.style.transform=`translateY(${dy}px)`;item.style.opacity=String(Math.max(.2,1+dy/400));
      });
      const end=event=>{
        if(!start||event.pointerId!==start.id)return;
        const fast=dy<-60&&dy/(performance.now()-start.t)<-.6;
        item.classList.remove('switcher-dragging');start=null;
        if(moved&&(dy<-card.offsetHeight*.3||fast)){item.style.transform='translateY(-120vh)';item.style.opacity='0';closeRecent(key,item);}
        else if(moved){item.style.transform='';item.style.opacity='';}
      };
      card.addEventListener('pointerup',end);card.addEventListener('pointercancel',end);
      card.addEventListener('click',event=>{if(moved){event.preventDefault();moved=false;return;}openRecent(recent);});
      card.addEventListener('keydown',event=>{
        if(event.key==='Delete'||event.key==='Backspace'||event.key==='ArrowUp'){event.preventDefault();const next=item.previousElementSibling||item.nextElementSibling;item.style.transform='translateY(-120vh)';item.style.opacity='0';closeRecent(key,item);next?.querySelector('.switcher-card')?.focus();}
        else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();(event.key==='ArrowLeft'?item.previousElementSibling:item.nextElementSibling)?.querySelector('.switcher-card')?.focus();}
      });
    }
    requestAnimationFrame(()=>{recentList.scrollLeft=recentList.scrollWidth;const last=recentList.lastElementChild?.querySelector('.switcher-card');last?.focus({preventScroll:true});});
  }
  // Mouse: drag sideways to slide; vertical wheel slides too. Touch scrolls natively.
  {
    let drag=null;
    recentList.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0)return;drag={x:event.clientX,left:recentList.scrollLeft,moved:false};});
    window.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x;if(Math.abs(dx)>6){drag.moved=true;recentList.classList.add('switcher-sliding');}if(drag.moved)recentList.scrollLeft=drag.left-dx;});
    window.addEventListener('pointerup',event=>{if(!drag)return;const wasMoved=drag.moved,dx=event.clientX-drag.x,startLeft=drag.left;drag=null;recentList.classList.remove('switcher-sliding');
      if(wasMoved){
        // Snap to the next/previous card in the drag direction, like a swipe.
        const items=[...recentList.querySelectorAll('.switcher-item')],centerOf=item=>item.offsetLeft+item.offsetWidth/2-recentList.clientWidth/2;
        const current=items.reduce((best,item)=>Math.abs(centerOf(item)-startLeft)<Math.abs(centerOf(best)-startLeft)?item:best,items[0]);
        let index=items.indexOf(current);if(Math.abs(dx)>50)index+=dx<0?1:-1;
        const target=items[Math.max(0,Math.min(items.length-1,index))];if(target)recentList.scrollTo({left:centerOf(target),behavior:'smooth'});
      }if(wasMoved){const stop=e=>{e.stopPropagation();e.preventDefault();};recentList.addEventListener('click',stop,{capture:true,once:true});setTimeout(()=>recentList.removeEventListener('click',stop,{capture:true}),0);}});
    recentList.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){recentList.scrollLeft+=event.deltaY;event.preventDefault();}},{passive:false});
    // Tapping empty space goes back, like the iPhone app switcher.
    recents.addEventListener('click',event=>{if(event.target===recents||event.target===recentList||event.target.classList?.contains('switcher-item')||event.target.classList?.contains('recent-apps-empty'))recents.close();});
  }
  document.querySelector('#system-back').addEventListener('click',async()=>{
    if(locked)return;
    const opened=dialogs.filter(dialog=>dialog.open).at(-1);
    if(opened){if(opened.id==='settings-dialog'&&window.RestroThemeSettings?.goBack())return;opened.close();return;}
    if(arranging){endDrag(true);setArranging(false);return;}
    if(currentPage>0){goToPage(currentPage-1);return;}
    await nativeAction('goBack');
  });
  document.querySelector('#system-home').addEventListener('click',async()=>{
    if(locked)return;closeViews();goToPage(0);shell.focus({preventScroll:true});await nativeAction('goHome');
  });
  document.querySelector('#system-recents').addEventListener('click',async()=>{
    if(locked)return;
    if(await nativeAction('openRecentApps'))return;
    if(recents.open){recents.close();return;}
    closeViews();renderRecents();recents.showModal();
  });
  window.addEventListener('restro:app-uninstalled',event=>{recentApps.delete(event.detail.id);if(recents.open)renderRecents();});
  document.querySelector('#system-lock').addEventListener('click',async()=>{
    if(locked)return;closeViews();locked=true;try{sessionStorage.setItem('restro.screenLocked','true');}catch{}
    syncLock();for(const button of navigation)button.disabled=true;lock.showModal();positionBar();
    await nativeAction('lockScreen');
  });
  function unlock(){
    locked=false;try{sessionStorage.removeItem('restro.screenLocked');}catch{}
    for(const button of navigation)button.disabled=false;lock.close();positionBar();document.querySelector('#system-lock').focus({preventScroll:true});
  }
  document.querySelector('#screen-unlock').addEventListener('click',unlock);
  lock.addEventListener('cancel',event=>event.preventDefault());
  window.addEventListener('restro:device-unlocked',()=>{if(locked)unlock();});
  new MutationObserver(()=>{if(locked)syncLock();}).observe(document.querySelector('#clock'),{childList:true,subtree:true,characterData:true});
  if(locked){syncLock();for(const button of navigation)button.disabled=true;lock.showModal();}
  positionBar();
})();
