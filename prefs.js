'use strict';
// Settings added by the Update Pack of 9 Nov 2026 (Counter Update 7, Navigation & Lock Update 1), kept in one place:
// - The restaurant's own (shared by all its tablets through sync.js): Billing & charges, Business details (with its
//   Business hours and Bill number, Update Pack 4), the printers' settings and Staff & security.
// - This tablet's own: Display › Navigation (swipe gestures or the navigation bar, and its button order) and Go dark.
// Every value is checked as it is read, so a missing, old or bad value falls back to its default. Changes are announced
// with `restro:prefs-changed` ({ name }), here or from another tablet.
(() => {
  const DEFAULTS = Object.freeze({
    billing: {
      orderDiscount: { picks: [5, 10, 15, 20, 25] },
      dishDiscount: { picks: [10, 20, 50, 100] },
      serviceCharge: { picks: [2.5, 5, 7.5, 10] },
      packaging: { on: false, mode: 'flat', flat: 0, types: ['takeaway', 'delivery', 'phone'] },
      delivery: { on: false, flat: 0 }
    },
    business: { address: '', phone: '', phoneCountry: 'IN', email: '', gstin: '', fssai: '', footer: 'Thank you! Visit again.' },
    printers: {},
    security: { autoLock: 5 },
    navigation: { mode: 'swipe', order: 'back-left' },
    screen: { goDark: 5 },
    // (Update Pack 4) Business details › Business hours: each day open from `from` to `to` (minutes after midnight, in
    // 15s; a closing time at or before the opening time is the next morning, up to 6:00 am). The business day ends when
    // the restaurant closes (owner, 11 Nov 2026: "if it closes at 2 am, the day ends at 2 am"), or at midnight on a day it
    // closes before then: an order at 12:40 am belongs to the day before. 11:00 am – 2:00 am every day until changed.
    hours: { days: { mon: { open: true, from: 660, to: 120 }, tue: { open: true, from: 660, to: 120 }, wed: { open: true, from: 660, to: 120 }, thu: { open: true, from: 660, to: 120 },
      fri: { open: true, from: 660, to: 120 }, sat: { open: true, from: 660, to: 120 }, sun: { open: true, from: 660, to: 120 } } },
    // (Update Pack 4) Business details › Bill number: when a bill gets its number, at its first print ('print', the
    // default) or at payment ('payment'), and every change of it (`log`: { to, at, by }, the latest 20)
    billNumber: { at: 'print', log: [] }
  });
  const KEYS = Object.freeze({ billing: 'restro.billing.v1', business: 'restro.business.v1', printers: 'restro.printers.v1', security: 'restro.security.v1', navigation: 'restro.navigation.v1', screen: 'restro.screen.v1',
    hours: 'restro.hours.v1', billNumber: 'restro.billNumber.v1' });
  const SHARED = new Set(['billing', 'business', 'printers', 'security', 'hours', 'billNumber']);
  const DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const LATEST_CLOSE = 360; // (a closing time the next morning: 6:00 am at the latest)
  const AUTO_LOCK = Object.freeze([0, 1, 2, 5, 10, 15]);        // minutes; 0 = off
  const GO_DARK = Object.freeze([1, 2, 5, 10, 15, 30, 0]);      // minutes; 0 = never
  const LANGUAGES = Object.freeze(['English', 'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati']);
  const ROLES = Object.freeze(['bills', 'kitchen', 'both']);
  const TYPES = ['takeaway', 'delivery', 'phone'];

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; };
  const money = (v, fallback) => { const n = num(v, 0, 99999, NaN); return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback; };
  const text = (v, max, fallback) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : fallback);
  // Quick picks: as many as their pop-up shows (Discount 5, Dish discount 4, Service charge 4), smallest first
  const picks = (v, min, max, count, fallback) => {
    if (!Array.isArray(v)) return fallback;
    const out = [...new Set(v.map(Number).filter(n => Number.isFinite(n) && n >= min && n <= max).map(n => Math.round(n * 10) / 10))].sort((a, b) => a - b);
    return out.length ? out.slice(0, count) : fallback;
  };
  const CLEAN = {
    billing(v) {
      const d = DEFAULTS.billing, od = isObj(v?.orderDiscount) ? v.orderDiscount : {}, sc = isObj(v?.serviceCharge) ? v.serviceCharge : {};
      const dd = isObj(v?.dishDiscount) ? v.dishDiscount : {}, pk = isObj(v?.packaging) ? v.packaging : {}, dl = isObj(v?.delivery) ? v.delivery : {};
      return {
        orderDiscount: { picks: picks(od.picks, 1, 100, 5, d.orderDiscount.picks).map(Math.round) },
        dishDiscount: { picks: picks(dd.picks, 1, 100, 4, d.dishDiscount.picks).map(Math.round) },
        // (a service charge rate: up to one decimal place, at most 10%, as in its pop-up)
        serviceCharge: { picks: picks(sc.picks, 0.1, 10, 4, d.serviceCharge.picks) },
        packaging: { on: pk.on === true, mode: pk.mode === 'dish' ? 'dish' : 'flat', flat: money(pk.flat, 0), types: Array.isArray(pk.types) ? TYPES.filter(t => pk.types.includes(t)) : [...d.packaging.types] },
        delivery: { on: dl.on === true, flat: money(dl.flat, 0) }
      };
    },
    business(v) {
      const d = DEFAULTS.business;
      // (Update Pack 3: the restaurant's phone and email, from My Profile, printed under the address)
      return { address: text(v?.address, 160, ''), phone: text(v?.phone, 15, '').replace(/\D/g, ''), phoneCountry: /^[A-Z]{2}$/.test(v?.phoneCountry) ? v.phoneCountry : 'IN',
        email: text(v?.email, 120, '').toLowerCase(), gstin: text(v?.gstin, 15, '').toUpperCase().replace(/\s/g, ''), fssai: text(v?.fssai, 14, '').replace(/\D/g, ''), footer: typeof v?.footer === 'string' ? text(v.footer, 80, '') : d.footer };
    },
    printers(v) {
      const out = {};
      if (isObj(v)) for (const [id, p] of Object.entries(v)) {
        if (typeof id !== 'string' || id.length > 80 || !isObj(p)) continue;
        out[id] = { role: ROLES.includes(p.role) ? p.role : 'both', language: LANGUAGES.includes(p.language) ? p.language : 'English', copies: Math.round(num(p.copies, 1, 3, 1)) };
      }
      return out;
    },
    security(v) { return { autoLock: AUTO_LOCK.includes(Number(v?.autoLock)) ? Number(v.autoLock) : DEFAULTS.security.autoLock }; },
    navigation(v) { return { mode: v?.mode === 'bar' ? 'bar' : 'swipe', order: v?.order === 'back-right' ? 'back-right' : 'back-left' }; },
    screen(v) { return { goDark: GO_DARK.includes(Number(v?.goDark)) ? Number(v.goDark) : DEFAULTS.screen.goDark }; },
    hours(v) {
      const q = m => Number.isInteger(m) && m >= 0 && m < 1440 && m % 15 === 0;
      const days = {};
      for (const d of DAYS) {
        const x = isObj(v?.days?.[d]) ? v.days[d] : {}, def = DEFAULTS.hours.days[d];
        const from = q(x.from) ? x.from : def.from, to = q(x.to) ? x.to : def.to;
        // (it closes after it opens: later that day, or the next morning by 6:00 am; otherwise at midnight)
        days[d] = { open: x.open !== false, from, to: closesOk(from, to) ? to : 0 };
      }
      return { days };
    },
    billNumber(v) {
      const log = (Array.isArray(v?.log) ? v.log : []).filter(x => isObj(x) && (x.to === 'print' || x.to === 'payment') && Number.isFinite(x.at))
        .map(x => ({ to: x.to, at: x.at, by: typeof x.by === 'string' ? x.by.slice(0, 60) : null })).slice(-20);
      return { at: v?.at === 'payment' ? 'payment' : 'print', log };
    }
  };
  // A closing time after the opening time the same day, or the next morning (at or before the opening time) by 6:00 am
  function closesOk(from, to) { return to > from || to <= LATEST_CLOSE; }
  // (read once for each change: every business day is worked out from them)
  let hoursRaw, hoursVal;
  function hoursNow() { let raw = null; try { raw = localStorage.getItem(KEYS.hours); } catch {} if (raw !== hoursRaw || !hoursVal) { hoursRaw = raw; hoursVal = get('hours'); } return hoursVal; }
  const dateOf = key => { const [y, mo, d] = String(key || '').split('-').map(Number); return new Date(y, mo - 1, d); };
  const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // How far a business day (its date) runs into the next morning: its closing time when it closes after midnight, in
  // minutes after midnight; 0 when it ends at midnight (it closes by then, or it is closed that day)
  function spillOf(date) { const x = hoursNow().days[DAYS[(date.getDay() + 6) % 7]]; return x.open && x.to <= x.from ? x.to : 0; }
  const spillMinutes = key => { const d = dateOf(key); return Number.isFinite(d.getTime()) ? spillOf(d) : 0; };
  // The business day a moment belongs to ("2026-11-12"): up to the minute the day before closes, after midnight, the day
  // before (its closing minute is its last: open till 2 am, 2:00 am is still the day before, 2:01 am the new day)
  function businessDay(t) {
    const d = new Date(t), prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    return d.getHours() * 60 + d.getMinutes() <= spillOf(prev) ? keyOf(prev) : keyOf(d);
  }
  // A business day's opening hours: { from, to } in milliseconds, or null when the restaurant is closed that day
  function hoursOn(key) {
    const date = dateOf(key); if (!Number.isFinite(date.getTime())) return null;
    const day = hoursNow().days[DAYS[(date.getDay() + 6) % 7]]; if (!day.open) return null;
    const [y, mo, d] = [date.getFullYear(), date.getMonth(), date.getDate()];
    return { from: new Date(y, mo, d, 0, day.from).getTime(), to: new Date(y, mo, d + (day.to <= day.from ? 1 : 0), 0, day.to).getTime() };
  }
  const read = name => { try { const raw = localStorage.getItem(KEYS[name]); return raw == null ? null : JSON.parse(raw); } catch { return null; } };
  const get = name => CLEAN[name](read(name) || {});
  const announce = name => window.dispatchEvent(new CustomEvent('restro:prefs-changed', { detail: { name } }));
  function set(name, value) {
    if (!CLEAN[name]) return null;
    const next = CLEAN[name](value);
    try { localStorage.setItem(KEYS[name], JSON.stringify(next)); } catch {}
    if (SHARED.has(name)) window.RestroSync?.wrote(KEYS[name]);
    announce(name);
    return next;
  }
  // Part of a value: update('billing', b => { b.packaging.on = true; })
  function update(name, change) { const v = get(name); change(v); return set(name, v); }
  // Changed on another tablet: tell the screens which (the values themselves arrive in localStorage, sync.js)
  let seen = Object.fromEntries([...SHARED].map(name => [name, JSON.stringify(get(name))]));
  window.addEventListener('restro:data-changed', event => {
    if (!(event.detail?.collections || []).includes('settings')) return;
    for (const name of SHARED) { const now = JSON.stringify(get(name)); if (now !== seen[name]) { seen[name] = now; announce(name); } }
  });
  window.addEventListener('restro:prefs-changed', event => { const name = event.detail?.name; if (SHARED.has(name)) seen[name] = JSON.stringify(get(name)); });

  // ---------- layout settings, branch-wide (Update Pack 4, A8) ----------
  // orders: Settings › Orders (Order list view, Row style); counter: Settings › Counter (Menu display style, Tiles per
  // row). One value for every tablet of the restaurant (shared through sync.js); there is no "Use on" any more. Board is
  // gone: a tablet that had it shows Classic. A new restaurant starts with Classic and Classic rows.
  // (Update Pack 3 let a tablet keep its own value, "Use on · This tablet only": restro.ordersLook.v1 and
  // restro.counterLook.v1; before that the Counter's own keys restro.counter.menuStyle.v1 and .tilesPerRow.v1. Such a
  // value, when newer than the restaurant's, becomes the restaurant's once, below.)
  const VIEWS = ['classic', 'split', 'cards'], STYLES = ['grid', 'pills', 'rail'];
  const SCOPED = Object.freeze({
    orders: { own: 'restro.ordersLook.v1', all: 'restro.ordersLook.shared.v1', clean: v => ({ view: VIEWS.includes(v?.view) ? v.view : 'classic', rows: v?.rows === 'pills' ? 'pills' : 'classic' }) },
    counter: { own: 'restro.counterLook.v1', all: 'restro.counterLook.shared.v1', clean: v => ({ style: STYLES.includes(v?.style) ? v.style : 'pills', perRow: Number(v?.perRow) === 3 ? 3 : 4 }),
      legacy: () => { const st = readKey('restro.counter.menuStyle.v1'), pr = readKey('restro.counter.tilesPerRow.v1'); return st == null && pr == null ? null : { style: st, perRow: pr, at: 1 }; } }
  });
  function readKey(key) { try { const raw = localStorage.getItem(key); return raw == null ? null : JSON.parse(raw); } catch { return null; } }
  const when = x => (isObj(x) && Number.isFinite(x.at) ? x.at : 0);
  const promoted = [];
  for (const s of Object.values(SCOPED)) {
    const own = readKey(s.own) ?? s.legacy?.() ?? null, all = readKey(s.all);
    if (isObj(own) && (!isObj(all) || when(own) > when(all))) { try { localStorage.setItem(s.all, JSON.stringify({ ...s.clean(own), at: when(own) || 1 })); promoted.push(s.all); } catch {} }
    try { localStorage.removeItem(s.own); } catch {}
  }
  // (sync.js loads after this file: it sends what was promoted once it is there)
  if (promoted.length) window.addEventListener('load', () => promoted.forEach(key => window.RestroSync?.wrote(key)), { once: true });
  // → { value, from: 'all' (the restaurant's) | 'default' (none set yet) }
  function scoped(name) {
    const s = SCOPED[name]; if (!s) return null;
    const all = readKey(s.all);
    return isObj(all) ? { value: s.clean(all), from: 'all' } : { value: s.clean({}), from: 'default' };
  }
  // Every tablet's (the restaurant's)
  function setScoped(name, value) {
    const s = SCOPED[name]; if (!s) return null;
    const next = { ...s.clean(value), at: Date.now() };
    try { localStorage.setItem(s.all, JSON.stringify(next)); } catch {}
    window.RestroSync?.wrote(s.all);
    announce(name);
    return next;
  }
  let seenScoped = Object.fromEntries(Object.keys(SCOPED).map(name => [name, JSON.stringify(scoped(name))]));
  window.addEventListener('restro:data-changed', event => {
    if (!(event.detail?.collections || []).includes('settings')) return;
    for (const name of Object.keys(SCOPED)) { const now = JSON.stringify(scoped(name)); if (now !== seenScoped[name]) { seenScoped[name] = now; announce(name); } }
  });
  window.addEventListener('restro:prefs-changed', event => { const name = event.detail?.name; if (SCOPED[name]) seenScoped[name] = JSON.stringify(scoped(name)); });

  // GSTIN: 15 characters (2-digit state code, the PAN, the entity number, Z, a check character). The check character is
  // worked out from the first 14 (the GST network's mod-36 check), so a typing mistake is caught before it is printed.
  const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function gstinOk(value) {
    const g = String(value || '').toUpperCase();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
    let sum = 0;
    for (let i = 0; i < 14; i++) { const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
    return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
  }
  // FSSAI licence and registration numbers are 14 digits
  const fssaiOk = value => /^\d{14}$/.test(String(value || ''));

  window.RestroPrefs = Object.freeze({ get: name => (SCOPED[name] && !CLEAN[name] ? scoped(name).value : get(name)), set, update, scoped, setScoped, keys: KEYS, defaults: DEFAULTS, autoLockChoices: AUTO_LOCK, goDarkChoices: GO_DARK, languages: LANGUAGES, printerRoles: ROLES, gstinOk, fssaiOk,
    days: DAYS, latestClose: LATEST_CLOSE, hoursOn, businessDay, spillMinutes });
})();
