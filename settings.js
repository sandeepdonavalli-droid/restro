'use strict';
// Settings (Update Pack 9 Nov 2026: the look of Display › Navigation, N6/N7, on every page). The categories on the left
// beside the page chosen on tablets, one column with a back arrow on narrow screens. Each page has a breadcrumb over
// its title ("Settings", or "Settings › Display" on a page inside another) and its settings in cards.
// New in this update: Business details (printed on the bill), Billing & charges, Kitchen (empty for now: kitchen and
// receipt styles later, Update Pack 2), Staff & security (auto-lock), Display › Navigation (swipe gestures or the
// navigation bar, button order, Go dark) and Settings › Printers › each printer (role, KOT language, copies). Their values are
// kept by prefs.js.
(() => {
  const dialog = document.querySelector('#settings-dialog');
  const shell = dialog.querySelector('.settings-shell');
  const nav = dialog.querySelector('.settings-nav');
  const pageTitle = document.querySelector('#settings-page-title');
  const crumb = document.querySelector('#settings-crumb');
  const back = document.querySelector('#settings-back');
  const entries = [...nav.querySelectorAll('[data-page]')];
  const pages = new Map([...dialog.querySelectorAll('.settings-page')].map(page => [page.dataset.page, page]));
  const twoPane = window.matchMedia('(min-width: 760px)');
  const toastNode = document.querySelector('#toast');
  const toastHome = toastNode.parentElement;
  const Prefs = window.RestroPrefs;
  let current = 'business';

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
  const X = '<path d="m7 7 10 10M17 7 7 17"/>', CHECK = '<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>';
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };
  const card = (cls, ...children) => el('div', { class: `st-card${cls ? ` ${cls}` : ''}` }, ...children);
  const lab = (text, id) => el('p', { class: 'st-lab', id }, text);
  const sub = text => el('p', { class: 'st-sub' }, text);
  const note = text => el('p', { class: 'st-note' }, text);
  // A card's heading and its line with a switch at the right (Update Pack 3: a card's control at the top right of its heading)
  const switchHead = (id, title, text, on, change) => el('label', { class: 'st-sec-head st-sec-switch', for: id },
    el('span', {}, el('span', { class: 'st-lab' }, title), el('span', { class: 'st-sub' }, text)),
    el('input', { id, class: 'st-switch', type: 'checkbox', role: 'switch', checked: on, onchange: e => change(e.target.checked) }));
  // Choice tiles, one of them on (role radio); arrow keys move along them
  function tiles(label, choices, value, pick, { tall = false, disabled = false } = {}) {
    const group = el('div', { class: 'st-sgs', role: 'radiogroup', 'aria-label': label });
    choices.forEach(c => group.append(el('button', { type: 'button', class: `st-sg${tall ? ' tall' : ''}`, role: 'radio', 'aria-checked': String(c.value === value), tabindex: c.value === value ? '0' : '-1', disabled,
      'aria-label': c.aria || null, onclick: () => pick(c.value) }, c.value === value && !tall ? line(CHECK) : null, ...(Array.isArray(c.label) ? c.label : [c.label]))));
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
    crumb.replaceChildren('Settings', ...(parent ? [' › ', el('button', { type: 'button', onclick: () => show(parent, { focus: true }) }, pages.get(parent).dataset.title)] : pages.get(id).dataset.crumb ? [' › ', pages.get(id).dataset.crumb] : []));
    for (const entry of entries) {
      const selected = entry.dataset.page === top;
      entry.classList.toggle('selected', selected);
      if (selected) entry.setAttribute('aria-current', 'page'); else entry.removeAttribute('aria-current');
    }
    if (id === 'display') window.RestroThemePicker?.reset();
    // (the live pictures are only there while their page is: a copy of a whole screen each)
    if (id !== 'orders') ordersHost?.replaceChildren();
    if (id !== 'counter') counterHost?.replaceChildren();
    if (id !== 'navigation') navHost?.replaceChildren();
    if (id === 'business') fillBusiness();
    builders[id]?.();
    renderLivePanels(id);
    dialog.querySelector('.settings-pages').scrollTop = 0;
    if (!twoPane.matches) shell.dataset.view = 'detail';
    if (focus) {
      const target = id === 'business' ? document.querySelector('#restaurant-input') : null;
      (target || pages.get(id).querySelector('input,button,a') || back)?.focus({ preventScroll: true });
    }
  }
  function showList() {
    shell.dataset.view = 'list';
    nav.querySelector(`[data-page="${parentOf(current) || current}"]`)?.focus({ preventScroll: true });
  }
  function goBack() {
    if (!dialog.open) return false;
    if (parentOf(current)) { show(parentOf(current), { focus: true }); return true; }
    if (!twoPane.matches && isDetailView()) { showList(); return true; }
    return false;
  }
  function reset() {
    window.RestroThemePicker?.reset();
    syncSummaries();
    shell.dataset.view = 'list';
    if (twoPane.matches) show('business');
    else { current = 'business'; for (const [pageId, page] of pages) page.hidden = pageId !== current; }
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
    document.getElementById('settings-internet-status')?.classList.toggle('ok', Boolean(online));
    document.getElementById('settings-internet-status')?.classList.toggle('bad', !online);
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
    window.RestroProfile?.fill();
  }
  const say = (id, message) => { const node = document.getElementById(id); node.textContent = message; node.hidden = !message; };
  document.querySelector('#business-gstin').addEventListener('input', e => { const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); if (v !== e.target.value) e.target.value = v; say('business-gstin-error', ''); });
  document.querySelector('#business-fssai').addEventListener('input', e => { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v; say('business-fssai-error', ''); });
  document.querySelector('#business-form').addEventListener('submit', e => {
    e.preventDefault();
    const gstin = document.querySelector('#business-gstin').value.trim(), fssai = document.querySelector('#business-fssai').value.trim();
    let ok = true;
    const contact = window.RestroProfile?.read() || null;
    if (!contact) { (document.querySelector('#profile-mobile-error:not([hidden])') ? document.querySelector('#profile-mobile') : document.querySelector('#profile-email')).focus(); return; }
    if (gstin && !Prefs.gstinOk(gstin)) { say('business-gstin-error', gstin.length !== 15 ? 'A GSTIN has 15 letters and numbers.' : 'This GSTIN doesn’t check out. Look for a typing mistake.'); ok = false; }
    if (fssai && !Prefs.fssaiOk(fssai)) { say('business-fssai-error', 'An FSSAI number has 14 digits.'); ok = false; }
    if (!ok) { document.querySelector(gstin && !Prefs.gstinOk(gstin) ? '#business-gstin' : '#business-fssai').focus(); return; }
    if (!window.RestroRestaurantName?.save(document.querySelector('#restaurant-input').value)) return;
    Prefs.set('business', { address: document.querySelector('#business-address').value, ...contact, gstin, fssai, footer: document.querySelector('#business-footer').value });
    fillBusiness(); toast('Business details saved');
  });

  // ---------- Business details (Update Pack 4): Bill number and Business hours, under the details printed on the bill ----------
  // Both are the restaurant's (every tablet's) and apply as they are picked.
  const businessHost = document.querySelector('#settings-business-more');
  const staffNow = () => window.RestroStaff?.current?.name || null;
  // Bill number (the owner's mock-up B, 11 Nov 2026): when a bill gets its number, B-1, B-2 … in one series for the
  // financial year. Each tile shows the top of what prints. A change is kept with when and who (billNumber.log), and
  // applies from the next bill: a bill that has its number keeps it.
  const BILL_AT = [['print', 'When the bill is first printed', 'Default · The bill is the tax invoice. If its order is deleted later, the number is listed as Cancelled in the GST report.'],
    ['payment', 'At payment', 'The bill before payment says “Not a tax invoice”. The numbered receipt prints at every payment.']];
  const slipPic = (title, numbers, caption) => el('span', { class: 'st-bn-slip' },
    el('span', { class: 'st-bn-paper' }, el('b', { class: 'st-bn-name' }, window.RestroRestaurantName?.value || 'RESTAURANT NAME'), el('i'), el('b', { class: 'st-bn-title' }, title),
      el('span', { class: 'st-bn-row' }, el('span', {}, numbers), el('span', {}, '9:42 PM')), el('span', { class: 'st-bn-row st-bn-faint' }, el('span', {}, 'Dine-in · Table 6'), el('span'))),
    el('span', { class: 'st-bn-cap' }, caption));
  const billPics = id => el('span', { class: 'st-tile-pic' }, el('span', { class: 'st-bn-pics' }, ...(id === 'print'
    ? [slipPic('TAX INVOICE', 'Bill #B-45 · Order #07', 'Bill · before payment')]
    : [slipPic('BILL · NOT A TAX INVOICE', 'Order #07', 'Bill · before payment'), slipPic('TAX INVOICE · RECEIPT', 'Bill #B-45 · Order #07', 'Receipt · at payment')])));
  function billNumberCard() {
    const b = Prefs.get('billNumber');
    const pick = to => { if (to !== b.at) Prefs.set('billNumber', { at: to, log: [...b.log, { to, at: Date.now(), by: staffNow() }] }); };
    return card('', lab('Bill number'), sub('When a bill gets its number: B-1, B-2 … One series for the financial year, never reused.'),
      radioGrid('Bill number', BILL_AT.map(([id, name, text]) => ({ id, name, text, pic: () => billPics(id) })), b.at, pick),
      note('Changes apply from the next bill. Bills that already have a number keep it.'));
  }
  // Business hours: when the restaurant is open each day. Scheduled orders can be ready only inside these hours (the
  // Counter's Schedule picker). The business day ends at closing time and the next starts the minute after (owner, 11 Nov
  // 2026); Today, the day's totals and the day's order and KOT numbers follow it (sync.js).
  const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const clock = m => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  function hoursCard() {
    const h = Prefs.get('hours'), setHours = change => Prefs.update('hours', change);
    const select = (id, label, values, value, change, disabled = false) => el('select', { id, class: 'st-select st-time', 'aria-label': label, disabled, onchange: e => change(Number(e.target.value)) },
      values.map(([v, text]) => el('option', { value: String(v), selected: v === value }, text)));
    // (opening: any quarter hour; closing: after the opening that day, or the next morning up to 6:00 am)
    const dayTimes = Array.from({ length: 96 }, (_, i) => i * 15);
    const row = d => {
      const x = h.days[d], name = DAY_NAMES[d];
      // (a day with a break: only hours that keep the break inside them; an opening after the closing time makes it close
      // at midnight, as Prefs keeps it)
      const keeps = (from, to) => !x.break || Prefs.breakOk(from, to, x.break);
      const closeFor = from => (x.to > from || x.to <= Prefs.latestClose ? x.to : 0);
      const fromValues = dayTimes.filter(m => keeps(m, closeFor(m)) || m === x.from);
      const toValues = [...dayTimes.filter(m => m > x.from), ...dayTimes.filter(m => m <= Prefs.latestClose && m <= x.from)].filter(m => keeps(x.from, m) || m === x.to);
      return el('div', { class: 'st-row' },
        el('span', { class: 'st-row-copy' }, el('strong', {}, name), el('span', {}, x.open ? 'Open' : 'Closed')),
        el('input', { id: `hours-${d}`, class: 'st-switch', type: 'checkbox', role: 'switch', 'aria-label': `${name}: open`, checked: x.open, onchange: e => setHours(v => { v.days[d].open = e.target.checked; }) }),
        el('span', { class: 'st-hours-times' },
          select(`hours-${d}-from`, `${name}: opens at`, fromValues.map(m => [m, clock(m)]), x.from, m => setHours(v => { v.days[d].from = m; }), !x.open),
          el('span', {}, 'to'),
          select(`hours-${d}-to`, `${name}: closes at`, toValues.map(m => [m, clock(m)]), x.to, m => setHours(v => { v.days[d].to = m; }), !x.open)));
    };
    return card('st-hours', lab('Business hours'), sub('Scheduled orders can be ready only while you are open. A new business day starts the minute after closing: open till 2:00 am, an order at 12:40 am counts in the day before.'),
      el('div', { class: 'st-rows' }, Prefs.days.map(row)));
  }
  // (Owner, 14 Nov 2026) Break hours: optional, a break in a day's hours when the restaurant is closed (e.g. 3:30 pm to
  // 7:00 pm), off on every day until turned on. A row per day as Business hours: the switch, then from and to, only
  // times inside that day's hours with time open before and after the break. A day closed all day can't have one.
  function breakCard() {
    const h = Prefs.get('hours'), setHours = change => Prefs.update('hours', change);
    const select = (id, label, values, value, change, disabled) => el('select', { id, class: 'st-select st-time', 'aria-label': label, disabled, onchange: e => change(Number(e.target.value)) },
      values.map(v => el('option', { value: String(v % 1440), selected: v % 1440 === value }, clock(v))));
    const row = d => {
      const x = h.days[d], name = DAY_NAMES[d], on = Boolean(x.open && x.break);
      // (the day's times in 15s from just after opening to just before closing, the next morning's past 1440)
      const close = x.to <= x.from ? x.to + 1440 : x.to, inside = [];
      for (let m = x.from + 15; m < close; m += 15) inside.push(m);
      // (a new break: 3:30 pm to 7:00 pm when the day has room for it, as the designs; otherwise an hour in its middle)
      const mid = Math.round((x.from + close) / 2 / 15) * 15;
      const fresh = Prefs.breakOk(x.from, x.to, { from: 930, to: 1140 }) ? { from: 930, to: 1140 } : { from: (mid - 30) % 1440, to: (mid + 30) % 1440 };
      const room = x.open && Prefs.breakOk(x.from, x.to, fresh), b = x.break || fresh;
      const start = b.from <= x.from ? b.from + 1440 : b.from, end = b.to <= x.from ? b.to + 1440 : b.to;
      return el('div', { class: 'st-row' },
        el('span', { class: 'st-row-copy' }, el('strong', {}, name), el('span', {}, !x.open ? 'Closed' : on ? 'Break' : 'No break')),
        el('input', { id: `break-${d}`, class: 'st-switch', type: 'checkbox', role: 'switch', 'aria-label': `${name}: break`, checked: on, disabled: !on && !room,
          onchange: e => setHours(v => { v.days[d].break = e.target.checked ? { ...fresh } : null; }) }),
        el('span', { class: 'st-hours-times' },
          select(`break-${d}-from`, `${name}: break from`, inside.filter(m => m < end), b.from, m => setHours(v => { v.days[d].break = { from: m, to: b.to }; }), !on),
          el('span', {}, 'to'),
          select(`break-${d}-to`, `${name}: break to`, inside.filter(m => m > start), b.to, m => setHours(v => { v.days[d].break = { from: b.from, to: m }; }), !on)));
    };
    return card('st-hours', lab('Break hours'), sub('Optional. A break in the day when you’re closed, for example 3:30 pm to 7:00 pm. QR ordering, Swiggy, Zomato, other delivery apps and your own online ordering stop for it, and scheduled orders can’t be ready during it.'),
      el('div', { class: 'st-rows' }, Prefs.days.map(row)));
  }
  // (Update Pack 5, I3) Last order time: how long before closing QR ordering, Swiggy, Zomato, other delivery apps and the
  // restaurant's own online ordering stop taking orders; staff-taken orders as usual until closing. Under it, today's:
  // "Today: last orders 10:30 pm · closes 11:00 pm".
  const atClock = t => clock(Math.round((t - new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()) / 60000));
  function lastOrderCard() {
    const h = Prefs.get('hours'), key = Prefs.businessDay(Date.now()), on = Prefs.hoursOn(key), last = Prefs.lastOrderOn(key);
    const choices = Prefs.lastOrderChoices.map(m => ({ value: m, label: m === 0 ? 'At closing' : m === 60 ? '1 hour before' : `${m} min before` }));
    return card('', lab('Last order time'), sub('For QR ordering, Swiggy, Zomato, other delivery apps and your own online ordering. Orders your staff take work as usual until closing.'),
      tiles('Last order time', choices, h.lastOrder, m => Prefs.update('hours', v => { v.lastOrder = m; })),
      note(on ? `Today: last orders ${atClock(last)} · closes ${atClock(on.to)}` : 'Closed today.'));
  }
  // (Owner, 14 Nov 2026) Last order before break: shown once a day has a break; the same tiles and channels as Last order
  // time, counted back from the break. Under it, today's: "Today: last orders 3:00 pm · break 3:30 pm – 7:00 pm".
  function lastBreakCard() {
    const h = Prefs.get('hours'); if (!Prefs.days.some(d => h.days[d].open && h.days[d].break)) return null;
    const key = Prefs.businessDay(Date.now()), b = Prefs.breakOn(key), last = Prefs.lastOrderBreakOn(key);
    const choices = Prefs.lastOrderChoices.map(m => ({ value: m, label: m === 0 ? 'At the break' : m === 60 ? '1 hour before' : `${m} min before` }));
    return card('', lab('Last order before break'), sub('For QR ordering, Swiggy, Zomato, other delivery apps and your own online ordering. Orders your staff take aren’t affected.'),
      tiles('Last order before break', choices, h.lastOrderBreak, m => Prefs.update('hours', v => { v.lastOrderBreak = m; })),
      note(b ? `Today: last orders ${atClock(last)} · break ${atClock(b.from)} – ${atClock(b.to)}` : 'No break today.'));
  }
  builders.business = () => rebuild(businessHost, () => [billNumberCard(), hoursCard(), breakCard(), lastOrderCard(), lastBreakCard()].filter(Boolean));
  window.addEventListener('restro:prefs-changed', e => { if (dialog.open && current === 'business' && ['hours', 'billNumber'].includes(e.detail?.name)) builders.business(); });

  // ---------- Update Pack 3: option tiles with a live preview ----------
  // (Update Pack 4, A8: layout settings are the restaurant's, on every tablet; "Use on" is gone. The grey chip "Applies
  // to all tablets at ‹Branch›" at the top right of such a card comes only for owners with more than one branch, which
  // RESTRO doesn't have yet.)
  const secHead = (title, text, right = null) => el('div', { class: 'st-sec-head' }, el('div', {}, lab(title), sub(text)), right);
  // A live preview: the screen as the app has it (its area under the top bar, with the lock and the swipe line when
  // swipe gestures are on), laid out at its own size and scaled down to the tile's width, never cropped or squeezed
  const inheritedLooks = ['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform'];
  function screenSize() {
    const swipe = document.documentElement.dataset.nav !== 'bar';
    const top = document.querySelector('#top-banner')?.getBoundingClientRect().height || 0;
    const bar = swipe ? 0 : document.querySelector('#system-navigation')?.getBoundingClientRect().height || 0;
    return { w: innerWidth, h: Math.max(1, Math.round(innerHeight - top - bar)), swipe };
  }
  const fitLive = new ResizeObserver(list => { for (const e of list) e.target.style.setProperty('--preview-scale', String(e.contentRect.width / (Number(e.target.dataset.w) || 1))); });
  function livePic(make) {
    const size = screenSize(), box = el('span', { class: 'st-tile-pic', 'aria-hidden': 'true', 'data-w': String(size.w) });
    box.style.aspectRatio = `${size.w} / ${size.h}`;
    const made = make(), shell = document.querySelector('.app-shell'), look = shell ? getComputedStyle(shell) : null;
    const screen = el('span', { class: `st-live ${made.cls || ''}` }, made.node, size.swipe ? [el('span', { class: 'st-live-lock' }, ms('nav-lock')), el('span', { class: 'st-live-pill' })] : null);
    screen.inert = true; screen.style.width = `${size.w}px`; screen.style.height = `${size.h}px`;
    if (look) for (const name of inheritedLooks) screen.style.setProperty(name, look.getPropertyValue(name));
    box.append(screen, made.sample ? el('span', { class: 'st-sample' }, 'Sample') : null);
    fitLive.observe(box);
    return box;
  }
  // Option tiles in a 2-column grid (3 columns for 3 tiles): a radio, the name and its line, the preview; arrow keys
  // move along them
  function radioGrid(label, options, value, pick) {
    const grid = el('div', { class: `st-tiles${options.length === 3 ? ' three' : ''}`, role: 'radiogroup', 'aria-label': label }, options.map(o => el('button', {
      type: 'button', class: 'st-tile', role: 'radio', 'aria-checked': String(o.id === value), tabindex: o.id === value ? '0' : '-1', 'data-id': String(o.id), 'aria-label': `${o.name}. ${o.text}`,
      onclick: () => { if (o.id !== value) pick(o.id); } },
      el('span', { class: 'st-tile-top' }, el('span', { class: 'st-rd' }), el('b', {}, o.name), el('span', {}, o.text)), o.pic())));
    grid.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (!d) return;
      e.preventDefault(); const i = options.findIndex(o => o.id === value), next = options[(i + d + options.length) % options.length];
      pick(next.id); requestAnimationFrame(() => dialog.querySelector(`[aria-label="${label}"] [data-id="${next.id}"]`)?.focus({ preventScroll: true }));
    });
    return grid;
  }

  // ---------- Orders: Orders display (Update Pack 4, S1 / S2): the list view and the row style ----------
  // The same orders, buttons, filters and rules in every view and style; only the layout changes. Each tile is the
  // Orders page as it is now (today's orders; sample orders while there are none). Three views (Board is gone); the
  // restaurant's, on every tablet; a new restaurant starts with Classic and Classic rows.
  const ordersHost = document.querySelector('#settings-orders');
  const ORDER_VIEWS = [['classic', 'Classic', 'Default · one row per order. Fastest to scan at a busy counter.'], ['split', 'Split detail', 'Order list on the left, the selected order’s dishes on the right.'],
    ['cards', 'Cards', 'One card per order, bigger buttons, easy to tap.']];
  const ORDER_ROWS = [['classic', 'Classic rows', 'One panel with thin lines between orders. Square-ish buttons.'], ['pills', 'Floating pills', 'Each order floats as a soft rounded pill. Round buttons.']];
  const ordersPic = (view, rows) => livePic(() => { const p = window.RestroOrders?.preview?.({ view, rows }); return { node: p?.node || el('span'), sample: Boolean(p?.sample), cls: 'orders-app' }; });
  // The order-ready message (Update Pack 4): sent by itself when the kitchen marks an order done (orders.js), by SMS (the
  // default), by WhatsApp falling back to SMS, or not at all. The restaurant's, on every tablet.
  const READY_SEND = [['sms', 'SMS'], ['whatsapp', 'WhatsApp (falls back to SMS)'], ['off', 'Off']];
  builders.orders = () => rebuild(ordersHost, () => {
    const v = Prefs.scoped('orders').value, set = next => Prefs.setScoped('orders', next);
    return [
      card('', secHead('Order list view', 'Same orders, buttons, filters and rules in every view. Only the layout changes.'),
        radioGrid('Order list view', ORDER_VIEWS.map(([id, name, text]) => ({ id, name, text, pic: () => ordersPic(id, v.rows) })), v.view, id => set({ ...v, view: id }))),
      card('', secHead('Row style', 'Applies to every view above. New restaurants start with Classic rows.'),
        radioGrid('Row style', ORDER_ROWS.map(([id, name, text]) => ({ id, name, text, pic: () => ordersPic('classic', id) })), v.rows, id => set({ ...v, rows: id }))),
      card('', secHead('Order-ready message', 'Sent by itself when the kitchen marks an order done and the order has the customer’s phone number.'),
        tiles('Order-ready message', READY_SEND.map(([value, label]) => ({ value, label })), Prefs.get('readyMessage').send, value => Prefs.set('readyMessage', { send: value })))
    ];
  });

  // ---------- Counter: Menu display style and Tiles per row (Counter Update 6), as option tiles ----------
  // Each tile is the Counter as it is now in that style (RestroCounter.preview). The restaurant's, as for Orders.
  const counterHost = document.querySelector('#settings-counter');
  const STYLE_LINES = { grid: 'Every category as a tile; tap one to see its dishes.', pills: 'Default · categories as pills above the dishes.', rail: 'Categories in a column on the left, the dishes beside them.' };
  const counterPic = (style, perRow) => livePic(() => ({ node: window.RestroCounter.preview(style, perRow), cls: 'counter-still' }));
  builders.counter = () => rebuild(counterHost, () => {
    const c = window.RestroCounter; if (!c) return [];
    const style = c.menuStyle?.id || 'pills', perRow = c.tilesPerRow;
    return [
      card('', secHead('Menu display style', 'How the menu shows on the Counter.'),
        radioGrid('Menu display style', c.menuStyles.map(m => ({ id: m.id, name: m.name, text: STYLE_LINES[m.id] || '', pic: () => counterPic(m.id, perRow) })), style, id => c.setMenuStyle(id))),
      card('', secHead('Tiles per row', 'How many dishes in each row of the menu.'),
        radioGrid('Tiles per row', [4, 3].map(n => ({ id: n, name: `${n} per row`, text: n === 4 ? 'Default · more dishes on each page.' : 'Bigger tiles, easier to tap.', pic: () => counterPic(style, n) })), perRow, n => c.setTilesPerRow(n)))
    ];
  });
  const syncCounterSummary = () => { const n = document.querySelector('#settings-counter-summary'); if (n) n.textContent = `Menu: ${window.RestroCounter?.menuStyle?.name || 'Pills on top'}`; };
  window.addEventListener('restro:counter-style-changed', syncCounterSummary);
  syncCounterSummary();
  // (a new size of the screen: the pictures again)
  let relaying = 0;
  addEventListener('resize', () => { if (!dialog.open || !['orders', 'counter', 'navigation'].includes(current)) return; cancelAnimationFrame(relaying); relaying = requestAnimationFrame(() => builders[current]?.()); });

  // ---------- Kitchen: the kitchen prep time (Update Pack 3; before, under Orders) ----------
  // One time for every order, or one per order type (owner, 10 Nov 2026), 5 to 240 minutes in 5s. Past it, an order in
  // the kitchen shows late in Orders (from when the kitchen printer got its KOT); a scheduled order goes to the kitchen
  // this long before it is due. The restaurant's (every tablet's). (One time before: restro.counter.prepMinutes.v1, kept
  // in step for the tablets not updated yet.)
  const KITCHEN_PREP_KEY = 'restro.kitchen.prep.v1', OLD_PREP_KEY = 'restro.counter.prepMinutes.v1';
  const PREP_TYPES = [['dine-in', 'Dine-in'], ['takeaway', 'Takeaway'], ['delivery', 'Delivery'], ['phone', 'Phone order']];
  const prepClean = n => { if (n == null || n === '') return null; n = Number(n); return Number.isFinite(n) ? Math.min(240, Math.max(5, Math.round(n / 5) * 5)) : null; };
  const readJson = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  function readKitchenPrep() {
    const k = readJson(KITCHEN_PREP_KEY), one = prepClean(k?.minutes) ?? prepClean(readJson(OLD_PREP_KEY)) ?? 30;
    return { mode: k?.mode === 'type' ? 'type' : 'one', minutes: one, byType: Object.fromEntries(PREP_TYPES.map(([t]) => [t, prepClean(k?.byType?.[t]) ?? one])) };
  }
  function saveKitchenPrep(change) {
    const p = readKitchenPrep(); change(p);
    try { localStorage.setItem(KITCHEN_PREP_KEY, JSON.stringify(p)); localStorage.setItem(OLD_PREP_KEY, JSON.stringify(p.minutes)); } catch {}
    window.RestroSync?.wrote(KITCHEN_PREP_KEY); window.RestroSync?.wrote(OLD_PREP_KEY);
    prepSeen = JSON.stringify(p);
    window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: p.minutes }));
    builders.kitchen();
  }
  const kitchenHost = document.querySelector('#settings-kitchen');
  const MINUS = '<path d="M6 12h12"/>', PLUS = '<path d="M12 6v12M6 12h12"/>';
  builders.kitchen = () => rebuild(kitchenHost, () => {
    const p = readKitchenPrep();
    const stepper = (id, name, value, change) => el('div', { class: 'settings-stepper', role: 'group', 'aria-label': `${name} prep time` },
      el('button', { id: `${id}-down`, type: 'button', class: 'settings-step', 'aria-label': `${name}: 5 minutes less`, disabled: value <= 5, onclick: () => change(value - 5) }, line(MINUS)),
      el('output', {}, `${value} min`),
      el('button', { id: `${id}-up`, type: 'button', class: 'settings-step', 'aria-label': `${name}: 5 minutes more`, disabled: value >= 240, onclick: () => change(value + 5) }, line(PLUS)));
    const row = (id, name, value, change) => el('div', { class: 'st-row' }, el('span', { class: 'st-row-copy' }, el('strong', {}, name)), stepper(id, name, value, change));
    return [card('', lab('Kitchen prep time'), sub('Past it, an order in the kitchen turns late in Orders, counted from when the kitchen printer gets its KOT. A scheduled order goes to the kitchen this long before it is due.'),
      tiles('Kitchen prep time', [{ value: 'one', label: 'One for every order' }, { value: 'type', label: 'By order type' }], p.mode, m => saveKitchenPrep(q => { q.mode = m; })),
      el('div', { class: 'st-rows' }, p.mode === 'one'
        ? row('kitchen-prep', 'Every order', p.minutes, n => saveKitchenPrep(q => { q.minutes = n; for (const [t] of PREP_TYPES) q.byType[t] = q.byType[t] ?? n; }))
        : PREP_TYPES.map(([t, name]) => row(`kitchen-prep-${t}`, name, p.byType[t], n => saveKitchenPrep(q => { q.byType[t] = n; })))))];
  });
  // (changed on another tablet)
  let prepSeen = JSON.stringify(readKitchenPrep());
  window.addEventListener('restro:data-changed', event => {
    if (!(event.detail?.collections || []).includes('settings')) return;
    const now = JSON.stringify(readKitchenPrep()); if (now === prepSeen) return;
    prepSeen = now; window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: readKitchenPrep().minutes }));
    if (dialog.open && current === 'kitchen') builders.kitchen();
  });

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
      card('',
        switchHead('bill-pk-on', 'Packaging charge', 'Charge for packaging on the bill.', pkOn, on => setBilling(v => { v.packaging.on = on; }))),
      card(pkOn ? '' : 'dis',
        lab('Packaging details'), sub('Added to the bill before GST, and taxed at the food GST rate.'),
        el('div', { class: 'st-opts', role: 'radiogroup', 'aria-label': 'Packaging charge' }, [
          { id: 'flat', title: 'Flat per order', text: 'The same amount on every order of the types below.' },
          { id: 'dish', title: 'Per dish', text: 'Each dish’s own amount, set on the dish in Inventory.' }
        ].map(m => el('button', { type: 'button', class: 'st-opt', role: 'radio', 'aria-checked': String(pk.mode === m.id), disabled: !pkOn, onclick: () => setBilling(v => { v.packaging.mode = m.id; }) },
          el('span', { class: 'st-rd' }), el('span', { class: 'st-opt-copy' }, el('b', {}, m.title), el('span', {}, m.text))))),
        pk.mode === 'flat' ? el('div', { class: 'st-two' }, amountField({ id: 'bill-pk-flat', label: 'Amount per order', value: pk.flat, disabled: !pkOn, change: n => setBilling(v => { v.packaging.flat = n; }) })) : null,
        el('div', { class: 'st-field' }, el('span', { class: 'st-flabel' }, 'Applies to'),
          el('div', { class: 'st-sgs', role: 'group', 'aria-label': 'Packaging applies to' }, [['takeaway', 'Takeaway'], ['delivery', 'Delivery'], ['phone', 'Phone order']].map(([t, name]) =>
            el('button', { type: 'button', class: 'st-sg', role: 'checkbox', 'aria-checked': String(pk.types.includes(t)), disabled: !pkOn,
              onclick: () => setBilling(v => { v.packaging.types = v.packaging.types.includes(t) ? v.packaging.types.filter(x => x !== t) : [...v.packaging.types, t]; }) }, pk.types.includes(t) ? line(CHECK) : null, name))))),
      card('',
        switchHead('bill-dl-on', 'Delivery charge', 'Charge for delivery on every delivery order.', dl.on, on => setBilling(v => { v.delivery.on = on; })),
        dl.on ? el('div', { class: 'st-two' }, amountField({ id: 'bill-dl-flat', label: 'Amount per delivery order', value: dl.flat, change: n => setBilling(v => { v.delivery.flat = n; }) })) : null),
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
          // (Update Pack 4, A3: a protected action asks "PIN required" only when the person signed in lacks its access;
          // anyone who has that access enters their own PIN. Never "Manager PIN".)
          el('p', {}, el('b', {}, 'PIN required'), 'Only when the person signed in lacks the access; anyone who has it enters their own PIN.', el('span', { class: 'st-tag' }, 'LATER'))))
    ];
  });

  // ---------- Display › Navigation (Navigation & Lock Update 1, N6/N7) ----------
  const navHost = document.querySelector('#settings-navigation');
  const NAV_ICONS = order => (order === 'back-right' ? ['nav-recent', 'nav-home', 'nav-back'] : ['nav-back', 'nav-home', 'nav-recent']);
  const navIcon = name => ms(name, 'nav-ico');
  // Each way as the whole screen shrunk to the tile (Update Pack 3, owner 10 Nov): the home screen as it is now (a still
  // copy of the top bar and the home, in its theme and background, as the Theme pictures), and over it the swipe line and
  // the round lock, or the black navigation bar (Back · Home · Recent apps in the order chosen, the lock at the right),
  // the home ending above it as it does with the bar (--nav-h)
  const stillCopy = node => { const copy = node.cloneNode(true); copy.style.removeProperty('transform');
    for (const part of [copy, ...copy.querySelectorAll('*')]) for (const name of ['autofocus', 'name', 'title', 'aria-live']) part.removeAttribute(name); return copy; };
  function navPic(kind, order) {
    const w = innerWidth, h = innerHeight, root = document.documentElement, banner = document.querySelector('#top-banner'), home = document.querySelector('#home');
    const box = el('span', { class: 'st-tile-pic home-preview st-navlive', 'aria-hidden': 'true', 'data-w': String(w), 'data-home-theme': root.dataset.homeTheme || 'white', 'data-home-background': root.dataset.homeBackground || 'default' });
    box.style.aspectRatio = `${w} / ${h}`;
    const screen = el('span', { class: 'home-live-screen' }), shell = document.querySelector('.app-shell'), look = shell ? getComputedStyle(shell) : null;
    screen.inert = true; screen.style.width = `${w}px`; screen.style.height = `${h}px`; screen.style.setProperty('--nav-h', kind === 'bar' ? 'calc(56 * var(--fu))' : '0px');
    if (look) for (const name of inheritedLooks) screen.style.setProperty(name, look.getPropertyValue(name));
    if (banner && home) screen.append(stillCopy(banner), stillCopy(home));
    screen.append(...(kind === 'bar'
      ? [el('span', { class: 'st-navbar' }, el('span', { class: 'keys' }, NAV_ICONS(order).map(navIcon)), el('span', { class: 'lk' }, navIcon('nav-lock')))]
      : [el('span', { class: 'st-navpill' }), el('span', { class: 'st-navlock' }, navIcon('nav-lock'))]));
    box.append(screen); fitLive.observe(box);
    return box;
  }
  builders.navigation = () => rebuild(navHost, () => {
    const n = Prefs.get('navigation'), dark = Prefs.get('screen').goDark, bar = n.mode === 'bar';
    const modes = radioGrid('How staff move between screens and apps', [
      { id: 'swipe', name: 'Swipe gestures', text: 'Default · swipe up for Home, from the side for Back, up and hold for Recent apps', pic: () => navPic('swipe', n.order) },
      { id: 'bar', name: 'Navigation bar', text: 'Back, Home and Recent apps buttons at the bottom · swipes are turned off', pic: () => navPic('bar', n.order) }],
      n.mode, mode => { Prefs.update('navigation', v => { v.mode = mode; }); builders.navigation(); syncSummaries(); });
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

  // ---------- Settings › Printers (Counter Update 7; Update Pack 3: its own page) ----------
  // The printers are the main system's, found by the RESTRO Android app (RESTRODevice.printer.list()). Each has a role
  // (bills, kitchen tickets or both), the language its kitchen tickets print in and how many copies of each.
  let printers = [], printerId = null;
  const printerSettings = id => Prefs.get('printers')[id] || { role: 'both', language: 'English', copies: 1 };
  const printerName = id => printers.find(p => p.id === id)?.name || 'Printer';
  const roleName = { bills: 'Bills', kitchen: 'Kitchen', both: 'Bills and kitchen' };
  const backupOf = s => (s.backup && s.role !== 'bills' ? ' · Backup printer' : '');
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
    rebuild(printersHost, () => [card('st-rowcard', lab('Printers'), sub('Connected to the main system. Tap one to choose what it prints.'), el('div', { class: 'st-rows' },
      ...(printers.length ? printers.map(p => {
        const s = printerSettings(p.id);
        return el('button', { type: 'button', class: 'st-row st-link', onclick: () => { printerId = p.id; show('printer', { focus: true }); } },
          el('span', { class: 'settings-row-icon' }, ms('ms-print')), el('span', { class: 'st-row-copy' }, el('strong', {}, p.name), el('span', {}, `${roleName[s.role]}${backupOf(s)}${kotOf(s)}${p.connection ? ` · ${p.connection}` : ''}`)), ms('ms-chevron-right', 'ms st-chev'));
      }) : [el('div', { class: 'st-row' }, el('span', { class: 'settings-row-icon' }, ms('ms-print')), el('span', { class: 'st-row-copy' }, el('strong', {}, 'No printers here'),
        el('span', {}, bridged ? 'The main system hasn’t found a printer yet.' : 'Printers connect to the main system through the RESTRO Android app.')))])))]);
  }
  const printerHost = document.querySelector('#settings-printer');
  const setPrinter = change => Prefs.update('printers', all => { const s = { ...printerSettings(printerId) }; change(s); all[printerId] = s; });
  builders.printer = () => rebuild(printerHost, () => {
    const s = printerSettings(printerId), kitchen = s.role !== 'bills';
    const again = () => { builders.printer(); };
    return [
      card('', lab('Role'), sub('What this printer prints.'),
        tiles('Printer role', [{ value: 'bills', label: 'Bills' }, { value: 'kitchen', label: 'Kitchen (KOT)' }, { value: 'both', label: 'Both' }], s.role, r => { setPrinter(x => { x.role = r; }); again(); })),
      card(kitchen ? '' : 'dis', lab('KOT language'), sub('Kitchen tickets print in this language. Other than English, a ticket prints as a picture, as thermal printers have no Indian-language fonts. Dish names come from Inventory; a dish without a name in this language prints in English.'),
        el('div', { class: 'st-langs' }, tiles('KOT language', Prefs.languages.map(l => ({ value: l, label: l })), s.language, l => { setPrinter(x => { x.language = l; }); again(); }, { disabled: !kitchen }))),
      card(kitchen ? '' : 'dis', lab('Copies per KOT'), sub('How many of each kitchen ticket it prints.'),
        tiles('Copies per KOT', [1, 2, 3].map(n => ({ value: n, label: String(n) })), s.copies, n => { setPrinter(x => { x.copies = n; }); again(); }, { disabled: !kitchen })),
      // (Update Pack 5, I2) one kitchen printer is the backup: turning it on here turns it off on any other
      card(kitchen ? '' : 'dis', switchHead('printer-backup', 'Use as backup printer', 'When another kitchen printer stops working for 30 seconds, its KOTs print here with this printer’s own. One printer can be the backup.',
        Boolean(s.backup) && kitchen, on => { Prefs.update('printers', all => { for (const id of Object.keys(all)) delete all[id].backup; all[printerId] = { ...printerSettings(printerId), ...(on ? { backup: true } : {}) }; if (!on) delete all[printerId].backup; }); again(); }),
        note('With no backup printer, or the backup down too, they print on the first kitchen printer that works.'))
    ];
  });
  builders.printers = () => { paintPrinters(); };

  // A setting changed (here, or on another tablet): the page on screen and the lines under the categories follow
  window.addEventListener('restro:prefs-changed', event => {
    syncSummaries();
    if (!dialog.open) return;
    const name = event.detail?.name;
    const page = { billing: 'billing', security: 'security', navigation: 'navigation', screen: 'navigation', printers: current === 'printer' ? 'printer' : 'printers', business: 'business', orders: 'orders', readyMessage: 'orders', counter: 'counter' }[name];
    if (page === current && page !== 'business') builders[page]?.();
    if (page === 'business' && current === 'business' && !document.querySelector('#business-form').contains(document.activeElement)) fillBusiness();
  });

  for (const entry of entries) entry.addEventListener('click', () => show(entry.dataset.page, { focus: !twoPane.matches }));
  dialog.querySelector('[data-open="navigation"]').addEventListener('click', () => show('navigation', { focus: true }));
  back.addEventListener('click', () => { if (parentOf(current)) show(parentOf(current), { focus: true }); else showList(); });
  document.querySelector('#settings-internet-check').addEventListener('click', async event => {
    const button = event.currentTarget, text = button.querySelector('span') || button; button.disabled = true; text.textContent = 'Checking…';
    try { await window.RestroConnectivity?.refresh?.(); } finally { button.disabled = false; text.textContent = 'Check now'; syncSummaries(); }
  });
  document.querySelector('#settings-brightness-range').addEventListener('input', event => window.RestroDeviceControls?.setBrightness(event.target.value));

  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    window.RestroThemePicker?.reset();
    for (const host of [ordersHost, counterHost, navHost]) host?.replaceChildren(); // (the pictures go with the page)
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
