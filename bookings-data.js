'use strict';
// Bookings data (Update Pack 8, C and D): the reservations and the waitlist, their rules, and the messages they send.
// The screens are bookings.js (the Bookings app, New / Edit reservation, Add / Edit waitlist) and floor.js (Reserved
// tables, the area badges, Running late, Next booking).
//
// Kept on the tablet (restro.bookings.v1, restro.waitlist.v1), synced between the restaurant's tablets like the orders
// (sync.js, SYNC.md); customer data, so never part of the code or the website.
//
// Reservations (C1): a table shows Reserved from 1 hour before the booking; a booking locks its table from 1 hour before
// to 2 hours after its time, and no other booking can go on that table inside the lock (so two bookings on one table are
// at least 2 hours apart). A reservation always has a table. Upcoming → Seated → Completed (its bill paid, the table
// freed); or Cancelled / No-show. The area's pill on the Floor shows a calendar badge from 30 minutes before until the
// party is seated or the booking cancelled; 15 minutes after the time with no arrival it is Running late.
// Waitlist (D): name alone is enough (phone and pager optional). Waiting → Notified → Seated / Left / No-show; Remove asks
// No-show or Left and can be undone (Put back); the pager frees when it is docked.
// Messages (A3, A4): Notify sends at once, on the restaurant's channel; the booking confirmation as soon as a reservation
// is saved, a reminder 1 hour before it, and "added to waitlist" go by themselves. Each one is kept on its booking
// (`msgs`: { kind, ok, at, ch }) for the Messages line.
(() => {
  const RES_KEY = 'restro.bookings.v1', WAIT_KEY = 'restro.waitlist.v1';
  const MIN = 60000, HOUR = 60 * MIN;
  const RULES = Object.freeze({ reservedFrom: HOUR, lockBefore: HOUR, lockAfter: 2 * HOUR, badgeFrom: 30 * MIN, lateAfter: 15 * MIN, reminder: HOUR, notifiedFlag: 15 * MIN });
  const RES_STATUS = ['upcoming', 'seated', 'completed', 'cancelled', 'noshow'], WAIT_STATUS = ['waiting', 'notified', 'seated', 'left', 'noshow'];
  const MSG_KINDS = ['confirm', 'reminder', 'notify', 'added', 'buzz'];

  const load = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const store = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch {} window.RestroSync?.wrote(key); changed(); };
  const newId = p => window.RestroSync?.newId?.(p) || `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const int = (v, lo, hi, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const time = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const digits = v => String(v ?? '').replace(/\D/g, '').slice(-10);
  const cleanMsgs = list => (Array.isArray(list) ? list : []).filter(m => m && MSG_KINDS.includes(m.kind)).map(m => ({ kind: m.kind, ok: m.ok === true, at: time(m.at) || 0, ch: m.ch === 'whatsapp' ? 'whatsapp' : m.ch === 'sms' ? 'sms' : m.ch === 'pager' ? 'pager' : null })).slice(-30);
  const cleanTables = v => (Array.isArray(v) ? v : []).filter(t => typeof t === 'string' && t).filter((t, i, a) => a.indexOf(t) === i).slice(0, 12);
  function cleanRes(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !time(r.at)) return null;
    return { id: r.id, first: text(r.first, 40), last: text(r.last, 40), phone: digits(r.phone), code: /^\d{1,3}$/.test(String(r.code || '')) ? String(r.code) : '91',
      how: r.how === 'walkin' ? 'walkin' : 'phone', guests: int(r.guests, 1, 99, 2), at: time(r.at), tables: cleanTables(r.tables), note: text(r.note, 200),
      pager: int(r.pager, 0, 999), pagerAt: time(r.pagerAt), pagerBackAt: time(r.pagerBackAt), status: RES_STATUS.includes(r.status) ? r.status : 'upcoming',
      createdAt: time(r.createdAt) || Date.now(), by: text(r.by, 60) || null, prepaid: int(r.prepaid, 0, 1e9), msgs: cleanMsgs(r.msgs),
      seatedAt: time(r.seatedAt), orderUid: typeof r.orderUid === 'string' ? r.orderUid : null, statusAt: time(r.statusAt), statusBy: text(r.statusBy, 60) || null,
      remindedAt: time(r.remindedAt), lateSeen: time(r.lateSeen), editedAt: time(r.editedAt), editedBy: text(r.editedBy, 60) || null };
  }
  function cleanWait(w) {
    if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !time(w.addedAt)) return null;
    return { id: w.id, first: text(w.first, 40), last: text(w.last, 40), phone: digits(w.phone), code: /^\d{1,3}$/.test(String(w.code || '')) ? String(w.code) : '91',
      guests: int(w.guests, 1, 99, 2), quote: int(w.quote, 1, 240, 30), area: typeof w.area === 'string' && w.area ? w.area : 'any', note: text(w.note, 200),
      pager: int(w.pager, 0, 999), pagerAt: time(w.pagerAt), pagerBackAt: time(w.pagerBackAt), addedAt: time(w.addedAt), by: text(w.by, 60) || null,
      status: WAIT_STATUS.includes(w.status) ? w.status : 'waiting', notifiedAt: time(w.notifiedAt), msgs: cleanMsgs(w.msgs), seatedAt: time(w.seatedAt),
      tables: cleanTables(w.tables), removedAt: time(w.removedAt), removedBy: text(w.removedBy, 60) || null, wasStatus: WAIT_STATUS.includes(w.wasStatus) ? w.wasStatus : null };
  }
  let res = load(RES_KEY).map(cleanRes).filter(Boolean), wait = load(WAIT_KEY).map(cleanWait).filter(Boolean);
  const saveRes = () => store(RES_KEY, res), saveWait = () => store(WAIT_KEY, wait);
  function changed() { window.dispatchEvent(new CustomEvent('restro:bookings-changed')); }
  window.addEventListener('restro:data-changed', e => {
    const c = e.detail?.collections || [];
    if (c.includes('bookings')) res = load(RES_KEY).map(cleanRes).filter(Boolean);
    if (c.includes('waitlist')) wait = load(WAIT_KEY).map(cleanWait).filter(Boolean);
    if (c.includes('bookings') || c.includes('waitlist')) changed();
  });
  const copy = x => (x ? JSON.parse(JSON.stringify(x)) : null);
  const staff = () => window.RestroStaff?.current?.name || null;
  const nameOf = b => [b.first, b.last].filter(Boolean).join(' ');
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  // ---------- reservations: the rules ----------
  const active = r => r.status === 'upcoming';
  // A table's booking lock: from 1 hour before to 2 hours after the booking's time
  const locks = (r, t) => active(r) && t >= r.at - RULES.lockBefore && t <= r.at + RULES.lockAfter;
  // Can a booking at `at` go on these tables? (the booking's own lock counts as free for itself: Edit, C4)
  // (two bookings on one table at least 2 hours apart: 7:00 PM + 9:00 PM is fine, 7:30 PM + 9:00 PM isn't)
  const clash = (a, b) => Math.abs(a - b) < 2 * HOUR;
  const tablesFree = (tables, at, except = null) => !res.some(r => r.id !== except && active(r) && r.tables.some(t => tables.includes(t)) && clash(r.at, at));
  const bookedAt = (table, at, except = null) => res.find(r => r.id !== except && active(r) && r.tables.includes(table) && clash(r.at, at)) || null;
  // The upcoming booking that makes a free table show Reserved now (from 1 hour before, until seated or cancelled)
  const reservedOn = (table, now = Date.now()) => res.filter(r => active(r) && r.tables.includes(table) && r.at - now <= RULES.reservedFrom).sort((a, b) => a.at - b.at)[0] || null;
  // The next booking on a table within the hour (an occupied table's "Next 9:00 PM · ‹first name›" tag)
  const nextOn = (table, now = Date.now()) => res.filter(r => active(r) && r.tables.includes(table) && r.at >= now - RULES.lateAfter * 4 && r.at - now <= HOUR).sort((a, b) => a.at - b.at)[0] || null;
  // Tables a booking locks within the next hour (Move / Merge can't pick them: E1)
  const lockedSoon = (table, now = Date.now()) => res.some(r => active(r) && r.tables.includes(table) && r.at - now <= RULES.reservedFrom && now <= r.at + RULES.lockAfter);
  // An area's badge: a booking there from 30 minutes before until it is seated or cancelled
  const badgeOn = (tableIds, now = Date.now()) => res.some(r => active(r) && r.tables.some(t => tableIds.includes(t)) && r.at - now <= RULES.badgeFrom);
  const lateOnes = (now = Date.now()) => res.filter(r => active(r) && now - r.at >= RULES.lateAfter && sameDay(r.at, now));
  const leftToday = (now = Date.now()) => res.filter(r => active(r) && sameDay(r.at, now) && r.at + RULES.lateAfter > now - HOUR * 24).length;

  // ---------- tables for a booking (C2, C3) ----------
  // Each table of the floor plan as it is for a booking of `guests` at `at` (Edit: `except`, the booking itself, whose own
  // table counts as free for it): 'free'; 'booked' (another booking on it inside 2 hours of `at`: C1); and, for a booking
  // within the next 2 hours, who is at it now: 'maybe' (occupied, its bill already printed) or 'busy' (occupied). A
  // booking further out only looks at the bookings. fits: it seats the party on its own.
  // (lock: seating someone now, D B11: only a booking's lock holds a table, from 1 hour before it to 2 hours after: C1)
  const SOON = 2 * HOUR;
  function tablesFor({ at, guests, except = null, now = Date.now(), lock = false }) {
    const plan = window.RestroFloor?.tables || [], soon = at - now <= SOON, out = new Map(), held = new Map();
    if (soon) for (const o of window.RestroCounter?.floorOrders?.(now) || []) for (const t of o.tables) if (!held.has(t)) held.set(t, o);
    for (const t of plan) {
      const b = lock ? res.filter(r => r.id !== except && r.tables.includes(t.id) && locks(r, at)).sort((p, q) => p.at - q.at)[0] || null : bookedAt(t.id, at, except), o = held.get(t.id);
      const state = b ? 'booked' : o ? (o.bill ? 'maybe' : 'busy') : 'free';
      out.set(t.id, { ...t, state, booking: b ? copy(b) : null, order: o ? { tables: o.tables, at: o.at, bill: o.bill } : null, fits: t.seats >= guests });
    }
    return out;
  }
  // Tables that stand next to each other on the floor plan (the same page, at most 80 apart, side by side or one under
  // the other): the auto-pick joins only these (C2). Picked by hand on the Floor, any tables of one area join (C3).
  const NEAR = 80;
  const nextTo = (a, b) => a.area === b.area && a.page === b.page && (
    (Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w) <= NEAR && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)) ||
    (Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h) <= NEAR && Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)));
  // The fewest free tables next to each other that seat the party (then the fewest spare seats; then the floor plan's
  // order), up to 6 tables; or null
  function joinFor(list, guests) {
    const free = list.filter(t => t.state === 'free'), order = new Map(free.map((t, i) => [t.id, i]));
    let level = free.map(t => [t]);
    for (let k = 2; k <= 6 && level.length; k++) {
      const seen = new Set(), next = [];
      for (const set of level) for (const t of free) {
        if (set.includes(t) || !set.some(s => nextTo(s, t))) continue;
        const grown = [...set, t].sort((p, q) => order.get(p.id) - order.get(q.id)), key = grown.map(x => x.id).join('+');
        if (!seen.has(key)) { seen.add(key); next.push(grown); }
      }
      const ok = next.filter(s => s.reduce((n, t) => n + t.seats, 0) >= guests);
      if (ok.length) {
        const spare = s => s.reduce((n, t) => n + t.seats, 0) - guests;
        return ok.sort((p, q) => spare(p) - spare(q) || order.get(p[0].id) - order.get(q[0].id))[0];
      }
      if (next.length > 4000) break; // (a very large area: no further)
      level = next;
    }
    return null;
  }
  // An area for a booking: its tables that seat the party (free, maybe), and the auto-pick there (C2: an exact-fit free
  // table, else the closest single bigger one, else neighbouring free tables joined): { free, maybe, join (how many
  // tables), pick: { tables: [ids], kind: 'exact' | 'bigger' | 'join' } | null }
  function areaFor(areaId, all, guests) {
    const list = [...all.values()].filter(t => t.area === areaId);
    const free = list.filter(t => t.state === 'free' && t.fits), maybe = list.filter(t => t.state === 'maybe' && t.fits);
    const exact = free.find(t => t.seats === guests), bigger = [...free].sort((p, q) => p.seats - q.seats)[0];
    let pick = exact ? { tables: [exact.id], kind: 'exact' } : bigger ? { tables: [bigger.id], kind: 'bigger' } : null, join = 0;
    if (!pick) { const j = joinFor(list, guests); if (j) { join = j.length; pick = { tables: j.map(t => t.id), kind: 'join' }; } }
    return { id: areaId, free: free.length, maybe: maybe.length, join, pick, seats: pick ? pick.tables.reduce((n, id) => n + (all.get(id)?.seats || 0), 0) : 0 };
  }
  // The best area for a booking when none was chosen: an exact fit first (the floor plan's order of areas), else the
  // closest bigger single table, else the fewest tables joined (then the fewest spare seats)
  function bestArea(areas) {
    const withPick = areas.filter(a => a.pick);
    return withPick.find(a => a.pick.kind === 'exact')
      || withPick.filter(a => a.pick.kind === 'bigger').sort((p, q) => p.seats - q.seats)[0]
      || withPick.filter(a => a.pick.kind === 'join').sort((p, q) => p.join - q.join || p.seats - q.seats)[0] || null;
  }

  function saveReservation(input) {
    const now = Date.now(), was = input.id ? res.find(r => r.id === input.id) : null;
    const rec = cleanRes({ ...(was || {}), ...input, id: was ? was.id : newId('b'), createdAt: was ? was.createdAt : now, by: was ? was.by : staff(),
      status: was ? was.status : 'upcoming', ...(was ? { editedAt: now, editedBy: staff() } : {}) });
    if (!rec || !rec.tables.length) return null; // (C1: never without a table)
    if (was && (was.at !== rec.at)) { rec.remindedAt = null; rec.lateSeen = null; }
    res = was ? res.map(r => (r.id === was.id ? rec : r)) : [...res, rec];
    saveRes();
    if (!was && rec.phone) message('confirm', rec.id);
    return copy(rec);
  }
  function setRes(id, change) {
    const r = res.find(x => x.id === id); if (!r) return null;
    Object.assign(r, change, { statusAt: Date.now(), statusBy: staff() }); saveRes(); return copy(r);
  }
  const cancelRes = id => setRes(id, { status: 'cancelled' });
  const noShowRes = id => setRes(id, { status: 'noshow' });
  const seatRes = (id, orderUid = null, tables = null) => setRes(id, { status: 'seated', seatedAt: Date.now(), orderUid, ...(tables ? { tables: cleanTables(tables) } : {}) });
  // Seated → Completed once its order is paid (sweep)
  function sweep() {
    const orders = window.RestroCounter?.orders?.() || [];
    let n = 0;
    for (const r of res) {
      if (r.status !== 'seated') continue;
      // (the order it seated: kept on the order as `booking` once it is saved)
      const o = r.orderUid ? orders.find(x => (x.uid || `n${x.number}`) === r.orderUid) : orders.find(x => x.booking === r.id);
      if (o && !r.orderUid) { r.orderUid = o.uid || `n${o.number}`; n++; }
      if (o && o.paidAt) { r.status = 'completed'; r.statusAt = Date.parse(o.paidAt) || Date.now(); n++; }
    }
    if (n) saveRes();
  }

  // ---------- the waitlist ----------
  const waitingNow = (now = Date.now()) => wait.filter(w => (w.status === 'waiting' || w.status === 'notified') && sameDay(w.addedAt, now));
  function addWaiting(input) {
    const rec = cleanWait({ ...input, id: newId('w'), addedAt: Date.now(), by: staff(), status: 'waiting' });
    if (!rec || !(rec.first || rec.last)) return null;
    wait = [...wait, rec]; saveWait();
    if (rec.phone) message('added', rec.id);
    return copy(rec);
  }
  function editWaiting(id, input) {
    const w = wait.find(x => x.id === id); if (!w) return null;
    const rec = cleanWait({ ...w, ...input, id: w.id, addedAt: w.addedAt, by: w.by, status: w.status });
    wait = wait.map(x => (x.id === id ? rec : x)); saveWait(); return copy(rec);
  }
  const setWait = (id, change) => { const w = wait.find(x => x.id === id); if (!w) return null; Object.assign(w, change); saveWait(); return copy(w); };
  const removeWaiting = (id, why) => setWait(id, { wasStatus: wait.find(x => x.id === id)?.status || 'waiting', status: why === 'left' ? 'left' : 'noshow', removedAt: Date.now(), removedBy: staff() });
  const putBack = id => { const w = wait.find(x => x.id === id); if (!w) return null; return setWait(id, { status: w.wasStatus === 'notified' ? 'notified' : 'waiting', removedAt: null, removedBy: null, wasStatus: null }); };
  const seatWaiting = (id, tables, orderUid = null) => setWait(id, { status: 'seated', seatedAt: Date.now(), tables: cleanTables(tables), orderUid });
  // #N on the list: the order they were added in, among those still waiting
  const position = id => { const list = waitingNow().sort((a, b) => a.addedAt - b.addedAt); const i = list.findIndex(w => w.id === id); return i < 0 ? null : i + 1; };

  // ---------- pagers (A6: one pool for every app) ----------
  // Pagers out with a booking or a waitlist guest (not docked back yet)
  const pagersOut = () => [...res.filter(r => r.pager && !r.pagerBackAt && (active(r) || r.status === 'seated')), ...wait.filter(w => w.pager && !w.pagerBackAt && ['waiting', 'notified', 'seated', 'left', 'noshow'].includes(w.status))]
    .map(b => ({ n: b.pager, id: b.id, kind: b.addedAt ? 'wait' : 'res', name: nameOf(b) }));
  window.addEventListener('restro:pager-docked', e => {
    const n = Math.round(Number(e.detail?.number)); if (!n) return;
    let a = 0, b = 0;
    for (const r of res) if (r.pager === n && !r.pagerBackAt) { r.pagerBackAt = Date.now(); a++; }
    for (const w of wait) if (w.pager === n && !w.pagerBackAt) { w.pagerBackAt = Date.now(); b++; }
    if (a) saveRes(); if (b) saveWait();
  });
  // A pager given to an order, a booking or a waitlist guest is taken back from any booking still holding it
  function pagerTaken(n, keepId = null) {
    let a = 0, b = 0;
    for (const r of res) if (r.pager === n && !r.pagerBackAt && r.id !== keepId) { r.pagerBackAt = Date.now(); a++; }
    for (const w of wait) if (w.pager === n && !w.pagerBackAt && w.id !== keepId) { w.pagerBackAt = Date.now(); b++; }
    if (a) saveRes(); if (b) saveWait();
  }

  // ---------- messages (A3, A4) ----------
  // The channel: Settings › Orders' Order-ready message (until the Settings › Messages page is drawn; SMS unless WhatsApp
  // is picked), WhatsApp falling back to SMS ("If the number has no WhatsApp, send SMS instead", on by default).
  const channel = () => (window.RestroPrefs?.get?.('readyMessage')?.send === 'whatsapp' ? 'whatsapp' : 'sms');
  const shop = () => { const n = (localStorage.getItem('restro.restaurantName') || '').trim(); return n && n !== 'RESTAURANT NAME' ? n : ''; };
  const clock = t => { const d = new Date(t), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const dayWord = t => { const now = Date.now(); if (sameDay(t, now)) return 'today'; if (sameDay(t, now + 24 * HOUR)) return 'tomorrow'; const d = new Date(t); return `on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`; };
  // The default texts (A4: each place has a Default or a Custom template, chosen in Settings › Messages). Fill-ins:
  // {name} {time} {guests} {restaurant}.
  function textOf(kind, b) {
    const hi = b.first ? `Hi ${b.first}, ` : 'Hi, ', at = shop() ? ` at ${shop()}` : '', table = `your table for ${b.guests}${at}`;
    if (kind === 'confirm') return `${hi}${table} is booked for ${clock(b.at)} ${dayWord(b.at)}.`;
    if (kind === 'reminder') return `${hi}a reminder: ${table} is at ${clock(b.at)} today.`;
    if (kind === 'added') return `${hi}you're on the waitlist${at}. We'll message you as soon as your table is ready.`;
    return `${hi}your table${at} is ready. Please come to the front desk.`; // (Notify: a reservation or the waitlist)
  }
  const sendsHere = () => { const s = window.RestroSync?.status?.(); return !s || Boolean(s.device?.main) || !s.paired; };
  // → { ok, ch } once tried; { none } when this tablet can't send messages (they go through the RESTRO Android app)
  async function deliver(b, kind) {
    const dev = window.RESTRODevice, sms = typeof dev?.sms?.send === 'function', wa = typeof dev?.whatsapp?.send === 'function';
    if (!b.phone) return { none: true };
    if (!sms && !wa) return { none: true };
    const send = async how => { try { return (await (how === 'whatsapp' ? dev.whatsapp : dev.sms).send({ to: b.phone, code: b.code || '91', text: textOf(kind, b), booking: b.id })) !== false; } catch { return false; } };
    let ch = channel() === 'whatsapp' && wa ? 'whatsapp' : sms ? 'sms' : 'whatsapp', ok = await send(ch);
    if (!ok && ch === 'whatsapp' && sms) { ch = 'sms'; ok = await send('sms'); }
    return { ok, ch };
  }
  // Sends a booking's message now and keeps how it went. → { ok, none }
  async function message(kind, id) {
    const isWait = kind === 'added' || wait.some(w => w.id === id);
    const b = (isWait ? wait : res).find(x => x.id === id); if (!b) return { none: true };
    const r = await deliver(b, kind);
    if (r.none) return r;
    const now = Date.now(), cur = (isWait ? wait : res).find(x => x.id === id); if (!cur) return r;
    cur.msgs = [...cur.msgs, { kind, ok: r.ok, at: now, ch: r.ch }].slice(-30);
    if (kind === 'notify' && r.ok && isWait) { cur.status = cur.status === 'waiting' ? 'notified' : cur.status; cur.notifiedAt = now; }
    if (kind === 'reminder') cur.remindedAt = now;
    isWait ? saveWait() : saveRes();
    return r;
  }
  // Buzz a waitlist guest's pager (RESTRODevice.pager.buzz, as Orders' Buzz). → { ok, none }
  async function buzz(id) {
    const w = wait.find(x => x.id === id) || res.find(x => x.id === id); if (!w || !w.pager || w.pagerBackAt) return { none: true };
    const dev = window.RESTRODevice; if (typeof dev?.pager?.buzz !== 'function') return { none: true };
    let ok = false; try { ok = (await dev.pager.buzz(w.pager)) !== false; } catch {}
    const cur = wait.find(x => x.id === id) || res.find(x => x.id === id);
    if (cur) { cur.msgs = [...cur.msgs, { kind: 'buzz', ok, at: Date.now(), ch: 'pager' }].slice(-30); wait.includes(cur) ? saveWait() : saveRes(); }
    return { ok };
  }
  // The 1-hour reminder, by itself: once, from the main system (or a tablet on its own)
  let reminding = false;
  async function remind() {
    if (reminding || !sendsHere()) return;
    reminding = true;
    try {
      const now = Date.now();
      for (const r of res) if (active(r) && r.phone && !r.remindedAt && r.at - now <= RULES.reminder && r.at - now > 0 && r.createdAt < r.at - RULES.reminder) {
        r.remindedAt = now; saveRes(); await message('reminder', r.id);
      }
    } finally { reminding = false; }
  }
  setInterval(() => { sweep(); remind(); }, 30000); setTimeout(() => { sweep(); remind(); }, 4000);
  window.addEventListener('restro:data-changed', e => { if ((e.detail?.collections || []).includes('orders')) sweep(); });

  window.RestroBookings = Object.freeze({
    RULES,
    reservations: () => res.map(copy),
    reservation: id => copy(res.find(r => r.id === id)),
    waitlist: () => wait.map(copy),
    waiting: id => copy(wait.find(w => w.id === id)),
    nameOf, tablesFree, bookedAt, reservedOn: (t, now) => copy(reservedOn(t, now)), nextOn: (t, now) => copy(nextOn(t, now)), lockedSoon, badgeOn,
    tablesFor, areaFor, bestArea, nextTo, SOON,
    lateOnes: now => lateOnes(now).map(copy), leftToday, waitingNow: now => waitingNow(now).map(copy), position,
    saveReservation, cancel: cancelRes, noShow: noShowRes, seat: seatRes, lateSeen: id => { const r = res.find(x => x.id === id); if (r) { r.lateSeen = Date.now(); saveRes(); } },
    addWaiting, editWaiting, removeWaiting, putBack, seatWaiting,
    pagersOut, pagerTaken, message, buzz, textOf, channel
  });
})();
