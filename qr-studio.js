'use strict';
// QR Studio (Update Pack 5: E, G, I1, I3, I4, J; the Light screens QS1–QS6 and QS16–QS53).
// One Takeaway QR, one Menu QR and one Table QR for each table of the floor plan. Customers scan the Menu QR to see the
// menu, and a Table or Takeaway QR to order and pay; the KOT prints (Dine-in / Takeaway) once payment is confirmed.
//
// - The QRs: restro.qr.v1, the restaurant's (synced, the collection 'qr'): a list of
//     { id, kind: 'table' | 'takeaway' | 'menu', table (a table QR's table: its permanent id, so renaming or renumbering
//       a table never breaks a printed QR), code (6 characters), path ('<restaurant>/<T7 | TK | MN>-<code>'), name (the
//       table's name as on the printed card), createdAt, createdBy, replacedAt, replacedBy, printedAt, printedBy (black
//       and white, on the receipt printer), sentAt, sentBy (the colour PDF), quietOk (the quiet-QR warning hidden until
//       then) }.
//   Its link is https://<our website>/<path>. The domain is still to be decided (J), so example.com stands in for it.
//   Replace gives the QR a new code (the old one stops working); Delete removes it. The cloud keeps which codes work.
// - QR ordering: restro.qrOrdering.v1, the restaurant's (synced): { off: { until (ms; null: until turned on), choice,
//   by, at } | null, late: { by, at } | null }. It follows the business hours and the last order time by itself (I3), and
//   pauses by itself while no path reaches a kitchen printer (I1).
// - Scans come from the cloud (RestroQrStudio.scanned, ANDROID-BRIDGE.md); each device keeps them: restro.qrScans.v1.
// - The path for QR orders (internet → printer device → kitchen printer) comes from the Android app:
//   RestroQrStudio.path(status) or a restro:qr-path event (ANDROID-BRIDGE.md).
// Nothing here is part of the code or the website's data: it stays on the devices until the cloud exists.
(() => {
  const dialog = document.querySelector('#qr-studio-dialog');
  if (!dialog) return;
  const KEY = 'restro.qr.v1', ORDERING_KEY = 'restro.qrOrdering.v1', SCANS_KEY = 'restro.qrScans.v1';
  const HOST = 'example.com';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no 0 / O, 1 / I / L: easy to type from the card)
  const MIN = 60000, DAY = 864e5;
  // (J: fixed defaults, no settings) a quiet QR: no scan in 3 open days; "Card is fine" hides it for 7 days. A test scan
  // waits 1 minute. (I1) QR ordering turns back on once the path has worked for about 10 s.
  const QUIET_DAYS = 3, QUIET_HIDE = 7 * DAY, TEST_WAIT = 60000, RESUME_AFTER = 10000;
  const CUSTOMER_PAUSED = 'QR ordering is paused. Please reach out to staff.';
  const KINDS = {
    table: { prefix: 'T', accent: '#9A6B1F', heading: 'Scan · Order · Pay', lines: ['Scan, pick your dishes and pay.', 'Your food comes to your table.'],
      note: 'Need a waiter or the bill? Tap the bell on the menu', icon: 'fork' },
    takeaway: { prefix: 'TK', accent: '#2E7D4F', heading: 'Scan · Order · Pay', title: 'Takeaway', lines: ['Scan, pick your dishes and pay.', 'Collect your order at the counter.'], icon: 'bag' },
    menu: { prefix: 'MN', accent: '#8E1E3C', heading: 'Scan to see our menu', title: 'Menu', lines: ['See all our dishes and prices.', 'Always up to date.'], icon: 'menu' }
  };

  // ---------- small helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const NS = 'http://www.w3.org/2000/svg';
  // Icons on a 24 grid: s = drawn with lines, f = filled; m = Material Symbols (Apache 2.0) on their 960 grid
  const ICONS = {
    home: ['s', '<path d="M4.5 11.2 L12 4.6 L19.5 11.2 V18.4 a1.6 1.6 0 0 1 -1.6 1.6 H14.6 V15.4 a2.6 2.6 0 0 0 -5.2 0 V20 H6.1 a1.6 1.6 0 0 1 -1.6 -1.6 Z"/>'],
    table: ['f', '<path d="M2.6 5.6c0-.6.5-1.1 1.1-1.1h16.6c.6 0 1.1.5 1.1 1.1v2.2c0 .6-.5 1.1-1.1 1.1H3.7c-.6 0-1.1-.5-1.1-1.1z"/><path d="M5.2 8.9h2.5l-.8 10.6H4.4zM16.3 8.9h2.5l.8 10.6h-2.5z"/><path d="M6.8 12.2h10.4v2H6.8z"/>'],
    bag: ['f', '<path fill-rule="evenodd" d="M5.4 8.2h13.2l1 12.1a1.6 1.6 0 0 1-1.6 1.7H6a1.6 1.6 0 0 1-1.6-1.7zm3.4 3.3a3.2 3.2 0 0 0 6.4 0h-1.7a1.5 1.5 0 0 1-3 0z"/><path d="M8.6 9V7a3.4 3.4 0 0 1 6.8 0v2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'],
    menu: ['s', '<rect x="4" y="3.5" width="16" height="17" rx="2.2"/><path d="M12 3.5v17M7.2 8h2.2M7.2 11.5h2.2M14.6 8h2.2M14.6 11.5h2.2"/>'],
    palette: ['s', '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.3-2.9h2a4.4 4.4 0 0 0 4.4-4.4C20.9 6.6 16.9 3.2 12 3.2z"/><circle cx="7.6" cy="11.3" r="1.25" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.6" r="1.25" fill="currentColor" stroke="none"/>'],
    print: ['s', '<path d="M7 8.2V3.8h10v4.4"/><path d="M7 17H5.2A2.2 2.2 0 0 1 3 14.8v-4.4a2.2 2.2 0 0 1 2.2-2.2h13.6a2.2 2.2 0 0 1 2.2 2.2v4.4a2.2 2.2 0 0 1-2.2 2.2H17"/><path d="M7 13.6h10v6.6H7z"/>'],
    send: ['s', '<path d="M3.8 4.4 20.6 12 3.8 19.6 6.4 12z"/><path d="M6.4 12h7.2"/>'],
    scan: ['s', '<path d="M3.8 8V5.4c0-.9.7-1.6 1.6-1.6H8M16 3.8h2.6c.9 0 1.6.7 1.6 1.6V8M20.2 16v2.6c0 .9-.7 1.6-1.6 1.6H16M8 20.2H5.4c-.9 0-1.6-.7-1.6-1.6V16"/><path d="m8.4 12.3 2.5 2.5 4.8-5"/>'],
    replace: ['s', '<path d="M10 4.3a7.8 7.8 0 0 0-5.3 11.8"/><path d="m4.2 12.6.5 3.5 3.4-.8"/><path d="M14 19.7a7.8 7.8 0 0 0 5.3-11.8"/><path d="m19.8 11.4-.5-3.5-3.4.8"/>'],
    trash: ['m', 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z'],
    pause: ['f', '<rect x="6.4" y="4.8" width="4" height="14.4" rx="1.3"/><rect x="13.6" y="4.8" width="4" height="14.4" rx="1.3"/>'],
    plus: ['s', '<path d="M12 5v14M5 12h14"/>'],
    grid: ['s', '<rect x="4.2" y="4.2" width="6.4" height="6.4" rx="1.8"/><rect x="13.4" y="4.2" width="6.4" height="6.4" rx="1.8"/><rect x="4.2" y="13.4" width="6.4" height="6.4" rx="1.8"/><path d="M13.6 13.4h1.6v2.2M19.8 13.4v6.4h-6.2"/>'],
    check: ['s', '<path d="m5 12.6 4.6 4.6L19.2 7.6"/>'],
    close: ['s', '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>'],
    search: ['s', '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.6 4.6"/>'],
    chevron: ['s', '<path d="m9.5 6 6 6-6 6"/>'],
    arrow: ['s', '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>'],
    wifi: ['s', '<path d="M2.6 9.2a13.6 13.6 0 0 1 18.8 0M5.8 12.6a9 9 0 0 1 12.4 0M9 16a4.4 4.4 0 0 1 6 0"/><circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none"/>'],
    monitor: ['s', '<rect x="3" y="4" width="18" height="12.4" rx="2"/><path d="M12 16.4V20M8 20h8"/>'],
    clock: ['s', '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 2"/>'],
    fork: ['f', '<path d="M5.6 2.8h1.5v5.6h1V2.8h1.5v5.6h1V2.8h1.5v6.3a3 3 0 0 1-2.1 2.9v9.2H7.8V12a3 3 0 0 1-2.2-2.9z"/><path d="M17.9 2.8c-2.2 1.3-3.3 4.1-3.3 7.6v3.3h2.4v7.5h2.2V2.8z"/>'],
    bell: ['f', '<path d="M12 3.2a1.4 1.4 0 0 1 1.4 1.4v.6a5.7 5.7 0 0 1 4.3 5.5v3.8l1.8 2.2v1.1H4.5v-1.1l1.8-2.2v-3.8a5.7 5.7 0 0 1 4.3-5.5v-.6A1.4 1.4 0 0 1 12 3.2zM9.8 19.2h4.4a2.2 2.2 0 0 1-4.4 0z"/>'],
    link: ['s', '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>'],
    mail: ['s', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.6 6.4 8.4 6.6 8.4-6.6"/>'],
    chat: ['m', 'm240-240-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Zm40-160h240q17 0 28.5-11.5T560-440q0-17-11.5-28.5T520-480H280q-17 0-28.5 11.5T240-440q0 17 11.5 28.5T280-400Zm0-120h400q17 0 28.5-11.5T720-560q0-17-11.5-28.5T680-600H280q-17 0-28.5 11.5T240-560q0 17 11.5 28.5T280-520Zm0-120h400q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720H280q-17 0-28.5 11.5T240-680q0 17 11.5 28.5T280-640Z']
  };
  function icon(name, cls = '') {
    const [kind, body] = ICONS[name], s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', kind === 'm' ? '0 -960 960 960' : '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `qi qi-${kind === 's' ? 'line' : 'fill'} qi-${name} ${cls}`.trim());
    s.innerHTML = kind === 'm' ? `<path d="${body}"/>` : body; return s;
  }
  const appArt = () => {
    const art = typeof artNode === 'function' && typeof apps !== 'undefined' && apps['qr-studio'] ? artNode({ ...apps['qr-studio'].art, plain: true }) : el('span');
    art.classList.add('qrs-title-icon'); return art;
  };

  // ---------- time words ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const clock = t => { const d = new Date(t), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const midnight = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const daysApart = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY);
  const dayMonth = t => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`; };
  // "today" or "8 Nov" (as the designs: "Replaced 8 Nov by ‹initials›" the day after)
  const dayWord = t => (daysApart(t, Date.now()) === 0 ? 'today' : dayMonth(t));
  // "Fri 6 Nov"
  const weekdayDate = t => { const d = new Date(t); return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const who = () => window.RestroStaff?.current?.name || null;
  const byWho = name => (name ? ` by ${name}` : '');

  // ---------- the floor: its areas and tables (Floor app, floor-data.js) ----------
  // A table renamed or renumbered in Floor keeps its id; Floor notes it on the table as renamed: { at, by }.
  function floor() {
    const plan = window.RestroFloorPlan && Array.isArray(window.RestroFloorPlan.areas) ? window.RestroFloorPlan : { areas: [] };
    const areas = plan.areas.filter(a => a && a.id != null).map(a => ({ id: String(a.id), name: String(a.name || ''),
      tables: (Array.isArray(a.tables) ? a.tables : []).filter(t => t && t.id != null).map(t => ({ id: String(t.id), name: String(t.name ?? t.id), area: String(a.id), renamed: t.renamed && typeof t.renamed === 'object' ? t.renamed : null })) }));
    return { areas, tables: areas.flatMap(a => a.tables) };
  }
  const tableLabel = name => `Table ${name}`;
  // "Tables 1–10", "Tables 7, 8, 9", "Tables 7, 8 and 9": 4 or more numbers in a row join
  function numbersText(names, joiner = ', ') {
    const nums = names.map(n => (/^\d+$/.test(n) ? Number(n) : NaN));
    if (names.length >= 4 && nums.every(Number.isFinite) && nums.every((n, i) => !i || n === nums[i - 1] + 1)) return `${names[0]}–${names.at(-1)}`;
    if (joiner === ' and ' && names.length > 1) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return names.join(joiner);
  }
  const tablesText = (names, joiner) => `${names.length === 1 ? 'Table' : 'Tables'} ${numbersText(names, joiner)}`;

  // ---------- the QRs ----------
  const okRecord = r => r && typeof r.id === 'string' && KINDS[r.kind] && typeof r.code === 'string' && (r.kind !== 'table' || typeof r.table === 'string');
  let records = [];
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); records = Array.isArray(v) ? v.filter(okRecord) : []; } catch { records = []; } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(records)); } catch {} window.RestroSync?.wrote(KEY); changed(); }
  load();
  const qrOfTable = id => records.find(r => r.kind === 'table' && r.table === id) || null;
  const qrOfKind = kind => records.find(r => r.kind === kind) || null;
  function newCode() {
    const bytes = new Uint8Array(6); (window.crypto || {}).getRandomValues?.(bytes);
    let code = ''; for (const b of bytes) code += CODE_CHARS[(b || Math.floor(Math.random() * 256)) % CODE_CHARS.length];
    return records.some(r => r.code === code) ? newCode() : code;
  }
  const slug = () => (window.RestroRestaurantName?.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'restaurant';
  const pathFor = (kind, name, code) => `${slug()}/${kind === 'table' ? `T${String(name).replace(/[^A-Za-z0-9]+/g, '')}` : KINDS[kind].prefix}-${code}`;
  const linkOf = r => `${HOST}/${r.path}`, urlOf = r => `https://${linkOf(r)}`;
  const newId = () => `qr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // (the card on the table, as printed or sent last: printed or sent since the QR was made)
  const printedOf = r => Math.max(Number(r.printedAt) || 0, Number(r.sentAt) || 0);
  const notPrinted = r => !printedOf(r);
  function makeQr(kind, table) {
    const code = newCode(), at = Date.now();
    const r = { id: newId(), kind, code, path: pathFor(kind, table?.name, code), createdAt: at, createdBy: who() };
    if (table) { r.table = table.id; r.name = table.name; }
    return r;
  }

  // ---------- scans (from the cloud) ----------
  // { <code>: { last, day, today, usual } }: the last scan, today's count (day: its business day) and how many scans the
  // QR usually gets on an open day (the cloud's figure; none until it has a normal history)
  let scans = {};
  function loadScans() { try { const v = JSON.parse(localStorage.getItem(SCANS_KEY) || '{}'); scans = v && typeof v === 'object' ? v : {}; } catch { scans = {}; } }
  loadScans();
  const businessDay = t => window.RestroPrefs?.businessDay?.(t) || new Date(t).toISOString().slice(0, 10);
  const scanOf = r => { const s = scans[r.code]; if (!s) return null; return { last: Number(s.last) || 0, today: s.day === businessDay(Date.now()) ? Number(s.today) || 0 : 0, usual: Number(s.usual) || 0 }; };

  // ---------- business hours (Settings › Business hours, I3) ----------
  const dayKeyOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKeyOf(new Date(y, m - 1, d + n).getTime()); };
  const hoursOn = key => window.RestroPrefs?.hoursOn?.(key) || null;
  const lastOrderOn = key => window.RestroPrefs?.lastOrderOn?.(key) ?? null;
  // The next opening from a moment: { at, key } (within two weeks), or null when the restaurant never opens
  function nextOpening(t) {
    const start = businessDay(t);
    for (let i = 0; i < 15; i++) { const key = addDays(start, i), h = hoursOn(key); if (h && h.from > t) return { at: h.from, key }; }
    return null;
  }
  const hoursText = h => `${clock(h.from)} – ${clock(h.to)}`;
  // "tomorrow at 11:00 AM" / "today at 7:00 PM" / "Wednesday at 11:00 AM" (and the short "tomorrow 11:00 AM", "Wed 11:00 AM")
  function openingWords(at, short = false, byName = false) {
    const n = daysApart(Date.now(), at), day = WEEKDAYS[new Date(at).getDay()];
    const when = n === 0 ? 'today' : n === 1 && !byName ? 'tomorrow' : short ? day.slice(0, 3) : day;
    return short ? `${when} ${clock(at)}` : `${when} at ${clock(at)}`;
  }

  // ---------- the path for QR orders (I1) ----------
  // From the Android app (ANDROID-BRIDGE.md): { internet, wifiInternet, mobileVia, printers: [{ id, name, link: 'wired' |
  // 'wifi', state: 'ok' | 'down', paper: 'ok' | null, device: { name, on, lastSeen } (a wired printer's), backup }] }.
  // Without it the page knows only its own internet, and takes the kitchen printers as working.
  let path = null, pathOkSince = 0, autoSince = 0, offlineSince = 0;
  const internetHere = () => window.RestroConnectivity?.getStatus?.().internetAvailable !== false;
  // (on its own, a device counts the internet as gone once it has been gone 30 s: not while it starts up, not for a blip)
  function pathNow(now = Date.now()) {
    if (path) return path;
    if (internetHere()) offlineSince = 0; else if (!offlineSince) offlineSince = now;
    const internet = !offlineSince || now - offlineSince < 30000;
    return { internet, wifiInternet: internet, mobileVia: null, printers: [] };
  }
  // Why no QR order can come in, or null: 'internet' | 'device' (the printer device is off) | 'wired' (the kitchen printer
  // isn't connected) | 'wifi' (the Wi-Fi kitchen printer can't be reached) | 'printers' (no kitchen printer works)
  function brokenStep(p = pathNow()) {
    if (!p.internet) return 'internet';
    const kitchen = p.printers || [];
    if (!kitchen.length || kitchen.some(k => k.state === 'ok' && (k.link !== 'wired' || k.device?.on !== false))) return null;
    if (kitchen.length > 1) return 'printers';
    const k = kitchen[0];
    return k.link === 'wired' ? (k.device?.on === false ? 'device' : 'wired') : 'wifi';
  }
  const REASONS = {
    internet: { banner: 'no internet in the restaurant', card: 'no internet', devices: 'QR orders can’t come in · no internet' },
    device: { banner: 'the printer device is off', card: 'printer device is off', devices: 'KOTs can’t print · the printer device is off' },
    wired: { banner: 'kitchen printer not connected', card: 'kitchen printer not connected', devices: 'KOTs can’t print · kitchen printer not connected' },
    wifi: { banner: 'kitchen printer not reachable', card: 'kitchen printer not reachable', devices: 'KOTs can’t print · kitchen printer not reachable' },
    printers: { banner: 'no kitchen printer is working', card: 'no kitchen printer is working', devices: 'KOTs can’t print · no kitchen printer is working' }
  };
  // The automatic pause: from the moment the path broke until it has worked again for about 10 s
  let lastBroken = null;
  function autoPause(now = Date.now()) {
    const broken = brokenStep();
    if (broken) { pathOkSince = 0; lastBroken = broken; if (!autoSince) autoSince = Number(path?.since) || now; return { reason: broken, since: autoSince }; }
    if (!autoSince) return null;
    if (!pathOkSince) pathOkSince = now;
    if (now - pathOkSince >= RESUME_AFTER) { autoSince = 0; pathOkSince = 0; return null; }
    return { reason: lastBroken || 'internet', since: autoSince };
  }

  // ---------- QR ordering: on, paused, off by hand, paused by itself, closed (I1, I3) ----------
  function readOrdering() {
    try { const v = JSON.parse(localStorage.getItem(ORDERING_KEY) || 'null'); if (v && typeof v === 'object') return { off: v.off && typeof v.off === 'object' ? v.off : null, late: v.late && typeof v.late === 'object' ? v.late : null }; } catch {}
    return { off: null, late: null };
  }
  function writeOrdering(v) { try { localStorage.setItem(ORDERING_KEY, JSON.stringify(v)); } catch {} window.RestroSync?.wrote(ORDERING_KEY); changed(); }
  // Where QR ordering stands now: { state: 'on' | 'late' | 'paused' | 'hand' | 'auto' | 'closed', ... }
  function ordering(now = Date.now()) {
    const o = readOrdering();
    const key = businessDay(now), h = hoursOn(key), last = lastOrderOn(key);
    let closed = null;
    if (!h) closed = { why: 'weekly', key };
    else if (now < h.from) closed = { why: 'before', h };
    else if (last != null && now >= last) closed = { why: last < h.to ? 'last' : 'after', h, last };
    // (a pause for a while ends by itself; "Until turned on" stays until someone turns it on; turned on after hours lasts
    // until the next opening time, when the business hours take over again)
    const off = o.off && (o.off.until == null || o.off.until > now) ? o.off : null;
    const late = o.late && (!o.late.until || o.late.until > now) ? o.late : null;
    if (off && off.until == null) return { state: 'hand', off, closed };
    if (closed && !late) return { state: 'closed', closed, h, last, off };
    if (off) return { state: 'paused', off, closed };
    const auto = autoPause(now);
    if (auto) return { state: 'auto', auto };
    return closed ? { state: 'late', late, closed } : { state: 'on', h, last };
  }

  // ---------- what needs looking at (the home badge, J) ----------
  // Quiet QRs (no scan in 3 open days, for a QR with a normal scan history), tables renamed since their card was
  // printed, and QR ordering paused by itself (not while closed). Each clears by itself once fixed.
  function openDaysSince(t, now = Date.now()) {
    let n = 0, key = businessDay(t);
    const today = businessDay(now);
    for (let i = 0; i < 60 && key !== today; i++) { key = addDays(key, 1); const h = hoursOn(key); if (h && h.from <= now) n++; }
    return n;
  }
  function quietOf(r, now = Date.now()) {
    const s = scanOf(r);
    if (!s || !s.last || !s.usual || notPrinted(r) || (Number(r.quietOk) || 0) > now) return null;
    return openDaysSince(s.last, now) >= QUIET_DAYS ? s : null;
  }
  const renamedOf = (r, table) => (r.kind === 'table' && table && !notPrinted(r) && table.name !== r.name ? table : null);
  function attention(now = Date.now()) {
    const { tables } = floor(); let n = 0;
    for (const r of records) {
      if (r.kind === 'table') { const t = tables.find(x => x.id === r.table); if (!t) continue; if (renamedOf(r, t)) { n++; continue; } }
      if (quietOf(r, now)) n++;
    }
    if (ordering(now).state === 'auto') n++;
    return n;
  }

  // ---------- drawing a QR ----------
  // Error correction H, so the mark in the middle (the table's number) still scans. Modules as one path.
  const qrCache = new Map();
  function modules(text) {
    if (qrCache.has(text)) return qrCache.get(text);
    let rows = null;
    try {
      const q = qrcode(0, 'H'); q.addData(text); q.make();
      const n = q.getModuleCount(); rows = [];
      for (let r = 0; r < n; r++) { let line = ''; for (let c = 0; c < n; c++) line += q.isDark(r, c) ? '1' : '0'; rows.push(line); }
    } catch {}
    qrCache.set(text, rows); return rows;
  }
  // The mark's tile: about 30% of the QR a side (an odd number of modules, so it sits on the modules), with one module
  // cleared round it (error correction H takes it)
  const markTile = n => { const tile = Math.round(n * 0.3) | 1; return { tile, clear: tile + 2 }; };
  // The QR as an SVG (its own quiet zone left to the page), with the mark's tile in the middle: a rounded square in the
  // QR type's colour, the modules round it cleared
  function qrSvg(text, mark, accent, cls = '') {
    const rows = modules(text), s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', `qrs-qr ${cls}`.trim()); s.setAttribute('aria-hidden', 'true');
    if (!rows) return s;
    const n = rows.length; s.setAttribute('viewBox', `0 0 ${n} ${n}`); s.setAttribute('shape-rendering', 'crispEdges');
    const { tile, clear } = mark ? markTile(n) : { tile: 0, clear: 0 }, c0 = (n - clear) / 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (rows[r][c] !== '1') continue;
      if (mark && r >= c0 && r < c0 + clear && c >= c0 && c < c0 + clear) continue;
      d += `M${c} ${r}h1v1h-1z`;
    }
    s.innerHTML = `<path d="${d}" fill="#111111"/>`;
    if (mark) {
      const t0 = (n - tile) / 2;
      s.insertAdjacentHTML('beforeend', `<rect x="${t0 - 0.35}" y="${t0 - 0.35}" width="${tile + 0.7}" height="${tile + 0.7}" rx="${tile * 0.2}" fill="#FFFFFF"/>`
        + `<rect x="${t0}" y="${t0}" width="${tile}" height="${tile}" rx="${tile * 0.16}" fill="${accent}"/>`
        + `<text x="${n / 2}" y="${n / 2}" dy="0.36em" text-anchor="middle" fill="#FFFFFF" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${tile * (String(mark).length > 2 ? 0.5 : String(mark).length > 1 ? 0.62 : 0.74)}" shape-rendering="geometricPrecision">${String(mark).replace(/[<&>]/g, '')}</text>`);
    }
    return s;
  }
  const qrMark = r => (r.kind === 'table' ? r.name : null);

  // ---------- the printed card (the screens' preview and the colour PDF's look) ----------
  // Drawn on the 426-wide Takeaway card of the designs (--cu, card units) and scaled to where it shows
  function cardEl(r, opts = {}) {
    const k = KINDS[r.kind], name = r.kind === 'table' ? tableLabel(r.name) : k.title, restaurant = window.RestroRestaurantName?.value || '';
    const logo = (Array.from(restaurant.trim())[0] || 'R').toLocaleUpperCase('en-IN');
    return el('div', { class: `qrs-card k-${r.kind}${opts.sample ? ' sample' : ''}`, style: `--accent:${k.accent}`, role: 'img', 'aria-label': `${name} card: ${linkOf(r)}` },
      el('div', { class: 'qrs-card-brand' }, el('span', { class: 'qrs-card-logo' }, logo), el('span', { class: 'qrs-card-name' }, restaurant)),
      el('div', { class: 'qrs-card-head' }, k.heading),
      qrSvg(urlOf(r), qrMark(r), k.accent, 'qrs-card-qr'),
      el('div', { class: 'qrs-card-title' }, icon(k.icon, 'qrs-card-ti'), el('span', {}, name)),
      el('div', { class: 'qrs-card-lines' }, k.lines.map(l => el('span', {}, l))),
      k.note ? el('div', { class: 'qrs-card-note' }, el('span', { class: 'qrs-card-bell' }, icon('bell')), el('span', {}, k.note)) : null,
      el('div', { class: 'qrs-card-rule' }),
      el('div', { class: 'qrs-card-type' }, 'QR not scanning? Type this link'),
      el('div', { class: 'qrs-card-link' }, icon('link'), el('span', {}, linkOf(r))));
  }

  // ---------- what the screen shows ----------
  // page: 'table' | 'takeaway' | 'menu'; area: 'all' or an area's id; picked: the QR ids ticked after a long-press (Set),
  // or null; selected: the table QR the panel shows
  const view = { page: 'table', area: 'all', search: '', picked: null, selected: null };
  let root = null, pop = null, toastTimer = 0, tick = 0;
  const greyed = (label, why) => ({ disabled: true, 'aria-disabled': 'true', title: why || null, 'aria-label': why ? `${label} · ${why}` : null });
  const online = () => internetHere();
  function btn(cls, label, onclick, ic, opts = {}) {
    const off = opts.off ? greyed(label, opts.why) : {};
    const text = opts.why && opts.off && opts.showWhy ? el('span', { class: 'qrs-btn-t' }, el('span', {}, label), el('small', {}, opts.why)) : el('span', {}, label);
    return el('button', { type: 'button', class: `qrs-btn ${cls}`.trim(), onclick: opts.off ? null : onclick, ...off, 'aria-pressed': opts.pressed ?? null }, ic ? icon(ic, 'qrs-btn-i') : null, text);
  }

  // The sidebar: one floating white panel (G): home · the app's icon · Studio; the pills; the QR ordering card
  function sideEl(st) {
    const { tables } = floor();
    const count = { table: records.filter(r => r.kind === 'table' && tables.some(t => t.id === r.table)).length, takeaway: qrOfKind('takeaway') ? 1 : 0, menu: qrOfKind('menu') ? 1 : 0 };
    const pill = (page, ic, label) => el('button', { type: 'button', class: `qrs-pill${view.page === page ? ' on' : ''}`, 'aria-current': view.page === page ? 'page' : null, onclick: () => go(page) },
      el('span', { class: 'qrs-pill-i' }, icon(ic)), el('span', { class: 'qrs-pill-t' }, label), el('span', { class: 'qrs-pill-n' }, String(count[page])));
    return el('aside', { class: 'qrs-side' },
      el('div', { class: 'qrs-sh' }, el('button', { type: 'button', class: 'qrs-home', 'aria-label': 'Home', onclick: goHome }, icon('home')), appArt(), el('h2', { id: 'qr-studio-title', class: 'qrs-studio', tabindex: '-1' }, 'Studio')),
      el('nav', { class: 'qrs-pills', 'aria-label': 'QR types' }, pill('table', 'table', 'Table QRs'), pill('takeaway', 'bag', 'Takeaway QR'), pill('menu', 'menu', 'Menu QR'),
        // (Menu design: the templates are being redesigned, Pack 5 "don't build yet")
        el('button', { type: 'button', class: 'qrs-pill two', ...greyed('Menu design', 'Coming soon') }, el('span', { class: 'qrs-pill-i' }, icon('palette')), el('span', { class: 'qrs-pill-t' }, 'Menu design', el('small', {}, 'Coming soon')))),
      orderingCard(st));
  }
  const pauseBtn = (off = false) => btn('qrs-cbtn', 'Pause for a while', () => openPop('pause'), 'pause', { off });
  const untilWords = until => (daysApart(Date.now(), until) === 0 ? clock(until) : openingWords(until, true));
  // The QR ordering card (sidebar, bottom): the switch, where it stands, and what can be done
  function orderingCard(st) {
    const on = st.state === 'on' || st.state === 'late';
    let cls = '', line, text, buttons;
    const sw = el('button', { type: 'button', class: `qrs-switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': 'QR ordering', onclick: () => switchTapped(st), ...(st.state === 'auto' ? { 'aria-disabled': 'true' } : {}) }, el('span'));
    if (st.state === 'on') { line = el('b', { class: 'ok' }, `On · last orders ${clock(st.last ?? st.h.to)}`); text = 'Follows your business hours. Table and Takeaway QRs take paid orders; the Menu QR always works.'; buttons = [pauseBtn()]; }
    else if (st.state === 'late') { line = el('b', { class: 'ok' }, `On · turned on${byWho(st.late.by)} at ${clock(st.late.at)}`); text = 'Turned on by hand outside business hours, so it stays on until someone turns it off.'; buttons = [pauseBtn(true)]; }
    else if (st.state === 'paused') { line = el('b', { class: 'warn' }, `Paused until ${untilWords(st.off.until)}`); text = 'Customers can see the menu but can’t order.'; buttons = [btn('qrs-cbtn', 'Resume now', resume, 'send')]; }
    else if (st.state === 'hand') { line = el('b', { class: 'warn' }, `Off until turned on${st.off.by ? ` · by ${st.off.by}` : ''} at ${clock(st.off.at)}`); text = 'Turned off by hand, so it stays off until someone turns it on. Customers can see the menu but can’t order.'; buttons = [btn('qrs-cbtn', 'Turn on', resume, 'send')]; }
    else if (st.state === 'auto') { cls = ' auto'; line = el('b', { class: 'bad' }, `Paused · ${REASONS[st.auto.reason].card}`); text = `Paused by itself at ${clock(st.auto.since)}. It turns back on by itself.`; buttons = [btn('qrs-cbtn plain', 'See devices', () => openPop('devices')), pauseBtn()]; }
    else {
      const c = st.closed, next = nextOpening(Date.now()), hours = c.h ? `Business hours ${hoursText(c.h)} · last orders ${clock(c.last ?? c.h.to)}.` : '';
      if (c.why === 'weekly') { line = el('b', {}, `Closed today${next ? ` · opens ${openingWords(next.at, true, true)}` : ''}`); text = `${WEEKDAYS[new Date(Date.now()).getDay()]} is your weekly off in business hours.`; }
      else if (c.why === 'last') { line = el('b', {}, `Closed · last orders were ${clock(c.last)}`); text = `${hours}${next ? ` Opens ${openingWords(next.at, true)}.` : ''}`; }
      else { line = el('b', {}, `Closed${next ? ` · opens ${openingWords(next.at, true)}` : ''}`); const h = next ? hoursOn(next.key) : c.h; text = h ? `Business hours ${hoursText(h)} · last orders ${clock(lastOrderOn(next ? next.key : businessDay(Date.now())) ?? h.to)}.` : ''; }
      buttons = [pauseBtn(true)];
    }
    return el('section', { class: `qrs-ord${cls}`, 'aria-label': 'QR ordering' }, el('div', { class: 'qrs-ord-top' }, el('h3', {}, 'QR ordering'), sw), el('p', { class: 'qrs-ord-line' }, line), el('p', { class: 'qrs-ord-text' }, text), el('div', { class: 'qrs-ord-btns' }, buttons));
  }

  // The banner under a page's line while QR ordering isn't taking orders (I1, I3); the Menu QR's own (green)
  function bannerEl(st, page) {
    if (st.state === 'on' || st.state === 'late') return null;
    if (page === 'menu') return el('div', { class: 'qrs-banner good', role: 'status' }, el('span', { class: 'qrs-bn-i' }, icon('check')),
      el('div', {}, el('b', {}, 'Menu QR still works'), el('span', {}, `QR ordering is ${st.state === 'closed' ? 'closed' : 'paused'}, but customers can still see the menu and prices.`)));
    let cls, ic, title, text, action = null;
    if (st.state === 'paused') { cls = 'warn'; ic = el('span', { class: 'qrs-bn-i' }, icon('pause')); title = `QR ordering paused until ${untilWords(st.off.until)}`; text = `Customers see the menu with “${CUSTOMER_PAUSED}” Paid orders still go to the kitchen.`; action = btn('qrs-bn-btn', 'Resume now', resume, 'send'); }
    else if (st.state === 'hand') { cls = 'warn'; ic = el('span', { class: 'qrs-bn-i' }, icon('pause')); title = `QR ordering off until turned on · turned off${byWho(st.off.by)} at ${clock(st.off.at)}`; text = `Stays off until someone turns it on. Customers see the menu with “${CUSTOMER_PAUSED}”`; action = btn('qrs-bn-btn', 'Turn on', resume, 'send'); }
    else if (st.state === 'auto') { cls = 'bad'; ic = el('span', { class: 'qrs-bn-i' }, '!'); title = `QR ordering paused · ${REASONS[st.auto.reason].banner}`; text = `Paused by itself at ${clock(st.auto.since)} · turns back on by itself. Customers see “${CUSTOMER_PAUSED}”`; action = btn('qrs-bn-btn', 'See devices', () => openPop('devices')); }
    else {
      const c = st.closed, next = nextOpening(Date.now());
      cls = 'shut'; ic = el('span', { class: 'qrs-bn-i' }, icon('clock')); text = 'Turns on by itself at opening time.';
      title = c.why === 'weekly' ? `QR ordering closed today${next ? ` · opens ${openingWords(next.at, false, true)}` : ''}` : c.why === 'last' ? `QR ordering closed · last orders were at ${clock(c.last)}` : `QR ordering closed${next ? ` · opens ${openingWords(next.at)}` : ''}`;
    }
    return el('div', { class: `qrs-banner ${cls}`, role: 'status' }, ic, el('div', {}, el('b', {}, title), el('span', {}, text)), action);
  }

  // ---------- the pages ----------
  const headEl = (title, help, tools) => el('header', { class: 'qrs-head' }, el('div', { class: 'qrs-h' }, el('h1', {}, title), help), el('div', { class: 'qrs-tools' }, tools));

  // Table QRs (QS1, QS16–QS19, QS35–QS43)
  function tablePage(st) {
    const { areas, tables } = floor(), picking = Boolean(view.picked);
    if (view.area !== 'all' && !areas.some(a => a.id === view.area)) view.area = 'all';
    const area = areas.find(a => a.id === view.area) || null;
    const inArea = t => !area || t.area === area.id;
    const withQr = tables.filter(t => qrOfTable(t.id)), anyQr = withQr.length > 0;
    const shown = tables.filter(inArea), missing = shown.filter(t => !qrOfTable(t.id));
    const q = view.search.trim().toLowerCase();
    const cards = shown.filter(t => qrOfTable(t.id) && (!q || tableLabel(t.name).toLowerCase().includes(q) || t.name.toLowerCase().includes(q)));
    const pickedCount = picking ? view.picked.size : 0;
    const tools = picking
      ? [btn('del', 'Delete', () => openPop('delete-many'), 'trash', { off: !pickedCount || !online(), why: !online() ? 'Needs internet' : '', showWhy: true }), btn('', 'Cancel', stopPicking),
        btn('', 'Print', () => printQrs(pickedRecords()), 'print', { off: !pickedCount }), btn('blue', 'Send', () => openPop('send', { ids: [...view.picked] }), 'send', { off: !pickedCount || !online(), why: !online() ? 'Needs internet' : '' })]
      : [btn('', 'Print all', () => printQrs(tables.map(t => qrOfTable(t.id)).filter(Boolean)), 'print', { off: !anyQr }),
        btn('', 'Send all', () => openPop('send', { ids: tables.map(t => qrOfTable(t.id)?.id).filter(Boolean), all: true }), 'send', { off: !anyQr || !online(), why: anyQr && !online() ? 'Needs internet' : '' })];
    const help = el('button', { type: 'button', class: `qrs-help${pop?.kind === 'help' ? ' on' : ''}`, 'aria-label': 'About Table QRs', 'aria-expanded': String(pop?.kind === 'help'), onclick: () => openPop('help') }, '?');
    const kids = [headEl('Table QRs', help, tools), el('p', { class: 'qrs-line' }, 'One QR per table from your floor plan. Customers scan, order and pay. The KOT prints as Dine-in.'), bannerEl(st, 'table')];
    if (anyQr) {
      const chip = (id, label, n) => {
        const ticked = picking ? [...view.picked].filter(qid => { const r = records.find(x => x.id === qid); return r && (id === 'all' || tables.find(t => t.id === r.table)?.area === id); }).length : 0;
        return el('button', { type: 'button', class: `qrs-chip${view.area === id ? ' on' : ''}`, 'aria-pressed': String(view.area === id), onclick: () => { view.area = id; render(); } },
          el('span', {}, label), el('small', {}, String(n)), picking && id !== 'all' && ticked ? el('span', { class: 'qrs-chip-tick' }, String(ticked), icon('check')) : null);
      };
      const count = area ? `${area.name.toUpperCase()} · ${shown.filter(t => qrOfTable(t.id)).length} OF ${shown.length} HAVE A QR` : `${withQr.length} OF ${tables.length} HAVE A QR`;
      kids.push(el('div', { class: 'qrs-chips' }, chip('all', 'All', tables.length), areas.map(a => chip(a.id, a.name, a.tables.length)),
        el('label', { class: 'qrs-search' }, icon('search'), el('input', { type: 'search', placeholder: 'Search table', value: view.search, 'aria-label': 'Search table', autocomplete: 'off', oninput: e => { view.search = e.target.value; paintGrid(); } })),
        el('span', { class: 'qrs-count' }, count)));
    }
    const grid = el('div', { class: `qrs-grid${anyQr ? '' : ' first'}`, role: 'list' });
    if (!picking) {
      const allHave = !missing.length, every = area ? 'Every table here already has one' : 'Every table already has one';
      grid.append(
        el('button', { type: 'button', class: `qrs-tile one${allHave ? ' done' : ''}`, onclick: allHave ? null : () => openPop('create', { ids: [missing[0].id], one: true }), ...(allHave ? greyed('Create a table QR') : {}) },
          el('span', { class: 'qrs-tile-i' }, icon('plus')), el('b', {}, 'Create a table QR'), el('small', {}, allHave ? 'Every table already has one' : 'Pick one table from your floor')),
        el('button', { type: 'button', class: `qrs-tile all${allHave ? ' done' : ''}`, onclick: allHave ? null : () => openPop('create', { ids: missing.map(t => t.id) }), ...(allHave ? greyed('Create QRs for all tables') : {}) },
          el('span', { class: 'qrs-tile-i' }, icon('grid')), el('b', {}, 'Create QRs for all tables'), el('small', {}, allHave ? 'Every table already has one' : `Only tables without an active QR · ${missing.length}`)));
      void every;
    }
    if (anyQr) for (const t of cards) grid.append(tableCard(qrOfTable(t.id), t));
    else grid.append(firstInfo(tables.length));
    kids.push(el('div', { class: `qrs-scroll${anyQr ? '' : ' first'}` }, grid));
    // The bottom pill: the tables without a QR, every table has one, or how many are ticked
    if (picking) kids.push(el('div', { class: 'qrs-bpill picked', role: 'status' }, el('b', {}, `${pickedCount} selected`)));
    else if (missing.length) {
      const names = missing.map(t => tableLabel(t.name)), more = names.length > 6 ? names.length - 6 : 0;
      kids.push(el('div', { class: 'qrs-bpill', role: 'status' }, el('span', { class: 'qrs-bp-i' }, '!'), el('b', {}, `${missing.length} ${missing.length === 1 ? 'table' : 'tables'} without a QR`),
        el('span', { class: 'qrs-bp-names' }, names.slice(0, 6).join(', '), more ? ` +${more} more` : ''),
        el('button', { type: 'button', class: 'qrs-bp-go', onclick: () => openPop('create', { ids: missing.map(t => t.id) }) }, 'Create', icon('chevron'))));
    } else if (shown.length) kids.push(el('div', { class: 'qrs-bpill ok', role: 'status' }, el('span', { class: 'qrs-bp-i' }, icon('check')), el('b', {}, `All ${shown.length} ${area ? `${area.name} ` : ''}tables have a QR`)));
    return kids;
  }
  // The three cards under the tiles before the first table QR (QS17)
  function firstInfo(total) {
    return el('div', { class: 'qrs-first' },
      el('section', { class: 'qrs-info' }, el('h3', {}, 'Table QRs'), el('dl', {}, el('div', {}, el('dt', {}, 'Tables on your floor'), el('dd', {}, String(total))), el('div', {}, el('dt', {}, 'With a QR'), el('dd', {}, '0')), el('div', {}, el('dt', {}, 'Order type'), el('dd', {}, 'Dine-in')))),
      el('section', { class: 'qrs-info' }, el('h3', {}, 'Where to put it'), el('ul', {}, el('li', {}, 'On each table: a table card or a sticker'), el('li', {}, 'Each QR belongs to one table only'), el('li', {}, 'Not at the counter: use the Takeaway QR there'))),
      el('section', { class: 'qrs-info' }, el('h3', {}, 'What the customer gets'), el('ul', {}, el('li', {}, 'Menu → cart → pay, with the table already set'), el('li', {}, 'KOT prints as Dine-in the moment payment is confirmed'), el('li', {}, 'Call waiter and Ask for bill from the same QR'))));
  }
  // A table's card in the grid: its QR with the number, the table's name and Active; a tag on top when it needs looking at
  function tableCard(r, t) {
    const picking = Boolean(view.picked), ticked = picking && view.picked.has(r.id), sel = !picking && view.selected === r.id;
    const renamed = renamedOf(r, t), quiet = quietOf(r);
    const tag = notPrinted(r) ? el('span', { class: 'qrs-tag blue' }, 'Not printed yet') : renamed ? el('span', { class: 'qrs-tag red' }, `Now ${tableLabel(t.name)} · reprint the card`) : quiet ? el('span', { class: 'qrs-tag red' }, `Not scanned in ${QUIET_DAYS} days · check it`) : null;
    const card = el('div', { class: `qrs-tcard${sel ? ' sel' : ''}${ticked ? ' ticked' : ''}${picking ? ' picking' : ''}`, role: 'listitem', tabindex: '0', 'data-id': r.id,
      'aria-label': `${tableLabel(t.name)}${picking ? (ticked ? ', selected' : ', not selected') : ''}`, 'aria-pressed': picking ? String(ticked) : null },
      tag, picking ? el('span', { class: `qrs-tick${ticked ? ' on' : ''}`, 'aria-hidden': 'true' }, ticked ? icon('check') : null) : null,
      el('span', { class: 'qrs-tqr' }, qrSvg(urlOf(r), r.name, KINDS.table.accent)),
      el('span', { class: 'qrs-tname' }, el('b', {}, tableLabel(t.name)), el('span', { class: 'qrs-active' }, el('i'), 'Active')));
    holdable(card, () => tapCard(r), () => holdCard(r));
    return card;
  }
  function paintGrid() {
    // (typing in Search table: only the grid changes, so the box keeps its letters and the keyboard stays)
    const old = root?.querySelector('.qrs-main .qrs-grid'); if (!old) return;
    const kids = tablePage(ordering()); const fresh = kids.find(k => k?.classList?.contains('qrs-scroll'))?.querySelector('.qrs-grid');
    if (fresh) old.replaceWith(fresh);
  }

  // Takeaway QR and Menu QR (QS2, QS3, QS2b, QS3b, QS32–QS34, QS50, QS51)
  function onePage(st, kind) {
    const r = qrOfKind(kind), has = Boolean(r), name = kind === 'takeaway' ? 'Takeaway QR' : 'Menu QR';
    const why = !online() ? 'Needs internet' : '';
    const tools = [btn('', 'Test scan', () => openPop('test', { id: r.id }), 'scan', { off: !has || !online(), why: has ? why : '' }), btn('tint', 'Reprint', () => printQrs([r]), 'print', { off: !has }),
      btn('', 'Send', () => openPop('send', { ids: [r.id] }), 'send', { off: !has || !online(), why: has ? why : '' }), btn('', 'Replace QR', () => openPop('replace', { id: r.id }), 'replace', { off: !has }),
      btn('del', 'Delete', () => openPop('delete', { id: r.id }), 'trash', { off: !has || !online(), why: has ? why : '', showWhy: true })];
    const line = kind === 'takeaway' ? 'For the counter, the door or the waiting area. Takeaway orders only, so nobody can order to a table from here.' : 'View only. Customers see the menu with prices; they can’t order from it. Works even while QR ordering is paused.';
    const s = has ? scanOf(r) : null;
    const rows = [['Status', has ? el('b', { class: 'ok' }, 'Active') : el('span', { class: 'muted' }, 'Not created yet')],
      ['Last scanned', has && s?.last ? `${cap(dayWord(s.last))}, ${clock(s.last)}${s.today ? ` · ${s.today} today` : ''}` : has ? 'Not scanned yet' : '—']];
    if (has) rows.push(['Created', dayMonth(r.replacedAt || r.createdAt)], ['Last printed', printedOf(r) ? dayMonth(printedOf(r)) : 'Not yet']);
    rows.push(kind === 'takeaway' ? ['Order type', 'Takeaway'] : ['Ordering', 'Off (view only)']);
    const where = kind === 'takeaway' ? ['At the counter and the entrance', 'In the waiting area', 'Not on tables: use the Table QRs there'] : ['Windows, flyers, the entrance', 'Social media and Google listing (send it to your email)', 'Anywhere ordering isn’t wanted'];
    const gets = kind === 'takeaway' ? ['Menu → cart → pay by UPI or card', 'Order and KOT print the moment payment is confirmed', 'Confirmation with order number, by SMS / WhatsApp too'] : ['The live menu: sold-out dishes hidden, prices always current', 'No reprint needed when the menu or prices change'];
    const preview = has ? el('div', { class: 'qrs-big' }, cardEl(r))
      : el('div', { class: 'qrs-big' }, el('button', { type: 'button', class: `qrs-create k-${kind}`, style: `--accent:${KINDS[kind].accent}`, onclick: () => createOne(kind) },
        el('span', { class: 'qrs-create-i' }, icon('plus')), el('b', {}, `Create ${name}`), el('small', {}, kind === 'takeaway' ? 'One QR for takeaway orders' : 'One QR to view your menu')));
    return [headEl(name, null, tools), el('p', { class: 'qrs-line' }, line), bannerEl(st, kind),
      el('div', { class: 'qrs-one' }, preview, el('div', { class: 'qrs-facts' },
        el('section', { class: 'qrs-info rows' }, el('h3', {}, 'This QR'), el('dl', {}, rows.map(([a, b]) => el('div', {}, el('dt', {}, a), el('dd', {}, b))))),
        el('section', { class: 'qrs-info' }, el('h3', {}, 'Where to put it'), el('ul', {}, where.map(x => el('li', {}, x)))),
        el('section', { class: 'qrs-info' }, el('h3', {}, 'What the customer gets'), el('ul', {}, gets.map(x => el('li', {}, x)))),
        el('p', { class: 'qrs-note' }, el('b', {}, 'Reprint'), ' prints the same QR in black and white on the receipt printer; for colour, use ', el('b', {}, 'Send'), '. ', el('b', {}, 'Replace'), ' makes a new QR; the old one stops working.')))];
  }

  // ---------- the panel on the right (Table QRs) ----------
  // A box that tells what a table's QR needs (QS25, QS28, QS35, QS36)
  const statusBox = (cls, mark, title, body, actions) => el('div', { class: `qrs-sbox ${cls}`, role: 'status' },
    el('div', { class: 'qrs-sbox-h' }, el('span', { class: 'qrs-sbox-i' }, mark), el('b', {}, title)), body, actions ? el('div', { class: 'qrs-sbox-btns' }, actions) : null);
  function historyLine(r) {
    const made = r.replacedAt ? `Replaced ${dayWord(r.replacedAt)}${daysApart(r.replacedAt, Date.now()) === 0 ? ` ${clock(r.replacedAt)}` : ''}${byWho(r.replacedBy)}` : `Created ${dayWord(r.createdAt)}${byWho(r.createdBy)}`;
    const p = Number(r.printedAt) || 0, s = Number(r.sentAt) || 0;
    const card = p || s ? (s > p ? `last sent ${dayWord(s)}${byWho(r.sentBy)}` : `last printed ${dayWord(p)}${byWho(r.printedBy)}`) : r.replacedAt ? 'not printed yet' : 'not printed or sent yet';
    return `${made} · ${card}`;
  }
  function panelEl() {
    const { tables, areas } = floor();
    if (view.picked) {
      const order = new Map(tables.map((t, i) => [t.id, i])), list = pickedRecords().sort((a, b) => (order.get(a.table) ?? 999) - (order.get(b.table) ?? 999)), n = list.length;
      const byArea = areas.map(a => [a, list.filter(r => tables.find(t => t.id === r.table)?.area === a.id)]).filter(([, l]) => l.length);
      return el('aside', { class: 'qrs-panel picked', 'aria-label': 'Selected tables' },
        el('h2', { class: 'qrs-ptitle' }, `${n} ${n === 1 ? 'table' : 'tables'} selected`),
        el('p', { class: 'qrs-phist' }, byArea.map(([a, l]) => `${a.name}: ${l.map(r => r.name).join(', ')}`).join(' · ')),
        el('div', { class: `qrs-thumbs${n > 3 ? ' many' : ''}` }, list.map(r => el('div', { class: 'qrs-thumb' }, qrSvg(urlOf(r), r.name, KINDS.table.accent), el('span', {}, tableLabel(r.name))))),
        el('p', { class: 'qrs-note' }, el('b', {}, 'Print'), n === 1 ? ' prints it in black and white on the receipt printer. ' : ' prints them one after another in black and white on the receipt printer. ',
          el('b', {}, 'Send'), n === 1 ? ' sends a colour PDF of the card to your email or WhatsApp.' : ` sends one colour PDF with all ${n} cards to your email or WhatsApp.`));
    }
    const listed = tables.map(t => qrOfTable(t.id)).filter(Boolean);
    if (!listed.length) {
      const first = tables[0] || { id: 'T1', name: '1' };
      const sample = { id: 'sample', kind: 'table', table: first.id, name: first.name, code: 'K3F9QX', path: pathFor('table', first.name, 'K3F9QX') };
      return el('aside', { class: 'qrs-panel', 'aria-label': 'How it looks' }, el('h2', { class: 'qrs-ptitle' }, 'How it looks'), el('p', { class: 'qrs-phist' }, 'Sample: your table cards will look like this'),
        el('div', { class: 'qrs-prev' }, cardEl(sample, { sample: true })),
        el('p', { class: 'qrs-note' }, el('b', {}, 'Create QRs for all tables'), ' makes one QR for every table on your floor in one tap. Then print or send them.'));
    }
    let r = listed.find(x => x.id === view.selected) || listed[0]; view.selected = r.id;
    const t = tables.find(x => x.id === r.table), renamed = renamedOf(r, t), quiet = quietOf(r), s = scanOf(r);
    const why = !online() ? 'Needs internet' : '';
    let status;
    if (notPrinted(r)) status = statusBox('blue', 'i', 'Not printed yet', el('p', {}, 'This QR isn’t on the table yet. Print it, or send it to print in colour.'));
    else if (renamed) {
      const rn = t.renamed, when = rn?.at ? ` ${dayWord(rn.at)}` : '';
      status = statusBox('red', '!', `${tableLabel(r.name)} is now ${tableLabel(t.name)}`, el('p', {}, `Renamed on the Floor app${when}${byWho(rn?.by)}. The QR still works and orders go to ${tableLabel(t.name)}, but the printed card still shows ${r.name}.`),
        [btn('tint-line', 'Reprint card', () => printQrs([r]), 'print'), btn('', 'Send', () => openPop('send', { ids: [r.id] }), 'send', { off: !online(), why })]);
    } else if (quiet) {
      status = statusBox('amber', '!', `Not scanned in ${QUIET_DAYS} days`, [el('p', {}, 'Last scanned ', el('b', {}, `${weekdayDate(quiet.last)}, ${clock(quiet.last)}`), '. This table usually gets ', el('b', {}, `about ${quiet.usual} scans`), ' on an open day.'),
        el('p', { class: 'muted' }, 'The card may be damaged, faded, covered or missing. Check it, then run a test scan.')],
        [btn('green', 'Test scan', () => openPop('test', { id: r.id }), 'scan', { off: !online(), why }), el('button', { type: 'button', class: 'qrs-link', onclick: () => cardFine(r) }, 'Card is fine · hide for 7 days')]);
    } else status = el('div', { class: 'qrs-scanrow' }, el('span', { class: `qrs-scanned${s?.last ? '' : ' none'}` }, el('i'), s?.last ? `Last scanned ${dayWord(s.last)}, ${clock(s.last)}${s.today ? ` · ${s.today} today` : ''}` : 'Not scanned yet'),
      btn('green', 'Test scan', () => openPop('test', { id: r.id }), 'scan', { off: !online(), why }));
    return el('aside', { class: 'qrs-panel', 'aria-label': tableLabel(r.name) },
      el('h2', { class: 'qrs-ptitle' }, tableLabel(r.name)), el('p', { class: 'qrs-phist' }, historyLine(r)), status,
      el('div', { class: 'qrs-prev' }, cardEl(r)),
      el('div', { class: 'qrs-pbtns' }, btn('tint', 'Reprint', () => printQrs([r]), 'print'), btn('', 'Send', () => openPop('send', { ids: [r.id] }), 'send', { off: !online(), why }),
        btn('', 'Replace QR', () => openPop('replace', { id: r.id }), 'replace'), btn('del', 'Delete', () => openPop('delete', { id: r.id }), 'trash', { off: !online(), why, showWhy: true })),
      // (not under a box with its own buttons: QS25, QS35)
      renamed || (quiet && !notPrinted(r)) ? null : el('p', { class: 'qrs-note' }, el('b', {}, 'Reprint'), ' prints the same QR in black and white on the receipt printer; for colour, use ', el('b', {}, 'Send'), '. ', el('b', {}, 'Replace'), ' makes a new QR; the old one stops working.'));
  }

  // ---------- pop-ups ----------
  // kind: help | create | send | delete | delete-many | replace | test | pause | devices
  function openPop(kind, data = {}) {
    if (kind === 'help' && pop?.kind === 'help') { closePop(); return; }
    pop = { kind, ...data };
    if (kind === 'create') pop.ticked = new Set(data.one ? [data.ids[0]] : data.ids);
    if (kind === 'send') { pop.size = 'a6'; pop.language = 'en'; }
    if (kind === 'pause') pop.choice = '30m';
    if (kind === 'test') startTest();
    render();
  }
  function closePop() { if (!pop) return false; pop = null; clearInterval(testTimer); render(); return true; }
  const popHead = (title, sub) => el('div', { class: 'qrs-pop-h' }, el('div', {}, el('h3', {}, title), sub ? el('p', {}, sub) : null), el('button', { type: 'button', class: 'qrs-x', 'aria-label': 'Close', onclick: closePop }, icon('close')));
  const label = text => el('p', { class: 'qrs-plabel' }, text);
  const pick = (on, text, onclick, extra, before) => el('button', { type: 'button', class: `qrs-pick${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick }, before || null, el('span', {}, text), extra || null);
  function popEl() {
    if (!pop) return null;
    const { tables, areas } = floor();
    let body = null, cls = pop.kind;
    if (pop.kind === 'help') body = [popHead('Table QRs', 'One QR per table. Customers order and pay from their table.'),
      el('div', { class: 'qrs-hgrid' },
        el('section', {}, el('h4', {}, 'What these tiles do'), el('ul', {}, el('li', {}, el('b', {}, 'Create a table QR'), ': pick one table without a QR'), el('li', {}, el('b', {}, 'Create QRs for all tables'), ': makes QRs only for tables without an active QR'), el('li', {}, el('b', {}, 'Long-press a table'), ' to select several, then Print, Send or Delete them'))),
        el('section', {}, el('h4', {}, 'Where to put it'), el('ul', {}, el('li', {}, 'On each table: a table card or a sticker'), el('li', {}, 'Each QR belongs to one table only'), el('li', {}, 'Not at the counter: use the Takeaway QR'))),
        el('section', {}, el('h4', {}, 'What the customer gets'), el('ul', {}, el('li', {}, 'Menu → cart → pay, with the table already set'), el('li', {}, 'KOT prints as Dine-in once payment is confirmed'), el('li', {}, 'Call waiter and Ask for bill'))),
        el('section', {}, el('h4', {}, 'Reprint or replace'), el('ul', {}, el('li', {}, el('b', {}, 'Reprint'), ': same QR, the old print keeps working'), el('li', {}, el('b', {}, 'Replace'), ': new QR, the old one stops working')))),
      el('p', { class: 'qrs-pfoot' }, 'Tap anywhere outside to close')];
    else if (pop.kind === 'create') {
      const list = pop.ids.map(id => tables.find(t => t.id === id)).filter(t => t && !qrOfTable(t.id));
      if (pop.one) {
        const choices = tables.filter(t => !qrOfTable(t.id) && (view.area === 'all' || t.area === view.area)), chosen = [...pop.ticked][0];
        body = [popHead('Create a table QR', 'Tables without an active QR'), label('PICK A TABLE'),
          el('div', { class: 'qrs-picks' }, choices.map(t => pick(chosen === t.id, tableLabel(t.name), () => { pop.ticked = new Set([t.id]); render(); }))),
          el('p', { class: 'qrs-pnote' }, 'Tables come from your floor plan. Each table can have one active QR.'),
          el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), btn('blue', `Create for ${tableLabel(tables.find(t => t.id === chosen)?.name ?? '')}`, () => createTables([chosen]), 'plus', { off: !chosen }))];
      } else {
        const n = [...pop.ticked].filter(id => list.some(t => t.id === id)).length;
        body = [popHead(`Create QRs for ${list.length} ${list.length === 1 ? 'table' : 'tables'}`, 'These tables don’t have an active QR'), label('SELECTED · TAP TO UNTICK'),
          el('div', { class: 'qrs-picks' }, list.map(t => pick(pop.ticked.has(t.id), tableLabel(t.name), () => { pop.ticked.has(t.id) ? pop.ticked.delete(t.id) : pop.ticked.add(t.id); render(); }, null, pop.ticked.has(t.id) ? icon('check', 'qrs-pick-i') : null))),
          el('p', { class: 'qrs-pnote' }, 'Each table gets one QR with its number on it. Print or send them afterwards.'),
          el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), btn('blue', `Create for ${n} ${n === 1 ? 'table' : 'tables'}`, () => createTables(list.filter(t => pop.ticked.has(t.id)).map(t => t.id)), 'plus', { off: !n }))];
        cls = 'create';
      }
    } else if (pop.kind === 'send') {
      const list = pop.ids.map(id => records.find(r => r.id === id)).filter(Boolean), r0 = list[0];
      if (!r0) { pop = null; return null; }
      const isTable = r0.kind === 'table', names = list.map(r => r.name);
      const inAreas = [...new Set(list.map(r => tables.find(t => t.id === r.table)?.area))];
      const where = isTable ? (list.length > 1 && inAreas.length === 1 && !pop.all ? areas.find(a => a.id === inAreas[0])?.name : null) : null;
      const title = !isTable ? `Send ${r0.kind === 'takeaway' ? 'Takeaway' : 'Menu'} QR` : pop.all ? 'Send all table QRs' : list.length === 1 ? `Send ${tableLabel(r0.name)} QR` : `Send ${list.length} table QRs`;
      const sub = ['Colour PDF', !isTable ? (r0.kind === 'takeaway' ? 'Takeaway' : 'Menu · view only') : list.length === 1 ? tableLabel(r0.name) : where || `${list.length} tables`, isTable ? (list.length === 1 ? 'Dine-in' : tablesText(names)) : null].filter(Boolean).join(' · ');
      const b = window.RestroPrefs?.get?.('business') || {}, email = maskEmail(b.email), phone = maskPhone(b.phone, b.phoneCountry);
      body = [popHead(title, sub), label('PRINT SIZE'),
        el('div', { class: 'qrs-picks' }, [['a6', 'Table card', 'A6'], ['sticker', 'Sticker', '10 × 10 cm'], ['a4', 'A4 sheet', '4 per page']].map(([id, t, x]) => pick(pop.size === id, t, () => { pop.size = id; render(); }, el('small', {}, x)))),
        label('CARD LANGUAGE'),
        el('div', { class: 'qrs-picks' }, [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी'], ['en+te', 'English + తెలుగు']].map(([id, t]) => pick(pop.language === id, t, () => { pop.language = id; render(); }))),
        label('SENDS TO THE BUSINESS’S REGISTERED CONTACTS'),
        el('dl', { class: 'qrs-contacts' }, el('div', {}, el('dt', {}, 'Email'), el('dd', {}, icon('mail'), email || 'Not added yet')), el('div', {}, el('dt', {}, 'WhatsApp'), el('dd', {}, icon('chat'), phone || 'Not added yet'))),
        el('p', { class: 'qrs-pnote' }, 'Colour, print-ready PDF: print, laminate or make stickers. To change these contacts: Settings › Business details. Download comes with the web dashboard.'),
        el('div', { class: 'qrs-pbar' }, btn('wa', 'WhatsApp', () => sendQrs(list, 'whatsapp', phone), 'chat', { off: !phone || !online(), why: !online() ? 'Needs internet' : '' }),
          btn('blue', 'Email', () => sendQrs(list, 'email', email), 'mail', { off: !email || !online(), why: !online() ? 'Needs internet' : '' }))];
    } else if (pop.kind === 'delete' || pop.kind === 'replace') {
      const r = records.find(x => x.id === pop.id); if (!r) { pop = null; return null; }
      const name = r.kind === 'table' ? tableLabel(r.name) : r.kind === 'takeaway' ? 'Takeaway' : 'Menu', online2 = r.kind !== 'table' ? ' Links you posted online stop working too.' : '';
      if (pop.kind === 'delete') body = [popHead(`Delete the ${name} QR?`, historyLine(r).replace(' · not printed or sent yet', '')),
        el('div', { class: 'qrs-warnbox' }, r.kind === 'table' ? [`The printed QR and link on ${name} `, el('b', {}, 'stop working'), `. Customers at that table won’t be able to order by QR until you create a new one.`]
          : [`The printed ${name} QR and its link `, el('b', {}, 'stop working'), `.${online2} Customers can’t use it until you create a new one.`]),
        el('p', { class: 'qrs-pnote dark' }, 'Only want a fresh copy? Use ', el('b', {}, 'Reprint'), '. Card damaged or copied? Use ', el('b', {}, 'Replace QR'), '.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Keep QR', closePop), btn('red', 'Delete QR', () => deleteQrs([r]), 'trash', { off: !online(), why: 'Needs internet', showWhy: true }))];
      else body = [popHead(`Replace the ${name} QR?`, historyLine(r).replace(' · not printed or sent yet', '')),
        el('div', { class: 'qrs-greybox' }, r.kind === 'table' ? ['You’ll get a ', el('b', {}, 'new QR'), ` for ${name}. The QR printed on the table now will `, el('b', {}, 'stop working'), ', so print the new one and put it on the table.']
          : ['You’ll get a ', el('b', {}, 'new QR'), `. The ${name} QR printed now will `, el('b', {}, 'stop working'), `.${online2} Print the new one and put it up.`]),
        el('p', { class: 'qrs-pnote dark' }, 'Only need a fresh copy of the same QR? Use ', el('b', {}, 'Reprint'), ' instead.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), btn('blue', 'Replace QR', () => replaceQr(r), 'replace'))];
    } else if (pop.kind === 'delete-many') {
      const list = pickedRecords(), names = list.map(r => r.name), inAreas = [...new Set(list.map(r => tables.find(t => t.id === r.table)?.area))];
      const where = inAreas.length === 1 ? `${areas.find(a => a.id === inAreas[0])?.name} · ` : '';
      body = [popHead(`Delete ${list.length} table QRs?`, `${where}${tablesText(names)}`),
        el('div', { class: 'qrs-warnbox' }, `The printed QRs and links on ${tablesText(names, ' and ')} `, el('b', {}, 'stop working'), '. Customers at those tables can’t order by QR until you create new ones.'),
        el('p', { class: 'qrs-pnote dark' }, 'Only want fresh copies? Use ', el('b', {}, 'Print'), ' or ', el('b', {}, 'Send'), '. Cards damaged or copied? Replace them one by one.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Keep QRs', closePop), btn('red', `Delete ${list.length} QRs`, () => deleteQrs(list), 'trash', { off: !online(), why: 'Needs internet', showWhy: true }))];
    } else if (pop.kind === 'test') {
      const r = records.find(x => x.id === pop.id); if (!r) { pop = null; return null; }
      const name = r.kind === 'table' ? tableLabel(r.name) : r.kind === 'takeaway' ? 'Takeaway' : 'Menu';
      if (pop.result === 'ok') body = [el('span', { class: 'qrs-big-i ok' }, icon('check')), el('h3', { class: 'ok' }, `${name} QR works`),
        el('p', {}, r.kind === 'table' ? `Scanned just now from a phone. The menu opened with ${name} set.` : 'Scanned just now from a phone. The menu opened.'), el('div', { class: 'qrs-pbar one' }, btn('blue', 'Done', closePop))];
      else if (pop.result === 'fail') body = [el('span', { class: 'qrs-big-i bad' }, '!'), el('h3', { class: 'bad' }, 'Didn’t get a scan'),
        el('p', {}, 'No scan arrived in 1 minute. If the phone couldn’t read the card, it may be damaged, faded or wet.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Reprint', () => { closePop(); printQrs([r]); }, 'print'), btn('blue', 'Try again', () => { startTest(); render(); }))];
      else { const left = Math.max(0, Math.ceil((pop.started + TEST_WAIT - Date.now()) / 1000));
        body = [el('span', { class: 'qrs-big-i wait' }, el('i', { class: 'qrs-spin' })), el('h3', {}, `Scan ${name}${r.kind === 'table' ? '’s' : ''} QR now`),
          el('p', {}, r.kind === 'table' ? `Use any phone. Point its camera at the card on ${name}.` : 'Use any phone. Point its camera at the card.', el('br'), 'Waiting for the scan… ', el('b', { class: 'qrs-left' }, `0:${String(left).padStart(2, '0')}`)),
          el('div', { class: 'qrs-pbar one' }, btn('', 'Cancel', closePop))]; }
    } else if (pop.kind === 'pause') {
      const label2 = { '30m': 'Pause for 30 min', '1h': 'Pause for 1 hour', day: 'Pause for 1 business day', hand: 'Pause until turned on' }[pop.choice];
      body = [popHead('Pause QR ordering', 'Same choices when you turn the switch off. For a rush or a kitchen issue.'), label('FOR HOW LONG'),
        el('div', { class: 'qrs-picks' }, [['30m', '30 min'], ['1h', '1 hour'], ['day', '1 business day'], ['hand', 'Until turned on']].map(([id, t]) => pick(pop.choice === id, t, () => { pop.choice = id; render(); }))),
        el('div', { class: 'qrs-greybox list' }, el('b', {}, 'While paused'), el('span', {}, `· Table and Takeaway QRs show the menu with “${CUSTOMER_PAUSED}”`), el('span', {}, '· Orders already paid keep going to the kitchen'), el('span', {}, '· The Menu QR works as normal')),
        el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), btn('blue', label2, () => pauseFor(pop.choice), 'pause'))];
    } else if (pop.kind === 'devices') { body = devicesBody(); cls = `devices ${body.cls}`; body = body.kids; }
    return el('div', { class: `qrs-scrim k-${pop.kind}`, onclick: e => { if (e.target === e.currentTarget && pop?.kind !== 'test') closePop(); } },
      el('div', { class: `qrs-pop ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': pop.kind }, body));
  }
  // The path check (QS44–QS47): Internet → Printer device → Kitchen printer, as far as each step is known
  function devicesBody() {
    const p = pathNow(), broken = brokenStep(p), kitchen = p.printers || [];
    const box = (state, ic, title, chip, lines) => el('section', { class: `qrs-dev ${state}` }, el('h4', {}, icon(ic), title), el('span', { class: 'qrs-dev-chip' }, chip), lines.filter(Boolean).map(l => el('p', {}, l)));
    const arrow = () => el('span', { class: 'qrs-dev-arrow', 'aria-hidden': 'true' }, icon('arrow'));
    const internet = box(p.internet ? 'ok' : 'bad', 'wifi', 'Internet', p.internet ? 'Connected' : 'No internet',
      p.internet ? [p.wifiInternet === false ? 'Wi-Fi internet: not connected' : 'Wi-Fi internet', p.mobileVia ? `Mobile data: ${p.mobileVia}` : null] : ['Wi-Fi internet: not connected', 'Mobile data: no device is on it']);
    const printerBox = (k, many) => {
      const name = many ? k.name || 'Kitchen printer' : 'Kitchen printer', deviceOff = k.link === 'wired' && k.device?.on === false;
      if (deviceOff) return box('off', 'print', name, 'Can’t check', ['Wired', 'The device it’s plugged into is off']);
      if (k.state === 'ok') return box('ok', 'print', name, 'Connected', [k.link === 'wifi' ? 'Wi-Fi' : 'Wired', k.paper === 'ok' ? 'Paper OK' : null, k.backup && kitchen.some(x => x !== k && x.state !== 'ok') ? 'Backup printer · printing all KOTs' : null]);
      return k.link === 'wifi' ? box('bad', 'print', name, 'Not reachable', ['Wi-Fi', 'No device can reach it', many ? null : 'Check power, paper and Wi-Fi']) : box('bad', 'print', name, 'Not connected', ['Wired', 'Check power, cable and paper']);
    };
    const deviceBox = (k, many) => k.device?.on === false ? box('bad', 'monitor', 'Printer device', 'Off', [k.device.lastSeen ? `Last seen ${clock(k.device.lastSeen)}` : null])
      : box('ok', 'monitor', 'Printer device', 'On', [`${many ? k.name || 'Kitchen printer' : 'Kitchen printer'} plugged in here`]);
    const many = kitchen.length > 1, working = kitchen.filter(k => k.state === 'ok' && (k.link !== 'wired' || k.device?.on !== false));
    let sub, text;
    if (broken) sub = REASONS[broken].devices;
    else if (many && working.length < kitchen.length) sub = `QR ordering is on · ${working.map(k => k.name).join(' and ')} ${working.length === 1 ? 'is' : 'are'} printing`;
    else if (p.mobileVia && p.wifiInternet === false) sub = 'QR ordering is on · orders are coming in on mobile data';
    else sub = 'QR ordering is on · every step works';
    const tries = { internet: 'restart the internet router, or turn on mobile data on any one device. QR ordering turns back on by itself.', device: 'turn on the printer device, or plug the kitchen printer into another device. QR ordering turns back on by itself.',
      wired: 'check the printer is on, the cable is in and it has paper. QR ordering turns back on by itself.', wifi: 'check the printer is on, has paper and is on the restaurant Wi-Fi. QR ordering turns back on by itself.',
      printers: 'get either kitchen printer working. QR ordering turns back on by itself as soon as one prints.' };
    if (broken) text = el('p', { class: 'qrs-pnote dark' }, el('b', {}, 'Try:'), ` ${tries[broken]}`);
    else if (many && working.length < kitchen.length) { const backup = working.find(k => k.backup) || working[0], down = kitchen.filter(k => !working.includes(k));
      text = el('p', { class: 'qrs-pnote dark' }, `${backup.name} is ${backup.backup ? 'your backup printer' : 'the first kitchen printer that works'}, so it prints ${down.map(k => `${k.name}’s`).join(' and ')} dishes along with its own until ${down.length === 1 ? `printer ${down[0].name.replace(/^Kitchen printer\s*/i, '') || down[0].name}` : 'they'} ${down.length === 1 ? 'is' : 'are'} back. Bill and receipt printers don’t count.`); }
    else if (p.mobileVia && p.wifiInternet === false) text = el('p', { class: 'qrs-pnote dark' }, `${p.mobileVia} takes in QR orders and sends them over the Wi-Fi to the printer device. Nothing to do.`);
    else text = el('p', { class: 'qrs-pnote dark' }, 'Nothing to do.');
    let flow, cls = 'one';
    if (!kitchen.length) flow = el('div', { class: 'qrs-flow' }, internet);
    else if (!many) { const k = kitchen[0]; flow = el('div', { class: 'qrs-flow' }, internet, arrow(), k.link === 'wired' ? [deviceBox(k), arrow()] : null, printerBox(k)); cls = k.link === 'wired' ? 'three' : 'two'; }
    else { flow = el('div', { class: 'qrs-flow many' }, internet, arrow(), el('div', { class: 'qrs-flow-rows' }, kitchen.map(k => el('div', { class: `qrs-flow-row${k.link === 'wired' ? '' : ' solo'}` }, k.link === 'wired' ? [deviceBox(k, true), arrow()] : null, printerBox(k, true))))); cls = 'many'; }
    return { cls, kids: [popHead(many ? 'Devices and kitchen printers' : 'Devices and kitchen printer', sub), flow, text, el('div', { class: 'qrs-pbar one' }, btn('', 'Close', closePop))] };
  }
  // ak••••••@gmail.com, +91 98••• ••210
  function maskEmail(v) { const m = /^([^@\s]+)@(.+)$/.exec(String(v || '').trim()); return m ? `${m[1].slice(0, 2)}••••••@${m[2]}` : ''; }
  function maskPhone(v, iso) {
    const d = String(v || '').replace(/\D/g, ''); if (d.length < 6) return '';
    const code = (window.RestroProfile?.countries || []).find?.(c => c.iso === iso)?.code || '91';
    const masked = d.slice(0, 2) + '•'.repeat(Math.max(0, d.length - 5)) + d.slice(-3);
    return `+${code} ${masked.length === 10 ? `${masked.slice(0, 5)} ${masked.slice(5)}` : masked}`;
  }

  // ---------- doing things ----------
  const pickedRecords = () => (view.picked ? [...view.picked].map(id => records.find(r => r.id === id)).filter(Boolean) : []);
  function go(page) { view.page = page; view.picked = null; pop = null; render(); }
  function goHome() { document.querySelector('#system-home')?.click(); if (dialog.open) dialog.close(); }
  function tapCard(r) {
    if (view.picked) { view.picked.has(r.id) ? view.picked.delete(r.id) : view.picked.add(r.id); if (!view.picked.size) view.picked = null; }
    else view.selected = r.id;
    render();
  }
  // Long-press a table card (as Orders' delete mode): several can be ticked, in every area, for Print, Send or Delete
  function holdCard(r) { if (view.picked) return; view.picked = new Set([r.id]); pop = null; try { navigator.vibrate?.(20); } catch {} render(); }
  function stopPicking() { view.picked = null; render(); }
  function holdable(node, tap, hold) {
    let timer = 0, held = false, start = null;
    node.addEventListener('pointerdown', e => { if (e.button) return; held = false; start = [e.clientX, e.clientY]; clearTimeout(timer); timer = setTimeout(() => { held = true; start = null; hold(); }, 500); });
    node.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) { clearTimeout(timer); start = null; } });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, () => { clearTimeout(timer); start = null; });
    node.addEventListener('click', e => { if (held) { held = false; e.preventDefault(); return; } tap(); });
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    node.addEventListener('contextmenu', e => e.preventDefault());
  }
  const nameOf = r => (r.kind === 'table' ? `${tableLabel(r.name)} QR` : r.kind === 'takeaway' ? 'Takeaway QR' : 'Menu QR');
  const manyWords = (list, verb) => (list.length === 1 ? `${nameOf(list[0])} ${verb}` : `${list.length} ${list.every(r => r.kind === 'table') ? 'table ' : ''}QRs ${verb}`);
  // (a table renamed in Floor: the card printed or sent now shows its new name)
  const freshName = r => (r.kind === 'table' ? floor().tables.find(t => t.id === r.table)?.name ?? r.name : null);

  function createTables(ids) {
    const { tables } = floor(), made = [];
    for (const id of ids) { const t = tables.find(x => x.id === id); if (t && !qrOfTable(t.id)) { const r = makeQr('table', t); records.push(r); made.push(r); } }
    if (!made.length) { closePop(); return; }
    view.selected = made[0].id; pop = null; store();
    toast(made.length === 1 ? `QR created for ${tableLabel(made[0].name)}` : `QRs created for ${tablesText(made.map(r => r.name), ' and ')}`, ['Print now', () => printQrs(made)]);
  }
  function createOne(kind) {
    if (qrOfKind(kind)) return;
    const r = makeQr(kind); records.push(r); store();
    toast(`${nameOf(r)} created`, ['Print now', () => printQrs([r])]);
  }
  function replaceQr(r) {
    const at = Date.now(), name = freshName(r) ?? r.name, code = newCode();
    Object.assign(r, { code, path: pathFor(r.kind, name, code), replacedAt: at, replacedBy: who() });
    if (r.kind === 'table') r.name = name;
    for (const k of ['printedAt', 'printedBy', 'sentAt', 'sentBy', 'quietOk']) delete r[k];
    pop = null; store();
    toast(`${r.kind === 'table' ? tableLabel(r.name) : r.kind === 'takeaway' ? 'Takeaway' : 'Menu'} has a new QR · the old one no longer works`, ['Print now', () => printQrs([r])]);
  }
  function deleteQrs(list) {
    if (!online()) return;
    const ids = new Set(list.map(r => r.id));
    records = records.filter(r => !ids.has(r.id)); for (const id of ids) window.RestroSync?.removed('qr', id);
    if (ids.has(view.selected)) view.selected = null;
    view.picked = null; pop = null; store();
    toast(manyWords(list, 'deleted'));
  }
  function cardFine(r) { r.quietOk = Date.now() + QUIET_HIDE; store(); }

  // Print (J): black and white, on the receipt (bill) printer of this device. The Android app prints each card
  // (RESTRODevice.printer.printQr); in a browser, its print page.
  // A card's QR for the app: { size (modules a side), rows ('1' dark, '0' light; the square round the mark already
  // cleared), tile: { x, y, size } (in modules: the mark's rounded square) | null }
  function qrOfCard(url, mark) {
    const rows = modules(url); if (!rows) return null;
    const n = rows.length; if (!mark) return { size: n, rows: [...rows], tile: null };
    const { tile, clear } = markTile(n), c0 = (n - clear) / 2, t0 = (n - tile) / 2;
    return { size: n, rows: rows.map((line, r) => (r >= c0 && r < c0 + clear ? line.slice(0, c0) + '0'.repeat(clear) + line.slice(c0 + clear) : line)), tile: { x: t0, y: t0, size: tile } };
  }
  function printCard(r) {
    const k = KINDS[r.kind], name = freshName(r), title = r.kind === 'table' ? tableLabel(name) : k.title, mark = r.kind === 'table' ? name : null;
    return { kind: r.kind, restaurant: window.RestroRestaurantName?.value || '', heading: k.heading, title, mark, lines: [...k.lines], note: k.note || null,
      linkLabel: 'QR not scanning? Type this link', link: linkOf(r), url: urlOf(r), qr: qrOfCard(urlOf(r), mark) };
  }
  function printQrs(list) {
    list = list.filter(Boolean); if (!list.length) return;
    const cards = list.map(printCard), printer = window.RESTRODevice?.printer;
    const done = ok => {
      if (!ok) { toast(`${manyWords(list, 'didn’t print')} · check the receipt printer`); return; }
      const at = Date.now(), by = who();
      for (const r of list) { if (!records.includes(r)) continue; r.printedAt = at; r.printedBy = by; const n = freshName(r); if (n != null) r.name = n; }
      store(); toast(manyWords(list, 'printed'));
    };
    if (typeof printer?.printQr === 'function') Promise.resolve(printer.printQr({ cards })).then(res => done(!(res === false || res?.ok === false)), () => done(false));
    else { printPage(cards); done(true); }
  }
  function printPage(cards) {
    let page = document.querySelector('#print-qr');
    if (!page) { page = el('div', { id: 'print-qr', 'aria-hidden': 'true' }); document.body.append(page); }
    page.replaceChildren(...cards.map(c => el('section', { class: 'pq-card' }, el('h1', {}, c.restaurant), el('p', { class: 'pq-head' }, c.heading),
      qrSvg(c.url, c.mark, '#000000', 'pq-qr'), el('h2', {}, c.title), c.lines.map(l => el('p', {}, l)), c.note ? el('p', { class: 'pq-note' }, c.note) : null,
      el('p', { class: 'pq-small' }, c.linkLabel), el('p', { class: 'pq-link' }, c.link))));
    try { window.print(); } catch {}
  }
  // Send (G, J): a colour, print-ready PDF to the business's registered email or WhatsApp, made and sent by the cloud
  // (the Android app passes it on: RESTRODevice.qr.send)
  function sendQrs(list, to, masked) {
    const send = window.RESTRODevice?.qr?.send;
    if (typeof send !== 'function') { toast('Sending starts with the RESTRO Android app'); return; }
    const job = { to, size: pop?.size || 'a6', language: pop?.language || 'en', cards: list.map(printCard) };
    pop = null; render();
    Promise.resolve(send(job)).then(res => {
      if (res === false || res?.ok === false) { toast(`${manyWords(list, 'not sent')} · try again`); return; }
      const at = Date.now(), by = who();
      for (const r of list) { if (!records.includes(r)) continue; r.sentAt = at; r.sentBy = by; const n = freshName(r); if (n != null) r.name = n; }
      store(); toast(`${manyWords(list, 'sent')} to ${to === 'email' ? 'email' : 'WhatsApp'} ${masked}`);
    }, () => toast(`${manyWords(list, 'not sent')} · try again`));
  }
  // Test scan (J): staff scan the card with any phone; the cloud reports the scan (RestroQrStudio.scanned)
  let testTimer = 0;
  function startTest() {
    clearInterval(testTimer); pop.started = Date.now(); pop.result = null;
    testTimer = setInterval(() => {
      if (!pop || pop.kind !== 'test') { clearInterval(testTimer); return; }
      if (Date.now() - pop.started >= TEST_WAIT) { pop.result = 'fail'; clearInterval(testTimer); render(); return; }
      const left = root?.querySelector('.qrs-left'); if (left) left.textContent = `0:${String(Math.max(0, Math.ceil((pop.started + TEST_WAIT - Date.now()) / 1000))).padStart(2, '0')}`;
    }, 250);
  }
  function scanned(scan) {
    const code = String(scan?.code || ''); if (!code) return;
    const at = Number(scan.at) || Date.now(), day = businessDay(at), s = scans[code] || {};
    scans[code] = { last: Math.max(Number(s.last) || 0, at), day, today: Number.isFinite(scan.today) ? scan.today : (s.day === day ? (Number(s.today) || 0) : 0) + 1, usual: Number.isFinite(scan.usual) ? scan.usual : Number(s.usual) || 0 };
    try { localStorage.setItem(SCANS_KEY, JSON.stringify(scans)); } catch {}
    // (a scan clears the quiet warning by itself)
    if (pop?.kind === 'test' && !pop.result && records.find(r => r.id === pop.id)?.code === code && at >= pop.started - 2000) { pop.result = 'ok'; clearInterval(testTimer); }
    changed();
  }
  // QR ordering by hand (I3): the switch or Pause for a while: 30 min · 1 hour · 1 business day (back on at the next
  // opening time) · Until turned on. Outside business hours, the switch turns it on (staying open late).
  function pauseFor(choice) {
    const now = Date.now(), until = choice === '30m' ? now + 30 * MIN : choice === '1h' ? now + 60 * MIN : choice === 'day' ? nextOpening(now)?.at ?? now + DAY : null;
    pop = null; writeOrdering({ off: { until, choice, by: who(), at: now }, late: null });
  }
  function resume() { writeOrdering({ off: null, late: null }); }
  function switchTapped(st) {
    if (st.state === 'on') openPop('pause');
    else if (st.state === 'late') writeOrdering({ off: null, late: null });
    else if (st.state === 'paused' || st.state === 'hand') resume();
    else if (st.state === 'closed') writeOrdering({ off: null, late: { by: who(), at: Date.now(), until: nextOpening(Date.now())?.at ?? null } });
    else if (st.state === 'auto') openPop('devices');
  }

  // ---------- the toast (QS6, QS28) ----------
  const toastEl = el('div', { class: 'qrs-toast', role: 'status', 'aria-live': 'polite', hidden: true });
  function toast(text, action) {
    clearTimeout(toastTimer);
    toastEl.replaceChildren(...[el('span', { class: 'qrs-toast-i' }, icon('check')), el('span', {}, text), action ? el('button', { type: 'button', class: 'qrs-toast-btn', onclick: () => { toastEl.hidden = true; action[1](); } }, action[0]) : null].filter(Boolean));
    toastEl.hidden = false;
    const ms = window.RESTRODevice?.recommendedTimeout?.(action ? 6000 : 3000, Boolean(action)) || (action ? 6000 : 3000);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ---------- drawing it all ----------
  function render() {
    if (!dialog.open) return;
    const st = ordering(), scroll = root?.querySelector('.qrs-scroll')?.scrollTop || 0, typing = document.activeElement?.matches?.('.qrs-search input');
    const { tables } = floor();
    if (view.page === 'table' && !records.some(r => r.id === view.selected && r.kind === 'table' && tables.some(t => t.id === r.table))) view.selected = tables.map(t => qrOfTable(t.id)).find(Boolean)?.id || null;
    const main = el('main', { class: `qrs-main p-${view.page}` }, view.page === 'table' ? tablePage(st) : onePage(st, view.page));
    const fresh = el('div', { class: `qrs-root${view.page === 'table' ? '' : ' wide'}` }, el('span', { class: 'qrs-unit', 'aria-hidden': 'true' }), sideEl(st), main, view.page === 'table' ? panelEl() : null, popEl(), toastEl);
    if (root) root.replaceWith(fresh); else dialog.append(fresh);
    root = fresh;
    const sc = root.querySelector('.qrs-scroll'); if (sc) sc.scrollTop = scroll;
    if (typing) { const input = root.querySelector('.qrs-search input'); input?.focus(); input?.setSelectionRange?.(input.value.length, input.value.length); }
    fitPreview();
    paintPill();
  }
  // The card in the panel fills the grey box's height (QS1); a taller box above it makes it smaller (QS25, QS35)
  // (the grey box is 560 tall where there's room, smaller where there isn't; the card in it is 288 wide at most, with 14
  // above and below; the note under the buttons goes when the box would be under 400)
  function fitPreview() {
    for (const box of root?.querySelectorAll('.qrs-prev') || []) {
      const card = box.querySelector('.qrs-card'); if (!card) continue;
      const note = box.parentElement.querySelector(':scope > .qrs-note');
      if (note && box.clientHeight < 400 * unit()) note.hidden = true;
      const tall = card.classList.contains('k-table') ? 733.6 : 660, u = unit();
      const k = Math.min(0.676 * u, (box.clientHeight - 28 * u) / tall, (box.clientWidth - 40 * u) / 426);
      card.style.setProperty('--cu', `${Math.max(0.2 * u, k)}px`);
    }
  }
  // One design pixel on this screen (--fu)
  function unit() { const probe = root?.querySelector('.qrs-unit'); return probe ? probe.getBoundingClientRect().width / 100 : 1; }
  // The bar's Online pill while QR Studio shows (I1): "No internet", or amber "No internet · orders via Handheld 1"
  function paintPill() {
    const pill = document.querySelector('#top-banner .online-pill'), label = document.querySelector('#online-text'); if (!pill || !label) return;
    const p = pathNow(), mine = dialog.open, none = mine && !p.internet, via = mine && p.internet && p.mobileVia && p.wifiInternet === false;
    pill.classList.toggle('qrs-noint', Boolean(none)); pill.classList.toggle('qrs-via', Boolean(via));
    const text = none ? 'No internet' : via ? `No internet · orders via ${p.mobileVia}` : internetHere() ? 'Online' : 'Offline';
    if (label.textContent !== text) label.textContent = text;
    if (typeof window.alignBannerText === 'function') window.alignBannerText();
  }
  // Something changed: the screen, and the home badge
  let lastCount = -1;
  function changed() {
    render();
    const n = attention(); if (n !== lastCount) { lastCount = n; window.dispatchEvent(new CustomEvent('restro:qr-attention', { detail: { count: n } })); }
  }
  function setPath(status) {
    if (status == null) { path = null; changed(); return; }
    let s = status; if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return; } }
    if (!s || typeof s !== 'object') return;
    path = { internet: s.internet !== false, wifiInternet: s.wifiInternet !== false, mobileVia: typeof s.mobileVia === 'string' && s.mobileVia ? s.mobileVia : null, since: Number(s.since) || 0,
      printers: (Array.isArray(s.printers) ? s.printers : []).filter(k => k && typeof k === 'object').map((k, i) => ({ id: String(k.id ?? i), name: String(k.name || `Kitchen printer ${i + 1}`), link: k.link === 'wifi' ? 'wifi' : 'wired',
        state: k.state === 'ok' ? 'ok' : 'down', paper: k.paper === 'ok' ? 'ok' : null, backup: k.backup === true,
        device: k.device && typeof k.device === 'object' ? { name: String(k.device.name || ''), on: k.device.on !== false, lastSeen: Number(k.device.lastSeen) || 0 } : null })) };
    changed();
  }

  // ---------- opening, closing, Back ----------
  function open(page) {
    load(); loadScans(); view.page = KINDS[page] ? page : 'table'; view.picked = null; view.search = ''; pop = null;
    if (!dialog.open) dialog.showModal();
    render(); dialog.querySelector('#qr-studio-title')?.focus({ preventScroll: true });
    clearInterval(tick); tick = setInterval(() => { if (dialog.open && !pop) render(); }, 15000);
  }
  function goBack() {
    if (!dialog.open) return false;
    if (pop) { if (pop.kind !== 'test' || pop.result) { closePop(); return true; } closePop(); return true; }
    if (view.picked) { stopPicking(); return true; }
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  dialog.addEventListener('close', () => { pop = null; view.picked = null; clearInterval(tick); clearInterval(testTimer); paintPill(); });
  window.addEventListener('restro:data-changed', e => { const c = e.detail?.collections || []; if (c.includes('qr') || c.includes('settings')) { load(); loadScans(); changed(); } });
  window.addEventListener('restro:prefs-changed', () => changed());
  window.addEventListener('restro:connectivity-changed', () => { if (dialog.open) { render(); } else changed(); });
  window.addEventListener('restro:qr-path', e => setPath(e.detail));
  window.addEventListener('restro:qr-scan', e => scanned(e.detail));
  window.addEventListener('restro:restaurant-renamed', () => render());
  // (QR ordering's own clock: a pause ending, opening and closing, and the 10 s before it turns back on by itself)
  setInterval(() => { const n = attention(); if (n !== lastCount) changed(); else if (dialog.open && autoSince && pathOkSince) render(); }, 5000);
  window.RestroQrStudio = Object.freeze({ open, goBack, attention: () => attention(), ordering: () => { const s = ordering(); return { state: s.state, reason: s.auto?.reason || null }; },
    scanned, path: setPath, list: () => records.map(r => ({ ...r })) });
})();
