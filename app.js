'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const art = (source, x, y, w, h) => ({ source, x, y, w, h });
const shortcuts = [
  { id:'register', name:'Counter', art:art('master',74,130,210,205) },
  { id:'floor', name:'Floor', art:art('master',360,138,220,195) },
  { id:'orders', name:'Orders', art:art('master',677,125,174,208) },
  { id:'pager-hub', name:'Pager Hub', art:{file:'pager-hub-p59.png',w:1536,h:1024,viewBox:'153 78 1300 896'} },
  { id:'closeout', name:'End Day', art:art('master',962,146,210,189) }
];
// The home screen's apps (POS Home Handoff), in the design's order: page 1 Payments to Menu, page 2 Gallery, Camera and
// Help. Their icons come from assets/app-icons (theme-artwork.js). Printers is set up in Settings, so it is not an app.
const tileArt = name => ({ url: `assets/app-icons/${name}.webp`, w: 384, h: 384, tile: true });
const apps = {
  transactions:{name:'Payments',art:art('master',299,478,184,128)},
  inventory:{name:'Inventory',art:art('master',997,474,178,133)},
  refunds:{name:'Refunds',art:art('master',540,477,172,128)},
  cash:{name:'Cash Bag',art:art('apps',772,472,158,133)},
  calculator:{name:'Calculator',art:tileArt('calculator')},
  employees:{name:'Staff',art:art('master',46,667,196,124)},
  customers:{name:'Customers',art:art('master',299,674,173,117)},
  analytics:{name:'Analytics',art:art('analytics',70,490,172,144)},
  settings:{name:'Settings',art:{file:'settings-g39.png',w:1254,h:1254,viewBox:'22 150 1221 986'}},
  store:{name:'More Apps',art:art('apps',980,659,211,146)},
  'qr-studio':{name:'QR Studio',art:{url:'assets/qr-studio/D.webp',w:1536,h:1024,viewBox:'48 405 244 264',sprite:true,themeId:'D'}},
  menu:{name:'Availability',art:art('master',49,478,212,128)},
  gallery:{name:'Gallery',art:tileArt('gallery')},
  camera:{name:'Camera',art:tileArt('camera')},
  help:{name:'Help',art:art('master',778,668,155,123)}
};
shortcuts.forEach(item=>{item.art.key=item.id;});
Object.entries(apps).forEach(([id,item])=>{item.art.key=id;});
const removedAppIds=new Set();
try{const saved=JSON.parse(localStorage.getItem('restro.removedApps.v1')||'[]');if(Array.isArray(saved))saved.forEach(id=>{if(Object.hasOwn(apps,id))removedAppIds.add(id);});}catch{}
function isInstalledApp(id){return Object.hasOwn(apps,id)&&!removedAppIds.has(id);}
function installedAppIds(){return Object.keys(apps).filter(isInstalledApp);}
// Every surface, including theme previews and quick controls, uses this artwork catalog.
function artSource(a){return a.url||`assets/icons/${a.file||`${a.source}-${a.x}-${a.y}-${a.w}-${a.h}.png`}`;}
const PAGE_CAPACITY=RestroLayout.capacity;
// Any app can sit in the dock or on the pages: the five main apps (shortcuts) start in the dock, the rest on the pages.
const shortcutById=new Map(shortcuts.map(item=>[item.id,item]));
function itemOf(id){return Object.hasOwn(apps,id)?apps[id]:shortcutById.get(id)||null;}
function isHomeItem(id){return shortcutById.has(id)||isInstalledApp(id);}
// The dock always holds five apps, by default the five main ones. Staff can reorder them, and swap any of them with an
// app on the pages (each takes the other's place). A place left by an uninstalled app goes back to a main app.
const DOCK_SIZE=5,defaultDock=shortcuts.map(item=>item.id);
function restoreDock(saved){
  const places=Array.from({length:DOCK_SIZE},(_,i)=>Array.isArray(saved)?saved[i]:defaultDock[i]),seen=new Set();
  const dockIds=places.map(id=>{if(typeof id!=='string'||!isHomeItem(id)||seen.has(id))return null;seen.add(id);return id;});
  const spare=defaultDock.filter(id=>!seen.has(id));
  return dockIds.map(id=>id||spare.shift());
}
let savedDock=null;
try{savedDock=JSON.parse(localStorage.getItem('restro.dock.v1')||'null');}catch{}
let dock=restoreDock(savedDock);
// Everything not in the dock goes on the pages: the apps first, then any main app swapped out of the dock
const pageItemIds=()=>[...installedAppIds(),...defaultDock].filter(id=>!dock.includes(id));
// Two pages, as designed: the first 12 apps, then the rest. The design's set and order start every tablet afresh once
// (a new layout key); after that, apps and pages moved by staff stay as they leave them.
const defaultPages=[installedAppIds().slice(0,PAGE_CAPACITY),installedAppIds().slice(PAGE_CAPACITY)];
let savedPages=null;
try{savedPages=JSON.parse(localStorage.getItem('restro.appLayout.v5')||'null');}catch{}
let pages=RestroLayout.restore(savedPages,pageItemIds(),defaultPages);
let currentPage=0, arranging=false, drag=null, holdTimer=null, gesture=null, moveId=null, deleteAppId=null, deletingApp=false, toastTimer=null, lastWheelAt=0;
const viewport=$('#apps-viewport'), track=$('#pages-track');
// Horizontal centers of the unchanged PNG artwork, including its transparent margins.
const artworkOffsets={
  'master-74-130-210-205':1.5,'master-360-138-220-195':5,'master-677-125-174-208':-2,'master-962-146-210-189':3,
  'master-49-478-212-128':0,'master-299-478-184-128':-1.5,'master-540-477-172-128':2,'apps-772-472-158-133':-4,
  'master-997-474-178-133':4.5,'master-46-667-196-124':8,'master-299-674-173-117':6.5,'master-532-657-172-134':6,
  'master-778-668-155-123':3.5,'apps-980-659-211-146':0,'analytics-70-490-172-144':-3.5
};
let artworkWindowId=0;
function artNode(definition,themeId){
  const wrapper=document.createElement('span');wrapper.className='app-art';wrapper.setAttribute('aria-hidden','true');
  wrapper._restroArt=definition;
  if(definition.key)wrapper.dataset.artworkKey=definition.key;
  if(themeId)wrapper.dataset.artworkTheme=themeId;
  const a=window.RestroArtwork.resolve(definition,themeId);
  if(a.file||a.url){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox',a.viewBox||`0 0 ${a.w} ${a.h}`);svg.setAttribute('preserveAspectRatio',a.sprite||a.clean||a.tile?'xMidYMid meet':'xMidYMax meet');svg.setAttribute('focusable','false');
    if(a.tile)wrapper.classList.add('tile-art');
    const image=document.createElementNS('http://www.w3.org/2000/svg','image');image.setAttribute('href',artSource(a));image.setAttribute('width',a.w);image.setAttribute('height',a.h);
    if(a.sprite){
      wrapper.classList.add('theme-art');wrapper.dataset.renderedTheme=a.themeId;
      // Clip the exact artwork window. SVG's meet padding must not show adjacent
      // labels, tile edges or other icons from the untouched original sheet.
      const ns='http://www.w3.org/2000/svg',defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),rect=document.createElementNS(ns,'rect');
      const clipId=`restro-art-window-${++artworkWindowId}`,[x,y,w,h]=a.viewBox.split(' ').map(Number);
      clip.id=clipId;clip.setAttribute('clipPathUnits','userSpaceOnUse');
      for(const [name,value] of Object.entries({x,y,width:w,height:h}))rect.setAttribute(name,value);
      clip.append(rect);defs.append(clip);svg.append(defs);image.setAttribute('clip-path',`url(#${clipId})`);
    }
    if(a.clean){wrapper.classList.add('theme-art','clean-art');wrapper.dataset.renderedTheme=a.themeId;}
    if(a.selection)wrapper.dataset.artworkSelection=a.selection;
    svg.append(image);wrapper.append(svg);return wrapper;
  }
  if(a.symbol){
    wrapper.classList.add('settings-art');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('focusable','false');use.setAttribute('href',`#${a.symbol}`);svg.append(use);wrapper.append(svg);return wrapper;
  }
  const key=`${a.source}-${a.x}-${a.y}-${a.w}-${a.h}`,offset=artworkOffsets[key]||0;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${offset} 0 ${a.w} ${a.h}`);svg.setAttribute('preserveAspectRatio','xMidYMax meet');svg.setAttribute('focusable','false');
  const image=document.createElementNS('http://www.w3.org/2000/svg','image');image.setAttribute('href',artSource(a));image.setAttribute('width',a.w);image.setAttribute('height',a.h);
  svg.append(image);wrapper.append(svg);return wrapper;
}
function refreshArtwork(){
  document.querySelectorAll('.app-art[data-artwork-key]').forEach(wrapper=>{
    const key=wrapper.dataset.artworkKey;
    const definition=wrapper._restroArt||apps[key]?.art||shortcuts.find(item=>item.id===key)?.art||(key==='insight-sales'?{key,url:'assets/insights-sales.svg',w:220,h:160}:null);
    if(!definition)return;
    const replacement=artNode(definition,wrapper.dataset.artworkTheme);
    wrapper.replaceChildren(...replacement.childNodes);
    wrapper.classList.toggle('theme-art',replacement.classList.contains('theme-art'));
    wrapper.classList.toggle('clean-art',replacement.classList.contains('clean-art'));
    wrapper.classList.toggle('tile-art',replacement.classList.contains('tile-art'));
    if(replacement.dataset.renderedTheme)wrapper.dataset.renderedTheme=replacement.dataset.renderedTheme;
    else delete wrapper.dataset.renderedTheme;
    if(replacement.dataset.artworkSelection)wrapper.dataset.artworkSelection=replacement.dataset.artworkSelection;
    else delete wrapper.dataset.artworkSelection;
  });
}
window.addEventListener('restro:theme-changed',refreshArtwork);
window.addEventListener('restro:artwork-changed',refreshArtwork);
document.querySelectorAll('[data-app-icon]').forEach(image=>{const item=apps[image.dataset.appIcon]||shortcuts.find(entry=>entry.id===image.dataset.appIcon);if(item)image.replaceWith(artNode(item.art));});

// An app's icon: its art on a rounded-square tile (an app's count badge goes beside it: home-widgets.js, Update Pack 5 J)
function appIcon(item){
  const icon=document.createElement('span');icon.className='app-icon';icon.dataset.icon=item.art.key;icon.append(artNode(item.art));
  return icon;
}
// The dock: its five apps, each opening as it does on the pages. End Day has nothing to open yet.
const dockNav=$('#main-shortcuts');
function renderDock(){
  dockNav.replaceChildren();
  dock.forEach((id,index)=>{
    const item=itemOf(id);if(!item)return;
    const node=document.createElement('div');node.className='shortcut'+(drag&&drag.id===id?' drag-origin':'');node.dataset.app=id;node.dataset.dock=index;
    const label=document.createElement('span');label.className='shortcut-label';label.textContent=item.name;
    node.append(appIcon(item),label);
    if(id!=='closeout'){node.setAttribute('role','button');node.tabIndex=0;node.setAttribute('aria-label',`${item.name}. Hold to rearrange or press M to move.`);}
    dockNav.append(node);
  });
}
function openItem(id){
  if(id==='register')window.RestroCounter?.open();
  else if(id==='floor')window.RestroFloor?.open();
  else if(id==='orders')window.RestroOrders?.open();
  else if(id==='pager-hub')window.RestroPagerHub?.open();
  else if(Object.hasOwn(apps,id))openApp(id);
}
function renderPages(){
  track.replaceChildren();
  pages.forEach((page,p)=>{
    const section=document.createElement('section');section.className='apps-page';section.dataset.page=p;section.id=`apps-page-${p}`;section.setAttribute('role','tabpanel');section.setAttribute('aria-label',`Apps page ${p+1}`);
    for(let position=0;position<PAGE_CAPACITY;position++){
      const id=page[position];const slot=document.createElement('div');slot.className='app-slot'+(!id?' empty':'')+(drag&&drag.id===id?' drop-target':'');slot.dataset.page=p;slot.dataset.position=position;
      if(id){
        const item=itemOf(id),tile=document.createElement('div');tile.className='app-tile'+(drag&&drag.id===id?' drag-origin':'');tile.dataset.id=id;tile.tabIndex=0;tile.setAttribute('role','group');tile.setAttribute('aria-label',`${item.name}. Hold to rearrange or press M to move.`);
        const label=document.createElement('span');label.className='app-label';label.textContent=item.name;tile.append(appIcon(item),label);
        if(arranging&&Object.hasOwn(apps,id)){
          const remove=document.createElement('button');remove.type='button';remove.className='app-remove-button';remove.setAttribute('aria-label',`Uninstall ${item.name}`);remove.title=`Uninstall ${item.name}`;
          remove.innerHTML='<span class="app-remove-symbol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></span>';
          remove.addEventListener('click',event=>{event.stopPropagation();requestAppDeletion(id);});tile.append(remove);
        }
        slot.append(tile);
      }else{slot.tabIndex=0;slot.setAttribute('role','button');slot.setAttribute('aria-label',`Empty app slot ${position+1}. Hold or press Space to edit pages.`);}
      section.append(slot);
    }
    if(arranging&&!page.length&&pages.length>1){
      const button=document.createElement('button');button.type='button';button.className='page-delete-control';button.setAttribute('aria-label',`Delete empty page ${p+1}`);
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v8M14 10v8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      button.addEventListener('click',()=>deleteAppPage(p));section.append(button);
    }
    track.append(section);
  });
  if(arranging){
    const section=document.createElement('section');section.className='apps-page add-page-preview';section.setAttribute('aria-label','Add an app page');
    const button=document.createElement('button');button.type='button';button.className='add-page-control';button.setAttribute('aria-label','Add a new app page');
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    button.addEventListener('click',addAppPage);section.append(button);track.append(section);
  }
  renderDock();renderDots();updatePage(false);document.body.classList.toggle('arranging',arranging);
}
function renderDots(){
  $('#page-dots').replaceChildren();
  for(let p=0;p<pages.length;p++){
    const button=document.createElement('button');button.type='button';button.className='page-dot';button.setAttribute('role','tab');button.setAttribute('aria-label',`Show app page ${p+1}`);button.setAttribute('aria-controls',`apps-page-${p}`);button.dataset.page=p;button.addEventListener('click',()=>goToPage(p));$('#page-dots').append(button);
  }
}
function updatePage(animate=true){
  track.classList.toggle('no-transition',!animate);track.style.transform=`translateX(-${currentPage*100}%)`;
  $$('.apps-page',track).forEach((page,p)=>{page.inert=p!==currentPage;page.setAttribute('aria-hidden',String(p!==currentPage));});
  $$('.page-dot',$('#page-dots')).forEach((dot,p)=>{dot.setAttribute('aria-selected',String(p===currentPage));dot.tabIndex=p===currentPage?0:-1;});
  $('#swipe-hint').textContent=arranging?'Hold near the edge to change pages':currentPage===pages.length-1?'Swipe right to go back':'Swipe left for more';
  $('#page-announcement').textContent=currentPage===pages.length?'Add an app page':`More Apps, page ${currentPage+1} of ${pages.length}`;
}
function goToPage(page){
  const next=Math.max(0,Math.min(pages.length-1+(arranging?1:0),Number(page)));if(!Number.isInteger(next))return false;
  currentPage=next;updatePage();return true;
}
function setArranging(value){if(arranging===value)return;arranging=value;if(!value)currentPage=Math.min(currentPage,pages.length-1);renderPages();}
function saveLayout(){try{localStorage.setItem('restro.appLayout.v5',JSON.stringify(pages));localStorage.setItem('restro.dock.v1',JSON.stringify(dock));}catch{}}
function moveApp(id,targetPage,targetPosition){
  if(!isHomeItem(id)||dock.includes(id))throw new Error('Choose an app on the pages.');
  const moved=RestroLayout.move(pages,id,targetPage,targetPosition);pages=moved.pages;
  saveLayout();currentPage=moved.page;renderPages();return {app:id,page:moved.page+1,position:moved.position+1};
}
function addAppPage(){pages=RestroLayout.addPage(pages);currentPage=pages.length-1;saveLayout();renderPages();$('#page-announcement').textContent=`Page ${pages.length} added`;return {page:pages.length};}
function deleteAppPage(index){
  pages=RestroLayout.deletePage(pages,index);if(index<currentPage)currentPage--;currentPage=Math.min(currentPage,pages.length-1);
  saveLayout();renderPages();$('#page-announcement').textContent=`Empty page ${index+1} deleted`;return {pages:pages.length};
}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2400);}
function openDialog(id){const dialog=$(`#${id}`);if(!dialog.open)dialog.showModal();}
function requestAppDeletion(id){
  if(!arranging||!isInstalledApp(id)||deletingApp)return;
  endDrag(true);clearTimeout(holdTimer);holdTimer=null;gesture=null;deleteAppId=id;
  $('#delete-app-title').textContent=`Uninstall "${apps[id].name}"?`;
  $('#delete-app-art').replaceChildren(artNode(apps[id].art));$('#delete-app-error').textContent='';
  openDialog('delete-app-dialog');$('#delete-app-no').focus({preventScroll:true});
}
async function confirmAppDeletion(){
  const id=deleteAppId;if(!id||deletingApp||!isInstalledApp(id))return;
  deletingApp=true;$('#delete-app-yes').disabled=true;$('#delete-app-no').disabled=true;$('#delete-app-yes').textContent='Uninstalling…';
  try{
    // The Android host removes its package when present; the web POS keeps a durable installed-app list.
    const host=window.RESTRODevice;
    if(typeof host?.uninstallApp==='function'){
      const result=await host.uninstallApp(id);if(result===false||result?.success===false)throw new Error('The app could not be uninstalled. Please try again.');
    }
    removedAppIds.add(id);pages=pages.map(page=>page.filter(appId=>appId!==id));
    if(dock.includes(id)){dock=restoreDock(dock.map(appId=>appId===id?null:appId));pages=RestroLayout.restore(pages,pageItemIds(),pages);}
    try{localStorage.setItem('restro.removedApps.v1',JSON.stringify([...removedAppIds]));}catch{}
    saveLayout();renderPages();window.dispatchEvent(new CustomEvent('restro:app-uninstalled',{detail:{id,name:apps[id].name}}));
    $('#delete-app-dialog').close();toast(`${apps[id].name} uninstalled`);
  }catch(error){$('#delete-app-error').textContent=error.message||'The app could not be uninstalled. Please try again.';}
  finally{deletingApp=false;$('#delete-app-yes').disabled=false;$('#delete-app-no').disabled=false;$('#delete-app-yes').textContent='Yes';}
}
$('#delete-app-yes').addEventListener('click',confirmAppDeletion);
$('#delete-app-no').addEventListener('click',()=>{if(!deletingApp)$('#delete-app-dialog').close();});
$('#delete-app-dialog').addEventListener('cancel',event=>{if(deletingApp)event.preventDefault();});
$('#delete-app-dialog').addEventListener('close',()=>{deleteAppId=null;const slot=$(`.apps-page[data-page="${currentPage}"] .app-tile`);slot?.focus({preventScroll:true});});
function syncInstalledControls(){$$('[data-control="settings"]').forEach(control=>{control.hidden=!isInstalledApp('settings');});}
window.addEventListener('restro:app-uninstalled',syncInstalledControls);syncInstalledControls();
function openSettings(){$('#restaurant-input').value=restaurantName;window.RestroProfile?.fill();window.RestroThemeSettings?.reset();openDialog('settings-dialog');}
function openApp(id){if(!isInstalledApp(id))return;if(id==='settings')openSettings();else if(id==='analytics')openDialog('analytics-dialog');else if(id==='help')openDialog('help-dialog');else if(id==='customers')window.RestroCustomers?.open();else if(id==='employees')window.RestroEmployees?.open();else if(id==='qr-studio')window.RestroQrStudio?.open();else if(id==='calculator'||id==='camera')document.querySelector(`[data-control="${id}"]`)?.click();}
function openMove(id){
  const item=itemOf(id);if(!item)return;
  moveId=id;setArranging(true);
  const select=$('#move-page');select.replaceChildren();pages.forEach((_,p)=>{const option=document.createElement('option');option.value=p;option.textContent=`Page ${p+1}`;select.append(option);});
  const dockOption=document.createElement('option');dockOption.value='dock';dockOption.textContent='Dock';select.append(dockOption);
  const sourcePage=pages.findIndex(page=>page.includes(id));select.value=sourcePage<0?'dock':String(sourcePage);updateMovePositions();
  $('#move-position').value=String(sourcePage<0?dock.indexOf(id):pages[sourcePage].indexOf(id));openDialog('move-dialog');
}
// Within the pages an app is inserted (the apps after it shift along); to or from the dock it swaps with the app there
function updateMovePositions(){
  const value=$('#move-page').value,inDock=dock.includes(moveId),name=itemOf(moveId).name,list=$('#move-position');list.replaceChildren();
  const add=(position,text)=>{const option=document.createElement('option');option.value=String(position);option.textContent=text;list.append(option);};
  if(value==='dock'){
    $('#move-description').textContent=inDock?`Choose where ${name} goes in the dock.`:`Choose the dock app ${name} swaps places with.`;
    dock.forEach((other,i)=>add(i,other===moveId?'Where it is now':inDock?`In place of ${itemOf(other).name}`:`Swap with ${itemOf(other).name}`));
  }else if(inDock){
    const page=Number(value);$('#move-description').textContent=`Choose the app ${name} swaps places with.`;
    pages[page].forEach((other,i)=>add(i,`Swap with ${itemOf(other).name}`));
  }else{
    const page=Number(value);$('#move-description').textContent=`Choose where to insert ${name}. Following apps keep their order.`;
    const length=Math.min(PAGE_CAPACITY,pages[page].length+1);
    for(let i=0;i<length;i++)add(i,pages[page][i]?`Before ${itemOf(pages[page][i]).name}`:pages[page].length?'After the last app':'First app');
  }
}
// Holding an app lifts it out of its place (on the pages or in the dock): only the app itself shows, a little larger,
// and it follows the finger from where it was. Its place stays empty until it lands.
function startDrag(node,event){
  if(drag)return;
  const id=node.dataset.id||node.dataset.app,item=itemOf(id),fromDock=node.matches('.shortcut');if(!item)return;
  const icon=node.querySelector('.app-icon').getBoundingClientRect(),rect=node.getBoundingClientRect();
  setArranging(true);
  const ghost=document.createElement('div');ghost.className='app-tile drag-ghost';ghost.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.className='app-label';label.textContent=item.name;ghost.append(appIcon(item),label);
  // The app is the size of the place it is over: a page app's size over the pages, a dock app's over the dock
  const widthOf=node=>node?parseFloat(getComputedStyle(node).width):0;
  const sizes={page:widthOf(track.querySelector('.app-tile .app-icon'))||icon.width,dock:widthOf(dockNav.querySelector('.app-icon'))||icon.width};
  ghost.classList.toggle('in-dock',fromDock);ghost.style.setProperty('--icon',`${fromDock?sizes.dock:sizes.page}px`);
  const cx=rect.left+rect.width/2,cy=icon.top+icon.height/2;
  ghost.style.left=`${cx}px`;ghost.style.top=`${cy}px`;document.body.append(ghost);
  try{ghost.animate([{transform:'translate(-50%,-50%) scale(1)'},{transform:'translate(-50%,-50%) scale(1.08)'}],{duration:140,easing:'ease-out',fill:'forwards'});}catch{}
  drag={id,ghost,fromDock,sizes,inDock:fromDock,offsetX:event.clientX-cx,offsetY:event.clientY-cy,startPage:currentPage,edgeTimer:null,edgeDirection:0,target:null,lastX:event.clientX,lastY:event.clientY,
    original:{pages:pages.map(page=>[...page]),dock:[...dock]},previewKey:''};
  gesture=null;
  [...$$(`.app-tile[data-id="${id}"]`,track),...$$(`.shortcut[data-app="${id}"]`,dockNav)].forEach(origin=>origin.classList.add('drag-origin'));
  try{viewport.setPointerCapture(event.pointerId);}catch{}
}
// Where each app is shown right now, on the pages or in the dock (its centre, so the jiggle doesn't matter and a slide in
// progress is included)
function appPlaces(){
  const places=new Map();
  $$('.apps-page .app-tile',track).forEach(tile=>{const r=tile.getBoundingClientRect();places.set(tile.dataset.id,{page:tile.closest('.app-slot').dataset.page,x:r.left+r.width/2,y:r.top+r.height/2});});
  $$('.shortcut',dockNav).forEach(node=>{const r=node.getBoundingClientRect();places.set(node.dataset.app,{page:'dock',x:r.left+r.width/2,y:r.top+r.height/2});});
  return places;
}
// Apps that changed place slide from where they were shown to their new place (between the dock and this page too)
function slideFrom(before){
  const here=String(currentPage);
  [...$$('.apps-page .app-tile',track),...$$('.shortcut',dockNav)].forEach(node=>{
    const id=node.dataset.id||node.dataset.app,was=before.get(id),page=node.matches('.shortcut')?'dock':node.closest('.app-slot').dataset.page;
    if(!was||node.classList.contains('drag-origin'))return;
    if(was.page!==page&&!(was.page==='dock'&&page===here)&&!(page==='dock'&&was.page===here))return;
    const r=node.getBoundingClientRect(),dx=was.x-(r.left+r.width/2),dy=was.y-(r.top+r.height/2);if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
    try{node.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)',composite:'add'});}catch{}
  });
}
// The place under the finger, from the grid itself: apps sliding past never change it (no back-and-forth shaking).
function slotAt(x,y){return $$(`.apps-page[data-page="${currentPage}"] .app-slot`,track).find(slot=>{const r=slot.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;})||null;}
// The dock place under the finger: the dock's width in five equal places, so apps sliding along never change it
function dockAt(x,y){
  const r=dockNav.getBoundingClientRect();
  if(y<r.top-12||y>r.bottom||x<r.left||x>r.right)return null;
  return Math.max(0,Math.min(DOCK_SIZE-1,Math.floor((x-r.left)/(r.width/DOCK_SIZE))));
}
// What the home screen looks like with the held app put down here. On the pages it takes the place and the apps after
// it shift along; dropped on a dock app (or a dock app dropped on an app on the pages) the two swap places; in the dock
// the apps shift along. A dock app held over an empty place on the pages stays in the dock.
function arrange(o,id,target){
  const next={pages:o.pages.map(page=>[...page]),dock:[...o.dock]};
  if(!target)return next;
  if(!o.dock.includes(id)){
    if(target.kind==='page')next.pages=RestroLayout.place(o.pages,id,target.page,target.position).pages;
    else{const p=next.pages.findIndex(page=>page.includes(id)),i=next.pages[p].indexOf(id);next.pages[p][i]=o.dock[target.index];next.dock[target.index]=id;}
  }else{
    const from=o.dock.indexOf(id);
    if(target.kind==='dock'){next.dock.splice(from,1);next.dock.splice(target.index,0,id);}
    else{const other=o.pages[target.page]?.[target.position];if(!other)return next;next.pages[target.page][target.position]=id;next.dock[from]=other;}
  }
  return next;
}
function previewDrag(target){
  const before=appPlaces(),next=arrange(drag.original,drag.id,target);
  pages=next.pages;dock=next.dock;
  renderPages();slideFrom(before);
}
function updateDrag(event){
  if(!drag)return;drag.lastX=event.clientX;drag.lastY=event.clientY;
  drag.ghost.style.left=`${event.clientX-drag.offsetX}px`;drag.ghost.style.top=`${event.clientY-drag.offsetY}px`;
  const slot=slotAt(event.clientX,event.clientY),dockIndex=slot?null:dockAt(event.clientX,event.clientY),inDock=dockIndex!=null;
  if(inDock!==drag.inDock){drag.inDock=inDock;drag.ghost.classList.toggle('in-dock',inDock);drag.ghost.style.setProperty('--icon',`${inDock?drag.sizes.dock:drag.sizes.page}px`);}
  drag.target=slot&&Number(slot.dataset.page)===currentPage?{kind:'page',page:currentPage,position:Number(slot.dataset.position)}:dockIndex!=null?{kind:'dock',index:dockIndex}:drag.target;
  if(drag.target){const key=drag.target.kind==='dock'?`dock:${drag.target.index}`:`${drag.target.page}:${drag.target.position}`;if(key!==drag.previewKey){drag.previewKey=key;previewDrag(drag.target);}}
  const bounds=viewport.getBoundingClientRect();const inside=event.clientY>=bounds.top&&event.clientY<=bounds.bottom;
  const direction=inside&&event.clientX>bounds.right-46&&currentPage<pages.length-1?1:inside&&event.clientX<bounds.left+46&&currentPage>0?-1:0;
  if(direction!==drag.edgeDirection){clearTimeout(drag.edgeTimer);drag.edgeDirection=direction;if(direction)drag.edgeTimer=setTimeout(()=>{if(!drag)return;goToPage(currentPage+direction);drag.edgeDirection=0;drag.target=null;drag.previewKey='';},650);}
}
function endDrag(cancel=false){
  if(!drag)return;const state=drag;clearTimeout(state.edgeTimer);state.ghost.remove();$$('.drop-target,.drag-origin').forEach(node=>node.classList.remove('drop-target','drag-origin'));drag=null;
  const changed=JSON.stringify({pages,dock})!==JSON.stringify(state.original);
  if(cancel){if(changed){pages=state.original.pages;dock=state.original.dock;renderPages();}else updatePage();return;}
  if(changed){
    saveLayout();renderPages();
    toast(dock.includes(state.id)?`${itemOf(state.id).name} moved to the dock`:`${itemOf(state.id).name} moved to page ${pages.findIndex(page=>page.includes(state.id))+1}`);
  }else updatePage();
}
viewport.addEventListener('pointerdown',event=>{
  if(event.button!==0||drag||event.target.closest('.add-page-control,.page-delete-control,.app-remove-button'))return;const tile=event.target.closest('.app-tile'),slot=event.target.closest('.app-slot');gesture={id:event.pointerId,x:event.clientX,y:event.clientY,start:performance.now(),tile:tile?.dataset.id,moved:false,horizontal:false,vertical:false,pointerType:event.pointerType,lastX:event.clientX,lastY:event.clientY};
  const press={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY};
  if(tile)holdTimer=setTimeout(()=>{holdTimer=null;if(gesture&&!gesture.moved)startDrag(tile,press);},arranging?120:420);
  else if(slot)holdTimer=setTimeout(()=>{holdTimer=null;if(gesture&&!gesture.moved){gesture=null;setArranging(true);}},420);
});
viewport.addEventListener('pointermove',event=>{
  if(drag){event.preventDefault();updateDrag(event);return;}if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;gesture.lastX=event.clientX;
  if(Math.abs(dx)>8||Math.abs(dy)>8){clearTimeout(holdTimer);holdTimer=null;gesture.moved=true;}
  if(!gesture.horizontal&&!gesture.vertical&&Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.25){gesture.horizontal=true;viewport.setPointerCapture(event.pointerId);}
  if(!gesture.horizontal&&gesture.pointerType==='touch'&&(gesture.vertical||Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.25)){gesture.vertical=true;event.preventDefault();return;}
  if(gesture.horizontal){event.preventDefault();track.classList.add('no-transition');let offset=dx;if(currentPage===0&&dx>0||currentPage===pages.length-1+(arranging?1:0)&&dx<0)offset*=.2;track.style.transform=`translateX(calc(-${currentPage*100}% + ${offset}px))`;}
});
viewport.addEventListener('pointerup',event=>{
  clearTimeout(holdTimer);holdTimer=null;if(drag){endDrag();const r=viewport.getBoundingClientRect();if((event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)&&dockAt(event.clientX,event.clientY)==null)setArranging(false);return;}if(!gesture||event.pointerId!==gesture.id)return;
  const state=gesture;gesture=null;const dx=event.clientX-state.x,elapsed=performance.now()-state.start;
  if(state.horizontal){const threshold=Math.min(viewport.clientWidth*.15,95);if(Math.abs(dx)>threshold||Math.abs(dx)>35&&elapsed<260)goToPage(currentPage+(dx<0?1:-1));else updatePage();}
  else if(!state.moved&&state.tile&&!arranging)openItem(state.tile);
});
viewport.addEventListener('pointercancel',()=>{clearTimeout(holdTimer);holdTimer=null;gesture=null;if(drag)endDrag(true);updatePage();});
viewport.addEventListener('contextmenu',event=>{if(event.target.closest('.app-slot'))event.preventDefault();});
let dockPress=null;
dockNav.addEventListener('pointerdown',event=>{
  const node=event.target.closest('.shortcut');if(!node||event.button!==0||drag)return;
  const press={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY};dockPress={id:event.pointerId,x:event.clientX,y:event.clientY};
  clearTimeout(holdTimer);holdTimer=setTimeout(()=>{holdTimer=null;if(dockPress?.id===press.pointerId){dockPress=null;startDrag(node,press);}},arranging?120:420);
});
dockNav.addEventListener('pointermove',event=>{if(dockPress&&event.pointerId===dockPress.id&&Math.hypot(event.clientX-dockPress.x,event.clientY-dockPress.y)>8){clearTimeout(holdTimer);holdTimer=null;dockPress=null;}});
const endDockPress=event=>{if(dockPress&&event.pointerId===dockPress.id){clearTimeout(holdTimer);holdTimer=null;dockPress=null;}};
dockNav.addEventListener('pointerup',endDockPress);dockNav.addEventListener('pointercancel',endDockPress);
dockNav.addEventListener('click',event=>{const node=event.target.closest('.shortcut');if(node&&!arranging&&!drag)openItem(node.dataset.app);});
dockNav.addEventListener('keydown',event=>{
  const node=event.target.closest('.shortcut');if(!node||node.dataset.app==='closeout'&&!arranging)return;
  if(event.key.toLowerCase()==='m'){event.preventDefault();openMove(node.dataset.app);return;}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();if(arranging)openMove(node.dataset.app);else openItem(node.dataset.app);}
});
dockNav.addEventListener('contextmenu',event=>{if(event.target.closest('.shortcut'))event.preventDefault();});
viewport.addEventListener('wheel',event=>{
  if(Math.abs(event.deltaX)<Math.abs(event.deltaY)&&!event.shiftKey)return;
  const delta=event.shiftKey?event.deltaY:event.deltaX;if(Math.abs(delta)<8)return;event.preventDefault();const now=performance.now();if(now-lastWheelAt>480){goToPage(currentPage+(delta>0?1:-1));lastWheelAt=now;}
},{passive:false});
viewport.addEventListener('keydown',event=>{
  if(event.target.closest('.app-remove-button'))return;
  if(event.target.closest('.app-slot.empty')&&(event.key===' '||event.key==='Enter')){event.preventDefault();setArranging(true);return;}
  const tile=event.target.closest('.app-tile');if(tile&&(event.key.toLowerCase()==='m'||event.key===' ')){event.preventDefault();openMove(tile.dataset.id);return;}
  if(tile&&event.key==='Enter'){event.preventDefault();if(arranging)openMove(tile.dataset.id);else openItem(tile.dataset.id);return;}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();goToPage(currentPage+(event.key==='ArrowRight'?1:-1));}
});
$('#page-dots').addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();goToPage(currentPage+(event.key==='ArrowRight'?1:-1));$(`.page-dot[data-page="${currentPage}"]`)?.focus();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('dialog[open]')){endDrag(true);setArranging(false);}});
document.addEventListener('pointerdown',event=>{
  if(!arranging||drag||$('dialog[open]')||event.target.closest('#apps-panel,#main-shortcuts'))return;
  clearTimeout(holdTimer);holdTimer=null;gesture=null;setArranging(false);
},true);
let blankPanelPress=null;
$('#apps-panel').addEventListener('pointerdown',event=>{
  blankPanelPress=arranging&&!drag&&event.button===0&&!event.target.closest('.app-tile,button,input,select,a')?{id:event.pointerId,x:event.clientX,y:event.clientY,started:performance.now()}:null;
});
$('#apps-panel').addEventListener('pointerup',event=>{
  const press=blankPanelPress;blankPanelPress=null;
  if(!press||press.id!==event.pointerId||!arranging||drag||$('dialog[open]'))return;
  if(performance.now()-press.started<400&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<9){clearTimeout(holdTimer);holdTimer=null;gesture=null;setArranging(false);}
});
$('#apps-panel').addEventListener('pointercancel',()=>{blankPanelPress=null;});
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog||dialog.classList.contains('settings-app')||dialog.classList.contains('counter-app')||dialog.classList.contains('floor-app')||dialog.classList.contains('customers-app'))return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){dialog.close();if(arranging)setArranging(false);}}));
$('#move-page').addEventListener('change',updateMovePositions);
$('#move-form').addEventListener('submit',event=>{
  event.preventDefault();const value=$('#move-page').value,position=Number($('#move-position').value),name=itemOf(moveId).name;
  if(!Number.isInteger(position)||position<0)return;
  if(value==='dock'||dock.includes(moveId)){
    const next=arrange({pages,dock},moveId,value==='dock'?{kind:'dock',index:position}:{kind:'page',page:Number(value),position});
    pages=next.pages;dock=next.dock;saveLayout();renderPages();$('#move-dialog').close();
    toast(dock.includes(moveId)?`${name} moved to the dock`:`${name} moved to page ${pages.findIndex(page=>page.includes(moveId))+1}`);return;
  }
  const result=moveApp(moveId,Number(value),position);$('#move-dialog').close();toast(`${name} moved to page ${result.page}`);
});
const uppercaseRestaurantName=value=>value.trim().toLocaleUpperCase('en-IN').slice(0,48);
let restaurantName='RESTAURANT NAME',storedRestaurantName=null;try{storedRestaurantName=localStorage.getItem('restro.restaurantName');}catch{}
restaurantName=uppercaseRestaurantName(storedRestaurantName||'')||'RESTAURANT NAME';$('#restaurant-name').textContent=restaurantName;
// Only a name the owner gave is saved (in capitals); the placeholder isn't, so a new tablet takes the restaurant's name from the others.
if(storedRestaurantName&&storedRestaurantName!==restaurantName){try{localStorage.setItem('restro.restaurantName',restaurantName);}catch{}window.RestroSync?.wrote('restro.restaurantName');}
// My Profile: restaurant name, email, mobile. Stored on this device until the
// RESTRO backend exists (Phase 2 of the security plan), then moved there.
window.RestroProfile=(()=>{
  const KEY='restro.profile.v1';
  // Country → calling code and national mobile number length (digits). `start` = allowed first digits.
  const COUNTRIES=[
    {iso:'IN',name:'India',code:'91',len:[10],start:'6789',sample:'98765 43210'},
    {iso:'AE',name:'United Arab Emirates',code:'971',len:[9],start:'5',sample:'50 123 4567'},
    {iso:'SA',name:'Saudi Arabia',code:'966',len:[9],start:'5',sample:'51 234 5678'},
    {iso:'QA',name:'Qatar',code:'974',len:[8],sample:'3312 3456'},
    {iso:'KW',name:'Kuwait',code:'965',len:[8],sample:'5001 2345'},
    {iso:'OM',name:'Oman',code:'968',len:[8],sample:'9212 3456'},
    {iso:'BH',name:'Bahrain',code:'973',len:[8],sample:'3600 1234'},
    {iso:'NP',name:'Nepal',code:'977',len:[10],start:'9',sample:'984 1234567'},
    {iso:'LK',name:'Sri Lanka',code:'94',len:[9],start:'7',sample:'71 234 5678'},
    {iso:'BD',name:'Bangladesh',code:'880',len:[10],start:'1',sample:'1812 345678'},
    {iso:'SG',name:'Singapore',code:'65',len:[8],start:'89',sample:'8123 4567'},
    {iso:'MY',name:'Malaysia',code:'60',len:[9,10],start:'1',sample:'12 345 6789'},
    {iso:'GB',name:'United Kingdom',code:'44',len:[10],start:'7',sample:'7400 123456'},
    {iso:'US',name:'United States',code:'1',len:[10],sample:'201 555 0123'},
    {iso:'CA',name:'Canada',code:'1',len:[10],sample:'506 234 5678'},
    {iso:'AU',name:'Australia',code:'61',len:[9],start:'4',sample:'412 345 678'},
    {iso:'NZ',name:'New Zealand',code:'64',len:[8,9,10],start:'2',sample:'21 123 4567'},
    {iso:'DE',name:'Germany',code:'49',len:[10,11],start:'1',sample:'151 23456789'},
    {iso:'FR',name:'France',code:'33',len:[9],start:'67',sample:'6 12 34 56 78'},
    {iso:'ZA',name:'South Africa',code:'27',len:[9],start:'678',sample:'71 123 4567'}
  ];
  const byIso=iso=>COUNTRIES.find(c=>c.iso===iso)||COUNTRIES[0];
  let profile={email:'',mobile:'',country:'IN'};
  const loadProfile=()=>{try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&typeof saved==='object')profile={email:String(saved.email||''),mobile:String(saved.mobile||''),country:byIso(saved.country).iso};}catch{}};
  loadProfile();
  const select=$('#profile-country');
  for(const c of COUNTRIES){const o=document.createElement('option');o.value=c.iso;o.textContent=`+${c.code}  ${c.name}`;select.append(o);}
  const current=()=>byIso(select.value);
  // Keep national digits only: drop a pasted +code / 00code prefix and a trunk 0.
  const digits=(value,c)=>{let d=String(value).replace(/\D/g,'');const max=Math.max(...c.len);if(d.length>max&&d.startsWith('00'+c.code))d=d.slice(2+c.code.length);else if(d.length>max&&d.startsWith(c.code))d=d.slice(c.code.length);if(d.length>max&&d.startsWith('0'))d=d.slice(1);else if(d.length===max+1&&d.startsWith('0'))d=d.slice(1);return d;};
  const pretty=(value,c)=>{const sample=c.sample.split(' ').map(part=>part.length);let out='',i=0;for(const n of sample){if(i>=value.length)break;out+=(out?' ':'')+value.slice(i,i+n);i+=n;}if(i<value.length)out+=value.slice(i);return out;};
  const lengths=c=>c.len.length>1?`${c.len[0]}–${c.len.at(-1)}`:String(c.len[0]);
  const describe=()=>{const c=current();$('#profile-mobile-hint').textContent=`${lengths(c)}-digit number in ${c.name}`;$('#profile-mobile').placeholder=c.sample;};
  const showError=(id,message)=>{const el=$(id);el.textContent=message;el.hidden=!message;};
  select.addEventListener('change',()=>{describe();showError('#profile-mobile-error','');});
  // The restaurant's phone and email (Update Pack 3): in Business details, printed on the bill under the address, kept
  // with the restaurant's other details (prefs.js). They were My Profile's: a tablet that has them there moves them once.
  const business=()=>window.RestroPrefs?.get('business')||{phone:'',phoneCountry:'IN',email:''};
  const moveOnce=()=>{const b=business();if(!b.phone&&!b.email&&(profile.mobile||profile.email))window.RestroPrefs?.update('business',v=>{v.phone=profile.mobile;v.phoneCountry=profile.country;v.email=profile.email;});};
  return{
    get email(){return business().email;},get mobile(){return business().phone;},
    // the restaurant's country, which customers' mobile numbers follow
    get country(){return byIso(business().phoneCountry||profile.country);},
    get international(){const b=business();return b.phone?`+${byIso(b.phoneCountry).code} ${pretty(b.phone,byIso(b.phoneCountry))}`:'';},
    // A number as it prints: "+91 98765 43210"
    formatPhone(number,iso){const c=byIso(iso),d=String(number||'').replace(/\D/g,'');return d?`+${c.code} ${pretty(d,c)}`:'';},
    countries:COUNTRIES.map(({iso,name,code})=>({iso,name,code})),
    fill(){moveOnce();const b=business(),c=byIso(b.phoneCountry);select.value=c.iso;describe();$('#profile-email').value=b.email||'';$('#profile-mobile').value=pretty(b.phone||'',c);showError('#profile-email-error','');showError('#profile-mobile-error','');},
    // The phone and email as typed: { phone, phoneCountry, email }, or null after showing what to fix. (A restaurant's
    // phone may be a landline: the length is checked, not the first digit.)
    read(){
      const c=current(),email=$('#profile-email').value.trim().toLowerCase(),phone=digits($('#profile-mobile').value,c);
      let ok=true;
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){showError('#profile-email-error','Enter an email like name@example.com.');ok=false;}else showError('#profile-email-error','');
      if(phone&&!c.len.includes(phone.length)){showError('#profile-mobile-error',`Enter a ${lengths(c)}-digit ${c.name} number.`);ok=false;}else showError('#profile-mobile-error','');
      return ok?{phone,phoneCountry:c.iso,email}:null;
    },
    // Changed on another tablet (sync.js): read again, and refill the fields unless they are being edited
    reload(){loadProfile();if(!$('#business-form').contains(document.activeElement))this.fill();}
  };
})();
$('#profile-mobile').addEventListener('input',event=>{const input=event.target,clean=input.value.replace(/[^\d ]/g,'');if(clean!==input.value)input.value=clean;$('#profile-mobile-error').hidden=true;});
$('#profile-email').addEventListener('input',()=>{$('#profile-email-error').hidden=true;});
window.RestroRestaurantName=Object.freeze({
  get value(){return restaurantName;},
  // Saves the name typed in Business details; false (after saying so on the field) when it is empty
  save(typed){const value=uppercaseRestaurantName(typed);const input=$('#restaurant-input');if(!value){input.setCustomValidity('Enter a restaurant name.');input.reportValidity();return false;}input.setCustomValidity('');if(value!==restaurantName){restaurantName=value;$('#restaurant-name').textContent=restaurantName;try{localStorage.setItem('restro.restaurantName',restaurantName);}catch{}window.RestroSync?.wrote('restro.restaurantName');window.dispatchEvent(new CustomEvent('restro:restaurant-renamed',{detail:{name:restaurantName}}));alignBannerText();}return true;}
});
$('#restaurant-input').addEventListener('input',event=>{
  const input=event.target,start=input.selectionStart,end=input.selectionEnd,value=input.value;
  input.setCustomValidity('');input.value=value.toLocaleUpperCase('en-IN');
  if(start!==null&&end!==null)input.setSelectionRange(value.slice(0,start).toLocaleUpperCase('en-IN').length,value.slice(0,end).toLocaleUpperCase('en-IN').length);
});
const alignmentCanvas=document.createElement('canvas');
const alignmentContext=alignmentCanvas.getContext('2d');
const glyphBoundsCache=new Map();
function verticalGlyphBounds(text,style,width){
  const font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const key=`${font}|${style.letterSpacing}|${text}`;
  if(glyphBoundsCache.has(key))return glyphBoundsCache.get(key);
  const scale=4,size=parseFloat(style.fontSize),baseline=size*2;
  alignmentCanvas.width=Math.ceil(width+12)*scale;
  alignmentCanvas.height=Math.ceil(size*3+8)*scale;
  alignmentContext.scale(scale,scale);
  alignmentContext.font=font;
  alignmentContext.letterSpacing=style.letterSpacing;
  alignmentContext.fillStyle='#fff';
  alignmentContext.fillText(text,6,baseline);
  const pixels=alignmentContext.getImageData(0,0,alignmentCanvas.width,alignmentCanvas.height).data;
  let first=alignmentCanvas.height,last=-1,left=alignmentCanvas.width,right=-1;
  for(let y=0;y<alignmentCanvas.height;y++){
    for(let x=0;x<alignmentCanvas.width;x++){
      if(pixels[(y*alignmentCanvas.width+x)*4+3]>=128){first=Math.min(first,y);last=y;left=Math.min(left,x);right=Math.max(right,x);}
    }
  }
  const bounds={top:first/scale-baseline,bottom:(last+1)/scale-baseline,left:left/scale-6,right:(right+1)/scale-6};
  glyphBoundsCache.set(key,bounds);
  return bounds;
}
// The restaurant's name and profile changed on another tablet (sync.js)
window.addEventListener('restro:data-changed',event=>{
  if(!(event.detail?.collections||[]).includes('settings'))return;
  let name=restaurantName;try{name=uppercaseRestaurantName(localStorage.getItem('restro.restaurantName')||'')||restaurantName;}catch{}
  if(name!==restaurantName){restaurantName=name;$('#restaurant-name').textContent=name;if(document.activeElement!==$('#restaurant-input'))$('#restaurant-input').value=name;alignBannerText();}
  window.RestroProfile.reload();
});
function alignBannerText(){
  const labels=$$('.top-banner .banner-label, .bottom-banner .banner-label');
  for(const label of labels){
    label.style.setProperty('--banner-baseline-shift','0px');
    if(!label.querySelector('.banner-baseline')){
      const marker=document.createElement('span');marker.className='banner-baseline';marker.setAttribute('aria-hidden','true');label.append(marker);
    }
  }
  if(!alignmentContext)return;
  // Center the painted letters rather than their font line boxes.
  for(const label of labels){
    const group=label.closest('.system-status, .identity, .bottom-identity, .bottom-brand-lock'),row=group.getBoundingClientRect();
    const baseline=label.querySelector('.banner-baseline').getBoundingClientRect().y;
    const ink=verticalGlyphBounds(label.textContent,getComputedStyle(label),label.getBoundingClientRect().width);
    const target=row.y+row.height/2,center=baseline+(ink.top+ink.bottom)/2;
    label.style.setProperty('--banner-baseline-shift',`${target-center}px`);
    if(label.classList.contains('footer-brand'))group.style.setProperty('--footer-logo-height',`${ink.bottom-ink.top}px`);
  }
  // Every top-banner label shares the clock's actual baseline, including the
  // restaurant name in the compact status row. Footer optical centering stays separate.
  const anchor=$('.top-banner .clock-text .banner-baseline');
  if(anchor){
    const baseline=anchor.getBoundingClientRect().y;
    for(const label of $$('.top-banner .banner-label')){
      const current=label.querySelector('.banner-baseline').getBoundingClientRect().y;
      const shift=parseFloat(label.style.getPropertyValue('--banner-baseline-shift'))||0;
      label.style.setProperty('--banner-baseline-shift',`${shift+baseline-current}px`);
    }
  }
}
function alignDashboardText(){alignBannerText();}
// The restaurant's mark at the top left: the first letter of its name on the dark square
function paintRestaurantMark(){const mark=$('#restaurant-mark');if(mark)mark.textContent=(Array.from($('#restaurant-name').textContent.trim())[0]||'R').toLocaleUpperCase('en-IN');}
new MutationObserver(paintRestaurantMark).observe($('#restaurant-name'),{childList:true,characterData:true,subtree:true});paintRestaurantMark();
// The top bar's date and time, "Fri, 6 Nov · 8:35 AM"
function updateClock(){
  const now=new Date();
  $('#clock-date').textContent=now.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  $('#clock .clock-text').textContent=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  $('#clock').dateTime=now.toISOString();
  const date=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  $('#report-date').textContent='· '+date;
  alignBannerText();
}
window.addEventListener('resize',alignDashboardText);
document.fonts.ready.then(alignDashboardText);
document.fonts.addEventListener('loadingdone',alignDashboardText);
const hours=['9 AM','10 AM','11 AM','12 PM','1 PM','3 PM','5 PM'],sales=[1200,2450,3500,3100,1700,3800,2700];
sales.forEach((value,i)=>{const column=document.createElement('div');column.className='chart-column';const bar=document.createElement('div');bar.className='chart-bar';bar.style.height=`${value/3800*100}%`;bar.dataset.value=`₹${value.toLocaleString('en-IN')}`;bar.setAttribute('aria-label',`${hours[i]}: ${bar.dataset.value}`);const label=document.createElement('span');label.textContent=hours[i];column.append(bar,label);$('#chart-bars').append(column);});
renderPages();saveLayout();updateClock();setInterval(updateClock,15000);
if(document.modelContext?.registerTool){
  const context=document.modelContext,lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_app_pages',title:'Read app pages',description:'Read the current RESTRO app arrangement (the dock and the pages) and selected page.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return {selectedPage:currentPage+1,dock:dock.map((id,position)=>({id,name:itemOf(id).name,position:position+1})),pages:pages.map((page,index)=>({page:index+1,apps:page.flatMap((id,position)=>id?[{id,name:itemOf(id).name,position:position+1}]:[])}))};}});
  register({name:'navigate_app_page',title:'Navigate app page',description:'Display a More Apps page; pinned dashboard sections stay fixed.',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1}},required:['page'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!Number.isInteger(input.page)||input.page<1||input.page>pages.length)throw new Error('Choose an existing app page.');goToPage(input.page-1);return {selectedPage:currentPage+1};}});
  register({name:'move_restaurant_app',title:'Move restaurant app',description:'Insert an existing app before the app at the chosen page and position; following apps keep their order.',inputSchema:{type:'object',properties:{appId:{type:'string',enum:Object.keys(apps)},page:{type:'integer',minimum:1},position:{type:'integer',minimum:1,maximum:PAGE_CAPACITY}},required:['appId','page','position'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input)throw new Error('Choose an app, page and position.');return moveApp(input.appId,input.page-1,input.position-1);}});
  register({name:'add_empty_app_page',title:'Add app page',description:'Add an empty More Apps page and select it.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(){return addAppPage();}});
  register({name:'delete_empty_app_page',title:'Delete empty app page',description:'Delete an empty More Apps page. Pages containing apps cannot be deleted.',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1}},required:['page'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input)throw new Error('Choose an empty page.');return deleteAppPage(input.page-1);}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
