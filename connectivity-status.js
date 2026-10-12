'use strict';
(() => {
  const cellular=document.querySelector('#cellular-status'),wifi=document.querySelector('#wifi-status');
  const dot=document.querySelector('#online-dot'),label=document.querySelector('#online-text');
  const previewToggle=document.querySelector('#wifi-preview-toggle'),previewSection=document.querySelector('#browser-preview-settings'),previewNote=document.querySelector('#wifi-preview-note');
  let wifiPreview=false,previewLevel=4;
  try{wifiPreview=window.localStorage.getItem('restro.wifiPreview.v1')==='true';}catch{}
  const connection=()=>navigator.connection||navigator.mozConnection||navigator.webkitConnection||navigator.network?.connection;
  const transport=value=>{
    if(typeof value!=='string')return null;
    const type=value.toLowerCase();
    if(['cellular','cell','2g','3g','4g','5g'].includes(type))return 'cellular';
    return ['wifi','none','ethernet','bluetooth','wimax','other','unknown'].includes(type)?type:null;
  };
  const bool=value=>typeof value==='boolean'?value:null;
  const level=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(4,Math.round(value))):null;
  let state={hasCellular:false,cellular:{connected:false,level:null},wifi:{connected:false,level:null,internetAvailable:null},internetAvailable:false,source:'browser'};
  let nativeActive=false,subscribedHost=null,unsubscribe=null,poll=null,controller=null,probeVersion=0,refreshing=null,refreshQueued=false,disposed=false,lastBrowserProbe=0;
  let boundConnection=null,networkSource=null,networkReport=null,networkListener=null,networkGeneration=0,networkVersion=0;
  function snapshot(){return {...state,cellular:{...state.cellular},wifi:{...state.wifi},preview:{wifi:wifiPreview&&!nativeActive},wifiPreviewEnabled:wifiPreview};}
  function signal(node,selector,value){
    node.dataset.signalLevel=value===null?'unknown':String(value);
    node.querySelectorAll(selector).forEach(segment=>{
      const rank=Number(segment.dataset.signalLevel||segment.dataset.wifiLevel);
      segment.classList.toggle('signal-active',value!==null&&rank<=value);
      segment.classList.toggle('signal-unknown',value===null);
    });
  }
  function render(){
    // Browser preview changes only presentation, never the device snapshot or internet check.
    const preview=wifiPreview&&!nativeActive;
    cellular.hidden=!state.hasCellular;wifi.hidden=!(state.wifi.connected||preview);
    wifi.dataset.preview=String(preview);
    signal(cellular,'[data-signal-level]',state.cellular.level);
    signal(wifi,'[data-wifi-level]',preview?previewLevel:state.wifi.level);
    const warning=state.wifi.connected&&state.wifi.internetAvailable===false;
    wifi.classList.toggle('no-internet',warning);wifi.querySelector('.wifi-warning').toggleAttribute('hidden',!warning);
    const strength=value=>value===null?'signal strength unavailable':`signal ${value} of 4`;
    const cellLabel=`Cellular · ${strength(state.cellular.level)}`;
    const wifiLabel=(preview?`Wi-Fi · Visual preview · sample signal ${previewLevel} of 4`:`Wi-Fi · ${strength(state.wifi.level)}`)+(warning?' · No internet access':'');
    if(previewToggle){previewToggle.checked=wifiPreview;previewToggle.disabled=nativeActive;}
    if(previewSection)previewSection.hidden=nativeActive;
    if(previewNote)previewNote.textContent=preview?'Preview active. The Wi-Fi icon uses a sample signal; internet status stays live.':'Show a sample Wi-Fi icon for browser visual testing. Internet status stays live.';
    cellular.title=cellLabel;cellular.setAttribute('aria-label',cellLabel);
    wifi.title=wifiLabel;wifi.setAttribute('aria-label',wifiLabel);
    label.textContent=state.internetAvailable?'Online':'Offline';dot.classList.toggle('offline',!state.internetAvailable);
    document.documentElement.dataset.internetStatus=state.internetAvailable?'online':'offline';
    if(typeof window.alignBannerText==='function')window.alignBannerText();
    window.dispatchEvent(new CustomEvent('restro:connectivity-changed',{detail:snapshot()}));
  }
  function decode(payload){
    if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{return null;}}
    return payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:null;
  }
  function update(payload){
    const input=decode(payload);if(!input)return false;
    const cell=input.cellular&&typeof input.cellular==='object'?input.cellular:{};
    const wlan=input.wifi&&typeof input.wifi==='object'?input.wifi:{};
    const supported=bool(input.hasCellular)??bool(cell.supported);
    const cellConnected=bool(cell.connected);
    const connected=bool(wlan.connected)??bool(input.wifiConnected);
    const available=bool(input.internetAvailable)??bool(input.validated);
    const wifiInternet=bool(wlan.internetAvailable)??bool(input.wifiInternetAvailable);
    const reading=(nested,key,flat)=>Object.hasOwn(nested,key)&&(nested[key]===null||level(nested[key])!==null)||Object.hasOwn(input,flat)&&(input[flat]===null||level(input[flat])!==null);
    if(supported===null&&cellConnected===null&&connected===null&&available===null&&wifiInternet===null&&!reading(cell,'level','cellularLevel')&&!reading(wlan,'level','wifiLevel'))return false;
    nativeActive=true;probeVersion++;controller?.abort();state.source='native';
    if(supported!==null)state.hasCellular=supported;
    if(cellConnected!==null)state.cellular.connected=cellConnected;
    if(Object.hasOwn(cell,'level')||Object.hasOwn(input,'cellularLevel'))state.cellular.level=level(cell.level??input.cellularLevel);
    if(connected!==null)state.wifi.connected=connected;
    if(Object.hasOwn(wlan,'level')||Object.hasOwn(input,'wifiLevel'))state.wifi.level=level(wlan.level??input.wifiLevel);
    if(available!==null)state.internetAvailable=available;
    if(wifiInternet!==null)state.wifi.internetAvailable=wifiInternet;
    else if(connected===true&&available!==null&&(input.transport==='wifi'||!state.hasCellular))state.wifi.internetAvailable=available;
    if(!state.hasCellular)state.cellular={connected:false,level:null};
    if(!state.wifi.connected)state.wifi={connected:false,level:null,internetAvailable:null};
    render();return true;
  }
  function browserConnection(){
    // effectiveType ('4g') is a speed estimate, never hardware or signal strength.
    const type=networkReport?.type??transport(connection()?.type);
    if(type==='cellular')state.hasCellular=true;
    const connected=networkReport?.connected!==false;
    state.cellular={connected:type==='cellular'&&connected,level:null};
    state.wifi={connected:type==='wifi'&&connected,level:null,internetAvailable:null};
    state.source=networkReport?'app-network':'browser';
  }
  function connectionChanged(){
    if(nativeActive||disposed)return;
    probeVersion++;controller?.abort();browserConnection();state.internetAvailable=false;render();refresh();
  }
  function bindConnection(){
    const current=connection();if(current===boundConnection)return;
    boundConnection?.removeEventListener?.('change',connectionChanged);
    boundConnection=current;boundConnection?.addEventListener?.('change',connectionChanged);
  }
  function acceptNetworkStatus(report,notify=false){
    if(nativeActive||disposed)return false;
    const type=transport(report?.connectionType??report?.type),connected=bool(report?.connected);
    if(type===null||connected===null)return false;
    const changed=networkReport?.type!==type||networkReport?.connected!==connected;
    networkReport={type,connected};networkVersion++;
    if(changed){
      probeVersion++;controller?.abort();browserConnection();state.internetAvailable=false;render();
      if(notify)refresh();
    }
    return true;
  }
  function removeNetworkListener(listener){
    try{Promise.resolve(listener?.remove?.()).catch(()=>{});}catch{}
  }
  function registerNetworkSource(source){
    if(disposed||typeof source?.getStatus!=='function')return false;
    if(source===networkSource)return true;
    networkGeneration++;const generation=networkGeneration;
    removeNetworkListener(networkListener);networkListener=null;networkSource=source;networkReport=null;
    // Register only our listener; never remove other apps' plugin listeners.
    if(typeof source.addListener==='function'){
      try{Promise.resolve(source.addListener('networkStatusChange',report=>{if(generation===networkGeneration)acceptNetworkStatus(report,true);})).then(listener=>{
        if(disposed||generation!==networkGeneration)removeNetworkListener(listener);else networkListener=listener;
      }).catch(()=>{});}catch{}
    }
    return true;
  }
  function discoverNetworkSource(){
    const capacitor=window.Capacitor;
    try{
      const native=capacitor?.isNativePlatform?.()||['android','ios'].includes(capacitor?.getPlatform?.());
      if(!networkSource&&native)registerNetworkSource(capacitor?.Plugins?.Network);
    }catch{}
  }
  function attachNetworkSource(source){
    if(!registerNetworkSource(source))return Promise.resolve(false);
    return refresh().then(()=>true);
  }
  async function probeInternet(){
    const version=++probeVersion;
    controller?.abort();controller=new AbortController();
    const timeout=setTimeout(()=>controller?.abort(),8000);
    let available=false;
    try{
      if(navigator.onLine!==false&&networkReport?.connected!==false&&typeof fetch==='function'){
        const url=new URL('connectivity-check.txt',document.baseURI);url.searchParams.set('restroProbe',String(Date.now()));
        const response=await fetch(url,{cache:'no-store',redirect:'error',credentials:'same-origin',signal:controller.signal});
        available=response.ok&&(await response.text()).trim()==='RESTRO_INTERNET_OK_v1';
      }
    }catch{}finally{clearTimeout(timeout);}
    if(version!==probeVersion||nativeActive||disposed)return;
    browserConnection();state.internetAvailable=available;
    if(state.wifi.connected)state.wifi.internetAvailable=available;
    render();
  }
  function subscribe(host){
    if(subscribedHost===host||typeof host?.subscribeConnectivityStatus!=='function')return;
    try{if(typeof unsubscribe==='function')unsubscribe();unsubscribe=host.subscribeConnectivityStatus(update);subscribedHost=host;}catch{}
  }
  async function readStatus(force){
    bindConnection();discoverNetworkSource();
    const host=window.RESTRODevice;subscribe(host);
    if(typeof host?.getConnectivityStatus==='function'){
      try{if(update(await host.getConnectivityStatus()))return;}catch{}
    }
    if(!nativeActive&&networkSource){
      const source=networkSource,generation=networkGeneration,version=networkVersion;
      try{const report=await source.getStatus();if(generation===networkGeneration&&version===networkVersion)acceptNetworkStatus(report);}catch{}
    }
    if(!nativeActive&&(force||Date.now()-lastBrowserProbe>=30000)){
      lastBrowserProbe=Date.now();await probeInternet();
    }
  }
  function refresh(force=true){
    if(disposed)return Promise.resolve();
    if(refreshing){if(force!==false)refreshQueued=true;return refreshing;}
    refreshing=readStatus(force!==false).finally(()=>{
      refreshing=null;if(refreshQueued){refreshQueued=false;refresh();}
    });return refreshing;
  }
  function setWifiPreview(enabled,level){
    if(typeof enabled!=='boolean')return false;
    wifiPreview=enabled;previewLevel=typeof level==='number'?Math.max(0,Math.min(4,Math.round(level))):4;try{window.localStorage.setItem('restro.wifiPreview.v1',String(enabled));}catch{}
    render();return true;
  }
  previewToggle?.addEventListener?.('change',()=>setWifiPreview(previewToggle.checked));
  window.RestroConnectivity=Object.freeze({update,getStatus:snapshot,refresh,attachNetworkSource,setWifiPreview});
  window.addEventListener('restro:connectivity-status',event=>update(event.detail));
  window.addEventListener('restro:device-ready',refresh);
  window.addEventListener('online',refresh);
  function offline(){
    if(nativeActive)return;
    probeVersion++;controller?.abort();browserConnection();state.internetAvailable=false;
    if(state.wifi.connected)state.wifi.internetAvailable=false;render();
  }
  window.addEventListener('offline',offline);
  // Cordova supplies navigator.connection only after deviceready, and sends
  // network/resume events on document rather than window.
  document.addEventListener('deviceready',()=>{bindConnection();discoverNetworkSource();if(nativeActive)refresh();else connectionChanged();});
  document.addEventListener('online',refresh);document.addEventListener('offline',offline);
  document.addEventListener('resume',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  // Native readings refresh every 5s; fallback internet probes every 30s.
  poll=setInterval(()=>{if(!document.hidden)refresh(false);},5000);
  window.addEventListener('pagehide',()=>{disposed=true;clearInterval(poll);controller?.abort();boundConnection?.removeEventListener?.('change',connectionChanged);removeNetworkListener(networkListener);if(typeof unsubscribe==='function')unsubscribe();},{once:true});
  browserConnection();render();refresh();
})();
