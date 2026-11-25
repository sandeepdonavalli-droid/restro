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
  // mode: 'view' (the Floor), 'pick' (the Counter's Table box: the Floor, a free table goes on the order), and later
  // 'reserve' / 'seat' (bookings.js), 'mm' / 'items' (Move / Merge, Move items).
  let mode = 'view', from = 'home', pick = null, areaId = null, menuOpen = false, pop = null;
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
    for (const o of orders) {
      const calls = o.tables.flatMap(t => callsOn(t, now));
      const g = { ...o, calls, attention: Boolean(o.confirm) || calls.length > 0, label: o.tables.map(tableName).filter(Boolean).join(' + ') };
      groups.push(g);
      for (const t of o.tables) if (tableById.has(t) && !byTable.has(t)) byTable.set(t, g);
    }
    const state = new Map();
    for (const t of tables) {
      const o = byTable.get(t.id);
      if (o) { state.set(t.id, { kind: o.bill ? 'bill' : 'occupied', order: o, next: B?.nextOn?.(t.id, now) || null }); continue; }
      // (a Help bell from a table with no order yet: the table needs attention all the same)
      const r = B?.reservedOn?.(t.id, now), calls = callsOn(t.id, now);
      state.set(t.id, r ? { kind: 'reserved', booking: r, calls } : { kind: 'free', calls });
    }
    return { state, orders: groups.filter(g => g.tables.some(t => byTable.get(t) === g)) };
  }
  // Counts for an area (all its pages): Free · Occupied · Bill printed · Reserved (one per table; a merged group spread
  // over several areas counts in every area it touches, all its tables), Needs attention (one per order, and one per table
  // with a Help bell request and no order), Guests now and Due here (one per order, in every area its tables touch).
  function countsOf(a, L) {
    const n = { free: 0, occupied: 0, bill: 0, reserved: 0, attention: 0, guests: 0, due: 0 }, here = new Set();
    for (const t of a.tables) { const s = L.state.get(t.id); n[s.kind] += 1; if (s.order) here.add(s.order); else if (s.calls?.length) n.attention += 1; }
    for (const o of L.orders) if (o.tables.some(id => tableById.get(id)?.area === a.id)) here.add(o);
    for (const o of here) {
      n.guests += o.guests || 0; n.due += o.due || 0; if (o.attention) n.attention += 1;
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
  const callsOn = (table, now) => requests.filter(r => r.table === table && (Number(r.at) || 0) > now - 3 * 60 * MIN).map(r => ({ id: r.id, kind: r.kind, label: REQ_WORDS[r.kind] || 'Help' }));
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
      el('button', { type: 'button', class: 'fl-wait', onclick: () => window.RestroBookingsApp?.open({ tab: 'waitlist', from: 'floor' }) },
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
  function canvas(a, L, now) {
    const page = pageNow(a), pages = pagesOf(a);
    const drawn = new Set(), tiles = [];
    for (const t of a.tables.filter(x => x.page === page)) {
      if (drawn.has(t.id)) continue;
      const s = L.state.get(t.id);
      // a merged group: its tables side by side on this page are one tile
      if (s.order && s.order.tables.length > 1) {
        const here = s.order.tables.map(id => tableById.get(id)).filter(x => x && x.area === a.id && x.page === page);
        const row = sideBySide(here);
        if (row) { row.forEach(x => drawn.add(x.id)); tiles.push(tile(row, s, now)); continue; }
      }
      drawn.add(t.id); tiles.push(tile([t], s, now));
    }
    const arrows = [page > 0 ? el('button', { type: 'button', class: 'fl-arrow l', 'aria-label': 'Previous page', onclick: () => turn(-1) }, icon('chevron-left')) : null,
      page < pages - 1 ? el('button', { type: 'button', class: 'fl-arrow r', 'aria-label': 'Next page', onclick: () => turn(1) }, icon('chevron-right')) : null];
    const box = el('div', { class: 'fl-canvas' }, ...tiles, ...arrows);
    swipes(box);
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
  function tile(group, s, now) {
    const x = Math.min(...group.map(t => t.x)), y = Math.min(...group.map(t => t.y)), w = Math.max(...group.map(t => t.x + t.w)) - x, h = Math.max(...group.map(t => t.y + t.h)) - y;
    const shape = group.length > 1 ? 'rect' : group[0].shape, o = s.order, kind = s.kind, t0 = group[0];
    const calls = o ? o.calls : s.calls || [], attention = o ? o.attention : calls.length > 0;
    const cls = ['fl-t', shape, kind, attention ? 'attn' : '', o?.paidQr ? 'qr' : ''].filter(Boolean).join(' ');
    const lines = [];
    const number = o && o.tables.length > 1 ? o.label : t0.name;
    lines.push(el('b', { class: o && o.tables.length > 1 ? 'fl-no join' : 'fl-no' }, number));
    if (kind === 'free') lines.push(el('span', { class: 'fl-ln seat' }, icon('chair'), String(t0.seats)));
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
    if (o?.server) tags.push(el('i', { class: 'fl-srv' }, initials(o.server)));
    if (calls.length) tags.push(el('i', { class: 'fl-call' }, icon('bell'), calls[0].label));
    if (s.next && kind !== 'reserved') tags.push(el('i', { class: 'fl-next' }, icon('calendar'), `Next ${clock(s.next.at)} · ${s.next.first || 'Guest'}`));
    const label = `Table ${number}, ${{ free: 'free', occupied: 'occupied', bill: 'bill printed', reserved: 'reserved' }[kind]}`;
    return el('button', { type: 'button', class: cls, 'data-id': t0.id, 'aria-label': label,
      style: `left:${fu(x)};top:${fu(y)};width:${fu(w)};height:${fu(h)}`, onclick: () => tapTable(t0.id, s) },
    el('span', { class: 'fl-in' }, ...lines), ...tags);
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
    if (Date.now() - swiped < 400) return;
    if (s.kind === 'reserved') { pop = { kind: 'reserved', id: s.booking.id, table: id }; render(); return; }
    if (s.order?.paidQr) { pop = { kind: 'qr', uid: s.order.uid, table: id }; render(); return; }
    if (mode === 'pick' && s.kind === 'free') { choose(id); return; }
    close(); window.RestroCounter?.openTable(id);
  }
  function choose(id) {
    const t = tableById.get(id), done = pick?.onPick;
    close();
    done?.({ id: t.id, name: t.name, seats: t.seats });
  }

  // ---------- the menu (F02): the Counter menu's look; any tap outside closes it ----------
  function menuCard() {
    const B = window.RestroBookings, left = B?.leftToday?.() || 0;
    const row = (art, label, run, extra = null, cls = '') => el('button', { type: 'button', role: 'menuitem', class: `fl-mi ${cls}`.trim(), onclick: () => { menuOpen = false; run(); } }, el('span', { class: 'fl-mi-ic' }, art), el('span', { class: 'fl-mi-t' }, label), extra);
    return el('div', { class: 'fl-menu', role: 'menu', 'aria-label': 'Floor menu' },
      row(appArt('counter'), 'Counter', () => { close(); window.RestroCounter?.open(); }, null, 'app'),
      row(appArt('orders'), 'Orders', () => { close(); window.RestroOrders?.open(); }, null, 'app'),
      row(icon('calendar'), 'New reservation', () => window.RestroBookingsApp?.newReservation({ from: 'floor' }), null, 'blue'),
      row(icon('calendar'), 'Reservations', () => window.RestroBookingsApp?.open({ tab: 'reservations', from: 'floor' }), el('em', {}, String(left))),
      el('i', { class: 'fl-sep', role: 'separator' }),
      row(icon('layout-grid'), 'Edit layout', () => { render(); say({ b: 'Edit layout', t: ' · coming soon' }); }));
  }

  // ---------- the pop-ups (the Counter pop-up's look) ----------
  function popLayer(L, now) {
    const card = pop.kind === 'reserved' ? reservedCard(now, false) : pop.kind === 'late' ? reservedCard(now, true) : pop.kind === 'cancel' ? cancelCard()
      : pop.kind === 'qr' ? qrCard(L, now) : null;
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
      el('div', {}, el('small', {}, 'Mode'), el('b', {}, icon(r.how === 'walkin' ? 'footprints' : 'phone'), r.how === 'walkin' ? 'Walk-in' : 'By phone')),
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
  function say(m) {
    if (typeof m === 'string') m = { t: m };
    clearTimeout(toastTimer);
    toastNode = el('div', { class: 'fl-toast', role: 'status' }, m.b ? el('b', {}, m.b) : null, m.t || '',
      m.undo ? el('button', { type: 'button', onclick: () => { clearTimeout(toastTimer); toastNode?.remove(); toastNode = null; m.undo(); } }, 'UNDO') : null);
    root.querySelector('.fl-toast')?.remove(); root.append(toastNode);
    toastTimer = setTimeout(() => { toastNode?.remove(); toastNode = null; }, m.undo ? 4000 : 2600);
  }

  // ---------- open, close, back ----------
  function close() { menuOpen = false; pop = null; if (dialog.open) dialog.close(); }
  function goBack() {
    if (!dialog.open) return false;
    if (pop) { closePop(); return true; }
    if (menuOpen) { menuOpen = false; render(); return true; }
    if (from === 'counter') { const picking = mode === 'pick'; close(); if (!picking) window.RestroCounter?.resume?.(); return true; }
    return false;
  }
  dialog.addEventListener('cancel', e => { if (goBack()) e.preventDefault(); });
  dialog.addEventListener('close', () => { pick = null; menuOpen = false; pop = null; mode = 'view'; clearInterval(tick); clearTimeout(toastTimer); toastNode = null; });
  // (A1) the top bar, the lock or Recent apps close the menu or a pop-up, and only that
  window.addEventListener('restro:close-popups', () => { if (!dialog.open || (!pop && !menuOpen)) return; if (pop) closePop(); menuOpen = false; render(); });
  window.addEventListener('restro:data-changed', () => { if (dialog.open) render(); });
  window.addEventListener('restro:bookings-changed', () => { if (dialog.open) render(); });
  window.addEventListener('restro:pager-docked', () => { if (dialog.open) render(); });

  window.RestroFloor = Object.freeze({
    // open() from the home screen; open({ pick: true, current, onPick(table) }) from the Counter's Table box (the Floor
    // with "‹ Counter": a free table goes on the order, a busy one opens its order); open({ from: 'counter' }).
    open(options = {}) {
      // (picking a table for the Counter's order: the Counter stays open under the Floor, and comes back once a table is
      // picked or Back is tapped)
      if (!options.pick) document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      mode = options.pick ? 'pick' : 'view'; menuOpen = false; pop = null;
      from = options.pick || options.from === 'counter' ? 'counter' : 'home';
      pick = options.pick ? { current: options.current || null, onPick: typeof options.onPick === 'function' ? options.onPick : null } : null;
      const current = tableById.get(options.current || options.table || '');
      if (current) { areaId = current.area; pageOf[current.area] = current.page; }
      render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('#floor-title')?.focus({ preventScroll: true });
      clearInterval(tick); tick = setInterval(() => { if (!dialog.open) return; if (!pop && !menuOpen) render(); watchLate(); }, 30000);
      setTimeout(watchLate, 400);
      if (options.say) say(options.say);
    },
    say,
    tableName,
    table: id => { const t = tableById.get(id); return t ? { ...t } : null; },
    areaOf: id => tableById.get(id)?.area || null,
    areas: () => areas.map(a => ({ id: a.id, name: a.name, tables: a.tables.map(t => ({ ...t })) })),
    get tables() { return tables.map(({ id, name, seats, area: a, shape, page }) => ({ id, name, seats, area: a, shape, page })); }
  });
})();
