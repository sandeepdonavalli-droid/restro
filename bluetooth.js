'use strict';
// Bluetooth: scan, list, connect and disconnect.
// - In the RESTRO Android app, window.RESTRODevice.bluetooth (optional) supplies
//   a full device scan: { isEnabled(), startScan(onDevice) -> stop(), connect(id),
//   disconnect(id), getPairedDevices() }. Devices are { id, name, connected, rssi }.
// - In a web browser (Chrome / Edge) it uses Web Bluetooth. Browsers show nearby
//   devices in their own picker; where the browser allows live scanning, nearby
//   devices are also listed here.
(() => {
  const KNOWN_KEY = 'restro.bluetooth.known.v1';
  const SERVICES = ['battery_service', 'device_information', 'generic_access'];
  const connected = new Map();   // id -> { id, name, device? }
  const available = new Map();   // id -> { id, name, rssi, device? }
  let known = [];                // [{ id, name }] devices used before
  let scanning = false, stopScan = null, message = '', panel = null;

  try { const saved = JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]'); if (Array.isArray(saved)) known = saved.filter(d => d && d.id); } catch {}

  const host = () => window.RESTRODevice?.bluetooth;
  const hasHost = () => typeof host()?.startScan === 'function' && typeof host()?.connect === 'function';
  const web = () => navigator.bluetooth;
  const canLiveScan = () => typeof web()?.requestLEScan === 'function';

  function save() { try { localStorage.setItem(KNOWN_KEY, JSON.stringify(known.slice(0, 12))); } catch {} }
  function remember(id, name) {
    known = [{ id, name: name || 'Bluetooth device' }, ...known.filter(d => d.id !== id)];
    save();
  }
  function changed() {
    window.dispatchEvent(new CustomEvent('restro:bluetooth-changed', { detail: { connected: connected.size } }));
    render();
  }
  function say(text) { message = text; render(); }

  // Why Bluetooth cannot be used here, or '' when it can.
  async function blocker() {
    if (hasHost()) {
      try { if (typeof host().isEnabled === 'function' && await host().isEnabled() === false) return 'Bluetooth is off. Turn it on in device settings.'; } catch {}
      return '';
    }
    if (!web()) return 'This browser can’t use Bluetooth. Open RESTRO in Chrome or Edge on Android, Windows, macOS or ChromeOS. Safari, iPhone, iPad and Firefox don’t support it.';
    if (!window.isSecureContext) return 'Bluetooth needs a secure (https) page.';
    const policy = document.permissionsPolicy || document.featurePolicy;
    const knowsBluetooth = typeof policy?.features === 'function' && policy.features().includes('bluetooth');
    if (knowsBluetooth && !policy.allowsFeature('bluetooth')) return 'Bluetooth is blocked inside this preview. Open your RESTRO website directly in Chrome or Edge to connect devices.';
    try { if (typeof web().getAvailability === 'function' && !(await web().getAvailability())) return 'Bluetooth is off, or this device has no Bluetooth. Turn it on and try again.'; } catch {}
    return '';
  }

  function webError(error) {
    if (error?.name === 'NotFoundError') return /adapter|unavailable/i.test(error.message || '') ? 'Bluetooth is off, or this device has no Bluetooth. Turn it on and try again.' : 'No device selected.';
    if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return 'Bluetooth is blocked on this page. Open your RESTRO website directly in Chrome or Edge.';
    if (error?.name === 'NetworkError') return 'Couldn’t connect. Make sure the device is on, nearby and not connected to another phone.';
    return error?.message || 'Couldn’t connect. Try again.';
  }

  async function connectWebDevice(device) {
    if (!device.gatt) throw new Error('This device can’t be connected from a browser. Pair it from the RESTRO Android device instead.');
    await device.gatt.connect();
    const entry = { id: device.id, name: device.name || 'Bluetooth device', device };
    connected.set(device.id, entry); available.delete(device.id); remember(device.id, entry.name);
    device.addEventListener('gattserverdisconnected', () => { connected.delete(device.id); changed(); }, { once: true });
    message = `${entry.name} connected.`; changed();
  }

  // Opens the browser's list of nearby devices (optionally only one by name).
  async function pickWebDevice(name) {
    const options = name ? { filters: [{ name }], optionalServices: SERVICES } : { acceptAllDevices: true, optionalServices: SERVICES };
    const device = await web().requestDevice(options);
    say(`Connecting to ${device.name || 'device'}…`);
    await connectWebDevice(device);
  }

  async function scan() {
    const reason = await blocker(); if (reason) { say(reason); return; }
    if (hasHost()) {
      available.clear(); scanning = true; say('Searching for nearby devices…');
      try {
        stopScan?.();
        stopScan = await host().startScan(device => {
          if (!device?.id || connected.has(device.id)) return;
          available.set(device.id, { id: device.id, name: device.name || 'Unnamed device', rssi: device.rssi });
          render();
        });
        setTimeout(finishScan, 15000);
      } catch (error) { scanning = false; say(error?.message || 'Couldn’t search for devices.'); }
      return;
    }
    if (canLiveScan()) {
      try {
        available.clear(); scanning = true; say('Searching for nearby devices…');
        const scanHandle = await web().requestLEScan({ acceptAllAdvertisements: true });
        const seen = event => {
          const id = event.device?.id; if (!id || connected.has(id)) return;
          available.set(id, { id, name: event.name || event.device.name || 'Unnamed device', rssi: event.rssi, device: event.device });
          render();
        };
        web().addEventListener('advertisementreceived', seen);
        stopScan = () => { web().removeEventListener('advertisementreceived', seen); if (scanHandle.active) scanHandle.stop(); };
        setTimeout(finishScan, 15000);
        return;
      } catch { scanning = false; /* fall back to the browser's picker */ }
    }
    try { say('Choose a device from the list your browser shows.'); await pickWebDevice(); }
    catch (error) { say(webError(error)); }
  }
  function finishScan() {
    if (!scanning) return;
    scanning = false; stopScan?.(); stopScan = null;
    say(available.size ? `${available.size} device${available.size === 1 ? '' : 's'} found.` : 'No devices found. Make sure the device is on and in pairing mode.');
  }

  async function connect(id) {
    const entry = available.get(id) || known.find(d => d.id === id);
    if (!entry) return;
    say(`Connecting to ${entry.name}…`);
    try {
      if (hasHost()) {
        await host().connect(id);
        connected.set(id, { id, name: entry.name }); available.delete(id); remember(id, entry.name);
        message = `${entry.name} connected.`; changed(); return;
      }
      // Devices this site may already use reconnect without the picker.
      const permitted = typeof web()?.getDevices === 'function' ? (await web().getDevices()).find(d => d.id === id) : null;
      if (permitted) await connectWebDevice(permitted);
      else await pickWebDevice(entry.name && entry.name !== 'Unnamed device' ? entry.name : undefined);
    } catch (error) { say(hasHost() ? (error?.message || 'Couldn’t connect. Try again.') : webError(error)); }
  }

  async function disconnect(id) {
    const entry = connected.get(id); if (!entry) return;
    try {
      if (hasHost()) await host().disconnect(id);
      else entry.device?.gatt?.disconnect();
    } catch {}
    connected.delete(id); message = `${entry.name} disconnected.`; changed();
  }
  function forget(id) {
    known = known.filter(d => d.id !== id); save();
    if (!hasHost() && typeof web()?.getDevices === 'function') web().getDevices().then(list => list.find(d => d.id === id)?.forget?.()).catch(() => {});
    render();
  }

  // ---------- Rendering ----------
  const bluetoothIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10-5 4.5V2.5L17 7 7 17"/></svg>';
  function item(entry, actions, detail) {
    const li = document.createElement('li'); li.className = 'bt-device';
    const icon = document.createElement('span'); icon.className = 'bt-device-icon'; icon.innerHTML = bluetoothIcon;
    const copy = document.createElement('span'); copy.className = 'bt-device-copy';
    const name = document.createElement('strong'); name.textContent = entry.name;
    copy.append(name);
    if (detail) { const small = document.createElement('span'); small.textContent = detail; copy.append(small); }
    li.append(icon, copy);
    for (const [label, handler, kind] of actions) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = kind === 'primary' ? 'bt-action bt-action-primary' : 'bt-action';
      button.textContent = label; button.addEventListener('click', handler); li.append(button);
    }
    return li;
  }
  function list(title, entries, empty) {
    const section = document.createElement('section'); section.className = 'bt-section';
    const heading = document.createElement('h4'); heading.textContent = title; section.append(heading);
    const ul = document.createElement('ul'); ul.className = 'bt-list';
    if (!entries.length) { const li = document.createElement('li'); li.className = 'bt-empty'; li.textContent = empty; ul.append(li); }
    else entries.forEach(entry => ul.append(entry));
    section.append(ul); return section;
  }
  const signal = rssi => typeof rssi === 'number' ? (rssi > -60 ? 'Strong signal' : rssi > -80 ? 'Good signal' : 'Weak signal') : 'Available';

  async function render() {
    if (!panel?.isConnected) return;
    const reason = await blocker();
    const root = document.createElement('div'); root.className = 'bt-panel-inner';

    const head = document.createElement('div'); head.className = 'bt-head';
    head.innerHTML = `<span class="bt-head-icon">${bluetoothIcon}</span><span class="bt-head-copy"><strong>Bluetooth</strong><span></span></span>`;
    head.querySelector('.bt-head-copy span').textContent = reason ? 'Unavailable here' : connected.size ? `${connected.size} connected` : 'Ready to connect';
    const scanButton = document.createElement('button'); scanButton.type = 'button'; scanButton.className = 'primary-button bt-scan';
    scanButton.textContent = scanning ? 'Stop' : hasHost() || canLiveScan() ? 'Scan for devices' : 'Pair new device';
    scanButton.disabled = Boolean(reason) && !scanning;
    scanButton.addEventListener('click', () => scanning ? finishScan() : scan());
    head.append(scanButton); root.append(head);

    const note = document.createElement('p'); note.className = 'bt-message'; note.setAttribute('role', 'status');
    note.textContent = reason || message || (hasHost() || canLiveScan() ? 'Scan to list nearby devices, then tap Connect.' : 'Tap Pair new device. Your browser lists the devices nearby; choose one to connect.');
    root.append(note);

    root.append(list('Connected', [...connected.values()].map(d => item(d, [['Disconnect', () => disconnect(d.id)]], 'Connected')), 'No devices connected'));
    if (hasHost() || canLiveScan() || available.size) {
      root.append(list(scanning ? 'Available devices · searching…' : 'Available devices',
        [...available.values()].map(d => item(d, [['Connect', () => connect(d.id), 'primary']], signal(d.rssi))),
        scanning ? 'Looking for devices…' : 'Tap Scan for devices'));
    }
    const previous = known.filter(d => !connected.has(d.id));
    if (previous.length) root.append(list('Previously connected', previous.map(d => item(d, [['Connect', () => connect(d.id), 'primary'], ['Forget', () => forget(d.id)]])), ''));

    panel.replaceChildren(root);
  }

  // Load devices the Android app already knows about.
  async function loadPaired() {
    if (!hasHost() || typeof host().getPairedDevices !== 'function') return;
    try {
      for (const d of await host().getPairedDevices() || []) {
        if (!d?.id) continue;
        if (!known.some(k => k.id === d.id)) known.push({ id: d.id, name: d.name || 'Bluetooth device' });
        if (d.connected) connected.set(d.id, { id: d.id, name: d.name || 'Bluetooth device' });
      }
      save(); changed();
    } catch {}
  }

  window.RestroBluetooth = Object.freeze({
    mount(container) { panel = container; message = ''; render(); loadPaired(); },
    get connectedCount() { return connected.size; }
  });
})();
