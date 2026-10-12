'use strict';
(() => {
  const icon=document.querySelector('.battery-status');
  const fill=icon.querySelector('.battery-fill');
  const flash=icon.querySelector('.battery-flash');
  const fullWidth=21.8;
  let revision=0,generation=0,nativeActive=false,battery=null,unsubscribe=null;
  function normalize(input){
    let value=input;
    if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
    if(!value||typeof value!=='object')return null;
    if(value.hasBattery===false)return {present:false};
    const level=typeof value.percentage==='number'?value.percentage/100:value.level;
    if(typeof level!=='number'||!Number.isFinite(level)||level<0||level>1)return null;
    const plugged=typeof value.plugged==='boolean'?value.plugged:typeof value.plugged==='number'&&Number.isFinite(value.plugged)&&value.plugged>=0?value.plugged>0:value.charging;
    if(typeof plugged!=='boolean')return null;
    return {present:true,level,plugged};
  }
  function render(state){
    icon.hidden=!state.present;
    if(!state.present){
      delete icon.dataset.batteryState;delete icon.dataset.batteryLevel;
      icon.removeAttribute('aria-label');icon.removeAttribute('title');
      fill.setAttribute('width','0');flash.setAttribute('hidden','');return;
    }
    const kind=state.plugged?'charging':state.level<.2?'low':'normal';
    icon.dataset.batteryState=kind;icon.dataset.batteryLevel=String(state.level);
    fill.setAttribute('width',String(fullWidth*state.level));
    flash.toggleAttribute('hidden',!state.plugged);
    icon.setAttribute('aria-label',`Battery ${Math.round(state.level*100)}%, ${state.plugged?'plugged in':kind==='low'?'low battery':'unplugged'}`);
    icon.title=state.plugged?'Battery · Plugged in':kind==='low'?'Battery · Low':'Battery';
  }
  function update(input){
    const state=normalize(input);if(!state)return false;
    nativeActive=true;revision++;render(state);return true;
  }
  function readBrowser(){
    if(nativeActive||!battery)return;
    const state=normalize(battery);if(state){revision++;render(state);}
  }
  function disconnect(){
    try{unsubscribe?.();}catch{}unsubscribe=null;
    if(battery){battery.removeEventListener('levelchange',readBrowser);battery.removeEventListener('chargingchange',readBrowser);battery=null;}
  }
  async function refresh(){
    const host=window.RESTRODevice,atRevision=revision,atGeneration=generation;
    if(typeof host?.getBatteryStatus==='function'){
      try{const status=await host.getBatteryStatus();if(generation===atGeneration&&revision===atRevision)update(status);}catch{}
    }else readBrowser();
  }
  async function connect(){
    const current=++generation;disconnect();nativeActive=false;render({present:false});
    const host=window.RESTRODevice;
    const nativeGetter=typeof host?.getBatteryStatus==='function',nativeSubscription=typeof host?.subscribeBatteryStatus==='function';
    if(nativeSubscription){
      try{const stop=host.subscribeBatteryStatus(status=>{if(current===generation)update(status);});if(typeof stop==='function')unsubscribe=stop;}catch{}
    }
    if(nativeGetter||nativeSubscription){await refresh();return;}
    if(typeof navigator.getBattery!=='function')return;
    try{
      const manager=await navigator.getBattery();if(current!==generation)return;
      battery=manager;battery.addEventListener('levelchange',readBrowser);battery.addEventListener('chargingchange',readBrowser);readBrowser();
    }catch{}
  }
  window.RestroBattery=Object.freeze({update,refresh});
  window.addEventListener('restro:battery-status',event=>update(event.detail));
  window.addEventListener('restro:device-ready',connect);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('pagehide',()=>{generation++;disconnect();},{once:true});
  render({present:false});connect();
})();
