'use strict';
// The same ordered layout rules drive dragging, the move dialog, and app tools.
const RestroLayout=Object.freeze({
  capacity:15,
  restore(saved,appIds,fallback){
    const valid=Array.isArray(saved)&&saved.length>0&&saved.every(page=>Array.isArray(page)&&page.length<=15);
    const known=new Set(appIds),seen=new Set();
    const pages=(valid?saved:fallback).map(page=>page.filter(id=>{
      if(!known.has(id)||seen.has(id))return false;seen.add(id);return true;
    }));
    if(!pages.length)pages.push([]);
    for(const id of appIds){
      if(seen.has(id))continue;
      let index=pages.findIndex(page=>page.length<15);
      if(index===-1){index=pages.length;pages.push([]);}
      pages[index].push(id);seen.add(id);
    }
    return pages;
  },
  move(pages,id,targetPage,targetPosition){
    if(!Number.isInteger(targetPage)||targetPage<0||targetPage>=pages.length||!Number.isInteger(targetPosition)||targetPosition<0||targetPosition>=15)throw new Error('Choose a valid page and position.');
    const next=pages.map(page=>[...page]);
    const fromPage=next.findIndex(page=>page.includes(id));
    if(fromPage===-1)throw new Error('Choose an installed app.');
    const fromIndex=next[fromPage].indexOf(id),anchor=next[targetPage][targetPosition];
    if(anchor===id)return {pages:next,page:targetPage,position:fromIndex};
    next[fromPage].splice(fromIndex,1);
    // Resolve the target app after removing the source, so dropping means “before”.
    const position=anchor?next[targetPage].indexOf(anchor):Math.min(targetPosition,next[targetPage].length);
    next[targetPage].splice(position,0,id);
    for(let p=targetPage;next[p].length>15;p++){
      const carry=next[p].pop();if(!next[p+1])next.push([]);next[p+1].unshift(carry);
    }
    return {pages:next,page:targetPage,position};
  },
  addPage(pages){return [...pages.map(page=>[...page]),[]];},
  deletePage(pages,index){
    if(!Number.isInteger(index)||index<0||index>=pages.length)throw new Error('Choose a valid page.');
    if(pages[index].length)throw new Error('Only empty pages can be deleted.');
    if(pages.length===1)throw new Error('Keep at least one app page.');
    return pages.filter((_,p)=>p!==index).map(page=>[...page]);
  }
});
