'use strict';
// The same ordered layout rules drive dragging, the move dialog, and app tools. A page holds 12 apps (4 columns × 3
// rows); a page with more (a layout saved when pages held 15) passes its extra apps on to the next page, in order.
const RestroLayout=(()=>{
  const capacity=12;
  // Apps past a full page move on to the start of the next page (a new page when there is none)
  const flow=(pages,from=0)=>{for(let p=from;p<pages.length;p++)while(pages[p].length>capacity){const carry=pages[p].pop();if(!pages[p+1])pages.push([]);pages[p+1].unshift(carry);}return pages;};
  return Object.freeze({
    capacity,
    restore(saved,appIds,fallback){
      const valid=Array.isArray(saved)&&saved.length>0&&saved.every(page=>Array.isArray(page));
      const known=new Set(appIds),seen=new Set();
      const pages=(valid?saved:fallback).map(page=>page.filter(id=>{
        if(!known.has(id)||seen.has(id))return false;seen.add(id);return true;
      }));
      if(!pages.length)pages.push([]);
      flow(pages);
      for(const id of appIds){
        if(seen.has(id))continue;
        let index=pages.findIndex(page=>page.length<capacity);
        if(index===-1){index=pages.length;pages.push([]);}
        pages[index].push(id);seen.add(id);
      }
      return pages;
    },
    move(pages,id,targetPage,targetPosition){
      if(!Number.isInteger(targetPage)||targetPage<0||targetPage>=pages.length||!Number.isInteger(targetPosition)||targetPosition<0||targetPosition>=capacity)throw new Error('Choose a valid page and position.');
      const next=pages.map(page=>[...page]);
      const fromPage=next.findIndex(page=>page.includes(id));
      if(fromPage===-1)throw new Error('Choose an installed app.');
      const fromIndex=next[fromPage].indexOf(id),anchor=next[targetPage][targetPosition];
      if(anchor===id)return {pages:next,page:targetPage,position:fromIndex};
      next[fromPage].splice(fromIndex,1);
      // Resolve the target app after removing the source, so dropping means “before”.
      const position=anchor?next[targetPage].indexOf(anchor):Math.min(targetPosition,next[targetPage].length);
      next[targetPage].splice(position,0,id);
      flow(next,targetPage);
      return {pages:next,page:targetPage,position};
    },
    // Dragging: the app takes exactly the place it is held over; apps after it on that page shift along
    // (a full page passes its last app on to the next page). Used live while dragging and on drop.
    place(pages,id,targetPage,targetPosition){
      const next=pages.map(page=>[...page]);
      const fromPage=next.findIndex(page=>page.includes(id));
      if(fromPage===-1)throw new Error('Choose an installed app.');
      next[fromPage].splice(next[fromPage].indexOf(id),1);
      while(next.length<=targetPage)next.push([]);
      const position=Math.max(0,Math.min(Number(targetPosition)||0,next[targetPage].length));
      next[targetPage].splice(position,0,id);
      flow(next,targetPage);
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
})();
