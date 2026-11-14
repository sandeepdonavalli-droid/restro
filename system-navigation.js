'use strict';
(() => {
  const bar=document.querySelector('#system-navigation');
  const shell=document.querySelector('.app-shell');
  const home=document.querySelector('#home');
  const lock=document.querySelector('#screen-lock-dialog');
  const recents=document.querySelector('#recents-dialog');
  const darkScreen=document.querySelector('#screen-dark');
  const root=document.documentElement;
  // Recent apps sits last in the page: above every open window, and the pictures of them it holds come after the
  // windows themselves
  document.body.append(recents);
  const recentList=document.querySelector('#recent-apps-list');
  const closeAll=document.querySelector('#recents-close-all');

  // ---------- Settings › Display › Navigation (Navigation & Lock Update 1): swipe gestures (the default) or the
  // navigation bar, never both; with the bar, Back on the left or the right (Home always in the middle) ----------
  let navMode='swipe';
  function applyNav(){
    const n=window.RestroPrefs?.get('navigation')||{mode:'swipe',order:'back-left'};
    navMode=n.mode;root.dataset.nav=n.mode;root.dataset.navOrder=n.order;
  }
  applyNav();
  const barMode=()=>navMode==='bar';
  const recentApps=new Map();
  const dialogs=[...document.querySelectorAll('dialog')];
  const navigation=[...bar.querySelectorAll('.system-control')];
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const fullApps='.counter-app,.floor-app,.orders-app,.settings-app,.customers-app,.employees-app,.qr-studio-app';
  let locked=false;
  try{locked=sessionStorage.getItem('restro.screenLocked')==='true';}catch{}
  // A swipe on the bar under way, windows on their way home (or back), and Recent apps while it shows
  let gesture=null,flight=null,sw=null;

  // The home screen, blurred, behind Recent apps and behind an app being swiped away (system-navigation.css)
  const veil=document.createElement('div');veil.className='home-veil';veil.setAttribute('aria-hidden','true');shell.append(veil);
  // The app's icon as the window lands on it (in the top layer, over the windows)
  const ghost=document.createElement('div');ghost.className='sys-ghost';ghost.setAttribute('aria-hidden','true');
  const ghostArt=document.createElement('img');ghostArt.alt='';ghost.append(ghostArt);
  if(typeof ghost.showPopover==='function')ghost.setAttribute('popover','manual');
  document.body.append(ghost);
  // Where full-screen apps sit: under the top bar, above the swipe strip
  const probe=document.createElement('div');probe.className='app-area-probe';probe.setAttribute('aria-hidden','true');document.body.append(probe);
  const appArea=()=>{const r=probe.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
  // Nothing moves the navigation bar or the lock (owner, 13 Nov 2026). The bar sits in the window on top, so that its
  // buttons work there too. While that window moves or fades as a whole (an app going into its icon, Recent apps
  // going, the quick controls coming down), the bar waits in its own layer instead: over everything, in its place. In
  // the swipe mode only the lock waits there; the strip keeps the finger, and the handle goes with the app as before.
  const lockButton=bar.querySelector('#system-lock'),indicator=bar.querySelector('.home-indicator');
  const barLayer=document.createElement('div');barLayer.id='system-bar-layer';
  const layered=typeof barLayer.showPopover==='function';
  if(layered)barLayer.setAttribute('popover','manual');
  document.body.append(barLayer);
  let held=false;
  // (last into the top layer, so over the moving window and anything shown after it)
  function raiseBar(){if(!held)return;if(barLayer.matches(':popover-open'))barLayer.hidePopover();barLayer.showPopover();}
  function holdBar(){
    if(!layered){if(barMode())shell.append(bar);return;}
    if(lockButton.parentElement!==bar)bar.insertBefore(lockButton,indicator);
    const what=barMode()?bar:lockButton;
    if(what.parentElement!==barLayer)barLayer.append(what);
    held=true;raiseBar();
  }
  // (the bar itself is put back by positionBar)
  function freeBar(){
    if(!held)return;
    held=false;
    if(lockButton.parentElement!==bar)bar.insertBefore(lockButton,indicator);
    if(barLayer.matches(':popover-open'))barLayer.hidePopover();
  }
  // A window moving or fading as a whole: carried home or back (sys-moving), or its own animation of where it is or how
  // see-through it is (not its corners or shadow settling)
  const MOVES=/^(transform|translate|scale|rotate|opacity)$/;
  const moving=dialog=>dialog.classList.contains('sys-moving')||dialog.getAnimations().some(run=>{
    const effect=run.effect;if(effect?.target!==dialog||effect.pseudoElement)return false;
    return run instanceof CSSTransition?MOVES.test(run.transitionProperty):effect.getKeyframes().some(frame=>Object.keys(frame).some(name=>MOVES.test(name)));
  });

  // A soft spring with a touch of overshoot: as an easing, and as a curve for paths that start at the finger's speed
  function springAt(t,v0=0){const z=.82,w=7.4,wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*t)*(Math.cos(wd*t)+((z*w-v0)/wd)*Math.sin(wd*t));}
  let springEase=null;
  function spring(){
    if(springEase)return springEase;
    const points=[];for(let i=0;i<=48;i++){const t=i/48;points.push(`${i===48?1:springAt(t).toFixed(4)} ${(t*100).toFixed(2)}%`);}
    const ease=`linear(${points.join(', ')})`;
    return springEase=CSS.supports('transition-timing-function',ease)?ease:'cubic-bezier(.22,.9,.3,1)';
  }
  // The way into the icon, frame by frame: across and down each starting at the speed the finger left it with (so a
  // flick carries on a little before the window turns for its icon), its size on its own
  function pathFrames(from,to,v,D){
    const norm=(speed,distance)=>Math.abs(distance)<1||!D?0:Math.max(-3,Math.min(4,speed*D/distance));
    const vx=norm(v.x,to.tx-from.tx),vy=norm(v.y,to.ty-from.ty),frames=[];
    for(let i=0;i<=30;i++){
      const t=i/30,last=i===30;
      frames.push({offset:t,tx:from.tx+(to.tx-from.tx)*(last?1:springAt(t,vx)),ty:from.ty+(to.ty-from.ty)*(last?1:springAt(t,vy)),s:from.s+(to.s-from.s)*(last?1:springAt(t,0))});
    }
    return frames;
  }
  const time=ms=>reduceMotion.matches?0:ms;
  const settled=animations=>Promise.all(animations.map(animation=>animation.finished.catch(()=>{})));

  // The lock screen's left side (A1): the time (11:16 with a smaller AM), the day and date, the order still open on the
  // Counter (it waits there) and who locked it, how long ago (employees.js sets who)
  function syncLock(){
    const clock=document.querySelector('#clock .clock-text'),out=document.querySelector('#lock-clock');
    const [hm,ampm]=String(clock.textContent||'').trim().split(/\s+/);
    out.replaceChildren(hm||'',...(ampm?[Object.assign(document.createElement('small'),{textContent:ampm.toUpperCase()})]:[]));
    out.dateTime=document.querySelector('#clock').dateTime;
    const d=new Date();
    document.querySelector('#lock-date').textContent=`${d.toLocaleDateString('en-GB',{weekday:'long'})}, ${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'long'})}`;
    document.querySelector('#lock-restaurant').textContent=document.querySelector('#restaurant-name').textContent;
    const open=window.RestroCounter?.openSummary?.();
    document.querySelector('#lock-order').hidden=!open;
    if(open){document.querySelector('#lock-order-title').textContent=`${open.title} is still open`;document.querySelector('#lock-order-line').textContent=open.line;}
    window.RestroLockScreen?.paintBy?.();
  }

  // ---------- Recent apps: which apps, and a picture of each as it was left ----------
  const appDialogs={'settings-dialog':'settings','analytics-dialog':'analytics','help-dialog':'help','qr-studio-dialog':'qr-studio','customers-dialog':'customers','employees-dialog':'employees'};
  const controlDialogs={'calculator-dialog':'calculator','camera-dialog':'camera'};
  const insightViews={'order-details-dialog':{id:'last-order',name:'Last order',symbol:'receipt'},'most-sold-dialog':{id:'most-sold',name:'Most sold items',symbol:'chef'}};
  function recentOf(dialog){
    if(dialog.id==='counter-dialog'||dialog.id==='orders-dialog'&&dialog.dataset.view==='held')return ['shortcut:register',{shortcutId:'register',name:'Counter'}];
    if(dialog.id==='floor-dialog')return ['shortcut:floor',{shortcutId:'floor',name:'Floor'}];
    if(dialog.id==='orders-dialog')return ['shortcut:orders',{shortcutId:'orders',name:'Orders'}];
    const view=insightViews[dialog.id];if(view)return [`insight:${view.id}`,{insightId:view.id,name:view.name,symbol:view.symbol}];
    const appId=appDialogs[dialog.id];let control=controlDialogs[dialog.id],name;
    if(appId&&!isInstalledApp(appId))return null;
    if(appId)name=apps[appId].name;
    else if(dialog.id==='device-settings-dialog'){
      name=document.querySelector('#device-settings-title').textContent;
      control={'Wi-Fi':'wifi','Bluetooth':'bluetooth','Pager Hub':'pager-hub'}[name];
    }else if(control)name=control==='calculator'?'Calculator':'Camera';
    if(!name||!appId&&!control)return null;
    return [appId||control,{appId,control,name}];
  }
  function remember(dialog){
    const found=recentOf(dialog);if(!found)return;
    recentApps.delete(found[0]);recentApps.set(found[0],found[1]);
    if(recentApps.size>8){const oldest=recentApps.keys().next().value;recentApps.delete(oldest);pictures.delete(oldest);}
  }

  // The picture on an app's card is a still copy of its windows, inert and out of reach of screen readers, taken when
  // the app is left (with where each list was scrolled to and what was typed). It is only a picture: the app itself
  // opens fresh from its card.
  const pictures=new Map();
  const openStack=()=>dialogs.filter(dialog=>dialog.open&&dialog!==lock&&dialog!==recents);
  const rootLooks=['color','background-color','background-image','background-size','background-position','background-repeat','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','overflow-x','overflow-y','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color'];
  // Ids the styles use keep them in a picture, so it looks the same (Recent apps comes after the windows in the page,
  // so looking one up still finds the real one); every other id goes
  let styledIds=null;
  function idsInStyles(){
    if(styledIds)return styledIds;
    styledIds=new Set();
    const walk=rules=>{for(const rule of rules){if(rule.selectorText)for(const match of rule.selectorText.matchAll(/#([\w-]+)/g))styledIds.add(match[1]);if(rule.cssRules)walk(rule.cssRules);}};
    for(const sheet of document.styleSheets){try{walk(sheet.cssRules);}catch{}}
    return styledIds;
  }
  function picture(stack){
    const parts=[];
    for(const dialog of stack){
      const rect={x:dialog.offsetLeft,y:dialog.offsetTop,w:dialog.offsetWidth,h:dialog.offsetHeight};
      if(!rect.w||!rect.h)continue;
      const copy=dialog.cloneNode(true),from=[dialog,...dialog.querySelectorAll('*')],to=[copy,...copy.querySelectorAll('*')];
      for(let i=0;i<from.length;i++){
        const a=from[i],b=to[i];
        if(a.scrollTop||a.scrollLeft)b.dataset.snapScroll=`${a.scrollTop} ${a.scrollLeft}`;
        if(a instanceof HTMLInputElement){
          if(a.type==='checkbox'||a.type==='radio')b.toggleAttribute('checked',a.checked);
          else if(a.type!=='file'&&a.type!=='password'&&!/pin|pass|otp/i.test(`${a.id} ${a.name} ${a.autocomplete}`))b.setAttribute('value',a.value);
        }else if(a instanceof HTMLTextAreaElement)b.textContent=a.value;
        else if(a instanceof HTMLSelectElement)[...b.options].forEach((option,j)=>option.toggleAttribute('selected',Boolean(a.options[j]?.selected)));
        else if(a instanceof HTMLCanvasElement&&a.width&&a.height){
          try{const still=document.createElement('img');still.alt='';still.src=a.toDataURL();still.className=a.className;still.style.cssText=a.style.cssText;still.style.width=`${a.offsetWidth}px`;still.style.height=`${a.offsetHeight}px`;b.replaceWith(still);}catch{}
        }
      }
      for(const node of copy.querySelectorAll('.home-bar,.back-arrow,script,dialog,video,iframe'))node.remove();
      const styled=idsInStyles();
      for(const node of copy.querySelectorAll('[id],[name],[autofocus],[popover]')){if(!styled.has(node.id))node.removeAttribute('id');node.removeAttribute('name');node.removeAttribute('autofocus');node.removeAttribute('popover');}
      // The window itself becomes a plain box at the same place, with the looks it had
      const part=document.createElement('div');
      for(const {name,value} of [...copy.attributes])if(!['id','open','style'].includes(name))part.setAttribute(name,value);
      part.classList.remove('sys-moving','sys-hidden','sys-lifted');part.classList.add('snap-part');part.setAttribute('open','');
      part.style.cssText=dialog.style.cssText;
      for(const name of ['transform','transform-origin','transition','opacity','clip-path','border-radius','box-shadow','will-change','translate','scale','rotate'])part.style.removeProperty(name);
      const look=getComputedStyle(dialog);for(const name of rootLooks)part.style.setProperty(name,look.getPropertyValue(name));
      Object.assign(part.style,{position:'absolute',inset:'auto',left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.w}px`,height:`${rect.h}px`,margin:'0',maxWidth:'none',maxHeight:'none',minWidth:'0',minHeight:'0',boxSizing:'border-box'});
      part.append(...copy.childNodes);parts.push(part);
    }
    return parts.length?{parts,area:appArea(),vw:innerWidth,vh:innerHeight}:null;
  }
  function keep(dialog){
    const stack=openStack(),i=stack.indexOf(dialog),found=i<0?null:recentOf(dialog);
    if(!found||!recentApps.has(found[0]))return;
    try{const shot=picture(stack.slice(0,i+1));if(shot)pictures.set(found[0],shot);}catch{}
  }
  function keepAll(){for(const dialog of openStack())keep(dialog);}
  // Every way a window closes takes its picture first (unless the picture was just taken)
  let keeping=true;
  function quietly(run){keeping=false;try{run();}finally{keeping=true;}}
  for(const dialog of dialogs){
    if(dialog===lock||dialog===recents)continue;
    const close=dialog.close;
    dialog.close=function(...args){if(this.open&&keeping)keep(this);return close.apply(this,args);};
    dialog.addEventListener('cancel',()=>{if(dialog.open&&keeping)keep(dialog);});
  }

  function positionBar(){
    // The bar holds the finger while a swipe is under way, and the windows keep their look until they have landed
    if(gesture||flight)return;
    const opened=dialogs.filter(dialog=>dialog.open);
    const active=locked?lock:opened.at(-1);
    // While that window moves or fades, the bar waits over everything, in its place
    if(active&&moving(active))holdBar();
    else{
      // Native modal dialogs make their siblings inert. Keep the swipe bar (and the keyboard's Back, Home and Recent
      // apps) inside the active dialog so they work there as well.
      (active||shell).append(bar);freeBar();
    }
    // The top bar is white over an open app, on the page's grey on the home screen (status-bar.css)
    document.documentElement.toggleAttribute('data-app-open',opened.some(dialog=>dialog.matches(fullApps)));
    alignBannerText();
  }
  const observer=new MutationObserver(records=>{
    for(const record of records)if(record.target.open)remember(record.target);
    if(flight){
      const opened=records.filter(record=>record.target.open&&record.oldValue===null&&record.target!==recents&&record.target!==lock).map(record=>record.target);
      if(opened.length)stopFlight(new Set(opened));
    }
    if(locked&&!lock.open)lock.showModal();
    positionBar();
  });
  for(const dialog of dialogs)observer.observe(dialog,{attributes:true,attributeFilter:['open'],attributeOldValue:true});
  // A window's own animation (the quick controls coming down): the bar waits it out in its layer
  for(const dialog of dialogs)for(const type of ['animationstart','animationend','animationcancel','transitionstart','transitionend','transitioncancel'])dialog.addEventListener(type,event=>{if(event.target===dialog&&!event.pseudoElement)positionBar();});

  async function nativeAction(method){
    const host=window.RESTRODevice;
    if(typeof host?.[method]!=='function')return false;
    try{return await host[method]()!==false;}catch{return false;}
  }

  // ---------- The open windows, moved as one ----------
  function grabWindow(){
    const els=openStack();if(!els.length)return null;
    // (the navigation bar stays in its place, over everything, while the window flies: out of it first; in the swipe
    // mode, the lock)
    holdBar();
    const main=[...els].reverse().find(dialog=>dialog.matches(fullApps))||els.at(-1);
    const box={x:main.offsetLeft,y:main.offsetTop,w:main.offsetWidth,h:main.offsetHeight};
    const cx=box.x+box.w/2,cy=box.y+box.h/2;
    const boxes=els.map(el=>({x:el.offsetLeft,y:el.offsetTop,w:el.offsetWidth,h:el.offsetHeight}));
    els.forEach((el,i)=>{el.classList.add('sys-moving');el.style.transformOrigin=`${cx-boxes[i].x}px ${cy-boxes[i].y}px`;});
    main.classList.add('sys-lifted');
    return {els,boxes,main,box,cx,cy,tx:0,ty:0,s:1};
  }
  function placeWindow(w,tx,ty,s){
    Object.assign(w,{tx,ty,s});
    for(const el of w.els)el.style.transform=`translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
  }
  // Under the finger: smaller the higher it goes, its bottom edge following the finger
  function dragWindow(w,dx,dy){
    const travel=Math.max(0,-dy),s=.4+.6*Math.exp(-travel/300);
    placeWindow(w,dx*.8,dy*.72+(1-s)*w.box.h/2,s);
  }
  function releaseWindow(w){
    for(const el of w.els){
      for(const animation of el.getAnimations())if(!(animation instanceof CSSAnimation)&&!(animation instanceof CSSTransition))animation.cancel();
      el.classList.remove('sys-moving','sys-hidden','sys-lifted');
      for(const name of ['transform','transformOrigin','borderRadius','boxShadow','clipPath','opacity'])el.style[name]='';
    }
  }
  function putAway(w){quietly(()=>{for(const el of w.els)if(el.open)el.close();});releaseWindow(w);}

  // The home screen behind: shown (not the app's white) the moment a window moves, a little larger and blurred while
  // the window is held, settling in as it closes
  function homeBehind(){
    if(currentPage!==0){currentPage=0;updatePage(false);}
    document.documentElement.removeAttribute('data-app-open');
  }
  function zoomHome(p){home.style.transform=p>0?`scale(${(1+.05*p).toFixed(4)})`:'';}
  // The home screen and the veil get layers of their own while either moves (so a move doesn't repaint them)
  const motion=on=>document.documentElement.classList.toggle('sys-motion',on);
  let veilTurn=0;
  // Takes the veil and the zoom over from whatever was moving them, where they are now
  function holdVeil(){
    const shown=getComputedStyle(veil).opacity,zoom=getComputedStyle(home).transform;
    for(const run of [...veil.getAnimations(),...home.getAnimations()])run.cancel();
    veil.style.opacity=shown;home.style.transform=zoom==='none'?'':zoom;motion(true);
    return ++veilTurn;
  }
  function settleHome(duration,ease){
    holdVeil();const turn=veilTurn,runs=[];
    if(home.style.transform)runs.push(home.animate([{transform:home.style.transform},{transform:'none'}],{duration,easing:ease,fill:'forwards'}));
    if(+veil.style.opacity>0)runs.push(veil.animate([{opacity:veil.style.opacity},{opacity:0}],{duration:duration*.7,easing:'ease-out',fill:'forwards'}));
    settled(runs).then(()=>{for(const run of runs)run.cancel();if(turn===veilTurn){home.style.transform='';veil.style.opacity='0';motion(false);}});
    return runs;
  }
  function showVeil(duration){
    holdVeil();const shown=veil.style.opacity||'0';veil.style.opacity='1';
    if(duration&&+shown<1)veil.animate([{opacity:shown},{opacity:1}],{duration,easing:'ease-out'});
    zoomHome(1);
  }

  // Where a window closes into: its app's icon on the home screen (the dock or the first page), or, with no icon to go
  // to, the middle of the screen
  const iconOf={'settings-dialog':'settings','customers-dialog':'customers','employees-dialog':'employees','analytics-dialog':'analytics','help-dialog':'help','qr-studio-dialog':'qr-studio','calculator-dialog':'calculator','camera-dialog':'camera'};
  // (any app can be in the dock or on the pages: app.js)
  function iconNode(dialog){
    const id=dialog.id==='counter-dialog'?'register':dialog.id==='floor-dialog'?'floor':dialog.id==='orders-dialog'?(dialog.dataset.view==='held'?'register':'orders')
      :dialog.id==='device-settings-dialog'&&document.querySelector('#device-settings-title')?.textContent==='Pager Hub'?'pager-hub':iconOf[dialog.id];
    if(!id)return null;
    return home.querySelector(`#main-shortcuts .shortcut[data-app="${id}"] .app-icon`)||home.querySelector(`#pages-track .apps-page[data-page="0"] .app-tile[data-id="${id}"] .app-icon`);
  }
  function targetFor(stack){
    for(const dialog of [...stack].reverse()){
      const node=iconNode(dialog),r=node?.getBoundingClientRect();
      if(!r?.width)continue;
      const look=getComputedStyle(node);
      return {x:r.left,y:r.top,size:r.width,radius:parseFloat(look.borderTopLeftRadius)||r.width*30/112,node,filter:look.filter,
        art:node.querySelector('image')?.getAttribute('href')||node.querySelector('img')?.getAttribute('src')||null};
    }
    const a=appArea(),size=Math.round(a.h*.16);
    return {x:a.x+a.w/2-size/2,y:a.y+a.h/2-size/2,size,radius:size*30/112,node:null,art:null};
  }

  // The window flies into the icon: smaller and squarer as it goes, the icon showing through as it lands
  function flyHome(w,target,v={x:0,y:0}){
    const D=time(480),side=Math.min(w.box.w,w.box.h),s1=target.size/side,tcx=target.x+target.size/2,tcy=target.y+target.size/2;
    const frames=pathFrames({tx:w.tx,ty:w.ty,s:w.s},{tx:tcx-w.cx,ty:tcy-w.cy,s:s1},v,D);
    const crop={x:w.box.x+(w.box.w-side)/2,y:w.box.y+(w.box.h-side)/2},runs=[];
    w.els.forEach((el,i)=>{
      const b=w.boxes[i],inset=`inset(${(crop.y-b.y).toFixed(2)}px ${(b.x+b.w-crop.x-side).toFixed(2)}px ${(b.y+b.h-crop.y-side).toFixed(2)}px ${(crop.x-b.x).toFixed(2)}px round ${(target.radius/s1).toFixed(2)}px)`;
      runs.push(el.animate(frames.map(f=>({offset:f.offset,transform:`translate(${f.tx.toFixed(2)}px,${f.ty.toFixed(2)}px) scale(${f.s.toFixed(4)})`})),{duration:D,fill:'forwards'}));
      runs.push(el.animate([{clipPath:'inset(-400px round 0px)'},{clipPath:inset}],{duration:D,easing:spring(),fill:'forwards'}));
      runs.push(el.animate([{opacity:1},{opacity:1,offset:target.art?.56:.3},{opacity:0}],{duration:D,fill:'forwards'}));
    });
    if(target.art&&ghost.hasAttribute('popover')){
      ghostArt.src=target.art;
      Object.assign(ghost.style,{left:`${target.x}px`,top:`${target.y}px`,width:`${target.size}px`,height:`${target.size}px`,filter:target.filter||'none'});
      ghost.showPopover();raiseBar();
      if(target.node)target.node.style.visibility='hidden';
      runs.push(ghost.animate(frames.map(f=>({offset:f.offset,transform:`translate(${(w.cx+f.tx-tcx).toFixed(2)}px,${(w.cy+f.ty-tcy).toFixed(2)}px) scale(${(side*f.s/target.size).toFixed(4)})`})),{duration:D,fill:'forwards'}));
      runs.push(ghost.animate([{opacity:0},{opacity:0,offset:.24},{opacity:1,offset:.72},{opacity:1}],{duration:D,fill:'forwards'}));
    }
    runs.push(...settleHome(D,spring()));
    return settled(runs);
  }
  function landed(target){
    if(target?.node)target.node.style.visibility='';
    for(const run of ghost.getAnimations())run.cancel();
    if(ghost.matches?.(':popover-open'))ghost.hidePopover();
  }
  function homeReached(){
    flight=null;endDrag(true);setArranging(false);goToPage(0);positionBar();shell.focus({preventScroll:true});nativeAction('goHome');
  }
  // An app opened while windows are on their way home: the windows that were leaving close at once (unless that app is
  // one of them, opened again), and the new app is what shows
  function stopFlight(reopened=new Set()){
    const f=flight;if(!f)return;
    flight=null;f.stopped=true;
    if(f.w?.els){
      if(f.home){const leaving=f.w.els.filter(el=>el.open&&!reopened.has(el));for(const el of leaving)keep(el);quietly(()=>{for(const el of leaving)el.close();});}
      releaseWindow(f.w);
    }
    landed(f.target);
    if(f.switcher&&recents.open)recents.close();
    for(const run of [...veil.getAnimations(),...home.getAnimations()])run.cancel();
    ++veilTurn;home.style.transform='';veil.style.opacity='0';motion(false);
    positionBar();
  }
  // Home with the windows going into their icon (Home from the keyboard or the tablet, or the swipe below)
  async function goHome(){
    if(locked||flight||gesture)return;
    if(recents.open){closeSwitcher();await nativeAction('goHome');return;}
    homeBehind();
    const w=grabWindow();
    if(w){
      const target=targetFor(w.els),f=flight={w,target,home:true};holdVeil();zoomHome(.6);
      await flyHome(w,target);
      if(f.stopped)return;
      keepAll();putAway(w);landed(target);
    }
    homeReached();
  }

  // ---------- Recent apps (Navigation & Lock Update 1, N5): only our apps, as cards in a row over the screen (darkened
  // and blurred), the app that was open first and outlined in blue, each with its icon and name over the last screen it
  // showed (or its icon). Tap a card to open the app, swipe a card up to close it, Close all for none; a tap beside the
  // cards (or a swipe up from the bottom edge) goes Home. ----------
  function recentIcon(recent){
    return recent.shortcutId?artNode(shortcuts.find(item=>item.id===recent.shortcutId).art):recent.insightId?artNode({symbol:recent.symbol}):recent.appId?artNode(apps[recent.appId].art)
      :recent.control==='pager-hub'?artNode(shortcuts.find(item=>item.id==='pager-hub').art)
      :document.querySelector(`[data-control="${recent.control}"] .quick-control-icon`)?.cloneNode(true)||document.createElement('span');
  }
  const CARD={w:560,h:386,head:56};
  function buildCard(key,entry,now){
    const card=document.createElement('button');card.type='button';card.className=`switcher-card${now?' now':''}`;card.setAttribute('role','listitem');
    card.setAttribute('aria-label',`${entry.name}${now?', open now':''}. Tap to open, swipe up to close.`);card.tabIndex=-1;
    const head=document.createElement('span');head.className='switcher-head';
    const icon=recentIcon(entry);icon.classList.add('switcher-icon');icon.setAttribute('aria-hidden','true');
    const name=document.createElement('span');name.textContent=entry.name;head.append(icon,name);
    const body=document.createElement('span');body.className='switcher-body';
    card.append(head,body);
    return {key,entry,card,body,drawn:false};
  }
  // The card's picture: the app as it was left (pictures, above) under a copy of the top bar, the whole screen scaled to
  // cover the card from its top left; with none, the app's icon on grey
  function draw(it){
    it.drawn=true;
    const shot=pictures.get(it.key),fu=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fu'))||innerWidth/1920;
    if(!shot){const blank=document.createElement('span');blank.className='switcher-blank';const icon=recentIcon(it.entry);icon.classList.add('switcher-blank-icon');icon.setAttribute('aria-hidden','true');blank.append(icon);it.body.append(blank);return;}
    const screen=document.createElement('span');screen.className='switcher-screen';screen.inert=true;screen.setAttribute('aria-hidden','true');
    const k=Math.max(CARD.w*fu/shot.vw,(CARD.h-CARD.head)*fu/shot.vh);
    Object.assign(screen.style,{width:`${shot.vw}px`,height:`${shot.vh}px`,transform:`scale(${k})`});
    const banner=document.querySelector('#top-banner')?.cloneNode(true);
    if(banner){for(const part of [banner,...banner.querySelectorAll('*')])for(const name of ['id','autofocus','name','title','aria-live'])part.removeAttribute(name);Object.assign(banner.style,{position:'absolute',left:'0',top:'0',width:`${shot.vw}px`});}
    screen.append(...shot.parts.map(part=>part.cloneNode(true)),...(banner?[banner]:[]));it.body.append(screen);
    for(const node of screen.querySelectorAll('[data-snap-scroll]')){const [top,left]=node.dataset.snapScroll.split(' ').map(Number);node.scrollTop=top;node.scrollLeft=left;}
  }
  // Shows Recent apps: the app open now first (`top`, outlined), then the others, newest first
  function openSwitcher(w,preview){
    const list=[...recentApps].reverse();
    const top=w?[...w.els].reverse().map(recentOf).find(Boolean):[...openStack()].reverse().map(recentOf).find(Boolean)||null;
    if(top){const i=list.findIndex(([key])=>key===top[0]);if(i>0)list.unshift(...list.splice(i,1));}
    recentList.replaceChildren();
    sw={items:[],preview,busy:false,closing:false,current:top&&list[0]?.[0]===top[0]?top[0]:null};
    for(const [key,entry] of list){const it=buildCard(key,entry,key===sw.current);sw.items.push(it);recentList.append(it.card);}
    if(!sw.items.length){const message=document.createElement('p');message.className='recent-apps-empty';message.textContent='No recent apps';recentList.append(message);}
    closeAll.hidden=!sw.items.length;
    for(const it of sw.items)draw(it);
    recentList.scrollLeft=0;
    recents.classList.remove('keys');
    if(preview)recents.show();else recents.showModal();
    const D=time(320);
    recents.querySelector('.switcher-scrim').animate([{opacity:0},{opacity:1}],{duration:D,easing:'ease-out'});
    for(const node of [recents.querySelector('.switcher-title'),closeAll,recents.querySelector('.switcher-hint')])node.animate([{opacity:0},{opacity:1}],{duration:D,easing:'ease-out'});
    sw.items.forEach((it,i)=>it.card.animate([{transform:'translateY(40px) scale(.96)',opacity:0},{transform:'none',opacity:1}],{duration:D+60,delay:time(Math.min(i,4)*30),easing:spring(),fill:'backwards'}));
  }
  function focusCard(i=0){
    if(!sw||sw.preview)return;
    const it=sw.items[Math.max(0,Math.min(sw.items.length-1,i))];
    sw.items.forEach(x=>{x.card.tabIndex=x===it?0:-1;});
    (it?.card||closeAll).focus({preventScroll:true});
    it?.card.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  // From the preview (swipe up and hold) to Recent apps proper, once the finger lifts
  function enterSwitcher(){
    if(!sw)return;
    if(!recents.matches(':modal')){recents.close();recents.showModal();}
    sw.preview=false;
    endDrag(true);setArranging(false);positionBar();focusCard();
  }
  // Away from Recent apps: back to the app that was open (`back`), or Home
  function closeSwitcher(back=false){
    if(!sw||sw.closing)return;
    sw.closing=true;holdBar();
    const D=time(220);
    const runs=[recents.animate([{opacity:1},{opacity:0}],{duration:D,easing:'ease-in',fill:'forwards'})];
    return settled(runs).then(()=>{
      if(recents.open)recents.close();
      for(const run of recents.getAnimations())run.cancel();
      if(!back&&openStack().length){keepAll();quietly(()=>{for(const dialog of openStack())dialog.close();});homeReached();}
      else if(!back)homeReached();
      else positionBar();
    });
  }
  function clearSwitcher(){recentList.replaceChildren();sw=null;}
  recents.addEventListener('close',()=>{if(!recents.open)clearSwitcher();});
  function openCard(it){
    if(!sw||sw.busy||sw.closing)return;
    sw.busy=true;
    if(it.key===sw.current){closeSwitcher(true);return;}
    const entry=it.entry;
    closeSwitcher(true).then(()=>openRecent(entry));
  }
  function openRecent(recent){
    if(recent.shortcutId==='register')window.RestroCounter?.open();
    else if(recent.shortcutId==='floor')window.RestroFloor?.open();
    else if(recent.shortcutId==='orders')window.RestroOrders?.open();
    else if(recent.insightId)window.RestroInsights.openDetail(recent.insightId);
    else if(recent.appId)openApp(recent.appId);
    else if(recent.control==='pager-hub')window.RestroPagerHub?.open();
    else document.querySelector(`[data-control="${recent.control}"]`)?.click();
  }
  // Closing an app: its card goes up and away, and its windows close if it is the one open
  function forget(it){
    recentApps.delete(it.key);pictures.delete(it.key);
    if(it.key===sw?.current){quietly(()=>{for(const dialog of openStack())dialog.close();});sw.current=null;positionBar();}
  }
  function removeCard(it){
    if(!sw||sw.busy||sw.closing)return;
    sw.busy=true;
    const from=it.card.style.transform||'none';
    const run=it.card.animate([{transform:from,opacity:1},{transform:`translateY(${-CARD.h*1.2}px)`,opacity:0}],{duration:time(220),easing:'cubic-bezier(.3,.5,.4,1)',fill:'forwards'});
    settled([run]).then(()=>{
      if(!sw)return;
      const i=sw.items.indexOf(it),was=new Map(sw.items.map(x=>[x,x.card.getBoundingClientRect().left]));
      it.card.remove();sw.items.splice(i,1);forget(it);sw.busy=false;
      if(!sw.items.length){closeSwitcher();return;}
      for(const x of sw.items){const shift=was.get(x)-x.card.getBoundingClientRect().left;if(Math.abs(shift)>.5)x.card.animate([{transform:`translateX(${shift}px)`},{transform:'none'}],{duration:time(300),easing:spring()});}
      focusCard(i);
    });
  }
  closeAll.addEventListener('click',()=>{
    if(!sw||sw.busy||sw.closing)return;
    sw.busy=true;
    const runs=sw.items.map((it,i)=>it.card.animate([{transform:'none',opacity:1},{transform:`translateY(${-CARD.h*1.2}px)`,opacity:0}],{duration:time(220),delay:time(i*30),easing:'cubic-bezier(.3,.5,.4,1)',fill:'forwards'}));
    settled(runs).then(()=>{if(!sw)return;for(const it of sw.items)forget(it);sw.items=[];sw.busy=false;closeSwitcher();});
  });
  // The finger's speed over its last moments (px/ms); with few moves to go by, from the one before
  function velocity(samples){
    const last=samples.at(-1);let i=samples.length-1;
    while(i>0&&last.t-samples[i-1].t<=90)i--;
    if(i===samples.length-1&&i>0&&last.t-samples[i-1].t<=300)i--;
    const first=samples[i],dt=last.t-first.t;
    return dt>0?{x:(last.x-first.x)/dt,y:(last.y-first.y)/dt}:{x:0,y:0};
  }
  {
    // A finger on the cards: sideways slides them (a touch scrolls the row itself; a mouse drags it), up lifts a card
    // to close it; a tap opens it, a tap beside them goes Home
    let touch=null;
    recents.addEventListener('pointerdown',event=>{
      if(!sw||sw.preview||sw.closing||touch||(event.pointerType==='mouse'&&event.button!==0)||event.target.closest('.switcher-close-all'))return;
      const now=performance.now();
      touch={id:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY,left:recentList.scrollLeft,it:sw.items.find(it=>it.card.contains(event.target))||null,mode:null,samples:[{t:now,x:event.clientX,y:event.clientY}]};
    });
    recents.addEventListener('pointermove',event=>{
      if(!touch||event.pointerId!==touch.id||!sw)return;
      const now=performance.now();touch.samples.push({t:now,x:event.clientX,y:event.clientY});while(touch.samples.length>3&&now-touch.samples[0].t>200)touch.samples.shift();
      const dx=event.clientX-touch.x,dy=event.clientY-touch.y;
      if(!touch.mode){
        if(Math.hypot(dx,dy)<8)return;
        touch.mode=Math.abs(dy)>Math.abs(dx)?(dy<0&&touch.it&&!sw.busy?'clear':'none'):'slide';
        if(touch.mode==='clear'||touch.type==='mouse')try{recents.setPointerCapture(event.pointerId);}catch{}
      }
      if(touch.mode==='slide'&&touch.type==='mouse')recentList.scrollLeft=touch.left-dx;
      else if(touch.mode==='clear'){touch.it.card.style.transform=`translateY(${dy<0?dy:dy*.2}px)`;}
    });
    const end=(event,cancelled)=>{
      if(!touch||event.pointerId!==touch.id)return;
      const t=touch;touch=null;if(!sw)return;
      const v=velocity(t.samples),dy=event.clientY-t.y;
      if(t.mode==='clear'){
        if(!cancelled&&(dy<-CARD.h*.3||v.y<-.6&&dy<-24))removeCard(t.it);
        else{const from=t.it.card.style.transform;t.it.card.style.transform='';t.it.card.animate([{transform:from||'none'},{transform:'none'}],{duration:time(280),easing:spring()});}
        swallowClick();
      }else if(t.mode==='slide')swallowClick();
      else if(!t.mode&&!cancelled&&!t.it&&!event.target.closest('.switcher-close-all'))closeSwitcher();
    };
    // (a card's own click opens it; one that ended a swipe doesn't)
    const swallowClick=()=>{const swallow=e=>{e.stopPropagation();e.preventDefault();};recents.addEventListener('click',swallow,{capture:true,once:true});setTimeout(()=>recents.removeEventListener('click',swallow,{capture:true}),0);};
    recents.addEventListener('pointerup',event=>end(event,false));
    recents.addEventListener('pointercancel',event=>end(event,true));
    recentList.addEventListener('click',event=>{const it=sw?.items.find(x=>x.card.contains(event.target));if(it)openCard(it);});
    recents.addEventListener('keydown',event=>{
      recents.classList.add('keys');
      if(!sw||sw.preview||sw.closing||!sw.items.length)return;
      const i=Math.max(0,sw.items.findIndex(x=>x.card===document.activeElement)),it=sw.items[i];
      if(event.key==='ArrowRight'){event.preventDefault();focusCard(i+1);}
      else if(event.key==='ArrowLeft'){event.preventDefault();focusCard(i-1);}
      else if((event.key==='Delete'||event.key==='Backspace'||event.key==='ArrowUp')&&document.activeElement===it.card){event.preventDefault();removeCard(it);}
    });
    recents.addEventListener('pointerdown',()=>recents.classList.remove('keys'),true);
    // Escape: back to the app that was open
    recents.addEventListener('cancel',event=>{event.preventDefault();if(sw&&!sw.preview)closeSwitcher(Boolean(sw.current));});
  }

  async function goBack(){
    if(locked||flight||gesture)return;
    if(recents.open){closeSwitcher(Boolean(sw?.current));return;}
    // Back closes the keyboard first (a field being typed in), then a pop-up, then goes to the screen before, then Home
    const typing=document.activeElement;
    if(typing&&typing!==document.body&&(typing.matches?.('textarea,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit])')||typing.isContentEditable)&&!typing.closest('#settings-search')){typing.blur();return;}
    const opened=dialogs.filter(dialog=>dialog.open).at(-1);
    if(opened){if(opened.id==='settings-dialog'&&window.RestroThemeSettings?.goBack())return;if(opened.id==='counter-dialog'&&window.RestroCounter?.goBack())return;if(opened.id==='orders-dialog'&&window.RestroOrders?.goBack())return;if(opened.id==='customers-dialog'&&window.RestroCustomers?.goBack())return;if(opened.id==='employees-dialog'&&window.RestroEmployees?.goBack())return;if(opened.id==='qr-studio-dialog'&&window.RestroQrStudio?.goBack())return;opened.close();return;}
    if(arranging){endDrag(true);setArranging(false);return;}
    if(currentPage>0){goToPage(currentPage-1);return;}
    await nativeAction('goBack');
  }
  // Recent apps from the keyboard or the tablet: the open app shrinks into its card
  async function showRecents(){
    if(locked||flight||gesture)return;
    if(await nativeAction('openRecentApps'))return;
    if(recents.open){closeSwitcher(Boolean(sw?.current));return;}
    keepAll();
    openSwitcher(null,false);
    enterSwitcher();
  }
  document.querySelector('#system-back').addEventListener('click',goBack);
  document.querySelector('#system-home').addEventListener('click',goHome);
  document.querySelector('#system-recents').addEventListener('click',showRecents);
  // The tablet's own Back, Home and Recent apps (gestures or buttons) come in here from the RESTRO Android app
  window.RestroSystem=Object.freeze({back:goBack,home:goHome,recents:showRecents});

  // ---------- The swipe bar, like an iPhone: swipe up from the bottom strip and the open app shrinks with the finger;
  // let go and it closes into its icon on the home screen. Swipe up and hold still (or swipe up a long way, slowly)
  // and Recent apps comes in around it; let go there to stay in Recent apps. A short, slow move, or a tap, does
  // nothing. In Recent apps, a swipe up from the strip goes to the home screen. ----------
  const HOME_TRAVEL=48,armTravel=()=>Math.max(64,innerHeight*.1),longTravel=()=>innerHeight*.45;
  bar.addEventListener('pointerdown',event=>{
    if(barMode()||locked||flight||gesture||event.target.closest('.android-controls,.system-lock')||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();motion(true);
    const now=performance.now();
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,travel:0,samples:[{t:now,x:event.clientX,y:event.clientY}],
      begun:false,armed:false,win:null,target:null,mode:recents.open&&!sw?.preview?'switcher':'window',still:0,anchor:null,slowSince:0};
    bar.setPointerCapture(event.pointerId);
  });
  function begin(g){
    g.begun=true;
    if(g.mode==='switcher')return;
    holdVeil();homeBehind();
    g.win=grabWindow();
    g.target=g.win?targetFor(g.win.els):null;
  }
  // Held: the app goes back to its place and Recent apps comes over it (N5)
  function arm(g){
    if(g.armed||gesture!==g)return;
    g.armed=true;clearTimeout(g.still);
    if(g.win){const w=g.win;for(const el of w.els)el.animate([{transform:el.style.transform||'none'},{transform:'none'}],{duration:time(240),easing:spring()});releaseWindow(w);}
    settleHome(time(240),spring());
    keepAll();
    openSwitcher(g.win,true);
  }
  function disarm(g){
    g.armed=false;g.anchor=null;g.slowSince=0;
    if(recents.open)recents.close();
    if(g.win){g.win=grabWindow();g.target=g.win?targetFor(g.win.els):null;if(g.win)dragWindow(g.win,g.dx,g.dy);}
  }
  function watchForPause(g,x,y,now){
    if(g.armed)return;
    // Held still: the finger stays within a few pixels for a moment
    if(!g.anchor||Math.hypot(x-g.anchor.x,y-g.anchor.y)>6){
      g.anchor={x,y};clearTimeout(g.still);
      const anchor=g.anchor;
      g.still=setTimeout(()=>requestAnimationFrame(()=>{if(gesture===g&&!g.armed&&g.anchor===anchor&&g.travel>=armTravel())arm(g);}),150);
    }
    // Or moving slowly
    const v=velocity(g.samples);
    if(g.travel>=armTravel()&&Math.hypot(v.x,v.y)<.12){g.slowSince||=now;if(now-g.slowSince>=170)arm(g);}else g.slowSince=0;
  }
  bar.addEventListener('pointermove',event=>{
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    const now=performance.now();g.samples.push({t:now,x:event.clientX,y:event.clientY});while(g.samples.length>3&&now-g.samples[0].t>200)g.samples.shift();
    g.dx=event.clientX-g.x;g.dy=Math.min(0,event.clientY-g.y);g.travel=-g.dy;
    if(!g.begun){if(g.travel<6)return;begin(g);}
    if(g.mode==='switcher'){recentList.style.transform=`translateY(${(g.dy*.25).toFixed(1)}px)`;return;}
    if(g.armed)return;
    if(g.win)dragWindow(g.win,g.dx,g.dy);
    const p=Math.min(1,g.travel/160);veil.style.opacity=p.toFixed(3);zoomHome(p);
    watchForPause(g,event.clientX,event.clientY,now);
  });
  async function swipeHome(g,v){
    const f=flight={w:g.win,target:g.target,switcher:g.armed,home:true};
    if(g.armed&&sw){
      flight=null;await closeSwitcher();return;
    }else if(g.win){
      await flyHome(g.win,g.target,{x:v.x*.8,y:v.y*.72});
      if(f.stopped)return;
      keepAll();putAway(g.win);
    }else await settled(settleHome(time(300),spring()));
    if(f.stopped)return;
    landed(g.target);homeReached();
  }
  async function settleBack(g){
    const w=g.win,f=flight={w};
    const D=time(320),ease=spring(),runs=[];
    if(w){
      for(const el of w.els)runs.push(el.animate([{transform:el.style.transform||'none'},{transform:'translate(0px,0px) scale(1)'}],{duration:D,easing:ease,fill:'forwards'}));
    }
    runs.push(...settleHome(D,ease));
    await settled(runs);
    if(f.stopped)return;
    if(w)releaseWindow(w);
    flight=null;positionBar();
  }
  function endSwipe(event,cancelled){
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    clearTimeout(g.still);gesture=null;
    if(!g.begun){if(!sw&&!flight)motion(false);positionBar();return;}
    g.samples.push({t:performance.now(),x:event.clientX,y:event.clientY});
    const v=velocity(g.samples),flick=-v.y>.6&&g.travel>20;
    if(g.mode==='switcher'){
      const lifted=recentList.style.transform;recentList.style.transform='';
      if(!cancelled&&(g.travel>=30||flick))closeSwitcher();
      else if(lifted)recentList.animate([{transform:lifted},{transform:'none'}],{duration:time(260),easing:spring()});
      return;
    }
    if(cancelled){if(g.armed)disarm(g);settleBack(g);return;}
    if(g.armed&&!flick){enterSwitcher();return;}
    if(!g.armed&&!flick&&g.travel>=longTravel()&&-v.y<.45){gesture=g;arm(g);gesture=null;enterSwitcher();return;}
    if(flick||g.travel>=HOME_TRAVEL){swipeHome(g,v);return;}
    settleBack(g);
  }
  bar.addEventListener('pointerup',event=>endSwipe(event,false));
  bar.addEventListener('pointercancel',event=>endSwipe(event,true));
  bar.addEventListener('contextmenu',event=>event.preventDefault());

  // ---------- Back: swipe in from the left or right edge while an app or a window is open (on the home screen the
  // edges turn the pages; in Recent apps a sideways swipe only slides the cards). A round arrow comes out with the
  // finger; far enough, and it goes back. ----------
  const EDGE=22,BACK_DISTANCE=64,arrow=bar.querySelector('.back-arrow');
  let edge=null;
  const topView=()=>dialogs.filter(dialog=>dialog.open&&dialog!==lock).at(-1)||null;
  function paintArrow(progress){
    const p=Math.max(0,Math.min(1,progress)),x=edge.side>0?-40+56*p:innerWidth-56*p,y=Math.max(8,Math.min(innerHeight-48,edge.y-20));
    arrow.classList.toggle('right',edge.side<0);
    arrow.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px) scale(${p>=1?1.1:1})`;arrow.style.opacity=String(Math.min(1,p*1.6));
  }
  document.addEventListener('pointerdown',event=>{
    edge=null;
    if(barMode()||locked||gesture||flight||recents.open||!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0)||!topView()||event.target.closest?.('.home-bar'))return;
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
  window.addEventListener('restro:app-uninstalled',event=>{recentApps.delete(event.detail.id);pictures.delete(event.detail.id);if(recents.open&&sw){const it=sw.items.find(x=>x.key===event.detail.id);if(it)removeCard(it);}});
  // ---------- Lock, go dark, wake (Navigation & Lock Update 1) ----------
  // The lock button (at the far right of the navigation bar, or the round one at the bottom right in swipe mode) locks
  // at once, with no "are you sure?". So does the tablet's own power button (restro:device-locked, from the Android
  // app), and Auto-lock after the time without a tap set in Settings › Staff & security. Go dark (Settings › Display ›
  // Navigation): the screen turns black and locks together; a double tap wakes it to the PIN pad (a single tap does
  // nothing, and the waking taps never count as PIN digits). Whatever was open stays as it was under the lock: the same
  // app, page, order and pop-up are there after signing in. Once staff accounts exist only a PIN ends a lock (staff
  // sign-in, employees.js); before that, Unlock does.
  let pinRequired=false;
  function lockScreen(){
    if(locked)return;
    if(recents.open)closeSwitcher(true);
    locked=true;try{sessionStorage.setItem('restro.screenLocked','true');}catch{}
    root.toggleAttribute('data-locked',true);
    syncLock();for(const button of navigation)button.disabled=true;
    if(!lock.open)lock.showModal();positionBar();
    window.dispatchEvent(new CustomEvent('restro:screen-locked'));
  }
  function unlock(){
    locked=false;try{sessionStorage.removeItem('restro.screenLocked');}catch{}
    root.toggleAttribute('data-locked',false);wake();
    for(const button of navigation)button.disabled=false;lock.close();positionBar();
    const top=openStack().at(-1);(top||shell).focus?.({preventScroll:true});
    window.dispatchEvent(new CustomEvent('restro:screen-unlocked'));
  }
  document.querySelector('#system-lock').addEventListener('click',lockScreen);
  // The tablet's own keyboard. RESTRO types with its own (keyboard.js, owner 13 Nov 2026), so the tablet's doesn't open
  // in RESTRO; if one ever does (a field left out, a page we don't draw), Android draws it over the app and nothing
  // moves the navigation bar or the lock for it (owner, 12 and 13 Nov 2026). While it covers the bottom of the page,
  // --keyboard is how much it covers. How much it covers:
  // - in a browser, the part of the page in view gets shorter (visualViewport);
  // - the RESTRO Android app, when it keeps the page full height under its keyboard, says so with a restro:keyboard
  //   event ({ height } in CSS pixels, 0 when the keyboard goes down);
  // - where neither tells (the page shown inside another page, as on the tablet link), on a touch screen while a field
  //   that takes typing has the focus: 45% of the screen, a tablet keyboard's height or a little more.
  // A page that the keyboard makes shorter already ends at the keyboard.
  const typingField=el=>((el instanceof HTMLTextAreaElement&&!el.readOnly&&!el.disabled)||(el instanceof HTMLInputElement&&!el.readOnly&&!el.disabled&&/^(text|search|email|tel|url|number|password)$/.test(el.type))||Boolean(el?.isContentEditable))&&el.inputMode!=='none';
  let appKeyboard=0,tells=false,guess=false,guessTimer=0,tallest=window.innerHeight,wide=window.innerWidth;
  const keyboard=()=>{
    if(window.innerWidth!==wide){wide=window.innerWidth;tallest=window.innerHeight;}
    tallest=Math.max(tallest,window.innerHeight);
    const view=window.visualViewport;
    const covered=view&&view.scale<1.01?window.innerHeight-view.height-view.offsetTop:0;
    if(covered>80||appKeyboard>0||window.innerHeight<tallest*.85)tells=true;
    let px=Math.max(covered,appKeyboard);
    if(px<=80&&guess&&!tells&&typingField(document.activeElement))px=window.innerHeight*.45;
    root.style.setProperty('--keyboard',px>80?`${Math.round(px)}px`:'0px');
  };
  window.visualViewport?.addEventListener('resize',keyboard);window.visualViewport?.addEventListener('scroll',keyboard);
  window.addEventListener('resize',keyboard);
  window.addEventListener('restro:keyboard',event=>{appKeyboard=Math.max(0,Number(event.detail?.height)||0);keyboard();});
  document.addEventListener('focusin',()=>{
    clearTimeout(guessTimer);
    if(!tells&&matchMedia('(pointer: coarse)').matches&&typingField(document.activeElement))guessTimer=setTimeout(()=>{guess=true;keyboard();},500);
  });
  document.addEventListener('focusout',()=>setTimeout(()=>{if(!typingField(document.activeElement)){clearTimeout(guessTimer);guess=false;keyboard();}},0));
  // Go dark: our own black screen over everything (inside the lock screen, which is over everything), the backlight at
  // its minimum where the RESTRO Android app lets us (RESTRODevice.setScreenDark). The power button still turns the
  // display fully off.
  let dark=false,darkTaps=[];
  function goDark(){
    if(dark)return;
    lockScreen();dark=true;darkTaps=[];
    darkScreen.classList.add('on');
    try{window.RESTRODevice?.setScreenDark?.(true);}catch{}
  }
  function wake(){
    if(!dark)return;
    dark=false;
    darkScreen.classList.remove('on');
    try{window.RESTRODevice?.setScreenDark?.(false);}catch{}
    lastInput=Date.now();
    lock.querySelector('#screen-lock-title')?.focus({preventScroll:true});
  }
  // Two taps close together (in time and place) wake it; each tap stays on the black screen, so nothing under it is
  // pressed
  darkScreen.addEventListener('pointerdown',event=>{
    event.preventDefault();
    const now=performance.now();darkTaps=darkTaps.filter(t=>now-t.t<450&&Math.hypot(t.x-event.clientX,t.y-event.clientY)<80);
    darkTaps.push({t:now,x:event.clientX,y:event.clientY});
    if(darkTaps.length>=2){darkTaps=[];setTimeout(wake,0);}
  });
  for(const type of ['click','pointerup','contextmenu'])darkScreen.addEventListener(type,event=>{event.preventDefault();event.stopPropagation();});
  // Idle: how long since the last tap or key, checked every few seconds (Auto-lock, then Go dark)
  let lastInput=Date.now();
  for(const type of ['pointerdown','keydown','wheel'])addEventListener(type,()=>{if(!dark)lastInput=Date.now();},{capture:true,passive:true});
  setInterval(()=>{
    const idle=Date.now()-lastInput,prefs=window.RestroPrefs;if(!prefs)return;
    const after=prefs.get('security').autoLock,darkAfter=prefs.get('screen').goDark;
    if(darkAfter&&idle>=darkAfter*60000&&!dark)goDark();
    else if(after&&idle>=after*60000&&!locked)lockScreen();
  },5000);
  window.addEventListener('restro:prefs-changed',event=>{if(event.detail?.name==='navigation')applyNav();});
  document.querySelector('#screen-unlock').addEventListener('click',()=>{if(!pinRequired)unlock();});
  lock.addEventListener('cancel',event=>event.preventDefault());
  window.addEventListener('restro:device-unlocked',()=>{if(locked&&!pinRequired)unlock();});
  window.addEventListener('restro:device-locked',lockScreen);
  window.RestroScreenLock=Object.freeze({lock:lockScreen,unlock,goDark,wake,requirePin(on){pinRequired=Boolean(on);},get locked(){return locked;},get dark(){return dark;}});
  new MutationObserver(()=>{if(locked)syncLock();}).observe(document.querySelector('#clock'),{childList:true,subtree:true,characterData:true});
  if(locked){root.toggleAttribute('data-locked',true);syncLock();for(const button of navigation)button.disabled=true;lock.showModal();}
  positionBar();
})();
