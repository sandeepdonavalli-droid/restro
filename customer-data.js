'use strict';
// What the QR link's page (404.html) shows a customer (Update Pack 7): the restaurant's menu, its menu design (QR
// Studio › Menu design) and what's sold out, as the restaurant has them right now (owner, 18 Nov 2026: "the page has to
// read my menu").
// - From this browser's RESTRO, when RESTRO runs in this same browser for the same restaurant (the website's own
//   storage, as on the tablet's browser): read now, and again each time RESTRO changes it (watch), so it is live.
// - From the cloud's copy of the restaurant, once the cloud is connected (Phase 2, SYNC.md): on any customer's phone.
//   Not yet: until then a phone without RESTRO gets null.
// - null: the page shows B3's neutral page, "Our menu is coming soon. Please ask staff."; so does a restaurant that
//   hasn't picked a menu design yet (template null).
// RestroCustomerData.read(link) -> { restaurant, template, accent, logo, kind, place, event, eventMode, categories,
//   taxRate, kds, key, state, bill, business } | null
//   key: the QR's own name on this phone, its link ('‹restaurant›/T7-‹code›'), for what the phone keeps (its requests,
//   its orders)
//   state (Update Pack 7, G): { page: 'dead' | 'closed' | 'upcoming' | 'ended' } shows a message instead of the menu;
//   { paused: true } the menu with "QR ordering is paused"; null takes orders. A replaced or deleted QR is 'dead'
//   (Pack 5 I4); a restaurant QR follows the business hours (prefs.js: closed, a break, the weekly day off; after the
//   last order time, paused) and QR Studio's pause by hand (restro.qrOrdering.v1); an event's QRs its dates only.
//   bill (I3): a table's open order on the POS, { uid, number, total, paid, due (paise), rounds: [{ n, by, qr, at, lines:
//   [{ id, name, qty, price, veg, photo }] }], payments: [{ method, amount, at, ref }], guests, server, order }, or null;
//   order: the order as its receipt needs it (receipt.js, copy(): numbers, dishes and choices, sums, payments, prints),
//   so the phone's receipt is the one the POS prints
//   business: what a receipt prints at the top and bottom (Settings › Business details: address, phone, email, GSTIN,
//   FSSAI, the footer)
//   table, eventTable: a table QR's table and an event table QR's event table, by name ('7', '3')
//   link (404.html reads it from the address): { slug (the restaurant's part), kind: 'table' | 'takeaway' | 'menu' |
//   'event' (TK, MN, EV), table (a table QR's table, as T7), eventTable (an event table's, as E3), code }
//   kind and place as RestroCustomerPages.mount takes them: a whole event's QR is 'event' (eventMode 'both': Dine-in or
//   Takeaway; 'takeaway'), or 'menu' when it only shows the menu; an event table's is 'event-table'.
// RestroCustomerData.watch(fn): fn() whenever RESTRO, in another tab of this browser, changes what read() reads.
(() => {
  const KEYS = ['restro.restaurantName', 'restro.menuDesign.v1', 'restro.menu.availability.v1', 'restro.events.v1', 'restro.qr.v1', 'restro.qrOrdering.v1',
    'restro.hours.v1', 'restro.business.v1', 'restro.counter.orders.v1'];
  const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const json = key => { try { return JSON.parse(get(key) || 'null'); } catch { return null; } };
  // (the restaurant's part of a QR's link, as QR Studio makes it)
  const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'restaurant';
  const https = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

  // The menu, as RestroMenu has it, for a customer: each category's dishes with sold out marked (C4)
  function menuOf(soldOut, only) {
    const out = soldOut && typeof soldOut === 'object' ? soldOut : {};
    return (window.RestroMenu?.categories || []).map(c => ({ id: c.id, name: c.name, items: (c.items || []).filter(d => !only || only.has(d.id))
      .map(d => ({ id: d.id, name: d.name, desc: typeof d.desc === 'string' ? d.desc : '', about: typeof d.about === 'string' ? d.about : '', price: d.price, veg: d.veg, photo: https(d.photo), out: Boolean(out[d.id]) })) }))
      .filter(c => c.items.length);
  }
  // An event's menu (Update Pack 6, EV4): its dishes from the menu (at the event's price, when changed) and its own,
  // each in its category, with its own GST rate (gst, 0.18; D4); the event's own sold-out dishes too (EV12)
  function eventMenu(e, soldOut) {
    const items = new Map((Array.isArray(e.menu?.items) ? e.menu.items : []).map(i => (typeof i === 'string' ? [i, {}] : [i?.id, i || {}])).filter(([id]) => typeof id === 'string'));
    const own = (Array.isArray(e.menu?.own) ? e.menu.own : []).filter(d => d && typeof d.id === 'string');
    const off = { ...(soldOut || {}), ...(e.soldOut && typeof e.soldOut === 'object' ? e.soldOut : {}) };
    const cats = menuOf(off, new Set(items.keys())).map(c => ({ ...c, items: c.items.map(d => (Number.isFinite(items.get(d.id)?.price) ? { ...d, price: items.get(d.id).price } : d)) }));
    const gst = v => (v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) / 100 : undefined);
    const ownDish = d => ({ id: d.id, name: d.name, desc: '', about: '', price: d.price, veg: d.veg, photo: null, out: Boolean(off[d.id]), gst: gst(d.gst) });
    for (const c of window.RestroMenu?.categories || []) {
      const mine = own.filter(d => d.cat === c.id).map(ownDish);
      if (!mine.length) continue;
      const at = cats.find(x => x.id === c.id);
      if (at) at.items.push(...mine); else cats.push({ id: c.id, name: c.name, items: mine });
    }
    const lost = own.filter(d => !(window.RestroMenu?.categories || []).some(c => c.id === d.cat));
    if (lost.length) cats.push({ id: 'event-only', name: e.name || 'Event', items: lost.map(ownDish) });
    const order = (window.RestroMenu?.categories || []).map(c => c.id);
    return cats.sort((a, b) => (order.indexOf(a.id) + 1 || 1e3) - (order.indexOf(b.id) + 1 || 1e3));
  }

  // ---------- open, paused or closed (Update Pack 5 I1, I3, I4; Pack 6 D; Pack 7 G) ----------
  // A restaurant QR, by the business hours and QR Studio's pause, as QR Studio works it out (qr-studio.js, ordering()):
  // closed on the weekly day off, before opening, in a break and after closing (the page: "We're closed …" with when it
  // opens); paused after the last order time (before closing, and before a break) and while paused by hand; open when
  // turned on by hand after hours ("Stay open late"). Paused by itself (no path to a kitchen printer) needs the tablets'
  // own check: the cloud's copy will say so.
  function restaurantStatus(now = Date.now()) {
    const P = window.RestroPrefs; if (!P) return null;
    const v = json('restro.qrOrdering.v1') || {}, off = v.off && (v.off.until == null || v.off.until > now) ? v.off : null, late = v.late && (!v.late.until || v.late.until > now);
    if (off && off.until == null) return { paused: true };
    const key = P.businessDay(now), h = P.hoursOn(key), last = P.lastOrderOn(key), b = P.breakOn(key), lastB = P.lastOrderBreakOn(key);
    // (the next opening: the next business day open, or the end of the break)
    const nextOpen = () => { for (let i = 0; i < 8; i++) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); const hh = P.hoursOn(P.businessDay(d.getTime())); if (hh && hh.from > now) return hh.from; } return null; };
    let closed = null;
    if (!h) closed = { page: 'closed', why: 'weekly', opens: nextOpen() };
    else if (now < h.from) closed = { page: 'closed', why: 'after', opens: h.from };
    else if (b && now >= b.from && now < b.to) closed = { page: 'closed', why: 'break', opens: b.to };
    else if (now > h.to) closed = { page: 'closed', why: 'after', opens: nextOpen() };
    else if ((b && lastB != null && now >= lastB && now < b.from) || (last != null && now >= last)) closed = { paused: true };
    if (closed && !late) return closed;
    return off ? { paused: true } : null;
  }
  // An event's QR: its dates (it works only between its start and its end, even outside business hours); over several
  // days with set hours, between them it opens again later
  function eventStatus(e, now = Date.now()) {
    const end = Math.min(e.end, Number(e.endedAt) || Infinity);
    if (now >= end) return { page: 'ended', at: end };
    if (now < e.start) return { page: 'upcoming', at: e.start };
    if (e.daily) {
      const s = new Date(e.start), en = new Date(e.end), from = s.getHours() * 60 + s.getMinutes(), to = en.getHours() * 60 + en.getMinutes();
      const d = new Date(now), m = d.getHours() * 60 + d.getMinutes(), open = to > from ? m >= from && m < to : m >= from || m < to;
      if (!open) { const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (to > from && m >= to ? 1 : 0), 0, from).getTime(); return at < end ? { page: 'upcoming', at, again: true } : { page: 'ended', at: end }; }
    }
    return null;
  }

  // ---------- a table's open order on the POS (Update Pack 7, I1, I3) ----------
  // The order still due at that table (not paid; a QR order waiting for its payment doesn't count), round by round as it
  // went to the kitchen: each round's dishes, who sent it (a captain's or staff member's first name, or QR) and whether
  // it was paid as it went (a QR round)
  function tableBill(test) {
    const list = json('restro.counter.orders.v1'); if (!Array.isArray(list)) return null;
    const o = list.find(x => x && !x.paidAt && Array.isArray(x.lines) && Number.isFinite(x.total) && test(x) && !(x.qr === true && ['waiting', 'pending', 'refund'].includes(x.qrPay)));
    if (!o) return null;
    const paid = (Array.isArray(o.payments) ? o.payments : []).reduce((n, p) => n + (Number(p?.amount) || 0), 0);
    const line = id => o.lines.find(l => l.id === id) || {}, dish = id => (window.RestroMenu?.categories || []).flatMap(c => c.items || []).find(d => d.id === id);
    const kots = (Array.isArray(o.kots) ? o.kots : []).filter(k => k && (k.kind || 'kot') === 'kot' && Array.isArray(k.lines));
    const rounds = (kots.length ? kots : [{ at: o.createdAt, by: o.server || null, lines: o.lines }]).map((k, i) => ({ n: i + 1, by: k.qr === true ? 'QR' : String(k.by || o.server || '').trim().split(/\s+/)[0] || null, qr: k.qr === true, at: Number(k.at) || null,
      lines: k.lines.filter(l => l && Number(l.qty) > 0).map(l => ({ id: l.id, name: l.name || line(l.id).name || dish(l.id)?.name || 'Dish', qty: Number(l.qty), price: Number(line(l.id).price) || Number(dish(l.id)?.price) || 0, veg: dish(l.id)?.veg ?? line(l.id).ev?.veg ?? null, photo: https(dish(l.id)?.photo) })) }));
    const payments = (Array.isArray(o.payments) ? o.payments : []).filter(p => p && Number(p.amount) > 0).map(p => ({ method: String(p.method || ''), amount: Number(p.amount), at: Number(p.at) || null, ref: typeof p.ref === 'string' ? p.ref : '' }));
    // (the receipt's "Dine-in · Table 7 · 4 guests" and "Server: ‹first name›", the first name only; the order as the
    // receipt needs it, the POS's table names and choices as it prints them)
    return { uid: o.uid || `n${o.number}`, number: o.number, total: o.total, paid, due: Math.max(0, o.total - paid), rounds, payments,
      guests: Number(o.guests) > 0 ? Number(o.guests) : 0, server: String(o.server || '').trim().split(/\s+/)[0] || null,
      order: window.RestroReceipt?.copy(o, { tableName, modLabel }) || null };
  }
  // (a table's name as the POS prints it (floor.js), and a dish's choice ("Extra gravy +₹40", counter.js))
  const tableName = id => (window.RestroFloorPlan?.areas || []).flatMap(a => a.tables || []).find(t => t.id === id)?.name || '';
  const modLabel = id => {
    const g = (window.RestroMenu?.modifierGroups || []).find(x => (x.options || []).some(y => y.id === id)), x = g?.options.find(y => y.id === id);
    const price = Number(x?.price) || 0;
    return !x ? id : price && g.mode !== 'set' ? `${x.label} +₹${price.toLocaleString('en-IN')}` : x.label;
  };
  // (Settings › Business details, as the POS prints them: prefs.js, with its defaults)
  const business = () => {
    const b = window.RestroPrefs?.get('business') || json('restro.business.v1') || {};
    return { address: String(b.address || ''), phone: String(b.phone || ''), phoneCountry: String(b.phoneCountry || 'IN'), email: String(b.email || ''), gstin: String(b.gstin || ''), fssai: String(b.fssai || ''), footer: String(b.footer ?? 'Thank you! Visit again.') };
  };

  // From this browser's RESTRO: only for the same restaurant
  function local(link) {
    const name = get('restro.restaurantName');
    if (!name || slugOf(name) !== link.slug) return null;
    const design = json('restro.menuDesign.v1') || {}, soldOut = json('restro.menu.availability.v1')?.soldOut;
    const base = { restaurant: name.toLocaleUpperCase('en-IN'), template: typeof design.template === 'string' ? design.template : null,
      accent: /^#[0-9A-F]{6}$/i.test(design.accent || '') ? design.accent : null, logo: https(design.logo?.url), taxRate: Number(window.RestroMenu?.taxRate) || 0.05, kds: false,
      key: `${link.slug}/${link.kind === 'takeaway' ? 'TK' : link.kind === 'menu' ? 'MN' : link.eventTable ? `E${link.eventTable}` : link.kind === 'event' ? 'EV' : `T${link.table}`}-${link.code}`, business: business(), bill: null };
    const dead = { page: 'dead' };
    if (link.kind === 'event' || link.eventTable) {
      const events = Array.isArray(json('restro.events.v1')) ? json('restro.events.v1') : [];
      const e = link.eventTable ? events.find(x => x.qrs === 'tables' && (x.tables || []).some(t => t?.code === link.code))
        : events.find(x => x.qrs === 'whole' && x.code === link.code);
      const categories = e ? eventMenu(e, soldOut) : menuOf(soldOut), state = e ? eventStatus(e) : dead;
      const at = e ? { eventStart: e.start, eventEnd: Math.min(e.end, Number(e.endedAt) || Infinity) } : {};
      if (link.eventTable) {
        const t = (e?.tables || []).find(x => x?.code === link.code);
        return { ...base, ...at, kind: 'event-table', place: `Event table ${link.eventTable}`, eventTable: link.eventTable, event: e?.name || 'Event', categories, state,
          bill: e && t ? tableBill(o => o.type === 'event' && o.event?.id === e.id && String(o.event?.table ?? '') === String(e.tablesFrom === 'floor' ? t.floor || t.id : t.name)) : null };
      }
      const mode = e?.mode || 'both';
      return { ...base, ...at, kind: mode === 'menu' ? 'menu' : 'event', eventMode: mode === 'takeaway' ? 'takeaway' : 'both', place: 'Event', event: e?.name || 'Event', categories, state };
    }
    const qrs = Array.isArray(json('restro.qr.v1')) ? json('restro.qr.v1') : [];
    const qr = qrs.find(r => r && r.kind === link.kind && r.code === link.code);
    const state = !qr ? dead : link.kind === 'menu' ? null : restaurantStatus();
    return { ...base, kind: link.kind, place: link.kind === 'table' ? `Table ${qr?.name || link.table}` : link.kind === 'takeaway' ? 'Takeaway' : 'Menu', categories: menuOf(soldOut), state,
      ...(link.kind === 'table' ? { table: (qr && tableName(qr.table)) || qr?.name || link.table } : {}),
      bill: qr && link.kind === 'table' ? tableBill(o => o.table === qr.table && (o.type === 'dine-in' || (Boolean(o.type) && o.split === true))) : null };
  }

  const read = link => (link && window.RestroMenu ? local(link) : null);
  function watch(fn) { addEventListener('storage', e => { if (e.key === null || KEYS.includes(e.key)) fn(); }); }
  window.RestroCustomerData = Object.freeze({ read, watch, slugOf, restaurantStatus, eventStatus });
})();
