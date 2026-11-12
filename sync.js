'use strict';
// Sync: keeps the restaurant's data the same on every tablet of the restaurant. (SYNC.md has the details.)
//
// What syncs: orders, held tickets, customers, staff (PINs only as hashes) and the restaurant's details (name, profile,
// preparation time). What stays on each tablet: its looks and layouts (theme, sounds, home screen, tile order,
// the Counter's menu style and button order), the order being rung up, and who is signed in.
//
// How:
// - Every tablet works on its own copy (localStorage), so it never waits for a network. When a screen saves shared data
//   it calls RestroSync.wrote(key): each record that changed gets a version (a hybrid clock stamp: time · counter ·
//   tablet) and waits to be sent. A record deleted on purpose goes through RestroSync.removed(), so the deletion travels
//   too; records a tablet only clears from itself (paid orders past the latest 500, held tickets after their day) don't.
// - Every tablet has one server at a time, which puts the changes in order and hands them out:
//     · the main system (the tablet the printers are wired to) for the tablets paired with it, over the restaurant's own
//       Wi-Fi or Bluetooth through the Android app (RESTRODevice.localSync, see ANDROID-BRIDGE.md), so the restaurant
//       keeps working together when the internet drops;
//     · the cloud (once it is set up) for the main system, for a tablet without one, and for a paired tablet while it
//       can't reach the main system (say the main system is off).
//   The cloud gets everything from the main system, and the tablets get the cloud's changes through it.
// - A server takes a change only if it was made on the server's latest version of that record. Otherwise it sends that
//   version back; the tablet merges the two (field by field against the version both started from; items added on both
//   sides are all kept; a payment is never undone) and sends the result. Nothing is lost when two tablets change the
//   same order, and the same change arriving twice changes nothing.
// - Ticket numbers are one sequence a day for the whole restaurant, kept by the cloud (by the main system while the
//   internet is down): a tablet asks for the next number when it fires a new order, through the main system, or from
//   the cloud while the main system is off. Two orders never share a number. A tablet that reaches neither can't fire.
// - Messages between tablets are encrypted with a key made from the restaurant's pairing code, so tablets of another
//   restaurant, or anyone else on the network, can't join or read them.
// Nothing here is part of the code or the website's data: everything stays on the tablets until the cloud exists.
(() => {
  const PROTOCOL = 1;

  // ---------- what syncs ----------
  // An order's line is known by its item, its order type and its choices (modifiers): the same item with other choices
  // is a line of its own (counter.js). A saved order keeps its choices as { id, label, ... }; the one on screen as ids.
  // (Counter Update 7: a dish discount makes a line of its own too, "%10")
  const lineKey = l => `${l.id}@${l.type || ''}${Array.isArray(l.mods) && l.mods.length ? `#${l.mods.map(m => (typeof m === 'string' ? m : m?.id)).join('+')}` : ''}${Number.isInteger(l.off) && l.off > 0 ? `%${l.off}` : ''}`;
  // Collections: a list of records under one key, `id` naming a record, with the rules for merging two versions.
  const COLLECTIONS = {
    orders: { key: 'restro.counter.orders.v1', id: o => (typeof o?.uid === 'string' ? o.uid : Number.isFinite(o?.number) ? `n${o.number}` : null),
      rules: { keyed: { lines: lineKey, kots: k => String(k.id || k.at), events: e => String(e.id || e.at) }, additive: { lines: 'qty' }, maxMap: ['sent'], sticky: ['paidAt', 'method', 'received', 'change'] } },
    held: { key: 'restro.counter.held.v1', id: h => (typeof h?.heldId === 'string' ? h.heldId : null), keep: h => !(Number.isFinite(h.holdUntil) && h.holdUntil <= Date.now()),
      rules: { keyed: { lines: lineKey }, additive: { lines: 'qty' } } },
    customers: { key: 'restro.customers.v1', id: c => (typeof c?.id === 'string' ? c.id : null) },
    staff: { key: 'restro.staff.v1', id: p => (typeof p?.id === 'string' ? p.id : null) }
  };
  // Settings: one value per key, synced as the records { value } of 'settings'. The name's placeholder is no name, so it
  // never travels (a new tablet takes the restaurant's name from the others).
  const VALUES = {
    restaurantName: { key: 'restro.restaurantName', raw: true, placeholder: 'RESTAURANT NAME' },
    profile: { key: 'restro.profile.v1' },
    prepMinutes: { key: 'restro.counter.prepMinutes.v1' },
    // (Update Pack 3: Settings › Kitchen's prep time, one for every order or one per order type; the Orders display's and
    // the Counter's look when set for All tablets: the restaurant's default)
    kitchenPrep: { key: 'restro.kitchen.prep.v1' },
    ordersLook: { key: 'restro.ordersLook.shared.v1' },
    counterLook: { key: 'restro.counterLook.shared.v1' },
    // (Update Pack 9 Nov 2026, prefs.js: Billing & charges, Business details, the printers, Staff & security)
    billing: { key: 'restro.billing.v1' },
    business: { key: 'restro.business.v1' },
    printers: { key: 'restro.printers.v1' },
    security: { key: 'restro.security.v1' },
    // (Update Pack 4: Business details › Business hours, with the business day's cut-off, and Bill number)
    hours: { key: 'restro.hours.v1' },
    billNumber: { key: 'restro.billNumber.v1' },
    // (Counter Update 7: what is sold out, set in the Availability app (today's Menu app), shown live on every Counter)
    availability: { key: 'restro.menu.availability.v1' }
  };
  const NAMES = [...Object.keys(COLLECTIONS), 'settings'];
  const TICKET_KEY = 'restro.counter.ticket.v2'; // { day, next }: after the highest number this tablet has given or seen today
  const nameOfKey = key => Object.entries(COLLECTIONS).find(([, c]) => c.key === key)?.[0] || (Object.values(VALUES).some(v => v.key === key) ? 'settings' : null);

  // ---------- small helpers ----------
  const now = () => Date.now();
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const rand = n => { const a = crypto.getRandomValues(new Uint8Array(n)); return [...a].map(b => (b % 36).toString(36)).join(''); };
  const newId = prefix => `${prefix}${now().toString(36)}${rand(6)}`;
  // Pairing codes use letters and numbers that can't be mistaken for each other (no I, L, O, 0 or 1)
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const codeChars = n => { let out = ''; while (out.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 248 && out.length < n) out += CODE_CHARS[b % 31]; return out; };
  const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  // A 53-bit hash of a record, to see whether it changed while the app wasn't running (cyrb53)
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // The business day: ticket numbers start again at #01 every day. A day runs from its cut-off to the next (Settings ›
  // Business details › Business hours; 4 AM unless changed, Update Pack 4), so a late night after midnight stays on the
  // same day. Each order keeps the day it was numbered on (`day`), so every tablet and server agrees whose numbers it
  // shares.
  let cutMinutes = 240;
  const readCut = () => { const c = window.RestroPrefs?.get?.('hours')?.cut; cutMinutes = Number.isFinite(c) ? c : 240; };
  readCut();
  window.addEventListener('restro:prefs-changed', e => { if (e.detail?.name === 'hours') readCut(); });
  const dayOf = t => { const d = new Date(t - cutMinutes * 60000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = () => dayOf(now());
  const orderDay = o => (typeof o?.day === 'string' && o.day ? o.day : dayOf(Number.isFinite(o?.createdAt) && o.createdAt > 0 ? o.createdAt : Date.parse(o?.paidAt) || now()));
  // The highest number of a day. Only orders numbered by the day carry `day`; numbers from before (1001 and up, never
  // starting again) don't hold the day's count up.
  const highestOn = (day, docs) => Math.max(0, ...[...(docs || readDocs('orders')).values()].filter(o => Number.isInteger(o.number) && typeof o.day === 'string' && o.day === day).map(o => o.number));
  const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

  // ---------- this tablet ----------
  const DEVICE = 'restro.device.v1';
  let device = load(DEVICE, null);
  if (!isObj(device) || typeof device.id !== 'string') { const id = `d${rand(10)}`; device = { id, name: `Tablet ${id.slice(-3).toUpperCase()}`, main: false, createdAt: now() }; save(DEVICE, device); }
  // The main system's pairing code (on the main system and on every tablet paired with it), and the cloud sign-in. Both
  // stay on this tablet only.
  const PAIR = 'restro.sync.pair.v1', CLOUD = 'restro.cloud.v1';
  let pair = load(PAIR, null); if (!isObj(pair) || typeof pair.code !== 'string') pair = null;
  function cloudConfig() { const c = load(CLOUD, null); return isObj(c) && typeof c.endpoint === 'string' && typeof c.restaurantId === 'string' && typeof c.token === 'string' ? c : null; }
  // This tablet's server: for a tablet paired with the main system, the main system, or the cloud (once it is set up)
  // while the main system can't be reached, say when it is off; the cloud for the main system and for a tablet without
  // one, once it is set up; none for a tablet on its own.
  const upstream = () => (device.main ? (cloudConfig() ? 'cloud' : null) : pair ? (cloudConfig() && Local.hubAway() ? 'cloud' : 'hub') : cloudConfig() ? 'cloud' : null);

  // ---------- hybrid clock: versions that sort by time across tablets, even with clocks a little apart ----------
  // A version is made after every version it was made from, so a change always sorts after what it changed.
  const CLOCK = 'restro.sync.clock.v1';
  const clock = Object.assign({ l: 0, c: 0 }, load(CLOCK, {}));
  let clockTimer = null;
  const keepClock = () => { clearTimeout(clockTimer); clockTimer = setTimeout(() => save(CLOCK, clock), 300); };
  const stamp = (l, c) => `${l.toString(36).padStart(9, '0')}.${c.toString(36).padStart(4, '0')}.${device.id}`;
  const parse = h => { const [l, c] = String(h).split('.'); return { l: parseInt(l, 36) || 0, c: parseInt(c, 36) || 0 }; };
  function tick() { const t = now(); if (t > clock.l) { clock.l = t; clock.c = 0; } else clock.c++; keepClock(); return stamp(clock.l, clock.c); }
  function observe(h) {
    if (typeof h !== 'string') return;
    const r = parse(h), t = now(), l = Math.max(clock.l, r.l, t);
    clock.c = l === clock.l && l === r.l ? Math.max(clock.c, r.c) + 1 : l === clock.l ? clock.c + 1 : l === r.l ? r.c + 1 : 0;
    clock.l = l; keepClock();
  }

  // ---------- reading and writing the shared data ----------
  // A collection's records as a Map id → record. Settings are records { value } named after the setting.
  function readDocs(name) {
    const out = new Map();
    if (name === 'settings') {
      for (const [id, v] of Object.entries(VALUES)) {
        const raw = localStorage.getItem(v.key); if (raw == null || (v.placeholder && raw === v.placeholder)) continue;
        let value = raw; if (!v.raw) { try { value = JSON.parse(raw); } catch { continue; } }
        out.set(id, { value });
      }
      return out;
    }
    const c = COLLECTIONS[name]; let list = [];
    try { const v = JSON.parse(localStorage.getItem(c.key) || '[]'); if (Array.isArray(v)) list = v; } catch {}
    for (const r of list) { const id = isObj(r) ? c.id(r) : null; if (id && !out.has(id)) out.set(id, r); }
    return out;
  }
  // Writes a collection back after changes from the server, keeping each screen's own rules (orders: newest first, every
  // order not paid plus the latest 500 paid; held: none past its day).
  function writeDocs(name, docs) {
    try {
      if (name === 'settings') {
        for (const [id, v] of Object.entries(VALUES)) {
          const d = docs.get(id);
          if (d === undefined) localStorage.removeItem(v.key);
          else localStorage.setItem(v.key, v.raw ? String(d.value ?? '') : JSON.stringify(d.value));
        }
        return;
      }
      const c = COLLECTIONS[name];
      let list = [...docs.values()].filter(r => !c.keep || c.keep(r));
      if (name === 'orders') {
        const createdOf = o => (Number.isFinite(o.createdAt) && o.createdAt > 0 ? o.createdAt : Date.parse(o.paidAt)) || 0;
        list.sort((a, b) => createdOf(b) - createdOf(a));
        const kept = new Set([...list.filter(o => !o.paidAt), ...list.filter(o => o.paidAt).slice(0, 500)]);
        list = list.filter(o => kept.has(o));
      }
      localStorage.setItem(c.key, JSON.stringify(list));
    } catch {}
  }
  // A change as it travels: { c: collection, i: record id, h: version, b: the version it replaces, doc | x: deleted }
  const valid = ch => isObj(ch) && NAMES.includes(ch.c) && typeof ch.i === 'string' && ch.i.length > 0 && ch.i.length <= 120 && typeof ch.h === 'string' && ch.h.length <= 80
    && (ch.x ? true : ch.c === 'settings' ? VALUES[ch.i] !== undefined && isObj(ch.doc) : isObj(ch.doc) && COLLECTIONS[ch.c].id(ch.doc) === ch.i);

  // ---------- versions of every record ----------
  // meta[name][id] = { h: version, s: hash of the record, pv: the version before it, x: deleted,
  //   p: still to send to this tablet's server, b: the server's version it was made on and bd: that version's record
  //   (JSON), both while it waits, f / fd: the version last sent and its record, while the answer is awaited }
  const META = 'restro.sync.meta.v1', STATE = 'restro.sync.state.v1';
  const meta = load(META, {}); for (const n of NAMES) if (!isObj(meta[n])) meta[n] = {};
  // mode: 'solo' until a server is in the picture; cursors: how far this tablet has fetched from each server
  const state = Object.assign({ mode: 'solo', cursors: {} }, load(STATE, {}));
  delete state.lease; delete state.spare; // blocks of numbers, from before the numbers were one sequence
  let metaTimer = null;
  const keepMeta = () => { clearTimeout(metaTimer); metaTimer = setTimeout(flushMeta, 200); };
  const flushMeta = () => { clearTimeout(metaTimer); save(META, meta); save(STATE, state); };
  window.addEventListener('pagehide', () => { flushMeta(); save(CLOCK, clock); keepHub(); });
  // What each collection looked like last time (record JSON by id), to see what a save changed
  const snap = {};

  // A change made here (or taken by the main system from a tablet) waits for this tablet's server, made on the server's
  // version: the one it already had, or the one an earlier change still waiting was made on.
  function upMark(cur, prevJson, entry) {
    if (!upstream()) return entry;
    const waiting = Boolean(cur && cur.p);
    entry.p = 1;
    entry.b = cur ? (waiting ? cur.b ?? null : cur.h) : null;
    entry.bd = cur ? (waiting ? cur.bd ?? null : cur.x ? null : prevJson ?? null) : null;
    if (waiting && cur.f) { entry.f = cur.f; entry.fd = cur.fd ?? null; }
    return entry;
  }
  function markLocal(name, id, json, prevJson, deleted = false) {
    const cur = meta[name][id];
    const entry = upMark(cur, prevJson, { h: tick(), s: deleted ? '' : hash(json), pv: cur ? cur.h : null, ...(deleted ? { x: 1 } : {}) });
    meta[name][id] = entry;
    return entry;
  }
  // The server has this exact version: nothing left to send
  function acked(cur) { delete cur.p; delete cur.b; delete cur.bd; delete cur.f; delete cur.fd; }

  // A screen saved one of the shared keys: every record that changed gets a new version and waits to be sent.
  let applying = false;
  function wrote(key) {
    if (applying) return;
    const name = nameOfKey(key); if (!name) return;
    const docs = readDocs(name), prev = snap[name] || new Map(), next = new Map(), changes = [];
    for (const [id, doc] of docs) {
      const json = JSON.stringify(doc); next.set(id, json);
      if (prev.get(id) === json) continue;
      const entry = markLocal(name, id, json, prev.get(id));
      changes.push({ c: name, i: id, h: entry.h, b: entry.pv, doc });
    }
    // Gone from the list but not removed on purpose: cleared from this tablet only.
    for (const id of prev.keys()) if (!docs.has(id)) { const m = meta[name][id]; if (m && !m.p && !m.x) delete meta[name][id]; }
    snap[name] = next;
    if (changes.length) { keepMeta(); localCommitted(changes); }
  }
  // A record deleted on purpose (an order, a customer, an employee, a held ticket resumed): the deletion travels. Called
  // before the screen saves the list without it.
  function removed(name, id) {
    if (!COLLECTIONS[name] || typeof id !== 'string') return;
    const prevJson = snap[name]?.get(id) ?? null;
    snap[name]?.delete(id);
    const entry = markLocal(name, id, null, prevJson, true);
    keepMeta(); localCommitted([{ c: name, i: id, h: entry.h, b: entry.pv, x: 1 }]);
  }

  // ---------- merging two versions of a record ----------
  // Field by field against the version both started from: a field changed on one side only takes that side; changed on
  // both, the newer version's (`mineNewer`). Lists of items (order lines) merge item by item, quantities adding up the
  // changes of both sides; the kitchen tickets of both are kept; what was sent to the kitchen takes the larger count; a
  // payment taken on either side stays.
  function merge3(base, mine, theirs, rules = {}, mineNewer = false, path = '') {
    const keyFn = rules.keyed?.[path];
    // The same item added on both sides was added twice (two tablets each adding one), so lists that add up quantities
    // merge even when both sides look the same.
    if (!(keyFn && rules.additive?.[path] && Array.isArray(mine) && Array.isArray(theirs)) && same(mine, theirs)) return mine;
    if (same(base, mine)) return theirs;
    if (same(base, theirs)) return mine;
    if (keyFn && Array.isArray(mine) && Array.isArray(theirs)) {
      const mapOf = list => new Map((Array.isArray(list) ? list : []).filter(isObj).map(x => [keyFn(x), x]));
      const B = mapOf(base), M = mapOf(mine), T = mapOf(theirs), out = [];
      const add = rules.additive?.[path];
      for (const k of new Set([...T.keys(), ...M.keys()])) {
        const b = B.get(k), m = M.get(k), t = T.get(k);
        if (!m && b && same(b, t)) continue;               // taken off on my side, untouched on theirs
        if (!t && b && same(b, m)) continue;               // taken off on theirs, untouched on mine
        let v = merge3(b, m ?? b ?? t, t ?? b ?? m, rules, mineNewer, `${path}.item`);
        if (add && isObj(v)) {
          // what each side has now (none if it took the item off), less what both started from
          const q = x => (Number.isFinite(x?.[add]) ? x[add] : 0);
          const total = q(m) + q(t) - q(b);
          if (total <= 0) continue;
          v = { ...v, [add]: total };
        }
        out.push(v);
      }
      return out;
    }
    if (isObj(mine) && isObj(theirs)) {
      if (rules.maxMap?.includes(path)) {
        const out = { ...theirs }; for (const [k, v] of Object.entries(mine)) out[k] = Math.max(Number(v) || 0, Number(out[k]) || 0); return out;
      }
      const out = {};
      const sticky = path === '' && rules.sticky ? rules.sticky : null;
      if (sticky) {
        const paidMine = Boolean(mine[sticky[0]]), paidTheirs = Boolean(theirs[sticky[0]]);
        const from = paidMine && paidTheirs ? (String(mine[sticky[0]]) <= String(theirs[sticky[0]]) ? mine : theirs) : paidMine ? mine : paidTheirs ? theirs : null;
        if (from) for (const k of sticky) out[k] = from[k] ?? null;
      }
      for (const k of new Set([...Object.keys(isObj(base) ? base : {}), ...Object.keys(mine), ...Object.keys(theirs)])) {
        if (sticky && sticky.includes(k) && k in out) continue;
        const v = merge3(isObj(base) ? base[k] : undefined, mine[k], theirs[k], rules, mineNewer, path ? `${path}.${k}` : k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return mineNewer ? mine : theirs;
  }
  // After a merge an order's totals are worked out again from its lines, and what went to the kitchen from its kitchen
  // tickets (both sides' tickets are kept, and the same ticket made on two tablets counts once).
  function finish(name, doc) {
    if (name !== 'orders' || !isObj(doc) || !Array.isArray(doc.lines) || !doc.lines.every(l => Number.isFinite(l?.price) && Number.isFinite(l?.qty))) return doc;
    const rate = window.RestroMenu?.taxRate ?? (doc.subtotal ? doc.tax / doc.subtotal : 0);
    // (bill.js, Counter Update 7: dish discounts, the order discount, the service charge, packaging and delivery, CGST
    // and SGST, the total to the nearest rupee)
    const lines = doc.lines.map(l => ({ each: Math.round(l.price * 100), qty: l.qty, off: l.off }));
    const sums = window.RestroBill ? window.RestroBill.order({ lines, type: doc.type, discountPct: doc.discountPct, servicePct: doc.servicePct, packaging: doc.packaging, delivery: doc.delivery }, rate)
      : (() => { const subtotal = lines.reduce((s, l) => s + l.each * l.qty, 0); return { subtotal, tax: Math.round(subtotal * rate), total: subtotal + Math.round(subtotal * rate) }; })();
    const out = { ...doc, ...sums, count: doc.lines.reduce((n, l) => n + l.qty, 0) };
    if (Array.isArray(doc.kots) && doc.kots.length) out.sent = sentFrom(doc.kots, doc.sent);
    return out;
  }
  // What the kitchen has of each line, from the order's kitchen tickets (Counter Update 7): a KOT adds its dishes, a
  // void takes them off (its quantities are negative), a changed slip moves them from the line they were (`was`) to the
  // line they are now, and a cancelled order takes everything off. Orders saved before tickets were kept keep theirs.
  function sentFrom(kots, before) {
    const sent = {};
    let counted = false;
    for (const k of [...kots].filter(isObj).sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))) {
      const kind = k.kind || 'kot';
      if (kind === 'cancel') { for (const key of Object.keys(sent)) delete sent[key]; counted = true; continue; }
      if (kind !== 'kot' && kind !== 'void' && kind !== 'changed') continue;
      for (const l of Array.isArray(k.lines) ? k.lines : []) {
        if (!Number.isFinite(l?.qty)) continue;
        counted = true;
        if (kind === 'changed') { const was = isObj(l.was) ? lineKey({ ...l, mods: l.was.mods, off: l.was.off }) : null; if (was && was !== lineKey(l)) { sent[was] = (sent[was] || 0) - Math.abs(l.qty); sent[lineKey(l)] = (sent[lineKey(l)] || 0) + Math.abs(l.qty); } continue; }
        sent[lineKey(l)] = (sent[lineKey(l)] || 0) + l.qty;
      }
    }
    if (!counted) return isObj(before) ? { ...before } : {};
    for (const key of Object.keys(sent)) if (!(sent[key] > 0)) delete sent[key];
    return sent;
  }
  // Without a version both started from (the same record made on two tablets before they met), the newer whole record
  // wins: quantities can't be added up without knowing what both started from.
  function mergeRecord(name, base, mine, theirs, mineNewer = true) {
    if (base == null) return mineNewer ? mine : theirs;
    return finish(name, merge3(base, mine, theirs, COLLECTIONS[name]?.rules || {}, mineNewer));
  }

  // ---------- changes from this tablet's server ----------
  // Versions pulled, passed on, or sent back with a refusal (`refused`: always merged). Returns the collections changed.
  // On the main system, what changes here goes on to the tablets around it too.
  function applyRemote(changes, refused = false) {
    const docsByName = new Map(), touched = new Set(), relay = [], renumbered = [];
    const docs = name => { if (!docsByName.has(name)) docsByName.set(name, readDocs(name)); return docsByName.get(name); };
    applying = true;
    try {
      for (const ch of changes) {
        if (!valid(ch)) continue;
        observe(ch.h);
        const m = meta[ch.c], cur = m[ch.i], waiting = Boolean(cur && cur.p);
        if (cur && cur.h === ch.h) { if (waiting) acked(cur); continue; }                       // the version it has
        if (cur && !refused && (waiting ? cur.b && ch.h <= cur.b : ch.h < cur.h)) continue;     // older than what it has
        const d = docs(ch.c), mine = d.get(ch.i);
        let take = true, merged;
        if (waiting && (ch.b ?? null) !== cur.h) {
          // Changed here too and not sent yet (and theirs wasn't made on it): merge, and send the result. Between a
          // deletion and an edit, the later wins.
          const later = cur.h > ch.h;
          if (cur.x && ch.x) merged = undefined;
          else if (ch.x) merged = later ? mine : undefined;
          else if (cur.x || mine === undefined) merged = later && cur.x ? undefined : ch.doc;
          else {
            // what both started from: the version last sent, if the server made its version on that; otherwise the
            // server's version this tablet's change was made on
            const base = ch.b != null && ch.b === cur.f ? cur.fd : cur.bd;
            merged = mergeRecord(ch.c, base ? JSON.parse(base) : null, mine, ch.doc, later);
          }
          take = merged === undefined ? Boolean(ch.x) : !ch.x && same(merged, ch.doc);
        }
        if (take) {
          if (ch.x) d.delete(ch.i); else d.set(ch.i, ch.doc);
          m[ch.i] = ch.x ? { h: ch.h, s: '', pv: cur ? cur.h : null, x: 1 } : { h: ch.h, s: hash(JSON.stringify(ch.doc)), pv: cur ? cur.h : null };
        } else {
          if (merged === undefined) d.delete(ch.i); else d.set(ch.i, merged);
          m[ch.i] = { h: tick(), s: merged === undefined ? '' : hash(JSON.stringify(merged)), pv: cur.h, p: 1, b: ch.h, bd: ch.x ? null : JSON.stringify(ch.doc), ...(merged === undefined ? { x: 1 } : {}) };
        }
        touched.add(ch.c);
        const after = d.get(ch.i);
        if (ch.c === 'orders') { sawNumber(after); sawBill(after); }
        if (ch.c === 'orders' && isObj(mine) && isObj(after) && Number.isInteger(mine.number) && Number.isInteger(after.number) && mine.number !== after.number) renumbered.push({ uid: ch.i, from: mine.number, to: after.number });
        if (device.main && state.mode === 'multi') {
          const fin = m[ch.i];
          hub.seq++; hubRecord(ch.c, ch.i, hub.seq);
          relay.push(fin.x || after === undefined ? { c: ch.c, i: ch.i, h: fin.h, b: fin.pv, x: 1, seq: hub.seq } : { c: ch.c, i: ch.i, h: fin.h, b: fin.pv, doc: after, seq: hub.seq });
        }
      }
      for (const name of touched) { writeDocs(name, docs(name)); snap[name] = new Map([...readDocs(name)].map(([id, doc]) => [id, JSON.stringify(doc)])); }
    } finally { applying = false; }
    if (relay.length) { keepHub(); broadcast({ t: 'batch', server: device.id, from: relay[0].seq, seq: hub.seq, changes: relay }); }
    if (touched.size) { keepMeta(); emit('restro:data-changed', { collections: [...touched] }); }
    if (renumbered.length) emit('restro:orders-renumbered', { orders: renumbered });
    if ([...touched].some(name => Object.values(meta[name]).some(x => x.p))) schedulePush();
    return touched;
  }
  // What waits for this tablet's server: [{ c, i, h, b, doc | x }], at most 200 records or about 200 kB
  function unsent() {
    const out = []; let bytes = 0;
    for (const name of NAMES) {
      let docs = null;
      for (const [id, m] of Object.entries(meta[name])) {
        if (!m.p) continue;
        let ch;
        if (m.x) { ch = { c: name, i: id, h: m.h, b: m.b ?? null, x: 1 }; m.f = m.h; m.fd = null; }
        else {
          docs = docs || readDocs(name);
          const doc = docs.get(id); if (doc === undefined) { acked(m); continue; } // cleared from this tablet only
          ch = { c: name, i: id, h: m.h, b: m.b ?? null, doc }; m.f = m.h; m.fd = JSON.stringify(doc);
        }
        bytes += JSON.stringify(ch).length; out.push(ch);
        if (out.length >= 200 || bytes >= 200000) return out;
      }
    }
    return out;
  }
  // The server's answers to a push: accepted versions stop waiting; refused ones come back with the server's version,
  // which is merged in (and sent again).
  function handleResults(results) {
    const refused = [];
    for (const r of Array.isArray(results) ? results : []) {
      const cur = meta[r?.c]?.[r?.i]; if (!cur) continue;
      // accepted: done, or (changed again here meanwhile) the next change is made on what the server now has
      if (r.ok) { if (cur.h === r.h) { if (cur.p) acked(cur); } else if (cur.p && cur.f === r.h) { cur.b = r.h; cur.bd = cur.fd ?? null; delete cur.f; delete cur.fd; } }
      else if (r.conflict && isObj(r.current)) refused.push({ c: r.c, i: r.i, ...r.current });
    }
    if (refused.length) applyRemote(refused, true);
    keepMeta();
    return refused.length;
  }

  // ---------- the main system: the restaurant's own server on its network ----------
  // It takes the other tablets' changes in order (each gets the next sequence number), refuses a change made on an older
  // version than its own (sending its version back), hands out what each tablet hasn't had yet, and settles the ticket
  // numbers of the orders it takes. Its own changes go in the same way.
  const HUB = 'restro.sync.hub.v1';
  const hub = Object.assign({ seq: 0, log: {} }, load(HUB, {}));
  if (!isObj(hub.log)) hub.log = {};
  delete hub.next; delete hub.end; delete hub.day; // its count of numbers, from before the numbers were one sequence
  let hubTimer = null;
  function keepHub() { clearTimeout(hubTimer); hubTimer = setTimeout(() => save(HUB, hub), 200); }
  function hubRecord(name, id, seq) { hub.log[`${name}/${id}`] = seq; }
  // Ticket numbers of the orders it takes from the tablets, within the order's day. The main system gives every number,
  // so this only settles a tablet's own orders from before it joined (marked provisional): a provisional number stays if
  // no other order that day has it; otherwise the order gets the day's next number. The same happens to an open order
  // whose number another order that day has. Returns the order with its number settled, or null if it stays as it is.
  function settleNumber(id, doc, docs) {
    if (!Number.isInteger(doc.number)) return null;
    const day = orderDay(doc), n = doc.number, idOf = COLLECTIONS.orders.id;
    const others = [...docs.values()].filter(o => idOf(o) !== id && Number.isInteger(o.number) && orderDay(o) === day);
    const taken = others.some(o => o.number === n);
    if (!doc.numberProvisional && (!taken || doc.paidAt)) return null;
    const number = taken ? nextOn(day, others) : n;
    const { numberProvisional, ...rest } = doc;
    return { ...rest, number, day, ...(number !== n ? { numberWas: Number.isInteger(rest.numberWas) ? rest.numberWas : n } : {}) };
  }
  // Changes pushed by a tablet: [{ c, i, h, b, doc | x }] → the answers, and the changes taken (to pass on)
  function hubAccept(changes) {
    const results = [], accepted = [], renumbered = [], docsByName = new Map();
    const docs = name => { if (!docsByName.has(name)) docsByName.set(name, readDocs(name)); return docsByName.get(name); };
    applying = true;
    try {
      for (const ch of changes) {
        if (!valid(ch)) continue;
        observe(ch.h);
        const m = meta[ch.c], cur = m[ch.i];
        if (cur && cur.h === ch.h) { results.push({ c: ch.c, i: ch.i, h: ch.h, ok: true }); continue; }
        if (cur && cur.h !== (ch.b ?? null)) {
          const doc = cur.x ? undefined : docs(ch.c).get(ch.i);
          results.push({ c: ch.c, i: ch.i, h: ch.h, conflict: true, current: doc === undefined ? { h: cur.h, b: cur.pv ?? null, x: 1 } : { h: cur.h, b: cur.pv ?? null, doc } });
          continue;
        }
        const d = docs(ch.c), before = d.get(ch.i);
        if (ch.x) d.delete(ch.i); else d.set(ch.i, ch.doc);
        let entry = upMark(cur, before === undefined ? null : JSON.stringify(before), { h: ch.h, s: ch.x ? '' : hash(JSON.stringify(ch.doc)), pv: cur ? cur.h : null, ...(ch.x ? { x: 1 } : {}) });
        results.push({ c: ch.c, i: ch.i, h: ch.h, ok: true });
        let doc = ch.doc;
        const fixed = ch.c === 'orders' && !ch.x ? settleNumber(ch.i, ch.doc, d) : null;
        if (fixed) {
          // The main system's own version, made on the tablet's
          d.set(ch.i, fixed); doc = fixed;
          entry = { ...entry, h: tick(), s: hash(JSON.stringify(fixed)), pv: ch.h };
          if (isObj(before) && Number.isInteger(before.number) && before.number !== fixed.number) renumbered.push({ uid: ch.i, from: before.number, to: fixed.number });
        }
        if (ch.c === 'orders') { sawNumber(doc); sawBill(doc); }
        m[ch.i] = entry;
        hub.seq++; hubRecord(ch.c, ch.i, hub.seq);
        accepted.push(ch.x ? { c: ch.c, i: ch.i, h: entry.h, b: entry.pv, x: 1, seq: hub.seq } : { c: ch.c, i: ch.i, h: entry.h, b: entry.pv, doc, seq: hub.seq });
      }
      for (const [name, d] of docsByName) if (accepted.some(a => a.c === name)) { writeDocs(name, d); snap[name] = new Map([...readDocs(name)].map(([id, doc]) => [id, JSON.stringify(doc)])); }
    } finally { applying = false; }
    keepHub(); keepMeta();
    const names = [...new Set(accepted.map(a => a.c))];
    if (names.length) emit('restro:data-changed', { collections: names });
    if (renumbered.length) emit('restro:orders-renumbered', { orders: renumbered });
    if (accepted.length && upstream()) schedulePush();
    return { results, accepted };
  }
  // Everything after `since`, in order: { seq, changes, more }, at most 300 records or about 200 kB a page
  function hubChangesSince(since) {
    const entries = Object.entries(hub.log).filter(([, s]) => s > since).sort((a, b) => a[1] - b[1]);
    const docsByName = new Map(), changes = []; let bytes = 0, last = since, i = 0;
    const docs = name => { if (!docsByName.has(name)) docsByName.set(name, readDocs(name)); return docsByName.get(name); };
    for (; i < entries.length && changes.length < 300 && bytes < 200000; i++) {
      const [key, seq] = entries[i]; last = seq;
      const cut = key.indexOf('/'), name = key.slice(0, cut), id = key.slice(cut + 1), m = meta[name]?.[id];
      if (!m) continue;
      const doc = m.x ? undefined : docs(name).get(id);
      if (!m.x && doc === undefined) continue; // cleared from the main system only
      const ch = m.x ? { c: name, i: id, h: m.h, b: m.pv ?? null, x: 1, seq } : { c: name, i: id, h: m.h, b: m.pv ?? null, doc, seq };
      bytes += JSON.stringify(ch).length; changes.push(ch);
    }
    const more = i < entries.length;
    return { seq: more ? last : hub.seq, changes, more };
  }
  // Puts every record in the main system's log (when it becomes the main system, and at start)
  function hubLogAll() {
    for (const name of NAMES) {
      for (const [id, doc] of readDocs(name)) {
        if (!meta[name][id]) meta[name][id] = upMark(null, null, { h: tick(), s: hash(JSON.stringify(doc)), pv: null });
        if (!hub.log[`${name}/${id}`]) { hub.seq++; hubRecord(name, id, hub.seq); }
      }
      for (const [id, m] of Object.entries(meta[name])) if (m.x && !hub.log[`${name}/${id}`]) { hub.seq++; hubRecord(name, id, hub.seq); }
    }
    keepHub(); keepMeta();
  }

  // ---------- after a change made on this tablet ----------
  function localCommitted(changes) {
    if (device.main && state.mode === 'multi') {
      // The main system is its own server: the change goes in its log and out to the other tablets at once
      for (const ch of changes) { hub.seq++; hubRecord(ch.c, ch.i, hub.seq); ch.seq = hub.seq; }
      keepHub();
      broadcast({ t: 'batch', server: device.id, from: changes[0].seq, seq: hub.seq, changes });
    }
    schedulePush();
  }
  let pushTimer = null;
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { const up = upstream(); if (up === 'hub') Local.push(); else if (up === 'cloud') Cloud.sync(); }, 250);
  }

  // ---------- ticket numbers ----------
  // One sequence a day for the whole restaurant, from #01, kept in one place, so two orders never share a number and a
  // number never changes: the cloud keeps the count while it can be reached, and the main system while the internet is
  // down. A tablet fires a new order by asking for its number: through the main system (over the restaurant's Wi-Fi or
  // Bluetooth), or straight from the cloud while the main system can't be reached, say when it is off. A tablet that
  // reaches neither can't fire an order. Every request carries the highest number the tablet knows of the day, and the
  // answer is always past it. A tablet on its own counts by itself.
  // The day's next number: after every order of that day here and, for today, after every number this tablet has given
  // or seen (an order may have been deleted since)
  function nextOn(day, docs) {
    const t = load(TICKET_KEY, null), seen = day === today() && isObj(t) && t.day === day ? Number(t.next) || 1 : 1;
    return Math.max(seen, highestOn(day, docs) + 1);
  }
  // A number given elsewhere (another tablet's order, or one the server gave or settled): this tablet's count goes past
  // it, so it carries on the sequence if it becomes the main system
  function sawNumber(doc) {
    if (!isObj(doc) || !Number.isInteger(doc.number) || typeof doc.day !== 'string') return; // not numbered by the day
    const day = doc.day; if (day !== today()) return;
    const t = load(TICKET_KEY, null), next = isObj(t) && t.day === day ? Number(t.next) || 1 : 1;
    if (doc.number >= next) save(TICKET_KEY, { day, next: doc.number + 1 });
  }
  // The highest number this tablet knows of today
  const knownToday = () => nextOn(today()) - 1;
  // This tablet's own next number, past `after` too: { day, number }
  function ownNumber(after = 0) {
    const day = today(), number = Math.max(nextOn(day), after + 1);
    save(TICKET_KEY, { day, next: number + 1 });
    return { day, number };
  }
  const validNumber = t => isObj(t) && typeof t.day === 'string' && t.day.length > 0 && Number.isInteger(t.number) && t.number > 0;
  // A new order's number on the main system (its own order, or a tablet's): from the cloud while it can be reached
  // (2 seconds at most), from its own count while it can't
  async function mainNumber(after = 0) {
    after = Math.max(Number.isInteger(after) ? after : 0, knownToday());
    if (cloudConfig() && Cloud.reachable()) {
      const t = await Cloud.number(after, 2000).catch(() => null);
      if (validNumber(t)) { sawNumber(t); return { day: t.day, number: t.number }; }
    }
    return ownNumber(after);
  }
  // Whether this tablet can fire an order now: always on its own and as the main system; otherwise while it reaches the
  // main system, or the cloud once it is set up
  function canFire() { return device.main || !upstream() || Boolean(Local.hubId()) || (Boolean(cloudConfig()) && Cloud.reachable()); }
  // The number for a new order being fired: { day, number }, or null if this tablet reaches no one to give it (then the
  // order isn't fired). The main system first; the cloud while the main system can't be reached, or doesn't answer.
  async function takeNumber() {
    if (device.main) return mainNumber();
    if (!upstream()) return ownNumber();
    let t = Local.hubId() ? await Local.number(knownToday()) : null;
    if (!validNumber(t) && cloudConfig() && Cloud.reachable()) t = await Cloud.number(knownToday()).catch(() => null);
    if (!validNumber(t)) return null;
    sawNumber(t);
    return { day: t.day, number: t.number };
  }
  // A number without asking anyone (orders moved over from an earlier version of the app): this tablet's own next one
  const nextNumber = () => ownNumber().number;
  // The number a new order on screen will have, as far as this tablet knows (it takes nothing): shown on Counter until
  // the order is fired and given its number. Another tablet firing first moves it on to the next one.
  const upcomingNumber = () => nextOn(today());

  // ---------- bill numbers (Update Pack 3) ----------
  // A bill's own number, apart from the order's ("Bill #B-2045 · Order #1015"): the tax invoice's serial, one series for
  // the whole restaurant, every number once, starting again at B-1 each financial year (1 April, as GST allows). Kept in
  // one place like the ticket numbers: the cloud while it can be reached, the main system while the internet is down; a
  // tablet on its own counts by itself. An order keeps its bill number (billNo) and year (billYear, "2026-27").
  const BILL_KEY = 'restro.sync.billNumber.v1';
  const yearOf = t => { const d = new Date(t), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };
  const highestBill = (year, docs) => Math.max(0, ...[...(docs || readDocs('orders')).values()].filter(o => o.billYear === year && Number.isInteger(o.billNo)).map(o => o.billNo));
  function nextBill(year) { const t = load(BILL_KEY, null), seen = isObj(t) && t.year === year ? Number(t.next) || 1 : 1; return Math.max(seen, highestBill(year) + 1); }
  function sawBill(doc) {
    if (!isObj(doc) || !Number.isInteger(doc.billNo) || typeof doc.billYear !== 'string' || doc.billYear !== yearOf(now())) return;
    const t = load(BILL_KEY, null), next = isObj(t) && t.year === doc.billYear ? Number(t.next) || 1 : 1;
    if (doc.billNo >= next) save(BILL_KEY, { year: doc.billYear, next: doc.billNo + 1 });
  }
  const knownBills = () => nextBill(yearOf(now())) - 1;
  function ownBill(after = 0) {
    const year = yearOf(now()), number = Math.max(nextBill(year), after + 1);
    save(BILL_KEY, { year, next: number + 1 });
    return { year, number };
  }
  const validBill = t => isObj(t) && typeof t.year === 'string' && /^\d{4}-\d{2}$/.test(t.year) && Number.isInteger(t.number) && t.number > 0;
  async function mainBill(after = 0) {
    after = Math.max(Number.isInteger(after) ? after : 0, knownBills());
    if (cloudConfig() && Cloud.reachable()) {
      const t = await Cloud.number(after, 2000, 'bill').catch(() => null);
      if (validBill(t)) { sawBill({ billNo: t.number, billYear: t.year }); return { year: t.year, number: t.number }; }
    }
    return ownBill(after);
  }
  // The number for a bill printed (or paid) for the first time: { year, number }, or null if this tablet reaches no one
  // to give it (then the bill doesn't print)
  async function takeBillNumber() {
    if (device.main) return mainBill();
    if (!upstream()) return ownBill();
    let t = Local.hubId() ? await Local.number(knownBills(), 'bill') : null;
    if (!validBill(t) && cloudConfig() && Cloud.reachable()) t = await Cloud.number(knownBills(), 3000, 'bill').catch(() => null);
    if (!validBill(t)) return null;
    sawBill({ billNo: t.number, billYear: t.year });
    return { year: t.year, number: t.number };
  }

  // ---------- KOT numbers (Update Pack 4, A2) ----------
  // One sequence a day for the whole restaurant, from 1, like the ticket numbers and kept in the same place: the cloud
  // while it can be reached, the main system while the internet is down. A KOT gets its number when it prints (a queued
  // scheduled KOT has none until then). Unlike a ticket number, a KOT is never held back: a tablet that reaches neither
  // the main system nor the cloud numbers it from its own count, past every KOT it has given or seen that day, so the
  // kitchen always gets it.
  const KOT_KEY = 'restro.sync.kotNumber.v1';
  const kotsIn = o => (Array.isArray(o?.kots) ? o.kots : []).filter(k => isObj(k) && (k.kind || 'kot') === 'kot' && Number.isInteger(k.no) && k.no > 0);
  const highestKot = (day, docs) => Math.max(0, ...[...(docs || readDocs('orders')).values()].flatMap(o => kotsIn(o).filter(k => dayOf(Number(k.at) || 0) === day).map(k => k.no)));
  function nextKot(day) { const t = load(KOT_KEY, null), seen = isObj(t) && t.day === day ? Number(t.next) || 1 : 1; return Math.max(seen, highestKot(day) + 1); }
  const knownKots = () => nextKot(today()) - 1;
  function ownKot(after = 0) {
    const day = today(), number = Math.max(nextKot(day), after + 1);
    save(KOT_KEY, { day, next: number + 1 });
    return { day, number };
  }
  async function mainKot(after = 0) {
    after = Math.max(Number.isInteger(after) ? after : 0, knownKots());
    if (cloudConfig() && Cloud.reachable()) {
      const t = await Cloud.number(after, 2000, 'kot').catch(() => null);
      if (validNumber(t) && t.day === today()) { save(KOT_KEY, { day: t.day, next: Math.max(nextKot(t.day), t.number + 1) }); return { day: t.day, number: t.number }; }
    }
    return ownKot(after);
  }
  // The number for a KOT about to print: { day, number }. The main system first; the cloud while the main system can't
  // be reached or doesn't answer; this tablet's own count when neither does.
  async function takeKotNumber() {
    if (device.main) return mainKot();
    if (!upstream()) return ownKot();
    let t = Local.hubId() ? await Local.number(knownKots(), 'kot').catch(() => null) : null;
    if (!(validNumber(t) && t.day === today()) && cloudConfig() && Cloud.reachable()) t = await Cloud.number(knownKots(), 3000, 'kot').catch(() => null);
    if (!(validNumber(t) && t.day === today())) return ownKot();
    save(KOT_KEY, { day: t.day, next: Math.max(nextKot(t.day), t.number + 1) });
    return { day: t.day, number: t.number };
  }

  // ---------- tablets nearby: through the Android app (RESTRODevice.localSync) ----------
  // Pairing: the main system makes a code; the other tablets enter it once. A key made from the code (PBKDF2) seals every
  // message (AES-GCM), so only the restaurant's tablets can read one or be believed; the name the tablets look for each
  // other by is made from the code the same slow way, so it doesn't give the code away.
  async function makeKeys(code) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(cleanCode(code)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('restro-local-sync-v1'), iterations: 100000 }, base, 512));
    const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { key, service: `restro-${[...bits.slice(32, 38)].map(b => b.toString(16).padStart(2, '0')).join('')}` };
  }
  const b64 = bytes => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const Local = (() => {
    let stop = null, peers = [], waiting = new Map(), status = 'unavailable', key = null, generation = 0;
    const bridge = () => window.RESTRODevice?.localSync;
    const hubPeer = () => (device.main || !pair ? null : peers.find(p => p.main) || null);
    function setStatus(s) { status = s; emitStatus(); }
    async function seal(msg) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(msg)));
      return JSON.stringify({ v: PROTOCOL, iv: b64(iv), data: b64(data) });
    }
    async function open(text) {
      const env = JSON.parse(text);
      if (!isObj(env) || env.v !== PROTOCOL) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
      return JSON.parse(new TextDecoder().decode(plain));
    }
    // Sends to one tablet, or to all of them (to = null). The sealed message names its sender.
    async function send(msg, to = null) {
      if (!key || !bridge()) return false;
      try { await bridge().send(await seal({ ...msg, sender: device.id }), to); return true; } catch { return false; }
    }
    // A request to the main system; resolves with its answer, or null after `wait` (10 seconds unless said).
    function request(msg, to = hubPeer()?.id, wait = 10000) {
      if (!to) return Promise.resolve(null);
      const id = rand(10);
      return new Promise(resolve => {
        const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, wait);
        waiting.set(id, r => { clearTimeout(timer); resolve(r); });
        send({ ...msg, rid: id }, to).then(ok => { if (!ok && waiting.delete(id)) { clearTimeout(timer); resolve(null); } });
      });
    }
    async function onMessage(fromId, text) {
      let msg; try { msg = await open(text); } catch { return; } // not the restaurant's, or tampered with
      if (!isObj(msg) || msg.sender !== fromId) return;
      if (msg.re) { const done = waiting.get(msg.re); if (done) { waiting.delete(msg.re); done(msg); } return; }
      if (device.main) {
        // The main system answers the tablets
        if (msg.t === 'pull') send({ t: 'batch', re: msg.rid, server: device.id, ...hubChangesSince(Number(msg.since) || 0) }, fromId);
        else if (msg.t === 'push') {
          const { results, accepted } = hubAccept(Array.isArray(msg.changes) ? msg.changes.slice(0, 500) : []);
          send({ t: 'ack', re: msg.rid, results }, fromId);
          if (accepted.length) broadcast({ t: 'batch', server: device.id, from: accepted[0].seq, seq: hub.seq, changes: accepted });
        } else if (msg.t === 'number') (msg.series === 'bill' ? mainBill(Number(msg.after)) : msg.series === 'kot' ? mainKot(Number(msg.after)) : mainNumber(Number(msg.after))).then(t => send({ t: 'number', re: msg.rid, ...t }, fromId)); // a tablet firing a new order (or printing a bill or a KOT)
        return;
      }
      // Other tablets: changes passed on by the main system as they happen
      if (msg.t === 'batch' && msg.server === hubPeer()?.id) {
        const cursor = cursorOf();
        if (Number(msg.from) > cursor + 1) { pull(); return; } // missed some: fetch from where this tablet is
        applyRemote(Array.isArray(msg.changes) ? msg.changes : []); setCursor(Math.max(cursor, Number(msg.seq) || 0));
      }
    }
    const cursorOf = () => { const c = state.cursors.hub; return isObj(c) && c.server === hubPeer()?.id ? Number(c.seq) || 0 : 0; };
    const setCursor = seq => { state.cursors.hub = { server: hubPeer()?.id, seq }; keepMeta(); };
    let pulling = false;
    async function pull() {
      if (pulling || !hubPeer()) return; pulling = true;
      try {
        for (let guard = 0; guard < 60; guard++) {
          const since = cursorOf();
          const page = await request({ t: 'pull', since }); if (!page) break;
          if (Number(page.seq) < since) { setCursor(0); continue; } // the main system started over: fetch everything
          applyRemote(Array.isArray(page.changes) ? page.changes : []); setCursor(Number(page.seq) || since);
          if (!page.more) break;
        }
      } finally { pulling = false; emitStatus(); }
    }
    let pushing = false;
    async function push() {
      if (pushing || !hubPeer() || upstream() !== 'hub') return; pushing = true;
      try {
        for (let guard = 0; guard < 20; guard++) {
          const changes = unsent(); if (!changes.length) break;
          const reply = await request({ t: 'push', changes }); if (!reply) break;
          handleResults(reply.results); // refused ones are merged and go in the next round
        }
      } finally { pushing = false; emitStatus(); }
    }
    async function sync() { await push(); await pull(); await push(); }
    // The next ticket number, through the main system (3 seconds at most, as someone is waiting to fire the order).
    // `after`: the highest number this tablet knows of today.
    async function number(after, series) {
      const r = await request({ t: 'number', after, ...(series ? { series } : {}) }, hubPeer()?.id, 3000);
      return r ? (series === 'bill' ? { year: r.year, number: r.number } : { day: r.day, number: r.number }) : null;
    }
    // The main system counts as there until it has been gone a few seconds (and while a tablet starting up looks for it).
    // Gone longer, a tablet signed in to the cloud carries on with the cloud, and comes back when the main system does.
    const HUB_GRACE = 5000;
    let hubSeenAt = now(), fallback = null;
    const hubAway = () => !hubPeer() && now() - hubSeenAt > HUB_GRACE;
    function watchHub() {
      clearTimeout(fallback);
      if (!device.main && pair && cloudConfig() && !hubPeer()) fallback = setTimeout(() => { if (upstream() === 'cloud') Cloud.sync(); }, Math.max(0, hubSeenAt + HUB_GRACE - now()) + 100);
    }
    function onPeers(list) {
      const before = hubPeer()?.id;
      peers = (Array.isArray(list) ? list : []).filter(p => isObj(p) && typeof p.id === 'string' && p.id !== device.id).map(p => ({ id: p.id, name: String(p.name || '').slice(0, 40), main: Boolean(p.main) }));
      const hp = hubPeer();
      setStatus(device.main ? 'main' : !pair ? 'unpaired' : hp ? 'connected' : 'searching');
      if (hp || before) hubSeenAt = now();
      if (hp && hp.id !== before) sync();
      watchHub();
    }
    async function start() {
      const gen = ++generation;
      if (stop) { try { stop(); } catch {} stop = null; }
      peers = []; key = null; hubSeenAt = now(); watchHub();
      if (!bridge()) { setStatus('unavailable'); return; }
      if (!pair) { setStatus('unpaired'); return; }
      const keys = await makeKeys(pair.code);
      if (gen !== generation) return; // started again meanwhile
      key = keys.key;
      try {
        const handle = bridge().start({ deviceId: device.id, name: device.name, main: Boolean(device.main), service: keys.service, protocol: PROTOCOL },
          (from, text) => onMessage(from, text), list => onPeers(list));
        stop = typeof handle === 'function' ? handle : handle && typeof handle.stop === 'function' ? () => handle.stop() : null;
        setStatus(device.main ? 'main' : 'searching');
      } catch { setStatus('unavailable'); }
    }
    return { start, send, push, pull, sync, number, hubAway, watchHub, hubId: () => hubPeer()?.id || null, hubName: () => hubPeer()?.name || null, peers: () => peers.slice(), status: () => status };
  })();
  function broadcast(msg) { if (device.main) Local.send(msg); }

  // ---------- the cloud (set up later; see SYNC.md) ----------
  // Configured with { endpoint, restaurantId, token } once the restaurant signs in; until then nothing goes out. The main
  // system and a tablet without one sync with it; so does a tablet paired with the main system while it can't reach the
  // main system, and it asks the cloud for ticket numbers then.
  const Cloud = (() => {
    let status = 'not-set-up', lastSync = 0, busy = false, again = false, failures = 0, timer = null, live = null;
    const online = () => navigator.onLine !== false && window.RestroConnectivity?.getStatus?.().internetAvailable !== false;
    // Worth trying: online, and the last call didn't fail (a sync tries again)
    const reachable = () => online() && status !== 'offline';
    async function call(method, path, body, wait = 20000) {
      const cfg = cloudConfig(); if (!cfg) throw new Error('not set up');
      const stopper = new AbortController(), timer = setTimeout(() => stopper.abort(), wait);
      try {
        const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/v1/restaurants/${encodeURIComponent(cfg.restaurantId)}${path}`, {
          method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'X-Restro-Device': device.id, 'X-Restro-Protocol': String(PROTOCOL) },
          body: body ? JSON.stringify(body) : undefined, signal: stopper.signal
        });
        if (!res.ok) throw new Error(`cloud ${res.status}`);
        return await res.json();
      } finally { clearTimeout(timer); }
    }
    async function pushAll() {
      for (let guard = 0; guard < 20; guard++) {
        const changes = unsent(); if (!changes.length) break;
        const reply = await call('POST', '/sync/push', { device: device.id, protocol: PROTOCOL, changes });
        handleResults(reply.results);
      }
    }
    async function sync() {
      if (upstream() !== 'cloud') { status = 'not-set-up'; emitStatus(); return; }
      if (!online()) { status = 'offline'; emitStatus(); schedule(); return; }
      if (busy) { again = true; return; }
      busy = true; again = false;
      try {
        await pushAll();
        for (let guard = 0; guard < 60; guard++) {
          const since = Number(state.cursors.cloud) || 0;
          const page = await call('GET', `/sync/pull?since=${since}&limit=300`);
          if (Number(page.seq) < since) { state.cursors.cloud = 0; continue; } // the cloud started over: fetch everything
          applyRemote(Array.isArray(page.changes) ? page.changes : []); state.cursors.cloud = Number(page.seq) || since; keepMeta();
          if (!page.more) break;
        }
        await pushAll(); // what the merges made
        status = 'synced'; lastSync = now(); failures = 0;
      } catch { status = 'offline'; failures++; }
      finally { busy = false; emitStatus(); schedule(); if (again) sync(); }
    }
    function schedule() { clearTimeout(timer); if (upstream() !== 'cloud') return; timer = setTimeout(sync, Math.min(60000, 15000 * Math.max(1, failures))); }
    // The next ticket number of today, past `after` (the highest number the asking tablet knows of today): { day, number }.
    // A failure counts as the cloud being unreachable until a sync gets through again.
    async function number(after, wait = 3000, series) {
      try { return await call('POST', '/numbers/next', { device: device.id, day: today(), after, ...(series === 'bill' ? { series: 'bill', year: yearOf(now()) } : series === 'kot' ? { series: 'kot' } : {}) }, wait); }
      catch (e) { status = 'offline'; failures++; emitStatus(); schedule(); throw e; }
    }
    // Live changes from the cloud, when it offers them (a WebSocket; the token goes in the first message, never in the
    // address). Fetching every 15 seconds carries on either way.
    function connectLive() {
      const cfg = cloudConfig(); if (!cfg || live || upstream() !== 'cloud' || typeof WebSocket === 'undefined') return;
      try {
        live = new WebSocket(`${cfg.endpoint.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/restaurants/${encodeURIComponent(cfg.restaurantId)}/sync/live`);
        live.onopen = () => { try { live.send(JSON.stringify({ t: 'auth', token: cfg.token, device: device.id, since: Number(state.cursors.cloud) || 0 })); } catch {} };
        live.onmessage = e => {
          try {
            const m = JSON.parse(e.data), cursor = Number(state.cursors.cloud) || 0;
            if (isObj(m) && Array.isArray(m.changes) && Number(m.from) <= cursor + 1) { applyRemote(m.changes); state.cursors.cloud = Math.max(cursor, Number(m.seq) || 0); keepMeta(); }
            else sync();
          } catch {}
        };
        live.onclose = () => { live = null; setTimeout(connectLive, 30000); };
      } catch { live = null; }
    }
    window.addEventListener('online', () => { if (upstream() === 'cloud') { status = 'syncing'; sync(); } });
    window.addEventListener('offline', () => { if (upstream() === 'cloud') { status = 'offline'; emitStatus(); } });
    return { sync, reachable, number, connectLive, status: () => status, lastSync: () => lastSync };
  })();

  // ---------- joining ----------
  // A server comes into the picture (this tablet is paired with the main system, made the main system, or the cloud is
  // set up): everything this tablet has goes to its server once. Its orders, numbered on its own, are marked provisional,
  // so the server keeps their numbers where no other order that day has them and gives the others the next ones. Where
  // the server already has another version of a record (the restaurant's name, say), the server's stays.
  function join() {
    const first = state.mode !== 'multi';
    state.mode = 'multi';
    if (device.main) hubLogAll();
    if (upstream()) {
      if (first) markOrdersProvisional();
      offerAll();
    }
    keepMeta(); keepHub();
  }
  function markOrdersProvisional() {
    const key = COLLECTIONS.orders.key; let list;
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return; }
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const o of list) if (isObj(o) && Number.isInteger(o.number) && !o.numberProvisional) { o.numberProvisional = true; o.day = orderDay(o); changed = true; }
    if (changed) { try { localStorage.setItem(key, JSON.stringify(list)); } catch {} wrote(key); }
  }
  function offerAll() {
    for (const name of NAMES) {
      for (const [id, doc] of readDocs(name)) {
        const json = JSON.stringify(doc);
        const m = meta[name][id] || (meta[name][id] = { h: tick(), s: hash(json), pv: null });
        if (!m.p) { m.p = 1; m.b = m.h; m.bd = json; } // made on its own version: a server with another one keeps its own
      }
      for (const m of Object.values(meta[name])) if (m.x && !m.p) { m.p = 1; m.b = m.h; m.bd = null; }
    }
    keepMeta();
  }
  // Deletions are remembered for 30 days (long enough for every tablet to hear of them)
  function pruneTombstones() {
    const cutoff = now() - 30 * 86400000;
    for (const name of NAMES) for (const [id, m] of Object.entries(meta[name])) if (m.x && !m.p && parse(m.h).l < cutoff) delete meta[name][id];
    for (const key of Object.keys(hub.log)) { const cut = key.indexOf('/'); if (!meta[key.slice(0, cut)]?.[key.slice(cut + 1)]) delete hub.log[key]; }
  }

  // ---------- status, for Settings ----------
  function pendingCount() { let n = 0; for (const name of NAMES) for (const m of Object.values(meta[name])) if (m.p) n++; return n; }
  function status() {
    const peers = Local.peers();
    return {
      device: { ...device }, mode: state.mode, upstream: upstream(), paired: Boolean(pair), pairCode: device.main ? pair?.code || null : null,
      local: { state: Local.status(), hub: Local.hubName(), tablets: peers.length, otherMains: device.main ? peers.filter(p => p.main).length : Math.max(0, peers.filter(p => p.main).length - 1) },
      cloud: { state: Cloud.status(), lastSync: Cloud.lastSync(), setUp: Boolean(cloudConfig()) }, waiting: pendingCount()
    };
  }
  let statusTimer = null;
  function emitStatus() { clearTimeout(statusTimer); statusTimer = setTimeout(() => emit('restro:sync-status', status()), 50); }

  // ---------- start ----------
  // Snapshots of what each collection holds now; anything changed while the app wasn't running counts as a change.
  {
    const started = [];
    for (const name of NAMES) {
      const docs = readDocs(name), map = new Map();
      for (const [id, doc] of docs) {
        const json = JSON.stringify(doc); map.set(id, json);
        const m = meta[name][id];
        if (!m) { meta[name][id] = upMark(null, null, { h: tick(), s: hash(json), pv: null }); started.push([name, id]); }
        else if (m.x || m.s !== hash(json)) { markLocal(name, id, json, null); started.push([name, id]); }
      }
      for (const [id, m] of Object.entries(meta[name])) if (!docs.has(id) && !m.x && !m.p) delete meta[name][id]; // cleared here only
      snap[name] = map;
    }
    pruneTombstones();
    if (device.main && state.mode === 'multi') { for (const [name, id] of started) { hub.seq++; hubRecord(name, id, hub.seq); } hubLogAll(); }
    keepMeta(); keepHub();
  }

  window.RestroSync = Object.freeze({
    wrote, removed, takeNumber, takeBillNumber, takeKotNumber, canFire, nextNumber, upcomingNumber, newId, mergeRecord, today, orderDay, dayOf,
    status,
    get device() { return { ...device }; },
    setDeviceName(name) { device.name = String(name || '').trim().slice(0, 30) || device.name; save(DEVICE, device); Local.start(); emitStatus(); },
    // The main system: the tablet the printers are wired to. It makes the pairing code the others enter (a paired tablet
    // made the main system keeps the code it has, so the others carry on with it).
    setMain(on) {
      on = Boolean(on); if (on === Boolean(device.main)) return;
      device.main = on; save(DEVICE, device);
      if (on && !pair) { pair = { code: `${codeChars(3)}-${codeChars(3)}` }; save(PAIR, pair); }
      join(); Local.start(); emitStatus(); schedulePush();
    },
    // Another tablet: the main system's pairing code, entered once. Returns false for a code that can't be one.
    pairWith(code) {
      const clean = cleanCode(code);
      if (device.main || !/^[A-HJKMNP-Z2-9]{6}$/.test(clean)) return false;
      pair = { code: `${clean.slice(0, 3)}-${clean.slice(3)}` }; save(PAIR, pair);
      join(); Local.start(); emitStatus(); return true;
    },
    // Once the restaurant signs in to the cloud: { endpoint, restaurantId, token }
    configureCloud(cfg) {
      if (isObj(cfg) && typeof cfg.endpoint === 'string' && typeof cfg.restaurantId === 'string' && typeof cfg.token === 'string') {
        save(CLOUD, { endpoint: cfg.endpoint, restaurantId: cfg.restaurantId, token: cfg.token });
        join(); Cloud.sync(); Cloud.connectLive(); Local.watchHub();
      } else { try { localStorage.removeItem(CLOUD); } catch {} }
      emitStatus();
    },
    syncNow() { const up = upstream(); return up === 'hub' ? Local.sync() : up === 'cloud' ? Cloud.sync() : Promise.resolve(); }
  });

  // ---------- Settings › Devices ----------
  const ago = t => { const m = Math.round((now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  function localText(st) {
    const l = st.local;
    if (l.otherMains) return 'Another tablet is also set as the main system. Keep only one.';
    if (l.state === 'unavailable') return 'Starts in the RESTRO Android app, over Wi-Fi or Bluetooth';
    if (l.state === 'unpaired') return 'Not paired yet: enter the main system’s pairing code';
    if (l.state === 'searching') return 'Looking for the main system…';
    if (l.state === 'connected') return `Connected to ${l.hub || 'the main system'}`;
    return l.tablets ? `${l.tablets} other tablet${l.tablets === 1 ? '' : 's'} connected` : 'Waiting for the other tablets';
  }
  function cloudText(st) {
    if (st.upstream === 'hub') return 'Through the main system';
    const waiting = st.waiting ? ` · ${st.waiting} change${st.waiting === 1 ? '' : 's'} waiting` : '';
    if (st.cloud.state === 'not-set-up') return 'Not set up yet';
    if (st.cloud.state === 'synced') return `Up to date${st.cloud.lastSync ? ` · ${ago(st.cloud.lastSync)}` : ''}`;
    if (st.cloud.state === 'offline') return `Offline${waiting}`;
    return 'Syncing…';
  }
  function bindSettings() {
    const $ = s => document.querySelector(s), name = $('#sync-name'), main = $('#sync-main');
    if (!name || !main) return;
    name.value = device.name;
    name.addEventListener('change', () => { window.RestroSync.setDeviceName(name.value); name.value = device.name; });
    main.addEventListener('change', () => window.RestroSync.setMain(main.checked));
    $('#sync-pair-row')?.addEventListener('submit', e => {
      e.preventDefault();
      const ok = window.RestroSync.pairWith($('#sync-pair-code').value);
      $('#sync-pair-note').textContent = ok ? 'Paired. This tablet finds the main system through the RESTRO Android app.' : 'Enter the 6 letters and numbers shown on the main system.';
      if (ok) $('#sync-pair-code').value = '';
    });
    const paint = st => {
      main.checked = st.device.main;
      $('#sync-code-row').hidden = !st.device.main; $('#sync-code').textContent = st.pairCode || '';
      $('#sync-pair-row').hidden = st.device.main;
      $('#sync-local-status').textContent = localText(st);
      $('#sync-cloud-status').textContent = cloudText(st);
      const summary = $('#settings-sync-summary');
      if (summary) summary.textContent = st.device.main ? 'Main system' : st.local.state === 'connected' ? 'Connected to the main system' : st.paired ? 'Paired' : st.upstream === 'cloud' ? 'Through the cloud' : 'This tablet only';
    };
    window.addEventListener('restro:sync-status', e => paint(e.detail));
    paint(status());
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindSettings();
    Local.start(); emitStatus();
    if (upstream() === 'cloud') { Cloud.sync(); Cloud.connectLive(); }
    // A safety net for anything a dropped message missed: send what waits and fetch anything new, every 15 seconds
    setInterval(() => { if (upstream() === 'hub' && Local.hubId()) Local.sync(); }, 15000);
  });
})();
