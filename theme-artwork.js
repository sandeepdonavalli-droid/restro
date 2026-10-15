'use strict';
(() => {
  // Windows onto the approved original artwork, rendered at its native quality.
  // One catalog of app IDs is used on all pages; no theme owns an app arrangement.
  const positions = {
    A: { rows:[[452,99],[603,100],[761,102]], sales:[1229,490,218,153] },
    C: { rows:[[447,104],[602,102],[748,105]], sales:[1217,488,236,164] },
    D: { rows:[[448,108],[602,106],[755,111]], sales:[1228,473,218,164] },
    H: { rows:[[448,111],[604,110],[756,115]], sales:[1227,476,245,174] },
    G: { rows:[[447,100],[603,104],[754,105]], sales:[1228,490,214,157] },
    P: { rows:[[440,97],[602,90],[756,106]], sales:[1240,480,205,163] }
  };
  const mainWindows={
    A:[[65,82,222,220],[360,80,256,223],[708,70,180,231],[978,115,256,187],[1330,91,213,209]],
    C:[[75,81,225,213],[364,83,255,212],[691,66,205,232],[965,102,268,194],[1302,78,237,220]],
    D:[[55,86,233,220],[356,93,262,211],[694,74,195,230],[972,116,263,191],[1308,84,230,217]],
    H:[[61,80,221,220],[345,84,273,220],[694,71,190,233],[972,108,269,196],[1318,83,220,221]],
    G:[[59,82,224,220],[352,86,268,219],[704,65,182,240],[970,107,267,196],[1313,79,225,224]],
    P:[[64,65,243,221],[348,82,282,208],[704,68,206,219],[980,84,253,202],[1318,70,217,218]]
  };
  const topIds = ['register','floor','orders','pager-hub','closeout'];
  const appIds = ['menu','transactions','refunds','cash','inventory','employees','customers','printers','help','store','analytics','settings'];
  const centers = [141,344,547,752,958];
  const variants = new Map();
  const overrides = new Map();
  const prepared = new Map();
  const qrStudio={
    A:{selection:'A06',region:[56,404,223,258]},
    C:{selection:'C09',region:[930,408,269,262]},
    D:{selection:'D06',region:[48,405,244,264]},
    H:{selection:'H06',region:[45,410,249,247]},
    G:{selection:'G06',region:[29,408,267,255]},
    P:{selection:'P09',region:[930,416,270,262]}
  };
  for (const [id,p] of Object.entries(positions)) {
    const regions = {};
    topIds.forEach((key,i) => {
      regions[key]=mainWindows[id][i];
    });
    appIds.forEach((key,i) => {
      const row=p.rows[Math.floor(i/5)];
      regions[key]=[centers[i%5]-73,row[0],146,row[1]];
    });
    regions['insight-sales']=p.sales;
    regions['qr-studio']=qrStudio[id].region;
    variants.set(id,regions);
  }
  function resolve(art,themeId=document.documentElement.dataset.restroArtwork||document.documentElement.dataset.restroTheme) {
    const key=art.key;
    if (overrides.has(key)) return overrides.get(key);
    if (prepared.has(`${themeId}:${key}`)) return prepared.get(`${themeId}:${key}`);
    const region=variants.get(themeId)?.[key];
    if (!region) return art;
    const qr=key==='qr-studio';
    return {key,url:qr?`assets/qr-studio/${themeId}.webp`:`assets/themes/${themeId}.webp`,w:qr?1536:1586,h:qr?1024:992,viewBox:region.join(' '),sprite:true,themeId,...(qr?{selection:qrStudio[themeId].selection}:{})};
  }
  function override(key,asset) {
    // A future app-icon replacement has one entry and applies to all six themes.
    if (asset) overrides.set(key,{...asset,key}); else overrides.delete(key);
    window.dispatchEvent(new CustomEvent('restro:artwork-changed'));
  }
  function prepareWindow(image,region,key,themeId) {
    const [x,y,w,h]=region,canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,x,y,w,h,0,0,w,h);
    const bitmap=context.getImageData(0,0,w,h),pixels=bitmap.data;
    // Remove only the connected backdrop of an approved image window. The
    // original object colors, lighting, detail and native pixels stay intact.
    const sample=(sx,sy)=>{
      const out=[0,0,0];let count=0;
      for(let py=sy;py<sy+4;py++)for(let px=sx;px<sx+4;px++){
        const offset=(py*w+px)*4;for(let c=0;c<3;c++)out[c]+=pixels[offset+c];count++;
      }
      return out.map(value=>value/count);
    };
    const corners=[sample(0,0),sample(w-4,0),sample(0,h-4),sample(w-4,h-4)];
    const distance=index=>{
      const px=index%w,py=Math.floor(index/w),u=px/(w-1),v=py/(h-1);
      let difference=0;
      for(let c=0;c<3;c++){
        const top=corners[0][c]*(1-u)+corners[1][c]*u,bottom=corners[2][c]*(1-u)+corners[3][c]*u;
        difference=Math.max(difference,Math.abs(pixels[index*4+c]-(top*(1-v)+bottom*v)));
      }
      return difference;
    };
    const size=w*h,seen=new Uint8Array(size),edges=new Uint8Array(size),queue=new Int32Array(size);let head=0,tail=0;
    for(let index=0;index<size;index++){
      const px=index%w,offset=index*4;
      for(const neighbor of [px?index-1:index,px<w-1?index+1:index,index>=w?index-w:index,index<size-w?index+w:index]){
        for(let c=0;c<3;c++)if(Math.abs(pixels[offset+c]-pixels[neighbor*4+c])>7)edges[index]=1;
      }
    }
    const backdropTolerance=themeId==='C'&&key!=='qr-studio'?42:20;
    const visit=index=>{if(index<0||index>=size||seen[index]||edges[index]||distance(index)>backdropTolerance)return;seen[index]=1;queue[tail++]=index;};
    for(let px=0;px<w;px++){visit(px);visit((h-1)*w+px);}
    for(let py=0;py<h;py++){visit(py*w);visit(py*w+w-1);}
    while(head<tail){
      const index=queue[head++],px=index%w;
      if(px)visit(index-1);if(px<w-1)visit(index+1);visit(index-w);visit(index+w);
    }
    for(let index=0;index<size;index++){
      if(seen[index])pixels[index*4+3]=0;
      else {
        const px=index%w;
        if((px&&seen[index-1])||(px<w-1&&seen[index+1])||seen[index-w]||seen[index+w])pixels[index*4+3]=Math.round(255*Math.min(1,Math.max(0,(distance(index)-8)/12)));
      }
    }
    const alpha=new Uint8ClampedArray(size);
    for(let index=0;index<size;index++)alpha[index]=pixels[index*4+3];
    for(let py=1;py<h-1;py++)for(let px=1;px<w-1;px++){
      const index=py*w+px;
      const softened=(alpha[index-w-1]+2*alpha[index-w]+alpha[index-w+1]+2*alpha[index-1]+4*alpha[index]+2*alpha[index+1]+alpha[index+w-1]+2*alpha[index+w]+alpha[index+w+1])/16;
      pixels[index*4+3]=Math.round(softened);
    }
    context.putImageData(bitmap,0,0);
    return new Promise(resolve=>canvas.toBlob(blob=>{
      if(blob)prepared.set(`${themeId}:${key}`,{key,url:URL.createObjectURL(blob),w,h,clean:true,themeId,...(key==='qr-studio'?{selection:qrStudio[themeId].selection}:{})});
      resolve();
    },'image/png'));
  }
  function prepareTheme(themeId) {
    return Promise.all([false,true].map(qr=>new Promise(resolve=>{
      const image=new Image();
      image.onload=async()=>{
        await Promise.all(Object.entries(variants.get(themeId)).filter(([key])=>(key==='qr-studio')===qr).map(([key,region])=>prepareWindow(image,region,key,themeId)));
        window.dispatchEvent(new CustomEvent('restro:artwork-changed'));resolve();
      };
      image.onerror=()=>resolve();image.src=qr?`assets/qr-studio/${themeId}.webp`:`assets/themes/${themeId}.webp`;
    })));
  }
  const ready=typeof Image==='undefined'?Promise.resolve():Promise.all(['D','A','C','H','G','P'].map(prepareTheme));
  window.RestroArtwork=Object.freeze({resolve,override,ready});
})();
