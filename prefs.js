'use strict';
// Settings added by the Update Pack of 9 Nov 2026 (Counter Update 7, Navigation & Lock Update 1), kept in one place:
// - The restaurant's own (shared by all its tablets through sync.js): Billing & charges, Business details, the
//   printers' settings and Staff & security.
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
    screen: { goDark: 5 }
  });
  const KEYS = Object.freeze({ billing: 'restro.billing.v1', business: 'restro.business.v1', printers: 'restro.printers.v1', security: 'restro.security.v1', navigation: 'restro.navigation.v1', screen: 'restro.screen.v1' });
  const SHARED = new Set(['billing', 'business', 'printers', 'security']);
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
    screen(v) { return { goDark: GO_DARK.includes(Number(v?.goDark)) ? Number(v.goDark) : DEFAULTS.screen.goDark }; }
  };
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

  window.RestroPrefs = Object.freeze({ get, set, update, keys: KEYS, defaults: DEFAULTS, autoLockChoices: AUTO_LOCK, goDarkChoices: GO_DARK, languages: LANGUAGES, printerRoles: ROLES, gstinOk, fssaiOk });
})();
