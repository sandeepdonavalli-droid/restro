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
const apps = {
  menu:{name:'Menu',art:art('master',49,478,212,128)},
  transactions:{name:'Payment History',art:art('master',299,478,184,128)},
  refunds:{name:'Refunds',art:art('master',540,477,172,128)},
  cash:{name:'Cash log',art:art('apps',772,472,158,133)},
  inventory:{name:'Inventory',art:art('master',997,474,178,133)},
  employees:{name:'Employees',art:art('master',46,667,196,124)},
  customers:{name:'Customers',art:art('master',299,674,173,117)},
  printers:{name:'Printers',art:art('master',532,657,172,134)},
  help:{name:'Help',art:art('master',778,668,155,123)},
  store:{name:'App Store',art:art('apps',980,659,211,146)},
  analytics:{name:'Analytics',art:art('analytics',70,490,172,144)},
  settings:{name:'Settings',art:{file:'settings-g39.png',w:1254,h:1254,viewBox:'22 150 1221 986'}},
  'qr-studio':{name:'QR Studio',art:{url:'assets/qr-studio/D.webp',w:1536,h:1024,viewBox:'48 405 244 264',sprite:true,themeId:'D'}}
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
const defaultPages=[installedAppIds(),[],[]];
const collapsedDefault=[Object.keys(apps)];
let savedPages=null;
try {
  const current=localStorage.getItem('restro.appLayout.v4');
  savedPages=JSON.parse(current||localStorage.getItem('restro.appLayout.v3')||localStorage.getItem('restro.appLayout.v2')||localStorage.getItem('restro.appLayout.v1')||'null');
  // Repair the previous default once; later user page additions/deletions persist.
  if(!current&&JSON.stringify(savedPages)===JSON.stringify(collapsedDefault))savedPages=defaultPages;
}catch{}
let pages=RestroLayout.restore(savedPages,installedAppIds(),defaultPages);
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
    svg.setAttribute('viewBox',a.viewBox||`0 0 ${a.w} ${a.h}`);svg.setAttribute('preserveAspectRatio',a.sprite||a.clean?'xMidYMid meet':'xMidYMax meet');svg.setAttribute('focusable','false');
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
    if(replacement.dataset.renderedTheme)wrapper.dataset.renderedTheme=replacement.dataset.renderedTheme;
    else delete wrapper.dataset.renderedTheme;
    if(replacement.dataset.artworkSelection)wrapper.dataset.artworkSelection=replacement.dataset.artworkSelection;
    else delete wrapper.dataset.artworkSelection;
  });
}
window.addEventListener('restro:theme-changed',refreshArtwork);
window.addEventListener('restro:artwork-changed',refreshArtwork);
document.querySelectorAll('[data-app-icon]').forEach(image=>{const item=apps[image.dataset.appIcon];if(item)image.replaceWith(artNode(item.art));});

for(const item of shortcuts){
  const node=document.createElement('div');node.className='shortcut';node.dataset.app=item.id;
  const label=document.createElement('span');label.className='shortcut-label';label.textContent=item.name;
  node.append(artNode(item.art),label);$('#main-shortcuts').append(node);
}
function renderPages(){
  track.replaceChildren();
  pages.forEach((page,p)=>{
    const section=document.createElement('section');section.className='apps-page';section.dataset.page=p;section.id=`apps-page-${p}`;section.setAttribute('role','tabpanel');section.setAttribute('aria-label',`Apps page ${p+1}`);
    for(let position=0;position<PAGE_CAPACITY;position++){
      const id=page[position];const slot=document.createElement('div');slot.className='app-slot'+(!id?' empty':'');slot.dataset.page=p;slot.dataset.position=position;
      if(id){
        const item=apps[id],tile=document.createElement('div');tile.className='app-tile';tile.dataset.id=id;tile.tabIndex=0;tile.setAttribute('role','group');tile.setAttribute('aria-label',`${item.name}. Hold to rearrange or press M to move.`);
        const label=document.createElement('span');label.className='app-label';label.textContent=item.name;tile.append(artNode(item.art),label);
        if(arranging){
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
  renderDots();updatePage(false);document.body.classList.toggle('arranging',arranging);
}
function renderDots(){
  $('#page-dots').replaceChildren();
  for(let p=0;p<pages.length;p++){
    const button=document.createElement('button');button.type='button';button.className='page-dot';button.setAttribute('role','tab');button.setAttribute('aria-label',`Show app page ${p+1}`);button.setAttribute('aria-controls',`apps-page-${p}`);button.dataset.page=p;button.addEventListener('click',()=>goToPage(p));$('#page-dots').append(button);
  }
}
function updatePage(animate=true){
  track.classList.toggle('no-transition',!animate);track.style.transform=`translateX(-${currentPage*100}%)`;
  $$('.apps-page').forEach((page,p)=>{page.inert=p!==currentPage;page.setAttribute('aria-hidden',String(p!==currentPage));});
  $$('.page-dot').forEach((dot,p)=>{dot.setAttribute('aria-selected',String(p===currentPage));dot.tabIndex=p===currentPage?0:-1;});
  $('#swipe-hint').textContent=arranging?'Hold near the edge to change pages':currentPage===pages.length-1?'Swipe right to go back':'Swipe left for more';
  $('#page-announcement').textContent=currentPage===pages.length?'Add an app page':`More Apps, page ${currentPage+1} of ${pages.length}`;
}
function goToPage(page){
  const next=Math.max(0,Math.min(pages.length-1+(arranging?1:0),Number(page)));if(!Number.isInteger(next))return false;
  currentPage=next;updatePage();return true;
}
function setArranging(value){if(arranging===value)return;arranging=value;if(!value)currentPage=Math.min(currentPage,pages.length-1);renderPages();}
function saveLayout(){try{localStorage.setItem('restro.appLayout.v4',JSON.stringify(pages));}catch{}}
function moveApp(id,targetPage,targetPosition){
  if(!isInstalledApp(id))throw new Error('Choose an installed app.');
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
function openSettings(){$('#restaurant-input').value=restaurantName;window.RestroThemeSettings?.reset();openDialog('settings-dialog');}
function openApp(id){if(!isInstalledApp(id))return;if(id==='settings')openSettings();else if(id==='analytics')openDialog('analytics-dialog');else if(id==='help')openDialog('help-dialog');else if(id==='qr-studio'){$('#qr-studio-art').replaceChildren(artNode(apps[id].art));openDialog('qr-studio-dialog');}}
function openMove(id){
  moveId=id;setArranging(true);$('#move-description').textContent=`Choose where to insert ${apps[id].name}. Following apps keep their order.`;
  const select=$('#move-page');select.replaceChildren();pages.forEach((_,p)=>{const option=document.createElement('option');option.value=p;option.textContent=`Page ${p+1}`;select.append(option);});
  const sourcePage=pages.findIndex(page=>page.includes(id));$('#move-page').value=String(sourcePage);updateMovePositions();$('#move-position').value=String(pages[sourcePage].indexOf(id));openDialog('move-dialog');
}
function updateMovePositions(){
  const page=Number($('#move-page').value);$('#move-position').replaceChildren();
  const length=Math.min(PAGE_CAPACITY,pages[page].length+1);
  for(let i=0;i<length;i++){const option=document.createElement('option');option.value=String(i);option.textContent=pages[page][i]?`Before ${apps[pages[page][i]].name}`:pages[page].length?'After the last app':'First app';$('#move-position').append(option);}
}
function startDrag(tile,event){
  if(drag)return;const id=tile.dataset.id,rect=tile.getBoundingClientRect(),ghost=tile.cloneNode(true);setArranging(true);ghost.classList.add('drag-ghost');ghost.tabIndex=-1;ghost.setAttribute('aria-hidden','true');ghost.style.width=`${rect.width}px`;ghost.style.height=`${rect.height}px`;ghost.style.left=`${event.clientX}px`;ghost.style.top=`${event.clientY}px`;document.body.append(ghost);$(`.app-tile[data-id="${id}"]`).classList.add('drag-origin');
  drag={id,ghost,startPage:currentPage,edgeTimer:null,edgeDirection:0,target:null,lastX:event.clientX,lastY:event.clientY};gesture=null;viewport.setPointerCapture(event.pointerId);
}
function updateDrag(event){
  if(!drag)return;drag.lastX=event.clientX;drag.lastY=event.clientY;drag.ghost.style.left=`${event.clientX}px`;drag.ghost.style.top=`${event.clientY}px`;
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.app-slot');$$('.drop-target').forEach(slot=>slot.classList.remove('drop-target'));
  drag.target=target&&Number(target.dataset.page)===currentPage?{page:currentPage,position:Number(target.dataset.position)}:null;if(target&&drag.target)target.classList.add('drop-target');
  const bounds=viewport.getBoundingClientRect();const inside=event.clientY>=bounds.top&&event.clientY<=bounds.bottom;
  const direction=inside&&event.clientX>bounds.right-46&&currentPage<pages.length-1?1:inside&&event.clientX<bounds.left+46&&currentPage>0?-1:0;
  if(direction!==drag.edgeDirection){clearTimeout(drag.edgeTimer);drag.edgeDirection=direction;if(direction)drag.edgeTimer=setTimeout(()=>{if(!drag)return;goToPage(currentPage+direction);drag.edgeDirection=0;drag.target=null;},650);}
}
function endDrag(cancel=false){
  if(!drag)return;const state=drag;clearTimeout(state.edgeTimer);state.ghost.remove();$$('.drop-target,.drag-origin').forEach(node=>node.classList.remove('drop-target','drag-origin'));drag=null;
  if(!cancel&&state.target){const result=moveApp(state.id,state.target.page,state.target.position);toast(`${apps[state.id].name} moved to page ${result.page}`);}
  else updatePage();
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
  clearTimeout(holdTimer);holdTimer=null;if(drag){endDrag();const r=viewport.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)setArranging(false);return;}if(!gesture||event.pointerId!==gesture.id)return;
  const state=gesture;gesture=null;const dx=event.clientX-state.x,elapsed=performance.now()-state.start;
  if(state.horizontal){const threshold=Math.min(viewport.clientWidth*.15,95);if(Math.abs(dx)>threshold||Math.abs(dx)>35&&elapsed<260)goToPage(currentPage+(dx<0?1:-1));else updatePage();}
  else if(!state.moved&&state.tile&&!arranging)openApp(state.tile);
});
viewport.addEventListener('pointercancel',()=>{clearTimeout(holdTimer);holdTimer=null;gesture=null;if(drag)endDrag(true);updatePage();});
viewport.addEventListener('contextmenu',event=>{if(event.target.closest('.app-slot'))event.preventDefault();});
viewport.addEventListener('wheel',event=>{
  if(Math.abs(event.deltaX)<Math.abs(event.deltaY)&&!event.shiftKey)return;
  const delta=event.shiftKey?event.deltaY:event.deltaX;if(Math.abs(delta)<8)return;event.preventDefault();const now=performance.now();if(now-lastWheelAt>480){goToPage(currentPage+(delta>0?1:-1));lastWheelAt=now;}
},{passive:false});
viewport.addEventListener('keydown',event=>{
  if(event.target.closest('.app-remove-button'))return;
  if(event.target.closest('.app-slot.empty')&&(event.key===' '||event.key==='Enter')){event.preventDefault();setArranging(true);return;}
  const tile=event.target.closest('.app-tile');if(tile&&(event.key.toLowerCase()==='m'||event.key===' ')){event.preventDefault();openMove(tile.dataset.id);return;}
  if(tile&&event.key==='Enter'){event.preventDefault();if(arranging)openMove(tile.dataset.id);else openApp(tile.dataset.id);return;}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();goToPage(currentPage+(event.key==='ArrowRight'?1:-1));}
});
$('#page-dots').addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();goToPage(currentPage+(event.key==='ArrowRight'?1:-1));$(`.page-dot[data-page="${currentPage}"]`)?.focus();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('dialog[open]')){endDrag(true);setArranging(false);}});
document.addEventListener('pointerdown',event=>{
  if(!arranging||drag||$('dialog[open]')||event.target.closest('#apps-panel'))return;
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
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog||dialog.classList.contains('settings-app'))return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){dialog.close();if(arranging)setArranging(false);}}));
$('#move-page').addEventListener('change',updateMovePositions);
$('#move-form').addEventListener('submit',event=>{event.preventDefault();const result=moveApp(moveId,Number($('#move-page').value),Number($('#move-position').value));$('#move-dialog').close();toast(`${apps[moveId].name} moved to page ${result.page}`);});
const uppercaseRestaurantName=value=>value.trim().toLocaleUpperCase('en-IN').slice(0,48);
let restaurantName='RESTAURANT NAME';try{restaurantName=localStorage.getItem('restro.restaurantName')||restaurantName;}catch{}
restaurantName=uppercaseRestaurantName(restaurantName)||'RESTAURANT NAME';$('#restaurant-name').textContent=restaurantName;
try{localStorage.setItem('restro.restaurantName',restaurantName);}catch{}
$('#restaurant-form').addEventListener('submit',event=>{event.preventDefault();const value=uppercaseRestaurantName($('#restaurant-input').value);if(!value){$('#restaurant-input').setCustomValidity('Enter a restaurant name.');$('#restaurant-input').reportValidity();return;}restaurantName=value;$('#restaurant-input').setCustomValidity('');$('#restaurant-name').textContent=restaurantName;try{localStorage.setItem('restro.restaurantName',restaurantName);}catch{}window.dispatchEvent(new CustomEvent('restro:restaurant-renamed',{detail:{name:restaurantName}}));toast('Restaurant name saved');alignBannerText();});
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
    const group=label.closest('.system-status, .identity, .bottom-brand-lock'),row=group.getBoundingClientRect();
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
function updateClock(){
  const now=new Date();
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
  register({name:'read_app_pages',title:'Read app pages',description:'Read the current RESTRO app arrangement and selected page.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return {selectedPage:currentPage+1,pages:pages.map((page,index)=>({page:index+1,apps:page.flatMap((id,position)=>id?[{id,name:apps[id].name,position:position+1}]:[])}))};}});
  register({name:'navigate_app_page',title:'Navigate app page',description:'Display a More Apps page; pinned dashboard sections stay fixed.',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1}},required:['page'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!Number.isInteger(input.page)||input.page<1||input.page>pages.length)throw new Error('Choose an existing app page.');goToPage(input.page-1);return {selectedPage:currentPage+1};}});
  register({name:'move_restaurant_app',title:'Move restaurant app',description:'Insert an existing app before the app at the chosen page and position; following apps keep their order.',inputSchema:{type:'object',properties:{appId:{type:'string',enum:Object.keys(apps)},page:{type:'integer',minimum:1},position:{type:'integer',minimum:1,maximum:PAGE_CAPACITY}},required:['appId','page','position'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input)throw new Error('Choose an app, page and position.');return moveApp(input.appId,input.page-1,input.position-1);}});
  register({name:'add_empty_app_page',title:'Add app page',description:'Add an empty More Apps page and select it.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(){return addAppPage();}});
  register({name:'delete_empty_app_page',title:'Delete empty app page',description:'Delete an empty More Apps page. Pages containing apps cannot be deleted.',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1}},required:['page'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input)throw new Error('Choose an empty page.');return deleteAppPage(input.page-1);}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
