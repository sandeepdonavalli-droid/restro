'use strict';
// The battery in the top bar, on every page (Counter Update 5): a pill like the Online pill, with the battery drawn lying
// down (its tip on the right) filled to its level, and its level, "78%" (Settings > Display > Battery: Percentage; or
// Fill, the battery alone). 20% or less and not charging: red on a red pill. Charging: green, with a bolt at the end of
// the fill. As the tablet reports it (the RESTRO Android app's RESTRODevice.getBatteryStatus / subscribeBatteryStatus,
// or the restro:battery-status event), or the browser's own battery; hidden when there is none.
(() => {
  const pill = document.querySelector('.battery-status');
  if (!pill) return;
  const fill = pill.querySelector('.battery-fill'), bolt = pill.querySelector('.battery-bolt'), text = pill.querySelector('.battery-text');
  const FULL = 25, STYLE_KEY = 'restro.battery.style.v1';
  const STYLES = Object.freeze([Object.freeze({ id: 'percentage', name: 'Percentage' }), Object.freeze({ id: 'fill', name: 'Fill' })]);
  let style = (() => { try { const v = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null'); return STYLES.some(s => s.id === v) ? v : 'percentage'; } catch { return 'percentage'; } })();
  let revision = 0, generation = 0, nativeActive = false, battery = null, unsubscribe = null, last = { present: false };
  function normalize(input) {
    let value = input;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
    if (!value || typeof value !== 'object') return null;
    if (value.hasBattery === false) return { present: false };
    const level = typeof value.percentage === 'number' ? value.percentage / 100 : value.level;
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) return null;
    const plugged = typeof value.plugged === 'boolean' ? value.plugged : typeof value.plugged === 'number' && Number.isFinite(value.plugged) && value.plugged >= 0 ? value.plugged > 0 : value.charging;
    if (typeof plugged !== 'boolean') return null;
    return { present: true, level, plugged };
  }
  // The battery's look for a level: the fill (25 long at 100%, at least a sliver while there is any) and where the bolt
  // goes (just past the end of the fill, inside the battery)
  function draw(svgFill, svgBolt, level, plugged) {
    const width = level > 0 ? Math.max(1.6, FULL * level) : 0;
    svgFill.setAttribute('width', String(Math.round(width * 100) / 100));
    if (!svgBolt) return;
    svgBolt.toggleAttribute('hidden', !plugged);
    svgBolt.setAttribute('transform', `translate(${Math.round(Math.min(21.6, Math.max(2.4, 2.5 + width - .8)) * 100) / 100} 2)`);
  }
  function render(state) {
    last = state;
    pill.hidden = !state.present;
    pill.dataset.style = style;
    if (!state.present) {
      delete pill.dataset.batteryState; delete pill.dataset.batteryLevel;
      pill.removeAttribute('aria-label'); pill.removeAttribute('title');
      fill.setAttribute('width', '0'); bolt.setAttribute('hidden', ''); text.textContent = ''; return;
    }
    const pct = Math.round(state.level * 100), kind = state.plugged ? 'charging' : pct <= 20 ? 'low' : 'normal';
    pill.dataset.batteryState = kind; pill.dataset.batteryLevel = String(state.level);
    draw(fill, bolt, state.level, state.plugged);
    text.textContent = `${pct}%`;
    pill.setAttribute('aria-label', `Battery ${pct}%, ${state.plugged ? 'charging' : kind === 'low' ? 'low battery' : 'not charging'}`);
    pill.title = state.plugged ? `Battery ${pct}% · Charging` : kind === 'low' ? `Battery ${pct}% · Low` : `Battery ${pct}%`;
  }
  function update(input) {
    const state = normalize(input); if (!state) return false;
    nativeActive = true; revision++; render(state); return true;
  }
  function readBrowser() {
    if (nativeActive || !battery) return;
    const state = normalize(battery); if (state) { revision++; render(state); }
  }
  function disconnect() {
    try { unsubscribe?.(); } catch {} unsubscribe = null;
    if (battery) { battery.removeEventListener('levelchange', readBrowser); battery.removeEventListener('chargingchange', readBrowser); battery = null; }
  }
  async function refresh() {
    const host = window.RESTRODevice, atRevision = revision, atGeneration = generation;
    if (typeof host?.getBatteryStatus === 'function') {
      try { const status = await host.getBatteryStatus(); if (generation === atGeneration && revision === atRevision) update(status); } catch {}
    } else readBrowser();
  }
  async function connect() {
    const current = ++generation; disconnect(); nativeActive = false; render({ present: false });
    const host = window.RESTRODevice;
    const nativeGetter = typeof host?.getBatteryStatus === 'function', nativeSubscription = typeof host?.subscribeBatteryStatus === 'function';
    if (nativeSubscription) {
      try { const stop = host.subscribeBatteryStatus(status => { if (current === generation) update(status); }); if (typeof stop === 'function') unsubscribe = stop; } catch {}
    }
    if (nativeGetter || nativeSubscription) { await refresh(); return; }
    if (typeof navigator.getBattery !== 'function') return;
    try {
      const manager = await navigator.getBattery(); if (current !== generation) return;
      battery = manager; battery.addEventListener('levelchange', readBrowser); battery.addEventListener('chargingchange', readBrowser); readBrowser();
    } catch {}
  }

  // Settings > Display > Battery: Percentage (the battery and "78%") or Fill (the battery alone). This tablet's choice.
  function setStyle(id) {
    if (!STYLES.some(s => s.id === id)) return false;
    style = id; try { localStorage.setItem(STYLE_KEY, JSON.stringify(id)); } catch {}
    render(last); paintSettings();
    return true;
  }
  // Each choice shows as the pill would (at 78%), beside its name
  function demo(id) {
    const box = document.createElement('span');
    box.className = 'battery-demo'; box.dataset.style = id; box.setAttribute('aria-hidden', 'true');
    const svg = pill.querySelector('svg.battery').cloneNode(true);
    draw(svg.querySelector('.battery-fill'), svg.querySelector('.battery-bolt'), .78, false);
    const words = document.createElement('span'); words.className = 'battery-text'; words.textContent = '78%';
    box.append(svg, words);
    return box;
  }
  function buildSettings() {
    const list = document.getElementById('settings-battery-styles'); if (!list) return;
    list.replaceChildren();
    for (const s of STYLES) {
      const label = document.createElement('label'); label.className = 'settings-item battery-style';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'battery-style'; input.value = s.id; input.id = `battery-style-${s.id}`;
      input.addEventListener('change', () => { if (input.checked) setStyle(s.id); });
      const copy = document.createElement('span'); copy.className = 'settings-row-copy';
      const name = document.createElement('strong'); name.textContent = s.name; copy.append(name);
      label.append(input, copy, demo(s.id));
      list.append(label);
    }
    paintSettings();
  }
  function paintSettings() { document.querySelectorAll('input[name="battery-style"]').forEach(input => { input.checked = input.value === style; }); }

  window.RestroBattery = Object.freeze({ update, refresh, setStyle, styles: STYLES, get style() { return STYLES.find(s => s.id === style); } });
  window.addEventListener('restro:battery-status', event => update(event.detail));
  window.addEventListener('restro:device-ready', connect);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => { generation++; disconnect(); }, { once: true });
  render({ present: false }); connect();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildSettings); else buildSettings();
})();
