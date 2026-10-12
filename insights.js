'use strict';
(() => {
  const widget=document.querySelector('#insight-widget');
  const stack=widget.querySelector('.insight-stack');
  const announcement=document.querySelector('#insight-announcement');
  const template=widget.querySelector('.insight-card');
  const rotationMs=9000,transitionMs=1100;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  widget.dataset.rotationMs=String(rotationMs);
  widget.dataset.deckTransitionMs=String(transitionMs);
  stack.append(announcement);
  const insights=[
    {id:'greeting',icon:'clock-icon',label:'Welcome back',value:()=>{const hour=new Date().getHours();return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';},summary:'Wishing you a smooth service today.'},
    {id:'last-order',icon:'receipt',label:'Last order',value:'₹480',summary:'Order #042 · Dine-in',detail:'2 Masala dosas · 2 Filter coffees',note:'Paid by UPI'},
    {id:'most-sold',icon:'chef',label:'Most sold item',value:'Masala dosa',summary:'68 sold today'},
    {id:'daily-sales',icon:'chart',label:"Today's sales",value:'₹18,450',summary:'42 orders',detail:'₹439.29 average order'}
  ];
  let index=3,timer=null,remainingMs=rotationMs,startedAt=0,gesture=null,lastWheelAt=0,suppressClickUntil=0,transitionTimer=null,animations=[];
  const records=insights.map((insight,i)=>{
    const card=i===3?template:template.cloneNode(true);
    card.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    card.dataset.insightId=insight.id;
    const record={card,insight,index:i,content:card.querySelector('.insight-content'),progress:card.querySelector('.insight-progress'),date:card.querySelector('.insight-footer time'),heading:card.querySelector('.insight-heading h2')};
    stack.insertBefore(card,announcement);return record;
  });
  let deck=[],surface=template,content=records[3].content;
  function openDetail(id){
    const routes={'last-order':'order-details-dialog','most-sold':'most-sold-dialog','daily-sales':'analytics-dialog'};
    if(!routes[id])return false;openDialog(routes[id]);return true;
  }
  window.RestroInsights=Object.freeze({openDetail});
  function renderCard(record){
    const {insight,content:body,progress,date}=record;body.replaceChildren();
    body.setAttribute('role',insight.id==='greeting'?'group':'button');body.setAttribute('aria-roledescription','card');
    const label=`${insight.label}. Card ${record.index+1} of ${insights.length}. Use left and right arrow keys to browse.`;
    body.setAttribute('aria-label',insight.id==='greeting'?label:`Open ${label}`);
    if(insight.id!=='greeting')body.title=`Open ${insight.label.toLowerCase()}`;else body.removeAttribute('title');
    const icon=document.createElement('span');icon.className='insight-icon';icon.setAttribute('aria-hidden','true');
    if(insight.id==='daily-sales'){
      icon.append(artNode({key:'insight-sales',url:'assets/insights-sales.svg',w:220,h:160}));
    }else{
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
      svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');use.setAttribute('href',`#${insight.icon}`);svg.append(use);icon.append(svg);
    }
    body.append(icon);
    for(const [type,value] of [['label',insight.label],['value',typeof insight.value==='function'?insight.value():insight.value],['summary',insight.summary],['detail',insight.detail],['note',insight.note]]){
      if(!value)continue;const node=document.createElement(type==='value'?'h3':'p');node.className=`insight-${type}`;node.textContent=value;body.append(node);
    }
    progress.replaceChildren();insights.forEach((_,i)=>{const segment=document.createElement('span');if(i===record.index){segment.className='active';segment.style.setProperty('--rotation-duration',`${rotationMs}ms`);}progress.append(segment);});
    const now=new Date();date.dateTime=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');date.textContent=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }
  records.forEach(renderCard);
  function applyDeck(){
    deck=Array.from({length:insights.length},(_,rank)=>records[(index+rank)%insights.length]);
    for(const record of records){for(const node of [record.content,record.progress,record.date,record.heading])node.removeAttribute('id');}
    deck.forEach((record,rank)=>{record.card.dataset.deckRank=String(rank);record.card.inert=rank!==0;record.card.setAttribute('aria-hidden',String(rank!==0));record.content.tabIndex=rank===0?0:-1;});
    // These are the same four DOM cards, moved to their new positions in the deck.
    [...deck].reverse().forEach(record=>stack.insertBefore(record.card,announcement));
    const front=deck[0];surface=front.card;content=front.content;
    front.content.id='insight-content';front.progress.id='insight-progress';front.date.id='insight-date';front.heading.id='insights-heading';
    widget.dataset.insightId=front.insight.id;widget.dataset.insightChangedAt=String(performance.now());stack.dataset.deckOrder=deck.map(record=>record.insight.id).join(',');
    if(front.insight.id==='greeting')front.content.querySelector('.insight-value').textContent=front.insight.value();
    const now=new Date();front.date.dateTime=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');front.date.textContent=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }
  function schedule(){clearTimeout(timer);if(gesture)return;startedAt=performance.now();timer=setTimeout(()=>showInsight(index+1),remainingMs);}
  function finishTransition(){clearTimeout(transitionTimer);transitionTimer=null;animations.forEach(animation=>animation.cancel());animations=[];stack.classList.remove('deck-transitioning');}
  const poses=['translateX(0px) scaleX(1)','translateX(4px) scaleX(1.02)','translateX(-2px) scaleX(1.045)','translateX(0px) scaleX(1.065)'];
  function animateCard(card,keyframes,duration=transitionMs){animations.push(card.animate(keyframes,{duration,easing:'cubic-bezier(.28,.6,.28,1)',fill:'both'}));}
  function showInsight(next,manual=false,dragX=0){
    finishTransition();const previous=[...deck],forward=next>index,hadFocus=document.activeElement===content;
    index=(next+insights.length)%insights.length;remainingMs=rotationMs;applyDeck();
    widget.dataset.deckDirection=forward?'clockwise':'counterclockwise';widget.dataset.deckSource=manual?'manual':'automatic';
    if(!motion.matches&&typeof surface.animate==='function'){
      stack.classList.add('deck-transitioning');suppressClickUntil=performance.now()+transitionMs;
      for(const record of previous){
        const from=previous.indexOf(record),to=deck.indexOf(record);
        if(forward&&from===0){
          animateCard(record.card,[{transform:dragX?`translateX(${dragX}px) scaleX(1)`:poses[0],zIndex:5,offset:0},{transform:'translateX(-58%) scaleX(.94)',zIndex:5,offset:.4},{transform:'translateX(-58%) scaleX(1.065)',zIndex:0,offset:.42},{transform:poses[3],zIndex:0,offset:1}]);
        }else if(forward&&from===1){
          animateCard(record.card,[{transform:poses[1],zIndex:4,offset:0},{transform:'translateX(22%) scaleX(.98)',zIndex:4,offset:.3},{transform:poses[0],zIndex:4,offset:1}]);
        }else if(!forward&&from===3){
          animateCard(record.card,[{transform:poses[3],zIndex:0,offset:0},{transform:'translateX(-58%) scaleX(1.065)',zIndex:0,offset:.58},{transform:'translateX(-58%) scaleX(.94)',zIndex:5,offset:.6},{transform:poses[0],zIndex:5,offset:1}]);
        }else if(!forward&&from===0){
          animateCard(record.card,[{transform:dragX?`translateX(${dragX}px) scaleX(1)`:poses[0],zIndex:4,offset:0},{transform:'translateX(22%) scaleX(.98)',zIndex:4,offset:.7},{transform:poses[1],zIndex:3,offset:1}]);
        }else animateCard(record.card,[{transform:poses[from]},{transform:poses[to]}]);
      }
      transitionTimer=setTimeout(finishTransition,transitionMs+40);
    }
    if(hadFocus)content.focus({preventScroll:true});schedule();
    if(manual)announcement.textContent=`${insights[index].label}, card ${index+1} of ${insights.length}`;
  }
  function finishGesture(event,cancel=false){
    if(!gesture||gesture.id!==event.pointerId)return;const state=gesture;gesture=null;
    if(state.surface.hasPointerCapture(event.pointerId))state.surface.releasePointerCapture(event.pointerId);
    widget.classList.remove('interacting','swiping');state.surface.style.removeProperty('transform');delete widget.dataset.dragOffset;
    const dx=event.clientX-state.x,elapsed=performance.now()-state.started,threshold=Math.min(surface.clientWidth*.16,60);
    if(state.horizontal||state.vertical||Math.hypot(dx,event.clientY-state.y)>8)suppressClickUntil=performance.now()+550;
    if(!cancel&&state.horizontal&&(Math.abs(dx)>=threshold||Math.abs(dx)>28&&elapsed<250))showInsight(index+(dx<0?1:-1),true,state.offset||0);
    else{
      if(state.horizontal&&!motion.matches&&typeof state.surface.animate==='function'){
        animateCard(state.surface,[{transform:`translateX(${state.offset||0}px) scaleX(1)`},{transform:poses[0]}],180);
        transitionTimer=setTimeout(finishTransition,220);
      }
      schedule();
    }
  }
  for(const record of records){
    record.card.addEventListener('pointerdown',event=>{
      if(record!==deck[0]||event.button!==0||event.isPrimary===false||gesture||event.target.closest('button,input,select,a'))return;
      finishTransition();clearTimeout(timer);remainingMs=Math.max(0,remainingMs-(performance.now()-startedAt));
      gesture={id:event.pointerId,x:event.clientX,y:event.clientY,started:performance.now(),horizontal:false,vertical:false,surface:record.card,content:record.content};
      record.card.setPointerCapture(event.pointerId);widget.classList.add('interacting');
    });
    record.card.addEventListener('pointermove',event=>{
      if(!gesture||gesture.id!==event.pointerId)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if(!gesture.horizontal&&!gesture.vertical){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.25)gesture.vertical=true;else if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.25){gesture.horizontal=true;widget.classList.add('swiping');}}
      if(gesture.horizontal){
        event.preventDefault();const limit=surface.clientWidth*.58;gesture.offset=Math.max(-limit,Math.min(limit,dx));
        gesture.surface.style.transform=`translateX(${gesture.offset}px) scaleX(1)`;
        widget.dataset.dragOffset=String(gesture.offset);
      }
    });
    record.card.addEventListener('pointerup',event=>finishGesture(event));record.card.addEventListener('pointercancel',event=>finishGesture(event,true));record.card.addEventListener('lostpointercapture',event=>finishGesture(event,true));
    record.content.addEventListener('keydown',event=>{
      if(record!==deck[0])return;
      if(event.key==='Enter'||event.key===' '){if(record.insight.id!=='greeting'){event.preventDefault();openDetail(record.insight.id);}return;}
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();showInsight(index+(event.key==='ArrowRight'?1:-1),true);
    });
    record.card.addEventListener('click',event=>{if(record!==deck[0]||event.target.closest('button,input,select,a')||performance.now()<suppressClickUntil)return;openDetail(record.insight.id);});
    record.card.addEventListener('wheel',event=>{
      if(record!==deck[0]||gesture||Math.abs(event.deltaX)<Math.abs(event.deltaY)&&!event.shiftKey)return;const delta=event.shiftKey?event.deltaY:event.deltaX;if(Math.abs(delta)<8)return;
      event.preventDefault();const now=performance.now();if(now-lastWheelAt<480)return;lastWheelAt=now;showInsight(index+(delta>0?1:-1),true);
    },{passive:false});
  }
  window.addEventListener('pagehide',()=>{clearTimeout(timer);finishTransition();},{once:true});
  applyDeck();schedule();
})();
