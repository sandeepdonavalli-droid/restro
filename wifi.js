'use strict';
// Wi-Fi: list nearby networks, join, disconnect.
// Browsers have no Wi-Fi API, so no website can list or join networks. The RESTRO
// Android app supplies that through window.RESTRODevice.wifi (optional):
//   { isEnabled(), setEnabled(on)?, scan() -> [{ ssid, level 0-4, secure, connected, saved }],
//     connect(ssid, password?) -> true/false, disconnect(), forget(ssid)? }
// The status bar icon reads signal level from RESTRODevice connectivity updates.
// In a browser, "Show Wi-Fi icon" turns on clearly labelled sample networks so the
// screens and status bar icon can be tested.
(() => {
  const SAMPLE = [
    { ssid: 'Restaurant-Staff', level: 4, secure: true },
    { ssid: 'Restaurant-Guest', level: 3, secure: false },
    { ssid: 'Kitchen-Printer', level: 2, secure: true },
    { ssid: 'Cafe Next Door', level: 1, secure: true }
  ];
  let networks = [], scanning = false, message = '', panel = null, open = null, enabled = true;
  let sampleConnected = null;

  const host = () => window.RESTRODevice?.wifi;
  const hasHost = () => typeof host()?.scan === 'function' && typeof host()?.connect === 'function';
  const preview = () => Boolean(window.RestroConnectivity?.getStatus?.().wifiPreviewEnabled) && !hasHost();

  function say(text) { message = text; render(); }
  function changed() { window.dispatchEvent(new CustomEvent('restro:wifi-changed')); render(); }

  async function scan() {
    if (hasHost()) {
      scanning = true; say('Searching for networks…');
      try {
        if (typeof host().isEnabled === 'function') enabled = (await host().isEnabled()) !== false;
        if (!enabled) { scanning = false; say('Wi-Fi is off.'); return; }
        const found = await host().scan();
        networks = (Array.isArray(found) ? found : []).filter(n => n?.ssid)
          .map(n => ({ ssid: String(n.ssid), level: Math.max(0, Math.min(4, Math.round(Number(n.level) || 0))), secure: n.secure !== false, connected: Boolean(n.connected), saved: Boolean(n.saved) }))
          .sort((a, b) => b.connected - a.connected || b.level - a.level);
        scanning = false; say(networks.length ? '' : 'No networks found.');
      } catch (error) { scanning = false; say(error?.message || 'Couldn’t search for networks.'); }
      return;
    }
    if (preview()) {
      networks = SAMPLE.map(n => ({ ...n, connected: n.ssid === sampleConnected, saved: n.ssid === sampleConnected }));
      say('');
    } else { networks = []; render(); }
  }

  async function join(ssid, password) {
    const network = networks.find(n => n.ssid === ssid); if (!network) return;
    if (network.secure && !network.saved && !password) { say('Enter the Wi-Fi password.'); return; }
    say(`Connecting to ${ssid}…`);
    if (hasHost()) {
      try {
        const ok = await host().connect(ssid, password || undefined);
        if (ok === false) throw new Error('Couldn’t connect. Check the password and try again.');
        open = null; message = `Connected to ${ssid}.`;
        await window.RestroConnectivity?.refresh?.(); await scan(); changed();
      } catch (error) { say(error?.message || 'Couldn’t connect. Check the password and try again.'); }
      return;
    }
    // Sample network: only changes what the preview shows.
    sampleConnected = ssid; open = null;
    window.RestroConnectivity?.setWifiPreview?.(true, network.level);
    message = `Sample connection to ${ssid}. This is a preview; your device’s real Wi-Fi is unchanged.`;
    await scan(); changed();
  }

  async function leave(ssid) {
    if (hasHost()) {
      try { await host().disconnect(); message = `Disconnected from ${ssid}.`; await window.RestroConnectivity?.refresh?.(); await scan(); changed(); }
      catch (error) { say(error?.message || 'Couldn’t disconnect.'); }
      return;
    }
    sampleConnected = null; window.RestroConnectivity?.setWifiPreview?.(true, 4);
    message = 'Sample network disconnected.'; await scan(); changed();
  }

  // On/off. Android app: real Wi-Fi radio. Browser: turns the labelled preview on/off.
  const isOn = () => hasHost() ? enabled : preview();
  const canToggle = () => hasHost() ? typeof host().setEnabled === 'function' : window.RestroConnectivity?.getStatus?.().source !== 'native';
  async function setEnabled(on) {
    if (!canToggle()) return;
    if (!hasHost()) {
      if (!on) { sampleConnected = null; networks = []; }
      message = on ? '' : 'Wi-Fi preview is off.';
      window.RestroConnectivity?.setWifiPreview?.(on); changed(); return;
    }
    try { await host().setEnabled(on); enabled = on; networks = []; if (on) await scan(); else say('Wi-Fi is off.'); window.RestroConnectivity?.refresh?.(); changed(); }
    catch (error) { say(error?.message || 'Couldn’t change Wi-Fi.'); changed(); }
  }

  // ---------- Rendering ----------
  function masterSwitch(title, detail, checked, enabledSwitch, onChange) {
    const label = document.createElement('label'); label.className = 'radio-master' + (checked ? ' on' : '');
    label.innerHTML = '<span class="radio-master-copy"><strong></strong><span></span></span><input type="checkbox" class="settings-switch" role="switch">';
    label.querySelector('strong').textContent = title; label.querySelector('.radio-master-copy span').textContent = detail;
    const input = label.querySelector('input'); input.checked = checked; input.disabled = !enabledSwitch;
    input.addEventListener('change', () => onChange(input.checked));
    return label;
  }
  function signalIcon(level, secure) {
    const arcs = [
      '<circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none" data-l="1"/>',
      '<path d="M9 15a5 5 0 0 1 6 0" data-l="2"/>',
      '<path d="M5.5 11.5a11 11 0 0 1 13 0" data-l="3"/>',
      '<path d="M2 8a17 17 0 0 1 20 0" data-l="4"/>'
    ].map((shape, i) => shape.replace('data-l', `class="${i < level ? 'on' : 'off'}" data-l`)).join('');
    const lock = secure ? '<g class="wifi-lock"><rect x="15.5" y="15.5" width="7" height="6" rx="1.2"/><path d="M17 15.5v-1.2a2 2 0 0 1 4 0v1.2"/></g>' : '';
    return `<svg class="wifi-signal" viewBox="0 0 24 24" aria-hidden="true">${arcs}${lock}</svg>`;
  }
  const strength = level => ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'][level] || '';

  function networkRow(network) {
    const li = document.createElement('li'); li.className = 'wifi-network' + (network.connected ? ' connected' : '');
    const row = document.createElement('button'); row.type = 'button'; row.className = 'wifi-network-row';
    row.setAttribute('aria-expanded', String(open === network.ssid));
    row.innerHTML = `<span class="wifi-network-icon">${signalIcon(network.level, network.secure)}</span><span class="wifi-network-copy"><strong></strong><span></span></span>`;
    row.querySelector('strong').textContent = network.ssid;
    row.querySelector('.wifi-network-copy span').textContent = network.connected ? 'Connected' : [network.saved ? 'Saved' : '', network.secure ? 'Secured' : 'Open', strength(network.level)].filter(Boolean).join(' · ');
    row.addEventListener('click', () => { open = open === network.ssid ? null : network.ssid; message = ''; render(); });
    li.append(row);
    if (open === network.ssid) {
      const form = document.createElement('form'); form.className = 'wifi-join';
      if (network.connected) {
        form.innerHTML = '<button type="submit" class="bt-action">Disconnect</button>';
        form.addEventListener('submit', event => { event.preventDefault(); leave(network.ssid); });
      } else {
        const needsPassword = network.secure && !network.saved;
        form.innerHTML = `${needsPassword ? '<label class="visually-hidden" for="wifi-password">Password</label><input id="wifi-password" type="password" autocomplete="off" placeholder="Password" minlength="8" required>' : ''}<button type="button" class="bt-action wifi-cancel">Cancel</button><button type="submit" class="bt-action bt-action-primary">Connect</button>`;
        form.querySelector('.wifi-cancel').addEventListener('click', () => { open = null; render(); });
        form.addEventListener('submit', event => { event.preventDefault(); join(network.ssid, form.querySelector('#wifi-password')?.value); });
      }
      li.append(form);
      setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }));
    }
    return li;
  }

  function render() {
    if (!panel?.isConnected) return;
    const root = document.createElement('div'); root.className = 'wifi-panel-inner';
    const current = networks.find(n => n.connected);
    const status = window.RestroConnectivity?.getStatus?.();

    const head = document.createElement('div'); head.className = 'bt-head';
    head.innerHTML = `<span class="bt-head-icon">${signalIcon(current ? current.level : 4, false)}</span><span class="bt-head-copy"><strong>Wi-Fi</strong><span></span></span>`;
    head.querySelector('.bt-head-copy span').textContent = current ? `Connected to ${current.ssid}${preview() ? ' (sample)' : ''}`
      : hasHost() ? (enabled ? 'Not connected' : 'Off')
      : status?.wifi?.connected ? 'Connected (network name not shared by this browser)' : 'Managed by this device';
    root.append(masterSwitch('Use Wi-Fi', hasHost() ? (enabled ? 'On' : 'Off') : 'Preview · your device’s real Wi-Fi is unchanged', isOn(), canToggle(), setEnabled));
    if (!isOn() && hasHost()) { panel.replaceChildren(root); return; }
    if (hasHost() || preview()) {
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'primary-button bt-scan';
      refresh.textContent = scanning ? 'Searching…' : 'Scan'; refresh.disabled = scanning || !enabled;
      refresh.addEventListener('click', scan); head.append(refresh);
    }
    root.append(head);

    const note = document.createElement('p'); note.className = 'bt-message'; note.setAttribute('role', 'status');
    note.textContent = message || (hasHost() ? (networks.length ? 'Tap a network to connect.' : '')
      : preview() ? 'Sample networks for testing the screens and status bar icon. Your device’s real Wi-Fi is unchanged.'
      : 'Web browsers can’t switch, search for or join Wi-Fi networks, on any website, so this device’s own settings manage its Wi-Fi. In the RESTRO Android app, this switch turns Wi-Fi on and off and nearby networks are listed here. Turn on Use Wi-Fi to preview these screens with sample networks.');
    if (note.textContent) root.append(note);

    if (hasHost() || preview()) {
      const section = document.createElement('section'); section.className = 'bt-section';
      const heading = document.createElement('h4'); heading.textContent = preview() ? 'Available networks · sample' : 'Available networks'; section.append(heading);
      const ul = document.createElement('ul'); ul.className = 'bt-list wifi-list';
      if (!networks.length) { const li = document.createElement('li'); li.className = 'bt-empty'; li.textContent = scanning ? 'Looking for networks…' : 'Tap Scan to find networks'; ul.append(li); }
      else networks.forEach(n => ul.append(networkRow(n)));
      section.append(ul); root.append(section);
    }
    if (typeof window.RESTRODevice?.openSettings === 'function') {
      const advanced = document.createElement('button'); advanced.type = 'button'; advanced.className = 'bt-action wifi-advanced'; advanced.textContent = 'Open Android Wi-Fi settings';
      advanced.addEventListener('click', async () => { try { await window.RESTRODevice.openSettings('wifi'); } catch {} });
      root.append(advanced);
    }
    panel.replaceChildren(root);
  }

  window.addEventListener('restro:connectivity-changed', () => {
    if (!panel?.isConnected) return;
    if (!preview() && !hasHost() && networks.length) { networks = []; sampleConnected = null; }
    if (preview() && !networks.length) scan(); else render();
  });

  (async () => { try { if (hasHost() && typeof host().isEnabled === 'function') { enabled = (await host().isEnabled()) !== false; changed(); } } catch {} })();
  window.RestroWifi = Object.freeze({
    get on() { return isOn(); },
    get canToggle() { return canToggle(); },
    get isPreview() { return !hasHost(); },
    setOn: setEnabled,
    mount(container) { panel = container; message = ''; open = null; render(); scan(); },
    get sampleNetwork() { return sampleConnected; }
  });
})();
