'use strict';
// Settings added by the Update Pack of 9 Nov 2026 (Counter Update 7, Navigation & Lock Update 1), kept in one place:
// - The restaurant's own (shared by all its tablets through sync.js): Billing & charges, Business details, Kitchen,
//   the printers' settings and Staff & security.
// - This tablet's own: Display › Navigation (swipe gestures or the navigation bar, and its button order) and Go dark.
// Every value is checked as it is read, so a missing, old or bad value falls back to its default. Changes are announced
// with `restro:prefs-changed` ({ name }), here or from another tablet.
(() => {
  const DEFAULTS = Object.freeze({
    billing: {
      serviceCharge: { on: false, rate: 5, picks: [2.5, 5, 7.5, 10], max: 10, label: 'Service charge (optional)', footer: 'Service charge is optional — ask us to remove it.' },
      orderDiscount: { picks: [5, 10, 15, 20, 25] },
      dishDiscount: { picks: [10, 20, 50, 100], reasons: ['Staff meal', 'Complaint', 'Owner’s guest', 'Regular customer', 'Birthday', 'Other'] },
      packaging: { on: false, mode: 'flat', flat: 0, types: ['takeaway', 'delivery', 'phone'] },
      delivery: { on: false, flat: 0 }
    },
    business: { address: '', gstin: '', fssai: '', footer: 'Thank you! Visit again.' },
    kitchen: {
      voidReasons: ['Customer changed mind', 'Ordered by mistake', 'Taking too long', 'Quality issue', 'Item unavailable', 'Other'],
      cancelReasons: ['Customer left', 'Duplicate order', 'Payment issue', 'Kitchen can’t make it', 'Other']
    },
    printers: {},
    security: { autoLock: 5 },
    navigation: { mode: 'swipe', order: 'back-left' },
    screen: { goDark: 5 }
  });
  const KEYS = Object.freeze({ billing: 'restro.billing.v1', business: 'restro.business.v1', kitchen: 'restro.kitchen.v1', printers: 'restro.printers.v1', security: 'restro.security.v1', navigation: 'restro.navigation.v1', screen: 'restro.screen.v1' });
  const SHARED = new Set(['billing', 'business', 'kitchen', 'printers', 'security']);
  const AUTO_LOCK = Object.freeze([0, 1, 2, 5, 10, 15]);        // minutes; 0 = off
  const GO_DARK = Object.freeze([1, 2, 5, 10, 15, 30, 0]);      // minutes; 0 = never
  const LANGUAGES = Object.freeze(['English', 'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati']);
  const ROLES = Object.freeze(['bills', 'kitchen', 'both']);
  const TYPES = ['takeaway', 'delivery', 'phone'];

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; };
  const money = (v, fallback) => { const n = num(v, 0, 99999, NaN); return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback; };
  const text = (v, max, fallback) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : fallback);
  const words = (v, fallback, max = 12, len = 40) => {
    if (!Array.isArray(v)) return fallback;
    const seen = new Set(), out = [];
    for (const s of v) { const t = text(s, len, ''); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } }
    return out.length ? out.slice(0, max) : fallback;
  };
  const picks = (v, min, max, fallback) => {
    if (!Array.isArray(v)) return fallback;
    const out = [...new Set(v.map(Number).filter(n => Number.isFinite(n) && n >= min && n <= max).map(n => Math.round(n * 10) / 10))].sort((a, b) => a - b);
    return out.length ? out.slice(0, 6) : fallback;
  };
  const CLEAN = {
    billing(v) {
      const d = DEFAULTS.billing, s = isObj(v?.serviceCharge) ? v.serviceCharge : {}, od = isObj(v?.orderDiscount) ? v.orderDiscount : {};
      const dd = isObj(v?.dishDiscount) ? v.dishDiscount : {}, pk = isObj(v?.packaging) ? v.packaging : {}, dl = isObj(v?.delivery) ? v.delivery : {};
      const max = num(s.max, 1, 20, d.serviceCharge.max);
      const reasons = words(dd.reasons, d.dishDiscount.reasons);
      return {
        serviceCharge: { on: s.on === true, rate: Math.min(max, num(s.rate, 0.5, 20, d.serviceCharge.rate)), picks: picks(s.picks, 0.5, max, d.serviceCharge.picks.filter(p => p <= max)), max,
          label: text(s.label, 40, '') || d.serviceCharge.label, footer: text(s.footer, 80, d.serviceCharge.footer) },
        orderDiscount: { picks: picks(od.picks, 1, 100, d.orderDiscount.picks).map(Math.round) },
        // (Other… is always there: it opens the keyboard for a reason of their own)
        dishDiscount: { picks: picks(dd.picks, 1, 100, d.dishDiscount.picks).map(Math.round), reasons: reasons.some(r => /^other/i.test(r)) ? reasons : [...reasons, 'Other'] },
        packaging: { on: pk.on === true, mode: pk.mode === 'dish' ? 'dish' : 'flat', flat: money(pk.flat, 0), types: Array.isArray(pk.types) ? TYPES.filter(t => pk.types.includes(t)) : [...d.packaging.types] },
        delivery: { on: dl.on === true, flat: money(dl.flat, 0) }
      };
    },
    business(v) {
      const d = DEFAULTS.business;
      return { address: text(v?.address, 160, ''), gstin: text(v?.gstin, 15, '').toUpperCase().replace(/\s/g, ''), fssai: text(v?.fssai, 14, '').replace(/\D/g, ''), footer: typeof v?.footer === 'string' ? text(v.footer, 80, '') : d.footer };
    },
    kitchen(v) {
      const d = DEFAULTS.kitchen, keepOther = list => (list.some(r => /^other/i.test(r)) ? list : [...list, 'Other']);
      return { voidReasons: keepOther(words(v?.voidReasons, d.voidReasons)), cancelReasons: keepOther(words(v?.cancelReasons, d.cancelReasons)) };
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
  // Part of a value: update('billing', b => { b.serviceCharge.on = true; })
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
