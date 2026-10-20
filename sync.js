'use strict';
// Sync: keeps the restaurant's data the same on every tablet of the restaurant. (SYNC.md has the details.)
//
// What syncs: orders, held tickets, customers, staff (PINs only as hashes) and the restaurant's details (name, profile,
// preparation time). What stays on each tablet: its looks and layouts (theme, tile style, sounds, home screen, tile
// order), the order being rung up, and who is signed in.
//
// How:
// - Every tablet works on its own copy (localStorage), so it never waits for a network. When a screen saves shared data
//   it calls RestroSync.wrote(key): each record that changed gets a version (a hybrid clock stamp: time · counter ·
//   tablet) and waits to be sent. A record deleted on purpose goes through RestroSync.removed(), so the deletion travels
//   too; records a tablet only clears from itself (paid orders past the latest 500, held tickets after their day) don't.
// - Every tablet has one server, which puts the changes in order and hands them out:
//     · the main system (the tablet the printers are wired to) for the tablets paired with it, over the restaurant's own
//       Wi-Fi or Bluetooth through the Android app (RESTRODevice.localSync, see ANDROID-BRIDGE.md), so the restaurant
//       keeps working together when the internet drops;
//     · the cloud (once it is set up) for the main system, and for a tablet without one (the owner's, at home).
//   The cloud gets everything from the main system, and the tablets get the cloud's changes through it.
// - A server takes a change only if it was made on the server's latest version of that record. Otherwise it sends that
//   version back; the tablet merges the two (field by field against the version both started from; items added on both
//   sides are all kept; a payment is never undone) and sends the result. Nothing is lost when two tablets change the
//   same order, and the same change arriving twice changes nothing.
// - Ticket numbers come in blocks from the server, so two tablets never give the same number. A tablet cut off with none
//   left numbers on from the highest it knows and marks the order provisional; the server keeps that number if no one
//   else can have it, or gives the order the next free one (the tablet shows "Order #… is now #…").
// - Messages between tablets are encrypted with a key made from the restaurant's pairing code, so tablets of another
//   restaurant, or anyone else on the network, can't join or read them.
// Nothing here is part of the code or the website's data: everything stays on the tablets until the cloud exists.
(() => {
  const PROTOCOL = 1;

  // ---------- what syncs ----------
  // Collections: a list of records under one key, `id` naming a record, with the rules for merging two versions.
  const COLLECTIONS = {
    orders: { key: 'restro.counter.orders.v1', id: o => (typeof o?.uid === 'string' ? o.uid : Number.isFinite(o?.number) ? `n${o.number}` : null),
      rules: { keyed: { lines: l => `${l.id}@${l.type}`, kots: k => String(k.at) }, additive: { lines: 'qty' }, maxMap: ['sent'], sticky: ['paidAt', 'method', 'received', 'change'] } },
    held: { key: 'restro.counter.held.v1', id: h => (typeof h?.heldId === 'string' ? h.heldId : null), keep: h => !(Number.isFinite(h.holdUntil) && h.holdUntil <= Date.now()),
      rules: { keyed: { lines: l => `${l.id}@${l.type || ''}` }, additive: { lines: 'qty' } } },
    customers: { key: 'restro.customers.v1', id: c => (typeof c?.id === 'string' ? c.id : null) },
    staff: { key: 'restro.staff.v1', id: p => (typeof p?.id === 'string' ? p.id : null) }
  };
  // Settings: one value per key, synced as the records { value } of 'settings'. The name's placeholder is no name, so it
  // never travels (a new tablet takes the restaurant's name from the others).
  const VALUES = {
    restaurantName: { key: 'restro.restaurantName', raw: true, placeholder: 'RESTAURANT NAME' },
    profile: { key: 'restro.profile.v1' },
    prepMinutes: { key: 'restro.counter.prepMinutes.v1' }
  };
  const NAMES = [...Object.keys(COLLECTIONS), 'settings'];
  const NUM_KEY = 'restro.counter.nextNumber.v1';
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
  // This tablet's server: the main system for a tablet paired with one; the cloud for the main system and for a tablet
  // without one, once it is set up; none for a tablet on its own.
  const upstream = () => (device.main ? (cloudConfig() ? 'cloud' : null) : pair ? 'hub' : cloudConfig() ? 'cloud' : null);

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
  // mode: 'solo' until a server is in the picture; cursors: how far this tablet has fetched from each server; lease and
  // spare: blocks of ticket numbers
  const state = Object.assign({ mode: 'solo', cursors: {}, lease: null, spare: null }, load(STATE, {}));
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
    const subtotal = doc.lines.reduce((s, l) => s + Math.round(l.price * 100) * l.qty, 0);
    const rate = window.RestroMenu?.taxRate ?? (doc.subtotal ? doc.tax / doc.subtotal : 0);
    const tax = Math.round(subtotal * rate);
    const out = { ...doc, subtotal, tax, total: subtotal + tax, count: doc.lines.reduce((n, l) => n + l.qty, 0) };
    if (Array.isArray(doc.kots)) {
      const sent = { ...(isObj(doc.sent) ? doc.sent : {}) }, fromTickets = {};
      for (const k of doc.kots) for (const l of Array.isArray(k?.lines) ? k.lines : []) if (Number.isFinite(l?.qty)) fromTickets[`${l.id}@${l.type}`] = (fromTickets[`${l.id}@${l.type}`] || 0) + l.qty;
      for (const [key, n] of Object.entries(fromTickets)) sent[key] = Math.max(Number(sent[key]) || 0, n);
      out.sent = sent;
    }
    return out;
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
  // version than its own (sending its version back), hands out what each tablet hasn't had yet, and gives out the ticket
  // numbers (from the cloud's blocks once the cloud is set up). Its own changes go in the same way.
  const HUB = 'restro.sync.hub.v1';
  const hub = Object.assign({ seq: 0, log: {}, next: 0, end: null }, load(HUB, {}));
  if (!isObj(hub.log)) hub.log = {};
  let hubTimer = null;
  function keepHub() { clearTimeout(hubTimer); hubTimer = setTimeout(() => save(HUB, hub), 200); }
  function hubRecord(name, id, seq) { hub.log[`${name}/${id}`] = seq; }
  function hubStartNumbers() {
    if (hub.end != null) return;
    const legacy = Number(load(NUM_KEY, 1001)) || 1001;
    const highest = Math.max(0, ...[...readDocs('orders').values()].map(o => (Number.isInteger(o.number) ? o.number : 0)));
    hub.next = Math.max(hub.next || 0, legacy, highest + 1); keepHub();
  }
  // Ticket numbers from the main system: its own count without the cloud; with it, only what is left of the cloud's block.
  function hubTake(count) {
    if (cloudConfig() && hub.end == null) return null;
    if (!hub.next) hubStartNumbers();
    if (hub.end != null) { const left = hub.end - hub.next + 1; if (left <= 0) return null; count = Math.min(count, left); }
    const from = hub.next; hub.next += count; keepHub();
    return { from, to: from + count - 1 };
  }
  // Without the cloud the main system settles ticket numbers: a provisional number stays if it was never handed out and
  // no other order has it; otherwise, and for an open order whose number another order has, the order gets the next free
  // one. Returns the order with its number settled, or null if it stays as it is.
  function settleNumber(id, doc, docs) {
    if (cloudConfig() || !Number.isInteger(doc.number)) return null;
    if (!hub.next) hubStartNumbers();
    const n = doc.number, idOf = COLLECTIONS.orders.id;
    const taken = [...docs.values()].some(o => o.number === n && idOf(o) !== id);
    if (!doc.numberProvisional && !(taken && !doc.paidAt)) { if (n >= hub.next) { hub.next = n + 1; keepHub(); } return null; }
    let number = n;
    if (doc.numberProvisional && !taken && n >= hub.next) { hub.next = n + 1; keepHub(); }
    else { const block = hubTake(1); if (!block) return null; number = block.from; }
    const { numberProvisional, ...rest } = doc;
    return { ...rest, number, ...(number !== n ? { numberWas: Number.isInteger(rest.numberWas) ? rest.numberWas : n } : {}) };
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
      for (const ch of changes) {
        hub.seq++; hubRecord(ch.c, ch.i, hub.seq); ch.seq = hub.seq;
        if (!cloudConfig() && ch.c === 'orders' && ch.doc && Number.isInteger(ch.doc.number) && ch.doc.number >= (hub.next || 0)) hub.next = ch.doc.number + 1;
      }
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
  // A tablet on its own counts as before. With a server, numbers come in blocks of 50 from it (the next block is fetched
  // before this one runs out); the main system numbers from its own count (the cloud's block once there is a cloud). A
  // tablet cut off with none left numbers on from the highest it knows, and the order is marked so (numberProvisional).
  const BLOCK = 50;
  let provisional = false;
  const validBlock = b => isObj(b) && Number.isInteger(b.from) && Number.isInteger(b.to) && b.to >= b.from;
  function nextNumber() {
    provisional = false;
    if (state.mode !== 'multi') { const n = Number(load(NUM_KEY, 1001)) || 1001; save(NUM_KEY, n + 1); return n; }
    if (device.main) { const b = hubTake(1); if (b) return b.from; }
    if ((!state.lease || state.lease.next > state.lease.to) && state.spare) { state.lease = { ...state.spare, next: state.spare.from }; state.spare = null; }
    if (state.lease && state.lease.next <= state.lease.to) { const n = state.lease.next++; keepMeta(); refill(); return n; }
    refill();
    const highest = Math.max(Number(load(NUM_KEY, 1001)) - 1 || 1000, ...[...readDocs('orders').values()].map(o => (Number.isInteger(o.number) ? o.number : 0)));
    save(NUM_KEY, highest + 2); provisional = true;
    return highest + 1;
  }
  let refilling = false;
  async function refill() {
    const left = (state.lease ? Math.max(0, state.lease.to - state.lease.next + 1) : 0) + (state.spare ? state.spare.to - state.spare.from + 1 : 0);
    const up = upstream();
    if (refilling || left >= 20 || state.mode !== 'multi' || !up || (device.main && up !== 'cloud')) return;
    refilling = true;
    try {
      const block = up === 'cloud' ? (Cloud.ready() ? await Cloud.lease(BLOCK) : null) : Local.hubId() ? await Local.lease(BLOCK) : null;
      if (validBlock(block)) {
        if (!state.lease || state.lease.next > state.lease.to) state.lease = { from: block.from, to: block.to, next: block.from };
        else state.spare = { from: block.from, to: block.to };
        keepMeta();
      }
    } catch {} finally { refilling = false; }
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
    // A request to the main system; resolves with its answer, or null after 10 seconds.
    function request(msg, to = hubPeer()?.id) {
      if (!to) return Promise.resolve(null);
      const id = rand(10);
      return new Promise(resolve => {
        const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, 10000);
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
        } else if (msg.t === 'lease') {
          const count = Math.min(200, Math.max(1, Number(msg.count) || BLOCK));
          let block = hubTake(count);
          if (!block && upstream() === 'cloud' && Cloud.ready()) block = await Cloud.lease(count).catch(() => null);
          send({ t: 'lease', re: msg.rid, block: validBlock(block) ? block : null }, fromId);
        }
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
    async function sync() { await push(); await pull(); await push(); refill(); }
    async function lease(count) { const r = await request({ t: 'lease', count }); return r && validBlock(r.block) ? r.block : null; }
    function onPeers(list) {
      const before = hubPeer()?.id;
      peers = (Array.isArray(list) ? list : []).filter(p => isObj(p) && typeof p.id === 'string' && p.id !== device.id).map(p => ({ id: p.id, name: String(p.name || '').slice(0, 40), main: Boolean(p.main) }));
      const hp = hubPeer();
      setStatus(device.main ? 'main' : !pair ? 'unpaired' : hp ? 'connected' : 'searching');
      if (hp && hp.id !== before) sync();
    }
    async function start() {
      const gen = ++generation;
      if (stop) { try { stop(); } catch {} stop = null; }
      peers = []; key = null;
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
    return { start, send, push, pull, sync, lease, hubId: () => hubPeer()?.id || null, hubName: () => hubPeer()?.name || null, peers: () => peers.slice(), status: () => status };
  })();
  function broadcast(msg) { if (device.main) Local.send(msg); }

  // ---------- the cloud (set up later; see SYNC.md) ----------
  // Configured with { endpoint, restaurantId, token } once the restaurant signs in; until then nothing goes out. Only the
  // main system, and a tablet without one, talk to it.
  const Cloud = (() => {
    let status = 'not-set-up', lastSync = 0, busy = false, again = false, failures = 0, timer = null, live = null;
    const online = () => navigator.onLine !== false && window.RestroConnectivity?.getStatus?.().internetAvailable !== false;
    const ready = () => upstream() === 'cloud' && online() && status !== 'offline';
    async function call(method, path, body) {
      const cfg = cloudConfig(); if (!cfg) throw new Error('not set up');
      const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/v1/restaurants/${encodeURIComponent(cfg.restaurantId)}${path}`, {
        method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'X-Restro-Device': device.id, 'X-Restro-Protocol': String(PROTOCOL) },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) throw new Error(`cloud ${res.status}`);
      return res.json();
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
        if (device.main) topUpHubNumbers();
        refill();
      } catch { status = 'offline'; failures++; }
      finally { busy = false; emitStatus(); schedule(); if (again) sync(); }
    }
    function schedule() { clearTimeout(timer); if (upstream() !== 'cloud') return; timer = setTimeout(sync, Math.min(60000, 15000 * Math.max(1, failures))); }
    // `after`: the highest number this tablet knows of (handed out or on an order), so the cloud never gives one below it
    // (the main system may have numbered on its own before the cloud was set up).
    async function lease(count) {
      const after = Math.max(1000, (hub.next || 1) - 1, hub.end || 0, state.lease?.to || 0, state.spare?.to || 0, ...[...readDocs('orders').values()].map(o => (Number.isInteger(o.number) ? o.number : 0)));
      const r = await call('POST', '/numbers/lease', { device: device.id, count, after });
      return validBlock(r) ? { from: r.from, to: r.to } : null;
    }
    // The main system keeps a block of 200 numbers from the cloud for the tablets around it, for when the internet drops.
    async function topUpHubNumbers() {
      if (hub.end != null && hub.end - hub.next + 1 >= 50) return;
      try { const r = await lease(200); if (r) { if (hub.end == null || hub.next > hub.end) hub.next = r.from; hub.end = r.to; keepHub(); } } catch {}
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
    return { sync, lease, ready, connectLive, status: () => status, lastSync: () => lastSync };
  })();

  // ---------- joining ----------
  // A server comes into the picture (this tablet is paired with the main system, made the main system, or the cloud is
  // set up): numbers come in blocks from now on, and everything this tablet has goes to its server once. Its orders,
  // numbered on its own (every tablet on its own counts from 1001), are marked provisional, so the server keeps their
  // numbers where no other order has them and gives the others new ones. Where the server already has another version
  // of a record (the restaurant's name, say), the server's stays.
  function join() {
    const first = state.mode !== 'multi';
    state.mode = 'multi';
    if (device.main) { hubStartNumbers(); hubLogAll(); }
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
    for (const o of list) if (isObj(o) && Number.isInteger(o.number) && !o.numberProvisional) { o.numberProvisional = true; changed = true; }
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
      cloud: { state: Cloud.status(), lastSync: Cloud.lastSync() }, waiting: pendingCount()
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
    wrote, removed, nextNumber, newId, mergeRecord,
    get provisional() { return provisional; },
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
        join(); Cloud.sync(); Cloud.connectLive();
      } else { try { localStorage.removeItem(CLOUD); } catch {} }
      emitStatus();
    },
    syncNow() { const up = upstream(); return up === 'hub' ? Local.sync() : up === 'cloud' ? Cloud.sync() : Promise.resolve(); }
  });

  // ---------- Settings › Devices & sync ----------
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
