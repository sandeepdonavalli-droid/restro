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
//   taxRate, kds } | null
//   link (404.html reads it from the address): { slug (the restaurant's part), kind: 'table' | 'takeaway' | 'menu' |
//   'event' (TK, MN, EV), table (a table QR's table, as T7), eventTable (an event table's, as E3), code }
//   kind and place as RestroCustomerPages.mount takes them: a whole event's QR is 'event' (eventMode 'both': Dine-in or
//   Takeaway; 'takeaway'), or 'menu' when it only shows the menu; an event table's is 'event-table'.
// RestroCustomerData.watch(fn): fn() whenever RESTRO, in another tab of this browser, changes what read() reads.
(() => {
  const KEYS = ['restro.restaurantName', 'restro.menuDesign.v1', 'restro.menu.availability.v1', 'restro.events.v1', 'restro.qr.v1'];
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
  // each in its category; the event's own sold-out dishes too (EV12)
  function eventMenu(e, soldOut) {
    const items = new Map((Array.isArray(e.menu?.items) ? e.menu.items : []).map(i => (typeof i === 'string' ? [i, {}] : [i?.id, i || {}])).filter(([id]) => typeof id === 'string'));
    const own = (Array.isArray(e.menu?.own) ? e.menu.own : []).filter(d => d && typeof d.id === 'string');
    const off = { ...(soldOut || {}), ...(e.soldOut && typeof e.soldOut === 'object' ? e.soldOut : {}) };
    const cats = menuOf(off, new Set(items.keys())).map(c => ({ ...c, items: c.items.map(d => (Number.isFinite(items.get(d.id)?.price) ? { ...d, price: items.get(d.id).price } : d)) }));
    for (const c of window.RestroMenu?.categories || []) {
      const mine = own.filter(d => d.cat === c.id).map(d => ({ id: d.id, name: d.name, desc: '', about: '', price: d.price, veg: d.veg, photo: null, out: Boolean(off[d.id]) }));
      if (!mine.length) continue;
      const at = cats.find(x => x.id === c.id);
      if (at) at.items.push(...mine); else cats.push({ id: c.id, name: c.name, items: mine });
    }
    const lost = own.filter(d => !(window.RestroMenu?.categories || []).some(c => c.id === d.cat));
    if (lost.length) cats.push({ id: 'event-only', name: e.name || 'Event', items: lost.map(d => ({ id: d.id, name: d.name, desc: '', about: '', price: d.price, veg: d.veg, photo: null, out: Boolean(off[d.id]) })) });
    const order = (window.RestroMenu?.categories || []).map(c => c.id);
    return cats.sort((a, b) => (order.indexOf(a.id) + 1 || 1e3) - (order.indexOf(b.id) + 1 || 1e3));
  }

  // From this browser's RESTRO: only for the same restaurant
  function local(link) {
    const name = get('restro.restaurantName');
    if (!name || slugOf(name) !== link.slug) return null;
    const design = json('restro.menuDesign.v1') || {}, soldOut = json('restro.menu.availability.v1')?.soldOut;
    const base = { restaurant: name.toLocaleUpperCase('en-IN'), template: typeof design.template === 'string' ? design.template : null,
      accent: /^#[0-9A-F]{6}$/i.test(design.accent || '') ? design.accent : null, logo: https(design.logo?.url), taxRate: Number(window.RestroMenu?.taxRate) || 0.05, kds: false };
    if (link.kind === 'event' || link.eventTable) {
      const events = Array.isArray(json('restro.events.v1')) ? json('restro.events.v1') : [];
      const e = link.eventTable ? events.find(x => x.qrs === 'tables' && (x.tables || []).some(t => t?.code === link.code))
        : events.find(x => x.qrs === 'whole' && x.code === link.code);
      const categories = e ? eventMenu(e, soldOut) : menuOf(soldOut);
      if (link.eventTable) return { ...base, kind: 'event-table', place: `Event table ${link.eventTable}`, event: e?.name || 'Event', categories };
      const mode = e?.mode || 'both';
      return { ...base, kind: mode === 'menu' ? 'menu' : 'event', eventMode: mode === 'takeaway' ? 'takeaway' : 'both', place: 'Event', event: e?.name || 'Event', categories };
    }
    return { ...base, kind: link.kind, place: link.kind === 'table' ? `Table ${link.table}` : link.kind === 'takeaway' ? 'Takeaway' : 'Menu', categories: menuOf(soldOut) };
  }

  const read = link => (link && window.RestroMenu ? local(link) : null);
  function watch(fn) { addEventListener('storage', e => { if (e.key === null || KEYS.includes(e.key)) fn(); }); }
  window.RestroCustomerData = Object.freeze({ read, watch, slugOf });
})();
