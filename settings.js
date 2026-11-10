'use strict';
// Settings (Update Pack 9 Nov 2026: the look of Display › Navigation, N6/N7, on every page). The categories on the left
// beside the page chosen on tablets, one column with a back arrow on narrow screens. Each page has a breadcrumb over
// its title ("Settings", or "Settings › Display" on a page inside another) and its settings in cards.
// New in this update: Business details (printed on the bill), Billing & charges, Staff & security (auto-lock), Display ›
// Navigation (swipe gestures or the navigation bar, button order, Go dark) and Devices & sync › each printer (role, KOT
// language, copies). Their values are kept by prefs.js.
(() => {
  const dialog = document.querySelector('#settings-dialog');
  const shell = dialog.querySelector('.settings-shell');
  const nav = dialog.querySelector('.settings-nav');
  const pageTitle = document.querySelector('#settings-page-title');
  const crumb = document.querySelector('#settings-crumb');
  const back = document.querySelector('#settings-back');
  const search = document.querySelector('#settings-search');
  const noResults = document.querySelector('#settings-no-results');
  const entries = [...nav.querySelectorAll('[data-page]')];
  const pages = new Map([...dialog.querySelectorAll('.settings-page')].map(page => [page.dataset.page, page]));
  const twoPane = window.matchMedia('(min-width: 760px)');
  const toastNode = document.querySelector('#toast');
  const toastHome = toastNode.parentElement;
  const Prefs = window.RestroPrefs;
  let current = 'restaurant';

  // ---------- tiny DOM helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const ms = (name, cls = 'ms') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = `<use href="#${name}"/>`; return s; };
  const line = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = path; return s; };
  const X = '<path d="m7 7 10 10M17 7 7 17"/>';
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };
  const card = (cls, ...children) => el('div', { class: `st-card${cls ? ` ${cls}` : ''}` }, ...children);
  const lab = (text, id) => el('p', { class: 'st-lab', id }, text);
  const sub = text => el('p', { class: 'st-sub' }, text);
  const note = text => el('p', { class: 'st-note' }, text);
  // A row with a switch at its end
  const switchRow = (id, title, detail, on, change) => el('label', { class: 'st-row', for: id },
    el('span', { class: 'st-row-copy' }, el('strong', {}, title), detail ? el('span', {}, detail) : null),
    el('input', { id, class: 'st-switch', type: 'checkbox', role: 'switch', checked: on, onchange: e => change(e.target.checked) }));
  // Choice tiles, one of them on (role radio); arrow keys move along them
  function tiles(label, choices, value, pick, { tall = false, disabled = false } = {}) {
    const group = el('div', { class: 'st-sgs', role: 'radiogroup', 'aria-label': label });
    choices.forEach(c => group.append(el('button', { type: 'button', class: `st-sg${tall ? ' tall' : ''}`, role: 'radio', 'aria-checked': String(c.value === value), tabindex: c.value === value ? '0' : '-1', disabled,
      'aria-label': c.aria || null, onclick: () => pick(c.value) }, ...(Array.isArray(c.label) ? c.label : [c.label]))));
    group.addEventListener('keydown', e => {
      const i = choices.findIndex(c => c.value === value), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d || disabled) return; e.preventDefault();
      const next = choices[(i + d + choices.length) % choices.length]; pick(next.value);
      requestAnimationFrame(() => document.querySelector(`[aria-label="${label}"] [aria-checked="true"]`)?.focus({ preventScroll: true }));
    });
    return group;
  }
  // A list the restaurant edits: its items as pills with ✕, and a field to add one more
  function chips({ id, label, items, text = v => String(v), parse, placeholder, inputmode = 'text', max = 12, change }) {
    const field = el('input', { id, type: 'text', inputmode, maxlength: inputmode === 'decimal' ? '5' : '40', placeholder, autocomplete: 'off', 'aria-label': `Add to ${label}` });
    const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const add = () => {
      const value = parse(field.value);
      if (value == null) { error.textContent = field.value.trim() ? `Can’t add “${field.value.trim()}”.` : 'Type something to add.'; error.hidden = false; return; }
      if (items.some(v => text(v).toLowerCase() === text(value).toLowerCase())) { error.textContent = `${text(value)} is already there.`; error.hidden = false; return; }
      if (items.length >= max) { error.textContent = `Up to ${max}.`; error.hidden = false; return; }
      error.hidden = true; field.value = ''; change([...items, value], true);
    };
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    field.addEventListener('input', () => { error.hidden = true; });
    return el('div', { class: 'st-chiplist' },
      el('div', { class: 'st-chips', role: 'list', 'aria-label': label }, items.map(v =>
        el('span', { class: 'st-chip', role: 'listitem' }, text(v), el('button', { type: 'button', 'aria-label': `Remove ${text(v)}`, title: 'Remove', onclick: () => change(items.filter(x => x !== v), false) }, line(X))))),
      el('div', { class: 'st-add' }, field, el('button', { type: 'button', class: 'st-secondary', onclick: add }, line('<path d="M12 5v14M5 12h14"/>'), 'Add')), error);
  }
  const pctText = v => `${String(v).replace(/\.0$/, '')}%`;
  const parsePct = (min, max, step) => s => { const n = Number(String(s).replace(/[%\s]/g, '')); if (!Number.isFinite(n) || n < min || n > max) return null; const r = Math.round(n / step) * step; return Math.abs(r - n) > 1e-9 ? null : Math.round(r * 10) / 10; };
  const rupees = v => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  // An amount in rupees (up to 2 decimals) or a percentage, in a field with ₹ before it or % after it
  function amountField({ id, label, value, pct = false, max = 99999, change, disabled = false, hint }) {
    const input = el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: String(value), disabled, 'aria-describedby': `${id}-error${hint ? ` ${id}-hint` : ''}` });
    const error = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: true });
    const commit = () => {
      const t = input.value.trim().replace(/[₹%,\s]/g, ''), n = Number(t);
      if (t === '' || !Number.isFinite(n) || n < 0 || n > max || !/^\d+(\.\d{1,2})?$/.test(t)) { error.textContent = pct ? `Enter a percentage up to ${max}%.` : 'Enter an amount in rupees, like 20 or 12.50.'; error.hidden = false; return; }
      error.hidden = true; if (n !== Number(value)) change(n);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return el('div', { class: 'st-field' }, el('label', { for: id }, label), el('div', { class: `st-money${pct ? ' pct' : ''}` }, el('i', {}, pct ? '%' : '₹'), input),
      hint ? el('p', { class: 'field-note', id: `${id}-hint` }, hint) : null, error);
  }
  // Rebuilds a page's card list, keeping the focus where it was (by id) and the scroll
  function rebuild(host, build) {
    const focused = document.activeElement?.id && host.contains(document.activeElement) ? document.activeElement.id : null;
    const scroller = dialog.querySelector('.settings-pages'), top = scroller.scrollTop;
    host.replaceChildren(...build());
    scroller.scrollTop = top;
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  }

  // ---------- pages ----------
  const isDetailView = () => shell.dataset.view === 'detail';
  const parentOf = id => pages.get(id)?.dataset.parent || null;
  function renderLivePanels(id) {
    const devices = window.RestroDeviceControls;
    if (!devices) return;
    if (id === 'wifi') devices.renderInto('wifi', document.querySelector('#settings-wifi-slot'));
    if (id === 'bluetooth') devices.renderInto('bluetooth', document.querySelector('#settings-bluetooth-slot'));
  }
  const builders = {};
  function show(id, { focus = false } = {}) {
    if (!pages.has(id)) return;
    current = id;
    const parent = parentOf(id), top = parent || id;
    for (const [pageId, page] of pages) page.hidden = pageId !== id;
    pageTitle.textContent = id === 'printer' ? printerName(printerId) : pages.get(id).dataset.title;
    // The breadcrumb: "Settings", or "Settings › Display" (the page it is in, a tap away)
    crumb.replaceChildren('Settings', ...(parent ? [' › ', el('button', { type: 'button', onclick: () => show(parent, { focus: true }) }, pages.get(parent).dataset.title)] : []));
    for (const entry of entries) {
      const selected = entry.dataset.page === top;
      entry.classList.toggle('selected', selected);
      if (selected) entry.setAttribute('aria-current', 'page'); else entry.removeAttribute('aria-current');
    }
    if (id === 'display') window.RestroThemePicker?.reset();
    if (id === 'counter') paintStylePreviews(); else clearStylePreviews();
    if (id === 'business') fillBusiness();
    builders[id]?.();
    renderLivePanels(id);
    dialog.querySelector('.settings-pages').scrollTop = 0;
    if (!twoPane.matches) shell.dataset.view = 'detail';
    if (focus) {
      const target = id === 'business' ? document.querySelector('#restaurant-input') : id === 'restaurant' ? document.querySelector('#profile-email') : null;
      (target || pages.get(id).querySelector('input,button,a') || back)?.focus({ preventScroll: true });
    }
  }
  function showList() {
    shell.dataset.view = 'list';
    nav.querySelector(`[data-page="${parentOf(current) || current}"]`)?.focus({ preventScroll: true });
  }
  function goBack() {
    if (!dialog.open) return false;
    if (search.value) { search.value = ''; filter(); search.focus(); return true; }
    if (parentOf(current)) { show(parentOf(current), { focus: true }); return true; }
    if (!twoPane.matches && isDetailView()) { showList(); return true; }
    return false;
  }
  function reset() {
    search.value = ''; filter();
    window.RestroThemePicker?.reset();
    syncSummaries();
    shell.dataset.view = 'list';
    if (twoPane.matches) show('restaurant');
    else { current = 'restaurant'; for (const [pageId, page] of pages) page.hidden = pageId !== current; }
  }
  function filter() {
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    for (const entry of entries) {
      const text = `${entry.textContent} ${entry.dataset.keywords || ''}`.toLowerCase();
      const match = !query || query.split(/\s+/).every(word => text.includes(word));
      (entry.closest('li') || entry).hidden = !match;
      if (match) matches++;
    }
    noResults.hidden = matches > 0;
  }

  // ---------- the line under each category ----------
  const minutes = n => (n ? `${n} min` : 'Off');
  function syncSummaries() {
    const status = window.RestroConnectivity?.getStatus?.();
    const online = status ? status.internetAvailable : navigator.onLine;
    const through = status?.wifi?.connected ? 'Wi-Fi' : status?.cellular?.connected ? 'Mobile data' : '';
    const sample = status?.preview?.wifi ? window.RestroWifi?.sampleNetwork : null;
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    set('settings-network-summary', (online ? 'Online' : 'Offline') + (through ? ` · ${through}` : ''));
    set('settings-internet-status', online ? 'Connected to the internet' : 'No internet connection');
    set('settings-network-type', through || (status?.source === 'browser' ? 'Not reported by this browser' : 'Not connected'));
    const mobile = document.querySelector('#settings-mobile-row');
    mobile.hidden = !status?.hasCellular;
    if (status?.hasCellular) set('settings-mobile-status', status.cellular.connected ? (status.cellular.level === null ? 'Connected' : `Connected · signal ${status.cellular.level} of 4`) : 'Not connected');
    set('settings-wifi-summary', sample ? `${sample} (sample)` : status?.preview?.wifi ? 'Preview on' : status?.wifi?.connected ? 'Connected' : status?.source === 'browser' ? 'Managed by this device' : 'Not connected');
    const wifi = window.RestroWifi, bt = window.RestroBluetooth;
    if (wifi && !wifi.on && !wifi.isPreview) set('settings-wifi-summary', 'Off');
    const paired = bt?.connectedCount || 0;
    set('settings-bluetooth-summary', bt?.unavailableReason ? 'Not available here' : bt && !bt.on ? 'Off' : paired ? `${paired} connected` : 'On · Not connected');
    const sound = window.RestroSound;
    if (sound) set('settings-sound-summary', sound.volume ? `Volume ${sound.volume}%${sound.touchSounds ? ` · Touch: ${sound.touchStyle.name}` : ''}` : 'Muted');
    const brightness = window.RestroDeviceControls?.brightness ?? 100;
    const navi = Prefs.get('navigation'), dark = Prefs.get('screen').goDark;
    set('settings-display-summary', `Brightness ${brightness}% · ${navi.mode === 'bar' ? 'Navigation bar' : 'Swipe gestures'}`);
    set('settings-navigation-summary', `${navi.mode === 'bar' ? `Navigation bar · Back on the ${navi.order === 'back-right' ? 'right' : 'left'}` : 'Swipe gestures'} · Go dark ${dark ? `after ${dark} min` : 'never'}`);
    set('settings-brightness-value', `${brightness}%`);
    const range = document.querySelector('#settings-brightness-range'); if (range) range.value = String(brightness);
    const { packaging: pk, delivery: dl } = Prefs.get('billing');
    set('settings-billing-summary', `Packaging ${pk.on ? (pk.mode === 'dish' ? 'per dish' : rupees(pk.flat)) : 'off'} · Delivery ${dl.on ? rupees(dl.flat) : 'off'}`);
    const business = Prefs.get('business');
    set('settings-business-summary', business.gstin && business.fssai ? 'GSTIN and FSSAI on the bill' : !business.fssai ? 'Add the FSSAI licence number' : 'Printed on the bill');
    set('settings-security-summary', `Auto-lock ${Prefs.get('security').autoLock ? `after ${Prefs.get('security').autoLock} min` : 'off'}`);
    const profile = window.RestroProfile;
    set('settings-profile-summary', profile?.email || profile?.international || 'Email and mobile number');
  }

  // ---------- My Profile and Business details ----------
  function fillBusiness() {
    const b = Prefs.get('business');
    document.querySelector('#restaurant-input').value = window.RestroRestaurantName?.value || '';
    document.querySelector('#business-address').value = b.address;
    document.querySelector('#business-gstin').value = b.gstin;
    document.querySelector('#business-fssai').value = b.fssai;
    document.querySelector('#business-footer').value = b.footer;
    for (const id of ['business-gstin-error', 'business-fssai-error']) document.getElementById(id).hidden = true;
  }
  const say = (id, message) => { const node = document.getElementById(id); node.textContent = message; node.hidden = !message; };
  document.querySelector('#business-gstin').addEventListener('input', e => { const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); if (v !== e.target.value) e.target.value = v; say('business-gstin-error', ''); });
  document.querySelector('#business-fssai').addEventListener('input', e => { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v; say('business-fssai-error', ''); });
  document.querySelector('#business-form').addEventListener('submit', e => {
    e.preventDefault();
    const gstin = document.querySelector('#business-gstin').value.trim(), fssai = document.querySelector('#business-fssai').value.trim();
    let ok = true;
    if (gstin && !Prefs.gstinOk(gstin)) { say('business-gstin-error', gstin.length !== 15 ? 'A GSTIN has 15 letters and numbers.' : 'This GSTIN doesn’t check out. Look for a typing mistake.'); ok = false; }
    if (fssai && !Prefs.fssaiOk(fssai)) { say('business-fssai-error', 'An FSSAI number has 14 digits.'); ok = false; }
    if (!ok) { document.querySelector(gstin && !Prefs.gstinOk(gstin) ? '#business-gstin' : '#business-fssai').focus(); return; }
    if (!window.RestroRestaurantName?.save(document.querySelector('#restaurant-input').value)) return;
    Prefs.set('business', { address: document.querySelector('#business-address').value, gstin, fssai, footer: document.querySelector('#business-footer').value });
    fillBusiness(); toast('Business details saved');
  });

  // ---------- Orders: how long before a scheduled order is due it goes to the kitchen (5 to 240 minutes) ----------
  const PREP_KEY = 'restro.counter.prepMinutes.v1';
  const readPrep = () => { try { const n = Number(JSON.parse(localStorage.getItem(PREP_KEY) || '30')); return Number.isFinite(n) ? Math.min(240, Math.max(5, Math.round(n / 5) * 5)) : 30; } catch { return 30; } };
  function showPrep() {
    const n = readPrep();
    document.querySelector('#settings-prep-value').textContent = `${n} min`;
    document.querySelector('#settings-orders-summary').textContent = `Preparation time ${n} min`;
    document.querySelector('#settings-prep-down').disabled = n <= 5;
    document.querySelector('#settings-prep-up').disabled = n >= 240;
  }
  function stepPrep(delta) {
    const n = Math.min(240, Math.max(5, readPrep() + delta));
    try { localStorage.setItem(PREP_KEY, JSON.stringify(n)); } catch {}
    window.RestroSync?.wrote(PREP_KEY);
    showPrep(); window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: n }));
  }
  let prepShown = readPrep();
  window.addEventListener('restro:data-changed', event => {
    if (!(event.detail?.collections || []).includes('settings') || readPrep() === prepShown) return;
    prepShown = readPrep(); showPrep(); window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: prepShown }));
  });
  document.querySelector('#settings-prep-down').addEventListener('click', () => stepPrep(-5));
  document.querySelector('#settings-prep-up').addEventListener('click', () => stepPrep(5));
  showPrep();

  // ---------- Counter: Menu display style and Tiles per row (Counter Update 6), as pictures of the Counter ----------
  // Each card is the Counter as it is now in that style (RestroCounter.preview) under a copy of the top bar, laid out at
  // the screen's own size and scaled down to the card, made each time the Counter page opens and cleared when it
  // closes. Tapping a card uses it straight away. Preferences of this tablet only (counter.js).
  const counterStyles = document.querySelector('#counter-style-options');
  const styleCards = new Map(), stylePreviews = [];
  const menuStyles = window.RestroCounter?.menuStyles || [];
  let shot = { w: innerWidth, h: innerHeight };
  const fitPreview = box => { const w = box.getBoundingClientRect().width; if (w) box.style.setProperty('--preview-scale', String(w / shot.w)); };
  const previewFit = new ResizeObserver(list => { for (const entry of list) fitPreview(entry.target); });
  const inheritedLooks = ['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow', 'text-rendering', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'visibility', 'cursor', 'list-style', '-webkit-font-smoothing'];
  function paintStylePreviews() {
    const counter = window.RestroCounter, banner = document.querySelector('#top-banner'), appShell = document.querySelector('.app-shell');
    if (!dialog.open || current !== 'counter' || !counter || !banner || !appShell) { clearStylePreviews(); return; }
    const look = getComputedStyle(appShell), widths = stylePreviews.map(box => box.getBoundingClientRect().width);
    shot = { w: innerWidth, h: innerHeight };
    const bar = banner.cloneNode(true);
    for (const part of [bar, ...bar.querySelectorAll('*')]) for (const name of ['autofocus', 'name', 'title', 'aria-live']) part.removeAttribute(name);
    stylePreviews.forEach((box, i) => {
      const screen = document.createElement('span'); screen.className = 'counter-live-screen'; screen.inert = true;
      for (const name of inheritedLooks) screen.style.setProperty(name, look.getPropertyValue(name));
      screen.style.width = `${shot.w}px`; screen.style.height = `${shot.h}px`;
      const app = document.createElement('span'); app.className = 'counter-live-app';
      app.append(counter.preview(box.dataset.counterStyle, Number(box.dataset.tiles) || undefined));
      screen.append(i ? bar.cloneNode(true) : bar, app);
      box.style.aspectRatio = `${shot.w} / ${shot.h}`;
      if (widths[i]) box.style.setProperty('--preview-scale', String(widths[i] / shot.w));
      box.replaceChildren(screen);
      for (const list of screen.querySelectorAll('[data-scroll-top]')) list.scrollTop = Number(list.dataset.scrollTop) || 0;
    });
  }
  function clearStylePreviews() { for (const box of stylePreviews) box.replaceChildren(); }
  function syncCounterStyle() {
    const style = window.RestroCounter?.menuStyle;
    document.querySelector('#settings-counter-summary').textContent = `Menu: ${style?.name || 'Pills on top'}`;
    for (const [id, c] of styleCards) {
      c.setAttribute('aria-checked', String(id === style?.id));
      c.tabIndex = id === style?.id ? 0 : -1;
      c.querySelector('.theme-state').textContent = id === style?.id ? 'Applied' : id === 'pills' ? 'Default' : '';
    }
  }
  const pictureCard = (cls, data, label) => {
    const c = el('button', { type: 'button', class: `theme-option counter-style ${cls}`, role: 'radio', 'aria-label': label, ...data });
    const box = el('span', { class: 'theme-preview counter-preview', 'aria-hidden': 'true', ...data });
    stylePreviews.push(box); previewFit.observe(box);
    c.append(box, el('span', { class: 'theme-option-caption' }, el('strong', {}, label), el('span', { class: 'theme-state' })));
    return c;
  };
  for (const style of menuStyles) {
    const c = pictureCard('', { 'data-counter-style': style.id }, style.name);
    c.addEventListener('click', () => window.RestroCounter?.setMenuStyle(style.id));
    styleCards.set(style.id, c); counterStyles.append(c);
  }
  counterStyles.addEventListener('keydown', event => {
    const c = event.target.closest('.counter-style'); if (!c) return;
    const index = menuStyles.findIndex(style => style.id === c.dataset.counterStyle);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % menuStyles.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + menuStyles.length - 1) % menuStyles.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = menuStyles.length - 1;
    else return;
    event.preventDefault(); window.RestroCounter?.setMenuStyle(menuStyles[next].id); styleCards.get(menuStyles[next].id).focus({ preventScroll: true });
  });
  window.addEventListener('restro:counter-style-changed', syncCounterStyle);
  let restyling = 0;
  addEventListener('resize', () => {
    if (!dialog.open || current !== 'counter' || !stylePreviews[0]?.firstChild || (innerWidth === shot.w && innerHeight === shot.h)) return;
    cancelAnimationFrame(restyling); restyling = requestAnimationFrame(paintStylePreviews);
  });
  syncCounterStyle();
  const tilesOptions = document.querySelector('#settings-tiles-per-row'), tilesCards = new Map();
  if (tilesOptions && window.RestroCounter) {
    for (const n of [4, 3]) {
      const c = pictureCard('counter-tiles', { 'data-tiles': String(n) }, `${n} per row`);
      c.addEventListener('click', () => window.RestroCounter.setTilesPerRow(n));
      tilesCards.set(n, c); tilesOptions.append(c);
    }
    tilesOptions.addEventListener('keydown', event => {
      if (!event.target.closest('.counter-tiles') || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const n = ['ArrowRight', 'ArrowDown', 'End'].includes(event.key) ? 3 : 4;
      event.preventDefault(); window.RestroCounter.setTilesPerRow(n); tilesCards.get(n).focus({ preventScroll: true });
    });
    const syncTiles = () => {
      const n = window.RestroCounter.tilesPerRow;
      for (const [k, c] of tilesCards) {
        c.setAttribute('aria-checked', String(k === n)); c.tabIndex = k === n ? 0 : -1;
        c.querySelector('.theme-state').textContent = k === n ? 'Applied' : k === 4 ? 'Default' : '';
      }
    };
    window.addEventListener('restro:counter-tiles-changed', () => { syncTiles(); paintStylePreviews(); });
    window.addEventListener('restro:counter-style-changed', () => paintStylePreviews());
    syncTiles();
  }

  // ---------- Billing & charges (Counter Update 7) ----------
  const billingHost = document.querySelector('#settings-billing');
  const setBilling = change => Prefs.update('billing', change);
  builders.billing = () => rebuild(billingHost, () => {
    const b = Prefs.get('billing'), pk = b.packaging, dl = b.delivery;
    const pkOn = pk.on;
    return [
      card('',
        lab('Order discount'), sub('The quick picks in the Discount pop-up. Any whole number from 1% to 100% can be typed there too.'),
        chips({ id: 'bill-od-pick', label: 'Order discount quick picks', items: b.orderDiscount.picks, text: pctText, parse: parsePct(1, 100, 1), placeholder: 'Add a percentage', inputmode: 'decimal', max: 5,
          change: list => setBilling(v => { v.orderDiscount.picks = list; }) })),
      card('',
        lab('Dish discount'), sub('The quick picks in the Dish discount pop-up.'),
        chips({ id: 'bill-dd-pick', label: 'Dish discount quick picks', items: b.dishDiscount.picks, text: pctText, parse: parsePct(1, 100, 1), placeholder: 'Add a percentage', inputmode: 'decimal', max: 4,
          change: list => setBilling(v => { v.dishDiscount.picks = list; }) })),
      card('',
        lab('Service charge'), sub('The quick picks in the Service charge pop-up.'),
        chips({ id: 'bill-sc-pick', label: 'Service charge quick picks', items: b.serviceCharge.picks, text: pctText, parse: parsePct(0.1, 10, 0.1), placeholder: 'Add a rate, like 7.5', inputmode: 'decimal', max: 4,
          change: list => setBilling(v => { v.serviceCharge.picks = list; }) })),
      card('st-rowcard',
        lab('Packaging charge'),
        el('div', { class: 'st-rows' }, switchRow('bill-pk-on', 'Charge for packaging', pkOn ? 'On' : 'Off', pkOn, on => setBilling(v => { v.packaging.on = on; })))),
      card(pkOn ? '' : 'dis',
        lab('Packaging details'), sub('Added to the bill before GST, and taxed at the food GST rate.'),
        el('div', { class: 'st-opts', role: 'radiogroup', 'aria-label': 'Packaging charge' }, [
          { id: 'flat', title: 'Flat per order', text: 'The same amount on every order of the types below.' },
          { id: 'dish', title: 'Per dish', text: 'Each dish’s own amount, set on the dish in the Menu app.' }
        ].map(m => el('button', { type: 'button', class: 'st-opt', role: 'radio', 'aria-checked': String(pk.mode === m.id), disabled: !pkOn, onclick: () => setBilling(v => { v.packaging.mode = m.id; }) },
          el('span', { class: 'st-rd' }), el('span', { class: 'st-opt-copy' }, el('b', {}, m.title), el('span', {}, m.text))))),
        pk.mode === 'flat' ? el('div', { class: 'st-two' }, amountField({ id: 'bill-pk-flat', label: 'Amount per order', value: pk.flat, disabled: !pkOn, change: n => setBilling(v => { v.packaging.flat = n; }) })) : null,
        el('div', { class: 'st-field' }, el('span', { class: 'st-flabel' }, 'Applies to'),
          el('div', { class: 'st-sgs', role: 'group', 'aria-label': 'Packaging applies to' }, [['takeaway', 'Takeaway'], ['delivery', 'Delivery'], ['phone', 'Phone order']].map(([t, name]) =>
            el('button', { type: 'button', class: 'st-sg', role: 'checkbox', 'aria-checked': String(pk.types.includes(t)), disabled: !pkOn,
              onclick: () => setBilling(v => { v.packaging.types = v.packaging.types.includes(t) ? v.packaging.types.filter(x => x !== t) : [...v.packaging.types, t]; }) }, name))))),
      card('st-rowcard',
        lab('Delivery charge'),
        el('div', { class: 'st-rows' }, switchRow('bill-dl-on', 'Charge for delivery', dl.on ? `On · ${rupees(dl.flat)} on every delivery order` : 'Off', dl.on, on => setBilling(v => { v.delivery.on = on; }))),
        dl.on ? el('div', { class: 'st-two', style: 'padding-bottom:calc(22 * var(--su))' }, amountField({ id: 'bill-dl-flat', label: 'Amount per delivery order', value: dl.flat, change: n => setBilling(v => { v.delivery.flat = n; }) })) : null),
      card('',
        lab('Rounding and GST'), sub('Fixed for every restaurant.'),
        el('div', { class: 'st-fixed' },
          el('p', {}, el('b', {}, 'Rounding'), 'To the nearest rupee: 50 paise and up go up. The Round off line shows on the screen and on the bill.'),
          el('p', {}, el('b', {}, `GST ${window.RestroBill?.labels(window.RestroMenu?.taxRate).gst.replace('GST ', '') || '5%'}`), `Shown as ${window.RestroBill?.labels(window.RestroMenu?.taxRate).cgst || 'CGST 2.5%'} + ${window.RestroBill?.labels(window.RestroMenu?.taxRate).sgst || 'SGST 2.5%'}. It stays CGST + SGST even for a customer with a GSTIN from another state, as the place of supply is where the food is served (confirm with your CA).`)))
    ];
  });

  // ---------- Staff & security (Navigation & Lock Update 1) ----------
  const securityHost = document.querySelector('#settings-security');
  builders.security = () => rebuild(securityHost, () => {
    const s = Prefs.get('security');
    return [
      card('', lab('Auto-lock when idle'), sub('Locks the screen after this long without a tap.'),
        tiles('Auto-lock when idle', Prefs.autoLockChoices.map(n => ({ value: n, label: minutes(n) })), s.autoLock, n => { Prefs.update('security', v => { v.autoLock = n; }); builders.security(); })),
      card('', lab('Signing in'), sub('The PIN pad on the lock screen.'),
        el('div', { class: 'st-fixed' },
          el('p', {}, el('b', {}, 'PIN'), '4 digits, one for each person (set in the Staff app).'),
          el('p', {}, el('b', {}, 'Wrong PIN'), 'After 5 wrong tries, the pad pauses for 30 seconds.'),
          el('p', {}, el('b', {}, 'Manager PIN'), el('span', { class: 'st-tag' }, 'LATER'))))
    ];
  });

  // ---------- Display › Navigation (Navigation & Lock Update 1, N6/N7) ----------
  const navHost = document.querySelector('#settings-navigation');
  const NAV_ICONS = order => (order === 'back-right' ? ['nav-recent', 'nav-home', 'nav-back'] : ['nav-back', 'nav-home', 'nav-recent']);
  const navIcon = name => ms(name, 'nav-ico');
  function navPicture(kind, order) {
    return el('span', { class: 'st-navpic', 'aria-hidden': 'true' }, el('i'), el('span', {}, el('i'), el('i')),
      kind === 'swipe' ? el('span', { class: 'handle' }) : el('span', { class: 'bar' }, NAV_ICONS(order).map(navIcon), el('span', { class: 'lk' }, navIcon('nav-lock'))));
  }
  builders.navigation = () => rebuild(navHost, () => {
    const n = Prefs.get('navigation'), dark = Prefs.get('screen').goDark, bar = n.mode === 'bar';
    const opt = (mode, title, text) => el('button', { type: 'button', class: 'st-opt', role: 'radio', 'aria-checked': String(n.mode === mode), tabindex: n.mode === mode ? '0' : '-1',
      onclick: () => { Prefs.update('navigation', v => { v.mode = mode; }); builders.navigation(); syncSummaries(); } },
      el('span', { class: 'st-rd' }), el('span', { class: 'st-opt-copy' }, el('b', {}, title), el('span', {}, text)), el('span', { class: 'st-opt-pic' }, navPicture(mode, n.order)));
    const modes = el('div', { class: 'st-opts', role: 'radiogroup', 'aria-label': 'How staff move between screens and apps' },
      opt('swipe', 'Swipe gestures', 'Default · swipe up for Home, from the side for Back, up and hold for Recent apps'),
      opt('bar', 'Navigation bar', 'Back, Home and Recent apps buttons at the bottom · swipes are turned off'));
    modes.addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault();
      Prefs.update('navigation', v => { v.mode = v.mode === 'bar' ? 'swipe' : 'bar'; }); builders.navigation(); syncSummaries();
      navHost.querySelector('.st-opt[aria-checked="true"]')?.focus({ preventScroll: true });
    });
    const order = o => ({ value: o, aria: o === 'back-left' ? 'Back on the left' : 'Back on the right', label: [el('span', { class: 'ics' }, NAV_ICONS(o).map(navIcon)), el('span', {}, o === 'back-left' ? 'Back on the left' : 'Back on the right')] });
    return [
      card('', lab('How staff move between screens and apps'), sub('Applies to every app on this tablet. Only one can be on at a time.'), modes),
      card(bar ? '' : 'dis', lab('Button order'), sub('Home always stays in the centre.'),
        tiles('Button order', [order('back-left'), order('back-right')], n.order, o => { Prefs.update('navigation', v => { v.order = o; }); builders.navigation(); syncSummaries(); }, { tall: true, disabled: !bar }),
        note(bar ? 'Swipe mode: apps use the full 1920 × 1080. Navigation bar: the bar takes 56 px and apps get 1920 × 1024.' : 'Shown only when Navigation bar is on.')),
      card('', lab('Go dark after'), sub('The screen turns black and locks. Double-tap it to wake straight to the PIN pad.'),
        tiles('Go dark after', Prefs.goDarkChoices.map(m => ({ value: m, label: m ? `${m} min` : 'Never' })), dark, m => { Prefs.update('screen', v => { v.goDark = m; }); builders.navigation(); syncSummaries(); }))
    ];
  });

  // ---------- Devices & sync › Printers (Counter Update 7) ----------
  // The printers are the main system's, found by the RESTRO Android app (RESTRODevice.printer.list()). Each has a role
  // (bills, kitchen tickets or both), the language its kitchen tickets print in and how many copies of each.
  let printers = [], printerId = null;
  const printerSettings = id => Prefs.get('printers')[id] || { role: 'both', language: 'English', copies: 1 };
  const printerName = id => printers.find(p => p.id === id)?.name || 'Printer';
  const roleName = { bills: 'Bills', kitchen: 'Kitchen', both: 'Bills and kitchen' };
  async function loadPrinters() {
    const host = window.RESTRODevice?.printer;
    if (typeof host?.list !== 'function') { printers = []; return false; }
    try { const list = await host.list(); printers = (Array.isArray(list) ? list : []).filter(p => p && typeof p.id === 'string').map(p => ({ id: p.id.slice(0, 80), name: String(p.name || 'Printer').slice(0, 40), connection: String(p.connection || '') })); }
    catch { printers = []; }
    return true;
  }
  const printersHost = document.querySelector('#settings-printers');
  async function paintPrinters() {
    const bridged = await loadPrinters();
    const kotOf = s => (s.role === 'bills' ? '' : ` · KOT in ${s.language} · ${s.copies} ${s.copies === 1 ? 'copy' : 'copies'}`);
    printersHost.replaceChildren(lab('Printers'),
      ...(printers.length ? printers.map(p => {
        const s = printerSettings(p.id);
        return el('button', { type: 'button', class: 'st-row st-link', onclick: () => { printerId = p.id; show('printer', { focus: true }); } },
          el('span', { class: 'settings-row-icon' }, ms('ms-print')), el('span', { class: 'st-row-copy' }, el('strong', {}, p.name), el('span', {}, `${roleName[s.role]}${kotOf(s)}${p.connection ? ` · ${p.connection}` : ''}`)), ms('ms-chevron-right', 'ms st-chev'));
      }) : [el('div', { class: 'st-row' }, el('span', { class: 'settings-row-icon' }, ms('ms-print')), el('span', { class: 'st-row-copy' }, el('strong', {}, 'No printers here'),
        el('span', {}, bridged ? 'The main system hasn’t found a printer yet.' : 'Printers connect to the main system through the RESTRO Android app.')))]));
  }
  const printerHost = document.querySelector('#settings-printer');
  const setPrinter = change => Prefs.update('printers', all => { const s = { ...printerSettings(printerId) }; change(s); all[printerId] = s; });
  builders.printer = () => rebuild(printerHost, () => {
    const s = printerSettings(printerId), kitchen = s.role !== 'bills';
    const again = () => { builders.printer(); };
    return [
      card('', lab('Role'), sub('What this printer prints.'),
        tiles('Printer role', [{ value: 'bills', label: 'Bills' }, { value: 'kitchen', label: 'Kitchen (KOT)' }, { value: 'both', label: 'Both' }], s.role, r => { setPrinter(x => { x.role = r; }); again(); })),
      card(kitchen ? '' : 'dis', lab('KOT language'), sub('Kitchen tickets print in this language. Other than English, a ticket prints as a picture, as thermal printers have no Indian-language fonts. Dish names come from the Menu app; a dish without a name in this language prints in English.'),
        el('div', { class: 'st-langs' }, tiles('KOT language', Prefs.languages.map(l => ({ value: l, label: l })), s.language, l => { setPrinter(x => { x.language = l; }); again(); }, { disabled: !kitchen }))),
      card(kitchen ? '' : 'dis', lab('Copies per KOT'), sub('How many of each kitchen ticket it prints.'),
        tiles('Copies per KOT', [1, 2, 3].map(n => ({ value: n, label: String(n) })), s.copies, n => { setPrinter(x => { x.copies = n; }); again(); }, { disabled: !kitchen }))
    ];
  });
  builders.sync = () => { paintPrinters(); };

  // A setting changed (here, or on another tablet): the page on screen and the lines under the categories follow
  window.addEventListener('restro:prefs-changed', event => {
    syncSummaries();
    if (!dialog.open) return;
    const name = event.detail?.name;
    const page = { billing: 'billing', security: 'security', navigation: 'navigation', screen: 'navigation', printers: current === 'printer' ? 'printer' : 'sync', business: 'business' }[name];
    if (page === current && page !== 'business') builders[page]?.();
    if (page === 'business' && current === 'business' && !document.querySelector('#business-form').contains(document.activeElement)) fillBusiness();
  });

  for (const entry of entries) entry.addEventListener('click', () => show(entry.dataset.page, { focus: !twoPane.matches }));
  dialog.querySelector('[data-open="navigation"]').addEventListener('click', () => show('navigation', { focus: true }));
  back.addEventListener('click', () => { if (parentOf(current)) show(parentOf(current), { focus: true }); else showList(); });
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = entries.find(entry => !(entry.closest('li') || entry).hidden);
    if (first) { event.preventDefault(); show(first.dataset.page, { focus: true }); }
  });
  document.querySelector('#settings-internet-check').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Checking…';
    try { await window.RestroConnectivity?.refresh?.(); } finally { button.disabled = false; button.textContent = 'Check now'; syncSummaries(); }
  });
  document.querySelector('#settings-brightness-range').addEventListener('input', event => window.RestroDeviceControls?.setBrightness(event.target.value));

  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    window.RestroThemePicker?.reset();
    clearStylePreviews();
    if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  });
  new MutationObserver(() => { if (dialog.open && toastNode.parentElement !== dialog) dialog.append(toastNode); })
    .observe(dialog, { attributes: true, attributeFilter: ['open'] });
  twoPane.addEventListener('change', () => { if (twoPane.matches) { shell.dataset.view = 'list'; show(current); } });
  for (const type of ['restro:connectivity-changed', 'restro:brightness-changed', 'restro:bluetooth-changed', 'restro:wifi-changed', 'restro:volume-changed', 'restro:theme-changed', 'restro:restaurant-renamed', 'online', 'offline']) {
    window.addEventListener(type, syncSummaries);
  }

  // Names kept for app.js (openSettings), the system Back button and the tests
  window.RestroThemeSettings = Object.freeze({ reset, goBack, show, get page() { return current; } });
  reset();
})();
