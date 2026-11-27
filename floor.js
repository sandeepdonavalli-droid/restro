'use strict';
// Floor (Update Pack 8, B): the restaurant's tables, area by area, as they are now.
// - Top row: Home (or "‹ Counter" when the Counter opened it), the Floor icon and title; the area pills, each with its
//   "N free" and, from 30 minutes before a booking there, a calendar badge; the Waitlist pill and the menu (Counter,
//   Orders, New reservation, Reservations, Edit layout).
// - The tables where they stand, an area on one page or several (page dots at the bottom, side arrows towards the pages
//   that exist, a swipe), coloured by what they are: Free, Occupied, Bill printed, Reserved; Needs attention (a Help bell
//   request or a QR order to confirm) glows red; a merged group is one tile, "7 + 8 + 55".
// - Bottom: the legend with its counts (the whole area, all its pages), Guests now and Due here.
// - Tap a free table: the Counter, that table, Dine-in. A busy one: its order. A reserved one, one paid by QR: their
//   pop-ups. Long-press: Move / Merge (section E).
// Other ways it opens (the same Floor): Pick a table for a reservation and Seat now (C3, D: bookings.js), Move / Merge
// and Move items (E). Light theme only for now (Midnight later). Sizes are the design's pixels on the 1920 x 1080 screen
// (--fu, launcher.css).
(() => {
  const dialog = document.querySelector('#floor-dialog');
  if (!dialog) return;
  const icon = (name, cls = '') => window.RestroFloorIcons?.svg(name, cls) || document.createElement('span');
  const MIN = 60000;

  // ---------- the floor plan (floor-data.js) ----------
  const SHAPES = ['rect', 'square', 'round'];
  const plan = window.RestroFloorPlan && Array.isArray(window.RestroFloorPlan.areas) ? window.RestroFloorPlan : { areas: [] };
  const areas = plan.areas.filter(a => a && a.id != null).map(a => ({ id: String(a.id), name: String(a.name || ''),
    tables: (Array.isArray(a.tables) ? a.tables : []).filter(t => t && t.id != null).map((t, i) => ({ id: String(t.id), name: String(t.name ?? t.id), seats: Math.max(1, Math.round(Number(t.seats)) || 2),
      shape: SHAPES.includes(t.shape) ? t.shape : Number(t.seats) <= 2 ? 'round' : 'rect', page: Math.max(0, Math.round(Number(t.page)) || 0),
      x: Number.isFinite(t.x) ? t.x : 98 + (i % 5) * 310, y: Number.isFinite(t.y) ? t.y : 70 + Math.floor(i / 5) * 270, w: Number(t.w) || 278, h: Number(t.h) || 208, area: String(a.id) })) }));
  const tables = areas.flatMap(a => a.tables);
  const tableById = new Map(tables.map(t => [t.id, t]));
  const areaById = new Map(areas.map(a => [a.id, a]));
  const pagesOf = area => Math.max(1, ...area.tables.map(t => t.page + 1));
  const tableName = id => tableById.get(id)?.name || '';

  // ---------- small helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const money = paise => `₹${Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;
  const clock = t => { const d = new Date(t), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const since = (t, now) => { const m = Math.max(0, Math.floor((now - t) / MIN)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const firstOf = name => String(name || '').trim().split(/\s+/)[0] || '';
  const fu = n => `calc(${n} * var(--fu))`;
  const appArt = name => el('img', { class: 'fl-app-ic', src: `assets/app-icons/${name}.webp`, alt: '', draggable: 'false' });

  // ---------- where it is ----------
  // mode: 'view' (the Floor), 'pick' (the Counter's Table box: the Floor, a free table goes on the order), 'reserve'
  // (a reservation's table, Seat now: bookings.js), 'mm' (Move / Merge) and 'items' (the Counter's Move items).
  let mode = 'view', from = 'home', pick = null, areaId = null, menuOpen = false, pop = null;
  // (E) Move / Merge and Move items: { kind: 'mm' | 'items', back: 'floor' | 'counter', sel: [the tables picked, the
  // first of each pick, in order], to (Move items: the table picked), items (the Counter's dishes: count, dishes,
  // preview(to), apply(to)), from (Move items: the order's table), uid } and its confirm pop-up
  let mm = null, mmPop = null, longAt = 0;
  // (C3) mode 'reserve': the booking being placed ({ back, who, guests, at, except, when, tables, area, picked, join,
  // onPick }) and the tables picked on the Floor so far
  let res = null, chosen = [];
  const pageOf = {};               // the page each area is on
  try { const saved = localStorage.getItem('restro.floor.area.v1'); if (areaById.has(saved)) areaId = saved; } catch {}
  if (!areaId) areaId = areas[0]?.id || null;
  const area = () => areaById.get(areaId) || areas[0];
  const pageNow = a => Math.min(pageOf[a.id] || 0, pagesOf(a) - 1);
  function goArea(id) {
    if (!areaById.has(id)) return;
    areaId = id; try { localStorage.setItem('restro.floor.area.v1', id); } catch {}
    render();
  }

  // ---------- what each table is now ----------
  // From the Counter's open orders on tables (RestroCounter.floorOrders), the bookings (RestroBookings) and the Help bell
  // requests: { kind: free | occupied | bill | reserved, order (its group), attention, calls, booking, next }
  function live(now = Date.now()) {
    const B = window.RestroBookings, byTable = new Map(), groups = [];
    // (an order not paid yet before one paid by QR that is still at the table)
    const orders = [...(window.RestroCounter?.floorOrders?.(now) || [])].sort((p, q) => Number(p.paidQr) - Number(q.paidQr));
    // (owner, 27 Nov 2026) a party seated with no order yet holds its tables: Occupied, its guests and since when (seated)
    const busy = new Set(orders.flatMap(o => o.tables));
    for (const h of B?.seatedHolds?.(now) || []) {
      const ts = h.tables.filter(t => tableById.has(t));
      if (!ts.length || ts.some(t => busy.has(t))) continue;
      orders.push({ uid: null, number: null, tables: ts, guests: h.guests, at: h.at, total: 0, due: 0, server: null, bill: false, paidQr: false, freeAt: null, confirm: false,
        items: 0, sent: false, dirty: false, left: [], seated: h });
      ts.forEach(t => busy.add(t));
    }
    // (a Help bell made at a table before its order moved away goes with the guests, to the order's table now (MM5): the
    // first move away from that table after the bell takes it)
    const tookWith = new Map(), movedAt = new Map();
    for (const o of orders) for (const l of o.left || []) for (const t of l.tables) for (const c of callsOn(t, now)) {
      if (c.at <= l.at && !(movedAt.get(c.id) <= l.at)) { movedAt.set(c.id, l.at); tookWith.set(c.id, o); }
    }
    const callsHere = (t, o = null) => callsOn(t, now).filter(c => !tookWith.has(c.id) || tookWith.get(c.id) === o);
    for (const o of orders) {
      const own = o.tables.flatMap(t => callsHere(t, o)), ids = new Set(own.map(c => c.id));
      const calls = [...own, ...[...tookWith].filter(([id, x]) => x === o && !ids.has(id)).map(([id]) => ({ ...requestCall(id, now), table: o.tables[0] })).filter(c => c.id)];
      const g = { ...o, calls, attention: Boolean(o.confirm) || calls.length > 0, label: o.tables.map(tableName).filter(Boolean).join(' + ') };
      groups.push(g);
      for (const t of o.tables) if (tableById.has(t) && !byTable.has(t)) byTable.set(t, g);
    }
    const state = new Map();
    // (E1) free merged groups: their tables free, one tile; not while one of them is busy or reserved
    const joinOn = new Map();
    for (const j of window.RestroCounter?.joins?.() || []) {
      const ts = j.tables.filter(t => tableById.has(t));
      if (ts.length < 2 || ts.some(t => byTable.has(t) || B?.reservedOn?.(t, now))) continue;
      const g = { id: j.id, tables: ts, label: ts.map(tableName).join(' + '), seats: ts.reduce((n, t) => n + tableById.get(t).seats, 0) };
      for (const t of ts) if (!joinOn.has(t)) joinOn.set(t, g);
    }
    for (const t of tables) {
      const o = byTable.get(t.id);
      if (o) { state.set(t.id, { kind: o.bill ? 'bill' : 'occupied', order: o, next: B?.nextOn?.(t.id, now) || null }); continue; }
      // (a Help bell from a table with no order yet: the table needs attention all the same)
      const r = B?.reservedOn?.(t.id, now), calls = callsHere(t.id);
      state.set(t.id, r ? { kind: 'reserved', booking: r, calls } : { kind: 'free', calls, join: joinOn.get(t.id) || null });
    }
    return { state, orders: groups.filter(g => g.tables.some(t => byTable.get(t) === g)) };
  }
  // Counts for an area (all its pages): Free · Occupied · Bill printed · Reserved (one per table; a merged group spread
  // over several areas counts in every area it touches, all its tables), Needs attention (one per order, in the area its
  // Help bell came from, and one per table with a Help bell request and no order), Guests now and Due here (one per
  // order, in every area its tables touch).
  function countsOf(a, L) {
    const n = { free: 0, occupied: 0, bill: 0, reserved: 0, attention: 0, guests: 0, due: 0 }, here = new Set();
    for (const t of a.tables) { const s = L.state.get(t.id); n[s.kind] += 1; if (s.order) here.add(s.order); else if (s.calls?.length) n.attention += 1; }
    for (const o of L.orders) if (o.tables.some(id => tableById.get(id)?.area === a.id)) here.add(o);
    for (const o of here) {
      // (a merged group's Help bell counts in the area of the table it came from, MM4b; a QR order to confirm, in each)
      n.guests += o.guests || 0; n.due += o.due || 0; if (o.confirm || o.calls.some(c => tableById.get(c.table)?.area === a.id)) n.attention += 1;
      n[o.bill ? 'bill' : 'occupied'] += o.tables.filter(id => tableById.has(id) && tableById.get(id).area !== a.id).length;
    }
    return n;
  }

  // ---------- Help bell requests (Pack 7 H1: from the table's QR, to every captain phone and the POS) ----------
  // restro:qr-request { id, table, kind: waiter | water | bill | other, note, at } puts the request on its table; it goes
  // once a captain takes it (restro:qr-request-taken { id }) or the customer cancels it (restro:qr-request-cancelled
  // { id } or { table }). Kept on this tablet for 3 hours at most (restro.requests.v1).
  const REQ_KEY = 'restro.requests.v1', REQ_WORDS = { waiter: 'Waiter', water: 'Water', bill: 'Bill', other: 'Help' };
  let requests = [];
  try { const v = JSON.parse(localStorage.getItem(REQ_KEY) || '[]'); if (Array.isArray(v)) requests = v.filter(r => r && typeof r.id === 'string' && typeof r.table === 'string'); } catch {}
  const keepRequests = () => { const cut = Date.now() - 3 * 60 * MIN; requests = requests.filter(r => (Number(r.at) || 0) > cut).slice(-200); try { localStorage.setItem(REQ_KEY, JSON.stringify(requests)); } catch {} if (dialog.open) render(); };
  const callsOn = (table, now) => requests.filter(r => r.table === table && (Number(r.at) || 0) > now - 3 * 60 * MIN).map(r => ({ id: r.id, table, kind: r.kind, label: REQ_WORDS[r.kind] || 'Help', at: Number(r.at) || 0 }));
  const requestCall = (id, now) => { const r = requests.find(x => x.id === id); return r ? callsOn(r.table, now).find(c => c.id === id) || {} : {}; };
  window.addEventListener('restro:qr-request', e => {
    const d = e.detail || {}; if (typeof d.table !== 'string' || !d.table) return;
    requests = [...requests.filter(r => r.id !== d.id), { id: String(d.id || `rq${Date.now()}`), table: d.table, kind: REQ_WORDS[d.kind] ? d.kind : 'other', note: String(d.note || '').slice(0, 120), at: Number(d.at) || Date.now() }];
    keepRequests();
  });
  window.addEventListener('restro:qr-request-taken', e => { requests = requests.filter(r => r.id !== e.detail?.id); keepRequests(); });
  window.addEventListener('restro:qr-request-cancelled', e => { const d = e.detail || {}; requests = requests.filter(r => !(d.id ? r.id === d.id : r.table === d.table)); keepRequests(); });

  // ---------- drawing ----------
  const root = el('div', { class: 'fl-root' }); dialog.prepend(root);
  let toastNode = null, toastTimer = 0, tick = 0;

  function render() {
    const now = Date.now(), L = live(now), a = area();
    root.dataset.mode = mode;
    if (mode === 'reserve' && res) { renderReserve(a, L, now); return; }
    if ((mode === 'mm' || mode === 'items') && mm) { renderMM(a, L, now); return; }
    const parts = [head(L, now), canvas(a, L, now), bottom(a, L)];
    if (menuOpen) parts.push(el('div', { class: 'fl-catch', onclick: () => { menuOpen = false; render(); } }), menuCard());
    if (pop) parts.push(popLayer(L, now));
    root.replaceChildren(...parts);
    if (toastNode) root.append(toastNode);
  }

  // The top row
  function head(L, now) {
    const nav = from === 'counter'
      ? el('button', { type: 'button', class: 'fl-back', onclick: goBack }, icon('chevron-left'), 'Counter')
      : el('button', { type: 'button', class: 'fl-home', 'aria-label': 'Home', title: 'Home', onclick: () => document.querySelector('#system-home')?.click() }, homeIcon());
    const B = window.RestroBookings, waiting = B?.waitingNow?.(now)?.length || 0;
    return el('header', { class: 'fl-top' }, nav, el('span', { class: 'fl-title-ic' }, appArt('floor')), el('h2', { id: 'floor-title', tabindex: '-1' }, 'Floor'),
      el('div', { class: 'fl-areas-wrap' }, el('nav', { class: 'fl-areas', role: 'tablist', 'aria-label': 'Areas' }, ...areas.map(x => areaPill(x, L, now)))),
      el('button', { type: 'button', class: 'fl-wait', onclick: () => window.RestroBookingsApp?.open?.({ tab: 'waitlist', from: 'floor', floorFrom: from }) },
        icon('timer'), 'Waitlist', el('em', {}, String(waiting))),
      el('button', { type: 'button', class: `fl-menu-btn${menuOpen ? ' on' : ''}`, 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), onclick: () => { menuOpen = !menuOpen; render(); } }, burger()));
  }
  // (the menu button's three lines, as drawn: wider and closer than the usual icon)
  function burger() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<path d="M2.5 6h19M2.5 12h19M2.5 18h19"/>'; return s;
  }
  function homeIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<path d="M4.5 11.2 L12 4.6 L19.5 11.2 V18.4 a1.6 1.6 0 0 1 -1.6 1.6 H14.6 V15.4 a2.6 2.6 0 0 0 -5.2 0 V20 H6.1 a1.6 1.6 0 0 1 -1.6 -1.6 Z"/>'; return s;
  }
  function areaPill(x, L, now) {
    const on = x.id === areaId, n = countsOf(x, L), badge = window.RestroBookings?.badgeOn?.(x.tables.map(t => t.id), now);
    return el('button', { type: 'button', role: 'tab', 'aria-selected': String(on), class: `fl-area${on ? ' on' : ''}`, 'data-area': x.id, onclick: () => goArea(x.id) },
      el('span', { class: 'fl-area-n' }, x.name), el('span', { class: 'fl-free' }, el('b', {}, String(n.free)), ' free'),
      badge ? el('i', { class: 'fl-badge', 'aria-label': 'A booking soon' }, icon('calendar')) : null);
  }

  // The tables
  // (deco: Move / Merge's look for each tile, { cls, from, tap })
  function canvas(a, L, now, deco = null) {
    const page = pageNow(a), pages = pagesOf(a);
    const drawn = new Set(), tiles = [];
    for (const t of a.tables.filter(x => x.page === page)) {
      if (drawn.has(t.id)) continue;
      const s = L.state.get(t.id), g = s.order && s.order.tables.length > 1 ? s.order.tables : s.join ? s.join.tables : null;
      // a merged group (an order's, or free tables merged): its tables side by side on this page are one tile
      if (g) {
        const row = sideBySide(g.map(id => tableById.get(id)).filter(x => x && x.area === a.id && x.page === page));
        if (row) { row.forEach(x => drawn.add(x.id)); tiles.push(tile(row, s, now, deco)); continue; }
      }
      drawn.add(t.id); tiles.push(tile([t], s, now, deco));
    }
    const arrows = [page > 0 ? el('button', { type: 'button', class: 'fl-arrow l', 'aria-label': 'Previous page', onclick: () => turn(-1) }, icon('chevron-left')) : null,
      page < pages - 1 ? el('button', { type: 'button', class: 'fl-arrow r', 'aria-label': 'Next page', onclick: () => turn(1) }, icon('chevron-right')) : null];
    const box = el('div', { class: 'fl-canvas' }, ...tiles, ...arrows);
    swipes(box);
    if (mode === 'view') longPress(box);
    return box;
  }
  // Tables in one row with only a narrow gap between them (one joined tile), or null
  function sideBySide(list) {
    if (list.length < 2) return list.length ? list : null;
    const s = [...list].sort((p, q) => p.x - q.x);
    for (let i = 1; i < s.length; i++) {
      const p = s[i - 1], q = s[i];
      if (q.x - (p.x + p.w) > 48 || q.y + q.h < p.y || q.y > p.y + p.h) return null;
    }
    return s;
  }
  function tile(group, s, now, deco = null) {
    const x = Math.min(...group.map(t => t.x)), y = Math.min(...group.map(t => t.y)), w = Math.max(...group.map(t => t.x + t.w)) - x, h = Math.max(...group.map(t => t.y + t.h)) - y;
    const shape = group.length > 1 ? 'rect' : group[0].shape, o = s.order, kind = s.kind, t0 = group[0], j = o ? null : s.join || null;
    // (a merged group's Help bell shows on the tile of the table it came from, MM4 / MM4b; a QR order to confirm, on each)
    const calls = o ? o.calls.filter(c => group.some(t => t.id === c.table)) : s.calls || [], attention = o ? Boolean(o.confirm) || calls.length > 0 : calls.length > 0, d = deco ? deco(t0.id, s) : null;
    const cls = ['fl-t', shape, kind, attention ? 'attn' : '', o?.paidQr ? 'qr' : '', d?.cls || ''].filter(Boolean).join(' ');
    const lines = [];
    // (a merged group: only its numbers, "7 + 8 + 55", on each of its tiles; a free one shows all its seats)
    const joined = (o && o.tables.length > 1) || Boolean(j), number = o && o.tables.length > 1 ? o.label : j ? j.label : t0.name;
    lines.push(el('b', { class: joined ? 'fl-no join' : 'fl-no' }, number));
    if (kind === 'free') lines.push(el('span', { class: 'fl-ln seat' }, icon('chair'), String(j ? j.seats : t0.seats)));
    else if (kind === 'reserved') {
      const r = s.booking;
      lines.push(el('span', { class: 'fl-ln lab' }, `Reserved ${clock(r.at)}`), el('span', { class: 'fl-ln who' }, el('b', {}, r.first || window.RestroBookings?.nameOf?.(r) || 'Guest'), icon('chair'), String(r.guests)));
    } else {
      if (o.guests) lines.push(el('span', { class: 'fl-ln seat' }, icon('chair'), String(o.guests)));
      lines.push(el('span', { class: 'fl-ln time' }, icon('clock'), since(o.at, now)));
      if (o.paidQr) lines.push(el('span', { class: 'fl-ln qr' }, icon('check'), 'Paid by QR'));
      else if (kind === 'bill') lines.push(el('span', { class: 'fl-ln lab' }, 'Bill printed'));
      if (!o.paidQr && o.due > 0) lines.push(el('span', { class: 'fl-ln due' }, el('b', {}, money(o.due)), ' due'));
    }
    const tags = [];
    // (Move items: the order's own table, faded, with its black From tag where the server's initials are)
    if (d?.from) tags.push(el('i', { class: 'fl-from' }, 'From'));
    else if (o?.server) tags.push(el('i', { class: 'fl-srv' }, initials(o.server)));
    if (calls.length) tags.push(el('i', { class: 'fl-call' }, icon('bell'), calls[0].label));
    if (s.next && kind !== 'reserved') tags.push(el('i', { class: 'fl-next' }, icon('calendar'), `Next ${clock(s.next.at)} · ${s.next.first || 'Guest'}`));
    const label = `Table ${number}, ${{ free: 'free', occupied: 'occupied', bill: 'bill printed', reserved: 'reserved' }[kind]}${d?.label || ''}`;
    // (picked: 2 larger to the right and below, as Move / Merge draws it)
    const grow = d?.sel ? 2 : 0;
    return el('button', { type: 'button', class: cls, 'data-id': t0.id, 'aria-label': label, 'aria-pressed': d ? String(Boolean(d.sel)) : null, 'aria-disabled': d?.off ? 'true' : null,
      style: `left:${fu(x)};top:${fu(y)};width:${fu(w + grow)};height:${fu(h + grow)}`, onclick: () => (d?.tap ? d.tap() : tapTable(t0.id, s)) },
    el('span', { class: 'fl-in' }, ...lines), ...tags, d?.sel ? el('em', { class: 'fl-tick', 'aria-hidden': 'true' }, icon('check')) : null);
  }

  // The legend, the page dots, Guests now and Due here
  function bottom(a, L) {
    const n = countsOf(a, L), pages = pagesOf(a), page = pageNow(a);
    const sw = (cls, label, count) => el('span', { class: 'fl-lg' }, el('i', { class: `fl-sw ${cls}` }), label, el('b', {}, String(count)));
    return el('footer', { class: 'fl-bot' },
      el('div', { class: 'fl-legend' }, sw('free', 'Free', n.free), sw('occupied', 'Occupied', n.occupied), sw('bill', 'Bill printed', n.bill), sw('reserved', 'Reserved', n.reserved), sw('attn', 'Needs attention', n.attention)),
      pages > 1 ? el('div', { class: 'fl-dots', role: 'tablist', 'aria-label': 'Pages' }, ...Array.from({ length: pages }, (_, i) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === page), 'aria-label': `Page ${i + 1}`, class: i === page ? 'on' : '', onclick: () => { pageOf[a.id] = i; render(); } }))) : null,
      el('div', { class: 'fl-sums' }, el('span', {}, 'Guests now ', el('b', {}, String(n.guests))), el('span', {}, 'Due here ', el('b', { class: 'due' }, money(n.due)))));
  }

  // ---------- Pick a table for a reservation (C3: N05–N07) ----------
  // The real Floor, picking: "‹ New reservation", "Pick a table", the party (name · guests · day and time) in a black pill,
  // Join tables; the areas on their own row with what is free there for this party then; the tables as they are for it:
  // free (white, its seats), too small ("N/A · 4 seats", dashed; pickable with Join tables), occupied now ("Seated 18
  // min", faded: a booking within the next 2 hours) and booked ("Booked 9:00 PM", grey), which can't be picked; the one
  // picked with a blue ring and a tick. A tap picks a table and goes back to the form. With Join tables on, taps tick
  // tables in any area, across its pages (owner, 27 Nov 2026: staff may join tables of different areas; the auto-pick
  // joins only tables next to each other), a blue dot on another area holding one; Done takes them.
  function renderReserve(a, L, now) {
    const B = window.RestroBookings; if (!B?.tablesFor) return;
    const all = B.tablesFor({ at: res.seat ? now : res.at, guests: res.guests, except: res.except, now, lock: Boolean(res.seat) });
    const info = new Map(areas.map(x => [x.id, B.areaFor(x.id, all, res.guests)]));
    root.replaceChildren(reserveHead(info), reserveCanvas(a, L, all, now), reserveBottom(a, all));
    if (toastNode) root.append(toastNode);
  }
  function reserveHead(info) {
    // (Seat now, D B11: the party's pager in place of the day and time; nobody can sit at a table busy now, so no "maybe")
    const who = [res.who, `${res.guests} guest${res.guests === 1 ? '' : 's'}`, res.seat ? (res.pager ? `Pager ${res.pager}` : '') : res.when].filter(Boolean);
    const pill = x => {
      const n = info.get(x.id), on = x.id === areaId, maybe = res.seat ? 0 : n.maybe;
      const count = n.free ? `${n.free} free${maybe ? ` · ${maybe} maybe` : ''}` : res.join && n.join ? `join ${n.join}` : maybe ? `${maybe} maybe` : 'none';
      const dot = !on && chosen.some(id => tableById.get(id)?.area === x.id);
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-label': dot ? `${x.name}, a table picked here` : null, class: `fl-area${on ? ' on' : ''}${count === 'none' ? ' dim' : ''}`, 'data-area': x.id, onclick: () => goArea(x.id) },
        el('span', { class: 'fl-area-n' }, x.name), el('span', { class: 'fl-free rs' }, count), dot ? el('i', { class: 'fl-mmdot', 'aria-hidden': 'true' }) : null);
    };
    return el('header', { class: `fl-top rs${res.seat ? ' seat' : ''}` },
      el('button', { type: 'button', class: 'fl-back', onclick: goBack }, icon('chevron-left'), res.back || 'New reservation'),
      el('h2', { id: 'floor-title', tabindex: '-1' }, res.title || 'Pick a table'),
      el('div', { class: 'fl-ctx' }, ...who.flatMap((w, i) => (i ? [el('i', { 'aria-hidden': 'true' }), el('span', {}, w)] : [el('span', {}, w)]))),
      el('button', { type: 'button', role: 'switch', 'aria-checked': String(Boolean(res.join)), class: `fl-join${res.join ? ' on' : ''}`, onclick: () => toggleJoin(info) }, 'Join tables', el('i', { 'aria-hidden': 'true' })),
      el('div', { class: 'fl-areas-wrap rs' }, el('nav', { class: 'fl-areas', role: 'tablist', 'aria-label': 'Areas' }, ...areas.map(pill))));
  }
  function reserveCanvas(a, L, all, now) {
    const page = pageNow(a), pages = pagesOf(a), drawn = new Set(), tiles = [];
    for (const t of a.tables.filter(x => x.page === page)) {
      if (drawn.has(t.id)) continue;
      const s = all.get(t.id); if (!s) continue;
      const busy = s.state === 'busy' || s.state === 'maybe', o = busy ? L.state.get(t.id)?.order || null : null;
      // (an occupied merged group: one tile, as on the Floor)
      if (o && o.tables.length > 1) {
        const row = sideBySide(o.tables.map(id => tableById.get(id)).filter(x => x && x.area === a.id && x.page === page));
        if (row) { row.forEach(x => drawn.add(x.id)); tiles.push(reserveTile(row, s, o, now)); continue; }
      }
      drawn.add(t.id); tiles.push(reserveTile([t], s, o, now));
    }
    const arrows = [page > 0 ? el('button', { type: 'button', class: 'fl-arrow l', 'aria-label': 'Previous page', onclick: () => turn(-1) }, icon('chevron-left')) : null,
      page < pages - 1 ? el('button', { type: 'button', class: 'fl-arrow r', 'aria-label': 'Next page', onclick: () => turn(1) }, icon('chevron-right')) : null];
    const box = el('div', { class: 'fl-canvas' }, ...tiles, ...arrows);
    swipes(box);
    return box;
  }
  // (the tables a little smaller than on the Floor itself, where they stand: as N05–N07 draw them)
  function reserveTile(group, s, o, now) {
    const x = Math.min(...group.map(t => t.x)), y = Math.min(...group.map(t => t.y)), w = Math.max(...group.map(t => t.x + t.w)) - x, h = Math.max(...group.map(t => t.y + t.h)) - y;
    const t0 = group[0], shape = group.length > 1 ? 'rect' : t0.shape, sel = chosen.includes(t0.id);
    const kind = s.state === 'booked' ? 'bk' : o || s.state === 'busy' || s.state === 'maybe' ? 'oc' : sel || s.fits || res.join ? 'ok' : 'na';
    const number = o && o.tables.length > 1 ? o.tables.map(tableName).filter(Boolean).join(' + ') : t0.name;
    const line = kind === 'bk' ? el('span', { class: 'fl-ln' }, `Booked ${clock(s.booking.at)}`)
      : kind === 'oc' ? el('span', { class: 'fl-ln time' }, icon('clock'), `Seated ${since(o?.at || now, now)}`)
        : kind === 'na' ? el('span', { class: 'fl-ln' }, `N/A · ${t0.seats} seats`)
          : el('span', { class: 'fl-ln seat' }, icon('chair'), `${t0.seats} seats`);
    const label = `Table ${number}, ${{ ok: `${t0.seats} seats`, na: `too small, ${t0.seats} seats`, oc: 'occupied now, can’t pick', bk: `booked ${clock(s.booking?.at || now)}, can’t pick` }[kind]}${sel ? ', picked' : ''}`;
    return el('button', { type: 'button', class: `fl-t rs ${shape} ${kind}${sel ? ' sel' : ''}`, 'data-id': t0.id, 'aria-label': label, 'aria-disabled': kind === 'ok' ? null : 'true',
      style: `left:${fu(x)};top:${fu(y)};width:${fu(w - 24)};height:${fu(h - 24)}`, onclick: () => { if (kind === 'ok') tapReserve(t0.id); } },
    el('span', { class: 'fl-in' }, el('b', { class: o && o.tables.length > 1 ? 'fl-no join' : 'fl-no' }, number), line),
    sel ? el('em', { class: 'fl-tick', 'aria-hidden': 'true' }, icon('check')) : null);
  }
  function tapReserve(id) {
    if (Date.now() - swiped < 400) return;
    // (Seat now: the table tapped is picked, "Seat at Table N" seats them)
    if (!res.join && res.seat) { chosen = [id]; render(); return; }
    if (!res.join) { const done = res.onPick; close(); done?.([id]); return; }
    if (chosen.includes(id)) chosen = chosen.filter(x => x !== id);
    else chosen = [...chosen, id];
    render();
  }
  function toggleJoin() {
    res.join = !res.join;
    if (!res.join) { const all = window.RestroBookings.tablesFor({ at: res.seat ? Date.now() : res.at, guests: res.guests, except: res.except, lock: Boolean(res.seat) }); chosen = chosen.filter(id => all.get(id)?.fits).slice(0, 1); }
    render();
  }
  function reserveBottom(a) {
    const pages = pagesOf(a), page = pageNow(a);
    const dots = pages > 1 ? el('div', { class: 'fl-dots', role: 'tablist', 'aria-label': 'Pages' }, ...Array.from({ length: pages }, (_, i) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === page), 'aria-label': `Page ${i + 1}`, class: i === page ? 'on' : '', onclick: () => { pageOf[a.id] = i; render(); } }))) : null;
    const take = () => { const done = res.onPick, ids = [...chosen]; close(); done?.(ids); };
    // (Seat now, D B11: "Seat at Table 3" at the bottom right seats them)
    const seatBtn = () => el('button', { type: 'button', class: 'fl-seat', disabled: !chosen.length, onclick: take },
      chosen.length ? `Seat at ${chosen.length > 1 ? 'Tables' : 'Table'} ${chosen.map(tableName).join(' + ')}` : 'Seat at a table');
    if (res.join) {
      const ts = chosen.map(id => tableById.get(id)).filter(Boolean), seats = ts.reduce((n, t) => n + t.seats, 0);
      return el('footer', { class: `fl-bot rs${res.seat ? ' seat' : ''}` },
        el('div', { class: 'fl-joined' }, el('b', {}, ts.length ? ts.map(t => `Table ${t.name}`).join(' + ') : 'Tap the tables to join'), el('i', { 'aria-hidden': 'true' }),
          el('span', { class: seats >= res.guests ? 'ok' : 'short' }, el('b', {}, `${seats} seats`), ` for ${res.guests} guest${res.guests === 1 ? '' : 's'}`)),
        dots, res.seat ? seatBtn() : el('button', { type: 'button', class: 'fl-done', disabled: !ts.length, onclick: take }, icon('check'), 'Done'));
    }
    const sw = (cls, label) => el('span', { class: 'fl-lg' }, el('i', { class: `fl-sw ${cls}` }), label);
    const how = res.picked === 'current' ? 'current table' : res.picked === 'floor' ? 'picked on the Floor' : 'auto-picked';
    return el('footer', { class: `fl-bot rs${res.seat ? ' seat' : ''}` },
      el('div', { class: 'fl-legend rs' }, sw('r-free', 'Free'), sw('r-oc', 'Occupied now · can’t pick'), sw('r-bk', 'Booked · can’t pick'), sw('r-na', `N/A · fewer than ${res.guests} seats`)),
      dots, res.seat ? seatBtn() : el('p', { class: 'fl-hint' }, 'Tap a table to choose it', chosen.length ? ` · now: ${chosen.map(id => `Table ${tableName(id)}`).join(' + ')} (${how})` : ''));
  }

  // ---------- Move / Merge (E1–E2: MM1–MM6b, CM2–CM4) and Move items (E3: CM6–CM8) ----------
  // Long-press any table, free or busy (or the Counter's Move / Merge tables: that order's table picked, "‹ Counter"):
  // "Move / Merge", the area pills without their counts (a blue dot on another area holding a table picked), the tables
  // where they stand, on the page's grey. Tap tables to pick them, in any area (a merged group is picked whole); tap one
  // again to put it back. Bottom left: what is picked, area by area; bottom right: Move · Merge (Unmerge for a merged
  // group alone), greyed when they don't apply, never hidden. A table reserved within the next hour can't be picked
  // (faded, C1). Each action asks first (MM2b, MM3b, MM6b); then the Floor shows it (or the Counter, opened from there),
  // with a toast. Move items (the Counter's, CM6–CM7): "Move items", the order's table faded with a black From tag; tap
  // the table to move the dishes to, then Move here (CM8 asks first).
  // A table's pick: its order's tables (a merged group), a free merged group's, or the table alone
  function unitOf(id, L) {
    const s = L.state.get(id); if (!s) return null;
    if (s.order) { const ts = s.order.tables.filter(t => tableById.has(t)); return { key: ts[0] || id, tables: ts.length ? ts : [id], order: s.order, s }; }
    if (s.join) return { key: s.join.tables[0], tables: s.join.tables, join: s.join, s };
    return { key: id, tables: [id], s };
  }
  function unitsOf(L) {
    const seen = new Set(), out = [];
    for (const id of mm?.sel || []) { const u = unitOf(id, L); if (u && !seen.has(u.key)) { seen.add(u.key); out.push(u); } }
    return out;
  }
  const unitWord = u => `Table ${u.tables.map(tableName).join(' + ')}`;
  const guestsWord = n => `${n} guest${n === 1 ? '' : 's'}`;
  // Why a table can't be picked (a toast), or null
  function cantPick(u) {
    if (u.s.kind === 'reserved') return { b: `Table ${tableName(u.key)} is reserved for ${clock(u.s.booking.at)}`, t: ' · it can’t be picked' };
    if (u.order?.dirty) return { b: `${unitWord(u)}’s order isn’t saved yet`, t: ' · save it on the Counter first' };
    if (u.order?.confirm) return { b: unitWord(u), t: ' has a QR payment to confirm first' };
    if (u.order?.seated) return { b: `${unitWord(u)}’s guests have no order yet`, t: ' · start it on the Counter first' };
    return null;
  }
  // (from a long-press on the Floor, back: 'floor'; from the Counter, 'counter')
  function startMM(id, back = 'floor') {
    const L = live(), u = id ? unitOf(id, L) : null;
    mode = 'mm'; mm = { kind: 'mm', back, sel: [] }; mmPop = null; pop = null; menuOpen = false;
    if (u) { const why = cantPick(u); if (why) say(why); else mm.sel = [u.key]; }
    render();
    root.querySelector('#floor-title')?.focus({ preventScroll: true });
  }
  function renderMM(a, L, now) {
    const units = unitsOf(L), items = mm.kind === 'items';
    const parts = [mmHead(units, L), canvas(a, L, now, items ? itemsDeco(L) : mmDeco(L, units)), items ? itemsBottom(a, L) : mmBottom(a, units)];
    if (mmPop) { const layer = mmPopLayer(L, units); if (layer) parts.push(layer); }
    root.replaceChildren(...parts);
    if (toastNode) root.append(toastNode);
  }
  const mmDeco = (L, units) => (id, s) => {
    const u = unitOf(id, L), sel = units.some(x => x.key === u.key), off = s.kind === 'reserved';
    return { cls: [sel ? 'sel' : '', off ? 'lock' : ''].filter(Boolean).join(' '), sel, off, tap: () => tapMM(id), label: sel ? ', picked' : off ? ', can’t be picked' : '' };
  };
  const itemsDeco = L => (id, s) => {
    const u = unitOf(id, L), from = u.tables.includes(mm.from), sel = !from && Boolean(mm.to) && unitOf(mm.to, L)?.key === u.key, off = !from && s.kind === 'reserved';
    return { cls: [from ? 'from' : '', sel ? 'sel' : '', off ? 'lock' : ''].filter(Boolean).join(' '), from, sel, off: from || off, tap: () => tapItems(id), label: from ? ', the dishes are from here' : sel ? ', picked' : off ? ', can’t be picked' : '' };
  };
  function tapMM(id) {
    if (Date.now() - swiped < 400) return;
    const L = live(), u = unitOf(id, L); if (!u) return;
    const at = mm.sel.findIndex(k => unitOf(k, L)?.key === u.key);
    if (at >= 0) { mm.sel.splice(at, 1); render(); return; }
    const why = cantPick(u); if (why) { say(why); return; }
    mm.sel.push(u.key); render();
  }
  function tapItems(id) {
    if (Date.now() - swiped < 400) return;
    const L = live(), u = unitOf(id, L); if (!u || u.tables.includes(mm.from)) return;
    if (mm.to && unitOf(mm.to, L)?.key === u.key) { mm.to = null; render(); return; }
    const why = cantPick(u) || (u.order?.paidQr ? { b: `${unitWord(u)} is paid by QR`, t: ' · pick another table' } : null);
    if (why) { say(why); return; }
    mm.to = u.key; render();
  }
  // Which buttons apply (E1): one table, nothing (a merged group alone: Unmerge); an order (or a merged group) and one free
  // table: Move and Merge; any two or more: Merge
  function mmState(units) {
    const single = u => !u.order && !u.join;
    if (units.length === 1) return { move: false, second: units[0].tables.length > 1, unmerge: units[0].tables.length > 1 };
    if (units.length === 2) { const [p, q] = units; return { move: Boolean((p.order && single(q)) || (q.order && single(p))), second: true, unmerge: false }; }
    return { move: false, second: units.length > 2, unmerge: false };
  }
  // The top row: "‹ Floor" (or "‹ Counter"), the title, the areas without counts
  function mmHead(units, L) {
    const picked = new Set(units.flatMap(u => u.tables).map(t => tableById.get(t)?.area).filter(Boolean));
    if (mm.kind === 'items' && mm.to) for (const t of unitOf(mm.to, L)?.tables || []) picked.add(tableById.get(t)?.area);
    const pill = x => {
      const on = x.id === areaId, dot = !on && picked.has(x.id);
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-label': `${x.name}${dot ? ', a table picked here' : ''}`, class: `fl-area mm${on ? ' on' : ''}`, 'data-area': x.id, onclick: () => goArea(x.id) },
        el('span', { class: 'fl-area-n' }, x.name), dot ? el('i', { class: 'fl-mmdot', 'aria-hidden': 'true' }) : null);
    };
    return el('header', { class: 'fl-top mm' },
      el('div', { class: 'fl-mmt' }, el('button', { type: 'button', class: 'fl-back', onclick: goBack }, icon('chevron-left'), mm.back === 'counter' ? 'Counter' : 'Floor'),
        el('h2', { id: 'floor-title', tabindex: '-1' }, mm.kind === 'items' ? 'Move items' : 'Move / Merge')),
      el('div', { class: 'fl-areas-wrap mm' }, el('nav', { class: 'fl-areas', role: 'tablist', 'aria-label': 'Areas' }, ...areas.map(pill))));
  }
  const pageDots = a => {
    const pages = pagesOf(a), page = pageNow(a);
    return pages > 1 ? el('div', { class: 'fl-dots', role: 'tablist', 'aria-label': 'Pages' }, ...Array.from({ length: pages }, (_, i) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === page), 'aria-label': `Page ${i + 1}`, class: i === page ? 'on' : '', onclick: () => { pageOf[a.id] = i; render(); } }))) : null;
  };
  // What is picked: "Table 7 selected · tap more tables"; "Table 5 + 6 selected"; area by area, "Table 7 + 8 AC hall +
  // Table 55 Terrace"
  function selLine(units) {
    if (!units.length) return el('p', { class: 'fl-mmsel' }, el('span', {}, 'Tap the tables to move or merge'));
    if (units.length === 1) return el('p', { class: 'fl-mmsel' }, el('b', {}, unitWord(units[0])), el('span', {}, units[0].tables.length > 1 ? 'selected' : 'selected · tap more tables'));
    const byArea = new Map();
    for (const u of units) for (const t of u.tables) { const ar = tableById.get(t)?.area; if (!byArea.has(ar)) byArea.set(ar, []); byArea.get(ar).push(t); }
    return el('p', { class: 'fl-mmsel' }, ...[...byArea].flatMap(([ar, ts], i) => [i ? el('i', { 'aria-hidden': 'true' }, '+') : null, el('b', {}, `Table ${ts.map(tableName).join(' + ')}`), el('small', {}, areaById.get(ar)?.name || '')]));
  }
  function mmBottom(a, units) {
    const st = mmState(units);
    return el('footer', { class: 'fl-bot mm' }, selLine(units), pageDots(a),
      el('div', { class: 'fl-mmbtns' },
        el('button', { type: 'button', class: 'fl-mmb', disabled: !st.move, onclick: () => ask('move') }, icon('arrow-long'), 'Move'),
        el('button', { type: 'button', class: 'fl-mmb', disabled: !st.second, onclick: () => ask(st.unmerge ? 'unmerge' : 'merge') }, icon('merge'), st.unmerge ? 'Unmerge' : 'Merge')));
  }
  // Move items: "7 items from Table 12 · tap the table to move them to", then "7 items from Table 12 → Table 13"; Move here
  function itemsBottom(a, L) {
    const to = mm.to ? unitOf(mm.to, L) : null, src = unitOf(mm.from, L), n = mm.items.count, items = `${n} item${n === 1 ? '' : 's'}`;
    const left = to ? el('p', { class: 'fl-mmsel' }, el('b', {}, items), el('span', {}, `from ${src ? unitWord(src) : `Table ${tableName(mm.from)}`}`), el('i', { class: 'ar', 'aria-label': 'to' }, icon('arrow-right')), el('b', {}, unitWord(to)))
      : el('p', { class: 'fl-mmsel' }, el('b', {}, items), el('span', {}, `from ${src ? unitWord(src) : `Table ${tableName(mm.from)}`} · tap the table to move them to`));
    return el('footer', { class: 'fl-bot mm' }, left, pageDots(a),
      el('div', { class: 'fl-mmbtns' }, el('span'), el('button', { type: 'button', class: 'fl-mmb', disabled: !to, onclick: () => ask('items') }, icon('arrow-long'), 'Move here')));
  }
  function ask(kind) { mmPop = { kind }; render(); root.querySelector('.fl-pop .fl-btn.solid')?.focus({ preventScroll: true }); }
  function closeMMPop() { mmPop = null; render(); }

  // ---------- the confirm pop-ups (MM2b, MM3b, MM6b, CM8: the Counter pop-up's look) ----------
  // A table's chip in its colour (occupied blue, bill printed yellow, free white), its card ("Table 7", "4 guests · ₹1,120
  // due"; another area's name first; free: "Free · 4 seats")
  const tchip = u => el('i', { class: `fl-tchip ${u.order ? (u.s.kind === 'bill' ? 'bill' : 'occ') : 'free'}${u.tables.length > 1 ? ' wide' : ''}` }, u.tables.map(tableName).join(' + '));
  function subOf(u, area = false) {
    if (!u.order) return `Free · ${u.join ? u.join.seats : tableById.get(u.key)?.seats || 0} seats`;
    const o = u.order;
    return [area ? areaById.get(tableById.get(u.key)?.area)?.name || '' : '', o.guests ? guestsWord(o.guests) : '', o.paidQr ? 'Paid by QR' : `${money(o.due)} due`].filter(Boolean).join(' · ');
  }
  const mmCard = (u, sub, word = unitWord(u), chip = tchip(u)) => el('div', { class: 'fl-card fl-mmc' }, chip, el('div', {}, el('b', {}, word), el('small', {}, sub)));
  const mmTop = (ic, title) => el('div', { class: 'fl-pop-h' }, el('i', { class: 'fl-pop-ic mm' }, icon(ic)), el('h3', { id: 'fl-pop-t' }, title), el('button', { type: 'button', class: 'fl-x', 'aria-label': 'Close', onclick: closeMMPop }, icon('x')));
  const mmBtns = (ic, label, run) => el('div', { class: 'fl-btns two mm' }, el('button', { type: 'button', class: 'fl-btn white', onclick: closeMMPop }, 'Cancel'),
    el('button', { type: 'button', class: 'fl-btn solid', onclick: run }, icon(ic), label));
  const mmPopOf = (...kids) => el('div', { class: 'fl-pop mm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-pop-t' }, ...kids);
  function mmPopLayer(L, units) {
    const k = mmPop.kind, card = k === 'move' ? movePop(units) : k === 'merge' ? mergePop(units) : k === 'unmerge' ? unmergePop(units) : k === 'items' ? itemsPop(L) : null;
    if (!card) { mmPop = null; return null; }
    return el('div', { class: 'fl-scrim', onclick: e => { if (e.target === e.currentTarget) closeMMPop(); } }, card);
  }
  // Move (MM2b): "Move Table 7 to Table 13?" Table 7 → Table 13; all items and the bill move; the kitchen's slip
  function movePop(units) {
    const [p, q] = units, src = p?.order ? p : q, dst = p?.order ? q : p;
    if (units.length !== 2 || !src?.order || !dst || dst.order || dst.join) return null;
    return mmPopOf(mmTop('arrow-long', `Move ${unitWord(src)} to ${unitWord(dst)}?`),
      el('div', { class: 'fl-mmrow' }, mmCard(src, subOf(src)), el('i', { class: 'fl-mmar', 'aria-label': 'to' }, icon('arrow-long')), mmCard(dst, subOf(dst))),
      el('p', { class: 'fl-card fl-mminfo' }, `All items and the bill move to ${unitWord(dst)}.`,
        src.order.sent ? [' The kitchen gets a slip: ', el('b', {}, `${unitWord(src)} moved to ${unitWord(dst)} · all items`), '.'] : ''),
      mmBtns('arrow-long', 'Move table', () => doMove(src, dst)));
  }
  // Merge (MM3b): "Merge 3 tables?" a card for each pick; one bill, what it will be, on the first table; the slip
  function mergePop(units) {
    if (units.length < 2) return null;
    const pv = window.RestroCounter?.mergePreview?.(units.map(u => (u.order?.uid ? { uid: u.order.uid } : { tables: u.tables }))) || {};
    const all = pv.tables?.length ? pv.tables : units.flatMap(u => u.tables), firstArea = tableById.get(units[0].key)?.area, first = `Table ${tableName(all[0])}`;
    const info = pv.orders
      ? ['All orders go on ', el('b', {}, 'one bill'), ` · ${money(pv.due)} due, on `, el('b', {}, first), ' (the first table).', pv.sent ? [' The kitchen gets a slip: ', el('b', {}, `Table ${all.map(tableName).join(' + ')} merged`), '.'] : '', ' Paying separately? Split it in the Pay screen.']
      : ['These tables become one, with ', el('b', {}, 'one bill'), ' on ', el('b', {}, first), ' (the first table).'];
    return mmPopOf(mmTop('merge', `Merge ${all.length} tables?`),
      el('div', { class: 'fl-mmgrid' }, ...units.map(u => mmCard(u, subOf(u, tableById.get(u.key)?.area !== firstArea)))),
      el('p', { class: 'fl-card fl-mminfo' }, ...info),
      mmBtns('merge', `Merge ${all.length} tables`, () => doMerge(units)));
  }
  // Unmerge (MM6b): the first table keeps the bill, the others become free; Move items is how dishes go across
  function unmergePop(units) {
    const u = units[0]; if (units.length !== 1 || u.tables.length < 2) return null;
    const keep = u.tables[0], rest = u.tables.slice(1), restWord = `Table ${rest.map(tableName).join(' + ')}`, o = u.order;
    const keepSub = o ? ['Keeps the bill', o.paidQr ? 'Paid by QR' : `${money(o.due)} due`, o.guests ? guestsWord(o.guests) : ''].filter(Boolean).join(' · ') : `Free · ${tableById.get(keep)?.seats || 0} seats`;
    return mmPopOf(mmTop('merge', `Unmerge ${unitWord(u)}?`),
      el('div', { class: 'fl-mmrow' }, mmCard(u, keepSub, `Table ${tableName(keep)}`, el('i', { class: `fl-tchip ${o ? (u.s.kind === 'bill' ? 'bill' : 'occ') : 'free'}` }, tableName(keep))),
        el('i', { class: 'fl-mmbar', 'aria-hidden': 'true' }),
        mmCard(u, rest.length > 1 ? 'Become free' : 'Becomes free', restWord, el('i', { class: `fl-tchip free${rest.length > 1 ? ' wide' : ''}` }, rest.map(tableName).join(' + ')))),
      o ? el('p', { class: 'fl-card fl-mminfo' }, `To put some items on ${restWord}, use `, el('b', {}, 'Move items'), ' in the Counter after unmerging.') : null,
      mmBtns('merge', 'Unmerge', () => doUnmerge(u)));
  }
  // Move items (CM8): "Move 7 items to Table 13?" what stays here, the table they go to, the dishes, and whether they
  // start a new order there or join its bill (never a second order on a table)
  function itemsPop(L) {
    const to = mm.to ? unitOf(mm.to, L) : null, src = unitOf(mm.from, L); if (!to || !src) return null;
    const pv = mm.items.preview?.(to.key); if (!pv) return null;
    const n = mm.items.count, items = `${n} item${n === 1 ? '' : 's'}`;
    const info = pv.dest ? ['These items are added to ', el('b', {}, `${unitWord(to)}’s existing bill`), ` · new due ${money(pv.due)}.`] : [`${unitWord(to)} gets a new order for these items · ${money(pv.due)} due with GST.`];
    if (pv.sent) info.push(' The kitchen gets a slip: ', el('b', {}, `Items moved · ${unitWord(src)} → ${unitWord(to)}`), '.');
    return mmPopOf(mmTop('arrow-long', `Move ${items} to ${unitWord(to)}?`),
      el('div', { class: 'fl-mmrow' }, mmCard(src, `Keeps ${pv.keepItems} item${pv.keepItems === 1 ? '' : 's'} · ${money(pv.keepDue)} due`), el('i', { class: 'fl-mmar', 'aria-label': 'to' }, icon('arrow-long')), mmCard(to, subOf(to))),
      el('div', { class: 'fl-mmlist' }, ...mm.items.dishes.map(d => el('div', {}, el('b', {}, `${d.qty} ×`), el('span', {}, d.name), el('b', {}, money(d.amount))))),
      el('p', { class: 'fl-card fl-mminfo' }, ...info),
      mmBtns('arrow-long', `Move ${items}`, () => doItems(to)));
  }

  // ---------- doing it ----------
  // Done: the Floor (or the Counter, when it came from there) shows it, with the toast ("Table 7 moved to Table 13 ·
  // kitchen slip printed"); a slip that didn't print: the Counter's printer error, with Retry
  async function doMove(src, dst) {
    const words = `${unitWord(src)} moved to ${unitWord(dst)}`; mmPop = null; render();
    const r = await window.RestroCounter?.mmMove?.(src.order.uid, dst.key);
    finish(r, words);
  }
  async function doMerge(units) {
    const tables = units.flatMap(u => u.tables).map(tableName), words = `Tables ${tables.length > 1 ? `${tables.slice(0, -1).join(', ')} and ${tables[tables.length - 1]}` : tables[0]} merged`;
    mmPop = null; render();
    const r = await window.RestroCounter?.mmMerge?.(units.map(u => (u.order?.uid ? { uid: u.order.uid } : { tables: u.tables })));
    finish(r, words);
  }
  function doUnmerge(u) {
    const names = u.tables.map(tableName), words = `Tables ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} unmerged`;
    mmPop = null;
    finish(window.RestroCounter?.mmUnmerge?.(u.order?.uid ? { uid: u.order.uid } : { join: u.join?.id }), words);
  }
  async function doItems(to) {
    const items = mm.items; mmPop = null; render();
    const r = await items.apply?.(to.key);
    const n = r?.count || items.count;
    if (!r?.ok) { say(r?.why && r.why !== 'gone' ? r.why : 'The items couldn’t be moved · try again'); return; }
    close(); window.RestroCounter?.resume?.();
    tell(true, { b: `${n} item${n === 1 ? '' : 's'} moved to Table ${(r.to || [to.key]).map(tableName).join(' + ')}`, t: r.slip?.printed ? ' · kitchen slip printed' : '' }, r.slip);
  }
  function finish(r, words) {
    if (!r?.ok) { render(); say(r?.why === 'unsaved' ? { b: 'Save the order on the Counter first' } : { b: 'Nothing was changed', t: ' · the tables changed meanwhile' }); return; }
    const counter = mm?.back === 'counter';
    if (counter) { close(); window.RestroCounter?.resume?.(); }
    else { mode = 'view'; mm = null; mmPop = null; render(); }
    tell(counter, { b: words, t: r.slip?.printed ? ' · kitchen slip printed' : '' }, r.slip);
  }
  // (on the Counter, its message bar; on the Floor, its toast)
  function tell(counter, m, slip) {
    const failed = slip && !slip.printed ? { kind: 'error', b: 'Kitchen printer offline', t: ` · ${slip.what} not sent`, retry: () => slip.retry().then(x => { if (!x.printed) tell(counter, null, x); }) } : null;
    const show = x => (counter ? window.RestroCounter?.notice?.({ kind: x.kind || 'confirm', bold: x.b, text: x.t || '', retry: x.retry }) : say(x));
    if (failed) show(failed); else if (m) show(m);
  }

  // Long-press (E1): about half a second on a table, without moving, opens Move / Merge with it picked
  function longPress(box) {
    let timer = 0, start = null;
    const stop = () => { clearTimeout(timer); timer = 0; };
    box.addEventListener('pointerdown', e => {
      const node = e.target.closest('.fl-t'); if (!node || mode !== 'view' || pop || menuOpen) return;
      start = { x: e.clientX, y: e.clientY, id: node.dataset.id }; stop();
      timer = setTimeout(() => { timer = 0; longAt = Date.now(); startMM(start.id, 'floor'); }, 500);
    });
    box.addEventListener('pointermove', e => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) stop(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(type, stop);
    box.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------- pages: the arrows and a swipe ----------
  function turn(d) {
    const a = area(), p = pageNow(a) + d;
    if (p < 0 || p >= pagesOf(a)) return;
    pageOf[a.id] = p; render();
  }
  function swipes(box) {
    let down = null;
    box.addEventListener('pointerdown', e => { if (e.target.closest('.fl-arrow')) return; down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    box.addEventListener('pointerup', e => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = Date.now(); turn(dx < 0 ? 1 : -1); }
    });
    box.addEventListener('pointercancel', () => { down = null; });
  }
  let swiped = 0;

  // ---------- tapping a table ----------
  function tapTable(id, s) {
    if (Date.now() - swiped < 400 || Date.now() - longAt < 700) return;
    // (picking a table for the Counter's order: "Table 4 is reserved for ‹name›" · Cancel / Seat now; owner, 27 Nov 2026)
    if (s.kind === 'reserved') { pop = { kind: mode === 'pick' ? 'pickres' : 'reserved', id: s.booking.id, table: id }; render(); return; }
    if (s.order?.paidQr) { pop = { kind: 'qr', uid: s.order.uid, table: id }; render(); return; }
    if (mode === 'pick' && s.kind === 'free') { choose(s.join ? s.join.tables[0] : id, s.join); return; }
    if (s.order?.seated) { close(); openSeated(s.order); return; }
    close(); window.RestroCounter?.openTable(s.order?.tables?.[0] || s.join?.tables?.[0] || id);
  }
  // (a party seated with no order yet: the Counter on its tables, with its guests and who they are)
  function openSeated(o) {
    const h = o.seated;
    window.RestroCounter?.seatBooking?.({ table: o.tables[0], tables: o.tables, guests: o.guests, booking: h.kind === 'res' ? h.id : null,
      customer: h.phone ? { name: h.name, mobile: h.phone, code: h.code } : null }) || window.RestroCounter?.openTable(o.tables[0]);
  }
  // (a free merged group: its first table, the others with it)
  function choose(id, j = null) {
    const t = tableById.get(id), done = pick?.onPick;
    close();
    done?.({ id: t.id, name: t.name, seats: t.seats, joined: j ? j.tables.filter(x => x !== t.id) : [] });
  }

  // ---------- the menu (F02): the Counter menu's look; any tap outside closes it ----------
  function menuCard() {
    const B = window.RestroBookings, left = B?.leftToday?.() || 0;
    const row = (art, label, run, extra = null, cls = '') => el('button', { type: 'button', role: 'menuitem', class: `fl-mi ${cls}`.trim(), onclick: () => { menuOpen = false; run(); } }, el('span', { class: 'fl-mi-ic' }, art), el('span', { class: 'fl-mi-t' }, label), extra);
    return el('div', { class: 'fl-menu', role: 'menu', 'aria-label': 'Floor menu' },
      row(appArt('counter'), 'Counter', () => { close(); window.RestroCounter?.open(); }, null, 'app'),
      row(appArt('orders'), 'Orders', () => { close(); window.RestroOrders?.open(); }, null, 'app'),
      row(icon('calendar'), 'New reservation', () => window.RestroBookingsApp?.newReservation?.({ from: 'floor', floorFrom: from }), null, 'blue'),
      row(icon('calendar'), 'Reservations', () => window.RestroBookingsApp?.open?.({ tab: 'reservations', from: 'floor', floorFrom: from }), el('em', {}, String(left))),
      el('i', { class: 'fl-sep', role: 'separator' }),
      row(icon('layout-grid'), 'Edit layout', () => { render(); say({ b: 'Edit layout', t: ' · coming soon' }); }));
  }

  // ---------- the pop-ups (the Counter pop-up's look) ----------
  function popLayer(L, now) {
    const card = pop.kind === 'reserved' ? reservedCard(now, false) : pop.kind === 'late' ? reservedCard(now, true) : pop.kind === 'cancel' ? cancelCard()
      : pop.kind === 'qr' ? qrCard(L, now) : pop.kind === 'pickres' ? pickResCard(now) : null;
    if (!card) { pop = null; return el('span'); }
    return el('div', { class: 'fl-scrim', onclick: e => { if (e.target === e.currentTarget) closePop(); } }, card);
  }
  function closePop() { if (pop?.kind === 'late') window.RestroBookings?.lateSeen?.(pop.id); pop = null; render(); }
  const xBtn = () => el('button', { type: 'button', class: 'fl-x', 'aria-label': 'Close', onclick: closePop }, icon('x'));
  const sentBar = (msgs, kind) => { const m = [...(msgs || [])].reverse().find(x => x.kind === kind); return m ? el('i', { class: `fl-sent ${m.ok ? 'ok' : 'no'}`, 'aria-hidden': 'true' }) : null; };
  const popHead = (ic, cls, title, extra = null) => el('div', { class: 'fl-pop-h' }, el('i', { class: `fl-pop-ic ${cls}`.trim() }, ic), el('h3', { id: 'fl-pop-t' }, title), extra, xBtn());
  const phoneText = b => (b.phone ? `+${b.code || '91'} ${b.phone.slice(0, 5)} ${b.phone.slice(5)}` : '');
  const guestsText = n => `${n} guest${n === 1 ? '' : 's'}`;
  // Reserved table (F04): the time ("in 18 min"), the name, phone and guests; the note; Mode · Taken by · At; Cancel
  // reservation · Notify · Seat now. Running late (F07), by itself 15 minutes after the time: the same pop-up, the orange
  // "15 min late" chip, Cancel reservation · No-show · Seat now.
  function reservedCard(now, late) {
    const B = window.RestroBookings, r = B?.reservation(pop.id);
    if (!r || r.status !== 'upcoming') return null;
    const t = tableById.get(pop.table) || tableById.get(r.tables[0]), mins = Math.round((r.at - now) / MIN), lateBy = Math.max(0, Math.round((now - r.at) / MIN));
    const tablesWord = r.tables.map(tableName).join(' + ');
    const chip = late ? el('em', { class: 'fl-ochip' }, `${lateBy} min late`) : el('em', { class: 'fl-in-chip' }, mins > 0 ? `in ${mins} min` : mins === 0 ? 'now' : `${-mins} min ago`);
    const top = el('div', { class: 'fl-card fl-res-top' }, el('div', { class: 'fl-when' }, el('b', {}, clock(r.at)), chip), el('i', { class: 'fl-vr' }),
      el('div', { class: 'fl-who' }, el('b', {}, B.nameOf(r) || 'Guest'), el('span', {}, r.phone ? el('span', {}, icon('phone'), phoneText(r)) : null, el('span', {}, icon('chair'), guestsText(r.guests)))));
    const note = r.note ? el('div', { class: 'fl-card fl-note' }, el('i', { class: 'fl-note-ic' }, noteIcon()), el('div', {}, el('small', {}, 'Note'), el('b', {}, r.note))) : null;
    const meta = el('div', { class: 'fl-card fl-meta' },
      el('div', {}, el('small', {}, 'Mode'), el('b', {}, icon(r.how === 'walkin' ? 'walk' : 'phone'), r.how === 'walkin' ? 'Walk-in' : 'By phone')),
      el('div', {}, el('small', {}, 'Taken by'), el('b', {}, icon('user'), firstOf(r.by) || '—')),
      el('div', {}, el('small', {}, 'At'), el('b', {}, icon('clock'), clock(r.createdAt))));
    const cancel = el('button', { type: 'button', class: 'fl-btn red', onclick: () => { pop = { kind: 'cancel', id: r.id, table: pop.table, back: pop.kind }; render(); } }, icon('calendar-x'), 'Cancel reservation');
    const middle = late
      ? el('button', { type: 'button', class: 'fl-btn orange', onclick: () => { B.noShow(r.id); pop = null; render(); say({ b: `${firstOf(B.nameOf(r)) || 'Guest'} · no-show`, t: ` · Table ${tablesWord} is free` }); } }, 'No-show')
      : el('div', { class: 'fl-bwrap' }, el('button', { type: 'button', class: 'fl-btn blue', disabled: !r.phone, 'aria-label': r.phone ? `Notify ${B.nameOf(r)}` : 'Notify: no phone number', onclick: () => notifyRes(r.id) }, icon('send-horizontal'), 'Notify'), sentBar(r.msgs, 'notify'));
    const seat = el('button', { type: 'button', class: 'fl-btn solid', onclick: () => seatRes(r) }, icon('armchair'), 'Seat now');
    return el('div', { class: `fl-pop res${late ? ' late' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-pop-t' },
      popHead(icon(late ? 'clock' : 'calendar'), late ? 'orange' : '', `Table ${t ? t.name : tablesWord} · ${late ? 'Running late' : 'Reserved'}`),
      top, note, meta, el('div', { class: 'fl-btns three' }, cancel, middle, seat));
  }
  // (owner, 27 Nov 2026) A reserved table picked for the Counter's order: "Table 4 is reserved for ‹name›", the booking
  // as F04 shows it (the time, the name, phone and guests; the note), then Cancel (the pick only: back to the tables) and
  // Seat now (the order on the Counter takes the booking's tables, its guests and its customer; the booking is seated)
  function pickResCard(now) {
    const B = window.RestroBookings, r = B?.reservation(pop.id);
    if (!r || r.status !== 'upcoming') return null;
    const t = tableById.get(pop.table) || tableById.get(r.tables[0]), mins = Math.round((r.at - now) / MIN), name = B.nameOf(r) || 'a guest';
    const chip = mins < -14 ? el('em', { class: 'fl-ochip' }, `${-mins} min late`) : el('em', { class: 'fl-in-chip' }, mins > 0 ? `in ${mins} min` : mins === 0 ? 'now' : `${-mins} min ago`);
    const top = el('div', { class: 'fl-card fl-res-top' }, el('div', { class: 'fl-when' }, el('b', {}, clock(r.at)), chip), el('i', { class: 'fl-vr' }),
      el('div', { class: 'fl-who' }, el('b', {}, B.nameOf(r) || 'Guest'), el('span', {}, r.phone ? el('span', {}, icon('phone'), phoneText(r)) : null, el('span', {}, icon('chair'), guestsText(r.guests)))));
    const note = r.note ? el('div', { class: 'fl-card fl-note' }, el('i', { class: 'fl-note-ic' }, noteIcon()), el('div', {}, el('small', {}, 'Note'), el('b', {}, r.note))) : null;
    return el('div', { class: 'fl-pop res pick', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-pop-t' },
      popHead(icon('calendar'), '', `Table ${t ? t.name : r.tables.map(tableName).join(' + ')} is reserved for ${name}`),
      top, note,
      el('div', { class: 'fl-btns two' },
        el('button', { type: 'button', class: 'fl-btn white', onclick: closePop }, 'Cancel'),
        el('button', { type: 'button', class: 'fl-btn solid', onclick: () => seatPicked(r) }, icon('armchair'), 'Seat now')));
  }
  function seatPicked(r) {
    const table = pop.table && r.tables.includes(pop.table) ? pop.table : r.tables[0], t = tableById.get(table), done = pick?.onPick;
    pop = null; close();
    done?.({ id: t.id, name: t.name, seats: t.seats, joined: r.tables.filter(x => x !== t.id), guests: r.guests,
      booking: { id: r.id, customer: r.phone ? { name: window.RestroBookings.nameOf(r), mobile: r.phone, code: r.code } : null } });
  }
  function noteIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<path d="M5.5 3.5h13a2 2 0 0 1 2 2v9l-6 6h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M14.5 20.5v-4a2 2 0 0 1 2-2h4"/><path d="M7.5 8.5h9M7.5 12h6"/>'; return s;
  }
  async function notifyRes(id) {
    const r = await window.RestroBookings?.message('notify', id);
    if (r?.none) say('Messages go through the RESTRO Android app');
    render();
  }
  function seatRes(r) {
    const table = pop.table && r.tables.includes(pop.table) ? pop.table : r.tables[0];
    pop = null; close();
    window.RestroCounter?.seatBooking?.({ table, tables: r.tables, guests: r.guests, booking: r.id, customer: r.phone ? { name: window.RestroBookings.nameOf(r), mobile: r.phone, code: r.code } : null })
      || window.RestroCounter?.openTable(table);
  }
  // Cancel reservation (F05): Keep it · Cancel reservation (red); the table turns free and the area's badge goes
  function cancelCard() {
    const B = window.RestroBookings, r = B?.reservation(pop.id); if (!r) return null;
    const name = B.nameOf(r) || 'Guest', words = r.tables.map(tableName).join(' + ');
    return el('div', { class: 'fl-pop confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-pop-t' },
      popHead(icon('calendar-x'), 'red', `Cancel ${firstOf(name)}’s reservation?`),
      el('div', { class: 'fl-card fl-sum' }, el('i', { class: 'fl-tno' }, words), el('div', {}, el('b', {}, `${name} · ${clock(r.at)}`), el('small', {}, `Table ${words} · ${guestsText(r.guests)} · ${r.how === 'walkin' ? 'walk-in' : 'by phone'}`))),
      el('p', { class: 'fl-warn' }, `Table ${words} turns `, el('b', {}, 'free'), ' and the booking is removed from Reservations. This can’t be undone.'),
      el('div', { class: 'fl-btns two' },
        el('button', { type: 'button', class: 'fl-btn white', onclick: () => { pop = { kind: pop.back || 'reserved', id: r.id, table: pop.table }; render(); } }, 'Keep it'),
        el('button', { type: 'button', class: 'fl-btn danger', onclick: () => { B.cancel(r.id); pop = null; render(); say({ b: `${firstOf(name)}’s reservation cancelled`, t: ` · Table ${words} is free` }); } }, icon('trash'), 'Cancel reservation')));
  }
  // Paid by QR (F06): "Is the QR party still at the table?" Guests · Paid · Due; when it frees itself if nobody answers;
  // Free (the table turns white) · Still here (the Counter, a new order at that table). The paid order stays in the paid
  // orders.
  function qrCard(L, now) {
    const o = L.orders.find(x => x.uid === pop.uid); if (!o) return null;
    const t = tableById.get(pop.table), words = o.label || (t ? t.name : ''), info = window.RestroCounter?.paidInfo?.(o.uid) || {};
    const left = o.freeAt ? Math.max(0, Math.round((o.freeAt - now) / MIN)) : null, span = o.freeAt ? Math.max(1, o.freeAt - (info.doneAt || info.lastAt || o.at)) : 1;
    const done = o.freeAt ? Math.min(1, Math.max(0, 1 - (o.freeAt - now) / span)) : 0;
    return el('div', { class: 'fl-pop confirm qr', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-pop-t' },
      popHead(qrIcon(), 'blue', `Table ${words} · Paid by QR`),
      el('div', { class: 'fl-card fl-ask' }, el('b', {}, 'Is the QR party still at the table?'), el('span', {}, 'They ordered and paid on their phone.')),
      el('div', { class: 'fl-card fl-meta big' },
        el('div', {}, el('small', {}, 'Guests'), el('b', {}, icon('chair'), String(o.guests || '—'))),
        el('div', {}, el('small', {}, `Paid${info.method ? ` · ${info.method}` : ''}`), el('b', {}, money(o.total)), info.paidAt ? el('span', {}, `at ${clock(info.paidAt)}`) : null),
        el('div', {}, el('small', {}, 'Due'), el('b', { class: 'green' }, '₹0'), el('span', {}, 'Nothing due'))),
      o.freeAt ? el('div', { class: 'fl-card fl-frees' }, el('i', { class: 'fl-frees-ic' }, icon('clock')),
        el('div', {}, el('b', {}, `Frees itself at ${clock(o.freeAt)}`), el('span', {}, `if nobody answers · ${info.doneAt ? '15 min after the kitchen finished the order' : '30 min after the last order'}`),
          el('i', { class: 'fl-track' }, el('i', { style: `width:${(done * 100).toFixed(1)}%` }))), el('em', {}, `${left} min left`)) : null,
      el('div', { class: 'fl-btns two' },
        el('button', { type: 'button', class: 'fl-btn white tall', onclick: () => { window.RestroCounter?.freeTable?.(o.uid); pop = null; render(); say({ b: `Table ${words} is free` }); } },
          icon('circle-check'), el('span', { class: 'fl-b2' }, el('b', {}, 'Free'), el('small', {}, 'Release the table'))),
        el('button', { type: 'button', class: 'fl-btn solid tall', onclick: () => { const id = pop.table; pop = null; close(); window.RestroCounter?.openTable(id); } },
          icon('plus'), el('span', { class: 'fl-b2' }, el('b', {}, 'Still here'), el('small', {}, `New order for Table ${words}`)))));
  }
  function qrIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M14.5 14.5h2.5v2.5h-2.5zM20.5 13.5v7h-7"/>'; return s;
  }

  // Running late (F07): 15 minutes after a booking's time with no arrival, its pop-up opens by itself on the Floor
  function watchLate() {
    if (!dialog.open || pop || menuOpen || mode !== 'view') return;
    const r = (window.RestroBookings?.lateOnes?.() || []).find(x => !x.lateSeen);
    if (!r) return;
    const t = r.tables[0];
    if (tableById.get(t)?.area !== areaId) { areaId = tableById.get(t)?.area || areaId; pageOf[areaId] = tableById.get(t)?.page || 0; }
    pop = { kind: 'late', id: r.id, table: t }; render();
  }

  // ---------- the toast (A5: the Counter's toast, bottom centre just above the page dots) ----------
  // (an error, the Counter's: "Kitchen printer offline · TABLE MOVED slip not sent" with RETRY and ✕, until one is tapped)
  function say(m) {
    if (typeof m === 'string') m = { t: m };
    clearTimeout(toastTimer);
    const drop = () => { clearTimeout(toastTimer); toastNode?.remove(); toastNode = null; }, err = m.kind === 'error';
    toastNode = el('div', { class: `fl-toast${err ? ' err' : ''}`, role: err ? 'alert' : 'status' }, el('span', {}, m.b ? el('b', {}, m.b) : null, m.t || ''),
      m.undo ? el('button', { type: 'button', onclick: () => { drop(); m.undo(); } }, 'UNDO') : null,
      m.retry ? el('button', { type: 'button', onclick: () => { drop(); m.retry(); } }, 'RETRY') : null,
      err ? el('button', { type: 'button', class: 'x', 'aria-label': 'Dismiss', onclick: drop }, icon('x')) : null);
    root.querySelector('.fl-toast')?.remove(); root.append(toastNode);
    if (!err) toastTimer = setTimeout(() => { toastNode?.remove(); toastNode = null; }, m.undo ? 4000 : 2600);
  }

  // ---------- open, close, back ----------
  function close() { menuOpen = false; pop = null; if (dialog.open) dialog.close(); }
  function goBack() {
    if (!dialog.open) return false;
    if (pop) { closePop(); return true; }
    if (menuOpen) { menuOpen = false; render(); return true; }
    // (Move / Merge, Move items: the confirm pop-up first; then back to the Floor, or the Counter it came from, as it was)
    if (mmPop) { closeMMPop(); return true; }
    if ((mode === 'mm' || mode === 'items') && mm) {
      if (mm.back === 'counter') { close(); window.RestroCounter?.resume?.(); return true; }
      mode = 'view'; mm = null; render(); return true;
    }
    if (from === 'counter') { const picking = mode === 'pick'; close(); if (!picking) window.RestroCounter?.resume?.(); return true; }
    if (mode === 'reserve') { close(); return true; }
    return false;
  }
  dialog.addEventListener('cancel', e => { if (goBack()) e.preventDefault(); });
  dialog.addEventListener('close', () => { pick = null; res = null; chosen = []; menuOpen = false; pop = null; mm = null; mmPop = null; mode = 'view'; clearInterval(tick); clearTimeout(toastTimer); toastNode = null; });
  // (A1) the top bar, the lock or Recent apps close the menu or a pop-up, and only that
  window.addEventListener('restro:close-popups', () => { if (!dialog.open || (!pop && !menuOpen && !mmPop)) return; if (pop) closePop(); menuOpen = false; mmPop = null; render(); });
  window.addEventListener('restro:data-changed', () => { if (dialog.open) render(); });
  window.addEventListener('restro:bookings-changed', () => { if (dialog.open) render(); });
  window.addEventListener('restro:pager-docked', () => { if (dialog.open) render(); });

  window.RestroFloor = Object.freeze({
    // open() from the home screen; open({ pick: true, current, onPick(table) }) from the Counter's Table box (the Floor
    // with "‹ Counter": a free table goes on the order, a busy one opens its order); open({ from: 'counter' }).
    // open({ mm: { table } }): the Counter's Move / Merge tables, that order's table picked; open({ items: { from, uid,
    // count, dishes, preview(to), apply(to) } }): the Counter's Move items (E2, E3)
    open(options = {}) {
      // (picking a table for the Counter's order, or for a reservation: the Counter, or the reservation's form, stays
      // open under the Floor, and comes back once a table is picked or Back is tapped)
      const over = Boolean(options.pick || options.reserve);
      if (!over) document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      mode = options.reserve ? 'reserve' : options.pick ? 'pick' : options.items ? 'items' : options.mm ? 'mm' : 'view'; menuOpen = false; pop = null; mmPop = null;
      from = options.reserve ? 'form' : options.pick || options.from === 'counter' || options.mm || options.items ? 'counter' : 'home';
      mm = options.items ? { kind: 'items', back: 'counter', sel: [], from: options.items.from, uid: options.items.uid, to: null, items: options.items }
        : options.mm ? { kind: 'mm', back: 'counter', sel: [] } : null;
      pick = options.pick ? { current: options.current || null, onPick: typeof options.onPick === 'function' ? options.onPick : null } : null;
      res = options.reserve ? { ...options.reserve, onPick: typeof options.reserve.onPick === 'function' ? options.reserve.onPick : null } : null;
      chosen = res ? (res.tables || []).filter(id => tableById.has(id)) : [];
      const current = tableById.get(options.current || options.table || options.mm?.table || options.items?.from || chosen[0] || '') || (res?.area && areaById.get(res.area)?.tables[0]);
      if (current) { areaId = current.area; pageOf[current.area] = current.page; }
      // (Move / Merge from the Counter: its order's table, picked)
      if (mm?.kind === 'mm' && options.mm.table) { const u = unitOf(options.mm.table, live()); if (u && !cantPick(u)) mm.sel = [u.key]; }
      render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('#floor-title')?.focus({ preventScroll: true });
      clearInterval(tick); tick = setInterval(() => { if (!dialog.open) return; if (!pop && !menuOpen) render(); watchLate(); }, 30000);
      setTimeout(watchLate, 400);
      if (options.say) say(options.say);
    },
    say,
    // (the system's Back: a pop-up or the menu, then where the Floor was opened from; false: the system closes it)
    goBack,
    tableName,
    table: id => { const t = tableById.get(id); return t ? { ...t } : null; },
    areaOf: id => tableById.get(id)?.area || null,
    // (the area the Floor shows: Seat now looks there first)
    get area() { return areaId; },
    areas: () => areas.map(a => ({ id: a.id, name: a.name, tables: a.tables.map(t => ({ ...t })) })),
    get tables() { return tables.map(({ id, name, seats, area: a, shape, page, x, y, w, h }) => ({ id, name, seats, area: a, shape, page, x, y, w, h })); }
  });
})();
