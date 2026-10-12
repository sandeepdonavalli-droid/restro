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
  function renderRecents(){
    recentList.replaceChildren();
    if(!recentApps.size){
      const message=document.createElement('p');message.className='recent-apps-empty';message.textContent='Opened apps appear here.';recentList.append(message);return;
    }
    for(const recent of [...recentApps.values()].reverse()){
      const button=document.createElement('button');button.type='button';button.className='recent-app-card';button.setAttribute('aria-label',`Open ${recent.name}`);
      const icon=recent.insightId?artNode({symbol:recent.symbol}):recent.appId?artNode(apps[recent.appId].art):document.querySelector(`[data-control="${recent.control}"] .quick-control-icon`).cloneNode(true);
      icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=recent.name;button.append(icon,label);
      button.addEventListener('click',()=>{recents.close();if(recent.insightId)window.RestroInsights.openDetail(recent.insightId);else if(recent.appId)openApp(recent.appId);else document.querySelector(`[data-control="${recent.control}"]`).click();});
      recentList.append(button);
    }
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
