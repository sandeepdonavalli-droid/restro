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
    const appIds={'settings-dialog':'settings','analytics-dialog':'analytics','help-dialog':'help','qr-studio-dialog':'qr-studio','customers-dialog':'customers','employees-dialog':'employees'};
    const controls={'calculator-dialog':'calculator','camera-dialog':'camera'};
    const insightViews={'order-details-dialog':{id:'last-order',name:'Last order',symbol:'receipt'},'most-sold-dialog':{id:'most-sold',name:'Most sold items',symbol:'chef'}};
    if(dialog.id==='counter-dialog'||dialog.id==='orders-dialog'&&dialog.dataset.view==='held'){recentApps.delete('shortcut:register');recentApps.set('shortcut:register',{shortcutId:'register',name:'Counter'});if(recentApps.size>8)recentApps.delete(recentApps.keys().next().value);return;}
    if(dialog.id==='floor-dialog'){recentApps.delete('shortcut:floor');recentApps.set('shortcut:floor',{shortcutId:'floor',name:'Floor'});if(recentApps.size>8)recentApps.delete(recentApps.keys().next().value);return;}
    if(dialog.id==='orders-dialog'){recentApps.delete('shortcut:orders');recentApps.set('shortcut:orders',{shortcutId:'orders',name:'Orders'});if(recentApps.size>8)recentApps.delete(recentApps.keys().next().value);return;}
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
  const fullApps='.counter-app,.floor-app,.orders-app,.settings-app,.customers-app,.employees-app';
  function positionBar(){
    const opened=dialogs.filter(dialog=>dialog.open);
    const active=locked?lock:opened.at(-1);
    // Native modal dialogs make their siblings inert. Keep the swipe bar (and the keyboard's Back, Home and Recent
    // apps) inside the active dialog so they work there as well.
    (active||shell).append(bar);
    // The top bar is white over an open app, on the page's grey on the home screen (status-bar.css)
    document.documentElement.toggleAttribute('data-app-open',opened.some(dialog=>dialog.matches(fullApps)));
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
    if(recent.shortcutId==='register')window.RestroCounter?.open();
    else if(recent.shortcutId==='floor')window.RestroFloor?.open();
    else if(recent.shortcutId==='orders')window.RestroOrders?.open();
    else if(recent.insightId)window.RestroInsights.openDetail(recent.insightId);
    else if(recent.appId)openApp(recent.appId);
    else if(recent.control==='pager-hub')window.RestroPagerHub?.open();
    else document.querySelector(`[data-control="${recent.control}"]`)?.click();
  }
  function recentIcon(recent){
    return recent.shortcutId?artNode(shortcuts.find(item=>item.id===recent.shortcutId).art):recent.insightId?artNode({symbol:recent.symbol}):recent.appId?artNode(apps[recent.appId].art)
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
  async function goBack(){
    if(locked)return;
    const opened=dialogs.filter(dialog=>dialog.open).at(-1);
    if(opened){if(opened.id==='settings-dialog'&&window.RestroThemeSettings?.goBack())return;if(opened.id==='counter-dialog'&&window.RestroCounter?.goBack())return;if(opened.id==='orders-dialog'&&window.RestroOrders?.goBack())return;if(opened.id==='customers-dialog'&&window.RestroCustomers?.goBack())return;if(opened.id==='employees-dialog'&&window.RestroEmployees?.goBack())return;opened.close();return;}
    if(arranging){endDrag(true);setArranging(false);return;}
    if(currentPage>0){goToPage(currentPage-1);return;}
    await nativeAction('goBack');
  }
  async function goHome(){
    if(locked)return;closeViews();goToPage(0);shell.focus({preventScroll:true});await nativeAction('goHome');
  }
  async function showRecents(){
    if(locked)return;
    if(await nativeAction('openRecentApps'))return;
    if(recents.open){recents.close();return;}
    closeViews();renderRecents();recents.showModal();
  }
  document.querySelector('#system-back').addEventListener('click',goBack);
  document.querySelector('#system-home').addEventListener('click',goHome);
  document.querySelector('#system-recents').addEventListener('click',showRecents);
  // The tablet's own Back, Home and Recent apps (gestures or buttons) come in here from the RESTRO Android app
  window.RestroSystem=Object.freeze({back:goBack,home:goHome,recents:showRecents});

  // ---------- The swipe bar: swipe up from the bottom strip for Home (the open app shrinks away with the finger), swipe
  // up and hold still for Recent apps. A short or sideways move, or a tap, does nothing. ----------
  const HOME_DISTANCE=48,HOLD_DISTANCE=72,HOLD_TIME=280;
  let swipe=null;
  const topView=()=>dialogs.filter(dialog=>dialog.open&&dialog!==lock).at(-1)||null;
  function follow(app,dy,held){
    if(!app)return;
    const pull=Math.min(1,-dy/360);
    app.style.transition=held?'transform .18s ease-out,border-radius .18s':'none';app.style.transformOrigin='50% 100%';
    app.style.transform=`translateY(${Math.round(dy*.55)}px) scale(${held?.72:1-pull*.2})`;app.style.borderRadius=`${Math.round(Math.min(1,pull*3)*28)}px`;
  }
  function settle(app){
    if(!app)return;
    app.style.transition='transform .22s ease,border-radius .22s ease';app.style.transform='';app.style.borderRadius='';
    setTimeout(()=>{if(!app.style.transform){app.style.transition='';app.style.transformOrigin='';}},240);
  }
  function leave(app,then){
    if(!app){then();return;}
    app.style.transition='transform .17s ease-in,opacity .17s ease-in';app.style.transform='translateY(-14%) scale(.5)';app.style.opacity='0';
    setTimeout(()=>{then();for(const name of ['transition','transform','opacity','borderRadius','transformOrigin'])app.style[name]='';},170);
  }
  bar.addEventListener('pointerdown',event=>{
    if(locked||event.target.closest('.android-controls')||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();
    swipe={id:event.pointerId,x:event.clientX,y:event.clientY,t:performance.now(),dy:0,held:false,still:0,app:topView()};
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove',event=>{
    if(!swipe||event.pointerId!==swipe.id)return;
    const dy=Math.min(0,event.clientY-swipe.y);
    // Held still after coming far enough up: Recent apps, once the finger lifts
    if(Math.abs(dy-swipe.dy)>4){
      swipe.dy=dy;clearTimeout(swipe.still);
      if(-dy>=HOLD_DISTANCE&&!swipe.held)swipe.still=setTimeout(()=>{if(swipe){swipe.held=true;follow(swipe.app,swipe.dy,true);}},HOLD_TIME);
    }
    if(!swipe.held)follow(swipe.app,dy,false);
  });
  function endSwipe(event,cancelled){
    if(!swipe||event.pointerId!==swipe.id)return;
    const {app,held,t,x,y}=swipe,dy=Math.min(0,event.clientY-y),dx=Math.abs(event.clientX-x),fast=-dy/Math.max(1,performance.now()-t)>.5;
    clearTimeout(swipe.still);swipe=null;
    const upward=-dy>dx;
    if(!cancelled&&upward&&held){settle(app);showRecents();return;}
    if(!cancelled&&upward&&(-dy>=HOME_DISTANCE||fast&&-dy>=20)){leave(app,goHome);return;}
    settle(app);
  }
  bar.addEventListener('pointerup',event=>endSwipe(event,false));
  bar.addEventListener('pointercancel',event=>endSwipe(event,true));
  bar.addEventListener('contextmenu',event=>event.preventDefault());

  // ---------- Back: swipe in from the left or right edge while an app or a window is open (on the home screen the
  // edges turn the pages). A round arrow comes out with the finger; far enough, and it goes back. ----------
  const EDGE=22,BACK_DISTANCE=64,arrow=bar.querySelector('.back-arrow');
  let edge=null;
  function paintArrow(progress){
    const p=Math.max(0,Math.min(1,progress)),x=edge.side>0?-40+56*p:innerWidth-56*p,y=Math.max(8,Math.min(innerHeight-48,edge.y-20));
    arrow.classList.toggle('right',edge.side<0);
    arrow.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px) scale(${p>=1?1.1:1})`;arrow.style.opacity=String(Math.min(1,p*1.6));
  }
  document.addEventListener('pointerdown',event=>{
    edge=null;
    if(locked||!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0)||!topView()||event.target.closest?.('.home-bar'))return;
    const side=event.clientX<=EDGE?1:event.clientX>=innerWidth-EDGE?-1:0;
    if(side)edge={id:event.pointerId,x:event.clientX,y:event.clientY,side,going:false};
  },true);
  document.addEventListener('pointermove',event=>{
    if(!edge||event.pointerId!==edge.id)return;
    const dx=(event.clientX-edge.x)*edge.side,dy=Math.abs(event.clientY-edge.y);
    if(!edge.going){if(dy>24&&dy>dx){edge=null;return;}if(dx<10)return;edge.going=true;}
    paintArrow(dx/BACK_DISTANCE);
  },true);
  // A touch that swipes in from an edge doesn't scroll what's under it (an upward or downward one still does)
  document.addEventListener('touchmove',event=>{
    if(!edge||!event.cancelable||!event.touches[0])return;
    const touch=event.touches[0],dx=(touch.clientX-edge.x)*edge.side,dy=Math.abs(touch.clientY-edge.y);
    if(dx>0&&dx>=dy)event.preventDefault();
  },{capture:true,passive:false});
  function endEdge(event,cancelled){
    if(!edge||event.pointerId!==edge.id)return;
    const {going,side,x}=edge,dx=(event.clientX-x)*side;edge=null;arrow.style.opacity='0';
    if(cancelled||!going||dx<BACK_DISTANCE)return;
    // The press that made the swipe is not a tap on what is under it
    const swallow=e=>{e.stopPropagation();e.preventDefault();};
    document.addEventListener('click',swallow,{capture:true,once:true});setTimeout(()=>document.removeEventListener('click',swallow,{capture:true}),0);
    goBack();
  }
  document.addEventListener('pointerup',event=>endEdge(event,false),true);
  document.addEventListener('pointercancel',event=>endEdge(event,true),true);
  window.addEventListener('restro:app-uninstalled',event=>{recentApps.delete(event.detail.id);if(recents.open)renderRecents();});
  // The screen is locked with the tablet's own button (no lock button on the bar): the Android app reports it with
  // restro:device-locked. A lock still on from before is ended with Unlock, or when the tablet reports it was unlocked.
  // Once staff accounts exist, only a PIN ends a lock (staff sign-in, employees.js): Unlock and the tablet's own unlock
  // are then left to it.
  let pinRequired=false;
  function lockScreen(){
    if(locked)return;
    locked=true;try{sessionStorage.setItem('restro.screenLocked','true');}catch{}
    syncLock();for(const button of navigation)button.disabled=true;
    if(!lock.open)lock.showModal();positionBar();
    window.dispatchEvent(new CustomEvent('restro:screen-locked'));
  }
  function unlock(){
    locked=false;try{sessionStorage.removeItem('restro.screenLocked');}catch{}
    for(const button of navigation)button.disabled=false;lock.close();positionBar();shell.focus({preventScroll:true});
    window.dispatchEvent(new CustomEvent('restro:screen-unlocked'));
  }
  document.querySelector('#screen-unlock').addEventListener('click',()=>{if(!pinRequired)unlock();});
  lock.addEventListener('cancel',event=>event.preventDefault());
  window.addEventListener('restro:device-unlocked',()=>{if(locked&&!pinRequired)unlock();});
  window.addEventListener('restro:device-locked',lockScreen);
  window.RestroScreenLock=Object.freeze({lock:lockScreen,unlock,requirePin(on){pinRequired=Boolean(on);},get locked(){return locked;}});
  new MutationObserver(()=>{if(locked)syncLock();}).observe(document.querySelector('#clock'),{childList:true,subtree:true,characterData:true});
  if(locked){syncLock();for(const button of navigation)button.disabled=true;lock.showModal();}
  positionBar();
})();
