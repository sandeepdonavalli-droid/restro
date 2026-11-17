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
//       then) }. The ...By fields hold the staff's names, and the screens show them in full (owner, 14 Nov 2026).
//   Its link is https://<our website>/<path>. The domain is still to be decided (J); until then the links go to RESTRO's
//   GitHub Pages site, whose 404.html shows the restaurant, the QR's table (or Takeaway, Menu) and "QR ordering is
//   coming soon. Please order with staff." (owner, 14 Nov 2026).
//   Replace gives the QR a new code (the old one stops working); Delete removes it. The cloud keeps which codes work.
// - QR ordering: restro.qrOrdering.v1, the restaurant's (synced): { off: { until (ms; null: until turned on), choice,
//   by, at } | null, late: { by, at } | null }. It follows the business hours and the last order time by itself (I3), and
//   pauses by itself while no path reaches a kitchen printer (I1).
// - Event QRs (Update Pack 6, D–E): restro.events.v1, the restaurant's (synced, the collection 'events'): a list of
//     { id, name, start, end (ms), daily (true: "Open only these hours each day", the start's time to the end's time on
//       each day), qrs: 'whole' (one QR for the whole event: code, path '<restaurant>/EV-<code>', mode 'both' (Dine-in +
//       Takeaway) | 'takeaway' | 'menu') | 'tables' (one QR per event table: tablesFrom 'event' | 'floor', tables
//       [{ id, name (its number, or the Floor table's name), floor (a Floor table's id), code, path
//       '<restaurant>/E<name>-<code>', replacedAt, replacedBy, printedAt, printedBy, sentAt, sentBy }]), menu { items
//       (dishes from the menu), own (event-only dishes) }, endedAt, endedBy (End now), hadOrders (set once it has an
//       order, never cleared: Delete stays off), createdAt, createdBy, replacedAt, replacedBy (the whole event's QR
//       replaced), printedAt, printedBy, sentAt, sentBy }.
//   An event works only from its start to its end, even outside business hours, and stops by itself; then it shows under
//   History (owner, 16 Nov 2026). Like a table QR, each event table's QR and the whole event's QR can be reprinted, sent
//   or replaced (a new code: the old one stops working), and an event table's QR deleted (that table leaves the event).
// - Scans come from the cloud (RestroQrStudio.scanned, ANDROID-BRIDGE.md); each device keeps them: restro.qrScans.v1.
// - The path for QR orders (internet → printer device → kitchen printer) comes from the Android app:
//   RestroQrStudio.path(status) or a restro:qr-path event (ANDROID-BRIDGE.md).
// Nothing here is part of the code or the website's data: it stays on the devices until the cloud exists.
(() => {
  const dialog = document.querySelector('#qr-studio-dialog');
  if (!dialog) return;
  const KEY = 'restro.qr.v1', ORDERING_KEY = 'restro.qrOrdering.v1', SCANS_KEY = 'restro.qrScans.v1', EVENTS_KEY = 'restro.events.v1';
  // (our website until the domain is decided: the GitHub Pages site, 404.html)
  const HOST = 'sandeepdonavalli-droid.github.io/restro';
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
    menu: { prefix: 'MN', accent: '#8E1E3C', heading: 'Scan to see our menu', title: 'Menu', lines: ['See all our dishes and prices.', 'Always up to date.'], icon: 'menu' },
    // (Update Pack 6: an event's QR, teal; its heading and line go by what customers can do with it, MODES)
    event: { prefix: 'EV', accent: '#0F766E', icon: 'event' }
  };
  // (Update Pack 6, E2) What customers can do with one QR for the whole event, and its card's two lines
  const MODES = {
    both: { label: 'Dine-in + Takeaway', heading: 'Scan · Order · Pay', line: 'Eat here or take it away. We call your name when it’s ready.' },
    takeaway: { label: 'Takeaway only', heading: 'Scan · Order · Pay', line: 'Order, pay and pick it up. We call your name when it’s ready.' },
    menu: { label: 'Menu only', heading: 'Scan to see the menu', line: 'See our dishes and prices. Order with our staff.' }
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
  // Icons on a 24 grid: s = drawn with lines, f = filled; m = Material Symbols (Apache 2.0) on their 960 grid, with an
  // optional outline to match the designs' weight. send: Material Icons (Apache 2.0), as the designs.
  const ICONS = {
    home: ['s', '<path d="M4.5 11.2 L12 4.6 L19.5 11.2 V18.4 a1.6 1.6 0 0 1 -1.6 1.6 H14.6 V15.4 a2.6 2.6 0 0 0 -5.2 0 V20 H6.1 a1.6 1.6 0 0 1 -1.6 -1.6 Z"/>'],
    table: ['f', '<path d="M2.6 5.6c0-.6.5-1.1 1.1-1.1h16.6c.6 0 1.1.5 1.1 1.1v2.2c0 .6-.5 1.1-1.1 1.1H3.7c-.6 0-1.1-.5-1.1-1.1z"/><path d="M5.2 8.9h2.5l-.8 10.6H4.4zM16.3 8.9h2.5l.8 10.6h-2.5z"/><path d="M6.8 12.2h10.4v2H6.8z"/>'],
    // (Takeaway: Material Symbols' local_mall, as the designs)
    bag: ['m', 'M180-80q-24 0-42-18t-18-42v-530q0-24 18-42t42-18h110q0-79 53-134.5T475-920q79 0 137 55.5T670-730h110q24 0 42 18t18 42v530q0 24-18 42t-42 18H180Zm437-408q58-58 58-137h-60q0 55-40 95t-95 40q-55 0-95-40t-40-95h-60q0 79 58 137t137 58q79 0 137-58ZM350-730h260q0-55-37.5-92.5T480-860q-55 0-92.5 37.5T350-730Z'],
    menu: ['s', '<rect x="4" y="3.5" width="16" height="17" rx="2.2"/><path d="M12 3.5v17M7.2 8h2.2M7.2 11.5h2.2M14.6 8h2.2M14.6 11.5h2.2"/>'],
    palette: ['s', '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.3-2.9h2a4.4 4.4 0 0 0 4.4-4.4C20.9 6.6 16.9 3.2 12 3.2z"/><circle cx="7.6" cy="11.3" r="1.25" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.6" r="1.25" fill="currentColor" stroke="none"/>'],
    print: ['s', '<path d="M7 8.2V3.8h10v4.4"/><path d="M7 17H5.2A2.2 2.2 0 0 1 3 14.8v-4.4a2.2 2.2 0 0 1 2.2-2.2h13.6a2.2 2.2 0 0 1 2.2 2.2v4.4a2.2 2.2 0 0 1-2.2 2.2H17"/><path d="M7 13.6h10v6.6H7z"/>'],
    send: ['f', '<path d="m4.01 6.03 7.51 3.22-7.52-1 .01-2.22m7.5 8.72L4 17.97v-2.22l7.51-1M2.01 3 2 10l15 2-15 2 .01 7L23 12 2.01 3z"/>'],
    scan: ['s', '<path d="M3.8 8V5.4c0-.9.7-1.6 1.6-1.6H8M16 3.8h2.6c.9 0 1.6.7 1.6 1.6V8M20.2 16v2.6c0 .9-.7 1.6-1.6 1.6H16M8 20.2H5.4c-.9 0-1.6-.7-1.6-1.6V16"/><path d="m8.4 12.3 2.5 2.5 4.8-5"/>'],
    replace: ['m', 'M167-160v-60h130l-15-12q-64-51-93-111t-29-134q0-106 62.5-190.5T387-784v62q-75 29-121 96.5T220-477q0 63 23.5 109.5T307-287l30 21v-124h60v230H167Zm407-15v-63q76-29 121-96.5T740-483q0-48-23.5-97.5T655-668l-29-26v124h-60v-230h230v60H665l15 14q60 56 90 120t30 123q0 106-62 191T574-175Z', 16],
    trash: ['m', 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z'],
    pause: ['f', '<rect x="6" y="3.75" width="4.5" height="16.5" rx="1.4"/><rect x="13.5" y="3.75" width="4.5" height="16.5" rx="1.4"/>'],
    // (the banners' own: narrow bars close together, as the designs)
    pausebn: ['f', '<path d="M7.9 6.3h3.5v11.4H7.9zM12.6 6.3h3.5v11.4h-3.5z"/>'],
    plus: ['s', '<path d="M12 5v14M5 12h14"/>'],
    // (Update Pack 6, owner 16 Nov 2026: where a dish has no photo, "Add photo")
    addphoto: ['s', '<path d="M13.6 4.6H6.4a2.2 2.2 0 0 0-2.2 2.2v11a2.2 2.2 0 0 0 2.2 2.2h11a2.2 2.2 0 0 0 2.2-2.2v-7.2"/><path d="m4.6 16.4 3.9-3.9 3 3 2.1-2.1 5.4 5.2M18.4 2.8v5.6M15.6 5.6h5.6"/>'],
    grid: ['s', '<rect x="4.2" y="4.2" width="6.4" height="6.4" rx="1.8"/><rect x="13.4" y="4.2" width="6.4" height="6.4" rx="1.8"/><rect x="4.2" y="13.4" width="6.4" height="6.4" rx="1.8"/><path d="M13.6 13.4h1.6v2.2M19.8 13.4v6.4h-6.2"/>'],
    check: ['s', '<path d="m5 12.6 4.6 4.6L19.2 7.6"/>'],
    // (the Menu QR's green banner: a small, thin tick)
    tick: ['s', '<path d="M6.9 11.7 9.3 15.3 17.1 8.7"/>'],
    close: ['s', '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>'],
    search: ['s', '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.6 4.6"/>'],
    chevron: ['s', '<path d="m9.5 6 6 6-6 6"/>'],
    arrow: ['s', '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>'],
    wifi: ['s', '<path d="M2.6 9.2a13.6 13.6 0 0 1 18.8 0M5.8 12.6a9 9 0 0 1 12.4 0M9 16a4.4 4.4 0 0 1 6 0"/><circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none"/>'],
    monitor: ['s', '<rect x="3" y="4" width="18" height="12.4" rx="2"/><path d="M12 16.4V20M8 20h8"/>'],
    clock: ['s', '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 2"/>'],
    // (Update Pack 6, EV3: a date field's calendar)
    cal: ['s', '<rect x="3.6" y="5" width="16.8" height="15.4" rx="2.4"/><path d="M3.6 9.8h16.8M8.2 3.2v3.6M15.8 3.2v3.6"/>'],
    fork: ['f', '<path d="M5.6 2.8h1.5v5.6h1V2.8h1.5v5.6h1V2.8h1.5v6.3a3 3 0 0 1-2.1 2.9v9.2H7.8V12a3 3 0 0 1-2.2-2.9z"/><path d="M17.9 2.8c-2.2 1.3-3.3 4.1-3.3 7.6v3.3h2.4v7.5h2.2V2.8z"/>'],
    bell: ['f', '<path d="M12 3.2a1.4 1.4 0 0 1 1.4 1.4v.6a5.7 5.7 0 0 1 4.3 5.5v3.8l1.8 2.2v1.1H4.5v-1.1l1.8-2.2v-3.8a5.7 5.7 0 0 1 4.3-5.5v-.6A1.4 1.4 0 0 1 12 3.2zM9.8 19.2h4.4a2.2 2.2 0 0 1-4.4 0z"/>'],
    link: ['s', '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>'],
    mail: ['s', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.6 6.4 8.4 6.6 8.4-6.6"/>'],
    chat: ['m', 'm240-240-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Zm40-160h240q17 0 28.5-11.5T560-440q0-17-11.5-28.5T520-480H280q-17 0-28.5 11.5T240-440q0 17 11.5 28.5T280-400Zm0-120h400q17 0 28.5-11.5T720-560q0-17-11.5-28.5T680-600H280q-17 0-28.5 11.5T240-560q0 17 11.5 28.5T280-520Zm0-120h400q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720H280q-17 0-28.5 11.5T240-680q0 17 11.5 28.5T280-640Z'],
    // (Update Pack 6, EV2: Edit's pencil and End now's square)
    edit: ['s', '<path d="M15.6 4.9a2 2 0 0 1 2.9 0l.6.6a2 2 0 0 1 0 2.9L8.6 18.9 4 20l1.1-4.6z"/><path d="m13.8 6.7 3.5 3.5"/>'],
    stop: ['f', '<rect x="6" y="6" width="12" height="12" rx="1.8"/>']
  };
  function icon(name, cls = '') {
    // (Update Pack 6: the Event QRs' calendar with a star is the Event order type's icon, drawn by order-type-icons.js)
    if (name === 'event') return window.RestroOrderTypeIcons?.svg('event', `qi qi-event ${cls}`.trim()) || el('span', { class: 'qi' });
    const [kind, body, outline] = ICONS[name], s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', kind === 'm' ? '0 -960 960 960' : '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `qi qi-${kind === 's' ? 'line' : 'fill'} qi-${name} ${cls}`.trim());
    s.innerHTML = kind === 'm' ? `<path d="${body}"${outline ? ` stroke="currentColor" stroke-width="${outline}" stroke-linejoin="miter"` : ''}/>` : body; return s;
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
  // "today" or "8 Nov" (as the designs: "Replaced 8 Nov by ‹name›" the day after)
  const dayWord = t => (daysApart(t, Date.now()) === 0 ? 'today' : dayMonth(t));
  // "Fri 6 Nov"
  const weekdayDate = t => { const d = new Date(t); return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const who = () => window.RestroStaff?.current?.name || null;
  // Who did it: the staff member's full name (owner, 14 Nov 2026: "by ‹name›", not initials; the Counter and the slips
  // keep initials)
  const byWho = name => (typeof name === 'string' && name.trim() ? ` by ${name.trim().replace(/\s+/g, ' ')}` : '');

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
    return records.some(r => r.code === code) || eventCodes().includes(code) || formCodes().includes(code) ? newCode() : code;
  }
  // (the restaurant in the link: its name in small letters, words joined by "-", so the page can show it: "Hotel Sri Sai"
  // is hotel-sri-sai)
  const slug = () => (window.RestroRestaurantName?.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'restaurant';
  const pathFor = (kind, name, code) => `${slug()}/${kind === 'table' ? `T${String(name).replace(/[^A-Za-z0-9]+/g, '')}` : KINDS[kind].prefix}-${code}`;
  const linkOf = r => `${HOST}/${r.path}`, urlOf = r => `https://${linkOf(r)}`;
  // The typed link on a card: a long one goes onto a second line after a "/" (the GitHub address is long)
  const linkWords = link => link.split('/').flatMap((part, i, all) => (i < all.length - 1 ? [`${part}/`, el('wbr')] : [part]));
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

  // ---------- events (Update Pack 6, D–E) ----------
  const okEvent = e => e && typeof e.id === 'string' && typeof e.name === 'string' && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start;
  let events = [];
  function loadEvents() { try { const v = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); events = Array.isArray(v) ? v.filter(okEvent) : []; } catch { events = []; } }
  function storeEvents() { try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)); } catch {} window.RestroSync?.wrote(EVENTS_KEY); changed(); }
  loadEvents();
  const eventTables = e => (e.qrs === 'tables' && Array.isArray(e.tables) ? e.tables.filter(t => t && typeof t.code === 'string') : []);
  const eventCodes = () => events.flatMap(e => (e.qrs === 'tables' ? eventTables(e).map(t => t.code) : [e.code])).filter(Boolean);
  const eventTableLabel = t => `Event table ${t.floor ? floor().tables.find(x => x.id === t.floor)?.name ?? t.name : t.name}`;
  // Its sessions: one from its start to its end; with "Open only these hours each day", one a day from the start's time
  // to the end's time (past midnight: on into the next day)
  function sessions(e) {
    if (!e.daily) return [{ from: e.start, to: e.end }];
    const s = new Date(e.start), en = new Date(e.end), out = [];
    const length = (((en.getHours() * 60 + en.getMinutes()) - (s.getHours() * 60 + s.getMinutes()) + 1440) % 1440 || 1440) * MIN;
    for (let i = 0; i < 62; i++) {
      const from = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i, s.getHours(), s.getMinutes()).getTime();
      if (from >= e.end) break;
      out.push({ from, to: Math.min(from + length, e.end) });
    }
    return out;
  }
  // Where it stands: 'upcoming' (before its start), 'live' (from its start to its end: open while a session is on, and
  // between a day's sessions waiting for the next) or 'ended' (its end passed, or End now)
  function evState(e, now = Date.now()) {
    const end = Math.min(e.end, Number(e.endedAt) || Infinity);
    if (now >= end) return { state: 'ended', at: end, early: end < e.end };
    if (now < e.start) return { state: 'upcoming' };
    const all = sessions(e), cur = all.find(s => now >= s.from && now < s.to), next = all.find(s => s.from > now);
    return { state: 'live', open: Boolean(cur), until: cur ? cur.to : null, next: next ? next.from : null, last: !next };
  }
  const isOn = e => evState(e).state !== 'ended';
  // "Mon 9 Nov · 7:00 PM – 11:30 PM"; over several days, daily: "Fri 13 – Sun 15 Nov · 6:00 PM – 11:00 PM daily" (EV7's
  // heading: "… · open 6:00 PM – 11:00 PM each day"); straight through: "Fri 13 Nov, 6:00 PM – Sun 15 Nov, 11:00 PM"
  function datesText(e, eachDay = false) {
    const days = e.daily ? sessions(e) : null, oneDay = e.daily ? days.length <= 1 : e.end - e.start <= DAY && daysApart(e.start, e.end) <= 1;
    const hours = `${clock(e.start)} – ${clock(e.end)}`;
    if (oneDay) return `${weekdayDate(e.start)} · ${hours}`;
    if (!e.daily) return `${weekdayDate(e.start)}, ${clock(e.start)} – ${weekdayDate(e.end)}, ${clock(e.end)}`;
    const range = daysRange(e.start, days.at(-1).from);
    return eachDay ? `${range} · open ${hours} each day` : `${range} · ${hours} daily`;
  }
  // "Fri 13 – Sun 15 Nov"; over two months "Fri 30 Oct – Sun 1 Nov"
  function daysRange(from, to) {
    const a = new Date(from), b = new Date(to), sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    return `${sameMonth ? `${WEEKDAYS[a.getDay()].slice(0, 3)} ${a.getDate()}` : weekdayDate(from)} – ${weekdayDate(to)}`;
  }
  // An event table's card (EV3's card preview): its hours on top ("6:00 PM – 11:00 PM daily"; one day "4:00 PM –
  // 10:00 PM"; straight through several days "Fri 6:00 PM – Sun 11:00 PM"), then the event and its days ("‹event› · Fri
  // 13 – Sun 15 Nov"), then what customers do
  function tableWords(e) {
    const one = e.daily ? sessions(e).length <= 1 : e.end - e.start <= DAY && daysApart(e.start, e.end) <= 1, day3 = t => WEEKDAYS[new Date(t).getDay()].slice(0, 3);
    const heading = one ? `${clock(e.start)} – ${clock(e.end)}` : e.daily ? `${clock(e.start)} – ${clock(e.end)} daily` : `${day3(e.start)} ${clock(e.start)} – ${day3(e.end)} ${clock(e.end)}`;
    const days = one ? weekdayDate(e.start) : daysRange(e.start, e.daily ? sessions(e).at(-1).from : e.end);
    return { heading, date: e.name ? `${e.name} · ${days}` : days, text: 'Scan, order and pay. Your food comes to your table.' };
  }
  // "₹21,460" (whole rupees), "₹113.50"
  const rupees = paise => `₹${(paise / 100).toLocaleString('en-IN', paise % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // Its orders on this device and what of them counts as taken (as Orders' Total: RestroOrders.kept)
  let tally = null;
  function ordersOfEvents() {
    if (tally) return tally;
    tally = new Map();
    const list = window.RestroCounter?.orders?.() || [], kept = o => (typeof window.RestroOrders?.kept === 'function' ? window.RestroOrders.kept(o) : o.paidAt ? Number(o.total) || 0 : 0);
    for (const o of list) {
      const id = o?.type === 'event' && o.event && typeof o.event === 'object' ? o.event.id : null; if (typeof id !== 'string') continue;
      const t = tally.get(id) || { n: 0, kept: 0 }; t.n += 1; t.kept += kept(o); tally.set(id, t);
    }
    return tally;
  }
  const ordersOf = e => ordersOfEvents().get(e.id) || { n: 0, kept: 0 };
  const hasOrders = e => e.hadOrders === true || ordersOf(e).n > 0;
  // (an event that has had an order keeps that mark, so Delete stays off after its orders leave this device)
  function noteOrders() {
    tally = null; let marked = false;
    for (const e of events) if (!e.hadOrders && ordersOf(e).n > 0) { e.hadOrders = true; marked = true; }
    if (marked) storeEvents();
  }
  const dishCount = e => (Array.isArray(e.menu?.items) ? e.menu.items.length : 0) + (Array.isArray(e.menu?.own) ? e.menu.own.length : 0);
  const tablesWords = e => { const n = eventTables(e).length; return e.tablesFrom === 'floor' ? `${plural(n, 'table')} from Floor` : `${n} event ${n === 1 ? 'table' : 'tables'}`; };
  // The line on its card in the list: "One QR · Dine-in + Takeaway · 38 orders · ₹21,460"; "12 event tables · 29 dishes"
  function infoLine(e) {
    const o = ordersOf(e), parts = e.qrs === 'tables' ? [tablesWords(e), dishCount(e) ? plural(dishCount(e), 'dish', 'dishes') : ''] : ['One QR', (MODES[e.mode] || MODES.both).label];
    if (o.n) parts.push(plural(o.n, 'order'), rupees(o.kept));
    return parts.filter(Boolean).join(' · ');
  }
  // "Starts Fri", "Starts today", "Starts 21 Nov"; between a day's sessions "Opens 6:00 PM", "Opens Sat"
  function dayWords(t) { const n = daysApart(Date.now(), t); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 7 ? WEEKDAYS[new Date(t).getDay()].slice(0, 3) : dayMonth(t); }
  // "in 4 hrs", "in 25 min", "in 2 days"
  function inWords(ms) { const m = Math.max(1, Math.round(ms / MIN)); if (m < 60) return `in ${m} min`; const h = Math.floor(m / 60); if (h < 48) return `in ${h} ${h === 1 ? 'hr' : 'hrs'}`; return `in ${Math.floor(h / 24)} days`; }

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
  // (owner, 14 Nov 2026) a business day's break, and its last order before the break
  const breakOn = key => window.RestroPrefs?.breakOn?.(key) || null;
  const lastBreakOn = key => window.RestroPrefs?.lastOrderBreakOn?.(key) ?? null;
  // The next opening from a moment: { at, key } (within two weeks), or null when the restaurant never opens. The end of
  // a break is an opening too, unless `dayStart` (1 business day: the next day's opening, not the break's end)
  function nextOpening(t, dayStart = false) {
    const start = businessDay(t);
    for (let i = 0; i < 15; i++) {
      const key = addDays(start, i), h = hoursOn(key), b = dayStart ? null : breakOn(key); if (!h) continue;
      if (h.from > t) return { at: h.from, key };
      if (b && b.to > t) return { at: b.to, key };
    }
    return null;
  }
  // "11:00 AM – 11:00 PM", with a break "11:00 AM – 3:30 PM, 7:00 PM – 11:00 PM"
  const hoursText = key => { const h = hoursOn(key), b = breakOn(key); return !h ? '' : b ? `${clock(h.from)} – ${clock(b.from)}, ${clock(b.to)} – ${clock(h.to)}` : `${clock(h.from)} – ${clock(h.to)}`; };
  // "tomorrow at 11:00 AM" / "today at 7:00 PM" / "Wednesday at 11:00 AM" (and the short "tomorrow 11:00 AM", "Wed 11:00 AM")
  function openingWords(at, short = false, byName = false) {
    const n = daysApart(Date.now(), at), day = WEEKDAYS[new Date(at).getDay()];
    const when = n === 0 ? 'today' : n === 1 && !byName ? 'tomorrow' : short ? day.slice(0, 3) : day;
    return short ? `${when} ${clock(at)}` : `${when} at ${clock(at)}`;
  }

  // ---------- the path for QR orders (I1) ----------
  // From the Android app (ANDROID-BRIDGE.md): { internet, wifiInternet, mobileVia, printers: [{ id, name, link: 'wired' |
  // 'bluetooth' | 'wifi', state: 'ok' | 'down', paper: 'ok' | null, device: { name, on, lastSeen } (a wired or Bluetooth
  // printer's), backup }] }. A Bluetooth printer works like a wired one, through the device it's paired with (Update
  // Pack 6, C). Without it the page knows only its own internet, and takes the kitchen printers as working.
  const cable = k => k.link !== 'wifi';
  // (a name given in Settings › Printers is the restaurant's for that printer)
  const kName = k => window.RestroPrefs?.get?.('printers')?.[k.id]?.name || k.name;
  let path = null, pathOkSince = 0, autoSince = 0, offlineSince = 0;
  // (the cloud from this device: by itself, or through another device over the restaurant Wi-Fi; owner, 14 Nov 2026)
  const internetHere = () => window.RestroConnectivity?.getStatus?.().cloudAvailable !== false;
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
    if (!kitchen.length || kitchen.some(k => k.state === 'ok' && (!cable(k) || k.device?.on !== false))) return null;
    if (kitchen.length > 1) return 'printers';
    const k = kitchen[0];
    return cable(k) ? (k.device?.on === false ? 'device' : 'wired') : 'wifi';
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
    const key = businessDay(now), h = hoursOn(key), last = lastOrderOn(key), b = breakOn(key), lastB = lastBreakOn(key);
    // (closed: a weekly day off, before opening, a break and its last order before it (owner, 14 Nov 2026), after the
    // last order time)
    let closed = null;
    if (!h) closed = { why: 'weekly', key };
    else if (now < h.from) closed = { why: 'before', key, h };
    else if (b && now >= b.from && now < b.to) closed = { why: 'break', key, h, b };
    else if (b && lastB != null && now >= lastB && now < b.from) closed = { why: 'lastbreak', key, h, b, last: lastB };
    else if (last != null && now >= last) closed = { why: last < h.to ? 'last' : 'after', key, h, last };
    // (a pause for a while ends by itself; "Until turned on" stays until someone turns it on; turned on after hours lasts
    // until the next opening time, when the business hours take over again)
    const off = o.off && (o.off.until == null || o.off.until > now) ? o.off : null;
    const late = o.late && (!o.late.until || o.late.until > now) ? o.late : null;
    if (off && off.until == null) return { state: 'hand', off, closed };
    if (closed && !late) return { state: 'closed', closed, h, last, off };
    if (off) return { state: 'paused', off, closed };
    const auto = autoPause(now);
    if (auto) return { state: 'auto', auto };
    // (on before a break: its last orders come first)
    return closed ? { state: 'late', late, closed } : { state: 'on', h, last, lastB: b && lastB != null && now < lastB ? lastB : null };
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
      el('div', { class: 'qrs-card-link' }, icon('link'), linkWords(linkOf(r))));
  }

  // ---------- what the screen shows ----------
  // page: 'table' | 'takeaway' | 'menu' | 'event'; area: 'all' or an area's id; picked: the QR ids ticked after a
  // long-press (Set), or null; selected: the table QR the panel shows; evTab: Event QRs' tab, 'events' (live and
  // upcoming) | 'history' (ended); evPick: the event picked on each tab
  const view = { page: 'table', area: 'all', search: '', picked: null, selected: null, evTab: 'events', evPick: { events: null, history: null } };
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
    // (Update Pack 6, A: Event QRs, the 4th pill, counts the events live now and coming up)
    const count = { table: records.filter(r => r.kind === 'table' && tables.some(t => t.id === r.table)).length, takeaway: qrOfKind('takeaway') ? 1 : 0, menu: qrOfKind('menu') ? 1 : 0, event: events.filter(isOn).length };
    const pill = (page, ic, label) => el('button', { type: 'button', class: `qrs-pill${view.page === page ? ' on' : ''}`, 'aria-current': view.page === page ? 'page' : null, onclick: () => go(page) },
      el('span', { class: 'qrs-pill-i' }, icon(ic)), el('span', { class: 'qrs-pill-t' }, label), el('span', { class: 'qrs-pill-n' }, String(count[page])));
    return el('aside', { class: 'qrs-side' },
      el('div', { class: 'qrs-sh' }, el('button', { type: 'button', class: 'qrs-home', 'aria-label': 'Home', onclick: goHome }, icon('home')), appArt(), el('h2', { id: 'qr-studio-title', class: 'qrs-studio', tabindex: '-1' }, 'Studio')),
      el('nav', { class: 'qrs-pills', 'aria-label': 'QR types' }, pill('table', 'table', 'Table QRs'), pill('takeaway', 'bag', 'Takeaway QR'), pill('menu', 'menu', 'Menu QR'), pill('event', 'event', 'Event QRs'),
        // (Menu design: the templates come in the next set; owner, 14 Nov 2026: one line, a tap says "Coming soon")
        el('button', { type: 'button', class: 'qrs-pill', onclick: () => toast('Coming soon', null, null) }, el('span', { class: 'qrs-pill-i' }, icon('palette')), el('span', { class: 'qrs-pill-t' }, 'Menu design'))),
      orderingCard(st));
  }
  const pauseBtn = (off = false) => btn('qrs-cbtn', 'Pause for a while', () => openPop('pause'), 'pause', { off });
  const untilWords = until => (daysApart(Date.now(), until) === 0 ? clock(until) : openingWords(until, true));
  // The QR ordering card (sidebar, bottom): the switch, where it stands, and what can be done
  function orderingCard(st) {
    const on = st.state === 'on' || st.state === 'late';
    let cls = '', line, text, buttons;
    const sw = el('button', { type: 'button', class: `qrs-switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': 'QR ordering', onclick: () => switchTapped(st), ...(st.state === 'auto' ? { 'aria-disabled': 'true' } : {}) }, el('span'));
    // (See devices all the time QR ordering is on, in QS46's place, so it is always there to tap (owner, 15 Nov 2026):
    // with every step working it shows them all green; on mobile data or with a kitchen printer down, how the orders get
    // through (QS45, QS47))
    const devices = on ? btn('qrs-cbtn plain', 'See devices', () => openPop('devices')) : null;
    if (st.state === 'on') { line = el('b', { class: 'ok' }, st.lastB ? `On · last orders before the break ${clock(st.lastB)}` : `On · last orders ${clock(st.last ?? st.h.to)}`); text = 'Follows your business hours. Table and Takeaway QRs take paid orders; the Menu QR always works.'; buttons = [devices, pauseBtn()]; }
    else if (st.state === 'late') { line = el('b', { class: 'ok' }, `On · turned on${byWho(st.late.by)} at ${clock(st.late.at)}`); text = 'Turned on by hand outside business hours, so it stays on until someone turns it off.'; buttons = [devices, pauseBtn(true)]; }
    else if (st.state === 'paused') { line = el('b', { class: 'warn' }, `Paused until ${untilWords(st.off.until)}`); text = 'Customers can see the menu but can’t order.'; buttons = [btn('qrs-cbtn', 'Resume now', resume, 'send')]; }
    else if (st.state === 'hand') { line = el('b', { class: 'warn' }, `Off until turned on${st.off.by ? ` ·${byWho(st.off.by)}` : ''} at ${clock(st.off.at)}`); text = 'Turned off by hand, so it stays off until someone turns it on. Customers can see the menu but can’t order.'; buttons = [btn('qrs-cbtn', 'Turn on', resume, 'send')]; }
    else if (st.state === 'auto') { cls = ' auto'; line = el('b', { class: 'bad' }, `Paused · ${REASONS[st.auto.reason].card}`); text = `Paused by itself at ${clock(st.auto.since)}. It turns back on by itself.`; buttons = [btn('qrs-cbtn plain', 'See devices', () => openPop('devices')), pauseBtn()]; }
    else {
      const c = st.closed, next = nextOpening(Date.now());
      // "Business hours 11:00 AM – 3:30 PM, 7:00 PM – 11:00 PM · last orders 10:30 PM." (QS48)
      const hoursLine = key => { const h = hoursOn(key); return h ? `Business hours ${hoursText(key)} · last orders ${clock(lastOrderOn(key) ?? h.to)}.` : ''; };
      const opens = next ? ` Opens ${openingWords(next.at, true)}.` : '';
      if (c.why === 'weekly') { line = el('b', {}, `Closed today${next ? ` · opens ${openingWords(next.at, true, true)}` : ''}`); text = `${WEEKDAYS[new Date(Date.now()).getDay()]} is your weekly off in business hours.`; }
      else if (c.why === 'last') { line = el('b', {}, `Closed · last orders were ${clock(c.last)}`); text = `${hoursLine(c.key)}${opens}`; }
      else if (c.why === 'lastbreak') { line = el('b', {}, `Closed · last orders before the break were ${clock(c.last)}`); text = `${hoursLine(c.key)}${opens}`; }
      else if (c.why === 'break') { line = el('b', {}, `Closed for a break${next ? ` · opens ${clock(next.at)}` : ''}`); text = hoursLine(c.key); }
      else { line = el('b', {}, `Closed${next ? ` · opens ${openingWords(next.at, true)}` : ''}`); text = hoursLine(next ? next.key : c.key); }
      buttons = [pauseBtn(true)];
    }
    return el('section', { class: `qrs-ord${cls}`, 'aria-label': 'QR ordering' }, el('div', { class: 'qrs-ord-top' }, el('h3', {}, 'QR ordering'), sw), el('p', { class: 'qrs-ord-line' }, line), el('p', { class: 'qrs-ord-text' }, text), el('div', { class: 'qrs-ord-btns' }, buttons));
  }

  // The banner under a page's line while QR ordering isn't taking orders (I1, I3); the Menu QR's own (green)
  function bannerEl(st, page) {
    if (st.state === 'on' || st.state === 'late') return null;
    if (page === 'menu') return el('div', { class: 'qrs-banner good', role: 'status' }, el('span', { class: 'qrs-bn-i' }, icon('tick')),
      el('div', {}, el('b', {}, 'Menu QR still works'), el('span', {}, `QR ordering is ${st.state === 'closed' ? 'closed' : 'paused'}, but customers can still see the menu and prices.`)));
    let cls, ic, title, text, action = null;
    if (st.state === 'paused') { cls = 'warn'; ic = el('span', { class: 'qrs-bn-i' }, icon('pausebn')); title = `QR ordering paused until ${untilWords(st.off.until)}`; text = `Customers see the menu with “${CUSTOMER_PAUSED}” Paid orders still go to the kitchen.`; action = btn('qrs-bn-btn', 'Resume now', resume, 'send'); }
    else if (st.state === 'hand') { cls = 'warn'; ic = el('span', { class: 'qrs-bn-i' }, icon('pausebn')); title = `QR ordering off until turned on · turned off${byWho(st.off.by)} at ${clock(st.off.at)}`; text = `Stays off until someone turns it on. Customers see the menu with “${CUSTOMER_PAUSED}”`; action = btn('qrs-bn-btn', 'Turn on', resume, 'send'); }
    else if (st.state === 'auto') { cls = 'bad'; ic = el('span', { class: 'qrs-bn-i' }, el('span', { class: 'qrs-bn-x' }, '!')); title = `QR ordering paused · ${REASONS[st.auto.reason].banner}`; text = `Paused by itself at ${clock(st.auto.since)} · turns back on by itself. Customers see “${CUSTOMER_PAUSED}”`; action = btn('qrs-bn-btn', 'See devices', () => openPop('devices')); }
    else {
      const c = st.closed, next = nextOpening(Date.now());
      cls = 'shut'; ic = el('span', { class: 'qrs-bn-i' }, icon('clock')); text = 'Turns on by itself at opening time.';
      title = c.why === 'weekly' ? `QR ordering closed today${next ? ` · opens ${openingWords(next.at, false, true)}` : ''}` : c.why === 'last' ? `QR ordering closed · last orders were at ${clock(c.last)}`
        : c.why === 'lastbreak' ? `QR ordering closed · last orders before the break were at ${clock(c.last)}` : c.why === 'break' ? `QR ordering closed for a break${next ? ` · opens ${openingWords(next.at)}` : ''}`
        : `QR ordering closed${next ? ` · opens ${openingWords(next.at)}` : ''}`;
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

  // Event QRs (Update Pack 6, D: EV1 none yet, EV2 one QR for the whole event picked, EV7 one per event table picked).
  // Two tabs right of the title (owner, 16 Nov 2026): Events, with New event and the events under LIVE NOW and UPCOMING,
  // and History, every event that has ended, newest first, by month; the one picked on the right. Before the first
  // event, EV1 as drawn (no tabs). Restaurant QRs and event QRs never pause each other (H1), so the restaurant's banners
  // aren't shown here.
  const info = (title, items) => el('section', { class: 'qrs-info' }, el('h3', {}, title), el('ul', {}, items.map(x => el('li', {}, x))));
  const noneEl = (title, text) => el('div', { class: 'qrs-evnone' }, icon('event'), el('b', {}, title), el('span', {}, text));
  const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  function eventPage() {
    if (form) return formPage();
    const now = Date.now(), all = events.map(e => ({ e, s: evState(e, now) })), history = view.evTab === 'history';
    const by = { live: all.filter(x => x.s.state === 'live').sort((a, b) => a.e.start - b.e.start), upcoming: all.filter(x => x.s.state === 'upcoming').sort((a, b) => a.e.start - b.e.start),
      ended: all.filter(x => x.s.state === 'ended').sort((a, b) => b.s.at - a.s.at) };
    const listed = history ? by.ended : [...by.live, ...by.upcoming], sel = listed.find(x => x.e.id === view.evPick[view.evTab]) || listed[0] || null;
    view.evPick[view.evTab] = sel ? sel.e.id : null;
    const line = el('p', { class: 'qrs-line' }, 'A QR for one event, with its own menu, prices, dates and times. It stops working by itself when the event ends.');
    // (New event: step 1, details and tables or QR (EV3–EV3d); Edit: in the next parts)
    const newBtn = el('button', { type: 'button', class: `qrs-evnew${sel ? '' : ' first'}`, onclick: openForm },
      el('span', { class: 'qrs-evnew-i' }, icon('plus')), el('b', {}, 'New event'), el('small', {}, 'Name, dates, tables, menu'));
    const facts = () => el('div', { class: 'qrs-facts ev wide' },
      info('What an event QR does', ['Customers scan, order from the event menu and pay', 'Works only on the dates and times you set, even outside business hours; it can run over several days', 'Several events can run at once']),
      info('Tables and QRs', ['One QR per event table: use Floor tables or give event table numbers', 'Or one QR for the whole event: Dine-in + Takeaway, Takeaway only, or Menu only. Customers give name and phone']),
      info('The event menu', ['Add whole categories or single dishes, with their photos; change price, photo or printer for this event', 'Add event-only dishes; they end with the event', 'KOTs print as EVENT; orders show in Orders and every total']));
    if (!all.length) return [headEl('Event QRs', null, null), line,
      el('div', { class: 'qrs-ev' }, el('div', { class: 'qrs-evlist' }, newBtn, noneEl('No events yet', 'Create one for a festival, a brunch, a party or a wedding.')), facts())];
    const tab = (id, label, n) => el('button', { type: 'button', role: 'tab', class: `qrs-chip qrs-evtab${view.evTab === id ? ' on' : ''}`, 'aria-selected': String(view.evTab === id),
      onclick: () => { if (view.evTab !== id) { view.evTab = id; render(); } } }, el('span', {}, label), el('small', {}, String(n)));
    const tabs = el('div', { class: 'qrs-evtabs', role: 'tablist', 'aria-label': 'Events or history' }, tab('events', 'Events', by.live.length + by.upcoming.length), tab('history', 'History', by.ended.length));
    if (!sel) return [headEl('Event QRs', tabs, null), line, history
      ? el('div', { class: 'qrs-ev' }, el('div', { class: 'qrs-evlist history' }, noneEl('No past events yet', 'Events move here by themselves when they end.')))
      : el('div', { class: 'qrs-ev' }, el('div', { class: 'qrs-evlist' }, newBtn, noneEl('No live or upcoming events', 'Create one for a festival, a brunch, a party or a wedding.')), facts())];
    // (History: one label a month, "NOVEMBER 2026", by when each event ended)
    const groups = history ? by.ended.reduce((out, x) => { const d = new Date(x.s.at), label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      if (out.at(-1)?.[0] !== label) out.push([label, []]); out.at(-1)[1].push(x); return out; }, [])
      : [['LIVE NOW', by.live], ['UPCOMING', by.upcoming]].filter(([, l]) => l.length);
    const list = el('div', { class: `qrs-evlist${history ? ' history' : ''}` }, history ? null : newBtn,
      el('div', { class: 'qrs-evscroll' }, groups.map(([label, l]) => [el('p', { class: 'qrs-evlab' }, label), l.map(x => eventCard(x.e, x.s, x === sel))])));
    return [headEl('Event QRs', tabs, eventTools(sel.e, sel.s)), line, el('div', { class: 'qrs-ev' }, list, sel.e.qrs === 'tables' ? tablesPanel(sel.e, sel.s) : wholePanel(sel.e, sel.s))];
  }
  // An event in the list: its tile, name, dates, QRs and orders, and where it stands (Live, Starts Fri, Ended)
  function eventCard(e, s, on) {
    const chip = s.state === 'ended' ? el('span', { class: 'qrs-evchip ended' }, 'Ended') : s.state === 'upcoming' ? el('span', { class: 'qrs-evchip soon' }, `Starts ${dayWords(e.start)}`)
      : s.open ? el('span', { class: 'qrs-evchip live' }, el('i'), 'Live') : el('span', { class: 'qrs-evchip soon' }, `Opens ${daysApart(Date.now(), s.next) === 0 ? clock(s.next) : dayWords(s.next)}`);
    // (the chip keeps its own column on the right: the lines wrap before it, as EV2)
    return el('button', { type: 'button', class: `qrs-evcard${on ? ' on' : ''}${s.state === 'ended' ? ' ended' : ''}`, 'aria-pressed': String(on), onclick: () => { view.evPick[view.evTab] = e.id; render(); } },
      el('span', { class: 'qrs-evcard-i' }, icon('event')),
      el('span', { class: 'qrs-evcard-t' }, el('b', {}, e.name), el('span', { class: 'qrs-evcard-d' }, datesText(e)), el('small', {}, infoLine(e))), chip);
  }
  // The buttons for the event picked (EV2, EV7): End now is off before it starts and after it ends; Delete is off once
  // it has had an order, so takings never disappear (greyed, never hidden). End now and Delete need the internet, as
  // Delete QR: the cloud keeps which codes work. One QR for the whole event can be replaced as the Takeaway QR (owner,
  // 16 Nov 2026: between Send and Edit); an event table's QR, from its card. Once it has ended (History), only Delete
  // can be used.
  function eventTools(e, s) {
    const why = !online() ? 'Needs internet' : '', tables = e.qrs === 'tables', had = hasOrders(e), live = s.state === 'live', ended = s.state === 'ended';
    return [btn('', 'Test scan', () => openPop('test', { event: e.id }), 'scan', { off: ended || !online(), why: ended ? '' : why }),
      btn('tint', tables ? 'Print all' : 'Reprint', () => printEvent(e), 'print', { off: ended }),
      btn('', tables ? 'Send all' : 'Send', () => openPop('send', { event: e.id }), 'send', { off: ended || !online(), why: ended ? '' : why }),
      tables ? null : btn('', 'Replace QR', () => openPop('replace-event', { event: e.id }), 'replace', { off: ended }),
      btn('', 'Edit', () => toast('Coming soon', null, null), 'edit', { off: ended }),
      btn('del', 'End now', () => openPop('end', { event: e.id }), 'stop', { off: !live || !online(), why: live ? why : '', showWhy: true }),
      btn('del', 'Delete', () => openPop('delete-event', { event: e.id }), 'trash', { off: had || !online(), why: had ? '' : why, showWhy: true })];
  }
  // Where it stands, in This event's first row
  function statusEl(e, s) {
    const now = Date.now();
    if (s.state === 'upcoming') return el('b', { class: 'soon' }, `Starts ${weekdayDate(e.start)}, ${clock(e.start)}`);
    if (s.state === 'ended') return el('span', { class: 'muted' }, s.early ? `Ended ${daysApart(s.at, now) === 0 ? 'today' : weekdayDate(s.at)}, ${clock(s.at)}${byWho(e.endedBy)}` : `Ended ${weekdayDate(s.at)}, ${clock(s.at)}`);
    if (!s.open) return el('b', { class: 'soon' }, `Opens ${dayWords(s.next)}, ${clock(s.next)}`);
    return el('b', { class: 'ok' }, s.last ? `Live · ends ${inWords(s.until - now)}` : `Live · open until ${clock(s.until)}`);
  }
  // "12 dishes · 10 from your menu · 2 event-only"
  function menuWords(e) {
    const mine = Array.isArray(e.menu?.items) ? e.menu.items.length : 0, own = Array.isArray(e.menu?.own) ? e.menu.own.length : 0, n = mine + own;
    if (!n) return 'No dishes yet';
    return own && mine ? `${plural(n, 'dish', 'dishes')} · ${mine} from your menu · ${own} event-only` : own ? `${plural(own, 'event-only dish', 'event-only dishes')}` : `${plural(n, 'dish', 'dishes')} from your menu`;
  }
  const factsEl = (title, rows) => el('section', { class: 'qrs-info rows' }, el('h3', {}, title), el('dl', {}, rows.map(([a, b]) => el('div', {}, el('dt', {}, a), el('dd', {}, b)))));
  // One QR for the whole event picked (EV2): its card in the grey box; This event and When it ends
  function wholePanel(e, s) {
    const o = ordersOf(e), mode = MODES[e.mode] || MODES.both, menuOnly = e.mode === 'menu';
    const rows = [['Status', statusEl(e, s)], ['Dates and times', datesText(e)], ['QRs', 'One QR for the whole event'],
      ['Order type', menuOnly ? 'Menu only · no ordering' : `${mode.label} · name and phone`], ['Menu', menuWords(e)]];
    if (!menuOnly) rows.push(['KOTs go to', 'Each dish’s own printer'], ['Orders so far', o.n ? `${o.n} · ${rupees(o.kept)}` : 'None yet']);
    rows.push(['Created', `${dayMonth(e.createdAt)}${byWho(e.createdBy)}`]);
    const at = s.state === 'ended' ? s.at : e.end, when = daysApart(Date.now(), at) === 0 ? clock(at) : `${clock(at)} on ${weekdayDate(at)}`;
    const first = menuOnly ? (s.state === 'ended' ? `The QR stopped showing the menu at ${when}` : `The QR stops showing the menu at ${when} by itself`)
      : s.state === 'ended' ? `The QR stopped taking orders at ${when}` : `The QR stops taking orders at ${when} by itself`;
    return [el('div', { class: 'qrs-evbox' }, eventCardEl(e)),
      el('div', { class: 'qrs-facts ev' }, factsEl('This event', rows), info('When it ends', [first, 'Customers who scan later see “This event has ended.”', 'Delete is off once an event has orders, so takings never disappear']))];
  }
  // One QR per event table picked (EV7): what it is, then its tables' QRs with their numbers. Tapping a table's card
  // opens its own Reprint · Send · Replace QR · Delete, as a table QR's (owner, 16 Nov 2026); not once the event has ended.
  function tablesPanel(e, s) {
    const tables = eventTables(e), now = Date.now(), ended = s.state === 'ended';
    const hour = t => { const d = new Date(t); return d.getMinutes() ? clock(t) : `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };
    const sub = s.state === 'upcoming' ? el('span', {}, `Starts ${dayWords(e.start)} ${hour(e.start)}`) : ended ? el('span', { class: 'muted' }, 'Ended')
      : s.open ? el('span', { class: 'live' }, el('i'), 'Live') : el('span', {}, `Opens ${daysApart(now, s.next) === 0 ? '' : `${dayWords(s.next)} `}${hour(s.next)}`);
    const opens = t => (ended ? {} : { tabindex: '0', 'aria-label': eventTableLabel(t), onclick: () => openPop('etable', { event: e.id, table: t.id }),
      onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPop('etable', { event: e.id, table: t.id }); } } });
    return el('div', { class: 'qrs-evtables' },
      el('div', { class: 'qrs-evhead' }, el('div', {}, el('b', {}, e.name), el('span', {}, `${datesText(e, true)} · Order type: Event`)),
        el('span', { class: 'qrs-evhead-chip' }, `${tablesWords(e)} · ${plural(tables.length, 'QR')}`)),
      el('div', { class: 'qrs-evgrid', role: 'list' }, tables.map(t => el('div', { class: `qrs-etcard${ended ? '' : ' tap'}`, role: 'listitem', ...opens(t) },
        el('span', { class: 'qrs-etqr' }, qrSvg(`https://${HOST}/${t.path}`, tableMark(t), KINDS.event.accent)), el('b', {}, eventTableLabel(t)), sub.cloneNode(true)))));
  }
  // (an event table's number on its QR: a Floor table's name as Floor has it now)
  const tableMark = t => String(t.floor ? floor().tables.find(x => x.id === t.floor)?.name ?? t.name : t.name);
  const brandEl = () => { const restaurant = window.RestroRestaurantName?.value || '', logo = (Array.from(restaurant.trim())[0] || 'R').toLocaleUpperCase('en-IN');
    return el('div', { class: 'qrs-card-brand' }, el('span', { class: 'qrs-card-logo' }, logo), el('span', { class: 'qrs-card-name' }, restaurant)); };
  // One QR for the whole event: its card (EV2), drawn as the Takeaway card, in teal, with the event's dates and line. An
  // event table's (t): as EV3's card preview, its hours on top, "Event table 3" with its number on the QR, the event and
  // its days, "Scan, order and pay. Your food comes to your table." (printed the same way)
  function eventCardEl(e, t = null) {
    const mode = MODES[e.mode] || MODES.both, link = `${HOST}/${t ? t.path : e.path}`, title = t ? eventTableLabel(t) : e.name || 'Event name', w = t ? tableWords(e) : null;
    return el('div', { class: `qrs-card k-event${t ? ' k-etable' : ''}`, style: `--accent:${KINDS.event.accent}`, role: 'img', 'aria-label': `${title} card: ${link}` },
      brandEl(), el('div', { class: 'qrs-card-head' }, t ? w.heading : mode.heading), qrSvg(`https://${link}`, t ? tableMark(t) : null, KINDS.event.accent, 'qrs-card-qr'),
      el('div', { class: 'qrs-card-title' }, icon('event', 'qrs-card-ti'), el('span', {}, title)), el('div', { class: 'qrs-card-date' }, t ? w.date : datesText(e)),
      el('div', { class: 'qrs-card-text' }, t ? w.text : mode.line), el('div', { class: 'qrs-card-rule' }), el('div', { class: 'qrs-card-type' }, 'QR not scanning? Type this link'),
      el('div', { class: 'qrs-card-link' }, icon('link'), linkWords(link)));
  }
  // ---------- New event, step 1 (Update Pack 6, E: EV3, EV3b, EV3c, EV3d): details, and its tables or its one QR ----------
  // The draft while the form is open: name; start and end (ms); daily ("Open only these hours each day", shown once it
  // runs over more than a day, on as EV3; its two times are the start's and the end's); qrs 'tables' | 'whole'; tables
  // from 'event' (numbers [{ n, on }]: Table 1–12, + Add; a tap leaves one out or puts it back) or 'floor' (off: the
  // Floor tables left out); mode 'both' | 'takeaway' | 'menu'; the codes its QRs will get (on the card preview); pick:
  // the field whose picker is open; cal: the month its calendar shows. The menu (EV4–EV6) and the printers (EV8) come
  // next; until then Next says "Coming soon".
  let form = null;
  const HOUR = 36e5;
  function openForm() {
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1).getTime();
    form = { name: '', start, end: start + 4 * HOUR, daily: true, qrs: 'tables', from: 'event', numbers: Array.from({ length: 12 }, (_, i) => ({ n: i + 1, on: true })),
      off: new Set(), mode: 'both', code: null, codes: new Map(), pick: null, cal: null, step: 1, menu: { picked: new Set(), changes: new Map(), own: [], cat: null } };
    form.code = newCode(); pop = null; render(); loadKitchen();
  }
  function closeForm() { form = null; render(); }
  const multiDay = () => form.end - form.start > DAY;
  const formCodes = () => (form ? [form.code, ...form.codes.values()].filter(Boolean) : []);
  const codeFor = key => { if (!form.codes.has(key)) form.codes.set(key, newCode()); return form.codes.get(key); };
  // Its tables as they will be: the event table numbers ticked, or the Floor tables not left out
  function formTables() {
    const path = (name, code) => `${slug()}/E${String(name).replace(/[^A-Za-z0-9]+/g, '')}-${code}`;
    if (form.from === 'floor') return floor().tables.filter(t => !form.off.has(t.id)).map(t => { const code = codeFor(t.id); return { id: t.id, name: t.name, floor: t.id, code, path: path(t.name, code) }; });
    return form.numbers.filter(x => x.on).map(x => { const code = codeFor(`n${x.n}`); return { id: `n${x.n}`, name: String(x.n), code, path: path(x.n, code) }; });
  }
  const formEvent = () => ({ name: form.name.trim(), start: form.start, end: form.end, daily: multiDay() && form.daily, qrs: form.qrs, mode: form.mode, path: `${slug()}/${KINDS.event.prefix}-${form.code}` });
  // What stops Next: no name; it ends before it starts, or its end has passed; no table
  function formProblem() {
    if (!form.name.trim()) return { what: 'name' };
    if (form.end <= form.start) return { what: 'time', text: 'It ends before it starts' };
    if (form.end <= Date.now()) return { what: 'time', text: 'That end time has passed' };
    if (form.qrs === 'tables' && !formTables().length) return { what: 'tables', text: 'Pick at least one table' };
    return null;
  }
  // "Fri 13, Sat 14, Sun 15 Nov · closed in between"; over 4 days "Fri 13 – Tue 24 Nov · 12 days · closed in between";
  // off: "Open the whole time, Fri 6:00 PM to Sun 11:00 PM"
  function dailyWords() {
    const day3 = t => WEEKDAYS[new Date(t).getDay()].slice(0, 3);
    if (!form.daily) return `Open the whole time, ${day3(form.start)} ${clock(form.start)} to ${day3(form.end)} ${clock(form.end)}`;
    const days = sessions({ ...formEvent(), daily: true }).map(s => s.from);
    const words = days.length > 4 ? `${daysRange(days[0], days.at(-1))} · ${days.length} days`
      : days.map((t, i) => { const d = new Date(t), next = days[i + 1] ? new Date(days[i + 1]) : null; return `${day3(t)} ${d.getDate()}${!next || next.getMonth() !== d.getMonth() ? ` ${MONTHS[d.getMonth()]}` : ''}`; }).join(', ');
    return `${words} · closed in between`;
  }
  function formPage() {
    if (form.step === 2) return menuStepPage();
    const f = form, multi = multiDay(), tables = f.qrs === 'tables', menuOnly = !tables && f.mode === 'menu', problem = formProblem();
    const next = btn('teal', 'Next: choose the menu', nextStep); next.disabled = Boolean(problem);
    const line = el('p', { class: 'qrs-line' }, tables ? 'Step 1 of 3 · details and tables. Then the menu and the printers.' : menuOnly ? 'Step 1 of 2 · details and QR. Then the menu.' : 'Step 1 of 3 · details and QR. Then the menu and the printers.');
    const step = (n, label, on) => el('li', { class: `qrs-step${on ? ' on' : ''}`, 'aria-current': on ? 'step' : null }, el('span', {}, String(n)), el('b', {}, label));
    const joint = () => el('li', { class: 'qrs-step-line', 'aria-hidden': 'true' });
    const steps = el('ol', { class: 'qrs-steps', 'aria-label': 'Steps' }, step(1, 'Details', true), joint(), step(2, 'Menu'), menuOnly ? null : [joint(), step(3, 'Printers')]);
    const lab = text => el('p', { class: 'qrs-flab' }, text);
    // a date or time field; a tap opens its calendar or its wheels under it
    const field = (key, ic, text, off = false) => el('div', { class: 'qrs-fwrap' },
      el('button', { type: 'button', class: `qrs-field${f.pick === key ? ' on' : ''}`, disabled: off, 'aria-expanded': String(f.pick === key),
        onclick: () => { f.pick = f.pick === key ? null : key; if (f.pick?.endsWith('Day')) { const d = new Date(key === 'startDay' ? f.start : f.end); f.cal = `${d.getFullYear()}-${d.getMonth() + 1}`; } render(); } },
        icon(ic), el('span', {}, text)),
      f.pick === key ? (key.endsWith('Day') ? calendarEl(key) : wheelsEl(key)) : null);
    const name = el('input', { type: 'text', class: `qrs-input${f.name.trim() ? ' filled' : ''}`, value: f.name, maxlength: '60', placeholder: 'Name of the event', 'aria-label': 'Event name',
      autocapitalize: 'words', autocomplete: 'off', spellcheck: 'false', oninput: ev => { f.name = ev.target.value; ev.target.classList.toggle('filled', Boolean(f.name.trim())); paintForm(); } });
    const seg = (cls, opts, cur, set) => el('div', { class: `qrs-seg ${cls}`, role: 'radiogroup' }, opts.map(([id, label]) =>
      el('button', { type: 'button', role: 'radio', class: `qrs-seg-o${cur === id ? ' on' : ''}`, 'aria-checked': String(cur === id), onclick: () => { if (cur !== id) { set(id); f.pick = null; render(); } } }, label)));
    const left = [steps,
      lab('Event name'), name,
      el('div', { class: 'qrs-when' }, el('div', {}, lab('Starts'), el('div', { class: 'qrs-frow' }, field('startDay', 'cal', weekdayDate(f.start)), field('startTime', 'clock', clock(f.start)))),
        el('div', {}, lab('Ends'), el('div', { class: 'qrs-frow' }, field('endDay', 'cal', weekdayDate(f.end)), field('endTime', 'clock', clock(f.end))))),
      problem?.what === 'time' ? el('p', { class: 'qrs-ferr', role: 'alert' }, problem.text) : null,
      multi ? el('div', { class: `qrs-daily${f.daily ? '' : ' off'}` },
        el('button', { type: 'button', role: 'switch', class: `qrs-switch teal${f.daily ? ' on' : ''}`, 'aria-checked': String(f.daily), 'aria-label': 'Open only these hours each day', onclick: () => { f.daily = !f.daily; f.pick = null; render(); } }, el('span')),
        el('div', { class: 'qrs-daily-t' }, el('b', {}, 'Open only these hours each day'), el('span', {}, dailyWords())),
        field('dailyFrom', 'clock', clock(f.start), !f.daily), el('span', { class: 'qrs-to' }, 'to'), field('dailyTo', 'clock', clock(f.end), !f.daily)) : null,
      lab('QRs'), seg('qrs', [['tables', 'One QR per event table'], ['whole', 'One QR for the whole event']], f.qrs, id => { f.qrs = id; })];
    if (tables) {
      const list = formTables(), n = list.length;
      const chip = (text, on, tap) => el('button', { type: 'button', class: `qrs-tchip${on ? '' : ' off'}`, 'aria-pressed': String(on), onclick: () => { tap(); f.pick = null; render(); } }, text);
      const chips = f.from === 'floor' ? floor().tables.map(t => chip(tableLabel(t.name), !f.off.has(t.id), () => { f.off.has(t.id) ? f.off.delete(t.id) : f.off.add(t.id); }))
        : [...f.numbers.map(x => chip(tableLabel(x.n), x.on, () => { x.on = !x.on; })),
          el('button', { type: 'button', class: 'qrs-tchip add', onclick: () => { f.numbers.push({ n: Math.max(0, ...f.numbers.map(x => x.n)) + 1, on: true }); f.pick = null; render(); } }, '+ Add')];
      left.push(el('p', { class: 'qrs-fdesc' }, 'Per table: the table is set by the QR, nobody types it. Whole event: no tables; customers give name and phone, and the KOT shows the name.'),
        el('p', { class: 'qrs-flab tables' }, 'Event tables'), seg('from', [['event', 'Event table numbers'], ['floor', 'From Floor']], f.from, id => { f.from = id; }),
        el('div', { class: 'qrs-tchips' }, chips),
        el('p', { class: 'qrs-fsum' }, f.from === 'floor' ? `${plural(n, 'Floor table')} · ${plural(n, 'QR')}. These QRs are only for this event; your table QRs keep working.`
          : `${n} event ${n === 1 ? 'table' : 'tables'} · ${plural(n, 'QR')}. These numbers are only for this event; they don’t change your Floor.`));
    } else {
      const radio = (id, title, text) => el('button', { type: 'button', role: 'radio', class: `qrs-rcard${f.mode === id ? ' on' : ''}`, 'aria-checked': String(f.mode === id), onclick: () => { f.mode = id; f.pick = null; render(); } },
        el('span', { class: 'qrs-radio', 'aria-hidden': 'true' }), el('span', { class: 'qrs-rcard-t' }, el('b', {}, title), el('span', {}, text)));
      const [it, ix] = menuOnly ? ['No orders, no printers', 'Menu only skips the Printers step. The menu step is the same: whole categories, single dishes, event prices, photos and event-only dishes.']
        : ['Customers give name and phone', 'Always asked with one QR for the whole event. The name prints on the KOT so staff can call it; the phone is there if someone doesn’t come.'];
      left.push(el('p', { class: 'qrs-fdesc' }, 'For outdoor or open venues with no table numbers. One QR, put up anywhere.'),
        el('p', { class: 'qrs-flab what' }, 'What customers can do with this QR'), el('div', { class: 'qrs-rcards', role: 'radiogroup' },
          radio('both', 'Dine-in + Takeaway', 'Customers pick Dine-in or Takeaway when they order. Staff call them by name: plates for Dine-in, packed for Takeaway.'),
          radio('takeaway', 'Takeaway only', 'Every order is packed. Staff call the name to hand it over.'),
          radio('menu', 'Menu only', 'Customers see the event menu and prices. No ordering, no name or phone. Staff take the order.')),
        el('section', { class: 'qrs-fnote' }, el('b', {}, it), el('p', {}, ix)));
    }
    // (a tap outside an open calendar or wheels closes them)
    return [headEl('New event', null, [btn('', 'Cancel', closeForm), next]), line,
      el('div', { class: 'qrs-nev', onclick: ev => { if (f.pick && !ev.target.closest?.('.qrs-fpop, .qrs-field')) { f.pick = null; render(); } } },
        el('div', { class: 'qrs-nev-l' }, left), previewEl())];
  }
  // The card preview (EV3: "CARD PREVIEW · EVENT TABLE 3", its third table, or its first while it has fewer)
  function previewEl() {
    const list = form.qrs === 'tables' ? formTables() : null, t = list ? list[2] || list[0] || null : null;
    return el('div', { class: 'qrs-nev-r' }, el('p', { class: 'qrs-plab' }, t ? `CARD PREVIEW · ${eventTableLabel(t).toUpperCase()}` : 'CARD PREVIEW'),
      el('div', { class: 'qrs-evbox prev' }, list && !t ? null : eventCardEl(formEvent(), t)));
  }
  // (typing the name: only the card preview and Next change, so the field keeps its letters and the keyboard stays)
  function paintForm() {
    const old = root?.querySelector('.qrs-nev-r'); if (!old || !form) return;
    old.replaceWith(previewEl()); fitPreview();
    const next = root.querySelector('.qrs-tools .qrs-btn.teal'); if (next) next.disabled = Boolean(formProblem());
  }
  function nextStep() { if (!form || formProblem()) return; form.step = 2; form.pick = null; if (!form.menu.cat) form.menu.cat = menuCats()[0]?.id || null; render(); }

  // ---------- New event, step 2: the menu (Update Pack 6, F: EV4, EV5, EV6) ----------
  // Every category of the regular menu (RestroMenu, live) on the left with how many of its dishes are on the event; the
  // one picked in the middle: tick it whole or tick single dishes (a whole category takes the dishes it has now; ones
  // added later don't join by themselves), a sold-out dish too (stock kept aside: it stays sold out for regular orders),
  // a tap on a dish changes its price or its printers for this event only (EV6), and event-only dishes are added inside
  // the category (EV5). On the right the event-only dishes, a note on sold-out dishes and what the menu comes to.
  // The draft: menu { picked (dish ids), changes (id → { price, printers }), own ([{ id, cat, name, price, gst, veg,
  // printers }]), cat (the category on show) }. Prices in rupees, as the menu. Dishes have no photos or printers of their
  // own yet (the Menu app): each shows "Add photo", and prints where KOTs print now, every kitchen printer;
  // adding a photo waits for the photo checks (the cloud), so it says "Coming soon".
  const menuCats = () => (Array.isArray(window.RestroMenu?.categories) ? window.RestroMenu.categories.filter(c => c && typeof c.id === 'string' && Array.isArray(c.items)) : []);
  const gstOf = () => Math.round((Number(window.RestroMenu?.taxRate) || 0) * 1000) / 10;
  const inr = r => `₹${Number(r || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  // The kitchen printers (Settings › Printers: every printer whose job includes KOTs), as the RESTRO Android app lists them
  let kitchen = [];
  async function loadKitchen() {
    const host = window.RESTRODevice?.printer; let list = [];
    if (typeof host?.list === 'function') { try { const l = await host.list(); list = Array.isArray(l) ? l : []; } catch {} }
    const set = window.RestroPrefs?.get?.('printers') || {};
    kitchen = list.filter(p => p && typeof p.id === 'string' && ['kitchen', 'both'].includes(set[p.id]?.role)).map(p => ({ id: p.id, name: String(set[p.id]?.name || p.name || 'Printer') }));
    if (form) render();
  }
  const printerWords = ids => { const names = (ids || []).map(id => kitchen.find(k => k.id === id)?.name).filter(Boolean); return names.length ? names.join(' + ') : null; };
  // where a dish's KOT prints now (no printers of its own yet): every kitchen printer
  const usualPrinters = () => (kitchen.length === 1 ? kitchen[0].name : kitchen.length ? 'All kitchen printers' : 'No kitchen printer yet');
  // Dishes have no photos yet (owner, 16 Nov 2026): "Add photo" where the photo goes
  const dishThumb = (cls = '') => el('span', { class: `qrs-dthumb add ${cls}`.trim(), role: 'img', 'aria-label': 'No photo yet' }, icon('addphoto'), el('small', {}, 'Add photo'));
  const vegMark = veg => el('span', { class: `qrs-veg${veg ? '' : ' non'}`, role: 'img', 'aria-label': veg ? 'Veg' : 'Non-veg' });
  // what the menu comes to (EV4's dark card): "29 dishes on this menu" · "27 from your menu (7 of 14 categories) · 2
  // event-only · 1 price and 1 printer changed"
  function menuSum() {
    const m = form.menu, cats = menuCats(), picked = cats.flatMap(c => c.items.filter(i => m.picked.has(i.id)).map(() => c.id));
    const used = new Set([...picked, ...m.own.map(d => d.cat)]), price = [...m.changes.entries()].filter(([id, c]) => m.picked.has(id) && c.price != null).length;
    const printers = [...m.changes.entries()].filter(([id, c]) => m.picked.has(id) && c.printers).length;
    const changed = [price ? plural(price, 'price') : '', printers ? plural(printers, 'printer') : ''].filter(Boolean);
    return { total: picked.length + m.own.length, line: [`${picked.length} from your menu (${cats.filter(c => used.has(c.id)).length} of ${cats.length} categories)`, `${m.own.length} event-only`,
      changed.length ? `${changed.join(' and ')} changed` : ''].filter(Boolean).join(' · ') };
  }
  function menuStepPage() {
    const f = form, m = f.menu, cats = menuCats(), cat = cats.find(c => c.id === m.cat) || cats[0] || null, menuOnly = f.qrs === 'whole' && f.mode === 'menu', name = f.name.trim(), sum = menuSum();
    if (cat) m.cat = cat.id;
    const next = btn('teal', menuOnly ? 'Create event' : 'Next: printers', () => { if (sum.total) toast('Coming soon', null, null); }); next.disabled = !sum.total;
    const step = (n, label, state) => el('li', { class: `qrs-step${state === 'on' ? ' on' : state === 'done' ? ' done' : ''}`, 'aria-current': state === 'on' ? 'step' : null }, el('span', {}, state === 'done' ? icon('check') : String(n)), el('b', {}, label));
    const joint = () => el('li', { class: 'qrs-step-line', 'aria-hidden': 'true' });
    const ownIn = c => m.own.filter(d => d.cat === c.id);
    const countOf = c => { const n = c.items.length, t = c.items.filter(i => m.picked.has(i.id)).length, o = ownIn(c).length; return { text: `${t === n && n ? `All ${n}` : `${t} of ${n}`}${o ? ` + ${o}` : ''}`, some: t + o > 0 }; };
    const catPill = c => { const k = countOf(c), on = c === cat;
      return el('button', { type: 'button', class: `qrs-mcat${on ? ' on' : ''}${k.some ? ' some' : ''}`, 'aria-pressed': String(on), onclick: () => { m.cat = c.id; render(); } }, el('span', {}, c.name), el('small', {}, k.text)); };
    const tick = (on, label, fn) => el('button', { type: 'button', class: `qrs-tick2${on ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(on), 'aria-label': label, onclick: ev => { ev.stopPropagation(); fn(); } }, on ? icon('check') : null);
    let panel = null;
    if (cat) {
      const all = cat.items.length > 0 && cat.items.every(i => m.picked.has(i.id)), gst = `GST ${gstOf()}%`;
      const row = i => {
        const on = m.picked.has(i.id), ch = m.changes.get(i.id) || {}, out = soldOutNow(i.id), price = ch.price ?? i.price, pr = ch.printers ? printerWords(ch.printers) : null;
        const sub = out ? 'Sold out in Availability · still on this event while ticked' : `Menu price ${inr(i.price)} · ${gst}${ch.price != null ? ` · event price ${inr(ch.price)}` : ''}`;
        return el('div', { class: `qrs-drow${on ? '' : ' off'}`, role: 'button', tabindex: '0', 'aria-label': `${i.name} for this event`, onclick: () => openPop('dish', { id: i.id }),
          onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPop('dish', { id: i.id }); } } },
          tick(on, i.name, () => { on ? m.picked.delete(i.id) : m.picked.add(i.id); render(); }), dishThumb(),
          el('span', { class: 'qrs-dtext' }, el('span', { class: 'qrs-dname' }, vegMark(i.veg !== false), el('b', {}, i.name), out ? el('em', { class: 'qrs-dtag out' }, 'Sold out today') : null), el('span', { class: 'qrs-dsub' }, sub)),
          el('span', { class: `qrs-dchip${pr ? ' on' : ''}` }, icon('print'), pr || usualPrinters()), el('span', { class: `qrs-dprice${ch.price != null ? ' on' : ''}` }, inr(price)));
      };
      const ownRow = d => el('div', { class: 'qrs-drow', role: 'button', tabindex: '0', 'aria-label': `${d.name}, event-only`, onclick: () => openPop('own', { cat: d.cat, id: d.id }),
        onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPop('own', { cat: d.cat, id: d.id }); } } },
        tick(true, d.name, () => openPop('own', { cat: d.cat, id: d.id })), dishThumb(),
        el('span', { class: 'qrs-dtext' }, el('span', { class: 'qrs-dname' }, vegMark(d.veg), el('b', {}, d.name), el('em', { class: 'qrs-dtag own' }, 'Event-only')), el('span', { class: 'qrs-dsub' }, `GST ${d.gst}% · added for this event`)),
        el('span', { class: 'qrs-dchip' }, icon('print'), printerWords(d.printers) || usualPrinters()), el('span', { class: 'qrs-dprice' }, inr(d.price)));
      panel = el('section', { class: 'qrs-mpanel', 'aria-label': cat.name },
        el('div', { class: 'qrs-mhead' }, tick(all, `${cat.name}, whole category`, () => { for (const i of cat.items) all ? m.picked.delete(i.id) : m.picked.add(i.id); render(); }),
          el('div', {}, el('b', {}, `${cat.name} · whole category`), el('span', {}, `All ${plural(cat.items.length, 'dish', 'dishes').replace(/^1 dish$/, 'the dish')}, with their photos and GST. New dishes added to ${cat.name} later don’t join by themselves.`))),
        el('div', { class: 'qrs-mrows' }, cat.items.map(row), ownIn(cat).map(ownRow),
          el('button', { type: 'button', class: 'qrs-madd', onclick: () => openPop('own', { cat: cat.id }) }, icon('plus'), `Add event-only dish to ${cat.name}`)));
    }
    const own = m.own;
    const right = el('div', { class: 'qrs-mside' },
      el('section', { class: 'qrs-mcard' }, el('h3', {}, `Event-only dishes · ${own.length}`), el('p', {}, 'Added inside a category. They end with the event and never show in Availability or Inventory.'),
        own.length ? el('div', { class: 'qrs-eolist' }, own.map(d => { const c = cats.find(x => x.id === d.cat);
          return el('button', { type: 'button', class: 'qrs-eo', onclick: () => { m.cat = d.cat; openPop('own', { cat: d.cat, id: d.id }); } }, dishThumb('sm'),
            el('span', { class: 'qrs-eo-t' }, el('b', {}, d.name), el('span', {}, [c?.name, d.veg ? 'Veg' : 'Non-veg', `GST ${d.gst}%`, printerWords(d.printers) || usualPrinters()].filter(Boolean).join(' · '))), el('b', { class: 'qrs-eo-p' }, inr(d.price))); })) : null),
      el('section', { class: 'qrs-mcard' }, el('h3', {}, 'Sold out today'), el('p', {}, 'Sold-out dishes can still be ticked, for example stock kept aside for the event. They stay sold out for regular orders.')),
      el('section', { class: 'qrs-msum', role: 'status' }, el('b', {}, `${plural(sum.total, 'dish', 'dishes')} on this menu`), el('span', {}, sum.line)));
    return [headEl(`${name} · menu`, null, [btn('', 'Back', () => { f.step = 1; render(); }), next]),
      el('p', { class: 'qrs-line' }, `Step 2 of ${menuOnly ? 2 : 3} · every category from your menu. Tick a whole category or single dishes; add event-only dishes inside a category.`),
      el('ol', { class: 'qrs-steps m', 'aria-label': 'Steps' }, step(1, 'Details', 'done'), joint(), step(2, 'Menu', 'on'), menuOnly ? null : [joint(), step(3, 'Printers')]),
      el('div', { class: 'qrs-mstep' }, el('div', { class: 'qrs-mcats' }, el('p', { class: 'qrs-evlab' }, `YOUR MENU · ${plural(cats.length, 'CATEGORY', 'CATEGORIES')}`), el('div', { class: 'qrs-mcats-l' }, cats.map(catPill))),
        panel || el('section', { class: 'qrs-mpanel none' }, el('p', {}, 'Your menu has no categories yet.')), right)];
  }
  const AVAIL_KEY = 'restro.menu.availability.v1';
  const soldOutNow = id => { try { return JSON.parse(localStorage.getItem(AVAIL_KEY) || 'null')?.soldOut?.[id] === true; } catch { return false; } };
  // EV5: an event-only dish (to add, or one added, to change or take off); EV6: a dish from the menu for this event
  // digits and one point (a price, a GST percent)
  const numIn = v => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  const gstOk = v => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  function ownPopBody() {
    const m = form.menu, cat = menuCats().find(c => c.id === pop.cat), d = pop.id ? m.own.find(x => x.id === pop.id) : null;
    if (!cat || (pop.id && !d)) { pop = null; return null; }
    if (!pop.draft) pop.draft = d ? { name: d.name, price: String(d.price), gst: String(d.gst), veg: d.veg, printers: new Set(d.printers) } : { name: '', price: '', gst: String(gstOf()), veg: true, printers: new Set(kitchen.length === 1 ? [kitchen[0].id] : []) };
    const x = pop.draft, ready = () => Boolean(x.name.trim() && Number(x.price) > 0 && gstOk(x.gst) && (x.printers.size > 0 || !kitchen.length)), okAll = ready();
    const paint = () => { const b = root?.querySelector('.qrs-pop .qrs-pbar .qrs-btn.teal'); if (b) b.disabled = !ready(); };
    return [popHead(d ? `${d.name} · event-only` : `Add event-only dish to ${cat.name}`, `Only for ${form.name.trim()} · ends with the event`),
      label2('Dish name'), el('input', { type: 'text', class: `qrs-input${x.name.trim() ? ' filled' : ''}`, value: x.name, maxlength: '60', placeholder: 'Name of the dish', 'aria-label': 'Dish name', autocapitalize: 'words', autocomplete: 'off', spellcheck: 'false',
        oninput: ev => { x.name = ev.target.value; ev.target.classList.toggle('filled', Boolean(x.name.trim())); paint(); } }),
      el('div', { class: 'qrs-prow' }, el('div', {}, label2('Price'), el('label', { class: 'qrs-money' }, el('span', {}, '₹'), el('input', { type: 'text', inputmode: 'decimal', value: x.price, maxlength: '7', 'aria-label': 'Price', autocomplete: 'off',
          oninput: ev => { ev.target.value = ev.target.value.replace(/[^\d.]/g, ''); x.price = ev.target.value; paint(); } }))),
        el('div', {}, label2('GST'), el('label', { class: 'qrs-money pct' }, el('input', { type: 'text', inputmode: 'decimal', value: x.gst, maxlength: '5', 'aria-label': 'GST percent', autocomplete: 'off',
          oninput: ev => { ev.target.value = numIn(ev.target.value); x.gst = ev.target.value; paint(); } }), el('span', {}, '%')))),
      label2('Veg or non-veg'), el('div', { class: 'qrs-seg veg', role: 'radiogroup' }, [[true, 'Veg'], [false, 'Non-veg']].map(([v, t]) =>
        el('button', { type: 'button', role: 'radio', class: `qrs-seg-o${x.veg === v ? ' on' : ''}`, 'aria-checked': String(x.veg === v), onclick: () => { x.veg = v; render(); } }, vegMark(v), el('span', { class: 'qrs-segt' }, t)))),
      kotPick(x.printers, null),
      el('p', { class: 'qrs-plab2' }, el('b', {}, 'Photos'), ' (optional · also saved to the Gallery)'), photoBtns(),
      el('div', { class: 'qrs-pbar' }, d ? btn('del', 'Take it off', () => { m.own = m.own.filter(o => o !== d); pop = null; render(); }, 'trash') : btn('', 'Cancel', closePop),
        (() => { const b = btn('teal', d ? 'Save dish' : 'Add dish', () => saveOwn(cat, d)); b.disabled = !okAll; return b; })())];
  }
  const label2 = text => el('p', { class: 'qrs-plab2' }, el('b', {}, text));
  // KOT goes to · (usually …) · pick one or more: every kitchen printer, ticked as chosen
  function kotPick(set, usual) {
    return [el('p', { class: 'qrs-plab2' }, el('b', {}, 'KOT goes to'), usual ? ` · usually ${usual}` : '', ' · pick one or more'),
      kitchen.length ? el('div', { class: 'qrs-kots' }, kitchen.map(k => el('button', { type: 'button', class: `qrs-kot${set.has(k.id) ? ' on' : ''}`, 'aria-pressed': String(set.has(k.id)),
        onclick: () => { set.has(k.id) ? set.delete(k.id) : set.add(k.id); render(); } }, set.has(k.id) ? icon('check') : null, k.name)))
        : el('p', { class: 'qrs-pnote' }, 'No kitchen printers yet. Settings › Printers lists them once the RESTRO Android app finds them.')];
  }
  // (adding a photo waits for the photo checks in the cloud: Pack 5's photo security spec)
  const photoBtns = () => el('div', { class: 'qrs-photos' }, [['grid', 'Scan to add'], ['plus', 'Device camera'], ['plus', 'Device gallery']].map(([ic, t]) => btn('', t, () => toast('Coming soon', null, null), ic)));
  function saveOwn(cat, d) {
    const x = pop.draft, price = Math.round(Number(x.price) * 100) / 100; if (!x.name.trim() || !(price > 0) || !gstOk(x.gst) || (kitchen.length && !x.printers.size)) return;
    const dish = { id: d?.id || `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, cat: cat.id, name: x.name.trim().replace(/\s+/g, ' '), price, gst: Math.round(Number(x.gst) * 100) / 100, veg: x.veg, printers: [...x.printers] };
    if (d) Object.assign(d, dish); else form.menu.own.push(dish);
    pop = null; render();
  }
  function dishPopBody() {
    const m = form.menu, cat = menuCats().find(c => c.items.some(i => i.id === pop.id)), item = cat?.items.find(i => i.id === pop.id);
    if (!item) { pop = null; return null; }
    const ch = m.changes.get(item.id) || {};
    if (!pop.draft) pop.draft = { price: String(ch.price ?? item.price), printers: new Set(ch.printers || kitchen.map(k => k.id)) };
    const x = pop.draft, changedPrice = Number(x.price) !== item.price;
    const ready = () => Number(x.price) > 0 && (x.printers.size > 0 || !kitchen.length);
    const paint = () => { const b = root?.querySelector('.qrs-pop .qrs-pbar .qrs-btn.teal'); if (b) b.disabled = !ready(); root?.querySelector('.qrs-money')?.classList.toggle('changed', Number(x.price) !== item.price); };
    return [popHead(`${item.name} · for this event`, `Changes apply to ${form.name.trim()} only. Your regular menu stays the same.`),
      el('div', { class: 'qrs-dphoto' }, el('button', { type: 'button', class: 'qrs-dphoto-i', onclick: () => toast('Coming soon', null, null) }, dishThumb('lg')),
        el('div', {}, el('p', { class: 'qrs-plab2' }, el('b', {}, 'Add photo for this event')), photoBtns())),
      el('div', { class: 'qrs-prow' }, el('div', {}, label2('Event price'), el('label', { class: `qrs-money${changedPrice ? ' changed' : ''}` }, el('span', {}, '₹'), el('input', { type: 'text', inputmode: 'decimal', value: x.price, maxlength: '7', 'aria-label': 'Event price', autocomplete: 'off',
          oninput: ev => { ev.target.value = ev.target.value.replace(/[^\d.]/g, ''); x.price = ev.target.value; paint(); } })), el('p', { class: 'qrs-pnote' }, `Menu price ${inr(item.price)}`)),
        el('div', {}, label2('GST'), el('div', { class: 'qrs-ro' }, `${gstOf()}% · from your menu`))),
      kotPick(x.printers, kitchen.length === 1 ? kitchen[0].name : kitchen.length ? 'every kitchen printer' : null),
      el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), (() => { const b = btn('teal', 'Save for this event', () => {
        const price = Math.round(Number(x.price) * 100) / 100; if (!ready()) return;
        const all = x.printers.size === kitchen.length && kitchen.every(k => x.printers.has(k.id));
        const next = { ...(price !== item.price ? { price } : {}), ...(x.printers.size && !all ? { printers: [...x.printers] } : {}) };
        if (Object.keys(next).length) m.changes.set(item.id, next); else m.changes.delete(item.id);
        m.picked.add(item.id); pop = null; render();
      }); b.disabled = !ready(); return b; })())];
  }
  // A date: the month's calendar (as the Counter's Schedule picker, CS1, in teal); days before today, or before the
  // start for the end, can't be picked. A new start day keeps the event's length.
  const MONTH_LONG = MONTH_NAMES.map(m => m.charAt(0) + m.slice(1).toLowerCase());
  function calendarEl(key) {
    const f = form, isStart = key === 'startDay', [y, mo] = f.cal.split('-').map(Number), first = new Date(y, mo - 1, 1), from = new Date(y, mo - 1, 1 - (first.getDay() + 6) % 7);
    const today = midnight(Date.now()), min = isStart ? today : midnight(f.start), sel = midnight(isStart ? f.start : f.end);
    const cells = Array.from({ length: 42 }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
    const shift = n => { const t = new Date(y, mo - 1 + n, 1); f.cal = `${t.getFullYear()}-${t.getMonth() + 1}`; render(); };
    const pickDay = c => {
      const d = new Date(isStart ? f.start : f.end), at = new Date(c.getFullYear(), c.getMonth(), c.getDate(), d.getHours(), d.getMinutes()).getTime();
      if (isStart) { const len = f.end - f.start; f.start = at; f.end = at + len; } else f.end = at;
      f.pick = null; render();
    };
    return el('div', { class: 'qrs-fpop cal', role: 'dialog', 'aria-label': isStart ? 'Start date' : 'End date' },
      el('div', { class: 'qrs-cal-h' }, el('b', {}, `${MONTH_LONG[mo - 1]} ${y}`),
        el('button', { type: 'button', class: 'qrs-cal-nav', 'aria-label': 'Previous month', disabled: first.getTime() <= new Date(new Date(min).getFullYear(), new Date(min).getMonth(), 1).getTime(), onclick: () => shift(-1) }, icon('chevron', 'back')),
        el('button', { type: 'button', class: 'qrs-cal-nav', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron'))),
      el('div', { class: 'qrs-cal-w', 'aria-hidden': 'true' }, ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => el('span', {}, w))),
      el('div', { class: 'qrs-cal-g' }, cells.map(c => {
        const t = c.getTime(), out = c.getMonth() !== mo - 1, past = t < min;
        return el('button', { type: 'button', class: `qrs-cal-d${out || past ? ' off' : ''}${t === today ? ' today' : ''}${t === sel && !out ? ' on' : ''}`, disabled: out || past,
          'aria-pressed': String(t === sel), 'aria-label': `${WEEKDAYS[c.getDay()]} ${c.getDate()} ${MONTH_LONG[c.getMonth()]}`, onclick: () => pickDay(c) }, String(c.getDate()));
      })));
  }
  // A time: hour · minutes (in 5s) · AM / PM on wheels (as the Counter's Schedule picker, CS1). The Starts time keeps the
  // event's length; the daily row's times change only their own.
  function wheelsEl(key) {
    const f = form, isStart = key === 'startTime' || key === 'dailyFrom', at = isStart ? f.start : f.end, d = new Date(at), h = d.getHours(), m = d.getMinutes() - (d.getMinutes() % 5);
    const set = (H, M) => {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), H, M).getTime();
      if (key === 'startTime') { const len = f.end - f.start; f.start = t; f.end = t + len; } else if (isStart) f.start = t; else f.end = t;
      render();
    };
    return el('div', { class: 'qrs-fpop wheels', role: 'dialog', 'aria-label': isStart ? 'Start time' : 'End time' },
      drum('Hour', Array.from({ length: 12 }, (_, i) => String(i + 1)), (h + 11) % 12, true, i => set((i + 1) % 12 + (h >= 12 ? 12 : 0), m)),
      drum('Minutes', Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')), m / 5, true, i => set(h, i * 5)),
      drum('AM or PM', ['AM', 'PM'], h >= 12 ? 1 : 0, false, i => set(h % 12 + (i ? 12 : 0), m)));
  }
  // A wheel (the Counter's, CS1): five rows, the one picked in the band; drag it, tap a row, turn the mouse wheel or use
  // the arrow keys; hours and minutes go round, AM / PM doesn't
  function drum(label, values, index, loop, pick) {
    const n = values.length, box = el('div', { class: 'qrs-wh', role: 'listbox', tabindex: '0', 'aria-label': label }), band = el('div', { class: 'qrs-wh-band', 'aria-hidden': 'true' }), rows = [];
    let cur = index, drag = 0, startY = null, moved = false;
    const rowH = () => band.offsetHeight || 46, at = i => (loop ? ((i % n) + n) % n : i);
    const paint = () => {
      rows.splice(0).forEach(r => r.remove());
      for (let i = -3; i <= 3; i++) {
        const v = cur + i; if (!loop && (v < 0 || v >= n)) continue;
        const dist = Math.abs(i + drag / rowH());
        const row = el('div', { class: `qrs-wh-row${dist < 0.5 ? ' sel' : dist < 1.5 ? ' near' : ''}`, role: 'option', 'aria-selected': String(i === 0) }, values[at(v)]);
        row.style.setProperty('--i', String(i)); row.style.transform = drag ? `translateY(${drag}px)` : '';
        rows.push(row); box.append(row);
      }
    };
    const go = step => { const v = step ? (loop ? at(cur + step) : Math.max(0, Math.min(n - 1, cur + step))) : cur; drag = 0; if (v !== cur) { cur = v; pick(cur); return; } paint(); };
    box.append(band);
    box.addEventListener('pointerdown', e => { startY = e.clientY; moved = false; drag = 0; box.setPointerCapture?.(e.pointerId); });
    box.addEventListener('pointermove', e => { if (startY == null) return; drag = e.clientY - startY; if (Math.abs(drag) > 6) moved = true; if (!loop) drag = Math.max(-(n - 1 - cur) * rowH(), Math.min(cur * rowH(), drag)); paint(); });
    box.addEventListener('pointerup', e => { if (startY == null) return; const r = box.getBoundingClientRect(), step = moved ? Math.round(-drag / rowH()) : Math.round((e.clientY - r.top - r.height / 2) / rowH()); startY = null; go(step); });
    box.addEventListener('pointercancel', () => { startY = null; go(0); });
    box.addEventListener('wheel', e => { e.preventDefault(); go(Math.sign(e.deltaY)); }, { passive: false });
    box.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); go(e.key === 'ArrowDown' ? 1 : -1); } });
    paint();
    return box;
  }
  // An event table's history, as a table QR's ("Created 6 Nov by ‹name› · last printed today by ‹name›"): made with its
  // event
  const tableHistory = (e, t) => historyLine({ createdAt: t.createdAt || e.createdAt, createdBy: t.createdAt ? t.createdBy : e.createdBy, replacedAt: t.replacedAt, replacedBy: t.replacedBy,
    printedAt: t.printedAt, printedBy: t.printedBy, sentAt: t.sentAt, sentBy: t.sentBy });

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
  // kind: help | create | send | delete | delete-many | replace | test | pause | devices; an event's: end | delete-event |
  // replace-event | etable (one event table's QR) | delete-etable. One opened from an event table's own (Send, Replace QR,
  // Delete: table) goes back to it when closed without doing it; done, all close and the toast says so.
  function openPop(kind, data = {}) {
    if (kind === 'help' && pop?.kind === 'help') { closePop(); return; }
    pop = { kind, ...data };
    if (kind === 'create') pop.ticked = new Set(data.one ? [data.ids[0]] : data.ids);
    if (kind === 'send') { pop.size = 'a6'; pop.language = 'en'; }
    if (kind === 'pause') pop.choice = '30m';
    if (kind === 'test') startTest();
    render();
  }
  const backTo = p => (p && p.kind !== 'etable' && p.event && p.table ? { kind: 'etable', event: p.event, table: p.table } : null);
  function closePop() { if (!pop) return false; pop = backTo(pop); clearInterval(testTimer); render(); return true; }
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
    } else if (pop.kind === 'send' && pop.event) {
      // (Update Pack 6: an event's QR, all its event tables' QRs, or one event table's, in one colour PDF)
      const e = events.find(x => x.id === pop.event), one = e && pop.table ? eventTables(e).find(x => x.id === pop.table) : null;
      if (!e || (pop.table && !one)) { pop = null; return null; }
      const tables = e.qrs === 'tables', b = window.RestroPrefs?.get?.('business') || {}, email = maskEmail(b.email), phone = maskPhone(b.phone, b.phoneCountry);
      body = [popHead(one ? `Send ${eventTableLabel(one)} QR` : tables ? 'Send all event table QRs' : `Send ${e.name} QR`, ['Colour PDF', one ? eventTableLabel(one) : tables ? tablesWords(e) : (MODES[e.mode] || MODES.both).label, e.name].join(' · ')), label('PRINT SIZE'),
        el('div', { class: 'qrs-picks' }, [['a6', 'Table card', 'A6'], ['sticker', 'Sticker', '10 × 10 cm'], ['a4', 'A4 sheet', '4 per page']].map(([id, t, x]) => pick(pop.size === id, t, () => { pop.size = id; render(); }, el('small', {}, x)))),
        label('CARD LANGUAGE'),
        el('div', { class: 'qrs-picks' }, [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी'], ['en+te', 'English + తెలుగు']].map(([id, t]) => pick(pop.language === id, t, () => { pop.language = id; render(); }))),
        label('SENDS TO THE BUSINESS’S REGISTERED CONTACTS'),
        el('dl', { class: 'qrs-contacts' }, el('div', {}, el('dt', {}, 'Email'), el('dd', {}, icon('mail'), email || 'Not added yet')), el('div', {}, el('dt', {}, 'WhatsApp'), el('dd', {}, icon('chat'), phone || 'Not added yet'))),
        el('p', { class: 'qrs-pnote' }, 'Colour, print-ready PDF: print, laminate or make stickers. To change these contacts: Settings › Business details. Download comes with the web dashboard.'),
        el('div', { class: 'qrs-pbar' }, btn('wa', 'WhatsApp', () => sendEvent(e, 'whatsapp', phone, one), 'chat', { off: !phone || !online(), why: !online() ? 'Needs internet' : '' }),
          btn('blue', 'Email', () => sendEvent(e, 'email', email, one), 'mail', { off: !email || !online(), why: !online() ? 'Needs internet' : '' }))];
      cls = 'send';
    } else if (pop.kind === 'etable' || pop.kind === 'delete-etable' || pop.kind === 'replace-event') {
      // (owner, 16 Nov 2026) One event table's QR, as a table QR in its panel: its card, Reprint · Send · Replace QR ·
      // Delete; and Replace QR for the whole event's QR (as the Takeaway QR's). Not once the event has ended.
      const e = events.find(x => x.id === pop.event), t = e && pop.table ? eventTables(e).find(x => x.id === pop.table) : null;
      if (!e || (pop.table && !t) || (pop.kind !== 'replace-event' && !t) || evState(e).state === 'ended') { pop = null; return null; }
      const name = t ? eventTableLabel(t) : e.name, hist = (t ? tableHistory(e, t) : historyLine(e)), why = !online() ? 'Needs internet' : '', only = eventTables(e).length < 2;
      if (pop.kind === 'etable') body = [popHead(name, hist), el('div', { class: 'qrs-evbox' }, eventCardEl(e, t)),
        el('div', { class: 'qrs-pbtns' }, btn('tint', 'Reprint', () => { pop = null; render(); printEvent(e, t); }, 'print'), btn('', 'Send', () => openPop('send', { event: e.id, table: t.id }), 'send', { off: !online(), why }),
          btn('', 'Replace QR', () => openPop('replace-event', { event: e.id, table: t.id }), 'replace'),
          btn('del', 'Delete', () => openPop('delete-etable', { event: e.id, table: t.id }), 'trash', { off: only || !online(), why: only ? 'Only table left' : why, showWhy: true })),
        el('p', { class: 'qrs-note' }, el('b', {}, 'Reprint'), ' prints the same QR in black and white on the receipt printer; for colour, use ', el('b', {}, 'Send'), '. ', el('b', {}, 'Replace'), ' makes a new QR; the old one stops working.')];
      else if (pop.kind === 'delete-etable') body = [popHead(`Delete the ${name} QR?`, hist.replace(' · not printed or sent yet', '')),
        el('div', { class: 'qrs-warnbox' }, `The printed QR and link on ${name} `, el('b', {}, 'stop working'), '. Customers at that table can’t order by QR.'),
        el('p', { class: 'qrs-pnote dark' }, 'Only want a fresh copy? Use ', el('b', {}, 'Reprint'), '. Card damaged or copied? Use ', el('b', {}, 'Replace QR'), '.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Keep QR', closePop), btn('red', 'Delete QR', () => deleteEventTable(e, t), 'trash', { off: only || !online(), why: only ? 'Only table left' : 'Needs internet', showWhy: true }))];
      else body = [popHead(`Replace the ${name} QR?`, hist.replace(' · not printed or sent yet', '')),
        el('div', { class: 'qrs-greybox' }, t ? ['You’ll get a ', el('b', {}, 'new QR'), ` for ${name}. The QR printed on the table now will `, el('b', {}, 'stop working'), ', so print the new one and put it on the table.']
          : ['You’ll get a ', el('b', {}, 'new QR'), `. The ${name} QR printed now will `, el('b', {}, 'stop working'), '. Links you posted online stop working too. Print the new one and put it up.']),
        el('p', { class: 'qrs-pnote dark' }, 'Only need a fresh copy of the same QR? Use ', el('b', {}, 'Reprint'), ' instead.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Cancel', closePop), btn('blue', 'Replace QR', () => replaceEventQr(e, t), 'replace'))];
      cls = pop.kind === 'etable' ? 'etable' : pop.kind === 'delete-etable' ? 'delete' : 'replace';
    } else if (pop.kind === 'own' || pop.kind === 'dish') {
      // (New event's menu: EV5 an event-only dish, EV6 a dish for this event)
      if (!form) { pop = null; return null; }
      body = pop.kind === 'own' ? ownPopBody() : dishPopBody(); if (!body) return null;
    } else if (pop.kind === 'end' || pop.kind === 'delete-event') {
      // (Update Pack 6, D: End now and Delete, asked first as Delete QR is)
      const e = events.find(x => x.id === pop.event); if (!e) { pop = null; return null; }
      if (pop.kind === 'end') body = [popHead(`End ${e.name} now?`, datesText(e)),
        el('div', { class: 'qrs-warnbox' }, `Its QR${e.qrs === 'tables' ? 's' : ''} `, el('b', {}, 'stop taking orders now'), `, not at ${clock(e.end)}${daysApart(Date.now(), e.end) ? ` on ${weekdayDate(e.end)}` : ''}. Customers who scan see “This event has ended.”`),
        el('div', { class: 'qrs-pbar' }, btn('', 'Keep it on', closePop), btn('red', 'End now', () => endEvent(e), 'stop', { off: !online(), why: 'Needs internet', showWhy: true }))];
      else body = [popHead(`Delete ${e.name}?`, datesText(e)),
        el('div', { class: 'qrs-warnbox' }, `Its QR${e.qrs === 'tables' ? 's' : ''} and link${e.qrs === 'tables' ? 's' : ''} `, el('b', {}, 'stop working'), ', and its event menu goes with it. It has no orders, so no takings are lost.'),
        el('div', { class: 'qrs-pbar' }, btn('', 'Keep event', closePop), btn('red', 'Delete event', () => deleteEvent(e), 'trash', { off: !online() || hasOrders(e), why: 'Needs internet', showWhy: true }))];
      cls = 'delete';
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
    } else if (pop.kind === 'test' && pop.event) {
      // (Update Pack 6: an event's QR, or any of its event tables' QRs)
      const e = events.find(x => x.id === pop.event); if (!e) { pop = null; return null; }
      const tables = e.qrs === 'tables', hit = tables ? eventTables(e).find(t => t.code === pop.hit) : null;
      if (pop.result === 'ok') body = [el('span', { class: 'qrs-big-i ok' }, icon('check')), el('h3', { class: 'ok' }, `${hit ? eventTableLabel(hit) : e.name} QR works`),
        el('p', {}, hit ? `Scanned just now from a phone. The event menu opened with ${eventTableLabel(hit)} set.` : 'Scanned just now from a phone. The event menu opened.'), el('div', { class: 'qrs-pbar one' }, btn('blue', 'Done', closePop))];
      else if (pop.result === 'fail') body = [el('span', { class: 'qrs-big-i bad' }, '!'), el('h3', { class: 'bad' }, 'Didn’t get a scan'),
        el('p', {}, 'No scan arrived in 1 minute. If the phone couldn’t read the card, it may be damaged, faded or wet.'),
        el('div', { class: 'qrs-pbar' }, btn('', tables ? 'Print all' : 'Reprint', () => { closePop(); printEvent(e); }, 'print'), btn('blue', 'Try again', () => { startTest(); render(); }))];
      else { const left = Math.max(0, Math.ceil((pop.started + TEST_WAIT - Date.now()) / 1000));
        body = [el('span', { class: 'qrs-big-i wait' }, el('i', { class: 'qrs-spin' })), el('h3', {}, tables ? 'Scan an event table’s QR now' : `Scan ${e.name}’s QR now`),
          el('p', {}, tables ? 'Use any phone. Point its camera at any event table’s card.' : 'Use any phone. Point its camera at the card.', el('br'), 'Waiting for the scan… ', el('b', { class: 'qrs-left' }, `0:${String(left).padStart(2, '0')}`)),
          el('div', { class: 'qrs-pbar one' }, btn('', 'Cancel', closePop))]; }
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
    const p = pathNow(), broken = brokenStep(p), kitchen = (p.printers || []).map(k => ({ ...k, name: kName(k) }));
    const linkName = k => (k.link === 'wifi' ? 'Wi-Fi' : k.link === 'bluetooth' ? 'Bluetooth' : 'Wired');
    const box = (state, ic, title, chip, lines) => el('section', { class: `qrs-dev ${state}` }, el('h4', {}, icon(ic), title), el('span', { class: 'qrs-dev-chip' }, chip), lines.filter(Boolean).map(l => el('p', {}, l)));
    const arrow = () => el('span', { class: 'qrs-dev-arrow', 'aria-hidden': 'true' }, icon('arrow'));
    const internet = box(p.internet ? 'ok' : 'bad', 'wifi', 'Internet', p.internet ? 'Connected' : 'No internet',
      p.internet ? [p.wifiInternet === false ? 'Wi-Fi internet: not connected' : 'Wi-Fi internet', p.mobileVia ? `Mobile data: ${p.mobileVia}` : null] : ['Wi-Fi internet: not connected', 'Mobile data: no device is on it']);
    const printerBox = (k, many) => {
      const name = many ? k.name || 'Kitchen printer' : 'Kitchen printer', deviceOff = cable(k) && k.device?.on === false;
      if (deviceOff) return box('off', 'print', name, 'Can’t check', [linkName(k), k.link === 'bluetooth' ? 'The device it’s paired with is off' : 'The device it’s plugged into is off']);
      if (k.state === 'ok') return box('ok', 'print', name, 'Connected', [linkName(k), k.paper === 'ok' ? 'Paper OK' : null, k.backup && kitchen.some(x => x !== k && x.state !== 'ok') ? 'Backup printer · printing all KOTs' : null]);
      if (k.link === 'wifi') return box('bad', 'print', name, 'Not reachable', ['Wi-Fi', 'No device can reach it', many ? null : 'Check power, paper and Wi-Fi']);
      // (Bluetooth, Update Pack 6 EV10: "Check power, paper and that it’s near Handheld 2")
      return box('bad', 'print', name, 'Not connected', k.link === 'bluetooth' ? ['Bluetooth', `Check power, paper and that it’s near ${k.device?.name || 'its printer device'}`] : ['Wired', 'Check power, cable and paper']);
    };
    const deviceBox = (k, many) => k.device?.on === false ? box('bad', 'monitor', 'Printer device', 'Off', [k.device.lastSeen ? `Last seen ${clock(k.device.lastSeen)}` : null])
      : box('ok', 'monitor', 'Printer device', 'On', [`${many ? k.name || 'Kitchen printer' : 'Kitchen printer'} ${k.link === 'bluetooth' ? 'paired here' : 'plugged in here'}`]);
    const many = kitchen.length > 1, working = kitchen.filter(k => k.state === 'ok' && (!cable(k) || k.device?.on !== false));
    let sub, text;
    if (broken) sub = REASONS[broken].devices;
    else if (many && working.length < kitchen.length) sub = `QR ordering is on · ${working.map(k => k.name).join(' and ')} ${working.length === 1 ? 'is' : 'are'} printing`;
    else if (p.mobileVia && p.wifiInternet === false) sub = 'QR ordering is on · orders are coming in on mobile data';
    else sub = 'QR ordering is on · every step works';
    const tries = { internet: 'restart the internet router, or turn on mobile data on any one device. QR ordering turns back on by itself.', device: 'turn on the printer device, or plug the kitchen printer into another device. QR ordering turns back on by itself.',
      wired: 'check the printer is on, the cable is in and it has paper. QR ordering turns back on by itself.', wifi: 'check the printer is on, has paper and is on the restaurant Wi-Fi. QR ordering turns back on by itself.',
      printers: 'get either kitchen printer working. QR ordering turns back on by itself as soon as one prints.' };
    if (broken === 'wired' && kitchen[0]?.link === 'bluetooth') tries.wired = `check the printer is on, has paper and is near ${kitchen[0].device?.name || 'its printer device'}. QR ordering turns back on by itself.`;
    if (broken) text = el('p', { class: 'qrs-pnote dark' }, el('b', {}, 'Try:'), ` ${tries[broken]}`);
    else if (many && working.length < kitchen.length) { const backup = working.find(k => k.backup) || working[0], down = kitchen.filter(k => !working.includes(k));
      text = el('p', { class: 'qrs-pnote dark' }, `${backup.name} is ${backup.backup ? 'your backup printer' : 'the first kitchen printer that works'}, so it prints ${down.map(k => `${k.name}’s`).join(' and ')} dishes along with its own until ${down.length === 1 ? `printer ${down[0].name.replace(/^Kitchen printer\s*/i, '') || down[0].name}` : 'they'} ${down.length === 1 ? 'is' : 'are'} back. Bill and receipt printers don’t count.`); }
    else if (p.mobileVia && p.wifiInternet === false) text = el('p', { class: 'qrs-pnote dark' }, `${p.mobileVia} takes in QR orders and sends them over the Wi-Fi to the printer device. Nothing to do.`);
    // (a web browser can't see the printers: only the RESTRO Android app reports them, ANDROID-BRIDGE.md)
    else text = el('p', { class: 'qrs-pnote dark' }, path ? 'Nothing to do.' : 'Nothing to do. The printer device and the kitchen printers show here in the RESTRO Android app.');
    let flow, cls = 'one';
    if (!kitchen.length) flow = el('div', { class: 'qrs-flow' }, internet);
    else if (!many) { const k = kitchen[0]; flow = el('div', { class: 'qrs-flow' }, internet, arrow(), cable(k) ? [deviceBox(k), arrow()] : null, printerBox(k)); cls = cable(k) ? 'three' : 'two'; }
    else { flow = el('div', { class: 'qrs-flow many' }, internet, arrow(), el('div', { class: 'qrs-flow-rows' }, kitchen.map(k => el('div', { class: `qrs-flow-row${cable(k) ? '' : ' solo'}` }, cable(k) ? [deviceBox(k, true), arrow()] : null, printerBox(k, true))))); cls = 'many'; }
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
  // (the Event QRs pill opens on its Events tab)
  function go(page) { view.page = page; view.picked = null; pop = null; form = null; if (page === 'event') view.evTab = 'events'; render(); }
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
    printCards(list.map(printCard), ok => {
      if (!ok) { toast(`${manyWords(list, 'didn’t print')} · check the receipt printer`); return; }
      const at = Date.now(), by = who();
      for (const r of list) { if (!records.includes(r)) continue; r.printedAt = at; r.printedBy = by; const n = freshName(r); if (n != null) r.name = n; }
      store(); toast(manyWords(list, 'printed'));
    });
  }
  function printCards(cards, done) {
    const printer = window.RESTRODevice?.printer;
    if (typeof printer?.printQr === 'function') Promise.resolve(printer.printQr({ cards })).then(res => done(!(res === false || res?.ok === false)), () => done(false));
    else { printPage(cards); done(true); }
  }
  // (Update Pack 6) An event's cards for printing and sending: one QR for the whole event (its name, dates and line), or
  // each event table's (its number on the QR, the event's name and dates under it); one: only that event table's
  function eventPrintCards(e, one = null) {
    const restaurant = window.RestroRestaurantName?.value || '', linkLabel = 'QR not scanning? Type this link';
    const card = (path, title, mark, heading, lines) => ({ kind: 'event', restaurant, heading, title, mark, lines, note: null, linkLabel, link: `${HOST}/${path}`, url: `https://${HOST}/${path}`, qr: qrOfCard(`https://${HOST}/${path}`, mark) });
    if (e.qrs === 'tables') { const w = tableWords(e); return (one ? [one] : eventTables(e)).map(t => card(t.path, eventTableLabel(t), tableMark(t), w.heading, [w.date, w.text])); }
    const mode = MODES[e.mode] || MODES.both;
    return e.path ? [card(e.path, e.name, null, mode.heading, [datesText(e), mode.line])] : [];
  }
  const eventWords = (e, n, one = null) => (one ? `${eventTableLabel(one)} QR` : e.qrs === 'tables' ? `${n} event table ${n === 1 ? 'QR' : 'QRs'}` : `${e.name} QR`);
  // (printed or sent: when and by whom, on the event and on each of its event tables printed or sent; found again by id,
  // as a change from another device may have loaded the events again meanwhile)
  function stampEvent(e, one, at, by, kind) {
    const ev = events.find(x => x.id === e.id); if (!ev) return;
    if (!one) { ev[`${kind}At`] = at; ev[`${kind}By`] = by; }
    for (const t of eventTables(ev)) if (!one || t.id === one.id) { t[`${kind}At`] = at; t[`${kind}By`] = by; }
    storeEvents();
  }
  function printEvent(e, one = null) {
    const cards = eventPrintCards(e, one), words = eventWords(e, cards.length, one); if (!cards.length) return;
    printCards(cards, ok => {
      if (!ok) { toast(`${words} didn’t print · check the receipt printer`); return; }
      stampEvent(e, one, Date.now(), who(), 'printed'); toast(`${words} printed`);
    });
  }
  function sendEvent(e, to, masked, one = null) {
    const send = window.RESTRODevice?.qr?.send, cards = eventPrintCards(e, one), words = eventWords(e, cards.length, one);
    if (typeof send !== 'function') { toast('Sending starts with the RESTRO Android app'); return; }
    const job = { to, size: pop?.size || 'a6', language: pop?.language || 'en', cards };
    pop = null; render();
    Promise.resolve(send(job)).then(res => {
      if (res === false || res?.ok === false) { toast(`${words} not sent · try again`); return; }
      stampEvent(e, one, Date.now(), who(), 'sent'); toast(`${words} sent to ${to === 'email' ? 'email' : 'WhatsApp'} ${masked}`);
    }, () => toast(`${words} not sent · try again`));
  }
  // Replace QR (owner, 16 Nov 2026): the whole event's QR, or one event table's (one), gets a new code; the old one stops
  // working (the cloud keeps which codes work), and the card shows "not printed yet" until it's printed or sent again
  function replaceEventQr(e, one = null) {
    const at = Date.now(), code = newCode(), x = one || e;
    Object.assign(x, { code, path: one ? `${slug()}/E${tableMark(one).replace(/[^A-Za-z0-9]+/g, '')}-${code}` : `${slug()}/${KINDS.event.prefix}-${code}`, replacedAt: at, replacedBy: who() });
    for (const k of ['printedAt', 'printedBy', 'sentAt', 'sentBy']) delete x[k];
    pop = null; storeEvents();
    toast(`${one ? eventTableLabel(one) : e.name} has a new QR · the old one no longer works`, ['Print now', () => { const ev = events.find(v => v.id === e.id); if (ev) printEvent(ev, one ? eventTables(ev).find(t => t.id === one.id) || null : null); }]);
  }
  // Delete an event table's QR: that table leaves the event, and its QR stops working (needs the internet, as Delete
  // QR); the event keeps at least one table
  function deleteEventTable(e, one) {
    if (!online() || eventTables(e).length < 2) return;
    e.tables = e.tables.filter(t => t !== one); pop = null; storeEvents(); toast(`${eventTableLabel(one)} QR deleted`);
  }
  // End now: it stops now, as at its end (then it shows under History); Delete: only an event with no orders (the cloud
  // stops its codes)
  function endEvent(e) {
    if (!online() || evState(e).state !== 'live') return;
    e.endedAt = Date.now(); e.endedBy = who(); pop = null; storeEvents(); toast(`${e.name} ended`);
  }
  function deleteEvent(e) {
    if (!online() || hasOrders(e)) return;
    events = events.filter(x => x !== e); window.RestroSync?.removed('events', e.id);
    for (const k of ['events', 'history']) if (view.evPick[k] === e.id) view.evPick[k] = null;
    pop = null; storeEvents(); toast(`${e.name} deleted`);
  }
  function printPage(cards) {
    let page = document.querySelector('#print-qr');
    if (!page) { page = el('div', { id: 'print-qr', 'aria-hidden': 'true' }); document.body.append(page); }
    page.replaceChildren(...cards.map(c => el('section', { class: 'pq-card' }, el('h1', {}, c.restaurant), el('p', { class: 'pq-head' }, c.heading),
      qrSvg(c.url, c.mark, '#000000', 'pq-qr'), el('h2', {}, c.title), c.lines.map(l => el('p', {}, l)), c.note ? el('p', { class: 'pq-note' }, c.note) : null,
      el('p', { class: 'pq-small' }, c.linkLabel), el('p', { class: 'pq-link' }, linkWords(c.link)))));
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
    if (pop?.kind === 'test' && !pop.result && at >= pop.started - 2000) {
      const e = pop.event ? events.find(x => x.id === pop.event) : null;
      const hit = e ? (e.qrs === 'tables' ? eventTables(e).some(t => t.code === code) : e.code === code) : records.find(r => r.id === pop.id)?.code === code;
      if (hit) { pop.result = 'ok'; pop.hit = code; clearInterval(testTimer); }
    }
    changed();
  }
  // QR ordering by hand (I3): the switch or Pause for a while: 30 min · 1 hour · 1 business day (back on at the next
  // day's opening time, not when a break ends: owner, 14 Nov 2026) · Until turned on. Outside business hours (a break
  // too), the switch turns it on (staying open late) until the next opening, a break's end included; then the business
  // hours take over again.
  function pauseFor(choice) {
    const now = Date.now(), until = choice === '30m' ? now + 30 * MIN : choice === '1h' ? now + 60 * MIN : choice === 'day' ? nextOpening(now, true)?.at ?? now + DAY : null;
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
  // (ic: the tick, or null for none, as "Coming soon")
  function toast(text, action, ic = 'check') {
    clearTimeout(toastTimer);
    toastEl.replaceChildren(...[ic ? el('span', { class: 'qrs-toast-i' }, icon(ic)) : null, el('span', {}, text), action ? el('button', { type: 'button', class: 'qrs-toast-btn', onclick: () => { toastEl.hidden = true; action[1](); } }, action[0]) : null].filter(Boolean));
    toastEl.hidden = false;
    const ms = window.RESTRODevice?.recommendedTimeout?.(action ? 6000 : 3000, Boolean(action)) || (action ? 6000 : 3000);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ---------- drawing it all ----------
  function render() {
    if (!dialog.open) return;
    // (a field being typed in keeps the typing: Search table, New event's name)
    const st = ordering(), scroll = root?.querySelector('.qrs-scroll')?.scrollTop || 0, typing = ['.qrs-search input', '.qrs-nev .qrs-input'].find(q => document.activeElement?.matches?.(q));
    const { tables } = floor();
    if (view.page === 'table' && !records.some(r => r.id === view.selected && r.kind === 'table' && tables.some(t => t.id === r.table))) view.selected = tables.map(t => qrOfTable(t.id)).find(Boolean)?.id || null;
    tally = null;
    const main = el('main', { class: `qrs-main p-${view.page}${view.page === 'event' && form ? ' f-new' : ''}` }, view.page === 'table' ? tablePage(st) : view.page === 'event' ? eventPage() : onePage(st, view.page));
    const fresh = el('div', { class: `qrs-root${view.page === 'table' ? '' : ' wide'}` }, el('span', { class: 'qrs-unit', 'aria-hidden': 'true' }), sideEl(st), main, view.page === 'table' ? panelEl() : null, popEl(), toastEl);
    if (root) root.replaceWith(fresh); else dialog.append(fresh);
    root = fresh;
    const sc = root.querySelector('.qrs-scroll'); if (sc) sc.scrollTop = scroll;
    if (typing) { const input = root.querySelector(typing); input?.focus(); input?.setSelectionRange?.(input.value.length, input.value.length); }
    fitPreview();
  }
  // The card in the panel fills the grey box's height (QS1); a taller box above it makes it smaller (QS25, QS35)
  // (the grey box is 563 tall where there's room, smaller where there isn't; the card in it is 288 wide at most, with 14
  // above and below; the note under the buttons goes when the box would be under 400). A typed link on two lines makes
  // the card taller (the designs' one line is 20 card units), so it fits in the same box; the Takeaway and Menu card
  // (QS2, QS3: 1 design pixel a card unit) too.
  function fitPreview() {
    const u = unit();
    const extra = card => { const cu = card.offsetWidth / 426, link = card.querySelector('.qrs-card-link'); return cu > 0 && link ? Math.max(0, link.offsetHeight / cu - 20) : 0; };
    for (const box of root?.querySelectorAll('.qrs-prev') || []) {
      const card = box.querySelector('.qrs-card'); if (!card) continue;
      const note = box.parentElement.querySelector(':scope > .qrs-note');
      if (note && box.clientHeight < 400 * u) note.hidden = true;
      const base = card.classList.contains('k-table') ? 733.6 : 660, more = extra(card), tall = base + more;
      const k = Math.max(0.2 * u, Math.min(0.676 * u, (box.clientHeight - 28 * u) / tall, (box.clientWidth - 40 * u) / 426));
      card.style.setProperty('--cu', `${k}px`);
      // (a link on two lines: the card keeps the designs' place in the box, and only its link line goes on below)
      const top = more > 0 ? Math.max(14 * u, Math.min((box.clientHeight - base * k) / 2, box.clientHeight - 14 * u - tall * k)) : null;
      card.style.alignSelf = top == null ? '' : 'start'; card.style.marginTop = top == null ? '' : `${top}px`;
    }
    for (const box of root?.querySelectorAll('.qrs-big') || []) {
      const card = box.querySelector('.qrs-card'); if (!card) continue;
      const more = extra(card); if (more > 0) card.style.setProperty('--cu', `${Math.min(1, (680 - 20) / (660 + more)) * u}px`);
    }
    // (an event's card, 300 wide in its 530-tall box as EV2; a long name or link that makes it taller makes it smaller)
    for (const box of root?.querySelectorAll('.qrs-evbox') || []) {
      const card = box.querySelector('.qrs-card'); if (!card) continue;
      const room = box.clientHeight - 28 * u, h = card.offsetHeight;
      if (h > room) card.style.setProperty('--cu', `${0.70423 * u * room / h}px`);
    }
  }
  // One design pixel on this screen (--fu)
  function unit() { const probe = root?.querySelector('.qrs-unit'); return probe ? probe.getBoundingClientRect().width / 100 : 1; }
  // (The bar's pill says Online or Offline in every app, QR Studio too (owner, 14 Nov 2026): connectivity-status.js. A
  // device reaching the cloud through another one, a handheld on mobile data, is Online. The pack's "No internet" and
  // "No internet · orders via Handheld 1" pills are gone.)
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
      printers: (Array.isArray(s.printers) ? s.printers : []).filter(k => k && typeof k === 'object').map((k, i) => ({ id: String(k.id ?? i), name: String(k.name || `Kitchen printer ${i + 1}`), link: k.link === 'wifi' ? 'wifi' : k.link === 'bluetooth' ? 'bluetooth' : 'wired',
        state: k.state === 'ok' ? 'ok' : 'down', paper: k.paper === 'ok' ? 'ok' : null, backup: k.backup === true,
        device: k.device && typeof k.device === 'object' ? { name: String(k.device.name || ''), on: k.device.on !== false, lastSeen: Number(k.device.lastSeen) || 0 } : null })) };
    changed();
  }

  // ---------- opening, closing, Back ----------
  function open(page) {
    load(); loadScans(); loadEvents(); view.page = KINDS[page] ? page : 'table'; view.picked = null; view.search = ''; view.evTab = 'events'; pop = null; form = null;
    noteOrders();
    if (!dialog.open) dialog.showModal();
    render(); dialog.querySelector('#qr-studio-title')?.focus({ preventScroll: true });
    clearInterval(tick); tick = setInterval(() => { if (dialog.open && !pop && !form) { if (view.page === 'event') noteOrders(); render(); } }, 15000);
  }
  function goBack() {
    if (!dialog.open) return false;
    if (pop) { if (pop.kind !== 'test' || pop.result) { closePop(); return true; } closePop(); return true; }
    if (view.picked) { stopPicking(); return true; }
    // (New event: Back closes an open calendar or wheels, then the form, as Cancel)
    if (form) { if (form.pick) { form.pick = null; render(); } else if (form.step === 2) { form.step = 1; render(); } else closeForm(); return true; }
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  dialog.addEventListener('close', () => { pop = null; view.picked = null; form = null; clearInterval(tick); clearInterval(testTimer); });
  window.addEventListener('restro:data-changed', e => {
    const c = e.detail?.collections || [];
    if (c.includes('events')) loadEvents();
    if (c.includes('qr') || c.includes('settings') || c.includes('events')) { load(); loadScans(); changed(); }
    // (an event's orders: its counts on the Event QRs page, and Delete off once it has one)
    if (c.includes('orders') && events.length) { noteOrders(); if (dialog.open && view.page === 'event') render(); }
  });
  window.addEventListener('restro:prefs-changed', e => { if (form && e.detail?.name === 'printers') loadKitchen(); changed(); });
  window.addEventListener('restro:connectivity-changed', () => { if (dialog.open) { render(); } else changed(); });
  window.addEventListener('restro:qr-path', e => setPath(e.detail));
  window.addEventListener('restro:qr-scan', e => scanned(e.detail));
  window.addEventListener('restro:restaurant-renamed', () => render());
  // (QR ordering's own clock: a pause ending, opening and closing, and the 10 s before it turns back on by itself)
  setInterval(() => { const n = attention(); if (n !== lastCount) changed(); else if (dialog.open && autoSince && pathOkSince) render(); }, 5000);
  window.RestroQrStudio = Object.freeze({ open, goBack, attention: () => attention(), ordering: () => { const s = ordering(); return { state: s.state, reason: s.auto?.reason || null }; },
    scanned, path: setPath, list: () => records.map(r => ({ ...r })), events: () => events.map(e => ({ ...e })) });
})();
