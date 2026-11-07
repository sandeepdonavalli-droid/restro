'use strict';
(() => {
  // The app icons (POS Home Handoff): each a whole rounded tile with its border drawn in, the same in every theme. Where
  // an app's icon sits beside its name at the top of its page, it shows plain: the tile without the border ring
  // (assets/app-icons/plain), so on a white page only the icon shows.
  const tileIcons={register:'counter',floor:'floor',orders:'orders','pager-hub':'pager-hub',closeout:'end-day',menu:'menu',transactions:'payments',refunds:'refunds',cash:'cash-bag',inventory:'inventory',employees:'staff',customers:'customers',help:'help',store:'app-store',analytics:'analytics',settings:'settings','qr-studio':'qr-studio',calculator:'calculator',gallery:'gallery',camera:'camera'};
  const overrides = new Map();
  function resolve(art) {
    const key=art.key;
    if (overrides.has(key)) return overrides.get(key);
    if (tileIcons[key]) return art.plain
      ? {key,url:`assets/app-icons/plain/${tileIcons[key]}.webp`,w:128,h:128,tile:true}
      : {key,url:`assets/app-icons/${tileIcons[key]}.webp`,w:384,h:384,tile:true};
    return art;
  }
  function override(key,asset) {
    // A future app-icon replacement has one entry and applies everywhere.
    if (asset) overrides.set(key,{...asset,key}); else overrides.delete(key);
    window.dispatchEvent(new CustomEvent('restro:artwork-changed'));
  }
  window.RestroArtwork=Object.freeze({resolve,override,ready:Promise.resolve()});
})();
