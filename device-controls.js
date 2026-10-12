'use strict';
(() => {
  const drawer=document.querySelector('#quick-controls-dialog');
  const banner=document.querySelector('.top-banner');
  const trigger=document.querySelector('#quick-controls-open');
  const settings=document.querySelector('#device-settings-dialog');
  const content=document.querySelector('#device-settings-content');
  let pull=null,returnFocus=null,brightness=100,cameraStream=null,photoUrl=null;
  const pairedDevices=new Map();

  // The Android shell may supply this adapter. The browser never simulates an OS toggle.
  const deviceHost=()=>window.RESTRODevice;
  function openQuickControls(){
    if(document.querySelector('dialog[open]'))return;
    returnFocus=document.activeElement;
    drawer.showModal();
    updateConnectionStatus();
    window.RestroNotifications?.refresh();
  }
  trigger.addEventListener('click',openQuickControls);
  document.querySelector('.quick-drawer-handle').addEventListener('click',()=>drawer.close());
  drawer.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))returnFocus?.focus({preventScroll:true});});

  // Capture only pulls beginning in the top banner, leaving More Apps gestures untouched.
  banner.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,input,a')||document.querySelector('dialog[open]'))return;
    pull={id:event.pointerId,x:event.clientX,y:event.clientY,direction:'down',surface:banner};
    banner.setPointerCapture(event.pointerId);
  });
  function beginClose(event){
    if(event.button!==0||event.target.closest('button:not(.quick-drawer-handle)'))return;
    pull={id:event.pointerId,x:event.clientX,y:event.clientY,direction:'up',surface:event.currentTarget};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  document.querySelector('.quick-drawer-heading').addEventListener('pointerdown',beginClose);
  document.querySelector('.quick-drawer-handle').addEventListener('pointerdown',beginClose);
  document.addEventListener('pointerup',event=>{
    if(!pull||event.pointerId!==pull.id)return;
    const dx=event.clientX-pull.x,dy=event.clientY-pull.y;
    const direction=pull.direction;pull=null;
    if(Math.abs(dy)<36||Math.abs(dy)<Math.abs(dx)*1.2)return;
    if(direction==='down'&&dy>0)openQuickControls();
    if(direction==='up'&&dy<0)drawer.close();
  });
  document.addEventListener('pointercancel',()=>{pull=null;});
  drawer.addEventListener('click',event=>{
    if(event.target!==drawer)return;
    const rect=drawer.getBoundingClientRect();
    if(event.clientY>rect.bottom||event.clientX<rect.left||event.clientX>rect.right)drawer.close();
  });
  function updateConnectionStatus(){
    const status=window.RestroConnectivity?.getStatus();
    document.querySelector('#quick-wifi-status').textContent=status?.preview?.wifi?'Visual preview':status?.wifi.connected?(status.wifi.internetAvailable===false?'No internet access':'Connected'):'Network settings';
    document.querySelector('#quick-bluetooth-status').textContent=pairedDevices.size?`${pairedDevices.size} connected`:'Connections';
    const summary=document.querySelector('#wifi-internet-status');if(summary)summary.textContent=status?.internetAvailable?'Internet available':'No internet connection';
  }
  window.addEventListener('online',updateConnectionStatus);
  window.addEventListener('offline',updateConnectionStatus);
  window.addEventListener('restro:connectivity-changed',updateConnectionStatus);
  function section(markup){content.innerHTML=`<div class="device-section">${markup}</div>`;}
  function showSettings(title,markup){
    drawer.close();
    document.querySelector('#device-settings-title').textContent=title;
    section(markup);settings.showModal();
  }
  async function hostSettings(kind,feedback){
    try{
      if(typeof deviceHost()?.openSettings!=='function')throw new Error('Open these controls on your RESTRO Android device.');
      const result=await deviceHost().openSettings(kind);
      if(result===false)throw new Error('Device settings could not be opened. Please try again.');
      feedback.textContent='Device settings opened.';
    }catch(error){feedback.textContent=error.message||'Unable to open device settings.';}
  }
  function networkSettings(){
    const hasHost=typeof deviceHost()?.openSettings==='function';
    const status=window.RestroConnectivity?.getStatus();
    showSettings('Wi-Fi',`<div class="connection-summary"><svg class="icon" aria-hidden="true"><use href="#wifi"/></svg><div><strong id="wifi-internet-status">${status?.internetAvailable?'Internet available':'No internet connection'}</strong><p>Manage your device’s Wi-Fi connection.</p></div></div><button id="wifi-settings-button" class="primary-button"${hasHost?'':' disabled'}>Open Wi-Fi settings</button><p id="wifi-feedback" class="device-note" role="status">${hasHost?'Choose a network in device settings.':'Wi-Fi settings are available on the RESTRO Android device.'}</p>`);
    document.querySelector('#wifi-settings-button').addEventListener('click',()=>hostSettings('wifi',document.querySelector('#wifi-feedback')));
  }
  function bluetoothSettings(){
    const hasHost=typeof deviceHost()?.openSettings==='function',hasBluetooth=typeof navigator.bluetooth?.requestDevice==='function';
    showSettings('Bluetooth',`<div class="connection-summary"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 7 12 10-6 5V2l6 5L6 17"/></svg><div><strong>Bluetooth connections</strong><p>Connect a nearby device.</p></div></div><h3>Connected in this session</h3><ul id="bluetooth-devices" class="device-list"></ul><button id="bluetooth-connect" class="primary-button"${hasHost||hasBluetooth?'':' disabled'}>${hasHost?'Open Bluetooth settings':'Connect a device'}</button><p id="bluetooth-feedback" class="device-note" role="status">${hasHost?'Manage Bluetooth on your device.':hasBluetooth?'Keep your device nearby and in pairing mode.':'Bluetooth pairing is available on supported browsers and RESTRO Android devices.'}</p>`);
    renderBluetoothDevices();
    document.querySelector('#bluetooth-connect').addEventListener('click',async()=>{
      const feedback=document.querySelector('#bluetooth-feedback');
      if(hasHost){await hostSettings('bluetooth',feedback);return;}
      try{
        const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true});
        if(!device.gatt)throw new Error('This device does not support a Bluetooth data connection.');
        await device.gatt.connect();pairedDevices.set(device.id,device);
        device.addEventListener('gattserverdisconnected',()=>{pairedDevices.delete(device.id);updateConnectionStatus();if(settings.open)renderBluetoothDevices();},{once:true});
        renderBluetoothDevices();updateConnectionStatus();feedback.textContent='Device connected.';
      }catch(error){feedback.textContent=error.name==='NotFoundError'?'No device selected.':error.message||'Could not connect. Check the device and try again.';}
    });
  }
  function renderBluetoothDevices(){
    const list=document.querySelector('#bluetooth-devices');if(!list)return;list.replaceChildren();
    if(!pairedDevices.size){const li=document.createElement('li');li.textContent='No connected devices';list.append(li);return;}
    for(const device of pairedDevices.values()){
      const li=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
      label.textContent=device.name||'Bluetooth device';button.className='secondary-button';button.textContent='Disconnect';
      button.addEventListener('click',()=>{device.gatt.disconnect();pairedDevices.delete(device.id);renderBluetoothDevices();updateConnectionStatus();});li.append(label,button);list.append(li);
    }
  }
  async function pazzerSettings(){
    const host=deviceHost(),hasHost=typeof host?.openSettings==='function';
    showSettings('Pazzer Connect',`<div class="connection-summary"><svg class="icon" aria-hidden="true"><use href="#hardware"/></svg><div><strong>Your Pazzer hardware</strong><p>Connections for this POS setup.</p></div></div><h3>Connected hardware</h3><ul id="pazzer-devices" class="device-list"><li>${host?'Checking connected hardware…':'No Pazzer hardware connected'}</li></ul><button id="pazzer-settings-button" class="primary-button"${hasHost?'':' disabled'}>Open Pazzer settings</button><p id="pazzer-feedback" class="device-note" role="status">${hasHost?'Manage your paired hardware in Pazzer Connect.':'Connect your setup through Pazzer Connect on the RESTRO Android device.'}</p>`);
    document.querySelector('#pazzer-settings-button').addEventListener('click',()=>hostSettings('pazzer',document.querySelector('#pazzer-feedback')));
    if(typeof host?.getPazzerDevices!=='function'){
      if(host)document.querySelector('#pazzer-devices').firstElementChild.textContent='Open Pazzer settings to view connected hardware';
      return;
    }
    try{
      const devices=await host.getPazzerDevices();const list=document.querySelector('#pazzer-devices');if(!list)return;list.replaceChildren();
      if(!Array.isArray(devices)||!devices.length){const li=document.createElement('li');li.textContent='No Pazzer hardware connected';list.append(li);return;}
      for(const device of devices){const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');name.textContent=device.name||'Pazzer device';state.className='device-state';state.textContent=device.connected?'Connected':'Disconnected';li.append(name,state);list.append(li);}
    }catch{const li=document.querySelector('#pazzer-devices li');if(li)li.textContent='Unable to read connected hardware';}
  }
  const brightnessRange=document.querySelector('#quick-brightness-range');
  function setBrightness(value){
    brightness=Math.max(20,Math.min(100,Number(value)||100));
    const dimmer=document.querySelector('#screen-dimmer'),opacity=String((100-brightness)/125);
    dimmer.style.opacity=opacity;
    document.querySelector('#quick-brightness-value').textContent=`${brightness}%`;
    document.querySelector('#quick-brightness-status').textContent=`${brightness}%`;
    if(typeof deviceHost()?.setBrightness==='function'){
      try{Promise.resolve(deviceHost().setBrightness(brightness)).then(()=>{dimmer.style.opacity='0';}).catch(()=>{});}catch{}
    }
  }
  brightnessRange.addEventListener('input',event=>setBrightness(event.target.value));

  const camera=document.querySelector('#camera-dialog');
  const video=document.querySelector('#camera-video'),photo=document.querySelector('#camera-photo'),message=document.querySelector('#camera-message');
  function stopCamera(){cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;video.srcObject=null;}
  function resetPhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;photo.hidden=true;photo.removeAttribute('src');document.querySelector('#camera-save').hidden=true;document.querySelector('#camera-retake').hidden=true;}
  async function startCamera(){
    message.hidden=false;message.textContent='Opening camera…';resetPhoto();stopCamera();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera is not available in this preview. Open RESTRO on a supported device to take photos.');
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(!camera.open){stopCamera();return;}
      video.srcObject=cameraStream;await video.play();video.hidden=false;message.hidden=true;
      document.querySelector('#camera-start').hidden=true;document.querySelector('#camera-capture').hidden=false;
    }catch(error){stopCamera();video.hidden=true;message.textContent=error.name==='NotAllowedError'?'Camera access is off. Allow access in your device settings, then try again.':error.message||'Unable to open the camera.';document.querySelector('#camera-start').hidden=false;document.querySelector('#camera-capture').hidden=true;}
  }
  function openCamera(){drawer.close();resetPhoto();video.hidden=true;message.hidden=false;message.textContent='Open the camera to take a photo.';document.querySelector('#camera-start').hidden=false;document.querySelector('#camera-capture').hidden=true;camera.showModal();startCamera();}
  document.querySelector('#camera-start').addEventListener('click',startCamera);
  document.querySelector('#camera-retake').addEventListener('click',startCamera);
  document.querySelector('#camera-capture').addEventListener('click',()=>{
    if(!video.videoWidth)return;
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
    canvas.toBlob(blob=>{
      if(!blob||!camera.open)return;
      resetPhoto();photoUrl=URL.createObjectURL(blob);photo.src=photoUrl;photo.hidden=false;video.hidden=true;stopCamera();
      document.querySelector('#camera-capture').hidden=true;document.querySelector('#camera-retake').hidden=false;
      const save=document.querySelector('#camera-save');save.href=photoUrl;save.hidden=false;
    },'image/jpeg',.95);
  });
  camera.addEventListener('close',()=>{stopCamera();resetPhoto();});

  // Arithmetic parser: numbers, unary signs, +, -, *, /. No dynamic code evaluation.
  function calculate(expression){
    const tokens=expression.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+\-]?\d+)?|[+\-*/]/g);
    if(!tokens||tokens.join('')!==expression)throw new Error('Invalid calculation');
    let index=0;
    function number(){let sign=1;while(tokens[index]==='+'||tokens[index]==='-'){if(tokens[index++]==='-')sign*=-1;}const value=Number(tokens[index++]);if(!Number.isFinite(value))throw new Error('Invalid calculation');return sign*value;}
    function term(){let value=number();while(tokens[index]==='*'||tokens[index]==='/'){const op=tokens[index++],right=number();if(op==='/'&&right===0)throw new Error('Cannot divide by zero');value=op==='*'?value*right:value/right;}return value;}
    let value=term();while(index<tokens.length){const op=tokens[index++];if(op!=='+'&&op!=='-')throw new Error('Invalid calculation');const right=term();value=op==='+'?value+right:value-right;}
    if(!Number.isFinite(value))throw new Error('Result too large');return Number(value.toPrecision(12));
  }
  let expression='0',calculated=false,calcError=false;
  const calculator=document.querySelector('#calculator-dialog'),display=document.querySelector('#calculator-display');
  function calcInput(key){
    if(key==='clear'){expression='0';calculated=false;calcError=false;}
    else if(key==='backspace'){expression=calcError?'0':expression.slice(0,-1)||'0';calculated=false;calcError=false;}
    else if(key==='='){
      try{expression=String(calculate(expression));calculated=true;calcError=false;}catch(error){display.textContent=error.message;calcError=true;return;}
    }else if(key==='sign'||key==='percent'){
      if(calcError)return;
      const match=expression.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+\-]?\d+)?$/);if(!match)return;
      let start=match.index,value=Number(match[0]);
      if(key==='sign'){
        const unaryMinus=expression[start-1]==='-'&&(start===1||/[+\-*/]/.test(expression[start-2]));
        if(unaryMinus){start--;value=-value;}
        value=-value;
      }else value/=100;
      expression=expression.slice(0,start)+(key==='sign'&&Object.is(value,-0)?'-0':String(Number(value.toPrecision(12))));calculated=false;
    }else if(/^[+\-*/]$/.test(key)){
      if(calcError)return;
      expression=expression.replace(/[+\-*/]+$/,'')+key;calculated=false;
    }else if(/^[0-9.]$/.test(key)){
      if(calculated||calcError){expression='0';calculated=false;calcError=false;}
      const current=expression.match(/\d*\.?\d*$/)[0];
      if(key==='.'&&current.includes('.'))return;
      if(expression.length>=48)return;
      if(key==='.'&&!current)expression+='0.';
      else if(key!=='.'&&current==='0')expression=expression.slice(0,-1)+key;
      else expression+=key;
    }
    display.textContent=expression.replaceAll('*','×').replaceAll('/','÷');
    display.scrollLeft=display.scrollWidth;
  }
  document.querySelectorAll('[data-calc]').forEach(button=>button.addEventListener('click',()=>calcInput(button.dataset.calc)));
  calculator.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    let key=event.key;if(key==='Enter')key='=';if(key==='Backspace')key='backspace';if(key==='Delete')key='clear';if(key==='%')key='percent';
    if(/^[0-9.+\-*/=]$/.test(key)||['backspace','clear','percent'].includes(key)){event.preventDefault();calcInput(key);}
  });
  drawer.querySelectorAll('[data-control]').forEach(button=>button.addEventListener('click',()=>{
    switch(button.dataset.control){
      case 'wifi':networkSettings();break;
      case 'bluetooth':bluetoothSettings();break;
      case 'pazzer':pazzerSettings();break;
      case 'camera':openCamera();break;
      case 'brightness':brightnessRange.focus();break;
      case 'calculator':drawer.close();calculator.showModal();break;
      case 'settings':drawer.close();openSettings();break;
    }
  }));
})();
