'use strict';
// Counter: take an order, total it with GST, and settle it (cash for now). The screen is the POS Counter Handoff:
// the order panel with its colour-coded context buttons, modifiers and notes on each line, and the menu in one of three
// display styles (Settings > Counter).
// Orders are kept on this device until the RESTRO backend exists (security plan,
// Phase 2). Card and UPI payments arrive with the payment provider (Phase 4).
(() => {
  const dialog = document.querySelector('#counter-dialog');
  if (!dialog) return;
  const menu = window.RestroMenu;
  // Rendered into its own root so the system bar and toasts placed in the dialog survive re-renders.
  const root = document.createElement('div'); root.className = 'ctr-root'; dialog.prepend(root);
  const HELD_KEY = 'restro.counter.held.v1', DONE_KEY = 'restro.counter.orders.v1', NUM_KEY = 'restro.counter.nextNumber.v1', DRAFT_KEY = 'restro.counter.current.v1';
  const LEGACY_SCHED_KEY = 'restro.counter.scheduled.v1', PREP_KEY = 'restro.counter.prepMinutes.v1', PAGERS = 20;
  const items = new Map(), categoryOf = new Map();
  for (const category of menu.categories) for (const item of category.items) { items.set(item.id, item); categoryOf.set(item.id, category); }
  const categoryById = new Map(menu.categories.map(c => [c.id, c]));
  // ---------- modifiers ----------
  // An item's modifier groups (spice level, instructions, add-ons): its own, or its category's (menu-data.js). A line
  // keeps the choices made for it (option ids), in the menu's order; required groups (spice level) have one choice.
  const groups = new Map((menu.modifierGroups || []).map(g => [g.id, g]));
  const optionOf = new Map();
  // (mode 'set', Counter Update 7: a choice that sets the dish's price, Half ₹200 / Full ₹340; 'add' adds to it)
  for (const g of groups.values()) for (const o of g.options) optionOf.set(o.id, { ...o, group: g.id, kind: g.kind === 'spice' ? 'spice' : 'other', mode: g.mode === 'set' ? 'set' : 'add', price: Number(o.price) || 0 });
  const groupsOf = id => { const list = items.get(id)?.modifiers ?? categoryOf.get(id)?.modifiers; return (Array.isArray(list) ? list : []).map(g => groups.get(g)).filter(Boolean); };
  const cleanMods = (id, mods) => {
    const picked = new Set((Array.isArray(mods) ? mods : []).map(m => (typeof m === 'string' ? m : m?.id)));
    return groupsOf(id).flatMap(g => { const on = g.options.filter(o => picked.has(o.id)).map(o => o.id); return g.required ? on.slice(0, 1) : on; });
  };
  // What tells two lines of the same item and type apart: their choices (a saved order keeps them as { id, label, ... })
  const modsKey = mods => (Array.isArray(mods) && mods.length ? `#${mods.map(m => (typeof m === 'string' ? m : m?.id)).join('+')}` : '');
  const cleanNote = n => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
  // A custom item (Counter Update 5): a dish that isn't on the menu, typed in at the Counter for one order. It keeps its
  // name (blank shows as "Custom item"), veg or non-veg (or neither), its price each (whole rupees) and the category it
  // was added in (its GST is the category's). It is never added to the menu. Its line has an id of its own (cu-…).
  const cleanCustom = c => {
    if (!c || typeof c !== 'object') return null;
    const price = Number(c.price);
    if (!Number.isInteger(price) || price <= 0 || price > 99999) return null;
    return { name: typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '', veg: c.veg === true ? true : c.veg === false ? false : null, price, cat: categoryById.has(c.cat) ? c.cat : null };
  };
  const newCustomId = () => { let id; do id = `cu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; while (items.has(id)); return id; };
  // A line's dish: the menu's, or a custom item's as if it were one
  const itemOf = line => (line.custom ? { id: line.id, name: line.custom.name || 'Custom item', price: line.custom.price, veg: line.custom.veg, custom: true } : items.get(line.id));
  // One of a line's item with its add-ons (rupees), and a choice as it shows on its pill ("Extra gravy +₹40"). A choice
  // that sets the price (Update 7: "Half") is the dish's price; add-ons still go on top.
  const eachOf = line => {
    let base = itemOf(line).price, add = 0;
    for (const m of line.mods || []) { const o = optionOf.get(m); if (!o) continue; if (o.mode === 'set') base = o.price; else add += o.price; }
    return base + add;
  };
  const modLabel = id => { const o = optionOf.get(id); return o ? (o.price && o.mode !== 'set' ? `${o.label} +₹${o.price.toLocaleString('en-IN')}` : o.label) : id; };
  // A dish whose price is set by a choice shows its prices on its tile: "₹200 · ₹340"
  const setGroupOf = id => groupsOf(id).find(g => g.mode === 'set') || null;
  // Sold out (Update 7): set in the Availability app (today's Menu app), shared with every tablet through sync
  // (restro.menu.availability.v1: { soldOut: { <item id>: true } }). A custom item is never sold out.
  const AVAIL_KEY = 'restro.menu.availability.v1';
  const soldOut = id => { try { return JSON.parse(localStorage.getItem(AVAIL_KEY) || 'null')?.soldOut?.[id] === true; } catch { return false; } };

  // ---------- storage ----------
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  // Shared data (orders, held) is passed to sync after every save, so the other tablets get it (sync.js).
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} window.RestroSync?.wrote(key); };
  // Held: only tickets put on Hold. They are kept until the end of the day, then cleared (nothing else is cleared).
  let held = load(HELD_KEY, []); if (!Array.isArray(held)) held = [];
  // Orders: every order saved with Save or Pay, newest first, each Paid or Due (payment is not always taken upfront).
  // Kept as sync keeps them (Update Pack 5, H3: RestroSync.keepOrders): 4 business days, today and the 3 before, every
  // order not paid yet, and every order with a change still to go; without sync, the latest 500 paid.
  const createdOf = o => (Number.isFinite(o.createdAt) && o.createdAt > 0 ? o.createdAt : Date.parse(o.paidAt)) || 0;
  const loadOrders = () => { const list = load(DONE_KEY, []); return (Array.isArray(list) ? list : []).filter(o => o && typeof o === 'object' && Number.isFinite(o.number) && Number.isFinite(o.total) && Array.isArray(o.lines)); };
  const storeOrders = list => {
    const byNew = [...list].sort((a, b) => createdOf(b) - createdOf(a));
    const kept = window.RestroSync?.keepOrders ? window.RestroSync.keepOrders(byNew) : [...byNew.filter(o => !o.paidAt), ...byNew.filter(o => o.paidAt).slice(0, 500)];
    store(DONE_KEY, kept.sort((a, b) => createdOf(b) - createdOf(a)));
  };
  // How long before a scheduled order is due it goes to the kitchen (Settings → Orders; 30 minutes unless changed).
  // The kitchen prep time (Settings › Kitchen; Update Pack 3: one for every order, or one per order type), 5 to 240
  // minutes in 5s: a scheduled order goes to the kitchen this long before it is due, and Orders shows an order late once
  // it has been in the kitchen longer. (Before Update Pack 3 it was one time, under Orders: restro.counter.prepMinutes.v1.)
  const KITCHEN_PREP_KEY = 'restro.kitchen.prep.v1';
  const prepOf = n => { if (n == null || n === '') return null; n = Number(n); return Number.isFinite(n) ? Math.min(240, Math.max(5, Math.round(n / 5) * 5)) : null; };
  const prepMinutes = type => {
    const k = load(KITCHEN_PREP_KEY, null), one = prepOf(k?.minutes) ?? prepOf(load(PREP_KEY, 30)) ?? 30;
    return k?.mode === 'type' && TYPES.includes(type) ? prepOf(k.byType?.[type]) ?? one : one;
  };
  // (Update Pack 4, C2 and C7) the prep time it was worked out with when the time was picked (prepMin): a change in
  // Settings › Kitchen moves the KOT earlier, never later (the longer of the two); the order type changed on the
  // Counter works it out again with the new type's prep time (setType)
  const kitchenTime = o => o.readyAt - Math.max(prepOf(o.prepMin) || 0, prepMinutes(o.type || DEFAULT_TYPE)) * 60000;
  const endOfDay = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); };
  // The order of categories and items, as rearranged by holding a tile (kept on this device until the backend exists).
  const ORDER_KEY = 'restro.counter.menuOrder.v1';
  let menuOrder = load(ORDER_KEY, {}); if (!menuOrder || typeof menuOrder !== 'object' || Array.isArray(menuOrder)) menuOrder = {};
  // Saved order first; anything new (or never moved) follows in menu order, so new tiles land at the end (and on the next page when one is full).
  const ordered = (ids, saved) => {
    const known = new Set(ids), seen = new Set(), out = [];
    if (Array.isArray(saved)) for (const id of saved) if (known.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    for (const id of ids) if (!seen.has(id)) out.push(id);
    return out;
  };
  const categoriesInOrder = () => ordered(menu.categories.map(c => c.id), menuOrder.categories).map(id => categoryById.get(id));
  const itemsInOrder = c => ordered(c.items.map(i => i.id), menuOrder.items && typeof menuOrder.items === 'object' ? menuOrder.items[c.id] : null).map(id => items.get(id));
  function saveMenuOrder(view, ids) {
    if (view.kind === 'categories') menuOrder.categories = ids;
    else { if (!menuOrder.items || typeof menuOrder.items !== 'object' || Array.isArray(menuOrder.items)) menuOrder.items = {}; menuOrder.items[view.catId] = ids; }
    store(ORDER_KEY, menuOrder);
  }
  // The buttons at the top of the order panel, in the places this tablet has them (hold one to rearrange them), in two
  // groups, each rearranged on its own (Counter Update 3): the context row (Order type · Add Customer or the table ·
  // Pager · Print bill to start with) and the chips in the order header (Schedule · Modify · Hold).
  const PANEL_GROUPS = Object.freeze({
    ctx: Object.freeze({ key: 'restro.counter.contextOrder.v2', tiles: Object.freeze(['type', 'customer', 'pager', 'print']) }),
    head: Object.freeze({ key: 'restro.counter.headerOrder.v2', tiles: Object.freeze(['schedule', 'modify', 'hold']) })
  });
  const panelOrder = { ctx: ordered(PANEL_GROUPS.ctx.tiles, load(PANEL_GROUPS.ctx.key, null)), head: ordered(PANEL_GROUPS.head.tiles, load(PANEL_GROUPS.head.key, null)) };
  let panelArranging = false, panelDrag = null, panelPress = null, panelSuppress = false;
  // The menu's display style (Settings > Counter > Menu display style): Category grid, Pills on top (the default) or
  // Vertical rail; and Tiles per row (Counter Update 6): 4 (the default) or 3, in every grid of the menu; a page has at
  // most 4 rows (16 tiles, or 12). The restaurant's, on every tablet (Update Pack 4, A8; prefs.js).
  const MENU_STYLES = Object.freeze([Object.freeze({ id: 'grid', name: 'Category grid' }), Object.freeze({ id: 'pills', name: 'Pills on top' }), Object.freeze({ id: 'rail', name: 'Vertical rail' })]);
  const ROWS = 4;
  const counterLook = () => window.RestroPrefs?.scoped?.('counter')?.value || { style: 'pills', perRow: 4 };
  let menuStyle = counterLook().style;
  let tilesPerRow = counterLook().perRow;
  // Ticket numbers come from sync: one sequence a day for the whole restaurant, kept by the cloud or the main system. This
  // one is for orders moved over from an earlier version of the app; a new order gets its number as it is fired (fire()).
  const nextNumber = () => { if (window.RestroSync) return window.RestroSync.nextNumber(); const n = Number(load(NUM_KEY, 1001)) || 1001; store(NUM_KEY, n + 1); return n; };
  // The number a new order will have once it is saved, without taking it (shown on the Counter)
  const upcomingNumber = () => window.RestroSync?.upcomingNumber ? window.RestroSync.upcomingNumber() : Number(load(NUM_KEY, 1001)) || 1001;
  const idOf = o => o.uid || `n${o.number}`; // an order's id everywhere (orders from before sync are known by their number)
  // A ticket number as shown: #01, #02 … #10 (numbers start again at 1 every day, so they are not ids)
  const ticket = n => `#${String(n).padStart(2, '0')}`;

  // ---------- state ----------
  // A new order starts with no order type. Dine in can have a table (picked on the Floor); every other order a customer.
  // Any order can have a pager, and a ready-by time (Schedule). number: set once the order is saved (Save or Pay).
  // discountPct: a discount on the order (Update 6), a percentage of the subtotal (1–100), or null.
  // Update 7: servicePct, the service charge (dine-in only, never automatic: 0.1 to the owner's maximum), or null;
  // priority (for the kitchen only); note, the order note; guests, the guest count (asked in the Dining app), or 0;
  // server / serverId: the server, when changed with Change server (otherwise whoever saves it first); merged: the saved
  // orders whose dishes Merge tables brought onto it (they go when it is saved). A line can have off, its dish discount
  // (1–100%; 100 complimentary, with offReason), and kit: what the kitchen has of it ([{ n, mods, note }]).
  const blankOrder = () => ({ type: null, split: false, table: '', customer: null, pager: 0, pagerAt: null, pagerShared: false, readyAt: null, kotMode: null, prepMin: null, holdUntil: null, heldId: null, number: null, uid: null, discountPct: null,
    servicePct: null, priority: false, note: '', guests: 0, server: null, serverId: null, merged: [], events: [], lines: [] });
  const cleanCustomer = c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
    ? { id: c.id, name: c.name.slice(0, 60), mobile: String(c.mobile || '').replace(/\D/g, '').slice(0, 15), code: String(c.code || '').replace(/\D/g, '').slice(0, 4), address: String(c.address || '').slice(0, 200) } : null;
  const TYPES = ['dine-in', 'takeaway', 'delivery', 'phone'];
  const cleanPager = n => Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
  // A pager's life on an order: handed out (pagerAt; an order from before this kept its creation time) and back
  // (pagerBackAt: docked in its docking station, or handed back and given to another order). pagerShared (Update Pack
  // 3, Assign pager's "Same customer"): given to this order while the customer kept it for the order(s) before.
  const pagerTime = o => Number(o.pagerAt) || createdOf(o);
  // Who has each pager now and when each order's pager came back: the pager is with the order it was last handed to,
  // until it comes back. An order before that had it until it was handed on (handed back), or, when it was shared with
  // the next order (same customer), until it comes back from that one; a pager docked comes back from every order that
  // has it. → { holders: Map(number → the orders that have it, newest first), back: Map(order id → when) }
  function pagerState(list) {
    const holders = new Map(), back = new Map(), byNumber = new Map();
    for (const o of list) { const n = cleanPager(o.pager); if (n) { if (!byNumber.has(n)) byNumber.set(n, []); byNumber.get(n).push(o); } }
    for (const [n, os] of byNumber) {
      let later = null, laterBack = 0;
      for (const o of os.sort((a, b) => pagerTime(b) - pagerTime(a))) {
        const at = Number(o.pagerBackAt) || (later ? (later.pagerShared ? laterBack : pagerTime(later)) : 0);
        if (at) back.set(idOf(o), at); else { if (!holders.has(n)) holders.set(n, []); holders.get(n).push(o); }
        later = o; laterBack = at;
      }
    }
    return { holders, back };
  }
  const pagerHolders = list => pagerState(list).holders;
  const pagersBack = list => pagerState(list).back;
  const holdsPager = (o, holders = pagerHolders(loadOrders())) => (holders.get(cleanPager(o.pager)) || []).some(h => idOf(h) === idOf(o));
  const cleanTime = t => Number.isFinite(t) && t > 0 ? t : null;
  const cleanGuests = n => (Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0);
  const cleanReason = r => (typeof r === 'string' ? r.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
  // What the kitchen has of a line (Update 7): parts of it as they were sent, [{ n, mods, note }]
  const cleanKit = (id, kit) => (Array.isArray(kit) ? kit : []).filter(k => k && Number.isInteger(k.n) && k.n > 0).map(k => ({ n: k.n, mods: cleanMods(id, k.mods), note: cleanNote(k.note) }));
  const sentOf = line => (line.kit || []).reduce((n, k) => n + k.n, 0);
  // An order read back from storage (the draft, Held or Orders), keeping only what is valid.
  // What happened to an order (Update Pack 3, Track history), besides its KOTs, voids and bill prints (kots, bills):
  // events: { id, at, kind, by, … } (logEvent)
  const EVENT_KINDS = ['open', 'disc', 'disc-off', 'dish', 'dish-off', 'svc', 'svc-off', 'move', 'merge', 'server', 'priority', 'priority-off'];
  const cleanEvents = list => (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && EVENT_KINDS.includes(e.kind) && Number.isFinite(e.at)).slice(-200);
  const restoreOrder = o => {
    const type = TYPES.includes(o.type) ? o.type : null;
    return { type, split: o.split === true, table: typeof o.table === 'string' ? o.table : '', customer: cleanCustomer(o.customer),
      pager: cleanPager(o.pager), pagerAt: cleanTime(o.pagerAt), pagerShared: o.pagerShared === true && cleanPager(o.pager) > 0, readyAt: cleanTime(o.readyAt), kotMode: ['queue', 'now', 'ask'].includes(o.kotMode) ? o.kotMode : null, prepMin: prepOf(o.prepMin), holdUntil: cleanTime(o.holdUntil),
      heldId: typeof o.heldId === 'string' ? o.heldId : null, number: Number.isInteger(o.number) ? o.number : null, uid: typeof o.uid === 'string' ? o.uid : null,
      discountPct: window.RestroBill.pct(o.discountPct), servicePct: window.RestroBill.rate(o.servicePct), priority: o.priority === true, note: cleanNote(o.note), guests: cleanGuests(o.guests),
      server: typeof o.server === 'string' && o.server ? o.server.slice(0, 60) : null, serverId: typeof o.serverId === 'string' ? o.serverId : null,
      merged: (Array.isArray(o.merged) ? o.merged : []).filter(u => typeof u === 'string').slice(0, 20), events: cleanEvents(o.events),
      ...(Array.isArray(o.bills) && o.bills.length ? { bills: o.bills.slice(-20) } : {}), ...(Number.isInteger(o.billNo) && o.billNo > 0 && typeof o.billYear === 'string' ? { billNo: o.billNo, billYear: o.billYear } : {}),
      lines: (Array.isArray(o.lines) ? o.lines : []).filter(l => l && (items.has(l.id) || (typeof l.id === 'string' && cleanCustom(l.custom))) && Number.isInteger(l.qty) && l.qty > 0 && l.qty < 1000)
        .map(l => {
          const custom = items.has(l.id) ? null : cleanCustom(l.custom), off = window.RestroBill.pct(l.off), kit = cleanKit(l.id, l.kit);
          return { id: l.id, qty: l.qty, type: TYPES.includes(l.type) ? l.type : type, mods: custom ? [] : cleanMods(l.id, l.mods), note: cleanNote(l.note), ...(custom ? { custom } : {}),
            ...(off ? { off, ...(off === 100 && cleanReason(l.offReason) ? { offReason: cleanReason(l.offReason) } : {}) } : {}), ...(kit.length ? { kit } : {}) };
        }) };
  };
  // The kitchen side of a line (Update 7): the dish as the kitchen knows it (its type and choices; not its discount), and
  // the dish itself
  const kitchenKey = (id, type, mods) => `${id}@${type}${modsKey(mods)}`;
  // A saved order on screen: what the kitchen already has of each of its lines (from its `sent`), as it was sent
  function withKitchen(r, saved) {
    const left = { ...(saved?.sent && typeof saved.sent === 'object' ? saved.sent : {}) };
    for (const l of r.lines) {
      delete l.kit;
      const k = kitchenKey(l.id, typeOf(r, l), l.mods), n = Math.min(l.qty, Math.max(0, Number(left[k]) || 0));
      if (n > 0) { l.kit = [{ n, mods: [...l.mods], note: l.note || '' }]; left[k] -= n; }
    }
    return r;
  }
  // A saved order put on screen: its pager shows only while the order still has it. One that came back (docked, or
  // handed to another order) is no longer the order's: the pager slot is empty, so whatever pager is there when the
  // order is saved again is its pager (the same one handed back, another one, or none: then it keeps the number of the
  // one it had, for the record).
  const onScreen = saved => { const r = withKitchen(restoreOrder(saved), saved); if (r.pager && !holdsPager(saved)) { r.pager = 0; r.pagerAt = null; r.pagerShared = false; } return r; };
  // An order with no type chosen goes as Dine in, with no table: a table chosen earlier is set aside (as when the type
  // changes to Takeaway) and comes back if Dine in is chosen again.
  const DEFAULT_TYPE = 'dine-in';
  const usesTable = o => Boolean(o.table) && (o.type === 'dine-in' || (Boolean(o.type) && o.split));
  // With Modify on (called "split" in the code), each line keeps its own type; otherwise every line follows the order type.
  const typeOf = (o, line) => (o.split ? line.type || o.type : o.type) || DEFAULT_TYPE;
  const lineType = line => typeOf(order, line);
  // What a saved order looks like, to tell whether the copy on screen has changes not saved yet.
  const signature = o => JSON.stringify([o.type, o.split, o.table, o.customer?.id || '', o.pager || 0, o.pagerShared === true, o.readyAt || 0, o.kotMode || '', o.discountPct || 0, o.servicePct || 0, o.priority === true, o.note || '', o.guests || 0, o.serverId || o.server || '',
    o.lines.map(l => [l.id, l.qty, typeOf(o, l), modsKey(l.mods), l.note || '', l.off || 0, l.offReason || ''])]);
  // (A line whose choices are being changed in its pop-up is "edit": it stays a line of its own until the pop-up closes,
  // even when its choices match another line's; then they are merged. A dish discount makes a line of its own too.)
  const offKey = line => (line.off ? `%${line.off}` : '');
  const keyOf = line => `${line.id}@${lineType(line)}${modsKey(line.mods)}${offKey(line)}${line.edit ? '!edit' : ''}`;
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, typeMenu = false, optionsMenu = false, deleteArmed = false;
  // The pop-ups over the menu (Counter Update 4); sheet says which one is open ('mods', 'qty', 'note')
  let modPop = null;                                    // modifiers: { key (the line), added (opened as the dish was added), tried (closing was tried with a required group empty), note (Update 6: { draft }, the note being typed in it) }
  let qtyPop = null;                                    // quantity: { key, value (typed so far) }
  let notePop = null;                                   // note: { key, draft, back (return to the modifier pop-up), typing (the note line has the keyboard) }
                                                        // (Update 7: key null for the order note)
  const POPS = ['mods', 'qty', 'note', 'custom', 'discount', 'service', 'dish', 'void', 'server', 'pagerask', 'history', 'schedule']; // (the pop-ups; customPop, a custom
                                                        // item's, discPop, the discount's (Update 6), and Update 7's service
                                                        // charge, dish discount, void and Change server ones are with their code below)
  let cashInput = '';                                   // cash typed on the payment sheet
  let scheduleDraft = null;                             // the day and time being picked on the Schedule sheet
  let fromFloor = false;                                // opened by tapping a table on the Floor (Back returns there)
  let fromOrders = false;                               // opened from a tile in the Orders app (Back returns there)
  let baseline = null;                                  // signature of the saved order on screen (opened from Orders)
  let opened = null;                                    // that order as saved when it was opened here (JSON): changes made on
                                                        // another tablet meanwhile are merged with this tablet's on Save or Pay
  const scrollMemo = { lines: 0 };                      // where the order list was scrolled

  // Leaving Counter (Home, Recents, or the app/page restarting) keeps everything as it was:
  // the order on screen, plus the category or search the menu was showing.
  const saveDraft = () => store(DRAFT_KEY, { order, category, query, baseline, opened });
  (() => {
    const saved = load(DRAFT_KEY, null);
    if (!saved || typeof saved !== 'object') return;
    const o = saved.order;
    if (o && Array.isArray(o.lines)) { order = restoreOrder(o); tidy(); }
    if (menu.categories.some(c => c.id === saved.category)) category = saved.category;
    if (typeof saved.query === 'string') query = saved.query.slice(0, 80);
    if (order.number && typeof saved.baseline === 'string') baseline = saved.baseline;
    if (order.number && typeof saved.opened === 'string') opened = saved.opened;
  })();

  // ---------- money (all maths in paise) ----------
  // Counter Update 7 (bill.js): each line less its dish discount (the subtotal), less the order discount; the service
  // charge (dine-in) on what is left; the packaging and delivery charges (Settings › Billing & charges); CGST and SGST on
  // all of that; the total to pay rounded to the nearest rupee (the round off is on the bill). (tax: CGST and SGST.)
  const GST = window.RestroBill.labels(menu.taxRate);
  const billing = () => window.RestroPrefs?.get('billing') || {};
  const packagingOf = id => Number(items.get(id)?.packaging) || 0; // (a dish's own, set on the dish in Inventory)
  const totalsOf = o => {
    const type = o.type || DEFAULT_TYPE, lines = o.lines.map(l => ({ id: l.id, each: eachOf(l) * 100, qty: l.qty, off: l.off }));
    const charges = window.RestroBill.charges(type, lines, billing(), packagingOf);
    return { ...window.RestroBill.order({ lines, type, discountPct: o.discountPct, servicePct: o.servicePct, ...charges }, menu.taxRate), count: o.lines.reduce((n, l) => n + l.qty, 0) };
  };
  const totals = () => totalsOf(order);
  // Earlier versions kept saved and scheduled orders in Held / Scheduled: they move to Orders (not paid).
  (() => {
    const old = load(LEGACY_SCHED_KEY, null), legacy = [...held.filter(h => h && !h.holdUntil), ...(Array.isArray(old) ? old : [])];
    if (!legacy.length && old == null) return;
    const list = loadOrders();
    for (const o of legacy) {
      const r = restoreOrder(o); if (!r.lines.length) continue;
      const at = cleanTime(o.savedAt) || Date.now(), sentAt = cleanTime(o.sentAt);
      const lines = r.lines.map(l => ({ id: l.id, name: itemOf(l).name, price: itemOf(l).price, qty: l.qty, type: typeOf(r, l) }));
      list.push({ number: nextNumber(), type: r.type, split: r.split, table: r.table, customer: r.customer, pager: r.pager, readyAt: r.readyAt, lines, ...totalsOf(r),
        createdAt: at, savedAt: at, sentAt, sent: sentAt ? Object.fromEntries(lines.map(l => [`${l.id}@${l.type}`, l.qty])) : {}, kots: [], method: null, received: null, change: null, paidAt: null });
    }
    held = held.filter(h => h && h.holdUntil); store(HELD_KEY, held); storeOrders(list);
    try { localStorage.removeItem(LEGACY_SCHED_KEY); } catch {}
  })();
  const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rupees = value => `₹${value.toLocaleString('en-IN')}`;
  const cashOptions = total => {
    const up = step => Math.ceil(total / (step * 100)) * step * 100;
    return [...new Set([total, up(50), up(100), up(500), up(2000)])].filter(v => v >= total && v > 0).slice(0, 3);
  };

  // ---------- tiny DOM helper ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'style') node.style.cssText = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const svg = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = path; return s; };
  const ICON = {
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>', home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h4v-5h3v5h4V10"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    held: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', chevron: '<path d="m15 6-6 6 6 6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>', menu: '<path d="M7 8.5h10M7 12h10M7 15.5h10"/>', expand: '<path d="M12 3.5v17M8 7.5l4-4 4 4M8 16.5l4 4 4-4"/>',
    orders: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9.5 8h5M9.5 12h5"/>',
    history: '<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6L3.6 8.5"/><path d="M3.6 4v4.5h4.5"/><path d="M12 7.6V12l3 1.8"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c.9-3.6 3.6-5.6 7-5.6s6.1 2 7 5.6"/>',
    personAdd: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3.4 3.3-5.6 6.5-5.6 1.6 0 3 .5 4.1 1.4M18.5 13v6M15.5 16h6"/>',
    table: '<path d="M3.5 9h17M6 9v10M18 9v10M6 13.5h12"/>',
    pager: '<rect x="7" y="4" width="10" height="16" rx="2.6"/><path d="M10.5 16.5h3M4 9v6M20 9v6"/>'
  };

  // ---------- actions ----------
  // A dish goes on the order straight away. The same dish with the same choices (and type) adds one to that line; other
  // choices make a line of their own, as each line keeps its own modifiers and note. A dish with choices (modifier
  // groups) comes on as a line of its own, selected, with its modifier pop-up open over the menu: a required group
  // (spice level) starts with nothing chosen, and each choice shows on the order at once.
  function add(id) {
    // (a sold-out dish (Update 7) adds nothing: "Fish fingers is sold out")
    if (soldOut(id)) { say({ b: items.get(id)?.name || 'This dish', t: ' is sold out' }); return; }
    if (!groupsOf(id).length) { addLine(id, []); return; }
    const line = { id, qty: 1, type: order.type, mods: [], note: '', edit: true };
    order.lines.push(line);
    selected = keyOf(line); modPop = { key: selected, added: true, tried: false, was: { mods: [], qty: 1, note: '' } }; qtyPop = null; notePop = null; sheet = 'mods'; render();
    showLine(selected);
  }
  function addLine(id, mods) {
    const type = order.type, key = `${id}@${type || DEFAULT_TYPE}${modsKey(mods)}`, line = order.lines.find(l => keyOf(l) === key);
    if (line) line.qty += 1; else order.lines.push({ id, qty: 1, type, mods: [...mods], note: '' });
    selected = null; render();
    showLine(key);
  }
  // The line just added: scrolled into sight, and it flashes
  function showLine(key) { const row = [...dialog.querySelectorAll('.cx-line')].find(r => r.dataset.line === key); row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('just-added'); }
  // A line's note: that line only; empty takes it off.
  function setNote(key, note) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.note = cleanNote(note); render();
  }
  // A quantity typed or stepped. Below what the kitchen already has of the line (Update 7: it went on a KOT), the void
  // pop-up asks why first ("Reduce Chicken noodles 8 → 7?"); dishes not sent yet change freely.
  function setQty(key, qty) {
    const line = lineOf(key); if (!line) return;
    if (qty < sentOf(line)) { openVoid(key, Math.max(0, qty)); return; }
    if (qty <= 0) { removeLine(key); return; }
    line.qty = qty; render();
  }
  // Taking a dish off (− at 1, 0 on the number pad, a swipe, or the Delete key) happens straight away; the Undo message
  // (Update 7: "Chicken biryani removed · UNDO", 4 s) brings it back exactly as it was (quantity, choices, note, place).
  // A dish the kitchen already has asks why first (the void pop-up), and then there is no Undo: the VOID slip printed.
  function removeLine(key, voided = false) {
    const at = order.lines.findIndex(l => keyOf(l) === key); if (at < 0) return;
    const line = order.lines[at];
    if (!voided && sentOf(line)) { openVoid(key, 0); return; }
    const was = JSON.parse(JSON.stringify(line)), target = order;
    order.lines.splice(at, 1);
    if (selected === key) selected = null;
    render();
    if (voided) return;
    say({ b: itemOf(line).name, t: ' removed', undo: () => {
      if (order !== target) return; // (another order took the screen meanwhile)
      const same = order.lines.find(l => keyOf(l) === key);
      if (same) same.qty += was.qty; else order.lines.splice(Math.min(at, order.lines.length), 0, was);
      tidy(); render();
    } });
  }
  // Merge lines that ended up with the same item, type, choices and dish discount (both notes are kept, and what the
  // kitchen has of each).
  function tidy() {
    const merged = [];
    for (const line of order.lines) {
      if (line.edit) { merged.push(line); continue; } // (its modifier pop-up is open: a line of its own until it closes)
      const type = lineType(line), mods = line.mods || [], same = merged.find(m => !m.edit && m.id === line.id && m.type === type && modsKey(m.mods) === modsKey(mods) && (m.off || 0) === (line.off || 0));
      if (!same) {
        merged.push({ id: line.id, qty: line.qty, type, mods: [...mods], note: line.note || '', ...(line.custom ? { custom: line.custom } : {}),
          ...(line.off ? { off: line.off, ...(line.offReason ? { offReason: line.offReason } : {}) } : {}), ...(line.kit?.length ? { kit: line.kit.map(k => ({ ...k, mods: [...k.mods] })) } : {}) });
        continue;
      }
      same.qty += line.qty;
      if (line.note && line.note !== same.note) same.note = cleanNote(same.note ? `${same.note} · ${line.note}` : line.note);
      if (line.kit?.length) same.kit = [...(same.kit || []), ...line.kit.map(k => ({ ...k, mods: [...k.mods] }))];
    }
    order.lines = merged;
  }
  function moveLine(key, type) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.type = type; tidy(); selected = `${line.id}@${type}${modsKey(line.mods)}${offKey(line)}`; render();
  }
  // Changing the order type puts every item on the new type, with Modify on or off (with Modify on, items can then be
  // moved to other types again). The same item on two types becomes one line. No type (null) means the default, Dine in.
  function setType(type) {
    if (order.type === type) return;
    order.type = type;
    if (order.readyAt) order.prepMin = prepMinutes(type || DEFAULT_TYPE); // (C7: the new type's prep time, earlier or later)
    order.lines.forEach(l => { l.type = type; }); tidy();
    selected = null; render();
  }
  // The order menu (☰, the blue button left of search; Counter Update 7), its rows by order type (the ones that don't
  // apply are not there): Kitchen: Reprint KOT · Mark as priority / Remove priority; Bill: Discount · Dish discount ·
  // Service charge (dine-in, when the owner allows it), each with a switch; Table (dine-in): Move table · Merge tables ·
  // Change server; then Delete order.
  function openOptions(open) {
    optionsMenu = open; deleteArmed = false; render();
    if (open) dialog.querySelector('.cx-mi:not(:disabled)')?.focus({ preventScroll: true });
  }
  const closeMenu = () => { optionsMenu = false; deleteArmed = false; };
  // The switches: off → on opens the pop-up with the preset (Done turns it on, ✕ leaves it off); the row's name while on
  // opens the pop-up to change it; on → off takes it off at once, with Undo.
  function switchOff(what) {
    closeMenu();
    const target = order;
    if (what === 'discount') {
      const was = order.discountPct, e = was ? logEvent('disc-off', { was }) : null; order.discountPct = null; render();
      say({ b: 'Discount', t: ' removed', undo: () => { if (order === target) { order.discountPct = was; unlog(e); render(); } } });
    } else if (what === 'service') {
      const was = order.servicePct, e = was ? logEvent('svc-off', { was }) : null; order.servicePct = null; render();
      say({ b: 'Service charge', t: ' removed', undo: () => { if (order === target) { order.servicePct = was; unlog(e); render(); } } });
    } else if (what === 'dish') {
      const was = order.lines.map(l => [l, l.off, l.offReason]);
      const es = order.lines.filter(l => l.off).map(l => logEvent('dish-off', { name: itemOf(l).name, qty: l.qty, was: l.off }));
      order.lines.forEach(l => { delete l.off; delete l.offReason; }); tidy(); selected = null; render();
      say({ b: 'Dish discounts', t: ' removed', undo: () => {
        if (order !== target) return;
        for (const [l, off, reason] of was) if (order.lines.includes(l)) { if (off) l.off = off; if (reason) l.offReason = reason; }
        unlog(...es); tidy(); render();
      } });
    }
  }
  // Discount (Update 6): a percentage of the subtotal, 1 to 100, quick picks from Settings › Billing & charges. Its pop-up
  // opens with the discount the order has, to change it, or empty.
  let discPop = null; // { value: the digits typed }
  function openDiscount() { closeMenu(); discPop = { value: order.discountPct ? String(order.discountPct) : '' }; selected = null; sheet = 'discount'; render(); }
  const discOf = p => { const n = Number(p.value); return p.value !== '' && Number.isInteger(n) && n >= 1 && n <= 100 ? n : null; };
  // The number pad: up to 100 (a key that would go over it does nothing); a quick pick sets its value
  function pressDisc(k) {
    if (!discPop) return;
    const v = discPop.value, next = k === 'clear' ? '' : k === 'back' ? v.slice(0, -1) : v === '0' ? k : v + k;
    if (next !== '' && Number(next) > 100) return;
    discPop.value = next; render();
  }
  function applyDiscount() {
    const n = discPop && discOf(discPop); if (!n) return;
    const was = order.discountPct || 0; order.discountPct = n;
    if (n !== was) logEvent('disc', { pct: n, was, amount: totals().discount });
    sheet = null; discPop = null; render();
  }
  function cancelDiscount() { sheet = null; discPop = null; render(); }
  // Service charge (Update 7): every dine-in order has it in the order menu, and it is never added by itself (the customer
  // agrees to it). Its pop-up opens with 5%, or the order's rate to change it; the quick picks set in Settings › Billing &
  // charges (2.5 / 5 / 7.5 / 10 until changed); a decimal point; 10% at most. It is charged on what is left after the
  // discounts, with GST on top.
  let servicePop = null; // { value: what is typed, '7.5' }
  const SERVICE = Object.freeze({ preset: 5, picks: Object.freeze([2.5, 5, 7.5, 10]), max: 10 });
  const serviceMax = () => SERVICE.max;
  function openService() {
    closeMenu();
    servicePop = { value: String(Math.min(order.servicePct || SERVICE.preset, serviceMax())) }; selected = null; sheet = 'service'; render();
  }
  const serviceOf = p => { const n = Number(p.value); return p.value !== '' && /^\d{1,2}(\.\d)?$/.test(p.value) && n > 0 && n <= serviceMax() ? n : null; };
  function pressService(k) {
    const p = servicePop; if (!p) return;
    const v = p.value;
    let next = k === 'clear' ? '' : k === 'back' ? v.slice(0, -1) : k === '.' ? (v.includes('.') ? v : `${v || '0'}.`) : v === '0' ? k : v + k;
    if (!/^\d{0,2}(\.\d?)?$/.test(next)) return;            // (up to 2 digits, one after the point)
    if (next !== '' && Number(next) > serviceMax()) return; // (a key that would go over the maximum does nothing)
    p.value = next; render();
  }
  function applyService() {
    const n = servicePop && serviceOf(servicePop); if (!n) return;
    const was = order.servicePct || 0; order.servicePct = n;
    if (n !== was) logEvent('svc', { pct: n, was });
    sheet = null; servicePop = null; render();
  }
  function cancelService() { sheet = null; servicePop = null; render(); }
  // Dish discount (Update 7), in two steps: pick the dishes (every line, each with a box; more than one can be picked and
  // they all get the same percentage) · then the percentage (quick picks 10 / 20 / 50 / 100, the number pad; at 100%, a
  // reason is needed). 0% (or Clear) takes a picked dish's discount off. The same discount on several lines is one
  // line's worth each: a line keeps its own.
  // At 100% (the dish made free) the reason is asked the way the void pop-up asks it, its top reasons learned the same
  // way (Update Pack 3, the owner's decision): the 9 this restaurant gives most, the list "@free" (see voids).
  let dishPop = null; // { step: 1 | 2, picked: [line keys], value, reason (what is on the reason line), typing }
  const dishPicks = () => billing().dishDiscount?.picks?.length ? billing().dishDiscount.picks : [10, 20, 50, 100];
  const dishReasons = () => learnedReasons(FREE_QUICK);
  function openDish() {
    closeMenu();
    const picked = order.lines.filter(l => l.off).map(keyOf);
    dishPop = { step: 1, picked, value: '', reason: '', typing: false }; selected = null; sheet = 'dish'; render();
  }
  function dishNext() {
    const p = dishPop; if (!p || !p.picked.length) return;
    const lines = p.picked.map(lineOf).filter(Boolean), offs = [...new Set(lines.map(l => l.off || 0))];
    p.step = 2; p.value = offs.length === 1 && offs[0] ? String(offs[0]) : '';
    const reasons = [...new Set(lines.map(l => l.offReason || ''))];
    p.reason = reasons.length === 1 ? reasons[0] : '';
    render();
  }
  const dishValue = p => { const n = Number(p.value); return p.value !== '' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : null; };
  function pressDish(k) {
    const p = dishPop; if (!p || p.step !== 2) return;
    const v = p.value, next = k === 'clear' ? '' : k === 'back' ? v.slice(0, -1) : v === '0' ? k : v + k;
    if (next !== '' && Number(next) > 100) return;
    p.value = next; render();
  }
  const dishReason = p => cleanReason(p.reason);
  function applyDish() {
    const p = dishPop; if (!p) return;
    const n = dishValue(p); if (n == null) return;
    const reason = n === 100 ? dishReason(p) : '';
    if (n === 100 && !reason) return;
    for (const key of p.picked) {
      const line = lineOf(key); if (!line) continue;
      const was = line.off || 0, name = itemOf(line).name;
      if (n !== was || (n === 100 && reason !== (line.offReason || ''))) {
        if (n > 0) logEvent('dish', { name, qty: line.qty, pct: n, was, ...(reason ? { reason } : {}), amount: window.RestroBill.lineOff(eachOf(line) * 100 * line.qty, n) });
        else logEvent('dish-off', { name, qty: line.qty, was });
      }
      if (n > 0) { line.off = n; if (reason) line.offReason = reason; else delete line.offReason; } else { delete line.off; delete line.offReason; }
    }
    tidy(); sheet = null; dishPop = null; selected = null; render();
  }
  function cancelDish() { sheet = null; dishPop = null; render(); }
  // Mark as priority (kitchen only): KOTs print with the ★ PRIORITY band, and the order header says ⚑ PRIORITY. Turned on
  // after a KOT has gone, a short priority notice goes to the kitchen.
  function togglePriority() {
    closeMenu();
    order.priority = !order.priority;
    const e = logEvent(order.priority ? 'priority' : 'priority-off'); render();
    if (!order.priority) return;
    const saved = savedOf(loadOrders());
    if (saved && Array.isArray(saved.kots) && saved.kots.some(k => (k.kind || 'kot') === 'kot')) {
      const list = loadOrders(), rec = savedOf(list);
      rec.priority = true; rec.events = [...cleanEvents(rec.events), e];
      const slip = kitchenSlip(rec, { kind: 'priority', at: Date.now(), lines: [] });
      rec.kots = [...rec.kots, { id: newKotId(), at: slip.at, kind: 'priority', by: staffName() }].slice(-60);
      storeOrders(list); keepOpened(rec);
      printSlip(slip, () => say('Order marked as priority · kitchen notified'));
    } else say('Order marked as priority');
  }
  // Reprint KOT: the order's KOTs as they were, to the kitchen printer again (no options, no "duplicate").
  function reprintKot() {
    closeMenu(); render();
    const saved = savedOf(loadOrders()), kots = (saved?.kots || []).filter(k => (k.kind || 'kot') === 'kot');
    if (!kots.length) { say('No KOT yet · Save sends the first one'); return; }
    const last = kots[kots.length - 1];
    printSlip(kitchenSlip(saved, last), () => say({ b: 'KOT reprinted', t: ' · sent to Kitchen printer' }));
  }
  // Move table: the Dining app, to pick the table the order moves to. Merge tables: pick a table whose open order comes
  // onto this one (its dishes, as the kitchen has them; that order goes when this one is saved). Change server: who
  // serves the order.
  function moveTable() { closeMenu(); render(); pickTable(); }
  function mergeTables() {
    closeMenu(); render();
    window.RestroFloor?.open({ pick: true, current: null, onPick: table => {
      const mine = o => (order.uid ? idOf(o) === order.uid : order.number ? o.number === order.number : false);
      const other = loadOrders().find(o => !o.paidAt && o.table === table.id && usesTable(o) && !mine(o));
      if (!other) { render(); say(`Table ${tableName(table.id)} has no open order`); return; }
      if (order.merged.includes(idOf(other))) { render(); return; }
      const r = onScreen(other);
      for (const l of r.lines) { l.type = order.split ? typeOf(r, l) : order.type || DEFAULT_TYPE; order.lines.push(l); }
      order.merged = [...order.merged, idOf(other)];
      logEvent('merge', { from: table.id, to: order.table || '', number: other.number });
      if (!order.type) order.type = 'dine-in';
      order.guests = cleanGuests((order.guests || 0) + (r.guests || 0)) || order.guests;
      if (r.note && r.note !== order.note) order.note = cleanNote(order.note ? `${order.note} · ${r.note}` : r.note);
      tidy(); render();
      say({ b: `Order ${ticket(other.number)}`, t: ` (table ${tableName(table.id)}) merged · Save to keep it` });
    } });
  }
  // Assign pager (Update Pack 3): a pager still out with another order (not docked) asks first: Same customer (they
  // kept it for this order too: both orders have it, Buzz on either rings it, and it comes back from both when docked)
  // or Handed back (it moves here: that order's pager is back). A pager tapped on the tablet's NFC spot goes on the order
  // on screen at once, with Undo (restro:pager-tapped).
  let pagerAsk = null; // { n, tapped } while the question is open
  const isMine = o => (order.uid ? idOf(o) === order.uid : order.number != null && o.number === order.number);
  const pagerOthers = n => (pagerHolders(loadOrders()).get(n) || []).filter(o => !isMine(o));
  function givePager(n, shared, tapped = false) {
    const was = { pager: order.pager, pagerAt: order.pagerAt, pagerShared: order.pagerShared }, target = order;
    order.pager = n; order.pagerAt = n ? Date.now() : null; order.pagerShared = Boolean(n && shared); // handed out now (even the same number again)
    sheet = null; pagerAsk = null; render();
    if (tapped && n) say({ b: `Pager ${n}`, t: ' assigned', undo: () => { if (order !== target) return; Object.assign(order, was); render(); } });
  }
  function choosePager(n, tapped = false) {
    if (n && n !== order.pager && pagerOthers(n).length) { pagerAsk = { n, tapped }; sheet = 'pagerask'; render(); return; }
    givePager(n, n === order.pager && order.pagerShared, tapped);
  }
  function cancelPagerAsk() { sheet = null; pagerAsk = null; render(); }
  let serverPop = null; // { } while Change server is open
  function openServer() {
    closeMenu();
    if (!window.RestroStaff?.list().length) { render(); say('No staff accounts yet · add them in Staff'); return; }
    serverPop = {}; sheet = 'server'; render();
  }
  function pickServer(person) {
    if ((order.uid || order.number) && person.name !== order.server) logEvent('server', { from: order.server || '', to: person.name });
    order.server = person.name; order.serverId = person.id; sheet = null; serverPop = null; render(); say({ b: person.name, t: ' is serving this order' }); }
  // Anything on screen to delete: items, a type, a table, a customer, a pager, a ready time, Modify, a discount, or a
  // saved order.
  const hasOrder = () => Boolean(order.lines.length || order.number || order.type || order.table || order.customer || order.pager || order.readyAt || order.split || order.discountPct || order.servicePct || order.note);
  // Delete order: the first tap asks again (Tap again to delete, until the menu closes); the second deletes the order
  // on screen. A saved order (opened from Orders, not paid) comes off Orders too. Once a KOT has gone (Update 7), the
  // void pop-up asks why first, and the kitchen gets ORDER CANCELLED (VOID ALL).
  function tapDelete() {
    const saved = savedOf(loadOrders());
    if (saved && Object.values(saved.sent || {}).some(n => n > 0)) { closeMenu(); openVoid(null, 0); return; }
    // (Update Pack 4, CS10: a scheduled order whose KOT is still queued: why first, and nothing prints in the kitchen)
    if (saved && cleanTime(saved.readyAt) && !saved.sentAt) { closeMenu(); openVoid(null, 0, true); return; }
    if (!deleteArmed) { deleteArmed = true; render(); dialog.querySelector('.cx-mi.del')?.focus({ preventScroll: true }); return; }
    const n = order.number;
    dropSaved();
    fresh(); toast(n ? `Order ${ticket(n)} deleted` : 'Order deleted');
  }
  // The saved order on screen (and its held copy) comes off Orders and Held
  function dropSaved() {
    const n = order.number;
    if (n) { const list = loadOrders(), gone = o => (order.uid ? idOf(o) === order.uid : o.number === n) && !o.paidAt; list.filter(gone).forEach(o => window.RestroSync?.removed('orders', idOf(o))); storeOrders(list.filter(o => !gone(o))); }
    if (order.heldId) { window.RestroSync?.removed('held', order.heldId); held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
  }
  // Order type: the four types open two by two over the context row and the order header, over the dimmed screen;
  // picking one sets it (every item moves to it) and closes them. Picking the type already chosen takes it off again:
  // the button shows Order type, and the order goes as Dine in. A tap on the dimmed screen closes them unchanged.
  function openTypeMenu(open) {
    typeMenu = open; render();
    (open ? dialog.querySelector('.cx-seg.lift [aria-pressed="true"]') || dialog.querySelector('.cx-seg.lift .cx-b') : dialog.querySelector('.cx-type'))?.focus({ preventScroll: true });
  }
  function pickType(key) {
    typeMenu = false;
    setType(order.type === key ? null : key);
    dialog.querySelector('.cx-type')?.focus({ preventScroll: true });
  }
  function setSplit(on) {
    if (on) order.lines.forEach(l => { l.type = l.type || order.type; });
    order.split = on;
    if (!on) { order.lines.forEach(l => { l.type = order.type; }); tidy(); toast(`Modify off · all items ${typeLabel[order.type || DEFAULT_TYPE].toLowerCase()}`); }
    selected = null; render();
  }
  // Puts the order on screen in Held, until the end of the day. A new order's table and pager are released (free for
  // another order); everything else stays as it was, the customer's phone number too. (A saved order's copy, parked with
  // changes, keeps them: the saved order still has them.) The server is whoever is signed in.
  function hold() {
    if (!order.lines.length) return false;
    const staff = window.RestroStaff?.current, saved = Boolean(order.number);
    const entry = { ...order, table: saved ? order.table : '', pager: saved ? order.pager : 0, pagerAt: saved ? order.pagerAt : null, heldId: order.heldId || window.RestroSync?.newId('h') || `h${Date.now()}`, savedAt: Date.now(), total: totals().total, holdUntil: endOfDay(),
      server: staff?.name || null, serverId: staff?.id || null };
    held = [entry, ...held.filter(h => h.heldId !== entry.heldId)].slice(0, 100); store(HELD_KEY, held);
    return true;
  }
  // Before another order takes the screen, the one on it goes to Held if it has anything not saved: a new order with
  // items, or a saved order with changes. A saved order with no changes is already in Orders.
  function park() {
    if (!order.lines.length || (order.number && signature(order) === baseline)) return false;
    return hold();
  }
  const fresh = () => { order = blankOrder(); baseline = null; opened = null; selected = null; sheet = null; modPop = null; qtyPop = null; notePop = null; discPop = null; typeMenu = false; optionsMenu = false; deleteArmed = false; scheduleDraft = null; servicePop = null; dishPop = null; voidPop = null; serverPop = null; render(); };
  // ---------- the kitchen (Counter Update 7) ----------
  // Save sends the KOT, and so does Pay: only the dishes the kitchen doesn't have yet (KOT #2 has only what was added
  // after KOT #1). A dish the kitchen has whose choices or note changed goes on a CHANGED slip; one taken off or reduced
  // goes on a VOID slip (with its reason, at once: the void pop-up); a deleted order on ORDER CANCELLED. Each slip is kept
  // on the order (kots: { id, at, kind: 'kot' | 'changed' | 'void' | 'cancel' | 'priority', no, lines, reason, by }) and
  // printed on the kitchen printer by the RESTRO Android app (printSlip). sent: how many of each dish (its kitchen key)
  // the kitchen has.
  const staffName = () => window.RestroStaff?.current?.name || null;
  const initialsOf = name => (typeof name === 'string' && name.trim() ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '');
  const newKotId = () => window.RestroSync?.newId?.('k') || `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const kotsOf = o => (Array.isArray(o?.kots) ? o.kots : []).filter(k => k && (k.kind || 'kot') === 'kot');
  // Track history (Update Pack 3): a change to the order on screen, kept with it when it is saved (one dropped before Save
  // never happened); Undo takes it back off
  const newEventId = () => window.RestroSync?.newId?.('e') || `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  function logEvent(kind, data = {}) {
    const e = { id: newEventId(), at: Date.now(), kind, by: staffName(), ...data };
    order.events = [...(order.events || []), e].slice(-200);
    return e;
  }
  const unlog = (...es) => { order.events = (order.events || []).filter(x => !es.some(e => e && e.id === x.id)); };
  // KOT numbers run through the business day for the whole restaurant (owner, 10 Nov 2026): the day's first KOT is #1,
  // starting again with the order numbers at the business day's cut-off. A KOT gets its number when it prints (Update
  // Pack 4, A2), from the restaurant's one sequence (RestroSync.takeKotNumber: the main system, or the cloud); without
  // sync, this tablet counts past every KOT it gave or saw that day (on any tablet's order, as they come in).
  const KOT_NO_KEY = 'restro.counter.kotNumber.v1';
  // The business day (Settings › Business details › Business hours): it ends when the restaurant closes, and the next
  // starts the minute after (open till 2 am: until 2:00 am it is still the day before)
  const businessDay = t => window.RestroSync?.dayOf?.(t) || window.RestroPrefs?.businessDay?.(t) || (d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)(new Date(t));
  function nextKotNo() {
    const now = Date.now(), day = businessDay(now), kept = load(KOT_NO_KEY, null);
    let next = kept && kept.day === day ? Number(kept.next) || 1 : 1;
    for (const o of loadOrders()) for (const k of kotsOf(o)) if (Number.isInteger(k.no) && k.no >= next && businessDay(Number(k.at) || 0) === day) next = k.no + 1;
    store(KOT_NO_KEY, { day, next: next + 1 });
    return next;
  }
  // A KOT's number, given as it prints and kept on its saved order at once. Resolves the number.
  const numbering = new Map(); // (KOT id → the number on its way)
  function numberKot(uid, kot) {
    if (kot.no) return Promise.resolve(kot.no);
    if (numbering.has(kot.id)) return numbering.get(kot.id).then(n => (kot.no = n));
    const job = (async () => {
      let t = null; try { t = await window.RestroSync?.takeKotNumber?.(); } catch { t = null; }
      const list = loadOrders(), rec = list.find(o => idOf(o) === uid), k = rec && (Array.isArray(rec.kots) ? rec.kots : []).find(x => x && x.id === kot.id);
      const no = k?.no || t?.number || nextKotNo();
      if (k && !k.no) { k.no = no; storeOrders(list); if (order.uid === uid) keepOpened(rec); }
      return no;
    })();
    numbering.set(kot.id, job);
    return job.then(n => { numbering.delete(kot.id); kot.no = n; return n; });
  }
  // Numbers a KOT, then prints it (a failed print is kept on its order: KOT !). Resolves the number.
  function printKot(o, kot) {
    const uid = idOf(o);
    return numberKot(uid, kot).then(n => { printSlip(kitchenSlip(loadOrders().find(x => idOf(x) === uid) || o, kot), null, { uid, id: kot.id }); return n; });
  }
  // The number of the KOT a dish (kitchen key) last went on
  const kotOfKey = (o, key) => { const k = [...kotsOf(o)].reverse().find(t => (t.lines || []).some(l => kitchenKey(l.id, l.type, l.mods) === key)); return k ? k.no || kotsOf(o).indexOf(k) + 1 : null; };
  // A line's choices as kept on a saved order and its slips (with their names, for the bill and the kitchen)
  const modObjs = mods => (mods || []).map(m => ({ id: m, label: optionOf.get(m)?.label || m, kind: optionOf.get(m)?.kind || 'other', price: optionOf.get(m)?.price || 0, ...(optionOf.get(m)?.mode === 'set' ? { sets: true } : {}) }));
  const thisDevice = () => window.RestroSync?.status?.()?.device?.id || null;
  // Sends the dishes the kitchen doesn't have yet as one KOT (its number comes as it prints: printKot). Returns the KOT,
  // or null.
  function sendToKitchen(entry, now = Date.now()) {
    if (!entry.sent || typeof entry.sent !== 'object') entry.sent = {};
    const groups = new Map();
    for (const l of entry.lines) {
      const k = kitchenKey(l.id, l.type, l.mods), g = groups.get(k);
      if (g) { g.qty += l.qty; if (l.note && !g.notes.includes(l.note)) g.notes.push(l.note); } else groups.set(k, { l, qty: l.qty, notes: l.note ? [l.note] : [] });
    }
    const lines = [];
    for (const [k, g] of groups) {
      const n = g.qty - (Number(entry.sent[k]) || 0); if (n <= 0) continue;
      const l = g.l;
      lines.push({ id: l.id, name: l.name, qty: n, type: l.type, ...(l.custom ? { custom: true, ...(l.custom.veg != null ? { veg: l.custom.veg } : {}) } : {}), ...(l.mods?.length ? { mods: l.mods } : {}), ...(g.notes.length ? { note: g.notes.join(' · ') } : {}) });
      entry.sent[k] = g.qty;
    }
    if (!lines.length) return null;
    const kot = { id: newKotId(), at: now, kind: 'kot', no: null, lines, ...(entry.priority ? { priority: true } : {}), by: staffName() };
    entry.sentAt = entry.sentAt || now; entry.kots = [...(Array.isArray(entry.kots) ? entry.kots : []), kot].slice(-60);
    return kot;
  }
  // The dishes on screen the kitchen has, whose choices or note changed since (a CHANGED slip): the kitchen's count moves
  // from the dish as it was to the dish as it is.
  function changedSlip(entry, o, now) {
    const lines = [];
    for (const l of o.lines) for (const k of l.kit || []) {
      const n = Math.min(k.n, l.qty);
      if (n <= 0 || (modsKey(k.mods) === modsKey(l.mods) && (k.note || '') === (l.note || ''))) continue;
      const type = typeOf(o, l), from = kitchenKey(l.id, type, k.mods), to = kitchenKey(l.id, type, l.mods);
      lines.push({ id: l.id, name: itemOf(l).name, qty: n, type, ...(l.mods.length ? { mods: modObjs(l.mods) } : {}), ...(l.note ? { note: l.note } : {}),
        was: { mods: modObjs(k.mods), note: k.note || '', kot: kotOfKey(entry, from) } });
      if (from !== to) { entry.sent[from] = (Number(entry.sent[from]) || 0) - n; if (entry.sent[from] <= 0) delete entry.sent[from]; entry.sent[to] = (Number(entry.sent[to]) || 0) + n; }
    }
    if (!lines.length) return null;
    const slip = { id: newKotId(), at: now, kind: 'changed', lines, by: staffName() };
    entry.kots = [...(Array.isArray(entry.kots) ? entry.kots : []), slip].slice(-60);
    return slip;
  }
  // The saved order (not paid yet) the order on screen carries on, if any
  const savedOf = list => (order.uid ? list.find(o => idOf(o) === order.uid && !o.paidAt) : order.number ? list.find(o => o.number === order.number && !o.paidAt) : null);
  // A saved order's sums from its own lines (as sync.js works them out): after a void is written to it
  function recordSums(rec) {
    const type = rec.type || DEFAULT_TYPE, lines = rec.lines.map(l => ({ id: l.id, each: Math.round(l.price * 100), qty: l.qty, off: l.off }));
    const charges = window.RestroBill.charges(type, lines, billing(), packagingOf);
    return { ...window.RestroBill.order({ lines, type, discountPct: rec.discountPct, servicePct: rec.servicePct, ...charges }, menu.taxRate), count: rec.lines.reduce((n, l) => n + l.qty, 0) };
  }
  // The saved order changed here without Save (a void, a priority notice): the order on screen carries on from it
  function keepOpened(rec) { opened = JSON.stringify(rec); baseline = signature(onScreen(rec)); }
  // Saves the order on screen in Orders (Save, or Pay with the payment) and sends it to the kitchen, unless it is
  // scheduled for later: then it goes at its ready time minus the preparation time. Saving again sends only what was added.
  // A new order takes `given` ({ day, number }, given as it was fired).
  function upsertOrder(pay, given = null) {
    const now = Date.now(), list = loadOrders(), prev = savedOf(list);
    const number = prev ? prev.number : given ? given.number : nextNumber();
    // The pager: the one on screen when it is saved. Picked in Assign Pager (even the same number again), it is handed
    // out now: out with the customer until it comes back. Not touched since the order was opened, it stays as it was
    // (back, if it came back meanwhile). With none on screen, an order whose pager came back keeps that pager's number,
    // still back, for the record.
    const onScreenPager = cleanPager(order.pager), holders = pagerHolders(list);
    const untouched = onScreenPager && prev && cleanPager(prev.pager) === onScreenPager && (Number(prev.pagerAt) || 0) === (Number(order.pagerAt) || 0);
    const record = !onScreenPager && prev && cleanPager(prev.pager) && !holdsPager(prev, holders);
    const pagerFields = onScreenPager
      ? { pager: onScreenPager, pagerAt: order.pagerAt || prev?.pagerAt || (prev ? createdOf(prev) : now), ...(order.pagerShared ? { pagerShared: true } : {}), ...(untouched && prev.pagerBackAt ? { pagerBackAt: prev.pagerBackAt } : {}) }
      : record ? { pager: prev.pager, ...(prev.pagerAt ? { pagerAt: prev.pagerAt } : {}), ...(prev.pagerBackAt ? { pagerBackAt: prev.pagerBackAt } : {}) } : { pager: 0 };
    let entry = { uid: prev ? idOf(prev) : window.RestroSync?.newId('o') || `o${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, number, type: order.type || DEFAULT_TYPE, split: order.split, table: order.type ? order.table : '', customer: order.customer, ...pagerFields, readyAt: order.readyAt || null,
      // (Update Pack 4) how its KOT goes: "queue" (Schedule KOT: it prints by itself at the kitchen time) or "now" (Instant
      // KOT: with Save or Pay); and the prep time the kitchen time was worked out with
      kotMode: order.readyAt ? (order.kotMode === 'now' ? 'now' : 'queue') : null, prepMin: order.readyAt ? prepOf(order.prepMin) : null,
      // each line's price is one with its add-ons (a choice that sets the price: that price); its choices and note; its
      // dish discount (Update 7); a custom item keeps what was typed for it (Counter Update 5), so the order opens again
      // with it
      lines: order.lines.map(l => ({ id: l.id, name: itemOf(l).name, price: eachOf(l), qty: l.qty, type: lineType(l), ...(l.custom ? { custom: { ...l.custom } } : {}),
        ...(l.mods?.length ? { mods: modObjs(l.mods) } : {}), ...(l.note ? { note: l.note } : {}),
        ...(l.off ? { off: l.off, ...(l.offReason ? { offReason: l.offReason } : {}) } : {}) })), ...totals(),
      // Update 7: the order note (on every KOT), priority (kitchen only), the guest count
      ...(order.note ? { note: order.note } : {}), ...(order.priority ? { priority: true } : {}), ...(order.guests ? { guests: order.guests } : {}),
      createdAt: prev ? createdOf(prev) : now, savedAt: now, day: prev ? prev.day : given?.day || window.RestroSync?.today(), sent: prev && prev.sent && typeof prev.sent === 'object' ? { ...prev.sent } : {}, sentAt: prev ? cleanTime(prev.sentAt) : null, kots: prev && Array.isArray(prev.kots) ? prev.kots : [],
      method: pay ? pay.method : null, received: pay ? pay.received : null, change: pay ? pay.change : null, paidAt: pay ? new Date(now).toISOString() : null,
      // the server: as changed with Change server (Update 7), otherwise whoever was signed in when it was first saved
      server: order.server || (prev && prev.server) || staffName(), serverId: order.serverId || (prev && prev.serverId) || window.RestroStaff?.current?.id || null,
      // (Update Pack 3) what happened to it, for Track history: opened at the first save, which what was done before
      // then counts from
      events: prev ? cleanEvents(order.events) : [{ id: newEventId(), at: now, kind: 'open', by: staffName(), type: order.type || DEFAULT_TYPE, table: usesTable(order) ? order.table : '',
        guests: order.guests || 0, customer: order.customer?.name || '' }, ...cleanEvents(order.events).map(e => ({ ...e, at: Math.max(e.at, now) }))],
      // (the tablet that saved it last sends its KOT at the kitchen time, when it is scheduled)
      ...(thisDevice() ? { savedOn: thisDevice() } : {}),
      // kept from the kitchen screen: the kitchen's "complete" (until more items go to the kitchen)
      ...(prev?.kitchenDoneAt ? { kitchenDoneAt: prev.kitchenDoneAt } : {}), ...(prev?.kitchenAt ? { kitchenAt: prev.kitchenAt } : {}),
      // an order this tablet had from before it joined the others keeps its own number until the main system settles it
      ...(prev?.numberProvisional ? { numberProvisional: true } : {}), ...(prev && Number.isInteger(prev.numberWas) ? { numberWas: prev.numberWas } : {}),
      // (Update Pack 3) the bill and receipt prints (a later print is a REPRINT) and what a delivery app's integration
      // sent with the order
      ...Object.fromEntries(KEPT.filter(k => prev && prev[k] != null).map(k => [k, prev[k]])),
      ...(!prev && Array.isArray(order.bills) && order.bills.length ? { bills: order.bills } : {}),
      // the bill's number (Update Pack 3), given at its first print or at the payment
      ...(order.billNo && !prev?.billNo ? { billNo: order.billNo, billYear: order.billYear } : {}) };
    // Changed on another tablet since it was opened here: both tablets' changes are kept (items added on both, and so on)
    if (prev && opened && window.RestroSync && JSON.stringify(prev) !== opened) entry = window.RestroSync.mergeRecord('orders', JSON.parse(opened), entry, prev);
    // (a pager handed out here is out, even if the one it replaced came back on another tablet meanwhile)
    if (entry.pagerBackAt && !pagerFields.pagerBackAt && entry.pager === pagerFields.pager && (entry.pagerAt || 0) === (pagerFields.pagerAt || 0)) delete entry.pagerBackAt;
    // Merge tables (Update 7): the orders whose dishes came onto this one go; what their kitchen had, this one has
    const gone = list.filter(o => !o.paidAt && order.merged.includes(idOf(o)) && idOf(o) !== entry.uid);
    for (const o of gone) {
      if (!entry.sent || typeof entry.sent !== 'object') entry.sent = {};
      for (const [k, n] of Object.entries(o.sent && typeof o.sent === 'object' ? o.sent : {})) if (n > 0) entry.sent[k] = (Number(entry.sent[k]) || 0) + n;
      entry.kots = [...(Array.isArray(entry.kots) ? entry.kots : []), ...(Array.isArray(o.kots) ? o.kots.map(k => ({ ...k, from: o.number })) : [])].slice(-60);
      if (!entry.sentAt && o.sentAt) entry.sentAt = o.sentAt;
      window.RestroSync?.removed('orders', idOf(o));
    }
    if (!entry.sent || typeof entry.sent !== 'object') entry.sent = {};
    // (Update Pack 4: Instant KOT, a KOT that has printed already (new dishes go on a new KOT), or a kitchen time that has
    // passed: now)
    const goesNow = !entry.readyAt || entry.kotMode === 'now' || kotPrinted(entry) || kitchenTime(entry) <= now;
    const changed = goesNow ? changedSlip(entry, order, now) : null;
    const kot = goesNow ? sendToKitchen(entry, now) : null;
    // (a scheduled order's KOT before its kitchen time, Instant KOT: the slip says "(sent early)")
    if (kot && cleanTime(entry.readyAt) && now < kitchenTime(entry)) kot.how = 'early';
    // more for the kitchen: not complete any more; the kitchen's timer (Orders, Update Pack 3) starts with the KOT that
    // takes the order into the kitchen
    if (kot) { entry.kitchenAt = entry.kitchenDoneAt ? now : entry.kitchenAt || entry.sentAt || now; delete entry.kitchenDoneAt; }
    // A pager handed out or given up here: every other order that had that number and is back from it keeps when it came
    // back, for the record (handed back: when this order was given it; shared with this order, same customer: not back)
    const others = list.filter(o => idOf(o) !== entry.uid && !gone.includes(o));
    if (!untouched && !record) {
      const was = cleanPager(prev?.pager), before = pagersBack(list), after = pagersBack([entry, ...others]), numbers = new Set([was, cleanPager(entry.pager)].filter(Boolean));
      for (const o of others) {
        const n = cleanPager(o.pager); if (!numbers.has(n) || o.pagerBackAt) continue;
        const at = after.get(idOf(o)) || (n === was && n !== cleanPager(entry.pager) ? before.get(idOf(o)) : 0);
        if (at) o.pagerBackAt = at;
      }
    }
    storeOrders([entry, ...others]);
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    // The kitchen printer: the CHANGED slip, then the KOT (with its number)
    if (changed) printSlip(kitchenSlip(entry, changed));
    const printed = kot ? printKot(entry, kot) : null;
    return { entry, kot, printed, sentNow: kot ? kot.lines.reduce((n, l) => n + l.qty, 0) : 0, isNew: !prev };
  }
  const KEPT = ['bills', 'receipts', 'billNo', 'billYear', 'platform', 'platformNo', 'platformType', 'platformLogo', 'pickupAt', 'readyBy', 'callCode', 'handover', 'riderAt', 'platformReadyAt', 'payRef'];
  // Fires the order on screen (Save, or Pay with the payment). With other tablets, only while this tablet reaches the
  // main system or the cloud, as a new order takes its number from them, so no two orders share one. Otherwise it says
  // so and the order stays on screen. Returns what upsertOrder does, or null. A dish that sold out before its KOT went
  // (Update 7) stops it: "Fish fingers is now sold out · remove it to send KOT".
  let firing = false;
  const cantFire = pay => {
    const st = window.RestroSync?.status();
    return `${!st?.cloud.setUp ? 'Can’t reach the main system' : st.paired ? 'No connection' : 'No internet'} · ${pay ? 'payment not taken' : 'order not saved'}`;
  };
  const blockingSoldOut = () => order.lines.find(l => !l.custom && soldOut(l.id) && l.qty > sentOf(l)) || null;
  async function fire(pay) {
    const sync = window.RestroSync, target = order;
    if (firing || !order.lines.length) return null;
    const out = blockingSoldOut();
    if (out) { say({ kind: 'error', b: `${itemOf(out).name} is now sold out`, sub: 'Remove it to send KOT' }); return null; }
    if (sync && !sync.canFire()) { toast(cantFire(pay)); return null; }
    let given = null;
    if (sync && !savedOf(loadOrders())) {
      firing = true;
      try { given = await sync.takeNumber(); } catch { given = null; } finally { firing = false; }
      if (!given) { toast(cantFire(pay)); return null; }
      if (order !== target || !order.lines.length) return null; // another order took the screen meanwhile
    }
    // (Update Pack 3) paid: the bill has its number, if no bill was printed before
    if (pay && sync?.takeBillNumber && !order.billNo && !savedOf(loadOrders())?.billNo) {
      firing = true; let bill = null;
      try { bill = await sync.takeBillNumber(); } catch { bill = null; } finally { firing = false; }
      if (!bill) { toast(cantFire(pay)); return null; }
      if (order !== target) return null;
      order.billNo = bill.number; order.billYear = bill.year;
    }
    return upsertOrder(pay, given);
  }
  // Save: the order goes to Orders (not paid yet) and its KOT to the kitchen; a new order starts.
  async function saveOrder() {
    if (askKot('save')) return;
    const done = await fire(null); if (!done) return;
    const { entry, kot, printed } = done;
    fresh();
    // (Update Pack 4, CS6 and CS9) a scheduled order: "· KOT prints at 9:30 pm", or "· KOT sent to the kitchen"; the KOT's
    // number once it has one
    const no = printed ? await printed : null;
    const kitchen = entry.readyAt ? (kot ? 'KOT sent to the kitchen' : !entry.sentAt ? `KOT prints ${kitchenWhen(kitchenTime(entry))}` : '') : kot ? `KOT #${no} sent` : '';
    say({ b: `Order ${ticket(entry.number)} saved`, t: kitchen ? ` · ${kitchen}` : '' });
  }
  // Hold (always there): the order on screen waits in Held until the end of the day, as the customer may call or come
  // back, and a new order starts. A new order's table and pager are free meanwhile; a saved order stays in Orders as it
  // was saved and is held with its changes, keeping its table and pager (as when another order takes the screen).
  // Update Pack 4 (C11): only before any KOT has gone to the kitchen (after that the Hold pill is greyed, and does
  // nothing); a scheduled order's queued KOT doesn't stop it, and nothing prints while it is held. A held order lets its
  // table and pager go (a saved one's too); its customer and ready time stay.
  function holdTicket() {
    if (!order.lines.length) { toast('Nothing to hold'); return; }
    const list = loadOrders(), rec = savedOf(list);
    if (kotPrinted(rec)) return;
    const freed = [usesTable(order) ? `table ${tableName(order.table)}` : '', order.pager ? `pager ${order.pager}` : ''].filter(Boolean);
    const said = `${order.number ? `Order ${ticket(order.number)} on hold` : 'On hold'} until the end of the day${freed.length ? ` · ${freed.join(' and ')} free` : ''}`;
    if (rec) {
      order.table = ''; order.pager = 0; order.pagerAt = null; order.pagerShared = false;
      rec.table = ''; if (cleanPager(rec.pager) && !rec.pagerBackAt) rec.pagerBackAt = Date.now();
      storeOrders(list);
    }
    hold(); toast(said); fresh();
  }
  // ---------- Schedule (Update Pack 4: Counter scheduling, CS1–CS12) ----------
  // The time the customer wants the order ready: Today · Tomorrow · Pick a date (business days: 12:30 am belongs to the
  // day before until the cut-off), then hour · minute (in 5s) · am/pm on wheels (hour and minute go round). Only times
  // inside business hours (Settings › Business details; Update Pack 4, C1): the others are greyed on the wheels and
  // turning skips them, and a day the restaurant is closed can't be picked. The kitchen gets the KOT that order type's
  // prep time before (Settings › Kitchen). Two equal grey buttons: Schedule KOT (it prints by itself then) and Instant KOT
  // (it prints with Save or Pay, as for any order). Too soon (the kitchen time has passed): Instant KOT only. While the KOT
  // is queued, Clear schedule makes it a normal order again. Once a KOT has printed, one button, Save new time: the new
  // time is saved at once and the kitchen gets a TIME CHANGED slip.
  // scheduleDraft: { day (the business day, "2026-11-12"), h (0–23), m, cal (the calendar's month, "2026-11", while it is
  // open), then ("save" / "pay": a resumed held order asked before Save or Pay) }
  const pad2 = n => String(n).padStart(2, '0');
  const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const bizKey = t => window.RestroSync?.dayOf?.(t) || window.RestroPrefs?.businessDay?.(t) || dkey(new Date(t));
  const keyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return dkey(d); };
  // (a time on a business day: one up to its closing time the next morning is on the next date)
  const atOn = (k, h, m) => { const d = keyDate(k); if (h * 60 + m <= (window.RestroPrefs?.spillMinutes?.(k) ?? 0)) d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return d.getTime(); };
  // a business day's opening hours ({ from, to }, null: closed that day); without Settings, any time
  const hoursOn = k => (window.RestroPrefs?.hoursOn ? window.RestroPrefs.hoursOn(k) : { from: -Infinity, to: Infinity });
  // the time on a business day nearest to h:m that is inside its hours (5-minute steps; `half`: in the am (false) or pm
  // (true) half only, when it has one), or null when it is closed
  function nearestOpen(k, h, m, half = null) {
    const w = hoursOn(k); if (!w) return null;
    const want = atOn(k, h, m), first = Math.ceil(w.from / 300000) * 300000, last = Math.floor(w.to / 300000) * 300000;
    let best = Math.min(last, Math.max(first, want));
    if (half != null && Number.isFinite(first) && Number.isFinite(last)) {
      let gap = Infinity;
      for (let t = first; t <= last; t += 300000) if ((new Date(t).getHours() >= 12) === half && Math.abs(t - want) < gap) { gap = Math.abs(t - want); best = t; }
    }
    const c = new Date(best);
    return { h: c.getHours(), m: c.getMinutes() };
  }
  const dateWords = k => keyDate(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); // "Thu 12 Nov"
  const dayWord = k => { const today = bizKey(Date.now()); return k === today ? 'today' : k === addDays(today, 1) ? 'tomorrow' : dateWords(k); };
  const sameDay = t => bizKey(t) === bizKey(Date.now());
  // the Schedule pill: "10:00 pm" today, "Thu 1:00 pm" another day; the KOT line: "at 9:30 pm", "Thu 12 Nov, 12:30 pm"
  const readyShort = t => (sameDay(t) ? timeOf(t) : `${keyDate(bizKey(t)).toLocaleDateString('en-GB', { weekday: 'short' })} ${timeOf(t)}`);
  const kitchenWhen = t => (sameDay(t) ? `at ${timeOf(t)}` : `${dateWords(bizKey(t))}, ${timeOf(t)}`);
  // (the kitchen has some of the saved order: a KOT has printed)
  function kotPrinted(rec) { return Boolean(rec) && Object.values(rec.sent && typeof rec.sent === 'object' ? rec.sent : {}).some(n => n > 0); }
  function openSchedule(then = null) {
    const now = Date.now(), prep = prepMinutes(order.type || DEFAULT_TYPE);
    // the time on the order, or the soonest the kitchen can have it ready (now and the prep time, on to the next 5
    // minutes): inside business hours, so the opening time when it isn't open yet, or the next day it is open
    const soon = Math.ceil((now + prep * 60000) / 300000) * 300000;
    let at = order.readyAt || soon;
    if (!order.readyAt) for (let i = 0; i < 14; i++) {
      const k = addDays(bizKey(soon), i), w = hoursOn(k); if (!w) continue;
      const t = Math.max(soon, Math.ceil(w.from / 300000) * 300000); if (t <= w.to) { at = t; break; }
    }
    const r = new Date(at);
    scheduleDraft = { day: bizKey(r.getTime()), h: r.getHours(), m: r.getMinutes() - r.getMinutes() % 5, cal: null, then };
    modPop = null; qtyPop = null; notePop = null; optionsMenu = false; deleteArmed = false;
    sheet = 'schedule'; render();
  }
  function closeSchedule() { scheduleDraft = null; sheet = null; render(); }
  // Schedule KOT ("queue") or Instant KOT ("now"): the plum pill with the time, and the line under the order
  function chooseSchedule(mode) {
    const d = scheduleDraft; if (!d) return;
    order.readyAt = atOn(d.day, d.h, d.m); order.kotMode = mode; order.prepMin = prepMinutes(order.type || DEFAULT_TYPE);
    const then = d.then; scheduleDraft = null; sheet = null; render();
    if (then === 'save') saveOrder(); else if (then === 'pay') { cashInput = ''; sheet = 'pay'; render(); }
  }
  // Clear schedule (CS12): a normal order again; its KOT prints with Save or Pay
  function clearSchedule() {
    order.readyAt = null; order.kotMode = null; order.prepMin = null;
    scheduleDraft = null; sheet = null; render();
    say({ b: 'Schedule cleared', t: ' · KOT prints when you tap Save or Pay' });
  }
  // Save new time (CS11): the KOT has printed, so the new time is saved now and the kitchen gets a TIME CHANGED slip (no
  // dishes: cook as already sent)
  function saveNewTime() {
    const d = scheduleDraft, list = loadOrders(), rec = savedOf(list); if (!d || !rec) return;
    const at = atOn(d.day, d.h, d.m), was = cleanTime(rec.readyAt), now = Date.now();
    if (at === was) { closeSchedule(); return; }
    const first = kotsOf(rec)[0];
    const slip = { id: newKotId(), at: now, kind: 'time', readyAt: at, was, kot: first ? { no: first.no || null, at: first.at } : null, lines: [], by: staffName() };
    rec.readyAt = at; rec.prepMin = prepMinutes(rec.type || DEFAULT_TYPE); rec.kots = [...(Array.isArray(rec.kots) ? rec.kots : []), slip].slice(-60); rec.savedAt = now;
    storeOrders(list);
    order.readyAt = at; order.prepMin = rec.prepMin; keepOpened(rec);
    scheduleDraft = null; sheet = null; render();
    printSlip(kitchenSlip(rec, slip));
    say({ b: `Ready by ${readyShort(at)}`, t: ' · TIME CHANGED slip sent to the kitchen' });
  }
  // A resumed held order that is scheduled (C11): Save or Pay asks Schedule KOT or Instant KOT again
  function askKot(then) { if (!(order.readyAt && order.kotMode === 'ask')) return false; openSchedule(then); return true; }
  function resume(id) {
    const entry = held.find(h => h.heldId === id); if (!entry) return;
    if (order.heldId !== id) park();
    window.RestroSync?.removed('held', id); held = held.filter(h => h.heldId !== id); store(HELD_KEY, held);
    order = restoreOrder(entry);
    // A held copy of a saved order carries on with that order (unless it has been paid since). A new order comes back
    // without a table or a pager: they were released when it was held.
    const saved = order.number ? loadOrders().find(o => (order.uid ? idOf(o) === order.uid : o.number === order.number) && !o.paidAt) : null;
    if (!saved) { order.number = null; order.uid = null; order.table = ''; order.pager = 0; order.pagerAt = null; order.pagerShared = false; }
    else {
      order.number = saved.number;
      // (the saved order's pager came back meanwhile: no longer on screen, as when the order is opened)
      if (order.pager && order.pager === cleanPager(saved.pager) && !holdsPager(saved)) { order.pager = 0; order.pagerAt = null; order.pagerShared = false; }
    }
    baseline = saved ? signature(onScreen(saved)) : null; opened = saved ? JSON.stringify(saved) : null;
    // (C11: a scheduled order chooses Schedule KOT or Instant KOT again when it is saved)
    if (order.readyAt && !kotPrinted(saved)) order.kotMode = 'ask';
    sheet = null; selected = null; render(); toast('Order resumed');
  }
  // Opens a saved order that is not paid yet (by its id, or its number), to add items or take the payment.
  function openOrder(ref) {
    const saved = loadOrders().find(o => (typeof ref === 'string' ? idOf(o) === ref : o.number === ref) && !o.paidAt);
    if (order.number && (saved ? (order.uid ? order.uid === idOf(saved) : order.number === saved.number) : order.number === ref)) { sheet = null; render(); return; }
    if (!saved) return;
    park();
    order = onScreen(saved); baseline = signature(order); opened = JSON.stringify(saved);
    sheet = null; selected = null; render(); toast(`Order ${ticket(saved.number)} opened`);
  }
  function removeHeld(id) { window.RestroSync?.removed('held', id); held = held.filter(h => h.heldId !== id); store(HELD_KEY, held); render(); }
  // Checked every 20 seconds: tickets on Hold end with the day, and each scheduled order goes to the kitchen at its
  // ready time minus the preparation time (with a notification and a chime).
  function sweep() {
    const now = Date.now();
    const keep = held.filter(h => !(cleanTime(h.holdUntil) && h.holdUntil <= now)), heldChanged = keep.length !== held.length;
    if (heldChanged) { held = keep; store(HELD_KEY, held); }
    const list = loadOrders(); let sent = 0;
    // (the ticket carries its kitchen time)
    const printing = [], onHold = new Set(held.map(h => h.uid).filter(Boolean));
    for (const o of list) {
      if (!(cleanTime(o.readyAt) && kitchenTime(o) <= now) || o.kotMode === 'now' || onHold.has(idOf(o)) || o.cancelledBy) continue;
      // (Update Pack 4, C4: it prints on time from any tablet. The tablet that saved it last prints it at the kitchen time
      // (so the KOT has one number); when it hasn't 30 seconds later, the main system does, and 2 minutes later any other
      // tablet: it prints even when that tablet is off, and the moment one comes on. Until then the others announce it.)
      const late = now - kitchenTime(o), wait = window.RestroSync?.status?.()?.device?.main ? 30000 : 120000;
      if (window.RestroSync && o.savedOn && o.savedOn !== thisDevice() && !(!o.sentAt && late >= wait)) { if (!o.sentAt && !announced.has(idOf(o))) { announced.add(idOf(o)); announceKitchen(o); } continue; }
      const kot = sendToKitchen(o, kitchenTime(o)); if (!kot) continue;
      kot.how = 'queue'; // (printed by itself: the slip says "(scheduled)")
      o.kitchenAt = o.kitchenDoneAt ? kot.at : o.kitchenAt || o.sentAt || kot.at; delete o.kitchenDoneAt;
      announceKitchen(o); sent++; printing.push([o, kot]);
    }
    if (sent) storeOrders(list);
    for (const [o, kot] of printing) printKot(o, kot);
    if (dialog.open && (heldChanged || (sent && sheet === 'orders'))) render();
  }
  const announced = new Set();
  function announceKitchen(o) {
    const count = o.lines.reduce((n, l) => n + l.qty, 0);
    const message = [`Ready by ${whenShort(o.readyAt)}`, describe(o), `${count} item${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    window.RestroNotifications?.push({ id: `kitchen-${idOf(o)}`, title: `Order ${ticket(o.number)} sent to kitchen`, message, source: 'Counter', appId: 'register' });
    window.RestroSound?.play('alert');
    toast(`Order ${ticket(o.number)} sent to kitchen · ready by ${whenShort(o.readyAt)}`);
  }
  setInterval(sweep, 20000);
  document.addEventListener('DOMContentLoaded', sweep);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sweep(); });
  window.addEventListener('restro:prep-time-changed', () => { sweep(); if (dialog.open && (sheet === 'orders' || sheet === 'schedule')) render(); });
  // A pager docked back in its docking station: the docking station is connected to the main system, whose Android app
  // reports it (restro:pager-docked, { number }). The orders that had the pager let it go (pagerBackAt): their Buzz goes
  // grey (the number stays, for the record), and the pager is free for another order. The mark syncs to the other
  // tablets. Opened again, the order shows no pager.
  window.addEventListener('restro:pager-docked', e => {
    const n = cleanPager(Number(e.detail?.number)), list = loadOrders(), hs = n ? pagerHolders(list).get(n) || [] : [];
    if (!hs.length) return;
    const at = Date.now(); for (const h of hs) h.pagerBackAt = at;
    storeOrders(list);
    if (dialog.open) render();
  });
  // A pager tapped on the tablet's NFC spot (Update Pack 3; the RESTRO Android app reads it: restro:pager-tapped,
  // { number }). With Counter open it goes on the order on screen at once, with Undo (still out with another order: the
  // same question as Assign pager's; not while another pop-up is open). Elsewhere it opens that pager's order: in Counter
  // while it isn't paid, in Orders once it is.
  window.addEventListener('restro:pager-tapped', e => {
    const n = cleanPager(Number(e.detail?.number)); if (!n) return;
    if (dialog.open) { if (!sheet || sheet === 'pager') choosePager(n, true); return; }
    const o = (pagerHolders(loadOrders()).get(n) || [])[0];
    if (!o) { toast(`Pager ${n} isn’t out`); return; }
    if (o.paidAt) { window.RestroOrders?.open({ find: idOf(o) }); return; }
    openCounter(); fromFloor = false; fromOrders = false; openOrder(idOf(o));
  });
  // Changes from another tablet (sync.js): Held and Orders show them at once, and so does the saved order on screen.
  window.addEventListener('restro:data-changed', e => {
    const names = e.detail?.collections || [];
    if (names.includes('held')) { held = load(HELD_KEY, []); if (!Array.isArray(held)) held = []; if (order.heldId && !order.number && !held.some(h => h.heldId === order.heldId)) order.heldId = null; }
    if (names.includes('orders') && (order.uid || order.number)) followOpenOrder();
    // (settings: what is sold out, the charges; Update 7)
    if (dialog.open && (names.includes('held') || names.includes('orders') || names.includes('settings'))) render();
  });
  window.addEventListener('restro:prefs-changed', e => { if (dialog.open && e.detail?.name === 'billing') render(); });
  // The look chosen in Settings › Counter, here or (for all tablets) on another tablet
  window.addEventListener('restro:prefs-changed', e => {
    if (e.detail?.name !== 'counter') return;
    const v = counterLook(), style = v.style !== menuStyle, rows = v.perRow !== tilesPerRow;
    if (!style && !rows) return;
    menuStyle = v.style; tilesPerRow = v.perRow;
    if (dialog.open) render(); else renderMenuBody();
    if (style) window.dispatchEvent(new CustomEvent('restro:counter-style-changed', { detail: { id: menuStyle } }));
    if (rows) window.dispatchEvent(new CustomEvent('restro:counter-tiles-changed', { detail: { tilesPerRow } }));
  });
  // An order this tablet had from before it joined the others, whose number another order that day has: it was given the
  // next free number.
  window.addEventListener('restro:orders-renumbered', e => {
    const list = (e.detail?.orders || []).filter(r => Number.isInteger(r.from) && Number.isInteger(r.to));
    if (!list.length) return;
    for (const r of list) if (order.uid && order.uid === r.uid) order.number = r.to;
    toast(list.length > 2 ? `${list.length} orders have new numbers` : list.map(r => `Order ${ticket(r.from)} is now ${ticket(r.to)}`).join(' · '));
    if (dialog.open) render();
  });
  // The saved order on screen changed on another tablet. With nothing unsaved here it shows the new version; with
  // changes here it carries on, and Save or Pay merges both. Paid or deleted there: what was added here (if anything)
  // stays on screen as a new order.
  function followOpenOrder() {
    const stored = loadOrders().find(o => (order.uid ? idOf(o) === order.uid : o.number === order.number));
    const unsaved = signature(order) !== baseline;
    if (stored && !stored.paidAt) {
      if (opened === JSON.stringify(stored) || unsaved) return;
      order = onScreen(stored); baseline = signature(order); opened = JSON.stringify(stored);
      return;
    }
    const n = order.number, was = opened ? restoreOrder(JSON.parse(opened)) : null;
    const before = new Map((was ? was.lines : []).map(l => [`${l.id}@${typeOf(was, l)}${modsKey(l.mods)}${offKey(l)}`, l.qty]));
    const added = unsaved ? order.lines.map(l => { const { kit, ...rest } = l; return { ...rest, qty: l.qty - (before.get(keyOf(l)) || 0) }; }).filter(l => l.qty > 0) : [];
    const how = stored ? 'paid' : 'deleted';
    if (added.length) {
      order = { ...order, number: null, uid: null, heldId: null, lines: added }; baseline = null; opened = null; selected = null;
      toast(`Order ${ticket(n)} was ${how} on another tablet · your new items are a new order`);
    } else { fresh(); toast(`Order ${ticket(n)} was ${how} on another tablet`); }
  }
  // A table tapped on the Floor: the order on that table (on screen, saved and not paid, or a saved order's held copy)
  // if it has one, otherwise a new Dine in order with the table already chosen. An order on screen with anything not
  // saved goes to Held (a new order's table and pager are freed). A held order never keeps a table busy.
  function openTable(id) {
    const forTable = o => o.table === id && usesTable(o);
    query = ''; category = null;
    if (forTable(order) && (order.lines.length || order.number)) { selected = null; sheet = null; render(); return; }
    const open = loadOrders().find(o => !o.paidAt && forTable(o));
    if (open) { openOrder(idOf(open)); return; }
    const waiting = held.find(h => h.number && forTable(h));
    if (waiting) { resume(waiting.heldId); return; }
    const parked = park();
    order = { ...blankOrder(), type: 'dine-in', table: id }; baseline = null; opened = null; selected = null; sheet = null; render();
    if (parked) toast(`Previous order on hold · ${held.length} held`);
  }
  // Pay: the order is saved as paid (and goes to the kitchen if it has not yet), then the receipt shows.
  async function complete(received) {
    const t = totals(); if (!t.count || received < t.total) return;
    const done = await fire({ method: 'cash', received, change: received - t.total }); if (!done) return;
    const { entry } = done;
    receipt = entry; sheet = 'receipt'; order = blankOrder(); baseline = null; opened = null; selected = null; category = null; query = ''; cashInput = ''; render();
    window.RestroSound?.play('tick');
    window.dispatchEvent(new CustomEvent('restro:order-paid', { detail: entry }));
    // (Bill number "At payment": the numbered receipt prints by itself, on the bill printer of the RESTRO app)
    if (atPayment() && typeof window.RESTRODevice?.printer?.printBill === 'function') printReceipt(idOf(entry));
  }
  function printReceipt(uid) {
    printSaved(uid).then(r => {
      const n = loadOrders().find(o => idOf(o) === uid)?.number;
      if (!r.ok) say({ kind: 'error', b: 'Receipt not printed', sub: n ? `Order ${ticket(n)}` : '', retry: () => printReceipt(uid) });
    });
  }

  // ---------- messages (Counter Update 7; Update Pack 4, A4) ----------
  // One place, one look: a dark bar at the bottom of the menu, level with Save and Pay, as wide as what it says (icon ·
  // message · UNDO / RETRY ✕, no empty stretch). Confirmations (a green tick) go after 2 s ("Order #1033 saved · KOT prints
  // at 9:30 pm"), Undo after 4 s ("Chicken biryani removed · UNDO"), errors (a red "!", a red left edge) stay until Retry
  // or ✕ ("Kitchen printer offline · KOT #3 not sent"). One at a time: a new one takes the old one's place. Its time stops
  // while a finger is on it, and follows Android's accessibility "Time to take action" (RESTRODevice.recommendedTimeout,
  // ANDROID-BRIDGE.md).
  let msg = null; // { kind: 'confirm' | 'undo' | 'error', b (bold), t, sub (after " · "), undo, retry, left, timer, since }
  const BASE_MS = { confirm: 2000, undo: 4000 };
  function timeFor(kind) {
    const ms = BASE_MS[kind];
    try { const r = Number(window.RESTRODevice?.recommendedTimeout?.(ms, kind === 'undo')); if (Number.isFinite(r) && r >= ms) return r; } catch {}
    return ms;
  }
  function say(m) {
    if (typeof m === 'string') m = { t: m };
    if (msg) clearTimeout(msg.timer);
    if (!dialog.open) { msg = null; if (typeof window.toast === 'function') window.toast(`${m.b || ''}${m.t || ''}${m.sub ? ` · ${m.sub}` : ''}`); return; }
    const kind = m.kind || (m.undo ? 'undo' : m.retry ? 'error' : 'confirm');
    msg = { ...m, kind, left: kind === 'error' ? null : timeFor(kind) };
    runMsg(); paintMsg();
  }
  function runMsg() {
    const m = msg; if (!m || m.left == null || m.held) return;
    clearTimeout(m.timer); m.since = Date.now();
    m.timer = setTimeout(() => { if (msg === m) { msg = null; paintMsg(); } }, m.left);
  }
  function holdMsg(on) {
    const m = msg; if (!m || m.left == null) return;
    if (on && !m.held) { clearTimeout(m.timer); m.left = Math.max(400, m.left - (Date.now() - m.since)); m.held = true; }
    else if (!on && m.held) { m.held = false; runMsg(); }
  }
  function dropMsg() { if (msg) clearTimeout(msg.timer); msg = null; paintMsg(); }
  function msgView() {
    const m = msg; if (!m) return null;
    const act = fn => () => { dropMsg(); fn(); };
    const hold = () => holdMsg(true), let_go = () => holdMsg(false);
    const err = m.kind === 'error';
    return el('div', { class: `cx-msg ${m.kind}${m.kind === 'confirm' ? ' plain' : ''}`, role: err ? 'alert' : 'status',
      onpointerdown: hold, onpointerup: let_go, onpointercancel: let_go, onpointerleave: let_go },
      el('i', { class: 'cx-msg-i', 'aria-hidden': 'true' }, err ? el('b', {}, '!') : mi('check', 16)),
      el('span', {}, m.b ? el('b', {}, m.b) : null, m.t || '', m.sub ? ` · ${m.sub}` : ''),
      m.undo ? el('button', { type: 'button', onclick: act(m.undo) }, 'UNDO') : null,
      m.retry ? el('button', { type: 'button', onclick: act(m.retry) }, 'RETRY') : null,
      m.kind === 'error' ? el('button', { type: 'button', class: 'xs', 'aria-label': 'Dismiss', onclick: dropMsg }, mi('close', 22)) : null);
  }
  // (drawn on its own, so a message never redraws the screen)
  function paintMsg() {
    root.querySelector('.cx-msg')?.remove();
    const node = msgView(); if (!node) return;
    root.append(node);
  }

  // ---------- the kitchen printer (Update 7) ----------
  // Each slip as the kitchen printer prints it (26_kot-slips-v2): the order type on a black band; the action, when there
  // is one, in a red box (★ PRIORITY, VOID, CHANGED, ORDER CANCELLED); KOT # · Order #, then the table, the pager or the
  // pickup time, bold; guests · time · server (or the customer, or "By:") small; the order note in a red box; then each
  // dish: quantity × name, its choices one per line right-aligned in red, its note last in red italics; a small footer.
  // The RESTRO Android app prints it (RESTRODevice.printer.printKot) on the printers whose role is Kitchen or Both, in
  // each one's KOT language (anything but English as an image) and copies (Settings › Devices › Printers).
  const BAND = { 'dine-in': 'DINE-IN', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', phone: 'PHONE ORDER' };
  const labelOf = m => (typeof m === 'string' ? optionOf.get(m)?.label || m : m?.label || m?.id || '');
  // What changed on a dish (a CHANGED slip): "Medium spicy → Less spicy", "+ No onion", "− Less oil", "+ Note: …"
  function changesOf(l) {
    const was = l.was?.mods || [], now = l.mods || [], out = [];
    const groupOf = m => optionOf.get(typeof m === 'string' ? m : m?.id)?.group || null;
    const ids = list => list.map(m => (typeof m === 'string' ? m : m?.id));
    const before = ids(was), after = ids(now), done = new Set();
    for (const m of before) {
      if (after.includes(m)) continue;
      const g = groupOf(m), swap = g && (groups.get(g)?.required || groups.get(g)?.single) ? after.find(x => groupOf(x) === g && !before.includes(x)) : null;
      if (swap) { out.push(`${labelOf(m)} → ${labelOf(swap)}`); done.add(swap); } else out.push(`− ${labelOf(m)}`);
    }
    for (const m of after) if (!before.includes(m) && !done.has(m)) out.push(`+ ${labelOf(m)}`);
    const n0 = l.was?.note || '', n1 = l.note || '';
    if (n0 !== n1) out.push(n1 ? `+ Note: ${n1}` : '− Note');
    return out;
  }
  // (Update Pack 4, 03_Printed-slips) A delivery app's order: the app's name is the band (SWIGGY, never DELIVERY), its order
  // number under KOT # · Order #, then "Pickup 7:25 PM" (delivery) or "Ready by 7:05 PM" (the customer collects it). A
  // scheduled order: a red band "SCHEDULED · READY 10:00 PM" on every KOT, and the time it printed says "(scheduled)" or
  // "(sent early)". Times on slips in capitals: "9:30 PM".
  const appName = o => (o?.platform ? String(o.platform).charAt(0).toUpperCase() + String(o.platform).slice(1) : '');
  const slipTime = t => timeOf(t).toUpperCase();
  function kitchenSlip(o, k) {
    const kind = k.kind || 'kot', type = o.type || DEFAULT_TYPE, no = k.no || null, nos = kotsOf(o).map(x => x.no).filter(Boolean);
    const app = appName(o), timeOf = slipTime;
    const action = kind === 'void' ? 'VOID' : kind === 'changed' ? 'CHANGED' : kind === 'cancel' ? 'ORDER CANCELLED' : kind === 'time' ? 'TIME CHANGED' : kind === 'priority' || k.priority || o.priority ? '★ PRIORITY' : null;
    const where = app ? `${app} #${o.platformNo || '—'}` : usesTable(o) ? `Table ${tableName(o.table)}` : cleanPager(o.pager) ? `Pager ${o.pager}` : type === 'phone' && o.readyAt ? `Pickup ${timeOf(o.readyAt)}` : '';
    const appTime = !app ? '' : o.platformType === 'pickup' ? (o.readyBy ? `Ready by ${timeOf(o.readyBy)}` : '') : o.pickupAt ? `Pickup ${timeOf(o.pickupAt)}` : '';
    const at = timeOf(k.at || Date.now()), by = k.byApp || initialsOf(k.by || staffName()), server = initialsOf(o.server);
    // (a scheduled order's KOT: printed by itself at the kitchen time, or before it: Send now, Instant KOT)
    const sched = kind === 'kot' && cleanTime(o.readyAt) && !app, when = sched && k.how ? `${at} (${k.how === 'queue' ? 'scheduled' : 'sent early'})` : at;
    const kotNo = kind === 'void' || kind === 'changed' ? k.lines?.[0]?.kot || k.lines?.[0]?.was?.kot || null : no;
    // (the customer's name and whole phone number: owner, 11 Nov 2026)
    const who = o.customer ? [o.customer.name, o.customer.mobile || ''].filter(Boolean).join(' · ') : '';
    const info = kind === 'cancel' && app ? [appTime, 'VOID ALL', at, by ? `By: ${by}` : '']
      : kind === 'cancel' ? [`VOID ALL${nos.length ? ` · KOT ${nos.map(n => `#${n}`).join(', ')}` : ''}`, at, by ? `By: ${by}` : '']
      // (Update Pack 4) TIME CHANGED: "was 10:00 PM · KOT #163 sent 9:30 PM · 9:41 PM · By: RK"
      : kind === 'time' ? [k.was ? `was ${timeOf(k.was)}` : '', k.kot ? `KOT ${k.kot.no ? `#${k.kot.no} ` : ''}sent ${timeOf(k.kot.at)}` : '', at, by ? `By: ${by}` : '']
      : kind === 'void' || kind === 'changed' ? [at, by ? `By: ${by}` : '']
      : app ? [appTime, o.customer?.name || '', at, server]
      : type === 'dine-in' ? [o.guests ? plural(o.guests, 'guest') : '', when, server ? `Server: ${server}` : '']
      : [who, when, server];
    const place = kotsOf(o).findIndex(x => x === k || (k.id && x.id === k.id));
    const earlier = (place < 0 ? kotsOf(o).filter(x => (Number(x.at) || 0) < (Number(k.at) || 0)) : kotsOf(o).slice(0, place)).map(x => x.no).filter(Boolean);
    return {
      kind, type, band: app ? app.toUpperCase() : BAND[type], action, scheduled: sched ? `SCHEDULED · READY ${timeOf(o.readyAt)}` : null, kot: kind === 'time' ? null : kotNo, order: ticket(o.number),
      title: (kind === 'cancel' && !app) || kind === 'time' ? `Order ${ticket(o.number)}${where ? ` · ${where}` : ''}` : `${(kotNo || (kind === 'cancel' && nos[0])) ? `KOT #${kotNo || nos.join(', #')} · ` : ''}Order ${ticket(o.number)}`,
      where: kind === 'cancel' && !app ? '' : kind === 'time' ? `Ready by ${timeOf(k.readyAt)}` : where, info: info.filter(Boolean).join(' · '), at: k.at || Date.now(), priority: Boolean(action === '★ PRIORITY'),
      note: (kind === 'kot' || kind === 'priority') && o.note ? o.note : '',
      lines: (k.lines || []).map(l => ({ qty: l.qty, name: l.name, names: items.get(l.id)?.names || null, mods: kind === 'changed' ? changesOf(l) : (l.mods || []).map(labelOf), note: l.note || '' })),
      footer: kind === 'kot' && earlier.length ? `KOT ${earlier.map(n => `#${n}`).join(', ')} sent earlier · only new dishes on this KOT` : kind === 'priority' ? 'Priority · cook this order first' : kind === 'time' ? 'No dish changes · cook as already sent' : k.reason ? `Reason: ${k.reason}` : '',
      reason: k.reason || '', by: k.by || null,
      // the kitchen printers (Settings › Devices › Printers): KOT language and copies
      printers: Object.entries(window.RestroPrefs?.get('printers') || {}).filter(([, p]) => p && (p.role === 'kitchen' || p.role === 'both')).map(([id, p]) => ({ id, language: p.language || 'English', copies: p.copies || 1 }))
    };
  }
  // A slip to the kitchen printer; a printer that doesn't answer is an error with Retry ("Kitchen printer offline /
  // KOT #3 not sent"). Without the app (a browser) there is no kitchen printer: the slip is kept on the order only.
  // `mark` ({ uid, id }): the KOT on the saved order, which keeps whether its print failed (Orders shows KOT !).
  function printSlip(slip, ok, mark) {
    const what = slip.kind === 'kot' ? `KOT #${slip.kot}` : slip.kind === 'void' ? 'VOID slip' : slip.kind === 'changed' ? 'CHANGED slip' : slip.kind === 'cancel' ? 'ORDER CANCELLED slip' : slip.kind === 'time' ? 'TIME CHANGED slip' : 'Priority notice';
    sendSlip(slip, mark).then(r => { if (r.ok) ok?.(); else say({ kind: 'error', b: 'Kitchen printer offline', sub: `${what} not sent`, retry: () => printSlip(slip, ok, mark) }); });
  }
  // Prints a slip and resolves { ok, why }: why the kitchen printer didn't print it, when the RESTRO Android app says
  // ("paper", "offline", "cover"). A KOT that fails is kept as failed on its saved order until a print of it goes, and
  // this tablet prints it again on its own every 30 seconds meanwhile (Update Pack 3).
  function sendSlip(slip, mark) {
    const printer = window.RESTRODevice?.printer;
    if (typeof printer?.printKot !== 'function') return Promise.resolve({ ok: true });
    const done = (ok, why = '') => { if (mark) markKot(mark.uid, mark.id, !ok, why); return { ok, why }; };
    try {
      return Promise.resolve(printer.printKot(slip)).then(r => (r === false || r?.ok === false ? done(false, cleanWhy(r?.reason)) : done(true)), e => done(false, cleanWhy(e?.reason)));
    } catch (e) { return Promise.resolve(done(false, cleanWhy(e?.reason))); }
  }
  const cleanWhy = why => (['paper', 'offline', 'cover'].includes(why) ? why : '');
  function markKot(uid, id, failed, why = '') {
    const list = loadOrders(), rec = list.find(o => idOf(o) === uid), k = rec && (Array.isArray(rec.kots) ? rec.kots : []).find(x => x && x.id === id);
    if (!k || (Boolean(k.failed) === failed && (k.failWhy || '') === why)) return;
    if (failed) { k.failed = true; if (why) k.failWhy = why; else delete k.failWhy; } else { delete k.failed; delete k.failWhy; }
    storeOrders(list); if (order.uid === uid) keepOpened(rec);
  }
  // (the KOTs this tablet printed that failed, every 30 seconds)
  function retryKots() {
    if (typeof window.RESTRODevice?.printer?.printKot !== 'function') return;
    for (const o of loadOrders()) {
      if ((window.RestroSync && o.savedOn && o.savedOn !== thisDevice()) || o.cancelledBy) continue; // (not one a delivery app cancelled)
      // (and a KOT that never got its number, the app closed meanwhile: numbered and printed now)
      for (const k of kotsOf(o)) if (k.failed && k.no) sendSlip(kitchenSlip(o, k), { uid: idOf(o), id: k.id }); else if (!k.no && !numbering.has(k.id) && Date.now() - (Number(k.at) || 0) > 30000) printKot(o, k);
    }
  }
  setInterval(retryKots, 30000);

  // ---------- voids (Update 7) ----------
  // After a KOT has gone, taking a dish off or below what the kitchen has, or deleting the order, asks why first (a
  // reason is needed). Then it happens at once and for good: the VOID slip (ORDER CANCELLED for the whole order) prints
  // in the kitchen, the saved order changes straight away, and there is no Undo. Who did it and why are kept on the
  // order. (No PIN for now: "PIN required" comes with the access levels, Update Pack 4 A3.)
  // The reasons are learned (Update Pack 2, void pop-up v2; not a setting): the 9 this restaurant gives most, of all
  // time, worked out by the backend from the reasons kept on its orders every 15 days, at the close of day (near-same
  // ones merged, no fewest number of uses), and published with the quick notes as lists: "@void" (a dish taken off or
  // lowered), "@cancel" (an order deleted) and "@free" (a dish made free, 100% off: the reasons kept on its lines,
  // offReason; Update Pack 3). There is no starting set: a new restaurant has none until its first lists come, and the
  // reason is typed.
  let voidPop = null; // { key (the line; null: the whole order), to (the quantity it goes to), reason (what is on the reason line), typing }
  const VOID_QUICK = '@void', CANCEL_QUICK = '@cancel', FREE_QUICK = '@free';
  function learnedReasons(id) {
    const kept = load(QUICK_KEY, null), list = kept && typeof kept === 'object' && Array.isArray(kept.lists?.[id]) ? kept.lists[id] : [];
    const out = new Map();
    for (const x of list) { const t = cleanReason(typeof x === 'string' ? x : x?.text); if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t); }
    return [...out.values()].slice(0, 9);
  }
  function openVoid(key, to, queued = false) {
    if (key != null && !lineOf(key)) return;
    voidPop = { key, to, reason: '', typing: false, queued }; modPop = null; qtyPop = null; notePop = null; optionsMenu = false; deleteArmed = false;
    if (key != null) selected = key;
    sheet = 'void'; render();
  }
  function cancelVoid() { dialog.querySelector('#counter-reason')?.blur(); sheet = null; voidPop = null; render(); }
  const voidReason = p => cleanReason(p.reason);
  function confirmVoid() {
    const p = voidPop; if (!p) return;
    const reason = voidReason(p); if (!reason) return;
    dialog.querySelector('#counter-reason')?.blur();
    const list = loadOrders(), rec = savedOf(list), now = Date.now(), by = staffName();
    if (p.key == null && p.queued) {
      // (CS10) its KOT was still queued: the queued KOT goes with it and nothing prints in the kitchen
      if (rec) keepCancelled(rec, { at: now, reason, by });
      const n = order.number;
      dropSaved(); fresh();
      say({ b: n ? `Order ${ticket(n)} deleted` : 'Order deleted' });
      return;
    }
    if (p.key == null) {
      // The whole order: ORDER CANCELLED (VOID ALL), everything the kitchen has, with minus quantities
      const slip = rec ? cancelSlipOf(rec, reason, by, now) : null;
      if (rec) { rec.kots = [...(rec.kots || []), slip]; keepCancelled(rec, slip); printSlip(kitchenSlip(rec, slip)); }
      const n = order.number;
      dropSaved(); fresh();
      say({ b: n ? `Order ${ticket(n)} deleted` : 'Order deleted', t: ' · VOID sent to kitchen' });
      return;
    }
    const line = lineOf(p.key); if (!line) { cancelVoid(); return; }
    const type = lineType(line), n = sentOf(line) - Math.max(0, p.to);
    // What goes: taken off what the kitchen has of the line, its last parts first
    const parts = [];
    let left = n;
    for (let i = (line.kit || []).length - 1; i >= 0 && left > 0; i--) {
      const k = line.kit[i], t = Math.min(k.n, left);
      k.n -= t; left -= t; parts.push({ n: t, mods: [...k.mods], note: k.note });
      if (!k.n) line.kit.splice(i, 1);
    }
    if (line.kit && !line.kit.length) delete line.kit;
    // the saved order: the dishes come off it, and off what the kitchen has; the VOID slip is kept on it
    const slipLines = parts.map(part => ({ id: line.id, name: itemOf(line).name, qty: -part.n, type, ...(part.mods.length ? { mods: modObjs(part.mods) } : {}), kot: rec ? kotOfKey(rec, kitchenKey(line.id, type, part.mods)) : null }));
    const gross = eachOf(line) * 100 * n, slip = { id: newKotId(), at: now, kind: 'void', lines: slipLines, reason, by, amount: gross - window.RestroBill.lineOff(gross, line.off) };
    if (rec) {
      if (!rec.sent || typeof rec.sent !== 'object') rec.sent = {};
      for (const part of parts) {
        const k = kitchenKey(line.id, type, part.mods);
        rec.sent[k] = (Number(rec.sent[k]) || 0) - part.n; if (rec.sent[k] <= 0) delete rec.sent[k];
        let take = part.n;
        for (const rl of rec.lines) if (take > 0 && kitchenKey(rl.id, rl.type, rl.mods) === k) { const t = Math.min(rl.qty, take); rl.qty -= t; take -= t; }
      }
      rec.lines = rec.lines.filter(rl => rl.qty > 0);
      rec.kots = [...(Array.isArray(rec.kots) ? rec.kots : []), slip].slice(-60);
      Object.assign(rec, recordSums(rec)); rec.savedAt = now;
      storeOrders(list); keepOpened(rec);
      printSlip(kitchenSlip(rec, slip));
    }
    // the order on screen
    sheet = null; voidPop = null;
    if (p.to <= 0) removeLine(p.key, true); else { line.qty = p.to; render(); }
    say({ b: 'VOID', t: ` sent to kitchen · ${n} × ${itemOf(line).name}` });
  }
  // An order deleted after its KOT went is kept on this tablet for the record (who, when, why, what the kitchen had), until
  // the backend keeps it (the latest 200).
  const CANCELLED_KEY = 'restro.counter.cancelled.v1';
  function cancelSlipOf(rec, reason, by, now) {
    const lines = [];
    for (const [k, n] of Object.entries(rec.sent || {})) {
      if (!(n > 0)) continue;
      const l = rec.lines.find(x => kitchenKey(x.id, x.type, x.mods) === k) || [...kotsOf(rec)].reverse().flatMap(x => x.lines || []).find(x => kitchenKey(x.id, x.type, x.mods) === k);
      if (l) lines.push({ id: l.id, name: l.name, qty: -n, type: l.type, ...(l.mods?.length ? { mods: l.mods } : {}) });
    }
    return { id: newKotId(), at: now, kind: 'cancel', lines, reason, by };
  }
  function keepCancelled(rec, slip) {
    try {
      const list = JSON.parse(localStorage.getItem(CANCELLED_KEY) || '[]');
      list.unshift({ uid: idOf(rec), number: rec.number, day: rec.day || null, at: slip.at, reason: slip.reason, by: slip.by, type: rec.type, table: rec.table || '', total: rec.total,
        kot: kotsOf(rec).length > 0, bill: Array.isArray(rec.bills) && rec.bills.length > 0, ...(rec.billNo ? { billNo: billLabel(rec.billNo), billYear: rec.billYear } : {}), lines: rec.lines.map(l => ({ id: l.id, name: l.name, qty: l.qty, price: l.price })) });
      localStorage.setItem(CANCELLED_KEY, JSON.stringify(list.slice(0, 200)));
    } catch {}
  }
  // (Update Pack 4, 03_Printed-slips §4, §5) A delivery app cancelled one of its orders (its integration tells the page:
  // restro:platform-cancelled). The order stays, "Cancelled by Swiggy" in Orders (cancelledBy, and the payout the app
  // gives). When its KOT has printed, the ORDER CANCELLED slip prints by itself: the app's name in the band, "By: Swiggy",
  // what the kitchen has with minus quantities, "Reason: Cancelled by Swiggy". Not printed yet: nothing prints.
  function platformCancelled(d) {
    const platform = String(d?.platform || '').trim().toLowerCase(), id = String(d?.id ?? '').trim();
    if (!platform || !id) return false;
    const list = loadOrders(), rec = list.find(o => String(o.platform || '').toLowerCase() === platform && String(o.platformNo ?? '') === id);
    if (!rec || rec.cancelledBy) return false;
    const app = appName(rec), now = Date.now();
    rec.cancelledBy = app;
    if (['awaiting', 'paid', 'unpaid'].includes(d.payout)) rec.payout = d.payout;
    if (Number.isFinite(d.payoutAmount)) rec.payoutAmount = Math.round(d.payoutAmount);
    const slip = kotPrinted(rec) ? { ...cancelSlipOf(rec, `Cancelled by ${app}`, null, now), byApp: app } : null;
    if (slip) rec.kots = [...kotsOf(rec), slip].slice(-60);
    rec.savedAt = now; storeOrders(list);
    if (slip) printSlip(kitchenSlip(rec, slip));
    if (dialog.open) render();
    return true;
  }
  window.addEventListener('restro:platform-cancelled', e => platformCancelled(e.detail));

  // ---------- rendering ----------
  const typeLabel = { 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', phone: 'Phone call' };
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  function pickTable() {
    window.RestroFloor?.open({ pick: true, current: order.table, guests: order.guests, onPick: table => {
      if (order.table && order.table !== table.id && (order.uid || order.number)) logEvent('move', { from: order.table, to: table.id });
      order.table = table.id;
      // (Update 7: the guest count, asked in the Dining app the first time the table is picked for the order)
      if (cleanGuests(table.guests)) order.guests = table.guests;
      if (!order.type) { order.type = 'dine-in'; order.lines.forEach(l => { l.type = l.type || 'dine-in'; }); tidy(); } // a table means Dine in
      render();
    } });
  }
  function pickCustomer() {
    window.RestroCustomers?.open({ pick: true, needAddress: order.type === 'delivery', current: order.customer?.id, onPick: c => { order.customer = cleanCustomer(c); render(); } });
  }
  // How an order is described in Held orders and on the receipt: type, then the table or the customer.
  const describe = o => {
    const type = o.split ? `Modify · ${[...new Set(o.lines.map(l => typeLabel[l.type || o.type || DEFAULT_TYPE]).filter(Boolean))].join(' + ')}` : typeLabel[o.type] || '';
    const who = o.type === 'dine-in' ? (o.table ? `Table ${tableName(o.table)}` : '') : o.customer ? o.customer.name : '';
    return [type, who, cleanPager(o.pager) ? `Pager ${o.pager}` : ''].filter(Boolean).join(' · ');
  };
  // A saved order's sums as on its bill: Subtotal, its discount, CGST and SGST (GST on an order from before Update 6),
  // the round off
  const sumsOf = o => {
    const sub = Number.isFinite(o.subtotal) ? o.subtotal : 0, pct = window.RestroBill.pct(o.discountPct), split = Number.isFinite(o.cgst) && Number.isFinite(o.sgst);
    return [['Subtotal', money(sub)], ...(pct && Number.isFinite(o.discount) ? [[`Discount ${pct}%`, `−${money(o.discount)}`]] : []),
      // (Update 7: the service charge, packaging and delivery)
      ...(o.servicePct && Number(o.service) ? [[`Service charge ${o.servicePct}% (optional)`, money(o.service)]] : []),
      ...(Number(o.packaging) ? [['Packaging charge', money(o.packaging)]] : []), ...(Number(o.delivery) ? [['Delivery charge', money(o.delivery)]] : []),
      ...(split ? [[GST.cgst, money(o.cgst)], [GST.sgst, money(o.sgst)]] : [[menu.taxLabel, money(o.tax || 0)]]),
      ...(Number(o.roundOff) ? [['Round off', `${o.roundOff < 0 ? '−' : ''}${money(Math.abs(o.roundOff))}`]] : [])];
  };
  // Orders as kept on this device, items checked: all of them, newest first (Orders), or the paid ones by payment time (Payment history).
  const withLines = o => ({ ...o, createdAt: createdOf(o), lines: o.lines.filter(l => l && typeof l.name === 'string' && Number.isFinite(l.qty) && Number.isFinite(l.price)) });
  const allOrders = () => loadOrders().map(withLines).sort((a, b) => b.createdAt - a.createdAt);
  const paidOrders = () => loadOrders().filter(o => !Number.isNaN(Date.parse(o.paidAt))).map(withLines).sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  const dayKey = when => { const d = new Date(when); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const dayLabel = when => {
    const d = new Date(when), now = new Date(), yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return 'Today';
    if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
    return d.toLocaleDateString('en-IN', d.getFullYear() === now.getFullYear() ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const timeOf = when => new Date(when).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  // "7:30 pm" today, "Fri 7:30 pm" on another day.
  const whenShort = when => dayKey(when) === dayKey(Date.now()) ? timeOf(when) : `${new Date(when).toLocaleDateString('en-IN', { weekday: 'short' })} ${timeOf(when)}`;
  const methodLabel = { cash: 'Cash', upi: 'UPI', card: 'Card' };
  // (Update Pack 5) paid in part (the Pay screen, to come: paidAmount in paise, less than the total): Orders' Part paid
  const partPaid = o => !o.paidAt && Number(o.paidAmount) > 0 && Number(o.paidAmount) < (Number(o.total) || 0);
  // ---------- the Counter screen (POS Counter Handoff) ----------
  // The order panel on the left (context buttons, the order's lines, totals, Save and Pay) and the menu on the right
  // (the three-line menu, search, Held · Orders · Payment history, then the menu in the display style chosen in
  // Settings > Counter). Sizes are the design's 1440 x 900 screen scaled to the tablet (counter.css). Icons are
  // Material Symbols Rounded (filled), as in the design; the order types' are the one set every app shares
  // (order-type-icons.js, Update Pack 5 Icon Pack 1), drawn plain in the label's colour.
  const MI = {
    check: 'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z',
    backspace: 'M360-200q-20 0-37.5-9T294-234L153-434q-15-21-15-46t15-46l141-200q11-16 28.5-25t37.5-9h400q33 0 56.5 23.5T840-680v400q0 33-23.5 56.5T760-200H360Zm200-224 76 76q11 11 28 11t28-11q11-11 11-28t-11-28l-76-76 76-76q11-11 11-28t-11-28q-11-11-28-11t-28 11l-76 76-76-76q-11-11-28-11t-28 11q-11 11-11 28t11 28l76 76-76 76q-11 11-11 28t11 28q11 11 28 11t28-11l76-76Z',
    receipt_long:'M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480Z',
    expand_more: 'M480-362q-8 0-15-2.5t-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5Z',
    vibration: 'M40-600q17 0 28.5 11.5T80-560v160q0 17-11.5 28.5T40-360q-17 0-28.5-11.5T0-400v-160q0-17 11.5-28.5T40-600Zm120-80q17 0 28.5 11.5T200-640v320q0 17-11.5 28.5T160-280q-17 0-28.5-11.5T120-320v-320q0-17 11.5-28.5T160-680Zm760 80q17 0 28.5 11.5T960-560v160q0 17-11.5 28.5T920-360q-17 0-28.5-11.5T880-400v-160q0-17 11.5-28.5T920-600Zm-120-80q17 0 28.5 11.5T840-640v320q0 17-11.5 28.5T800-280q-17 0-28.5-11.5T760-320v-320q0-17 11.5-28.5T800-680ZM320-120q-33 0-56.5-23.5T240-200v-560q0-33 23.5-56.5T320-840h320q33 0 56.5 23.5T720-760v560q0 33-23.5 56.5T640-120H320Z',
    schedule: 'M520-496v-144q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640v159q0 8 3 15.5t9 13.5l132 132q11 11 28 11t28-11q11-11 11-28t-11-28L520-496ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z',
    person_add: 'M720-520h-80q-17 0-28.5-11.5T600-560q0-17 11.5-28.5T640-600h80v-80q0-17 11.5-28.5T760-720q17 0 28.5 11.5T800-680v80h80q17 0 28.5 11.5T920-560q0 17-11.5 28.5T880-520h-80v80q0 17-11.5 28.5T760-400q-17 0-28.5-11.5T720-440v-80Zm-360 40q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM40-240v-32q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v32q0 33-23.5 56.5T600-160H120q-33 0-56.5-23.5T40-240Z',
    edit: 'M160-120q-17 0-28.5-11.5T120-160v-97q0-16 6-30.5t17-25.5l505-504q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L313-143q-11 11-25.5 17t-30.5 6h-97Zm544-528 56-56-56-56-56 56 56 56Z',
    pause_circle: 'M400-320q17 0 28.5-11.5T440-360v-240q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v240q0 17 11.5 28.5T400-320Zm160 0q17 0 28.5-11.5T600-360v-240q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v240q0 17 11.5 28.5T560-320ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z',
    remove: 'M240-440q-17 0-28.5-11.5T200-480q0-17 11.5-28.5T240-520h480q17 0 28.5 11.5T760-480q0 17-11.5 28.5T720-440H240Z',
    add: 'M440-440H240q-17 0-28.5-11.5T200-480q0-17 11.5-28.5T240-520h200v-200q0-17 11.5-28.5T480-760q17 0 28.5 11.5T520-720v200h200q17 0 28.5 11.5T760-480q0 17-11.5 28.5T720-440H520v200q0 17-11.5 28.5T480-200q-17 0-28.5-11.5T440-240v-200Z',
    save: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h447q16 0 30.5 6t25.5 17l114 114q11 11 17 25.5t6 30.5v447q0 33-23.5 56.5T760-120H200Zm280-120q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35ZM280-560h280q17 0 28.5-11.5T600-600v-80q0-17-11.5-28.5T560-720H280q-17 0-28.5 11.5T240-680v80q0 17 11.5 28.5T280-560Z',
    payments: 'M120-160q-33 0-56.5-23.5T40-240v-400q0-17 11.5-28.5T80-680q17 0 28.5 11.5T120-640v400h640q17 0 28.5 11.5T800-200q0 17-11.5 28.5T760-160H120Zm160-160q-33 0-56.5-23.5T200-400v-320q0-33 23.5-56.5T280-800h560q33 0 56.5 23.5T920-720v320q0 33-23.5 56.5T840-320H280Zm80-80q0-33-23.5-56.5T280-480v80h80Zm400 0h80v-80q-33 0-56.5 23.5T760-400Zm-200-40q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35ZM280-640q33 0 56.5-23.5T360-720h-80v80Zm560 0v-80h-80q0 33 23.5 56.5T840-640Z',
    menu: 'M160-240q-17 0-28.5-11.5T120-280q0-17 11.5-28.5T160-320h640q17 0 28.5 11.5T840-280q0 17-11.5 28.5T800-240H160Zm0-200q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520h640q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H160Zm0-200q-17 0-28.5-11.5T120-680q0-17 11.5-28.5T160-720h640q17 0 28.5 11.5T840-680q0 17-11.5 28.5T800-640H160Z',
    search: 'M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z',
    history: 'M480-120q-126 0-223-76.5T131-392q-4-15 6-27.5t27-14.5q16-2 29 6t18 24q24 90 99 147t170 57q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h70q17 0 28.5 11.5T360-600q0 17-11.5 28.5T320-560H160q-17 0-28.5-11.5T120-600v-160q0-17 11.5-28.5T160-800q17 0 28.5 11.5T200-760v54q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm40-376 100 100q11 11 11 28t-11 28q-11 11-28 11t-28-11L452-452q-6-6-9-13.5t-3-15.5v-159q0-17 11.5-28.5T480-680q17 0 28.5 11.5T520-640v144Z',
    print: 'M320-120q-33 0-56.5-23.5T240-200v-80h-80q-33 0-56.5-23.5T80-360v-160q0-51 35-85.5t85-34.5h560q51 0 85.5 34.5T880-520v160q0 33-23.5 56.5T800-280h-80v80q0 33-23.5 56.5T640-120H320Zm400-560H240v-80q0-33 23.5-56.5T320-840h320q33 0 56.5 23.5T720-760v80Zm0 220q17 0 28.5-11.5T760-500q0-17-11.5-28.5T720-540q-17 0-28.5 11.5T680-500q0 17 11.5 28.5T720-460ZM320-200h320v-160H320v160Z',
    print_disabled: 'M763-84 640-206h80v6q0 33-23.5 56.5T640-120H320q-33 0-56.5-23.5T240-200v-80h-80q-33 0-56.5-23.5T80-360v-160q0-51 35-85.5t85-34.5h6L83-763q-12-12-12-28.5T83-820q12-12 28.5-12t28.5 12l680 680q12 12 12 28t-12 28q-12 12-28.5 12T763-84ZM320-200h320v-6L486-360H320v160Zm522-91q-16 9-34 8t-32-15L502-572q-19-19-8.5-43.5T531-640h229q50 0 85 35t35 85v160q0 25-11 42.5T842-291ZM427-680q-16 0-30.5-6T371-703l-69-69q-19-19-8.5-43.5T331-840h309q33 0 56.5 23.5T720-760v40q0 17-11.5 28.5T680-680H427Zm293 220q17 0 28.5-11.5T760-500q0-17-11.5-28.5T720-540q-17 0-28.5 11.5T680-500q0 17 11.5 28.5T720-460Z',
    sync: 'M240-478q0 45 17 87.5t53 78.5l10 10v-58q0-17 11.5-28.5T360-400q17 0 28.5 11.5T400-360v160q0 17-11.5 28.5T360-160H200q-17 0-28.5-11.5T160-200q0-17 11.5-28.5T200-240h70l-16-14q-52-46-73-105t-21-119q0-94 48-170.5T337-766q14-8 29.5-1t20.5 23q5 15-.5 30T367-691q-58 32-92.5 88.5T240-478Zm480-4q0-45-17-87.5T650-648l-10-10v58q0 17-11.5 28.5T600-560q-17 0-28.5-11.5T560-600v-160q0-17 11.5-28.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720h-70l16 14q49 49 71.5 106.5T800-482q0 94-48 170.5T623-194q-14 8-29.5 1T573-216q-5-15 .5-30t19.5-23q58-32 92.5-88.5T720-482Z',
    cloud_done: 'm413-395-56-56q-12-12-28-12t-28 12q-12 12-12 28.5t12 28.5l85 86q12 12 28 12t28-12l169-169q12-12 12-29t-12-29q-12-12-29-12t-29 12L413-395ZM260-160q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 75-52.5 127.5T740-160H260Z',
    cloud_off: 'M260-160q-92 0-156-64T40-380q0-77 47.5-137T210-594q3-8 6-15.5t6-16.5L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-27.5 11.5T764-83l-78-77H260Zm604-50L322-751q35-24 74.5-36.5T480-800q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 39-15 72.5T864-210Z',
    swap_vert: 'M360-440q-17 0-28.5-11.5T320-480v-247l-75 75q-11 11-27.5 11T189-652q-12-12-12-28.5t12-28.5l143-143q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l144 144q12 12 11.5 28T531-652q-12 11-28 11.5T475-652l-75-75v247q0 17-11.5 28.5T360-440ZM600-97q-8 0-15-2.5t-13-8.5L428-252q-12-12-11.5-28t12.5-28q12-11 28-11.5t28 11.5l75 75v-247q0-17 11.5-28.5T600-520q17 0 28.5 11.5T640-480v247l75-75q11-11 27.5-11t28.5 11q12 12 12 28.5T771-251L628-108q-6 6-13 8.5T600-97Z',
    delete: 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z',
    chevron_left: 'm432-480 156 156q11 11 11 28t-11 28q-11 11-28 11t-28-11L348-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l184-184q11-11 28-11t28 11q11 11 11 28t-11 28L432-480Z',
    chevron_right: 'M504-480 348-636q-11-11-11-28t11-28q11-11 28-11t28 11l184 184q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L404-268q-11 11-28 11t-28-11q-11-11-11-28t11-28l156-156Z',
    expand_less: 'M480-529 324-373q-11 11-28 11t-28-11q-11-11-11-28t11-28l184-184q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l184 184q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-529Z',
    arrow_back_ios_new: 'm382-480 294 294q15 15 14.5 35T675-116q-15 15-35 15t-35-15L297-423q-12-12-18-27t-6-30q0-15 6-30t18-27l308-308q15-15 35.5-14.5T676-844q15 15 15 35t-15 35L382-480Z',
    percent: 'M300-520q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T360-660q0-25-17.5-42.5T300-720q-25 0-42.5 17.5T240-660q0 25 17.5 42.5T300-600Zm360 440q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T720-300q0-25-17.5-42.5T660-360q-25 0-42.5 17.5T600-300q0 25 17.5 42.5T660-240Zm-472 52q-11-11-11-28t11-28l528-528q11-11 28-11t28 11q11 11 11 28t-11 28L244-188q-11 11-28 11t-28-11Z',
    // (Remove discount: the rupee crossed out, its stroke cut out of the rupee by a white edge, as drawn)
    remove_discount: '<path d="M537-132 291-388q-5-5-8-12.5t-3-15.5v-24q0-17 11.5-28.5T320-480h100q53 0 91.5-34.5T558-600H280q-17 0-28.5-11.5T240-640q0-17 11.5-28.5T280-680h266q-17-35-50.5-57.5T420-760H280q-17 0-28.5-11.5T240-800q0-17 11.5-28.5T280-840h400q17 0 28.5 11.5T720-800q0 17-11.5 28.5T680-760h-90q14 17 25 37t17 43h48q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600h-41q-8 85-70 142.5T420-400h-29l204 212q18 19 7.5 43.5T566-120q-8 0-15.5-3t-13.5-9Z"/><path d="M150-830 L810-170" stroke="#ffffff" stroke-width="130" stroke-linecap="round" fill="none"/><path d="M150-830 L810-170" stroke="currentColor" stroke-width="70" stroke-linecap="round" fill="none"/>',
    calendar: 'M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.02 0 23.51 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.03 0 23.51 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Z',
    check_circle: 'm424-408-86-86q-11-11-28-11t-28 11q-11 11-11 28t11 28l114 114q12 12 28 12t28-12l226-226q11-11 11-28t-11-28q-11-11-28-11t-28 11L424-408Zm56 328q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z',
    close: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
    person: 'M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-240v-32q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v32q0 33-23.5 56.5T720-160H240q-33 0-56.5-23.5T160-240Z',
    // Counter Update 7 (Material Symbols Rounded, as in the design)
    group: 'M38-254q0-35 18-63.5t50-42.5q73-32 131.5-46T358-420q62 0 120 14t131 46q32 14 50.5 42.5T678-254v34q0 25-17.5 42.5T618-160H98q-25 0-42.5-17.5T38-220v-34Zm686 94q5-15 9.5-29.5T738-220v-34q0-63-29-101.5T622-420q69 8 130 22t99 34q33 19 52 47t19 63v34q0 25-17.5 42.5T862-160H724ZM358-481q-66 0-108-42t-42-108q0-66 42-108t108-42q66 0 108 42t42 108q0 66-42 108t-108 42Zm360-150q0 66-42 108t-108 42q-11 0-24.5-1.5T519-488q24-25 36.5-61.5T568-631q0-45-12.5-79.5T519-774q11-3 24.5-5t24.5-2q66 0 108 42t42 108Z',
    flag: 'M260-429v279q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-620q0-12.75 8.63-21.38Q217.25-800 230-800h289q10.5 0 18.75 6.5T548-776l14 62h208q12.75 0 21.38 8.62Q800-696.75 800-684v310q0 12.75-8.62 21.37Q782.75-344 770-344H568q-10.5 0-18.75-6T539-367l-14-62H260Z',
    note_alt: 'm560-200 200-200H600q-17 0-28.5 11.5T560-360v160Zm-360 80q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v367q0 16-6 30.5T817-337L623-143q-11 11-25.5 17t-30.5 6H200Zm120-280h120q17 0 28.5-11.5T480-440q0-17-11.5-28.5T440-480H320q-17 0-28.5 11.5T280-440q0 17 11.5 28.5T320-400Zm0-160h320q17 0 28.5-11.5T680-600q0-17-11.5-28.5T640-640H320q-17 0-28.5 11.5T280-600q0 17 11.5 28.5T320-560Z',
    edit_note: 'M200-400q-17 0-28.5-11.5T160-440q0-17 11.5-28.5T200-480h200q17 0 28.5 11.5T440-440q0 17-11.5 28.5T400-400H200Zm0-160q-17 0-28.5-11.5T160-600q0-17 11.5-28.5T200-640h360q17 0 28.5 11.5T600-600q0 17-11.5 28.5T560-560H200Zm0-160q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h360q17 0 28.5 11.5T600-760q0 17-11.5 28.5T560-720H200Zm320 520v-66q0-8 3-15.5t9-13.5l209-208q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-380L655-172q-6 6-13.5 9t-15.5 3h-66q-17 0-28.5-11.5T520-200Zm263-184 37-39-37-37-38 38 38 38ZM580-220h38l121-122-18-19-19-18-122 121v38Zm0 0v-38l122-121 37 37-121 122h-38Z',
    block: 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-60q61.01 0 117.51-20.5Q654-181 699-220L220-699q-38 46-59 102.17T140-480q0 142.37 98.81 241.19Q337.63-140 480-140Zm259-121q37-45 59-101.49 22-56.5 22-117.51 0-142.38-98.81-241.19T480-820q-60.66 0-116.83 21T261-739l478 478Z',
    sell: 'M856-390 570-104q-12 12-27 18t-30 6q-15 0-30-6t-27-18L103-457q-11-11-17-25.5T80-513v-287q0-33 23.5-56.5T160-880h287q16 0 31 6.5t26 17.5l352 353q12 12 17.5 27t5.5 30q0 15-5.5 29.5T856-390ZM260-640q25 0 42.5-17.5T320-700q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Z',
    room_service: 'M110-200q-13 0-21.5-8.5T80-230q0-13 8.5-21.5T110-260h740q13 0 21.5 8.5T880-230q0 13-8.5 21.5T850-200H110Zm0-120v-17q0-155 88.5-250T420-710v-30q0-26 17-43t43-17q26 0 43 17t17 43v30q133 28 221.5 123T850-337v17H110Z',
    move_table: 'm194-323 100 100q9 9 9 21.16t-8.61 21Q285-172 272.9-172q-12.1 0-20.9-9L101-332q-5-5-7-10.13-2-5.14-2-11Q92-359 94-364q2-5 7-10l151-151q9-9 21-9t21.39 9q8.61 9 8.61 21t-9 21L194-383h286q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H194Zm572-254H480q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h286L666-737q-9-9-9-21.16t8.61-21Q675-788 687.1-788q12.1 0 20.9 9l151 151q5 5 7 10.13 2 5.14 2 11 0 5.87-2 10.87-2 5-7 10L708-435q-9 9-21 9t-21.39-9q-8.61-9-8.61-21t9-21l100-100Z',
    merge: 'M480-344 277-141q-9 9-21 9t-21-9q-9-9-9-21t9-21l175-175q24-24 32-44t8-59v-265l-69 69q-9 9-21 9t-21-9q-9-9-9-21t9-21l120-120q9-9 21-9t21 9l120 120q9 9 9 21t-9 21q-9 9-21 9t-21-9l-69-69v265q0 39 8 59t32 44l175 175q9 9 9 21t-9 21q-9 9-21 9t-21-9L480-344Z',
    badge: 'M232-247h239v-14q0-18-9-32t-23-19q-32-11-50-14.5t-35-3.5q-19 0-40.5 4.5T265-312q-15 5-24 19t-9 32v14Zm361-67h120q10.83 0 17.92-7.12 7.08-7.11 7.08-18 0-10.88-7.08-17.88-7.09-7-17.92-7H593q-10.83 0-17.92 7.12-7.08 7.11-7.08 18 0 10.88 7.08 17.88 7.09 7 17.92 7Zm-239-50q22.5 0 38.25-15.75T408-418q0-22.5-15.75-38.25T354-472q-22.5 0-38.25 15.75T300-418q0 22.5 15.75 38.25T354-364Zm239-63h120q10.83 0 17.92-7.12 7.08-7.11 7.08-18 0-10.88-7.08-17.88-7.09-7-17.92-7H593q-10.83 0-17.92 7.12-7.08 7.11-7.08 18 0 10.88 7.08 17.88 7.09 7 17.92 7ZM140-80q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h250v-140q0-24 18-42t42.41-18h59.18Q534-880 552-862q18 18 18 42v140h250q24 0 42 18t18 42v480q0 24-18 42t-42 18H140Zm310-510h60v-230h-60v230Z',
    do_not_disturb_on: 'M310-453h340q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H310q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5ZM480.27-80q-82.74 0-155.5-31.5Q252-143 197.5-197.5t-86-127.34Q80-397.68 80-480.5t31.5-155.66Q143-709 197.5-763t127.34-85.5Q397.68-880 480.5-880t155.66 31.5Q709-817 763-763t85.5 127Q880-563 880-480.27q0 82.74-31.5 155.5Q817-252 763-197.68q-54 54.31-127 86Q563-80 480.27-80Z',
    void_x: '<path transform="matrix(40 0 0 40 0 -960)" d="M12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m2.59 6L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41z"/>',
  };
  const mi = (name, size) => {
    if (!MI[name] && window.RestroOrderTypeIcons?.has(name)) return window.RestroOrderTypeIcons.svg(name, `cx-i s${size}`);
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 -960 960 960'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', `cx-i s${size}`);
    s.innerHTML = MI[name].startsWith('<') ? MI[name] : `<path d="${MI[name]}"/>`; return s;
  };
  const typeIcon = { 'dine-in': 'dineIn', takeaway: 'takeaway', delivery: 'delivery', phone: 'phone' };
  // ₹2,270 for whole rupees, ₹113.50 otherwise
  const amount = paise => `₹${(paise / 100).toLocaleString('en-IN', paise % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // A context button: its icon, its name and, on Order type, the ▾ arrow. Colour: grey (not set), amber (order type),
  // violet (pager), white (an order type to pick, over the dimmed screen); Print bill is the light blue one.
  const ctxButton = (colour, icon, size, label, props = {}, arrow = false, extra = null) =>
    el('button', { type: 'button', class: `cx-b ${colour}`, ...props }, mi(icon, size), label ? el('span', { class: 'cx-b-label' }, label) : null, extra, arrow ? mi('expand_more', 18) : null);
  // A chip in the order header: grey, pink (a ready time), dark (Modify on); Hold the darker grey.
  const chip = (colour, icon, size, label, props = {}) =>
    el('button', { type: 'button', class: `cx-chip ${colour}`, ...props }, mi(icon, size), label ? el('span', { class: 'cx-b-label' }, label) : null);

  function orderPanel() {
    const t = totals(), c = order.customer, table = tableName(order.table);
    // Counter Update 3. The context row: Order type ▾ · Add Customer (Choose table / Table 7 for Dine in) · Pager · Print
    // bill (an icon); then the order header (Update 4): Order #1015 with "24 items" under it · Schedule · Modify · Hold,
    // the row ending under Print's right edge, Modify and Hold sharing what Schedule leaves. Hold any of them to
    // rearrange its group (below). Order type opens the four types, two by two, over both, over the dimmed screen.
    const typeBtn = ctxButton(order.type ? 'amber' : 'grey unset', order.type ? typeIcon[order.type] : 'receipt_long', 20, typeLabel[order.type] || 'Order type',
      { class: `cx-b ${order.type ? 'amber' : 'grey unset'} cx-type`, 'aria-haspopup': 'true', 'aria-expanded': String(typeMenu), 'aria-label': order.type ? `Order type ${typeLabel[order.type]}. Tap to change` : 'Choose the order type', onclick: () => openTypeMenu(true) }, true);
    const who = order.type === 'dine-in'
      ? ctxButton('grey', 'table', 19, table ? `Table ${table}` : 'Choose table', { class: `cx-b grey cx-who${table ? ' set' : ''}`, 'aria-label': table ? `Table ${table}${order.guests ? `, ${plural(order.guests, 'guest')}` : ''}. Tap to change the table` : 'Choose table', onclick: pickTable },
        false, table && order.guests ? el('span', { class: 'cx-gchip', 'aria-hidden': 'true' }, mi('group', 18), String(order.guests)) : null)
      : ctxButton('grey', c ? 'person' : 'person_add', 19, c ? c.name : 'Add Customer', { class: `cx-b grey cx-who${c ? ' set' : ''}`, 'aria-label': c ? `Customer ${c.name}. Tap to change the customer` : 'Add customer', onclick: pickCustomer });
    const pager = ctxButton(order.pager ? 'violet' : 'grey', 'vibration', 19, order.pager ? `Pager ${order.pager}` : 'Pager',
      { class: `cx-b ${order.pager ? 'violet' : 'grey'} sm cx-pager`, 'aria-label': order.pager ? `Pager ${order.pager}. Tap to change the pager` : 'Assign a pager', onclick: () => { sheet = 'pager'; render(); } });
    const print = printButton();
    // (Update Pack 4: plum with the time, "10:00 pm" or "Thu 1:00 pm"; it opens the picker)
    const schedule = chip(order.readyAt ? 'plum' : 'grey', 'schedule', 17, order.readyAt ? readyShort(order.readyAt) : 'Schedule',
      { class: `cx-chip ${order.readyAt ? 'plum' : 'grey'} cx-sched`, 'aria-label': order.readyAt ? `Ready by ${readyShort(order.readyAt)}. Tap to change` : 'Schedule', onclick: () => openSchedule() });
    const modify = chip(order.split ? 'dark' : 'grey', 'edit', 17, 'Modify', { class: `cx-chip ${order.split ? 'dark' : 'grey'} cx-modify`, role: 'switch', 'aria-checked': String(order.split), onclick: () => setSplit(!order.split) });
    const rec = savedOf(loadOrders()), kotGone = kotPrinted(rec);
    const holdBtn = chip('hold', 'pause_circle', 17, 'Hold', { class: `cx-chip hold cx-hold${kotGone ? ' off' : ''}`, 'aria-disabled': kotGone ? 'true' : null, onclick: holdTicket });
    const tiles = { type: typeBtn, customer: who, pager, print, schedule, modify, hold: holdBtn };
    const group = name => panelOrder[name].map(key => el('div', { class: 'cx-seg', 'data-tile': key }, tiles[key]));
    // The four types, two by two over the context row and the header (those step out of sight meanwhile)
    const pick = typeMenu ? el('div', { class: 'cx-pick' }, ...TYPES.map(key => el('div', { class: 'cx-seg lift' },
      ctxButton(order.type === key ? 'amber' : 'white', typeIcon[key], 20, typeLabel[key], { 'aria-pressed': String(order.type === key), onclick: () => pickType(key) })))) : null;
    const row = el('div', { class: 'cx-ctx', 'data-group': 'ctx' }, ...group('ctx'));

    // The order's number: a saved order's own, and on a new order the number it will have when it is saved (Save or Pay)
    const number = order.number || upcomingNumber();
    const head = el('div', { class: 'cx-oh' },
      el('div', { class: 'cx-ohl' },
        el('div', { class: 'cx-onum' },
          el('h2', { id: 'counter-title', tabindex: '-1' }, number ? `Order ${ticket(number)}` : 'New order'),
          el('small', { class: 'cx-count' }, t.count ? plural(t.count, 'item') : 'No items',
            // Update 7: a priority order says so after its count: ⚑ PRIORITY (red)
            order.priority ? el('span', { class: 'cx-prio' }, mi('flag', 12), 'PRIORITY') : null)),
        el('div', { class: 'cx-chips', 'data-group': 'head' }, ...group('head'))));

    // The order's lines, one under another with a hairline between: name · − quantity + (the number in blue: tap it for the
    // quantity pop-up) · "₹220 ea" (more than one) and the line total; under them its choices as a line of coloured text,
    // and its note. A custom item has a grey CUSTOM tag after its name (Update 5).
    // Tap a line to select it (light blue, a blue bar on its left): its choices become pills (tap one for the modifier
    // pop-up; a dish with choices but none made has a grey "Select modifier" pill instead) and "Add note / Edit note"
    // shows (the note pop-up). − / + and the number work straight away on any line.
    // With Modify on, the selected line also shows the order types to move it to.
    const list = el('ul', { class: 'cx-lines', 'aria-label': 'Items in this order' });
    if (!order.lines.length) list.append(el('li', { class: 'cx-empty' }, el('strong', {}, 'No items yet'), el('span', {}, 'Tap an item to add it.')));
    const lineRow = line => {
      const item = itemOf(line), key = keyOf(line), sel = selected === key, open = order.split && sel, each = eachOf(line);
      // (Update 7: a choice that sets the price, "Half", first and dark)
      const mods = (line.mods || []).map(m => {
        const o = optionOf.get(m), kind = `cx-mc ${o?.mode === 'set' ? 'por' : o?.kind === 'spice' ? 'sp' : 'nn'}`;
        return sel ? el('button', { type: 'button', class: kind, 'aria-label': `${modLabel(m)}. Tap to change the choices`, onclick: () => openMods(key) }, modLabel(m)) : el('span', { class: kind }, modLabel(m));
      });
      // Update 7: its dish discount, a green tag after its name ("10% off"), the price struck through before the new one
      // (₹0 green); a dish that sold out before its KOT went, a SOLD OUT tag in the same place
      const gross = each * line.qty * 100, net = gross - window.RestroBill.lineOff(gross, line.off);
      const out = !line.custom && soldOut(line.id) && line.qty > sentOf(line);
      const tag = out ? el('span', { class: 'cx-ltag out' }, 'SOLD OUT') : line.off ? el('span', { class: 'cx-ltag' }, `${line.off}% off`) : null;
      return el('li', { class: `cx-line${sel ? ' sel' : ''}${open ? ' open' : ''}`, 'data-line': key, onkeydown: e => { if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest?.('button')) { e.preventDefault(); removeLine(key); } } },
        el('div', { class: 'cx-row', onclick: e => { if (!e.target.closest?.('.cx-stp, .cx-mcs button, .cx-an, .cx-move')) selectLine(key); } },
          el('div', { class: 'cx-nm' }, el('button', { type: 'button', class: 'cx-nm-btn', 'aria-expanded': String(sel) }, item.name, line.custom ? el('span', { class: 'cx-ctag' }, 'CUSTOM') : null), tag),
          el('div', { class: 'cx-stp' },
            el('button', { type: 'button', class: 'cx-sb', 'aria-label': line.qty > 1 ? `One less ${item.name}` : `Remove ${item.name}`, onclick: () => setQty(key, line.qty - 1) }, mi('remove', 22)),
            el('button', { type: 'button', class: 'cx-qty', 'aria-label': `Quantity ${line.qty}. Tap to type a quantity`, onclick: () => openQty(key) }, String(line.qty)),
            el('button', { type: 'button', class: 'cx-sb', 'aria-label': `One more ${item.name}`, onclick: () => setQty(key, line.qty + 1) }, mi('add', 22))),
          el('div', { class: 'cx-lt' }, line.off ? el('s', {}, rupees(each * line.qty)) : line.qty > 1 ? el('small', {}, `${rupees(each)} ea`) : null,
            el('b', { class: line.off && !net ? 'zero' : null }, amount(net))),
          mods.length ? el('div', { class: 'cx-mcs' }, ...mods)
            // a dish with choices but none made (its pop-up closed with ×): on the selected line, a grey "Select
            // modifier" pill where its choices would be, opening its pop-up
            : sel && groupsOf(line.id).length ? el('div', { class: 'cx-mcs' }, el('button', { type: 'button', class: 'cx-mc pick', 'aria-label': `Select modifier for ${item.name}`, onclick: () => openMods(key) }, 'Select modifier')) : null,
          sel ? el('button', { type: 'button', class: 'cx-an', 'aria-label': `${line.note ? 'Edit the note' : 'Add a note'} for ${item.name}`, onclick: () => openNote(key) }, mi('edit', 14), el('span', {}, line.note ? 'Edit note' : 'Add note')) : null,
          line.note ? el('div', { class: 'cx-cmt' }, mi('receipt_long', 14), el('span', {}, line.note),
            // (Update 7: on the selected line, a round ✕ clears the note, with Undo)
            sel ? el('button', { type: 'button', class: 'cx-cclr', 'aria-label': `Clear the note for ${item.name}`, onclick: () => clearLineNote(key) }, mi('close', 16)) : null) : null,
          open ? el('div', { class: 'cx-move', role: 'radiogroup', 'aria-label': `Serve ${item.name} as` },
            ...TYPES.map(type => el('button', { type: 'button', role: 'radio', 'aria-checked': String(lineType(line) === type), class: lineType(line) === type ? 'on' : '', onclick: () => moveLine(key, type) }, mi(typeIcon[type], 18), typeLabel[type]))) : null));
    };
    // With Modify on, the lines go under their order types once more than one type is in use
    const inUse = TYPES.filter(type => order.lines.some(l => lineType(l) === type));
    if (order.split && inUse.length > 1) {
      for (const type of inUse) {
        const group = order.lines.filter(l => lineType(l) === type), count = group.reduce((n, l) => n + l.qty, 0);
        list.append(el('li', { class: 'cx-group' }, mi(typeIcon[type], 18), el('span', {}, typeLabel[type]), el('span', { class: 'cx-group-count' }, plural(count, 'item'))));
        group.forEach(line => list.append(lineRow(line)));
      }
    } else order.lines.forEach(line => list.append(lineRow(line)));

    // Totals (Update 7): one list, top to bottom in the order they are worked out: Subtotal · Discount 10% (green) ·
    // Service charge 5% (optional) · Packaging charge · Delivery charge · GST 5% (CGST 2.5% ₹x + SGST 2.5% ₹x) · Round
    // off (grey); each only when there is one (Subtotal and GST always). The total is on Pay. Save and Pay at the bottom,
    // the same size.
    const sum = (label, value, cls) => el('div', { class: `cx-tl${cls ? ` ${cls}` : ''}` }, el('span', {}, ...[label].flat()), el('b', {}, value));
    const sums = el('div', { class: 'cx-tot stack' },
      el('div', { class: 'cx-tstack' },
        sum('Subtotal', amount(t.subtotal)),
        t.discountPct ? sum(`Discount ${t.discountPct}%`, `−${amount(t.discount)}`, 'dsc') : null,
        t.servicePct ? sum([`Service charge ${t.servicePct}% `, el('i', {}, '(optional)')], amount(t.service), 'scx') : null,
        t.packaging ? sum('Packaging charge', amount(t.packaging)) : null,
        t.delivery ? sum('Delivery charge', amount(t.delivery)) : null,
        sum([`${GST.gst} `, el('i', { 'data-short': `(CGST ${amount(t.cgst)} + SGST ${amount(t.sgst)})` }, `(${GST.cgst} ${amount(t.cgst)} + ${GST.sgst} ${amount(t.sgst)})`)], amount(t.tax), 'gst'),
        t.roundOff ? sum('Round off', `${t.roundOff < 0 ? '−' : '+'}${amount(Math.abs(t.roundOff))}`, 'ro') : null),
      el('div', { class: 'cx-act' },
        el('button', { type: 'button', class: 'cx-save', disabled: !t.count, onclick: saveOrder }, mi('receipt_long', 26), 'Save'),
        el('button', { type: 'button', class: 'cx-pay', disabled: !t.count, 'aria-label': `Pay ${amount(t.total)}`, onclick: () => { if (askKot('pay')) return; cashInput = ''; sheet = 'pay'; render(); } }, `Pay\u00A0\u00A0${amount(t.total)}`)));

    // The order note (Update 7): a line of its own under the header. Empty: "✎ Add order note", grey, no box; with a note:
    // an amber strip with the note on one line (… when long) and a round ✕ that clears it (with Undo). A tap opens the
    // note pop-up (the strip has a blue edge meanwhile).
    const onote = order.note
      ? el('div', { class: `cx-onote${sheet === 'note' && notePop?.key === null ? ' active' : ''}` },
          el('button', { type: 'button', class: 'cx-onote-t', 'aria-label': `Order note: ${order.note}. Tap to change it`, onclick: () => openNote(null) }, mi('note_alt', 18), el('span', {}, order.note)),
          el('button', { type: 'button', class: 'cx-nclr', 'aria-label': 'Clear the order note', onclick: clearOrderNote }, mi('close', 18)))
      : el('button', { type: 'button', class: `cx-onote empty${sheet === 'note' && notePop?.key === null ? ' active' : ''}`, onclick: () => openNote(null) }, mi('edit_note', 20), el('span', {}, 'Add order note'));
    // (Update Pack 4) a scheduled order: when its KOT prints ("KOT prints at 9:30 pm", plum), or that it went ("✓ KOT sent to
    // the kitchen"); Instant KOT shows nothing until it has gone
    const kotl = !order.readyAt ? null : kotGone ? el('div', { class: 'cx-kotl sent' }, mi('check_circle', 15), el('span', {}, 'KOT sent to the kitchen'))
      : order.kotMode !== 'now' ? el('div', { class: 'cx-kotl' }, mi('schedule', 15), el('span', {}, `KOT prints ${kitchenWhen(kitchenTime(order))}`)) : null;
    return el('aside', { class: `cx-order${panelArranging ? ' arranging' : ''}${typeMenu ? ' picking' : ''}${kotl ? ' kotl' : ''}`, 'aria-label': 'Current order' }, pick, row, head, kotl, onote, list, sums);
  }
  // Tap a line: it is selected (another one was, it isn't any more); tapping the selected one again keeps it so.
  function selectLine(key) { if (selected === key) return; selected = key; render(); }

  // The menu side: the order menu (☰; Print bill is in the context row), search, then
  // Held · Orders · Payment history and the sync button (Update 5: these 52 tall, centred on the 62.4 menu button); under
  // them the menu itself (renderMenuBody).
  function menuSide() {
    // Search: what is typed (600, dark) filters the menu as it is typed; Update 7: a round ✕ at its right once something
    // is typed clears it and brings back the categories.
    const field = el('input', { id: 'counter-search', type: 'search', placeholder: 'Search menu items', autocomplete: 'off', enterkeyhint: 'search', value: query,
      oninput: e => { query = e.target.value; search.classList.toggle('typed', Boolean(query)); renderMenuBody(); },
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        const code = query.trim().toUpperCase(), byCode = [...items.values()].find(i => i.code === code), found = matches();
        const pick = byCode || (found.length === 1 ? found[0] : null);
        if (pick) { e.preventDefault(); query = ''; add(pick.id); if (sheet !== 'mods') dialog.querySelector('#counter-search')?.focus(); }
      } });
    const search = el('label', { class: `cx-sr${query ? ' typed' : ''}` }, mi('search', 20), el('span', { class: 'visually-hidden' }, 'Search menu items'), field,
      el('button', { type: 'button', class: 'cx-sclr', 'aria-label': 'Clear the search', onpointerdown: e => e.preventDefault(), onclick: e => { e.preventDefault(); query = ''; field.value = ''; search.classList.remove('typed'); renderMenuBody(); } }, mi('close', 20)));
    const top = el('div', { class: 'cx-tb' },
      el('button', { type: 'button', class: 'cx-mb', 'aria-label': 'Menu', title: 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': String(optionsMenu), onclick: () => openOptions(!optionsMenu) }, mi('menu', 22)),
      search,
      // Held opens the held orders in the Orders app; Orders opens the Orders app; Back there returns to Counter as it was.
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { sheet = 'held'; render(); } }, mi('pause_circle', 17), 'Held'),
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { if (window.RestroOrders) window.RestroOrders.open({ from: 'counter' }); else { sheet = 'orders'; render(); } } }, mi('receipt_long', 17), 'Orders'),
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { sheet = 'payments'; render(); } }, mi('history', 17), 'Payment history'),
      syncButton());
    return el('section', { class: 'cx-main', 'aria-label': 'Menu' }, top, optionsMenu ? orderMenu() : null, el('div', { class: 'cx-area' }));
  }
  // The order menu (Update 7): 400 wide, 14 below the button, over the dimmed screen; rows 60 tall in groups with a
  // hairline between. Rows that don't apply to the order type aren't there (takeaway, delivery and phone: no service
  // charge, no table rows). A switch row: its name opens the pop-up (to change what is on), the switch turns it on (the
  // pop-up) or off (at once, with Undo); when on, its tag: Discount "10%" and Dish discount "2 dishes" green, Service
  // charge "5%" blue. Priority on: Remove priority with a red PRIORITY tag.
  function orderMenu() {
    const dine = (order.type || DEFAULT_TYPE) === 'dine-in', sep = () => el('div', { class: 'cx-sep', role: 'separator' });
    const row = (icon, label, onclick, props = {}, tag = null) => el('button', { type: 'button', role: 'menuitem', class: 'cx-mi', onclick, ...props }, mi(icon, 26), el('span', { class: 'cx-mi-t' }, label), tag);
    const swRow = (icon, label, on, tag, tagCls, open, off, disabled = false) => el('div', { class: `cx-mi tg${disabled ? ' off' : ''}` },
      el('button', { type: 'button', role: 'menuitem', class: 'cx-mi-a', disabled, onclick: open }, mi(icon, 26), el('span', { class: 'cx-mi-t' }, label), on && tag ? el('em', { class: tagCls }, tag) : null),
      el('button', { type: 'button', role: 'switch', class: `cx-sw${on ? ' on' : ''}`, 'aria-checked': String(on), 'aria-label': label, disabled, onclick: on ? off : open }, el('i')));
    const dished = order.lines.filter(l => l.off).length;
    return el('div', { class: 'cx-pop', role: 'menu', 'aria-label': 'Order menu' },
      row('receipt_long', 'Reprint KOT', reprintKot),
      order.priority ? row('flag', 'Remove priority', togglePriority, {}, el('em', { class: 'cx-ptag' }, 'PRIORITY')) : row('flag', 'Mark as priority', togglePriority),
      sep(),
      swRow('percent', 'Discount', Boolean(order.discountPct), `${order.discountPct}%`, 'cx-dtag', openDiscount, () => switchOff('discount')),
      swRow('sell', 'Dish discount', dished > 0, `${dished} ${dished === 1 ? 'dish' : 'dishes'}`, 'cx-dtag', openDish, () => switchOff('dish'), !order.lines.length && !dished),
      dine ? swRow('room_service', 'Service charge', Boolean(order.servicePct), `${order.servicePct}%`, 'cx-stag', openService, () => switchOff('service')) : null,
      ...(dine ? [sep(), row('move_table', 'Move table', moveTable), row('merge', 'Merge tables', mergeTables), row('badge', 'Change server', openServer)] : []),
      sep(),
      row('history', 'Track history', openHistory),
      sep(),
      el('button', { type: 'button', role: 'menuitem', class: `cx-mi del${deleteArmed ? ' armed' : ''}`, disabled: !hasOrder(), onclick: tapDelete }, mi('delete', 26),
        el('span', { class: 'cx-mi-t' }, deleteArmed ? (order.number ? `Tap again to delete ${ticket(order.number)}` : 'Tap again to delete') : 'Delete order')));
  }

  // The sync button (Counter Update 5), last on the bar: a tap syncs with the main system or the cloud straight away
  // (RestroSync.syncNow). White with the sync arrows; light blue, turning, while it syncs; a green cloud with a tick for
  // 2 seconds once it is done; amber with the number of changes still to go up; grey with a crossed-out cloud while
  // there is nothing to sync with (orders are saved on this tablet meanwhile).
  let syncBusy = false, syncedUntil = 0, syncTimer = 0;
  function syncLook() {
    const st = window.RestroSync?.status?.();
    if (syncBusy || (st?.upstream === 'cloud' && st.cloud.state === 'syncing')) return { kind: 'syncing' };
    if (Date.now() < syncedUntil) return { kind: 'synced' };
    const reached = st?.upstream === 'hub' ? st.local.state === 'connected' : st?.upstream === 'cloud' ? st.cloud.state !== 'offline' : false;
    if (!reached) return { kind: 'offline' };
    return st.waiting > 0 ? { kind: 'pending', count: st.waiting } : { kind: 'normal' };
  }
  function syncButton() {
    const look = syncLook();
    const label = { normal: 'Sync now', syncing: 'Syncing', synced: 'Synced', pending: `Sync now: ${plural(look.count || 0, 'change')} waiting`, offline: 'Sync now: offline, orders are saved on this tablet' }[look.kind];
    return el('button', { type: 'button', class: `cx-sync ${look.kind}`, 'aria-label': label, title: label, onclick: syncNow },
      mi(look.kind === 'synced' ? 'cloud_done' : look.kind === 'offline' ? 'cloud_off' : 'sync', 20),
      look.kind === 'pending' ? el('span', { class: 'cx-sync-n', 'aria-hidden': 'true' }, look.count > 99 ? '99+' : String(look.count)) : null);
  }
  function paintSync() {
    const old = dialog.querySelector('.cx-sync'); if (!old) return;
    const focused = document.activeElement === old, next = syncButton();
    old.replaceWith(next); if (focused) next.focus({ preventScroll: true });
  }
  async function syncNow() {
    const sync = window.RestroSync; if (syncBusy || typeof sync?.syncNow !== 'function') return;
    syncBusy = true; syncedUntil = 0; paintSync();
    const started = Date.now();
    try { await sync.syncNow(); } catch {}
    await new Promise(done => setTimeout(done, Math.max(0, 700 - (Date.now() - started)))); // (turning long enough to be seen)
    syncBusy = false;
    if (syncLook().kind === 'normal') { syncedUntil = Date.now() + 2000; clearTimeout(syncTimer); syncTimer = setTimeout(paintSync, 2000); }
    paintSync();
  }
  window.addEventListener('restro:sync-status', () => { if (dialog.open) paintSync(); });

  const matches = () => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    return categoriesInOrder().flatMap(itemsInOrder).filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase() === q);
  };
  // How many of a dish the order has, all its lines together
  const inOrder = id => order.lines.reduce((n, l) => n + (l.id === id ? l.qty : 0), 0);
  // An item (Update 6): its veg / non-veg mark at the top left, its name under it (two lines at most, then "…") and its
  // price under the name. The whole tile adds one (its modifier pop-up first, if it has modifier groups); hold it to
  // rearrange. A dish on the order has a light blue badge at its top right with how many the order has (the tile itself
  // stays white): a tap on the badge opens the quantity pop-up of its line, or, with several lines (other choices), shows
  // them on the order.
  // Update 7: a dish whose price a choice sets shows both prices ("₹200 · ₹340"). A sold-out dish is grey (#F1F1F0, its
  // name and struck price #A8A29E, its mark faint) with "⊘ SOLD OUT" at its top right and no badge; a tap adds nothing
  // (a grey edge while pressed) and says "Fish fingers is sold out".
  const itemCard = item => {
    const n = inOrder(item.id), lines = n ? order.lines.filter(l => l.id === item.id).length : 0, out = soldOut(item.id), set = setGroupOf(item.id);
    const price = set ? set.options.map(o => rupees(Number(o.price) || 0)).join(' · ') : rupees(item.price);
    return el('div', { class: `cx-cell${out ? ' so' : ''}`, 'data-id': item.id },
      el('button', { type: 'button', class: `cx-card${out ? ' so' : ''}`, onclick: () => add(item.id),
        'aria-label': out ? `${item.name}, sold out` : `Add ${item.name}, ${price}${item.veg === false ? ', non-veg' : item.veg ? ', veg' : ''}${n ? `, ${n} on the order` : ''}` },
        item.veg == null ? null : el('em', { class: item.veg ? 'veg' : 'non', 'aria-hidden': 'true' }), el('b', {}, item.name), el('span', {}, price),
        out ? el('i', { class: 'cx-sot', 'aria-hidden': 'true' }, mi('block', 14), 'SOLD OUT') : null),
      n && !out ? el('button', { type: 'button', class: 'cx-qb', onclick: () => tapBadge(item.id),
        'aria-label': lines > 1 ? `${item.name}: ${n} on the order, on ${lines} lines. Tap to show them` : `${item.name}: ${n} on the order. Tap to type a quantity` }, el('span', {}, String(n))) : null);
  };
  // The badge: one line, its quantity pop-up; several, the order scrolls to them and they flash (no pop-up)
  function tapBadge(id) {
    const lines = order.lines.filter(l => l.id === id); if (!lines.length) return;
    if (lines.length === 1) { openQty(keyOf(lines[0])); return; }
    const keys = new Set(lines.map(keyOf)), rows = [...dialog.querySelectorAll('.cx-line')].filter(r => keys.has(r.dataset.line));
    rows[0]?.scrollIntoView({ block: 'nearest' });
    for (const r of rows) { r.classList.remove('just-added'); void r.offsetWidth; r.classList.add('just-added'); }
  }
  // A category's items start with "Add item" (Counter Update 5): a custom item for this order, in that category. The
  // same size as a dish card, a soft blue bloom, the round + and "Add item / Custom · Starters" in the middle. It stays
  // first, on the first page (it isn't one of the tiles that can be moved).
  const addTile = c => el('button', { type: 'button', class: 'cx-card cx-addt', onclick: () => openCustom(c.id), 'aria-label': `Add a custom item to ${c.name}` },
    el('i', { 'aria-hidden': 'true' }, mi('add', 24)), el('span', { class: 'cx-addt-t' }, el('b', {}, 'Add item'), el('small', {}, `Custom · ${c.name}`)));
  // A category in the Category grid: its food icon on a tint of its colour, its name (one line) and how many items it has
  const categoryTile = c => el('button', { type: 'button', class: 'cx-cat', 'data-id': c.id, style: `--cat:${c.color}`, onclick: () => { category = c.id; renderMenuBody(); } },
    el('span', { class: 'cx-ci' }, c.icon ? el('img', { src: c.icon, alt: '', draggable: 'false' }) : null),
    el('span', { class: 'cx-cat-copy' }, el('b', {}, c.name), el('span', {}, plural(c.items.length, 'item'))));
  const categoryPill = (c, on, rail) => el('button', { type: 'button', class: `cx-pl${on ? ' on' : ''}${rail ? ' rl' : ''}`, 'data-id': c.id, 'aria-pressed': String(on), onclick: () => { category = c.id; renderMenuBody(); } }, c.name);

  // ---------- pages (Counter Update 6) ----------
  // Every grid shows at most 4 rows a page (16 tiles, or 12 at 3 a row), Add item first on the first page; nothing
  // scrolls. The pages sit side by side: a sideways swipe (a clear drag, 48 or more, more sideways than up or down, so a
  // tap never turns a page) or the ‹ › under them moves one page. The page controls are at the bottom of the menu, in the
  // same place on every page (in the rail style, under the items): ‹ · the dots (the page on screen long and dark, as on
  // the home screen) · ›, the arrows light blue while they can be used, and "Page 1 of 2" under them; none at all when
  // everything fits on one page. Another category (or search) opens on its first page.
  const perPage = () => tilesPerRow * ROWS;
  const pageStart = (p, add) => (add ? (p ? p * perPage() - 1 : 0) : p * perPage());
  const pageCount = (n, add) => Math.max(1, Math.ceil((n + (add ? 1 : 0)) / perPage()));
  const pageOf = (list, p, add) => list.slice(pageStart(p, add), pageStart(p + 1, add));
  const uPx = () => (dialog.querySelector('.cx-order')?.offsetWidth || 532) / 532;
  const stillMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; // (pages then change without sliding)
  let pageView = { key: '', page: 0 };   // the page on screen, and the view it is a page of
  // ids: the tiles in order; tile: draws one; add: Add item (a category's items); arrange: what holding a tile rearranges
  function pagedGrid({ ids, tile, add = null, arrange = null, cat = null, page = 0, rail = false }) {
    const pages = pageCount(ids.length, Boolean(add)), p = Math.min(page, pages - 1);
    const track = el('div', { class: 'cx-track', style: `transform:translateX(${-p * 100}%)` },
      ...Array.from({ length: pages }, (_, i) => el('div', { class: 'cx-page', inert: i !== p, 'aria-hidden': i === p ? null : 'true' },
        el('div', { class: `cx-grid cols-${tilesPerRow}` }, i === 0 ? add : null, ...pageOf(ids, i, Boolean(add)).map(tile)))));
    return [el('div', { class: 'cx-pages', 'data-page': String(p), 'data-pages': String(pages), 'data-arrange': arrange, 'data-cat': cat }, track), pagerView(p, pages, rail)];
  }
  function pagerView(p, pages, rail) {
    if (pages < 2) return null;
    const arrow = (d, on) => el('button', { type: 'button', class: `cx-parr${on ? ' on' : ''}`, disabled: !on, 'aria-label': d < 0 ? 'Previous page' : 'Next page', onclick: () => turnPage(d) }, mi(d < 0 ? 'chevron_left' : 'chevron_right', 26));
    return el('nav', { class: `cx-pnav${rail ? ' rail' : ''}`, 'aria-label': 'Pages' },
      el('div', { class: 'cx-prow' }, arrow(-1, p > 0), el('div', { class: 'cx-pdots', 'aria-hidden': 'true' }, ...Array.from({ length: pages }, (_, i) => el('i', { class: i === p ? 'on' : null }))), arrow(1, p < pages - 1)),
      el('div', { class: 'cx-pinfo' }, `Page ${p + 1} of ${pages}`));
  }
  function turnPage(d) { const box = dialog.querySelector('.cx-pages'); if (box) showPage(box, Number(box.dataset.page) + d, true); }
  // A grid's page on screen: it slides there; the controls change at once
  function showPage(box, p, slide) {
    const pages = Number(box.dataset.pages) || 1, to = Math.max(0, Math.min(pages - 1, p)), track = box.querySelector(':scope > .cx-track');
    box.dataset.page = String(to); pageView.page = to;
    [...track.children].forEach((page, i) => { page.inert = i !== to; if (i === to) page.removeAttribute('aria-hidden'); else page.setAttribute('aria-hidden', 'true'); });
    track.style.transition = slide && !stillMotion() ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    track.style.transform = `translateX(${-to * 100}%)`;
    const old = dialog.querySelector('.cx-pnav'); if (old) old.replaceWith(pagerView(to, pages, old.classList.contains('rail')));
  }

  // ---------- the categories as pills (Update 6) ----------
  // Always two rows, so the grid under them never moves: in their order the pills fill the first row, then the second;
  // the rest go to the next view, and so on (never a pill cut off). A view moves one at a time (a swipe or its arrow): ›
  // on the right while more categories follow, ‹ on the left once some come before, each taking 60 of the rows' width.
  // The selected category stays dark, wherever its view is. Counter opens on the view with the selected category.
  let pillView = null;                  // the view on screen (null: the one with the selected category)
  let pillCtx = null;
  // A pill's width (in the design's pixels): its name, 16.5 bold, and 24 either side
  const pillWidth = name => {
    pillCtx ||= document.createElement('canvas').getContext('2d');
    pillCtx.font = '700 16.5px Inter, Roboto, "Segoe UI", Arial, sans-serif';
    return pillCtx.measureText(name).width + 48;
  };
  // The menu's width in the design's pixels: as it is on screen, or worked out from the screen's size (launcher.css --fu)
  function menuWidth() {
    const main = dialog.querySelector('.cx-main'), panel = dialog.querySelector('.cx-order');
    if (main?.clientWidth && panel?.offsetWidth) return main.clientWidth / (panel.offsetWidth / 532);
    const fu = Math.max(.5636, Math.min(innerWidth / 1920, innerHeight / 1000));
    return innerWidth / (1.2 * fu) - 572;
  }
  // The views: each two rows of categories, and whether it has ‹ and ›
  function pillViews(cats, width) {
    const fill = (from, room) => {
      const rows = [[], []]; let r = 0, used = 0, i = from;
      while (i < cats.length) {
        const w = Math.min(pillWidth(cats[i].name), room), need = w + (rows[r].length ? 10 : 0);
        if (rows[r].length && used + need > room) { if (r) break; r = 1; used = 0; continue; }
        rows[r].push(cats[i]); used += need; i++;
      }
      return { rows, next: i };
    };
    const all = fill(0, width);
    if (all.next >= cats.length) return [{ rows: all.rows, left: false, right: false }];
    const views = []; let from = 0;
    while (from < cats.length) {
      const left = views.length > 0, last = left ? fill(from, width - 60) : null;
      if (last && last.next >= cats.length) { views.push({ rows: last.rows, left, right: false }); break; }
      const v = fill(from, width - 60 - (left ? 60 : 0));
      if (v.next === from) break;
      views.push({ rows: v.rows, left, right: true }); from = v.next;
    }
    views[views.length - 1].right = false;
    return views;
  }
  // The pills in their views (drawn again in place when one is moved: the same pills, in their new places)
  function pillsInto(wrap, cats, current, pills = new Map(), focus = null) {
    const views = pillViews(cats, menuWidth()), at = id => views.findIndex(v => v.rows.flat().some(c => c.id === id));
    let v = focus ? at(focus) : pillView; if (v == null || v < 0 || v >= views.length) v = Math.max(0, at(current?.id));
    pillView = v;
    const pill = c => pills.get(c.id) || categoryPill(c, c === current);
    const track = el('div', { class: 'cx-ptrack', style: `transform:translateX(${-v * 100}%)` },
      ...views.map((x, i) => el('div', { class: `cx-pview${x.left ? ' l' : ''}${x.right ? ' r' : ''}`, inert: i !== v }, ...x.rows.map(row => el('div', { class: 'cx-prow2' }, ...row.map(pill))))));
    wrap.dataset.page = String(v); wrap.dataset.pages = String(views.length);
    wrap.replaceChildren(track,
      el('button', { type: 'button', class: 'cx-carr prev', hidden: !views[v].left, 'aria-label': 'Categories before', onclick: () => showView(wrap, pillView - 1, true) }, '‹'),
      el('button', { type: 'button', class: 'cx-carr next', hidden: !views[v].right, 'aria-label': 'More categories', onclick: () => showView(wrap, pillView + 1, true) }, '›'));
    wrap.views = views;
    return wrap;
  }
  function showView(wrap, v, slide) {
    const views = wrap.views || [], to = Math.max(0, Math.min(views.length - 1, v)), track = wrap.querySelector(':scope > .cx-ptrack'); if (!track) return;
    pillView = to; wrap.dataset.page = String(to);
    [...track.children].forEach((view, i) => { view.inert = i !== to; });
    track.style.transition = slide && !stillMotion() ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    track.style.transform = `translateX(${-to * 100}%)`;
    wrap.querySelector('.cx-carr.prev').hidden = !views[to].left; wrap.querySelector('.cx-carr.next').hidden = !views[to].right;
  }

  // ---------- the rail (Update 6) ----------
  // The categories down the left scroll. Where more are hidden, the rail fades out and a light blue "More" pill shows:
  // "⌃ More" at the top, "More ⌄" at the bottom; a tap scrolls one screen. The rail ends above the page controls.
  let railScroll = null;                // where the rail was scrolled (null: the selected category in sight)
  function railArea(cats, current) {
    const rail = el('div', { class: 'cx-rail', 'data-arrange': 'categories', onscroll: () => { railScroll = rail.scrollTop; paintRail(rail); } }, ...cats.map(c => categoryPill(c, c === current, true)));
    const step = d => rail.scrollBy({ top: d * rail.clientHeight, behavior: 'smooth' });
    return el('div', { class: 'cx-railwrap' }, rail,
      el('button', { type: 'button', class: 'cx-rarr up', hidden: true, 'aria-label': 'More categories above', onclick: () => step(-1) }, mi('expand_less', 26), el('span', {}, 'More')),
      el('button', { type: 'button', class: 'cx-rarr dn', hidden: true, 'aria-label': 'More categories below', onclick: () => step(1) }, el('span', {}, 'More'), mi('expand_more', 26)));
  }
  let railEdges = { up: false, down: menu.categories.length > 9 }; // (until the rail has been on screen: as it opens)
  function paintRail(rail) {
    const wrap = rail.parentElement; if (!rail.clientHeight) return;
    railEdges = { up: rail.scrollTop > 1, down: rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1 };
    wrap.classList.toggle('fu', railEdges.up); wrap.classList.toggle('fd', railEdges.down);
    wrap.querySelector('.cx-rarr.up').hidden = !railEdges.up; wrap.querySelector('.cx-rarr.dn').hidden = !railEdges.down;
  }

  // The menu in each display style (Settings > Counter > Menu display style), in pages. Search results show in the same
  // tiles, as pages of their own.
  // grid: "All categories" and the category tiles; a category: "‹ All categories", its colour bar, name and count, then
  //   its items.
  // pills (the default): the category pills in two rows, then the selected category's items.
  // rail: the category pills down the left, the items beside them.
  // live: the Counter itself (not a picture of it for Settings): the page, view and rail on screen are its own.
  const viewKey = style => `${style}|${query.trim() ? `q:${query.trim()}` : style === 'grid' ? category || '' : ((category && categoryById.has(category) ? category : categoriesInOrder()[0]?.id) || '')}|${tilesPerRow}`;
  function menuArea(style = menuStyle, live = true) {
    const key = viewKey(style);
    if (live && pageView.key !== key) pageView = { key, page: 0 };
    const page = live ? pageView.page : 0, q = query.trim();
    const dish = id => itemCard(items.get(id));
    if (q) {
      const found = matches();
      return [el('h3', { class: 'cx-h' }, found.length ? `${plural(found.length, 'result')} for “${q}”` : `No items match “${q}”`), ...pagedGrid({ ids: found.map(i => i.id), tile: dish, page })];
    }
    const list = categoriesInOrder();
    if (style === 'grid') {
      const c = category && categoryById.get(category);
      if (!c) return [el('h3', { class: 'cx-h' }, 'All categories'), ...pagedGrid({ ids: list.map(x => x.id), tile: id => categoryTile(categoryById.get(id)), arrange: 'categories', page })];
      return [el('div', { class: 'cx-crumb' },
        el('button', { type: 'button', class: 'cx-bk', onclick: () => { category = null; renderMenuBody(); } }, mi('chevron_left', 24), 'All categories'),
        el('i', { style: `background:${c.color}`, 'aria-hidden': 'true' }), el('b', {}, c.name), el('span', { class: 'cnt' }, plural(c.items.length, 'item'))),
        ...pagedGrid({ ids: itemsInOrder(c).map(i => i.id), tile: dish, add: addTile(c), arrange: 'items', cat: c.id, page })];
    }
    const c = (category && categoryById.get(category)) || list[0];
    const grid = pagedGrid({ ids: itemsInOrder(c).map(i => i.id), tile: dish, add: addTile(c), arrange: 'items', cat: c.id, page, rail: style === 'rail' });
    if (style === 'rail') return [el('div', { class: 'cx-split' }, railArea(list, c), grid[0]), grid[1]];
    const was = pillView; if (!live) pillView = null;
    try { return [pillsInto(el('div', { class: 'cx-pillwrap', 'data-arrange': 'categories' }), list, c), ...grid]; } finally { if (!live) pillView = was; }
  }
  function renderMenuBody() {
    saveDraft(); // every change to the order or to the menu view comes through here, so it is always kept
    if (drag) endDrag(true, false);
    const area = dialog.querySelector('.cx-area'); if (!area) return;
    area.replaceChildren(...menuArea().filter(Boolean));
    // The rail where it was scrolled (when Counter opens: its selected category in sight), its fades and More pills
    const rail = area.querySelector('.cx-rail');
    if (rail) {
      if (railScroll == null) { const on = rail.querySelector('.cx-pl.on'); rail.scrollTop = on ? Math.max(0, on.offsetTop + on.offsetHeight / 2 - rail.clientHeight / 2) : 0; railScroll = rail.scrollTop; }
      else rail.scrollTop = railScroll;
      paintRail(rail);
    }
  }

  // (the pills' views are worked out for the menu's width: a screen of another shape works them out again)
  let resizing = 0;
  addEventListener('resize', () => { if (!dialog.open) return; cancelAnimationFrame(resizing); resizing = requestAnimationFrame(() => { if (!drag) renderMenuBody(); }); });

  // ---------- swiping the pages ----------
  // A sideways drag on a grid (or on the pills) takes its pages along with the finger; let go past 48 (and more sideways
  // than up or down) and it moves on a page, otherwise it slides back. Not while the tiles are being rearranged.
  let pageSwipe = null, swipeTap = false;
  root.addEventListener('pointerdown', event => {
    swipeTap = false;
    const box = event.target.closest?.('.cx-pages, .cx-pillwrap');
    pageSwipe = box && event.button === 0 && !arranging && !drag && Number(box.dataset.pages) > 1 && !event.target.closest?.('.cx-carr')
      ? { box, id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, active: false } : null;
  });
  root.addEventListener('pointermove', event => {
    const s = pageSwipe; if (!s || event.pointerId !== s.id) return;
    if (drag) { pageSwipe = null; return; }
    const dx = event.clientX - s.x, dy = event.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { pageSwipe = null; return; }
      if (Math.abs(dx) <= 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      s.active = true; s.track = s.box.querySelector(':scope > .cx-track, :scope > .cx-ptrack'); s.page = Number(s.box.dataset.page) || 0; s.pages = Number(s.box.dataset.pages) || 1; s.w = s.track.offsetWidth;
      if (press) { clearTimeout(press.timer); press = null; } // (a swipe, not a hold)
      s.track.style.transition = 'none';
      try { s.box.setPointerCapture(s.id); } catch {}
    }
    event.preventDefault();
    s.dx = dx; s.dy = dy;
    const end = (s.page === 0 && dx > 0) || (s.page === s.pages - 1 && dx < 0); // (no page that way: it gives a little)
    s.track.style.transform = `translateX(${-s.page * s.w + (end ? dx / 3 : dx)}px)`;
  });
  function endPageSwipe(event, cancel) {
    const s = pageSwipe; if (!s || event.pointerId !== s.id) return; pageSwipe = null;
    if (!s.active) return;
    swipeTap = true;
    const far = !cancel && Math.abs(s.dx) >= 40 * uPx() && Math.abs(s.dx) > Math.abs(s.dy);
    const to = far ? s.page - Math.sign(s.dx) : s.page;
    if (s.box.classList.contains('cx-pillwrap')) showView(s.box, to, true); else showPage(s.box, to, true);
  }
  root.addEventListener('pointerup', event => endPageSwipe(event, false));
  root.addEventListener('pointercancel', event => endPageSwipe(event, true));
  // (the end of a swipe is not a tap on what it started on)
  root.addEventListener('click', event => {
    if (!swipeTap) return; swipeTap = false;
    if (event.target.closest?.('.cx-pages, .cx-pillwrap')) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  // ---------- rearranging the menu ----------
  // Hold a category (tile, pill or rail pill) or an item: they all jiggle and the one held follows the finger, the others
  // making room as it passes over them. Held at the left or right edge of a grid (or of the pills) for a moment, it goes
  // on to the page (or view) before or after it (Update 6); near the top or bottom of the rail, the rail scrolls. Let go
  // to keep the new order (kept on this device). A tap anywhere else, or Back, finishes; while they jiggle, a tap doesn't
  // add an item or open a category. Add item stays first; search results keep the menu's order.
  const MENU_TILE = '[data-arrange] [data-id]';
  let arranging = false, drag = null, press = null, suppressClick = false;
  function setArranging(on) {
    if (arranging === on) return;
    if (!on && drag) endDrag(true, false);
    arranging = on; dialog.querySelector('.cx-shell')?.classList.toggle('arranging', on);
  }
  // Where a tile is laid out (its jiggle and any slide in progress left out), so tiles passing by never change the
  // place under the finger
  const placeOf = tile => { const p = tile.parentElement, r = p.getBoundingClientRect(); return { left: r.left + tile.offsetLeft - p.scrollLeft, top: r.top + tile.offsetTop - p.scrollTop, width: tile.offsetWidth, height: tile.offsetHeight }; };
  // The tile that follows the finger: the tile itself as it is at rest (no shadow or frame of its own). (A menu tile's
  // floats over the whole Counter: its pages slide from under it.)
  function ghostOf(tile, r, host = tile.parentElement) {
    const ghost = tile.cloneNode(true);
    ghost.classList.add('cx-ghost'); ghost.removeAttribute('data-id'); ghost.removeAttribute('data-tile'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
    for (const node of ghost.querySelectorAll('button')) node.tabIndex = -1;
    Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
    host.append(ghost);
    return ghost;
  }
  const idsOf = list => (list.dataset.arrange === 'categories' ? categoriesInOrder().map(c => c.id) : itemsInOrder(categoryById.get(list.dataset.cat)).map(i => i.id));
  // The tiles on screen: the page (or view) showing, or the whole rail
  const shownTiles = list => [...list.querySelectorAll(list.classList.contains('cx-rail') ? '[data-id]' : ':scope > * > :not([inert]) [data-id]')];
  function startDrag(tile, pointerId, x, y) {
    const list = tile.closest('[data-arrange]'); if (!list || !tile.isConnected) return;
    setArranging(true);
    const r = placeOf(tile), ghost = ghostOf(tile, r, dialog.querySelector('.cx-shell')), ids = idsOf(list);
    tile.classList.add('cx-origin');
    drag = { list, tile, id: tile.dataset.id, pointerId, ghost, ox: x - (r.left + r.width / 2), oy: y - (r.top + r.height / 2), ids, start: [...ids], x, y, edge: null, scroll: 0 };
    try { list.setPointerCapture(pointerId); } catch {}
  }
  function moveDrag(x, y) {
    const d = drag; d.x = x; d.y = y;
    d.ghost.style.left = `${x - d.ox}px`; d.ghost.style.top = `${y - d.oy}px`;
    const over = shownTiles(d.list).find(t => { if (t === d.tile) return false; const p = placeOf(t); return x >= p.left && x <= p.left + p.width && y >= p.top && y <= p.top + p.height; });
    if (over) {
      const from = d.ids.indexOf(d.id), to = d.ids.indexOf(over.dataset.id);
      if (from >= 0 && to >= 0) { const ids = d.ids.filter(i => i !== d.id); ids.splice(ids.indexOf(over.dataset.id) + (from < to ? 1 : 0), 0, d.id); arrangeTo(d, ids); }
    }
    edgeWatch(d, x, y);
  }
  // The list in a new order: the tiles that change place slide there from where they were shown
  function arrangeTo(d, ids, page = null) {
    const tiles = [...d.list.querySelectorAll('[data-id]')], before = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
    tiles.forEach(t => t.getAnimations().forEach(a => { if (a.id === 'cx-slide') a.cancel(); }));
    d.ids = ids; layoutList(d, page);
    const far = d.list.clientWidth / 2;
    for (const t of tiles) {
      if (t === d.tile) continue;
      const a = before.get(t), b = t.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dx) > far) continue; // (not from one page to another)
      try { const run = t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' }); run.id = 'cx-slide'; } catch {}
    }
  }
  function layoutList(d, page) {
    const list = d.list, byId = new Map([...list.querySelectorAll('[data-id]')].map(t => [t.dataset.id, t]));
    const tiles = d.ids.map(id => byId.get(id)).filter(Boolean);
    if (list.classList.contains('cx-pages')) {
      const add = list.querySelector('.cx-addt');
      [...list.querySelectorAll(':scope > .cx-track > .cx-page > .cx-grid')].forEach((g, p) => g.replaceChildren(...(p === 0 && add ? [add] : []), ...pageOf(tiles, p, Boolean(add))));
      if (page != null) showPage(list, page, true);
    } else if (list.classList.contains('cx-pillwrap')) {
      const current = categoryById.get(list.querySelector('.cx-pl.on')?.dataset.id);
      pillsInto(list, d.ids.map(id => categoryById.get(id)), current, byId, d.id);
    } else list.replaceChildren(...tiles);
  }
  // At the edge of a grid or of the pills: after a moment, the page (or view) next to it, the tile on it; near the top or
  // bottom of the rail, the rail scrolls
  function edgeWatch(d, x, y) {
    const r = d.list.getBoundingClientRect(), zone = 40 * uPx();
    if (d.list.classList.contains('cx-rail')) {
      const dir = y < r.top + zone ? -1 : y > r.bottom - zone ? 1 : 0;
      if (dir !== d.scroll) { d.scroll = dir; if (dir) requestAnimationFrame(() => railStep(d)); }
      return;
    }
    const dir = Number(d.list.dataset.pages) > 1 ? (x < r.left + zone ? -1 : x > r.right - zone ? 1 : 0) : 0;
    if (dir === (d.edge?.dir || 0)) return;
    clearTimeout(d.edge?.timer); d.edge = dir ? { dir, timer: setTimeout(() => turnEdge(d, dir), 600) } : null;
  }
  function turnEdge(d, dir) {
    if (drag !== d) return;
    const list = d.list, at = Number(list.dataset.page) || 0, to = at + dir;
    if (to < 0 || to >= Number(list.dataset.pages)) { d.edge = null; return; }
    const ids = d.ids.filter(i => i !== d.id);
    if (list.classList.contains('cx-pages')) {
      // the first place on the next page, or the last on the one before
      const add = Boolean(list.querySelector('.cx-addt'));
      ids.splice(dir > 0 ? pageStart(to, add) : pageStart(at, add) - 1, 0, d.id);
      arrangeTo(d, ids, to);
    } else {
      // the pills: into the next view, as near its start as it fits (or the one before, as near its end)
      const width = menuWidth(), target = cats(list.views[to]).map(c => c.id);
      const viewOf = order => pillViews(order.map(id => categoryById.get(id)), width).findIndex(v => cats(v).some(c => c.id === d.id));
      for (let k = 0; k <= target.length; k++) {
        const next = [...ids], at2 = dir > 0 ? ids.indexOf(target[0]) + k : ids.indexOf(target[target.length - 1]) + 1 - k;
        next.splice(Math.max(0, Math.min(ids.length, at2)), 0, d.id);
        if (viewOf(next) === to) { arrangeTo(d, next); break; }
      }
    }
    d.edge = { dir, timer: setTimeout(() => turnEdge(d, dir), 700) }; // (still there: on to the next one after a moment)
  }
  const cats = view => view.rows.flat();
  function railStep(d) {
    if (drag !== d || !d.scroll) return;
    const was = d.list.scrollTop; d.list.scrollTop += d.scroll * 8 * uPx();
    if (d.list.scrollTop !== was) moveDrag(d.x, d.y);
    requestAnimationFrame(() => railStep(d));
  }
  // Let go: the order shown is kept. Cancelled: the tiles go back to how they were.
  function endDrag(cancel, rerender = true) {
    const d = drag; if (!d) return; drag = null;
    clearTimeout(d.edge?.timer); d.scroll = 0;
    d.ghost.remove(); d.tile.classList.remove('cx-origin');
    if (!cancel && d.ids.join('|') !== d.start.join('|')) saveMenuOrder(d.list.dataset.arrange === 'categories' ? { kind: 'categories' } : { kind: 'items', catId: d.list.dataset.cat }, d.ids);
    if (rerender) renderMenuBody();
  }
  root.addEventListener('pointerdown', event => {
    const tile = event.target.closest?.(MENU_TILE);
    // A tap anywhere else finishes rearranging (and on Add item, does only that)
    if (arranging && !drag && !tile) { setArranging(false); if (event.target.closest?.('[data-arrange]') && !event.target.closest?.('.cx-carr')) suppressClick = true; }
    if (!tile || event.button !== 0 || drag) return;
    suppressClick = false;
    clearTimeout(press?.timer);
    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, tile };
    p.timer = setTimeout(() => { if (press === p) { press = null; startDrag(p.tile, p.id, p.x, p.y); } }, arranging ? 120 : 420);
    press = p;
  });
  root.addEventListener('pointermove', event => {
    if (drag) { if (event.pointerId === drag.pointerId) { event.preventDefault(); moveDrag(event.clientX, event.clientY); } return; }
    if (press && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
  });
  root.addEventListener('pointerup', event => {
    if (press && event.pointerId === press.id) { clearTimeout(press.timer); press = null; }
    if (drag && event.pointerId === drag.pointerId) { suppressClick = true; endDrag(false); }
  });
  root.addEventListener('pointercancel', event => {
    if (press && event.pointerId === press.id) { clearTimeout(press.timer); press = null; }
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
  });
  // (the finger moving a tile doesn't scroll the menu)
  root.addEventListener('touchmove', event => { if (drag) event.preventDefault(); }, { passive: false });
  root.addEventListener('click', event => {
    if (!event.target.closest?.('[data-arrange]') || event.target.closest?.('.cx-carr')) return;
    if (suppressClick || arranging) { event.preventDefault(); event.stopPropagation(); }
    suppressClick = false;
  }, true);
  root.addEventListener('contextmenu', event => { if (event.target.closest?.('[data-arrange]')) event.preventDefault(); });

  // ---------- rearranging the order panel ----------
  // Hold any of the buttons at the top (Order type, Add Customer, Pager, Print bill in the context row; Schedule, Modify,
  // Hold in the header), as with the menu: they all jiggle and the one held follows the finger, the others in its group
  // making room for it as it passes over their places (each group keeps its own buttons). Let go over its group to keep
  // the new order (kept on this tablet); let go away from it to put them back. A tap anywhere else, or Back, finishes;
  // while they jiggle, tapping one does nothing. (Not while the order types are open.)
  const TILE = '[data-group] > [data-tile]';
  const panelTiles = name => [...dialog.querySelectorAll(`[data-group="${name}"] > [data-tile]`)];
  function setPanelArranging(on) {
    if (panelArranging === on) return;
    if (!on && panelDrag) endPanelDrag(true);
    panelArranging = on; dialog.querySelector('.cx-order')?.classList.toggle('arranging', on);
  }
  // A group's buttons in the given order
  function placePanel(name, keys, slide) {
    const box = dialog.querySelector(`[data-group="${name}"]`), tiles = new Map(panelTiles(name).map(t => [t.dataset.tile, t]));
    if (!box || tiles.size !== PANEL_GROUPS[name].tiles.length) return;
    const before = slide ? new Map([...tiles].map(([k, t]) => [k, t.getBoundingClientRect()])) : null;
    const ghost = box.querySelector(':scope > .cx-ghost');
    keys.forEach(k => box.insertBefore(tiles.get(k), ghost));
    if (!slide) return;
    // The buttons that change place slide from where they were shown to their new place
    for (const [k, t] of tiles) {
      if (k === panelDrag?.key) continue;
      t.getAnimations().forEach(a => { if (a.id === 'cx-slide') a.cancel(); });
      const a = before.get(k), b = t.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      try { const run = t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' }); run.id = 'cx-slide'; } catch {}
    }
  }
  function startPanelDrag(name, key, pointerId, x, y) {
    const tile = dialog.querySelector(`[data-group="${name}"] > [data-tile="${key}"]`); if (!tile || typeMenu) return;
    // The group's places (as laid out, their jiggle left out), measured once: the buttons move between them, the places stay
    const tiles = panelOrder[name].map(k => dialog.querySelector(`[data-group="${name}"] > [data-tile="${k}"]`));
    if (tiles.some(t => !t)) return;
    const slots = tiles.map(t => { const p = placeOf(t); return { ...p, right: p.left + p.width, bottom: p.top + p.height }; });
    const r = slots[panelOrder[name].indexOf(key)];
    setPanelArranging(true);
    const ghost = ghostOf(tile, r); tile.classList.add('cx-origin');
    panelDrag = { name, key, tile, pointerId, ghost, slots, order: [...panelOrder[name]], ox: x - (r.left + r.width / 2), oy: y - (r.top + r.height / 2) };
    try { tile.closest('.cx-order').setPointerCapture(pointerId); } catch {}
  }
  function movePanelDrag(x, y) {
    const d = panelDrag; d.ghost.style.left = `${x - d.ox}px`; d.ghost.style.top = `${y - d.oy}px`;
    const i = d.slots.findIndex(s => x >= s.left && x <= s.right && y >= s.top && y <= s.bottom);
    if (i < 0 || d.order[i] === d.key) return;
    const next = d.order.filter(k => k !== d.key); next.splice(i, 0, d.key);
    d.order = next; placePanel(d.name, next, true);
  }
  // Let go: over its group, the order shown is kept; away from it (or cancelled), they go back as they were.
  function endPanelDrag(cancel) {
    const d = panelDrag; if (!d) return; panelDrag = null;
    d.ghost.remove(); d.tile.classList.remove('cx-origin');
    if (!cancel && d.order.join() !== panelOrder[d.name].join()) { panelOrder[d.name] = d.order; store(PANEL_GROUPS[d.name].key, d.order); }
    placePanel(d.name, panelOrder[d.name], false);
  }
  root.addEventListener('pointerdown', event => {
    const tile = event.target.closest?.(TILE);
    if (panelArranging && !panelDrag && !tile) setPanelArranging(false); // a tap anywhere else finishes rearranging
    if (!tile || event.button !== 0 || panelDrag || drag || typeMenu) return;
    panelSuppress = false;
    clearTimeout(panelPress?.timer);
    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, name: tile.parentElement.dataset.group, key: tile.dataset.tile };
    p.timer = setTimeout(() => { if (panelPress === p) { panelPress = null; startPanelDrag(p.name, p.key, p.id, p.x, p.y); } }, panelArranging ? 120 : 420);
    panelPress = p;
  });
  root.addEventListener('pointermove', event => {
    if (panelDrag) { if (event.pointerId === panelDrag.pointerId) { event.preventDefault(); movePanelDrag(event.clientX, event.clientY); } return; }
    if (panelPress && event.pointerId === panelPress.id && Math.hypot(event.clientX - panelPress.x, event.clientY - panelPress.y) > 8) { clearTimeout(panelPress.timer); panelPress = null; }
  });
  root.addEventListener('pointerup', event => {
    if (panelPress && event.pointerId === panelPress.id) { clearTimeout(panelPress.timer); panelPress = null; }
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    panelSuppress = true;
    const s = panelDrag.slots, over = event.clientX >= Math.min(...s.map(r => r.left)) && event.clientX <= Math.max(...s.map(r => r.right)) && event.clientY >= Math.min(...s.map(r => r.top)) && event.clientY <= Math.max(...s.map(r => r.bottom));
    endPanelDrag(!over);
  });
  root.addEventListener('pointercancel', event => {
    if (panelPress && event.pointerId === panelPress.id) { clearTimeout(panelPress.timer); panelPress = null; }
    if (panelDrag && event.pointerId === panelDrag.pointerId) endPanelDrag(true);
  });
  root.addEventListener('touchmove', event => { if (panelDrag) event.preventDefault(); }, { passive: false });
  // No button's action after a drag, or while they jiggle
  root.addEventListener('click', event => {
    if (!event.target.closest?.(TILE)) return;
    if (panelSuppress || panelArranging) { event.preventDefault(); event.stopPropagation(); }
    panelSuppress = false;
  }, true);
  root.addEventListener('contextmenu', event => { if (event.target.closest?.(TILE)) event.preventDefault(); });

  // ---------- the pop-ups: modifiers, quantity, note (Counter Update 4), a custom item (Update 5), discount (Update 6) ----------
  // They open over the menu only: the order beside them is not covered or dimmed, so what they change shows on it at
  // once. A tap on the dimmed menu, or on the order, is a tap outside: the modifier pop-up closes keeping its choices
  // (not while a required group has none, nor while its note is typed in it), the quantity and discount pop-ups close
  // leaving the order as it was, and the note and custom item pop-ups stay open. Each has a ✕ at its top right (Update
  // 5), which always closes it with no changes: the modifier pop-up puts its line back as it was when it opened, the
  // quantity, the note and the discount stay as they were, and no custom item is added.
  const lineOf = key => order.lines.find(l => keyOf(l) === key);
  const modLine = () => (modPop ? lineOf(modPop.key) : null);
  const missingOf = line => groupsOf(line.id).filter(g => g.required && !line.mods.some(m => optionOf.get(m)?.group === g.id));

  // Modifiers: a pill on the selected line (or a dish with choices just added). While it is open the line is a line of
  // its own, selected. (It keeps how the line was, for ✕.)
  function openMods(key) {
    const line = lineOf(key); if (!line) return;
    line.edit = true; selected = keyOf(line);
    modPop = { key: selected, added: false, tried: false, was: { mods: [...line.mods], qty: line.qty, note: line.note || '' } }; qtyPop = null; notePop = null; sheet = 'mods'; render();
  }
  // A choice: a "pick 1" group (a required one, spice level) has one, so tapping another moves it there; an optional
  // group takes any number, a second tap takes one off. The order shows it at once (pills, "₹250 ea", the totals, Pay).
  function pickOption(g, o) {
    const line = modLine(); if (!line) return;
    const on = line.mods.includes(o.id);
    let mods;
    if (g.required || g.single) mods = on ? (g.required ? line.mods : line.mods.filter(m => m !== o.id)) : [...line.mods.filter(m => optionOf.get(m)?.group !== g.id), o.id];
    else mods = on ? line.mods.filter(m => m !== o.id) : [...line.mods, o.id];
    line.mods = cleanMods(line.id, mods);
    modPop.key = selected = keyOf(line); render();
  }
  // Its quantity, at once too; − at 1 takes the dish off (with Undo), as on the order, and the pop-up goes with it.
  function stepMods(d) {
    const line = modLine(); if (!line) return;
    // (below what the kitchen has, Update 7: the pop-up closes and the void pop-up asks why)
    if (d < 0 && line.qty + d < sentOf(line)) { const to = line.qty + d; if (closeMods() === false) return; const k = order.lines.includes(line) ? keyOf(line) : null; if (k) openVoid(k, Math.max(0, to)); return; }
    if (line.qty + d < 1) { removeLine(modPop.key); return; }
    line.qty = Math.min(999, line.qty + d); render();
  }
  // Done, a tap outside or Back: closes keeping the choices, unless a required group still has none: then it stays open
  // and that group is red until a choice is made. The line then joins a line with the same choices, if there is one; a
  // dish just added is not selected any more.
  function closeMods() {
    const line = modLine();
    if (line && missingOf(line).length) { modPop.tried = true; render(); return false; }
    const added = Boolean(modPop?.added);
    const key = line ? settle(line) : null;
    sheet = null; modPop = null;
    selected = !added && key && lineOf(key) ? key : null;
    render(); return true;
  }
  // ✕: the pop-up closes and nothing changed in it is kept: the line is as it was when the pop-up opened (its choices,
  // quantity and note). A dish that came on with its pop-up stays on the order as it came on (nothing chosen yet).
  function cancelMods() {
    const p = modPop; if (!p) return;
    const line = modLine();
    sheet = null; modPop = null; notePop = null;
    if (line && p.was) { line.mods = [...p.was.mods]; line.qty = p.was.qty; line.note = p.was.note; }
    const key = line ? settle(line) : null;
    selected = !p.added && key && lineOf(key) ? key : null;
    render();
  }
  // A line out of its pop-up: it joins a line of the same dish, type and choices, if there is one (the quantities add
  // up; a different note is added to that line's); nothing else on the order changes.
  function settle(line) {
    delete line.edit;
    const key = keyOf(line), same = order.lines.find(l => l !== line && !l.edit && keyOf(l) === key);
    if (!same) return key;
    same.qty += line.qty;
    if (line.note && line.note !== same.note) same.note = cleanNote(same.note ? `${same.note} · ${line.note}` : line.note);
    order.lines.splice(order.lines.indexOf(line), 1);
    return key;
  }

  // Quantity: the blue number on any line. The order changes only on Done (0 takes the dish off, with Undo); a tap
  // outside or ✕ leaves the quantity as it was.
  function openQty(key) { if (!lineOf(key)) return; qtyPop = { key, value: '' }; modPop = null; notePop = null; sheet = 'qty'; render(); }
  function pressQty(k) {
    if (!qtyPop) return;
    const v = qtyPop.value;
    qtyPop.value = k === 'clear' ? '' : k === 'back' ? v.slice(0, -1) : v === '0' ? k : (v + k).slice(0, 3);
    render();
  }
  function doneQty() {
    const p = qtyPop; if (!p) return;
    sheet = null; qtyPop = null;
    const n = parseInt(p.value, 10), line = lineOf(p.key);
    if (line && Number.isFinite(n) && n !== line.qty) setQty(p.key, n); else render();
  }
  function cancelQty() { sheet = null; qtyPop = null; render(); }

  // Note: "Add note / Edit note" on the selected line, or the note line in the modifier pop-up (Done goes back there).
  // The keyboard comes up only when the note line is tapped; quick notes are added without it. Saved on Done; ✕ leaves
  // the note as it was.
  // (Update 7: key null is the order note: the line under the order header opens it)
  function openNote(key, back = false) {
    if (key === null) { closeMenu(); notePop = { key: null, draft: order.note || '', back: false, typing: false }; qtyPop = null; modPop = null; selected = null; sheet = 'note'; render(); return; }
    const line = lineOf(key); if (!line) return;
    notePop = { key, draft: line.note || '', back, typing: false }; qtyPop = null; sheet = 'note'; render();
  }
  function doneNote() {
    const p = notePop; if (!p) return;
    notePop = null; sheet = p.back && modPop ? 'mods' : null;
    if (p.key === null) { order.note = cleanNote(p.draft); render(); return; }
    setNote(p.key, p.draft);
  }
  // A note cleared in one tap (Update 7): the order note's ✕, a selected line's ✕; Undo brings it back
  function clearOrderNote() {
    const was = order.note, target = order; if (!was) return;
    order.note = ''; render();
    say({ b: 'Order note', t: ' cleared', undo: () => { if (order === target) { order.note = was; render(); } } });
  }
  function clearLineNote(key) {
    const line = lineOf(key); if (!line?.note) return;
    const was = line.note; line.note = ''; render();
    say({ b: 'Note', t: ` cleared · ${itemOf(line).name}`, undo: () => { if (order.lines.includes(line)) { line.note = was; render(); } } });
  }
  function cancelNote() {
    const p = notePop; if (!p) return;
    notePop = null; sheet = p.back && modPop ? 'mods' : null; render();
  }
  // A quick note goes on the end of the note (after a comma), or comes out again when it is already there. (A quick note
  // with a comma in it, "No onion, no garlic", counts as one.)
  const noteParts = note => note.split(',').map(s => s.trim()).filter(Boolean);
  const runOf = (parts, chip) => {
    const c = noteParts(chip).map(x => x.toLowerCase());
    for (let i = 0; c.length && i + c.length <= parts.length; i++) if (c.every((x, j) => parts[i + j].toLowerCase() === x)) return [i, c.length];
    return null;
  };
  const hasQuick = (note, chip) => Boolean(runOf(noteParts(note), chip));
  const toggleQuick = (note, chip) => { const parts = noteParts(note), at = runOf(parts, chip); if (at) parts.splice(at[0], at[1]); else parts.push(...noteParts(chip)); return parts.join(', '); };
  // The quick notes for a dish: the notes this restaurant uses most for it, worked out by the backend from the notes
  // saved on its orders and published as a list per dish; the tablet only shows them, kept on the device so they work
  // offline (restro.quickNotes.v1: { lists: { <item id>: [...] }, defaults: [...] }, each note its words, or
  // { text, pinned, addedAt }). In order (Update 5): the pinned ones (an owner pins them in Inventory; a pin before the
  // words), then new ones in their first 15 days (a blue NEW; the newest first), then the rest as published. Until lists
  // come, every dish has the starting set. "+ Add", first in the row, keeps what is typed in the note that isn't a quick
  // note of the dish yet as new quick notes of it, on this tablet until the backend takes them
  // (restro.quickNotes.added.v1: { <item id>: [{ text, at }] }).
  const QUICK_KEY = 'restro.quickNotes.v1', QUICK_ADDED_KEY = 'restro.quickNotes.added.v1', QUICK_NEW_MS = 15 * 864e5;
  const QUICK_START = ['Less spicy', 'Extra spicy', 'Less oil', 'Less salt', 'No onion', 'No garlic', 'Pack separately', 'Serve first',
    'Extra gravy', 'Allergy: nuts', 'Jain', 'Kids portion', 'Well done', 'No ice', 'Less sugar'];
  // (Update 7: the order note's quick notes, for the whole order, from the same engine: the list "@order", or orderDefaults.
  // The void pop-ups' reasons come with them too, as "@void" and "@cancel", and a dish made free's as "@free": the top 9,
  // with no starting set; see voids.)
  const ORDER_QUICK = '@order';
  const ORDER_QUICK_START = ['Birthday celebration', 'Serve all together', 'Starters first', 'Kids at the table', 'Anniversary', 'Bring extra plates', 'Senior citizens',
    'Jain food', 'Allergy: nuts', 'Pack leftovers', 'No onion, no garlic', 'Serve slowly', 'Business meeting', 'Extra spoons', 'High chair needed'];
  const quickText = t => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
  function quickNotesFor(id) {
    const whole = id === ORDER_QUICK, kept = load(QUICK_KEY, null), source = kept && typeof kept === 'object' ? (kept.lists?.[id] ?? (whole ? kept.orderDefaults : kept.defaults)) : null;
    const published = (Array.isArray(source) ? source : []).map(x => (typeof x === 'string' ? { text: quickText(x), at: 0 }
      : x && typeof x === 'object' ? { text: quickText(x.text), pinned: x.pinned === true, at: Number(x.addedAt) || 0 } : null)).filter(x => x?.text);
    const base = published.length ? published : (whole ? ORDER_QUICK_START : QUICK_START).map(text => ({ text, at: 0 }));
    const kept2 = load(QUICK_ADDED_KEY, null), mine = (kept2 && typeof kept2 === 'object' && Array.isArray(kept2[id]) ? kept2[id] : [])
      .map(x => ({ text: quickText(x?.text), at: Number(x?.at) || 0 })).filter(x => x.text);
    const now = Date.now(), fresh = x => x.at > 0 && x.at <= now + 60000 && now - x.at < QUICK_NEW_MS;
    const out = [], seen = new Set();
    const put = (x, isNew = false) => { const k = x.text.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push({ text: x.text, pinned: x.pinned === true, isNew }); };
    base.filter(x => x.pinned).forEach(x => put(x));
    [...base, ...mine].filter(x => !x.pinned && fresh(x)).sort((a, b) => b.at - a.at).forEach(x => put(x, true));
    base.forEach(x => put(x)); mine.forEach(x => put(x));
    return out;
  }
  // What "+ Add" would keep: the parts of the note that aren't a quick note of the dish yet
  function newQuick(id, note) {
    const known = new Set(quickNotesFor(id).map(x => x.text.toLowerCase())), out = new Map();
    for (const part of noteParts(note)) if (!known.has(part.toLowerCase())) out.set(part.toLowerCase(), part);
    return [...out.values()];
  }
  function keepQuick(id, parts) {
    const kept = load(QUICK_ADDED_KEY, null), all = kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}, now = Date.now();
    all[id] = [...parts.map(t => ({ text: quickText(t.charAt(0).toUpperCase() + t.slice(1)), at: now })), ...(Array.isArray(all[id]) ? all[id] : [])].slice(0, 30);
    try { localStorage.setItem(QUICK_ADDED_KEY, JSON.stringify(all)); } catch {}
  }

  // A custom item (Update 5): "Add item", first in each category's items. The pop-up opens with the whole form and
  // nothing being typed: Item name (optional) · Veg / Non-veg (optional) · Price each (needed) · Note (optional) ·
  // − 1 +. Tap the name or the note: the tablet's keyboard comes up (the pop-up moves up above it) and the button at the
  // bottom reads Set item name / Set note; tap the price: our number pad opens in the pop-up and the button reads Set
  // price. Set goes back to the whole form, and the button is Done again: Done adds the item to the order (with no price
  // yet, it opens the price pad: the price is the one thing needed). A tap outside does nothing; ✕ adds nothing.
  let customPop = null; // { cat, name, veg (true / false / null), price (digits), qty, note, field: null | 'name' | 'price' | 'note' }
  function openCustom(catId) {
    if (!categoryById.has(catId)) return;
    customPop = { cat: catId, name: '', veg: null, price: '', qty: 1, note: '', field: null };
    modPop = null; qtyPop = null; notePop = null; selected = null; sheet = 'custom'; render();
  }
  const customInput = field => (field === 'name' || field === 'note' ? dialog.querySelector(`#counter-custom-${field}`) : null);
  const paintOrRender = () => (paintCustom ? paintCustom() : render());
  // Tap a field: it takes the typing (the one typed in before is set, as with its Set button)
  function customField(field) {
    const p = customPop; if (!p || p.field === field) return;
    const was = p.field; p.field = field;
    tidyCustom(p, was); customInput(was)?.blur();
    const input = customInput(field);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    paintOrRender();
  }
  // Set item name / Set price / Set note (Enter, or the keyboard put away, too): back to the whole form
  function customSet() {
    const p = customPop; if (!p || !p.field) return;
    const was = p.field; p.field = null;
    tidyCustom(p, was); customInput(was)?.blur();
    paintOrRender();
  }
  // (what was typed, set: spaces tidied)
  function tidyCustom(p, field) {
    if (field === 'name') p.name = p.name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (field === 'note') p.note = cleanNote(p.note);
  }
  function pressPrice(k) {
    const p = customPop; if (!p || p.field !== 'price') return;
    const v = p.price;
    p.price = k === 'clear' ? '' : k === 'back' ? v.slice(0, -1) : v === '0' ? k : (v + k).slice(0, 5);
    paintOrRender();
  }
  // Done: the item goes on the order (as its own line, flashing); with no price yet, the price pad opens instead.
  function customDone() {
    const p = customPop; if (!p) return;
    if (p.field) { customSet(); return; }
    const price = parseInt(p.price, 10);
    if (!(price > 0)) { customField('price'); return; }
    const line = { id: newCustomId(), qty: p.qty, type: order.type, mods: [], note: cleanNote(p.note), custom: cleanCustom({ name: p.name, veg: p.veg, price, cat: p.cat }) };
    order.lines.push(line);
    customPop = null; sheet = null; selected = null; render();
    showLine(keyOf(line));
  }
  function closeCustom() { customInput(customPop?.field)?.blur(); customPop = null; sheet = null; render(); }

  // ---------- Print bill ----------
  // The Print bill button shows how much paper the bill printer has left (Counter Update 5): its light blue drains from
  // the top as the roll is used; at 20% or less (or when the printer says the paper is nearly out) the whole button is
  // amber; out of paper (or the cover open) it is red with a "!"; with the printer offline it is grey, its printer
  // crossed out. A tap still prints. The RESTRO Android app works it out for the printer whose role is Bills & receipts
  // or Both (the roll's length less what has been printed, and the printer's own paper sensor) and tells the page
  // (RESTRODevice.printer.paperStatus / subscribePaperStatus, or the restro:printer-paper event: ANDROID-BRIDGE.md);
  // without it (a browser, which prints with its own printing) the button shows a full roll.
  let paper = { level: 100, state: 'ok' };
  const cleanPaper = p => {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return null; } }
    if (!p || typeof p !== 'object') return null;
    const state = ['ok', 'low', 'out', 'offline'].includes(p.state) ? p.state : 'ok', level = Number(p.level);
    return { level: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100, state };
  };
  const paperLook = () => (paper.state === 'offline' ? 'off' : paper.state === 'out' ? 'out' : paper.state === 'low' || paper.level <= 20 ? 'low' : 'ok');
  function printButton() {
    const look = paperLook();
    const said = { ok: `paper about ${paper.level}%`, low: 'paper low', out: 'out of paper', off: 'printer offline' }[look];
    return el('button', { type: 'button', class: `cx-b print cx-print${look === 'ok' ? '' : ` ${look}`}`, style: look === 'ok' ? `--paper:${paper.level}%` : null,
      'aria-label': `Print bill, ${said}`, title: 'Print bill', disabled: !order.lines.length, onclick: printBill },
    mi(look === 'off' ? 'print_disabled' : 'print', 28), look === 'out' ? el('span', { class: 'cx-paper-out', 'aria-hidden': 'true' }, '!') : null);
  }
  function setPaper(p) {
    const next = cleanPaper(p); if (!next) return;
    paper = next;
    const old = dialog.querySelector('.cx-print'); if (old) old.replaceWith(printButton());
  }
  function readPaper() {
    const printer = window.RESTRODevice?.printer; if (typeof printer?.paperStatus !== 'function') return;
    try { Promise.resolve(printer.paperStatus()).then(setPaper, () => {}); } catch {}
  }
  let paperStop = null;
  function watchPaper() {
    try { paperStop?.(); } catch {} paperStop = null;
    const printer = window.RESTRODevice?.printer;
    if (typeof printer?.subscribePaperStatus === 'function') { try { const stop = printer.subscribePaperStatus(setPaper); if (typeof stop === 'function') paperStop = stop; } catch {} }
    readPaper();
  }
  window.addEventListener('restro:printer-paper', e => setPaper(e.detail));
  window.addEventListener('restro:device-ready', watchPaper);
  watchPaper();

  // The bill for the order on screen (25_printed-bill, Counter Update 7, the customer's copy, for every kind of order): the
  // restaurant's name, address, GSTIN and FSSAI number (Settings › Business details); TAX INVOICE; the order number, the
  // date and time; the order type, table and guests; the server; each dish with its choices under it and its dish
  // discount as a minus line ("10% off −26.00", "100% off · Complaint −180.00"); Subtotal, Discount, Service charge
  // (optional), Packaging, Delivery, CGST and SGST each on its own line, Round off, GRAND TOTAL; "Service charge is
  // optional — ask us to remove it." (when there is one) and the bill footer. Black only. The RESTRO Android app prints it
  // on the restaurant's bill printer (RESTRODevice.printer.printBill, ANDROID-BRIDGE.md); in a browser it goes to the
  // browser's printing.
  const SERVICE_FOOTER = 'Service charge is optional — ask us to remove it.';
  function billOf(o = order) {
    const t = totalsOf(o), shop = (localStorage.getItem('restro.restaurantName') || '').trim(), biz = window.RestroPrefs?.get('business') || {};
    const type = o.type || DEFAULT_TYPE;
    return {
      restaurant: shop && shop !== 'RESTAURANT NAME' ? shop : '', address: biz.address || '', gstin: biz.gstin || '', fssai: biz.fssai || '',
      // (Update Pack 3: the restaurant's phone and email, printed under the address)
      phone: biz.phone ? window.RestroProfile?.formatPhone?.(biz.phone, biz.phoneCountry) || biz.phone : '', email: biz.email || '',
      number: o.number ? ticket(o.number) : null, at: Date.now(),
      type: typeLabel[type], table: usesTable(o) ? tableName(o.table) : '', guests: o.guests || 0,
      server: o.server || staffName() || '',
      lines: o.lines.map(l => {
        const each = eachOf(l), gross = each * l.qty * 100, off = window.RestroBill.lineOff(gross, l.off);
        return { name: itemOf(l).name, qty: l.qty, each, total: each * l.qty, modifiers: (l.mods || []).map(modLabel), note: l.note || '',
          ...(l.off ? { discount: { percent: l.off, reason: l.off === 100 ? l.offReason || '' : '', amount: off / 100, label: `${l.off}% off${l.off === 100 && l.offReason ? ` · ${l.offReason}` : ''}` } } : {}) };
      }),
      subtotal: t.subtotal / 100, discount: t.discountPct ? { label: `Discount ${t.discountPct}%`, percent: t.discountPct, amount: t.discount / 100 } : null,
      serviceCharge: t.servicePct ? { label: `Service charge ${t.servicePct}% (optional)`, percent: t.servicePct, amount: t.service / 100 } : null,
      packaging: t.packaging ? { label: 'Packaging charge', amount: t.packaging / 100 } : null, delivery: t.delivery ? { label: 'Delivery charge', amount: t.delivery / 100 } : null,
      taxes: [{ label: GST.cgst, amount: t.cgst / 100 }, { label: GST.sgst, amount: t.sgst / 100 }], tax: t.tax / 100, taxLabel: menu.taxLabel,
      roundOff: t.roundOff / 100, total: t.total / 100,
      footer: [t.servicePct ? SERVICE_FOOTER : '', biz.footer || ''].filter(Boolean)
    };
  }
  // Update Pack 3 (04_Printed-slips): the first print of a bill, and of a receipt, is plain; every later print of the
  // same one has a bold black REPRINT box at the top ("Reprinted 7 Nov 2026 12:20 PM · by RK"), black only. The receipt
  // after payment is a document of its own: TAX INVOICE · RECEIPT, and a boxed "PAID · UPI ₹837" line with the time
  // (and the payment's reference) above the footer. Each print is kept on the order (`bills`, `receipts`).
  // (Update Pack 4: Settings › Business details › Bill number. "At payment": a bill printed before the payment is "BILL ·
  // NOT A TAX INVOICE", with no number (`pre`; kept as { tax: false } among `bills`), and the receipt, with its number,
  // prints by itself at the payment. A bill that already has its number keeps it, and prints as the tax invoice.)
  const PAID_AS = { cash: 'Cash', upi: 'UPI', card: 'Card', swiggy: 'Swiggy', zomato: 'Zomato' };
  const atPayment = () => window.RestroPrefs?.get?.('billNumber')?.at === 'payment';
  function billDoc(o, kind, prints, rec = null, pre = false) {
    const same = prints.filter(p => (p?.tax === false) === pre), now = Date.now(), last = same.length ? { at: now, by: initialsOf(staffName()) } : null;
    // (the receipt carries the bill's date and time, as PS01 draws it, when a bill (a tax invoice) was printed first)
    const billAt = kind === 'receipt' && Array.isArray(rec?.bills) ? Number(rec.bills.find(b => b && b.tax !== false)?.at) || 0 : 0;
    const bill = { ...billOf(o), kind, title: kind === 'receipt' ? 'TAX INVOICE · RECEIPT' : pre ? 'BILL · NOT A TAX INVOICE' : 'TAX INVOICE', at: billAt || same[0]?.at || now, reprint: last };
    if (kind === 'receipt' && rec) bill.paid = { method: PAID_AS[rec.method] || 'Cash', amount: bill.total, at: Date.parse(rec.paidAt) || now, ref: typeof rec.payRef === 'string' ? rec.payRef : '' };
    return bill;
  }
  // To the bill printer (RESTRODevice.printer.printBill), or the browser's printing; resolves whether it printed
  function deliverBill(bill) {
    const printer = window.RESTRODevice?.printer;
    if (typeof printer?.printBill === 'function') {
      try { return Promise.resolve(printer.printBill(bill)).then(ok => ok !== false, () => false).finally(readPaper); } catch { return Promise.resolve(false); }
    }
    printPage(bill); return Promise.resolve(true);
  }
  // The bill's number (Update Pack 3): given at its first print (or at the payment), from the restaurant's one series
  // (RestroSync.takeBillNumber), and kept on the order at once. Resolves { no, year }, or null when no number could be had.
  async function billNumber(target) {
    const rec = savedOf(loadOrders());
    if (rec?.billNo) return { no: rec.billNo, year: rec.billYear };
    if (target.billNo) return { no: target.billNo, year: target.billYear };
    const sync = window.RestroSync; if (!sync?.takeBillNumber) return { no: null, year: null };
    let t = null; try { t = await sync.takeBillNumber(); } catch { t = null; }
    if (!t) return null;
    const list = loadOrders(), now = savedOf(list);
    if (now && order === target) { now.billNo = t.number; now.billYear = t.year; storeOrders(list); keepOpened(now); }
    target.billNo = t.number; target.billYear = t.year; if (order === target) saveDraft();
    return { no: t.number, year: t.year };
  }
  const billLabel = no => (no ? `B-${no}` : null);
  async function printBill() {
    if (!order.lines.length) return;
    const target = order, pre = atPayment() && !target.billNo && !savedOf(loadOrders())?.billNo;
    const num = pre ? { no: null, year: null } : await billNumber(target);
    if (!num) { toast(cantFire(false).replace('order not saved', 'bill not printed')); return; }
    if (order !== target) return;
    const list = loadOrders(), rec = savedOf(list), prints = rec ? (Array.isArray(rec.bills) ? rec.bills : []) : (Array.isArray(order.bills) ? order.bills : []);
    const bill = { ...billDoc(order, 'bill', prints, null, pre), bill: billLabel(num.no) }, app = typeof window.RESTRODevice?.printer?.printBill === 'function';
    const ok = await deliverBill(bill);
    if (app) toast(ok ? 'Bill sent to the printer' : 'The bill didn’t print');
    if (!ok) return;
    const mark = { at: Date.now(), by: staffName(), total: bill.total, ...(pre ? { tax: false } : {}) }, now = loadOrders(), r = rec ? now.find(o => idOf(o) === idOf(rec)) : null;
    if (r) { r.bills = [...(Array.isArray(r.bills) ? r.bills : []), mark].slice(-20); storeOrders(now); if (order.uid === idOf(r)) keepOpened(r); }
    else if (!rec && order === target) { order.bills = [...prints, mark].slice(-20); saveDraft(); }
  }
  // A saved order's bill (not paid yet) or receipt (paid), from Orders: resolves { ok, kind, reprint }. `doc`: the order
  // as Orders has it, for one older than the days this device keeps (read from the cloud, Update Pack 5): printing it
  // brings it back onto this device with the print noted, and sync takes the note to the cloud.
  async function printSaved(uid, doc = null) {
    const copy = () => (doc && typeof doc === 'object' && idOf(doc) === uid && Array.isArray(doc.lines) ? JSON.parse(JSON.stringify(doc)) : null);
    let list = loadOrders(), rec = list.find(o => idOf(o) === uid) || copy(); if (!rec) return { ok: false };
    const keep = (all, r) => { if (!all.some(o => idOf(o) === uid)) all.push(r); return all; };
    // (its bill number first, when it has none yet; Bill number "At payment": not before it is paid)
    const pre = !rec.paidAt && !rec.billNo && atPayment();
    if (!pre && !rec.billNo && window.RestroSync?.takeBillNumber) {
      let t = null; try { t = await window.RestroSync.takeBillNumber(); } catch { t = null; }
      if (!t) return { ok: false, why: 'number' };
      list = loadOrders(); rec = list.find(o => idOf(o) === uid) || copy(); if (!rec) return { ok: false };
      if (!rec.billNo) { rec.billNo = t.number; rec.billYear = t.year; storeOrders(keep(list, rec)); if (order.uid === uid) keepOpened(rec); }
    }
    const kind = rec.paidAt ? 'receipt' : 'bill', key = kind === 'receipt' ? 'receipts' : 'bills', prints = Array.isArray(rec[key]) ? rec[key] : [];
    const bill = { ...billDoc(restoreOrder(rec), kind, prints, rec, pre), bill: billLabel(rec.billNo) };
    const ok = await deliverBill(bill);
    if (ok) {
      const now = loadOrders(), r = now.find(o => idOf(o) === uid) || copy();
      if (r) { r[key] = [...(Array.isArray(r[key]) ? r[key] : []), { at: Date.now(), by: staffName(), total: bill.total, ...(pre ? { tax: false } : {}) }].slice(-20); storeOrders(keep(now, r)); if (order.uid === uid) keepOpened(r); }
    }
    return { ok, kind, reprint: Boolean(bill.reprint) };
  }
  function printPage(bill) {
    let page = document.querySelector('#print-bill');
    if (!page) { page = el('div', { id: 'print-bill', 'aria-hidden': 'true' }); document.body.append(page); }
    const r = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), minus = n => `−${r(n)}`;
    const row = (label, value, cls) => el('tr', cls ? { class: cls } : {}, el('td', {}, ...[label].flat()), el('td', {}, value));
    const at = new Date(bill.at), hour = at.getHours(); // "7 Nov 2026 11:58 AM"
    const when = `${at.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getMonth()]} ${at.getFullYear()} ${hour % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    const stamp = t => { const d = new Date(t), h = d.getHours(); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
    page.replaceChildren(...[
      bill.reprint ? el('div', { class: 'reprint' }, el('b', {}, 'REPRINT'), el('span', {}, `Reprinted ${stamp(bill.reprint.at)}${bill.reprint.by ? ` · by ${bill.reprint.by}` : ''}`)) : null,
      bill.restaurant ? el('h1', {}, bill.restaurant) : null,
      ...(() => { const ls = [bill.address, [bill.phone, bill.email].filter(Boolean).join(' · '), [bill.gstin ? `GSTIN ${bill.gstin}` : '', bill.fssai ? `FSSAI ${bill.fssai}` : ''].filter(Boolean).join(' · ')].filter(Boolean);
        return ls.length ? [el('p', { class: 'small' }, ...ls.flatMap((t, i) => (i ? [el('br'), t] : [t])))] : []; })(),
      el('hr'), el('p', { class: 'b' }, bill.title || 'TAX INVOICE'),
      el('table', { class: 'small' }, el('tbody', {}, row([bill.bill ? `Bill #${bill.bill}` : '', bill.number ? `Order ${bill.number}` : ''].filter(Boolean).join(' · ') || 'Bill', when),
        row([bill.type, bill.table ? `Table ${bill.table}` : '', bill.guests ? plural(bill.guests, 'guest') : ''].filter(Boolean).join(' · '), bill.server ? `Server: ${initialsOf(bill.server)}` : ''))),
      el('hr'),
      el('table', {}, el('tbody', {}, ...bill.lines.flatMap(l => [
        row([`${l.qty} × ${l.name}`, l.modifiers.length ? el('div', { class: 'mod' }, l.modifiers.join(' · ')) : null], r(l.total)),
        l.discount ? row(`  ${l.discount.label}`, minus(l.discount.amount), 'sub') : null].filter(Boolean)))),
      el('hr'),
      el('table', {}, el('tbody', {}, row('Subtotal', r(bill.subtotal)),
        bill.discount ? row(bill.discount.label, minus(bill.discount.amount)) : null,
        bill.serviceCharge ? row(bill.serviceCharge.label, r(bill.serviceCharge.amount)) : null,
        bill.packaging ? row(bill.packaging.label, r(bill.packaging.amount)) : null,
        bill.delivery ? row(bill.delivery.label, r(bill.delivery.amount)) : null,
        ...bill.taxes.map(x => row(x.label, r(x.amount))),
        bill.roundOff ? row('Round off', `${bill.roundOff < 0 ? '−' : '+'}${r(Math.abs(bill.roundOff))}`) : null)),
      el('hr'),
      el('table', { class: 'gt' }, el('tbody', {}, row('GRAND TOTAL', `₹${bill.total.toLocaleString('en-IN')}`))),
      bill.paid ? el('div', { class: 'paid' }, el('b', {}, `PAID · ${bill.paid.method} ₹${bill.paid.amount.toLocaleString('en-IN')}`), el('span', {}, [stamp(bill.paid.at), bill.paid.ref ? `Ref ${bill.paid.ref}` : ''].filter(Boolean).join(' · '))) : null,
      bill.footer.length ? [el('hr'), el('p', { class: 'small' }, ...bill.footer.flatMap((f, i) => (i ? [el('br'), f] : [f])))] : null].flat().filter(Boolean));
    try { window.print(); } catch { toast('Printing isn’t available here'); }
  }

  // ---------- swipe an order line left to remove it ----------
  // Drag a line to the left: it slides over a red strip saying Remove. Let go past a third of its width (or flick it)
  // and the item is removed; otherwise it slides back. Up and down still scroll the list.
  let swipe = null, swipeSuppress = false;
  root.addEventListener('pointerdown', event => {
    const li = event.target.closest?.('.cx-line'); if (!li || event.button !== 0 || swipe?.active || drag) return;
    swipeSuppress = false;
    swipe = { li, key: li.dataset.line, id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), dx: 0, active: false };
  });
  root.addEventListener('pointermove', event => {
    const s = swipe; if (!s || event.pointerId !== s.id) return;
    const dx = event.clientX - s.x, dy = event.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; } // up or down: the list scrolls
      if (dx > -10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      s.active = true; s.li.classList.add('swiping');
      s.li.append(el('span', { class: 'cx-swipe-label', 'aria-hidden': 'true' }, mi('delete', 20), 'Remove'));
      try { s.li.setPointerCapture(s.id); } catch {}
    }
    event.preventDefault();
    s.dx = Math.min(0, dx); s.li.style.setProperty('--swipe', `${s.dx}px`);
  });
  function endSwipe(event, cancel) {
    const s = swipe; if (!s || event.pointerId !== s.id) return; swipe = null;
    if (!s.active) return;
    swipeSuppress = true;
    const width = s.li.clientWidth, flick = s.dx < -60 && -s.dx / (performance.now() - s.t) > .5;
    s.li.classList.add('settling');
    if (!cancel && (s.dx < -width / 3 || flick)) {
      // Gone: it slides the rest of the way out, the line closes up, then the item comes off the order.
      s.li.style.setProperty('--swipe', `${-width}px`);
      setTimeout(() => {
        const h = s.li.offsetHeight, done = () => removeLine(s.key);
        try { s.li.animate([{ height: `${h}px` }, { height: '0px' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish = done; } catch { done(); }
      }, 160);
    } else {
      s.li.style.setProperty('--swipe', '0px');
      setTimeout(() => { s.li.classList.remove('swiping', 'settling'); s.li.querySelector('.cx-swipe-label')?.remove(); }, 180);
    }
  }
  root.addEventListener('pointerup', event => endSwipe(event, false));
  root.addEventListener('pointercancel', event => endSwipe(event, true));
  // A swipe is not a tap: it doesn't open the item, change its quantity, or close the item that is open.
  dialog.addEventListener('click', event => {
    if (swipeSuppress && event.target.closest?.('.cx-line')) { event.preventDefault(); event.stopImmediatePropagation(); }
    swipeSuppress = false;
  }, true);

  // The pop-ups (Counter Update 4): grey cards over the menu, the menu dimmed, the order beside it as it is (a tap there
  // is a tap outside). Each starts with the dish's veg / non-veg mark and its name, with the ✕ at the end of that row
  // (Update 5: 52 round, raised white, at the same place on every pop-up); its buttons are raised white tiles; Done is
  // blue.
  const NOTE_HINT = 'Type special instructions here';
  // The Schedule picker (Update Pack 4, CS1–CS3, CS5, CS8, CS11): right beside the order panel, over the dimmed menu.
  // "Schedule order #1033" ("Change schedule · #1033" when it has a time: a red Clear schedule while its KOT is queued,
  // greyed once it has printed, with "✓ KOT #163 already sent to the kitchen at 9:30 pm" under the title) · the day ·
  // the three wheels · what it comes to ("Ready by today, 10:00 pm" / "With Schedule KOT the kitchen gets it at 9:30 pm
  // (30 min before · Dine-in prep time)", in red when it is too soon) · the two buttons (or Save new time).
  function scheduleCard(hold) {
    const d = scheduleDraft, rec = savedOf(loadOrders()), printed = Boolean(order.readyAt) && kotPrinted(rec);
    const type = order.type || DEFAULT_TYPE, prep = prepMinutes(type), byType = load(KITCHEN_PREP_KEY, null)?.mode === 'type';
    const today = bizKey(Date.now()), tomorrow = addDays(today, 1), number = order.number || upcomingNumber();
    const title = order.readyAt ? `Change schedule · ${ticket(number)}` : `Schedule order ${ticket(number)}`;
    const press = fn => ({ onpointerdown: hold, onmousedown: hold, onclick: fn });
    // the day: Today · Tomorrow · Pick a date (a date picked there shows on it, "Thu 12 Nov"); its calendar under it
    const other = d.day !== today && d.day !== tomorrow;
    // (business hours: a day it is closed can't be picked; a time outside its hours moves to the nearest inside them)
    let seen = null;
    const hoursOf = k => (seen && seen.k === k ? seen.w : (seen = { k, w: hoursOn(k) }).w);
    const okAt = (h, m) => { const w = hoursOf(d.day), t = w && atOn(d.day, h, m); return Boolean(w) && t >= w.from && t <= w.to; };
    // (am / pm turned: the nearest time in that half)
    const fit = () => { const half = d.half; d.half = null; if (okAt(d.h, d.m)) return; const n = nearestOpen(d.day, d.h, d.m, half); if (n) { d.h = n.h; d.m = n.m; } };
    const pickDay = k => { d.day = k; d.cal = null; fit(); render(); };
    const dayChip = (label, on, fn, icon, closed = false) => el('button', { type: 'button', class: `cx-sd${on ? ' on' : ''}`, 'aria-pressed': String(on), disabled: closed, ...press(fn) }, icon ? mi(icon, 20) : null, el('span', {}, label));
    const calendar = () => {
      const [y, mo] = d.cal.split('-').map(Number), first = new Date(y, mo - 1, 1), start = new Date(y, mo - 1, 1 - (first.getDay() + 6) % 7);
      const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      const shift = n => { const t = new Date(y, mo - 1 + n, 1); d.cal = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`; render(); };
      return el('div', { class: 'cx-scal', role: 'group', 'aria-label': 'Pick a date' },
        el('div', { class: 'cx-scal-h' }, el('b', {}, first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
          el('button', { type: 'button', class: 'cx-scal-nav', 'aria-label': 'Previous month', ...press(() => shift(-1)) }, mi('chevron_left', 22)),
          el('button', { type: 'button', class: 'cx-scal-nav', 'aria-label': 'Next month', ...press(() => shift(1)) }, mi('chevron_right', 22))),
        el('div', { class: 'cx-scal-w', 'aria-hidden': 'true' }, ...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => el('span', {}, w))),
        el('div', { class: 'cx-scal-g' }, ...cells.map(c => {
          const k = dkey(c), out = c.getMonth() !== mo - 1, past = k < today, closed = !out && !past && !hoursOn(k);
          return el('button', { type: 'button', class: `cx-scal-d${out || past || closed ? ' off' : ''}${k === today ? ' today' : ''}${k === d.day && !out ? ' on' : ''}`, disabled: out || past || closed,
            'aria-pressed': String(k === d.day), 'aria-label': c.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), ...press(() => pickDay(k)) }, String(c.getDate()));
        })));
    };
    const days = el('div', { class: 'cx-sdays', role: 'group', 'aria-label': 'Day' },
      dayChip('Today', d.day === today, () => pickDay(today), null, !hoursOn(today)), dayChip('Tomorrow', d.day === tomorrow, () => pickDay(tomorrow), null, !hoursOn(tomorrow)),
      dayChip(other ? dateWords(d.day) : 'Pick a date', other, () => { d.cal = d.cal ? null : (other ? d.day : today).slice(0, 7); render(); }, 'calendar'),
      d.cal ? calendar() : null);
    // what it comes to, and the buttons, follow the wheels as they turn (the picker itself isn't drawn again)
    const sum1 = el('b', {}), sum2 = el('span', {});
    const kotBtn = (label, fn) => { const sub = el('small', {}); return [el('button', { type: 'button', class: 'cx-sk', ...press(fn) }, el('b', {}, label), sub), sub]; };
    const [sched, schedSub] = kotBtn('Schedule KOT', () => chooseSchedule('queue')), [instant, instantSub] = kotBtn('Instant KOT', () => chooseSchedule('now')), [saveNew, saveSub] = kotBtn('Save new time', saveNewTime);
    instantSub.textContent = 'prints now'; saveSub.textContent = 'prints a time-changed slip';
    const update = () => {
      // (a wheel turned onto a time outside business hours, by am / pm: the nearest one inside them; the greyed rows again)
      if (!okAt(d.h, d.m) && hoursOf(d.day)) { fit(); wheelsAt(); }
      for (const w of wheelEls) w.repaint();
      const closed = !hoursOf(d.day);
      const readyAt = atOn(d.day, d.h, d.m), now = Date.now(), kitchenAt = readyAt - prep * 60000, passed = readyAt <= now, soon = !passed && kitchenAt <= now;
      const when = sameDay(kitchenAt) ? timeOf(kitchenAt) : `${timeOf(kitchenAt)} on ${dateWords(bizKey(kitchenAt))}`;
      sum1.textContent = `Ready by ${dayWord(d.day)}, ${timeOf(readyAt)}`;
      if (closed) sum2.replaceChildren(el('em', {}, `Closed ${dayWord(d.day) === 'today' || dayWord(d.day) === 'tomorrow' ? dayWord(d.day) : `on ${dayWord(d.day)}`} · pick another day`));
      else if (passed) sum2.replaceChildren(el('em', {}, `${timeOf(readyAt)} has passed · pick a later time`));
      else if (printed) sum2.replaceChildren(`was ${readyShort(rec.readyAt)} · the kitchen gets a `, el('i', {}, 'TIME CHANGED'), ' slip');
      else if (soon) sum2.replaceChildren(el('em', {}, `Too soon to schedule · the kitchen needs ${prep} min. Use Instant KOT.`));
      else sum2.replaceChildren('With Schedule KOT the kitchen gets it at ', el('i', {}, when), ` (${prep} min before · ${byType ? `${typeLabel[type]} prep time` : 'kitchen prep time'})`);
      schedSub.textContent = closed ? 'closed' : passed || soon ? 'too soon' : `prints at ${when}`;
      sched.disabled = closed || passed || soon; instant.disabled = closed || passed; saveNew.disabled = closed || passed;
    };
    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1)), minutes = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
    const fives = Array.from({ length: 12 }, (_, i) => i * 5), hourOf = i => (i + 1) % 12 + (d.h >= 12 ? 12 : 0);
    const wheelEls = [
      drum('Hour', hours, (d.h + 11) % 12, true, i => { d.h = hourOf(i); }, update, i => fives.some(m => okAt(hourOf(i), m))),
      drum('Minutes', minutes, d.m / 5, true, i => { d.m = i * 5; }, update, i => okAt(d.h, i * 5)),
      drum('am or pm', ['am', 'pm'], d.h >= 12 ? 1 : 0, false, i => { d.h = d.h % 12 + (i ? 12 : 0); d.half = Boolean(i); }, update, i => Array.from({ length: 12 }, (_, x) => x + i * 12).some(h => fives.some(m => okAt(h, m))))];
    const wheelsAt = () => { wheelEls[0].set((d.h + 11) % 12); wheelEls[1].set(d.m / 5); wheelEls[2].set(d.h >= 12 ? 1 : 0); };
    const wheels = el('div', { class: 'cx-swheels' }, ...wheelEls);
    fit(); wheelsAt(); update();
    const first = printed ? kotsOf(rec)[0] : null;
    return el('div', { class: `cx-pu sched${printed ? ' printed' : ''}`, role: 'dialog', 'aria-label': title,
      // (a tap anywhere else in the picker closes the calendar)
      onclick: e => { if (d.cal && !e.target.closest?.('.cx-scal, .cx-sd')) { d.cal = null; render(); } } },
      el('div', { class: 'cx-pu-head cx-sh' }, el('h3', {}, title),
        order.readyAt ? el('button', { type: 'button', class: 'cx-sclear', disabled: printed, ...press(clearSchedule) }, 'Clear schedule') : null, closeX(closeSchedule, hold)),
      printed ? el('p', { class: 'cx-ssent' }, mi('check_circle', 18), `KOT ${first?.no ? `#${first.no} ` : ''}already sent to the kitchen${first ? ` at ${timeOf(first.at)}` : ''}`) : null,
      days, wheels, el('div', { class: 'cx-ssum', 'aria-live': 'polite' }, sum1, sum2),
      el('div', { class: `cx-sks${printed ? ' one' : ''}` }, ...(printed ? [saveNew] : [sched, instant])));
  }
  // A wheel (CS1): five rows, the one picked in the blue band (blue and bold), the next ones dark, the outer ones pale.
  // Drag it, tap a row, turn the mouse wheel or use the arrow keys; hours and minutes go round, am / pm doesn't. `ok`
  // (a row's index → whether it can be picked): the others are greyed and turning goes past them.
  function drum(label, values, index, loop, pick, changed, ok = () => true) {
    const n = values.length, box = el('div', { class: 'cx-wh', role: 'listbox', tabindex: '0', 'aria-label': label });
    const band = el('div', { class: 'cx-wh-band', 'aria-hidden': 'true' }), rows = [];
    let cur = index, drag = 0, startY = null, moved = false;
    const rowH = () => band.offsetHeight || 60;
    const at = i => (loop ? ((i % n) + n) % n : i);
    const paint = () => {
      rows.splice(0).forEach(r => r.remove());
      const h = rowH();
      for (let i = -3; i <= 3; i++) {
        const v = cur + i; if (!loop && (v < 0 || v >= n)) continue;
        const dist = Math.abs(i + drag / h);
        const row = el('div', { class: `cx-wh-row${dist < 0.5 ? ' sel' : dist < 1.5 ? ' near' : ''}${ok(at(v)) ? '' : ' off'}`, role: 'option', 'aria-selected': String(i === 0), 'aria-disabled': ok(at(v)) ? null : 'true' }, values[at(v)]);
        row.style.setProperty('--i', String(i)); row.style.transform = drag ? `translateY(${drag}px)` : '';
        rows.push(row); box.append(row);
      }
    };
    const go = step => {
      let v = step ? (loop ? at(cur + step) : Math.max(0, Math.min(n - 1, cur + step))) : cur;
      // (a greyed row: on to the next one that can be picked, the same way; none: it stays)
      for (let k = 0; v !== cur && !ok(v) && k < n; k++) { const w = v + Math.sign(step); v = loop ? at(w) : w < 0 || w >= n ? cur : w; }
      if (!ok(v)) v = cur;
      drag = 0; if (v !== cur) { cur = v; pick(cur); changed(); }
      paint();
    };
    box.repaint = () => paint();
    box.set = i => { cur = loop ? at(i) : Math.max(0, Math.min(n - 1, i)); paint(); };
    box.append(band);
    box.addEventListener('pointerdown', e => { startY = e.clientY; moved = false; drag = 0; box.setPointerCapture?.(e.pointerId); });
    box.addEventListener('pointermove', e => {
      if (startY == null) return;
      drag = e.clientY - startY; if (Math.abs(drag) > 6) moved = true;
      if (!loop) drag = Math.max(-(n - 1 - cur) * rowH(), Math.min(cur * rowH(), drag));
      paint();
    });
    box.addEventListener('pointerup', e => {
      if (startY == null) return;
      const r = box.getBoundingClientRect(), step = moved ? Math.round(-drag / rowH()) : Math.round((e.clientY - r.top - r.height / 2) / rowH());
      startY = null; go(step);
    });
    box.addEventListener('pointercancel', () => { startY = null; go(0); });
    box.addEventListener('wheel', e => { e.preventDefault(); go(Math.sign(e.deltaY)); }, { passive: false });
    box.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); go(e.key === 'ArrowDown' ? 1 : -1); } });
    paint();
    return box;
  }
  function popView() {
    const kind = sheet, hold = e => e.preventDefault(); // (a tap that is not on a line typed on leaves the keyboard as it is)
    const layer = (card, outside = () => {}) => el('div', { class: `cx-layer ${kind}` },
      el('div', { class: 'cx-layer-order', onpointerdown: hold, onmousedown: hold, onclick: outside }),
      el('div', { class: 'cx-layer-menu', onpointerdown: hold, onmousedown: hold, onclick: outside }),
      card);
    if (kind === 'custom') return layer(customCard(hold));
    if (kind === 'discount') return layer(discountCard(hold), cancelDiscount);
    // Update 7: the service charge, the dish discount, a void (a tap outside does nothing: it needs a reason, or ✕) and
    // Change server; the order note
    if (kind === 'service') return layer(serviceCard(hold), cancelService);
    if (kind === 'dish') return layer(dishCard(hold), () => {});
    if (kind === 'void') return layer(voidCard(hold), () => {});
    if (kind === 'server') return layer(serverCard(hold), () => { sheet = null; serverPop = null; render(); });
    if (kind === 'pagerask') return layer(pagerAskCard(hold), cancelPagerAsk);
    if (kind === 'history') return historyLayer(hold);
    if (kind === 'schedule') return layer(scheduleCard(hold), closeSchedule);
    const done = (fn, wide) => el('button', { type: 'button', class: `cx-done${wide ? ' wide' : ''}`, onpointerdown: hold, onmousedown: hold, onclick: fn }, 'Done');
    if (kind === 'note' && notePop.key === null) {
      // "Order note · Order #1015 · Table 12", the whole order's quick notes (no + Add), Clear note, Done
      const where = [order.number || upcomingNumber() ? `Order ${ticket(order.number || upcomingNumber())}` : '', usesTable(order) ? `Table ${tableName(order.table)}` : order.customer?.name || ''].filter(Boolean).join(' · ');
      const head = el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-pu-dish cx-on-head' }, el('i', { 'aria-hidden': 'true' }, mi('note_alt', 22)), el('b', {}, 'Order note'), where ? el('span', {}, where) : null),
        closeX(cancelNote, hold));
      return layer(noteCard({ quickId: ORDER_QUICK, adds: false, name: 'the order' }, head, done, hold), () => {});
    }
    const key = kind === 'mods' ? modPop.key : kind === 'qty' ? qtyPop.key : notePop.key, line = lineOf(key), item = itemOf(line);
    // (a tap outside while the note is typed in the modifier pop-up does nothing, as on the note pop-up)
    const outside = kind === 'mods' ? () => { if (!modPop?.note) closeMods(); } : kind === 'qty' ? cancelQty : () => {};
    const dish = el('div', { class: 'cx-pu-dish' }, item.veg == null ? null : el('em', { class: item.veg ? 'veg' : 'non', 'aria-hidden': 'true' }), el('b', {}, item.name));
    if (kind === 'mods' && modPop.note) return layer(modsNoteCard(line, item, dish, hold), outside);
    const head = el('div', { class: 'cx-pu-head' }, dish, closeX(kind === 'mods' ? cancelMods : kind === 'qty' ? cancelQty : cancelNote, hold));
    return layer(kind === 'mods' ? modsCard(line, item, head, done) : kind === 'qty' ? qtyCard(line, item, head, done) : noteCard({ quickId: line.id, adds: !line.custom, name: item.name }, head, done, hold), outside);
  }
  const closeX = (fn, hold) => el('button', { type: 'button', class: 'cx-x', 'aria-label': 'Close without changes', title: 'Close', onpointerdown: hold, onmousedown: hold, onclick: fn }, mi('close', 26));
  // Modifiers: each group (title, "Required · pick 1" or "Optional") with its choices as tiles, 1–3 choices a third of
  // the row each, 4 or more a quarter each, four to a row; a price under its choice's name; a choice made is light blue
  // with a tick (Update 5: spice level too; on the order it stays amber). The bottom row: the note (tap it to type it,
  // in this pop-up (Update 6); with none, its line is soft red with "Type special instructions here" in grey) · −
  // quantity + · Done. A
  // required group left empty when closing is tried: red badge, "Choose a spice level to continue", red edges, until a
  // choice is made.
  function modsCard(line, item, head, done) {
    const missing = new Set(modPop.tried ? missingOf(line).map(g => g.id) : []);
    const group = g => {
      const err = missing.has(g.id), single = g.required || g.single;
      return el('section', { class: 'cx-mg', role: single ? 'radiogroup' : 'group', 'aria-label': g.name },
        el('div', { class: 'cx-mg-head' },
          el('b', {}, g.name),
          el('span', { class: `cx-badge ${err ? 'err' : g.required ? 'req' : 'opt'}` }, g.required ? `Required · pick 1${g.mode === 'set' ? ' · sets the price' : ''}` : 'Optional'),
          err ? el('span', { class: 'cx-mg-err', role: 'alert' }, `Choose a ${g.name.toLowerCase()} to continue`) : null),
        el('div', { class: `cx-mg-opts c${g.options.length <= 3 ? 3 : 4}` }, ...g.options.map(o => {
          const on = line.mods.includes(o.id);
          return el('button', { type: 'button', role: single ? 'radio' : 'checkbox', 'aria-checked': String(on), class: `cx-mo${on ? ' on' : err ? ' err' : ''}`, onclick: () => pickOption(g, o) },
            on ? mi('check', 20) : null,
            el('span', { class: 'cx-mo-t' }, el('span', {}, o.label), o.price ? el('small', {}, `${g.mode === 'set' ? '' : '+'}₹${o.price.toLocaleString('en-IN')}`) : null));
        })));
    };
    return el('div', { class: 'cx-pu mods', role: 'dialog', 'aria-label': `${item.name}: choices` },
      head,
      el('div', { class: 'cx-pu-groups' }, ...groupsOf(line.id).map(group)),
      el('div', { class: 'cx-pu-foot' },
        el('button', { type: 'button', class: 'cx-nl', 'aria-label': line.note ? `Note: ${line.note}. Tap to change it` : 'Add a note', onclick: openModsNote },
          el('span', { class: 'cx-nl-label' }, 'Note'),
          el('span', { class: `cx-nl-line${line.note ? '' : ' empty'}` }, mi('edit', 20), el('span', {}, line.note || NOTE_HINT))),
        el('div', { class: 'cx-rs' },
          el('button', { type: 'button', class: 'cx-rb', 'aria-label': `One less ${item.name}`, onclick: () => stepMods(-1) }, mi('remove', 26)),
          el('output', { 'aria-live': 'polite' }, String(line.qty)),
          el('button', { type: 'button', class: 'cx-rb', 'aria-label': `One more ${item.name}`, onclick: () => stepMods(1) }, mi('add', 26))),
        done(() => { closeMods(); })));
  }
  // The number pad (quantity, a custom item's price): 1–9, Clear, 0, ⌫
  // (Update 7: the service charge's has a decimal point where Clear is)
  const numberKeys = (press, cls = '', left = 'clear') => el('div', { class: `cx-qk${cls}` }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9', left, '0', 'back'].map(k =>
    el('button', { type: 'button', class: `cx-key${k === 'clear' || k === 'back' || k === '.' ? ' fn' : ''}${k === '.' ? ' dot' : ''}`, 'data-key': k, 'aria-label': k === 'clear' ? 'Clear' : k === 'back' ? 'Backspace' : k === '.' ? 'Decimal point' : k, onclick: () => press(k) },
      k === 'back' ? mi('backspace', 28) : k === 'clear' ? 'Clear' : k)));
  // Quantity: the value typed (blue, with a blinking blue cursor; empty until a key is pressed) · 1–9, Clear, 0, ⌫ · Done
  function qtyCard(line, item, head, done) {
    const v = qtyPop.value;
    return el('div', { class: 'cx-pu qty', role: 'dialog', 'aria-label': `Quantity for ${item.name}` },
      head,
      el('div', { class: 'cx-qd', role: 'status', 'aria-label': v ? `Quantity ${v}` : `Type the quantity (now ${line.qty})` }, v ? el('span', {}, v) : null, el('i', { 'aria-hidden': 'true' })),
      numberKeys(pressQty),
      done(doneQty, true));
  }
  // Apply discount (Update 6), as the quantity pop-up and where it is: the green % with "Apply discount", ✕ · the
  // percentage (blue, its cursor blinking; empty until a key is pressed, or the order's discount, to change it) · what
  // it comes to ("On subtotal ₹3,960 · saves ₹396") · 5 10 15 20 25 % · 1–9, Clear, 0, ⌫ (1 to 100) · "Apply 10%
  // discount". ✕ or a tap outside leaves the order as it was.
  function discountCard(hold) {
    const p = discPop, n = discOf(p), t = totals(), saves = n ? window.RestroBill.totals(t.subtotal, n, menu.taxRate).discount : 0;
    return el('div', { class: 'cx-pu disc', role: 'dialog', 'aria-label': 'Apply discount' },
      el('div', { class: 'cx-pu-head' }, el('div', { class: 'cx-dh' }, el('i', { 'aria-hidden': 'true' }, mi('percent', 22)), el('b', {}, 'Apply discount')), closeX(cancelDiscount, hold)),
      el('div', { class: 'cx-dd', role: 'status', 'aria-label': n ? `Discount ${n}%` : 'Type the discount' }, p.value ? el('span', {}, p.value) : null, el('small', {}, '%'), el('i', { 'aria-hidden': 'true' })),
      el('p', { class: 'cx-dpv' }, `On subtotal ${amount(t.subtotal)}`, n ? [' · saves ', el('b', {}, amount(saves))] : null),
      el('div', { class: 'cx-dqp', role: 'group', 'aria-label': 'Quick picks' }, ...(billing().orderDiscount?.picks?.length ? billing().orderDiscount.picks : [5, 10, 15, 20, 25]).slice(0, 5).map(q =>
        el('button', { type: 'button', class: n === q ? 'on' : null, 'aria-pressed': String(n === q), onclick: () => { discPop.value = String(q); render(); } }, `${q}%`))),
      numberKeys(pressDisc, ' cx-dk'),
      el('button', { type: 'button', class: 'cx-done wide', disabled: !n, onclick: applyDiscount }, n ? `Apply ${n}% discount` : 'Apply discount'));
  }
  // Service charge (Update 7), where the discount pop-up is: the blue cloche with "Service charge", ✕ · the rate (blue,
  // its cursor blinking) · "On ₹3,564 after discount · adds ₹178.20" · 2.5% 5% 7.5% 10% · the number pad with a decimal
  // point · "Add 5% service charge" · "Optional · add only if the customer agrees · max 10%".
  function serviceCard(hold) {
    const p = servicePop, n = serviceOf(p), t = totals(), base = t.subtotal - t.discount, max = serviceMax();
    const adds = n ? totalsOf({ ...order, servicePct: n }).service : 0;
    const picks = (billing().serviceCharge?.picks?.length ? billing().serviceCharge.picks : SERVICE.picks).filter(q => q > 0 && q <= max).slice(0, 4);
    return el('div', { class: 'cx-pu disc svc', role: 'dialog', 'aria-label': 'Service charge' },
      el('div', { class: 'cx-pu-head' }, el('div', { class: 'cx-dh svc' }, el('i', { 'aria-hidden': 'true' }, mi('room_service', 22)), el('b', {}, 'Service charge')), closeX(cancelService, hold)),
      el('div', { class: 'cx-dd', role: 'status', 'aria-label': n ? `Service charge ${n}%` : 'Type the service charge' }, p.value ? el('span', {}, p.value) : null, el('small', {}, '%'), el('i', { 'aria-hidden': 'true' })),
      el('p', { class: 'cx-dpv svc' }, t.discount ? `On ${amount(base)} after discount` : `On subtotal ${amount(base)}`, n ? [' · adds ', el('b', {}, amount(adds))] : null),
      el('div', { class: `cx-dqp c${Math.max(1, picks.length)}`, role: 'group', 'aria-label': 'Quick picks' }, ...picks.map(q =>
        el('button', { type: 'button', class: n === q ? 'on' : null, 'aria-pressed': String(n === q), onclick: () => { servicePop.value = String(q); render(); } }, `${q}%`))),
      numberKeys(pressService, ' cx-dk', '.'),
      el('button', { type: 'button', class: 'cx-done wide', disabled: !n, onclick: applyService }, n ? `Add ${n}% service charge` : 'Add service charge'),
      el('p', { class: 'cx-legal' }, `Optional · add only if the customer agrees · max ${max}%`));
  }
  // Dish discount (Update 7). Step 1, "Pick the dishes": every line, a box, its quantity (× 8) and its total; "Next ·
  // 1 dish". Step 2: ‹, the dish (or how many), its quantity × price = total, ✕ · the percentage · "₹180 → ₹0 · 100% off"
  // · 10% 20% 50% 100% · the number pad · at 100% only, "Reason (asked only at 100%)" and the reasons (one needed) ·
  // "Apply 100% off".
  function dishCard(hold) {
    const p = dishPop, press = fn => ({ type: 'button', onpointerdown: hold, onmousedown: hold, onclick: fn });
    if (p.step === 1) {
      const names = new Map(); for (const l of order.lines) names.set(itemOf(l).name, (names.get(itemOf(l).name) || 0) + 1);
      return el('div', { class: 'cx-pu dish pick', role: 'dialog', 'aria-label': 'Dish discount, step 1 of 2: pick the dishes' },
        el('div', { class: 'cx-pu-head' }, el('div', { class: 'cx-steph' }, el('small', {}, 'Dish discount · Step 1 of 2'), el('b', {}, 'Pick the dishes')), closeX(cancelDish, hold)),
        el('div', { class: 'cx-pkl', role: 'group', 'aria-label': 'Dishes' }, ...order.lines.map(l => {
          const k = keyOf(l), on = p.picked.includes(k), name = itemOf(l).name;
          const more = [l.qty > 1 ? `× ${l.qty}` : '', names.get(name) > 1 ? l.mods.map(modLabel).join(', ') : '', l.off ? `${l.off}% off now` : ''].filter(Boolean).join(' · ');
          return el('button', { ...press(() => { p.picked = on ? p.picked.filter(x => x !== k) : [...p.picked, k]; render(); }), class: `cx-pk${on ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(on) },
            el('span', { class: 'cx-cb', 'aria-hidden': 'true' }, on ? mi('check', 18) : null), el('b', {}, name), el('small', {}, more), el('span', { class: 'cx-pa' }, rupees(eachOf(l) * l.qty)));
        })),
        el('button', { ...press(dishNext), class: 'cx-done wide', disabled: !p.picked.length }, p.picked.length ? `Next · ${p.picked.length} ${p.picked.length === 1 ? 'dish' : 'dishes'}` : 'Next'));
    }
    const lines = p.picked.map(lineOf).filter(Boolean), one = lines.length === 1 ? lines[0] : null, n = dishValue(p);
    const gross = lines.reduce((sum, l) => sum + eachOf(l) * l.qty * 100, 0), off = n ? lines.reduce((sum, l) => sum + window.RestroBill.lineOff(eachOf(l) * l.qty * 100, n), 0) : 0;
    const removing = !n, had = lines.some(l => l.off), needReason = n === 100, reason = dishReason(p);
    const ok = removing ? had : !needReason || Boolean(reason);
    const apply = el('button', { ...press(applyDish), class: 'cx-done wide', disabled: !ok }, removing ? 'Remove dish discount' : `Apply ${n}% off`);
    const card = el('div', { class: `cx-pu dish pct${p.typing ? ' typing' : ''}`, role: 'dialog', 'aria-label': 'Dish discount, step 2 of 2' },
      el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-pu-lead' }, el('button', { ...press(() => { p.step = 1; p.typing = false; render(); }), class: 'cx-x', 'aria-label': 'Back to the dishes', title: 'Back' }, mi('chevron_left', 28)),
          el('div', { class: 'cx-steph' }, el('small', {}, 'Dish discount · Step 2 of 2'), el('b', {}, one ? itemOf(one).name : `${lines.length} dishes`),
            el('span', {}, one ? `${one.qty} × ${rupees(eachOf(one))} = ${rupees(eachOf(one) * one.qty)}` : `${lines.map(l => itemOf(l).name).join(', ')} · ${amount(gross)}`))),
        closeX(cancelDish, hold)),
      el('div', { class: `cx-dd sm${needReason ? ' set' : ''}`, role: 'status', 'aria-label': n != null ? `${n}% off` : 'Type the percentage' }, p.value ? el('span', {}, p.value) : null, el('small', {}, '%'), el('i', { 'aria-hidden': 'true' })),
      el('p', { class: 'cx-dpv' }, amount(gross), n ? [' → ', el('b', {}, `${amount(gross - off)} · ${n}% off`)] : n === 0 ? ' · no discount' : null),
      el('div', { class: 'cx-dqp c4', role: 'group', 'aria-label': 'Quick picks' }, ...dishPicks().slice(0, 4).map(q =>
        el('button', { ...press(() => { p.value = String(q); render(); }), class: n === q ? 'on' : null, 'aria-pressed': String(n === q) }, `${q}%`))),
      needReason ? freeReason(p, apply, hold) : numberKeys(pressDish, ' cx-dk sm'),
      apply);
    return card;
  }
  // At 100% the number pad steps aside for the reason, asked as the void pop-up asks it (Update Pack 3): "Reason (asked
  // only at 100%)" and its line (a soft red line while empty; blue, its cursor at the end, once it has words) · "Top
  // reasons": the restaurant's 9 most given, 3 a row (a tap puts that reason on the line, where it can be changed; the
  // one on the line light blue), or before its first list "Your most-used reasons will show up here after 15 days." The
  // keyboard comes up only when the line is tapped: the pop-up moves up and the reasons become one row that slides.
  // 10% 20% 50% bring the pad back.
  function freeReason(p, apply, hold) {
    const reasons = dishReasons();
    const tf = textField({ id: 'counter-dish-reason', value: p.reason, hint: 'Type the reason here', max: 80, label: 'Reason', idle: true }), field = tf.input;
    const line = el('span', { class: 'cx-nf-line' }, mi('edit', 22), tf.box);
    const chips = reasons.map(r => el('button', { type: 'button', class: 'cx-qn-chip', onpointerdown: hold, onmousedown: hold,
      onclick: () => { p.reason = r; field.value = r; sync(); tf.place(); } }, el('span', { class: 'cx-qn-t' }, r)));
    const sync = () => {
      const said = dishReason(p).toLowerCase();
      chips.forEach((b, i) => { const on = Boolean(said) && reasons[i].toLowerCase() === said; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      line.classList.toggle('empty', !p.reason);
      apply.disabled = !dishReason(p);
    };
    sync();
    field.addEventListener('input', () => { p.reason = field.value; sync(); });
    field.addEventListener('focus', () => { if (dishPop !== p) return; p.typing = true; field.closest('.cx-pu')?.classList.add('typing'); });
    field.addEventListener('blur', () => { if (dishPop !== p || !field.isConnected) return; p.typing = false; field.closest('.cx-pu')?.classList.remove('typing'); });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); field.blur(); } });
    return [
      el('label', { class: 'cx-nf' }, el('span', { class: 'cx-nf-label' }, 'Reason (asked only at 100%)'), line),
      el('div', { class: 'cx-nf-q' }, 'Top reasons'),
      chips.length ? el('div', { class: 'cx-vr', role: 'group', 'aria-label': 'Top reasons' }, ...chips)
        : el('div', { class: 'cx-vempty' }, 'Your most-used reasons will show up here after 15 days.')];
  }
  // A void (Update Pack 2, void pop-up v2, screens V1–V6), where the note pop-up is (940 wide, 14 under the top of the
  // menu, keyboard or not): the red ⊖, "Remove Chicken biryani?" / "Reduce Chicken noodles 8 → 7?" / "Delete order
  // #1015?" with what the kitchen has beside it ("Already sent to the kitchen · KOT #2"), ✕ · what will print, in a red
  // box · "Reason (required)" and its box (a soft red line while empty; blue, its cursor at the end, once it has words)
  // · "Top reasons": the restaurant's 9 most used, 3 a row (a tap puts that reason in the box, where it can be changed;
  // the one in the box is light blue), or before its first list "Your most-used reasons will show up here after 15
  // days." · Clear (grey while the box is empty) ........ the red button, grey until the box has words. The keyboard
  // comes up only when the box is tapped: then the red box goes and the reasons become one row that slides, so it all
  // sits above the keyboard. ✕ changes nothing; a tap outside does nothing.
  function voidCard(hold) {
    const p = voidPop, whole = p.key == null, line = whole ? null : lineOf(p.key), rec = savedOf(loadOrders());
    const name = line ? itemOf(line).name : '', n = line ? sentOf(line) - Math.max(0, p.to) : 0, kots = kotsOf(rec);
    const kotNo = line && rec ? kotOfKey(rec, kitchenKey(line.id, lineType(line), (line.kit || [])[line.kit.length - 1]?.mods || line.mods)) : null;
    const title = whole ? `Delete order ${ticket(order.number)}?` : p.to <= 0 ? `Remove ${name}?` : `Reduce ${name} ${line.qty} → ${p.to}?`;
    const queued = whole && p.queued;
    const sub = queued ? `KOT not printed yet (queued for ${rec ? timeOf(kitchenTime(rec)) : ''})` : whole ? `${kots.length} KOT${kots.length === 1 ? '' : 's'} already sent to the kitchen` : `Already sent to the kitchen${kotNo ? ` · KOT #${kotNo}` : ''}`;
    const reasons = learnedReasons(whole ? CANCEL_QUICK : VOID_QUICK);
    const tf = textField({ id: 'counter-reason', value: p.reason, hint: 'Type the reason here', max: 80, label: 'Reason', idle: true }), field = tf.input;
    const reasonLine = el('span', { class: 'cx-nf-line' }, mi('edit', 22), tf.box);
    const chipEls = reasons.map(r => el('button', { type: 'button', class: 'cx-qn-chip', onpointerdown: hold, onmousedown: hold,
      onclick: () => { p.reason = r; field.value = r; sync(); tf.place(); } }, el('span', { class: 'cx-qn-t' }, r)));
    const clear = el('button', { type: 'button', class: 'cx-clear', onpointerdown: hold, onmousedown: hold, onclick: () => { p.reason = ''; field.value = ''; sync(); tf.place(); } }, 'Clear');
    const send = el('button', { type: 'button', class: 'cx-btnr', onpointerdown: hold, onmousedown: hold, onclick: confirmVoid },
      queued ? 'Delete order' : whole ? 'Delete order & send void' : p.to <= 0 ? 'Remove & send void' : 'Reduce & send void');
    const sync = () => {
      const said = cleanReason(p.reason).toLowerCase();
      chipEls.forEach((b, i) => { const on = Boolean(said) && reasons[i].toLowerCase() === said; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      reasonLine.classList.toggle('empty', !p.reason);
      const ok = Boolean(voidReason(p)); send.disabled = !ok; send.classList.toggle('off', !ok);
      clear.disabled = !p.reason; clear.classList.toggle('off', !p.reason);
    };
    sync();
    const card = el('div', { class: `cx-pu void${p.typing ? ' typing' : ''}`, role: 'dialog', 'aria-label': title },
      el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-dh void' }, el('i', { 'aria-hidden': 'true' }, mi('do_not_disturb_on', 22)), el('b', {}, title), el('span', {}, sub)),
        closeX(cancelVoid, hold)),
      queued ? el('div', { class: 'cx-vinfo plum' }, mi('schedule', 22), el('span', {}, 'The kitchen hasn’t got this order yet, so ', el('b', {}, 'nothing prints in the kitchen'), '. The queued KOT is cancelled.'))
      : el('div', { class: 'cx-vinfo' }, mi('receipt_long', 22), whole
        ? el('span', {}, 'An ', el('b', {}, 'ORDER CANCELLED'), ' slip for the ', el('b', {}, `whole order (${plural(totals().count, 'item')})`), ' will print in the kitchen. This can’t be undone.')
        : el('span', {}, 'A ', el('b', {}, 'VOID'), ' slip for ', el('b', {}, `${n} × ${name}`), ' will print in the kitchen.')),
      el('label', { class: 'cx-nf' }, el('span', { class: 'cx-nf-label' }, 'Reason (required)'), reasonLine),
      el('div', { class: 'cx-nf-q' }, 'Top reasons'),
      chipEls.length ? el('div', { class: 'cx-vr', role: 'group', 'aria-label': 'Top reasons' }, ...chipEls)
        : el('div', { class: 'cx-vempty' }, 'Your most-used reasons will show up here after 15 days.'),
      el('div', { class: 'cx-nf-foot' }, clear, send));
    field.addEventListener('input', () => { p.reason = field.value; sync(); });
    field.addEventListener('focus', () => { if (voidPop !== p) return; p.typing = true; card.classList.add('typing'); });
    field.addEventListener('blur', () => { if (voidPop !== p || !field.isConnected) return; p.typing = false; card.classList.remove('typing'); });
    // (the keyboard's Enter puts it away; sending is the red button's)
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); field.blur(); } });
    return card;
  }
  // Track history (Update Pack 3, CT02): every change to the order on screen (saved, not paid), oldest first: when, its
  // icon, what happened, the details (the reason, who, the slip printed) and the amount. What came after the bill was
  // first printed is amber, tagged "After bill" ("After void" on a bill reprinted after a void). At the bottom: the
  // order's discounts as they are now, its voids, and how many changes came after the bill. The list scrolls; while more
  // is below, its last line fades out. Voided dishes show only here and in Orders (the order panel has what is on the
  // order now).
  let historyTop = 0;
  function openHistory() {
    closeMenu();
    if (!savedOf(loadOrders())) { render(); say('No history yet · Save starts it'); return; }
    historyTop = 0; sheet = 'history'; render();
  }
  const closeHistory = () => { sheet = null; render(); };
  const clockOf = t => { const s = timeOf(t).toUpperCase(); return dayKey(t) === dayKey(Date.now()) ? s : `${new Date(t).toLocaleDateString('en-IN', { weekday: 'short' })} ${s}`; };
  const dishCount = n => `${n} ${n === 1 ? 'dish' : 'dishes'}`;
  // A void slip's dishes at their price then (a slip from before Update Pack 3: at the order's or the menu's price)
  const voidAmount = (rec, k) => Number.isFinite(k.amount) ? k.amount
    : (k.lines || []).reduce((sum, l) => sum + Math.abs(Number(l.qty) || 0) * 100 * (Number(rec.lines.find(x => x.id === l.id)?.price) || Number(items.get(l.id)?.price) || 0), 0);
  function historyOf(rec) {
    const by = name => (name ? `by ${initialsOf(name)}` : '');
    const known = new Map();
    for (const e of [...cleanEvents(rec.events), ...cleanEvents(order.events)]) known.set(e.id || `${e.kind}@${e.at}`, e);
    const list = [...known.values()].map(e => ({ ...e }));
    // (an order saved before Update Pack 3: opened when it was first saved, by whoever sent its first KOT)
    if (!list.some(e => e.kind === 'open')) list.push({ kind: 'open', at: createdOf(rec), by: kotsOf(rec)[0]?.by || rec.server || '', type: rec.type, table: usesTable(rec) ? rec.table : '', guests: rec.guests || 0, customer: rec.customer?.name || '' });
    for (const k of Array.isArray(rec.kots) ? rec.kots : []) {
      const kind = k && (k.kind || 'kot');
      if (kind === 'kot' || kind === 'void' || kind === 'changed') list.push({ ...k, kind: `slip-${kind}` });
      else if (kind === 'priority' && !Array.isArray(rec.events)) list.push({ kind: 'priority', at: k.at, by: k.by });
    }
    (Array.isArray(rec.bills) ? rec.bills : []).forEach((b, i) => list.push({ kind: i ? 'reprint' : 'bill', at: b.at, by: b.by, total: b.total }));
    list.forEach((e, i) => { e.seq = i; });
    list.sort((a, b) => (b.kind === 'open') - (a.kind === 'open') || (Number(a.at) || 0) - (Number(b.at) || 0) || a.seq - b.seq);
    const q = e => (e.qty > 1 ? `${e.qty} × ` : '');
    const rows = list.map(e => {
      switch (e.kind) {
        case 'open': return { e, icon: typeIcon[e.type] || typeIcon['dine-in'], title: 'Order opened',
          sub: [e.table ? `Table ${tableName(e.table)}` : e.customer || typeLabel[e.type] || '', e.guests ? plural(e.guests, 'guest') : '', by(e.by)] };
        case 'slip-kot': return { e, icon: 'receipt_long', cls: 'kt', title: e.no ? `KOT #${e.no} sent` : 'KOT sent',
          sub: [dishCount((e.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0)), e.from ? `from Order ${ticket(e.from)}` : '', by(e.by)] };
        case 'slip-changed': { const l = (e.lines || [])[0] || {}, more = (e.lines || []).length - 1;
          return { e, icon: 'receipt_long', cls: 'kt', title: `Changed · ${l.qty || 1} × ${l.name || ''}${more > 0 ? ` +${more}` : ''}`, sub: [changesOf(l).join(', '), by(e.by), 'CHANGED slip printed'] }; }
        case 'slip-void': { const ls = e.lines || [], n = ls.reduce((s2, l) => s2 + Math.abs(Number(l.qty) || 0), 0), names = [...new Set(ls.map(l => l.name))].join(', ');
          return { e, icon: 'void_x', title: `Void · ${n} × ${names}`, sub: [e.reason ? `Reason: ${e.reason}` : '', by(e.by), 'VOID slip printed'], amount: voidAmount(rec, e), isVoid: true }; }
        case 'bill': return { e, icon: 'print', title: 'Bill printed', sub: [Number.isFinite(e.total) ? amount(e.total) : '', by(e.by)] };
        case 'reprint': return { e, icon: 'print', title: 'Bill reprinted', sub: [Number.isFinite(e.total) ? amount(e.total) : '', by(e.by)] };
        case 'disc': return { e, icon: 'percent', title: `Discount ${e.pct}% on order`, sub: [e.reason ? `Reason: ${e.reason}` : '', e.was ? `was ${e.was}%` : '', by(e.by)], amount: e.amount };
        case 'disc-off': return { e, icon: 'remove_discount', title: 'Discount removed', sub: [e.was ? `was ${e.was}%` : '', by(e.by)] };
        case 'dish': return { e, icon: 'sell', title: e.pct === 100 ? `Complimentary · ${q(e)}${e.name}` : `Dish discount ${e.pct}% · ${q(e)}${e.name}`,
          sub: [e.reason ? `Reason: ${e.reason}` : '', e.was ? `was ${e.was}%` : '', by(e.by)], amount: e.amount };
        case 'dish-off': return { e, icon: 'remove_discount', title: `Dish discount removed · ${q(e)}${e.name}`, sub: [e.was ? `was ${e.was}%` : '', by(e.by)] };
        case 'svc': return { e, icon: 'room_service', title: `Service charge ${e.pct}% on order`, sub: [e.was ? `was ${e.was}%` : '', by(e.by)] };
        case 'svc-off': return { e, icon: 'room_service', title: 'Service charge removed', sub: [e.was ? `was ${e.was}%` : '', by(e.by)] };
        case 'move': return { e, icon: 'move_table', title: 'Moved table', sub: [`Table ${tableName(e.from)} → Table ${tableName(e.to)}`, by(e.by)] };
        case 'merge': return { e, icon: 'merge', title: 'Merged tables', sub: [`Table ${tableName(e.from)}${e.to ? ` → Table ${tableName(e.to)}` : ''}`, e.number ? `Order ${ticket(e.number)}` : '', by(e.by)] };
        case 'server': return { e, icon: 'badge', title: 'Server changed', sub: [`${initialsOf(e.from) || '—'} → ${initialsOf(e.to)}`, by(e.by)] };
        case 'priority': return { e, icon: 'flag', title: 'Marked as priority', sub: ['Kitchen only', by(e.by)] };
        case 'priority-off': return { e, icon: 'flag', title: 'Priority removed', sub: ['Kitchen only', by(e.by)] };
        default: return null;
      }
    }).filter(Boolean);
    // after the bill: amber, tagged
    const billAt = rows.findIndex(r => r.e.kind === 'bill');
    let voided = false;
    rows.forEach((r, i) => {
      if (billAt < 0 || i <= billAt) return;
      r.after = r.e.kind === 'reprint' && voided ? 'After void' : 'After bill';
      if (r.e.kind === 'reprint') voided = false; else if (r.isVoid) voided = true;
    });
    return rows;
  }
  function historyLayer(hold) {
    const rec = savedOf(loadOrders());
    if (!rec) { queueMicrotask(closeHistory); return null; }
    const rows = historyOf(rec), t = totals(), off = t.dishDiscount + t.discount, voids = rows.filter(r => r.isVoid).reduce((n, r) => n + (r.amount || 0), 0), changes = rows.filter(r => r.after).length;
    const opened = rows.find(r => r.e.kind === 'open')?.e;
    const title = `Track history · Order ${ticket(order.number)}`;
    const sub = [typeLabel[order.type || DEFAULT_TYPE], usesTable(order) ? `Table ${tableName(order.table)}` : order.customer?.name || '', order.guests ? plural(order.guests, 'guest') : '',
      opened ? `opened ${clockOf(opened.at)}${opened.by ? ` by ${initialsOf(opened.by)}` : ''}` : ''].filter(Boolean).join(' · ');
    const minus = n => (n > 0 ? `−${amount(n)}` : amount(0));
    const list = el('ul', { class: 'cx-hl', 'aria-label': 'What happened, oldest first' }, ...rows.map(r => el('li', { class: [r.after ? 'am' : r.cls || ''].join(' ').trim() },
      el('div', { class: 'tm' }, clockOf(r.e.at)),
      el('div', { class: 'ic', 'aria-hidden': 'true' }, mi(r.icon, 21)),
      el('div', { class: 'tx' }, el('b', {}, r.title), r.after ? el('span', { class: 'tag' }, r.after) : null, el('br'), r.sub.filter(Boolean).join(' · ')),
      el('div', { class: 'amt' }, r.amount > 0 ? `−${amount(r.amount)}` : ''))));
    const fade = () => { historyTop = list.scrollTop; list.classList.toggle('more', list.scrollTop + list.clientHeight < list.scrollHeight - 2); };
    list.addEventListener('scroll', fade, { passive: true });
    requestAnimationFrame(() => { list.scrollTop = historyTop; fade(); });
    return el('div', { class: 'cx-layer history' },
      el('div', { class: 'cx-hscrim', onpointerdown: hold, onmousedown: hold, onclick: closeHistory }),
      el('div', { class: 'cx-hp', role: 'dialog', 'aria-label': title },
        el('div', { class: 'cx-hp-head' }, el('div', { class: 'cx-hp-t' }, el('h3', {}, title), el('div', { class: 'cx-hp-sub' }, sub)), closeX(closeHistory, hold)),
        list,
        el('div', { class: 'cx-hsum' },
          el('div', { class: 'c' }, 'Discounts', el('b', {}, minus(off))),
          el('div', { class: 'c' }, 'Voids', el('b', {}, minus(voids))),
          changes ? el('div', { class: 'c a' }, `${changes} change${changes === 1 ? '' : 's'} after the bill`) : null)));
  }
  // Pager still out with another order (Update Pack 3): "Pager 5 is still with #1012" · "<customer> · Paid · Ready", then
  // Same customer / Handed back. The other order's payment in Orders' words and colours (Update Pack 5, owner 12 Nov
  // 2026): Due orange, Part paid red, Paid black (Midnight: its orange, red and white).
  function pagerAskCard(hold) {
    const { n, tapped } = pagerAsk, others = pagerOthers(n), first = others[0], nums = others.map(o => ticket(o.number));
    const title = `Pager ${n} is still with ${nums.length > 2 ? `${nums[0]} and ${nums.length - 1} more` : nums.join(' and ')}`;
    const who = o => o.customer?.name || (usesTable(o) ? `Table ${tableName(o.table)}` : typeLabel[o.type] || '');
    const kitchen = o => o.kitchenDoneAt ? 'Ready' : o.sentAt ? 'In kitchen' : cleanTime(o.readyAt) ? `Scheduled ${timeOf(o.readyAt).toUpperCase()}` : '';
    const pay = o => (o.paidAt ? el('span', { class: 'cx-payw' }, 'Paid') : partPaid(o) ? el('span', { class: 'cx-payw part' }, 'Part paid') : el('span', { class: 'cx-payw due' }, 'Due'));
    const sub = (!first ? [] : others.length === 1 ? [who(first), pay(first), kitchen(first)] : [who(first), `${others.length} orders`]).filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]));
    const tile = (icon, name, what, shared) => el('button', { type: 'button', class: 'cx-pk', onpointerdown: hold, onmousedown: hold, onclick: () => givePager(n, shared, tapped) },
      el('span', { class: 'cx-av', 'aria-hidden': 'true' }, mi(icon, 20)), el('b', {}, name), el('small', {}, what));
    return el('div', { class: 'cx-pu server pagerask', role: 'dialog', 'aria-label': title },
      el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-dh pg' }, el('i', { 'aria-hidden': 'true' }, mi('vibration', 22)), el('div', { class: 'cx-steph' }, el('b', {}, title), el('span', {}, ...sub))),
        closeX(cancelPagerAsk, hold)),
      el('div', { class: 'cx-pkl' },
        tile('person', 'Same customer', others.length > 1 ? 'All keep it' : 'Both keep it', true),
        tile('move_table', 'Handed back', 'Moves to this order', false)));
  }
  // Change server: the restaurant's staff (Staff app), the one serving it light blue
  function serverCard(hold) {
    const current = order.serverId || (order.server ? null : window.RestroStaff?.current?.id), people = window.RestroStaff?.list() || [];
    return el('div', { class: 'cx-pu server', role: 'dialog', 'aria-label': 'Change server' },
      el('div', { class: 'cx-pu-head' }, el('div', { class: 'cx-dh' }, el('i', { 'aria-hidden': 'true' }, mi('badge', 22)), el('b', {}, 'Change server')), closeX(() => { sheet = null; serverPop = null; render(); }, hold)),
      el('div', { class: 'cx-pkl', role: 'radiogroup', 'aria-label': 'Staff' }, ...people.map(person => {
        const on = current ? person.id === current : person.name === order.server;
        return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `cx-pk${on ? ' on' : ''}`, onclick: () => pickServer(person) },
          el('span', { class: 'cx-av', 'aria-hidden': 'true' }, initialsOf(person.name)), el('b', {}, person.name), el('small', {}, window.RestroStaff.roles?.find?.(r => r.id === person.role)?.name || ''));
      })));
  }
  // A line typed on (Update 5): the note (the note pop-up, a custom item's) and a custom item's name. With nothing on it
  // its grey hint shows ("Type special instructions here"), after the cursor while it has the keyboard. The cursor is
  // our own: 2.4 wide, blue, blinking (on 530 ms, off 530 ms) where the typing goes (the tablet's own is thinner). The
  // line under it (counter.css) is soft red while empty (only a hint: nothing needs a note), grey with words on it, and
  // blue while it has the keyboard.
  let caretOf = null; // the cursor of the line that has the keyboard
  document.addEventListener('selectionchange', () => caretOf?.());
  // (idle: the cursor also shows at the end of the words while the field isn't being typed in: the void pop-up's reason)
  function textField({ id, value, hint, max, label, idle = false }) {
    const input = el('input', { id, type: 'text', maxlength: String(max), autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', 'aria-label': label });
    input.value = value;
    const cur = el('i', { class: 'cx-cur', 'aria-hidden': 'true', hidden: true }), ruler = el('span', { class: 'cx-ruler', 'aria-hidden': 'true' });
    const box = el('span', { class: `cx-tf${value ? '' : ' empty'}` }, input, el('span', { class: 'cx-hint', 'aria-hidden': 'true' }, hint), cur, ruler);
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!input.isConnected) return;
        const on = document.activeElement === input, rest = !on && idle && Boolean(input.value);
        const a = rest ? input.value.length : input.selectionStart ?? input.value.length, b = rest ? a : input.selectionEnd ?? a;
        box.classList.toggle('empty', !input.value); box.classList.toggle('on', on);
        cur.hidden = !(on || rest) || a !== b; if (cur.hidden) return;
        ruler.textContent = input.value.slice(0, a);
        cur.style.setProperty('--x', `${Math.min(input.clientWidth, Math.max(0, ruler.offsetWidth - input.scrollLeft))}px`);
      });
    };
    const restart = () => cur.getAnimations?.().forEach(a => { a.currentTime = 0; }); // (it shows while typing goes on)
    input.addEventListener('input', () => { place(); restart(); });
    input.addEventListener('keydown', () => { place(); restart(); });
    for (const type of ['keyup', 'pointerup', 'select', 'scroll']) input.addEventListener(type, place);
    input.addEventListener('focus', () => { caretOf = place; place(); restart(); });
    input.addEventListener('blur', () => { if (caretOf === place) caretOf = null; place(); });
    return { box, input, place };
  }
  // The pin before a pinned quick note (as drawn: an 18 square showing the pin's head and the top of its point)
  function pinIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 18 18'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'cx-i cx-pin');
    s.innerHTML = '<path d="m16 12 2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V5H7V3h10v2h-1Z"/>'; return s;
  }
  // Note: the note line (tap it to type: the keyboard comes up, the pop-up moves up above it and the quick notes become
  // one row that scrolls) · "Quick notes": "+ Add" (Update 5: blue while the note has words that aren't a quick note yet,
  // grey otherwise; a tap keeps them as quick notes of the dish) and 14 notes (light blue while their words are in the
  // note; a tap adds them, or takes them out; pinned ones with a pin, new ones with NEW) · Clear note ........ Done.
  // (A custom item has no + Add: it isn't a dish of the menu.)
  function noteCard(ctx, head, done, hold) {
    const p = notePop, notes = quickNotesFor(ctx.quickId), adds = ctx.adds, shown = notes.slice(0, adds ? 14 : 15), line = { id: ctx.quickId }, item = { name: ctx.name };
    const known = new Set(notes.map(n => n.text.toLowerCase()));
    const fresh = () => noteParts(p.draft).filter(s => !known.has(s.toLowerCase()));
    const tf = textField({ id: 'counter-note', value: p.draft, hint: NOTE_HINT, max: 200, label: `Note for ${item.name}` }), field = tf.input;
    const noteLine = el('span', { class: 'cx-nf-line' }, mi('edit', 22), tf.box);
    const addBtn = adds ? el('button', { type: 'button', class: 'cx-qn-chip add', onpointerdown: hold, onmousedown: hold, onclick: () => {
      const parts = fresh(); if (!parts.length) return;
      keepQuick(line.id, [...new Map(parts.map(s => [s.toLowerCase(), s])).values()]);
      field.blur(); p.typing = false; render(); // (the note is done being typed: the keyboard goes down)
    } }, mi('add', 22), el('span', {}, 'Add')) : null;
    const chipEls = shown.map(n => el('button', { type: 'button', class: `cx-qn-chip${n.isNew ? ' new' : ''}`, onpointerdown: hold, onmousedown: hold, onclick: () => { p.draft = toggleQuick(p.draft, n.text); field.value = p.draft; sync(); tf.place(); } },
      n.pinned ? pinIcon() : null, el('span', { class: 'cx-qn-t' }, n.text), n.isNew ? el('b', { class: 'cx-new' }, 'NEW') : null));
    const sync = () => {
      chipEls.forEach((b, i) => { const on = hasQuick(p.draft, shown[i].text); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      if (addBtn) { const off = !fresh().length; addBtn.classList.toggle('off', off); addBtn.setAttribute('aria-disabled', String(off)); addBtn.setAttribute('aria-label', off ? 'Add a quick note: type it in the note first' : 'Add what is typed as a quick note'); }
      noteLine.classList.toggle('empty', !p.draft);
    };
    sync();
    const card = el('div', { class: `cx-pu note${p.typing ? ' typing' : ''}`, role: 'dialog', 'aria-label': `Note for ${item.name}` },
      head,
      el('label', { class: 'cx-nf' }, el('span', { class: 'cx-nf-label' }, 'Note'), noteLine),
      el('div', { class: 'cx-nf-q', id: 'counter-quick' }, 'Quick notes'),
      el('div', { class: 'cx-qn', role: 'group', 'aria-labelledby': 'counter-quick' }, addBtn, ...chipEls),
      el('div', { class: 'cx-nf-foot' },
        el('button', { type: 'button', class: 'cx-clear', onpointerdown: hold, onmousedown: hold, onclick: () => { p.draft = ''; field.value = ''; sync(); tf.place(); } }, 'Clear note'),
        done(doneNote)));
    field.addEventListener('input', () => { p.draft = field.value; sync(); });
    field.addEventListener('focus', () => { if (notePop !== p) return; p.typing = true; card.classList.add('typing'); noteLine.classList.add('on'); });
    field.addEventListener('blur', () => { if (notePop !== p || !field.isConnected) return; p.typing = false; card.classList.remove('typing'); noteLine.classList.remove('on'); });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doneNote(); } });
    if (p.typing) noteLine.classList.add('on');
    return card;
  }
  // The note typed in the modifier pop-up itself (Update 6), from its Note line: the keyboard comes up and the pop-up
  // moves up above it: ‹ · the dish · ✕ · the choices made, as pills (spice level amber, the others white) · the note
  // line (blue, its cursor blinking, while it has the keyboard) · the dish's quick notes in one row that scrolls (+ Add
  // first, then the pinned ones) · Set note. ‹ and Set note keep the note and go back to the choices; ✕ closes the
  // pop-up with nothing changed in it (the choices and the note as they were). Add / Edit note on an order line still
  // opens the note pop-up.
  function openModsNote() { const line = modLine(); if (!line) return; modPop.note = { draft: line.note || '' }; render(); dialog.querySelector('#counter-note')?.focus(); }
  function setModsNote() {
    const p = modPop?.note; if (!p) return;
    const line = modLine(); if (line) line.note = cleanNote(p.draft);
    dialog.querySelector('#counter-note')?.blur();
    modPop.note = null; render();
  }
  function modsNoteCard(line, item, dish, hold) {
    const p = modPop.note, notes = quickNotesFor(line.id), adds = !line.custom, shown = notes.slice(0, adds ? 14 : 15);
    const known = new Set(notes.map(n => n.text.toLowerCase()));
    const fresh = () => noteParts(p.draft).filter(s => !known.has(s.toLowerCase()));
    const tf = textField({ id: 'counter-note', value: p.draft, hint: NOTE_HINT, max: 200, label: `Note for ${item.name}` }), field = tf.input;
    const noteLine = el('span', { class: 'cx-nf-line' }, mi('edit', 22), tf.box);
    const addBtn = adds ? el('button', { type: 'button', class: 'cx-qn-chip add', onpointerdown: hold, onmousedown: hold, onclick: () => {
      const parts = fresh(); if (!parts.length) return;
      keepQuick(line.id, [...new Map(parts.map(s => [s.toLowerCase(), s])).values()]);
      field.blur(); render();
    } }, mi('add', 22), el('span', {}, 'Add')) : null;
    const chipEls = shown.map(n => el('button', { type: 'button', class: `cx-qn-chip${n.isNew ? ' new' : ''}`, onpointerdown: hold, onmousedown: hold, onclick: () => { p.draft = toggleQuick(p.draft, n.text); field.value = p.draft; sync(); tf.place(); } },
      n.pinned ? pinIcon() : null, el('span', { class: 'cx-qn-t' }, n.text), n.isNew ? el('b', { class: 'cx-new' }, 'NEW') : null));
    const sync = () => {
      chipEls.forEach((b, i) => { const on = hasQuick(p.draft, shown[i].text); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      if (addBtn) { const off = !fresh().length; addBtn.classList.toggle('off', off); addBtn.setAttribute('aria-disabled', String(off)); addBtn.setAttribute('aria-label', off ? 'Add a quick note: type it in the note first' : 'Add what is typed as a quick note'); }
      noteLine.classList.toggle('empty', !p.draft);
    };
    sync();
    const card = el('div', { class: 'cx-pu mods noting', role: 'dialog', 'aria-label': `Note for ${item.name}` },
      el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-pu-lead' }, el('button', { type: 'button', class: 'cx-x', 'aria-label': 'Back to the choices, keeping the note', title: 'Back', onpointerdown: hold, onmousedown: hold, onclick: setModsNote }, mi('arrow_back_ios_new', 22)), dish),
        closeX(cancelMods, hold)),
      line.mods.length ? el('div', { class: 'cx-mpills' }, ...line.mods.map(m => el('span', { class: optionOf.get(m)?.kind === 'spice' ? 'sp' : null }, modLabel(m)))) : null,
      el('label', { class: 'cx-nf' }, el('span', { class: 'cx-nf-label' }, 'Note'), noteLine),
      el('div', { class: 'cx-nf-q', id: 'counter-quick' }, 'Quick notes'),
      el('div', { class: 'cx-qn row', role: 'group', 'aria-labelledby': 'counter-quick' }, addBtn, ...chipEls),
      el('button', { type: 'button', class: 'cx-done wide', onpointerdown: hold, onmousedown: hold, onclick: setModsNote }, 'Set note'));
    field.addEventListener('input', () => { p.draft = field.value; sync(); });
    field.addEventListener('focus', () => noteLine.classList.add('on'));
    field.addEventListener('blur', () => noteLine.classList.remove('on'));
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setModsNote(); } });
    return card;
  }
  // A custom item: the + in a white circle, "Add custom item" 24/800, the category's badge, ✕ · Item name · optional
  // (a line typed on) · Veg / Non-veg · optional (two raised buttons, the one chosen light blue; a second tap takes it
  // off) beside Price (each) · required (a raised field: ₹ and the price, "Enter price" in grey until there is one; blue
  // edged while our number pad is open) · the note (a line typed on, under a pen) beside − 1 + · the number pad, while
  // the price is being typed · the button: Set item name / Set price / Set note while one of them is typed in, else Done.
  // It is drawn once as it opens and then changes in place, so typing is never interrupted.
  let paintCustom = null;
  function customCard(hold) {
    const p = customPop, c = categoryById.get(p.cat);
    const press = fn => ({ type: 'button', onpointerdown: hold, onmousedown: hold, onclick: fn });
    const name = textField({ id: 'counter-custom-name', value: p.name, hint: 'Custom item', max: 60, label: 'Item name, optional' });
    const note = textField({ id: 'counter-custom-note', value: p.note, hint: NOTE_HINT, max: 200, label: 'Note, optional' });
    // (Update 7: a ✕ in the name and the note while they have words clears them in one tap)
    const clearer = (tf, field) => el('button', { ...press(() => { p[field] = ''; tf.input.value = ''; paint(); if (p.field === field) tf.input.focus(); }), class: 'cx-fclr', 'aria-label': field === 'name' ? 'Clear the item name' : 'Clear the note', hidden: !p[field] }, mi('close', 16));
    const nameClr = clearer(name, 'name'), noteClr = clearer(note, 'note');
    const nameLine = el('span', { class: 'cx-nf-line' }, name.box, nameClr);
    const noteLine = el('span', { class: 'cx-nl-line' }, mi('edit', 20), note.box, noteClr);
    const veg = el('button', { ...press(() => { p.veg = p.veg === true ? null : true; paint(); }), class: 'cx-vn veg' }, el('em', { 'aria-hidden': 'true' }), 'Veg');
    const non = el('button', { ...press(() => { p.veg = p.veg === false ? null : false; paint(); }), class: 'cx-vn non' }, el('em', { 'aria-hidden': 'true' }), 'Non-veg');
    const priceText = el('span', { class: 'cx-pf-v' }), priceCur = el('i', { class: 'cx-cur', 'aria-hidden': 'true' });
    const price = el('button', { ...press(() => customField('price')), class: 'cx-pf', 'aria-label': 'Price each, needed' }, el('span', { class: 'cx-pf-r', 'aria-hidden': 'true' }, '₹'), priceText, priceCur);
    const qty = el('output', { 'aria-live': 'polite' });
    const pad = numberKeys(pressPrice, ' cx-pp');
    const button = el('button', { ...press(customDone), class: 'cx-done wide' });
    const card = el('div', { class: 'cx-pu custom', role: 'dialog', 'aria-label': `Add a custom item to ${c.name}` },
      el('div', { class: 'cx-pu-head' },
        el('div', { class: 'cx-cu-title' }, el('i', { 'aria-hidden': 'true' }, mi('add', 24)), el('b', {}, 'Add custom item'), el('span', { class: 'cx-badge opt' }, c.name)),
        closeX(closeCustom, hold)),
      el('label', { class: 'cx-nf' }, el('span', { class: 'cx-nf-label' }, 'Item name · optional'), nameLine),
      el('div', { class: 'cx-cu-grid' },
        el('div', { role: 'group', 'aria-label': 'Veg or non-veg, optional' }, el('span', { class: 'cx-lab3', 'aria-hidden': 'true' }, 'Veg / Non-veg · optional'), el('div', { class: 'cx-vn-row' }, veg, non)),
        el('div', {}, el('span', { class: 'cx-lab3', 'aria-hidden': 'true' }, 'Price (each) · required'), price)),
      el('div', { class: 'cx-cu-foot' },
        el('label', { class: 'cx-nl' }, el('span', { class: 'cx-nl-label' }, 'Note'), noteLine),
        el('div', { class: 'cx-rs' },
          el('button', { ...press(() => { p.qty = Math.max(1, p.qty - 1); paint(); }), class: 'cx-rb', 'aria-label': 'One less' }, mi('remove', 26)),
          qty,
          el('button', { ...press(() => { p.qty = Math.min(999, p.qty + 1); paint(); }), class: 'cx-rb', 'aria-label': 'One more' }, mi('add', 26)))),
      pad, button);
    // The name and the note take the keyboard when tapped; Enter, or the keyboard put away, sets them.
    for (const [tf, line, field] of [[name, nameLine, 'name'], [note, noteLine, 'note']]) {
      tf.input.addEventListener('input', () => { p[field] = tf.input.value; line.classList.toggle('empty', !tf.input.value); (field === 'name' ? nameClr : noteClr).hidden = !tf.input.value; });
      tf.input.addEventListener('focus', () => { if (customPop !== p || p.field === field) return; p.field = field; paint(); });
      tf.input.addEventListener('blur', () => { if (customPop === p && p.field === field && tf.input.isConnected) customSet(); });
      tf.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); customSet(); } });
    }
    function paint() {
      const typing = p.field === 'name' || p.field === 'note';
      card.classList.toggle('typing', typing); card.classList.toggle('pad', p.field === 'price');
      for (const [tf, line, field, text] of [[name, nameLine, 'name', p.name], [note, noteLine, 'note', p.note]]) {
        if (document.activeElement !== tf.input && tf.input.value !== text) tf.input.value = text;
        line.classList.toggle('empty', !text); line.classList.toggle('on', p.field === field); tf.place();
      }
      nameClr.hidden = !p.name; noteClr.hidden = !p.note;
      veg.classList.toggle('on', p.veg === true); veg.setAttribute('aria-pressed', String(p.veg === true));
      non.classList.toggle('on', p.veg === false); non.setAttribute('aria-pressed', String(p.veg === false));
      const typed = p.price !== '';
      price.classList.toggle('focus', p.field === 'price'); price.classList.toggle('empty', !typed);
      priceText.textContent = typed ? Number(p.price).toLocaleString('en-IN') : 'Enter price';
      price.setAttribute('aria-label', typed ? `Price each ₹${priceText.textContent}` : 'Price each, needed');
      priceCur.hidden = p.field !== 'price';
      if (!priceCur.hidden) priceCur.getAnimations?.().forEach(a => { a.currentTime = 0; });
      pad.hidden = p.field !== 'price';
      qty.textContent = String(p.qty);
      button.textContent = { name: 'Set item name', price: 'Set price', note: 'Set note' }[p.field] || 'Done';
    }
    paintCustom = paint;
    paint();
    return card;
  }
  // The modifier pop-up: its top 206 down the menu (over its Desserts / Beverages row) while it fits there with 24 to
  // spare at the bottom; a taller one is centred on the menu. At most 775 tall (the groups then scroll, the dish and the
  // bottom row stay).
  function placePop() {
    const pu = dialog.querySelector('.cx-pu.mods:not(.noting)'), panel = dialog.querySelector('.cx-order'); if (!pu || !panel) return;
    const u = panel.offsetWidth / 532, room = pu.parentElement.clientHeight, h = pu.offsetHeight;
    pu.style.top = `${166 * u + h + 20 * u <= room ? 166 * u : Math.max(0, (room - h) / 2)}px`;
  }
  // (A pop-up whose line is gone closes. A line is "edit" only while its modifier pop-up is open, the note pop-up opened
  // from it included.)
  function syncPops() {
    if (modPop && !(sheet === 'mods' || (sheet === 'note' && notePop?.back))) modPop = null;
    if (modPop && !modLine()) { modPop = null; if (sheet === 'mods') sheet = null; }
    if (!modPop) order.lines.filter(l => l.edit).forEach(settle);
    if (sheet === 'qty' && !(qtyPop && lineOf(qtyPop.key))) { sheet = null; qtyPop = null; }
    if (sheet === 'note' && !(notePop && (notePop.key === null || lineOf(notePop.key)))) { sheet = null; notePop = null; }
    if (sheet === 'custom' && !customPop) sheet = null;
    if (sheet === 'discount' && !discPop) sheet = null;
    if (sheet === 'service' && !servicePop) sheet = null;
    if (sheet === 'dish' && !(dishPop && (dishPop.step === 1 || dishPop.picked.some(lineOf)))) { sheet = null; dishPop = null; }
    if (sheet === 'void' && !(voidPop && (voidPop.key == null || lineOf(voidPop.key)))) { sheet = null; voidPop = null; }
    if (sheet === 'server' && !serverPop) sheet = null;
    if (sheet !== 'discount') discPop = null;
    if (sheet !== 'service') servicePop = null;
    if (sheet !== 'dish') dishPop = null;
    if (sheet !== 'void') voidPop = null;
    if (sheet !== 'server') serverPop = null;
    if (sheet !== 'qty') qtyPop = null;
    if (sheet !== 'note') notePop = null;
    if (sheet !== 'custom') { customPop = null; paintCustom = null; }
  }

  function sheetView() {
    if (!sheet) return null;
    const t = totals();
    const close = el('button', { type: 'button', class: 'ctr-icon-button', 'aria-label': 'Close', onclick: () => { sheet = null; render(); } }, svg(ICON.close));
    let body;
    // The pop-ups over the menu (Counter Update 4): modifiers, quantity, note; a custom item (Update 5)
    if ((sheet === 'mods' && modPop) || (sheet === 'qty' && qtyPop) || (sheet === 'note' && notePop) || (sheet === 'custom' && customPop) || (sheet === 'discount' && discPop)
      || (sheet === 'service' && servicePop) || (sheet === 'dish' && dishPop) || (sheet === 'void' && voidPop) || (sheet === 'server' && serverPop) || (sheet === 'pagerask' && pagerAsk) || sheet === 'history'
      || (sheet === 'schedule' && scheduleDraft)) return popView();

    if (sheet === 'pay') {
      const options = cashOptions(t.total);
      const change = el('output', { class: 'ctr-change' }, '');
      const completeBtn = el('button', { type: 'button', class: 'primary-button ctr-complete', disabled: true }, 'Complete payment');
      const input = el('input', { id: 'counter-received', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: (t.total / 100).toString(), value: cashInput });
      const update = () => {
        cashInput = input.value;
        const received = Math.round(parseFloat(input.value.replace(/[^\d.]/g, '')) * 100) || 0;
        const ok = received >= t.total;
        change.textContent = !input.value ? 'Enter the cash received' : ok ? `Change to give: ${money(received - t.total)}` : `Short by ${money(t.total - received)}`;
        change.classList.toggle('short', !!input.value && !ok);
        completeBtn.disabled = !ok; completeBtn.onclick = () => complete(received);
      };
      input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.]/g, ''); update(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !completeBtn.disabled) completeBtn.click(); });
      body = el('div', { class: 'ctr-sheet-body' },
        el('p', { class: 'ctr-sheet-total' }, el('span', {}, 'Total to pay'), el('strong', {}, money(t.total))),
        el('div', { class: 'ctr-methods', role: 'tablist' },
          el('button', { type: 'button', role: 'tab', 'aria-selected': 'true', class: 'on' }, 'Cash'),
          el('button', { type: 'button', role: 'tab', disabled: true, title: 'Available once a payment provider is connected' }, 'UPI'),
          el('button', { type: 'button', role: 'tab', disabled: true, title: 'Available once a payment provider is connected' }, 'Card')),
        el('p', { class: 'ctr-note' }, 'UPI and card payments will be available once a payment provider is connected.'),
        el('label', { class: 'ctr-field', for: 'counter-received' }, 'Cash received'),
        el('div', { class: 'ctr-received' }, el('span', { 'aria-hidden': 'true' }, '₹'), input),
        el('div', { class: 'ctr-fast-row' }, ...options.map(v => el('button', { type: 'button', class: 'ctr-chip', onclick: () => { input.value = String(v / 100); update(); } }, money(v).replace('.00', '')))),
        change, completeBtn);
      setTimeout(() => { input.focus(); update(); });
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet', role: 'dialog', 'aria-label': 'Take payment' }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Take payment'), close), body));
    }
    // Held: only tickets put on Hold (newest first). They are cleared at the end of the day.
    if (sheet === 'held') {
      const list = el('ul', { class: 'ctr-held' });
      if (!held.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No held orders'), el('span', {}, 'Orders on hold stay here until the end of the day.')));
      for (const h of held.filter(h => Array.isArray(h.lines))) {
        const count = h.lines.reduce((n, l) => n + l.qty, 0), what = [h.number ? ticket(h.number) : '', describe(h)].filter(Boolean).join(' · ');
        list.append(el('li', {},
          el('div', { class: 'ctr-held-copy' }, el('strong', {}, what || 'Order'), el('span', {}, `${count} item${count === 1 ? '' : 's'} · ${money(h.total)} · held ${timeOf(h.savedAt)}`)),
          el('button', { type: 'button', class: 'ctr-text-button danger', 'aria-label': 'Delete held order', onclick: () => removeHeld(h.heldId) }, svg(ICON.trash)),
          el('button', { type: 'button', class: 'primary-button ctr-resume', onclick: () => resume(h.heldId) }, 'Resume')));
      }
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet', role: 'dialog', 'aria-label': 'Held orders' }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Held orders'), close), list));
    }
    // Assign Pager: the pagers by number; a pager on another open order shows "In use" (it can still be chosen: Update
    // Pack 3 asks first whether the customer kept it or handed it back). A held order's pager was released when it was
    // held (a saved order's held copy has the saved order's).
    if (sheet === 'pager') {
      // (a pager is in use while another order has it, until the pager is docked back, whether that order is open or
      // closed; a saved order's held copy has the saved order's)
      const inUse = new Set([...held.filter(h => h.number).map(h => cleanPager(h.pager)), ...[...pagerHolders(loadOrders())].filter(([, os]) => os.some(o => !isMine(o))).map(([n]) => n)].filter(Boolean));
      const choose = n => choosePager(n);
      const grid = el('div', { class: 'ctr-pagers', role: 'radiogroup', 'aria-label': 'Pagers' },
        ...Array.from({ length: PAGERS }, (_, i) => i + 1).map(n => {
          const on = order.pager === n, busy = !on && inUse.has(n);
          return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `ctr-pager-key${on ? ' on' : ''}${busy ? ' busy' : ''}`, 'aria-label': `Pager ${n}${busy ? ', in use' : ''}`, onclick: () => choose(n) },
            el('strong', {}, String(n)), busy ? el('span', {}, 'In use') : null);
        }));
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet ctr-pager-sheet', role: 'dialog', 'aria-label': 'Assign pager' }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Assign pager'), close), grid,
          order.pager ? el('button', { type: 'button', class: 'ctr-secondary ctr-sheet-wide', onclick: () => choose(0) }, 'Remove pager') : null));
    }
    // Orders: every saved order, newest first, with its payment status (Paid or Due) and where it is with the kitchen.
    // Tap an order to see its items; an order not paid yet has Open, to add items or take the payment.
    // Payment history: each payment with how it was paid, and each day's total.
    if (sheet === 'orders' || sheet === 'payments') {
      const isOrders = sheet === 'orders', rows = isOrders ? allOrders() : paidOrders(), when = o => isOrders ? o.createdAt : Date.parse(o.paidAt), days = new Map();
      for (const o of rows) { const k = dayKey(when(o)), d = days.get(k) || { count: 0, total: 0 }; d.count += 1; d.total += o.total; days.set(k, d); }
      const list = el('ul', { class: 'ctr-history', 'aria-label': isOrders ? 'Orders' : 'Payments' });
      if (!rows.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, isOrders ? 'No orders yet' : 'No payments yet'), el('span', {}, isOrders ? 'Orders show here once they are saved or paid.' : 'Paid orders show here.')));
      const detail = o => el('div', { class: 'ctr-history-detail' },
        el('dl', { class: 'ctr-sums' },
          ...o.lines.flatMap(l => [el('dt', {}, `${l.qty} × ${l.name}`), el('dd', {}, rupees(l.price * l.qty))]),
          ...sumsOf(o).flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, value)]),
          el('dt', { class: 'ctr-total' }, 'Total'), el('dd', { class: 'ctr-total' }, money(o.total))),
        el('p', { class: 'ctr-history-pay' }, o.paidAt
          ? [`Paid ${timeOf(o.paidAt)}`, methodLabel[o.method] || 'Cash', Number.isFinite(o.received) ? `received ${money(o.received)}` : '', o.change > 0 ? `change ${money(o.change)}` : ''].filter(Boolean).join(' · ')
          : 'Due'));
      const toggle = (li, button, o) => {
        const open = li.classList.contains('open');
        list.querySelectorAll('.ctr-history-row.open').forEach(row => { row.classList.remove('open'); row.querySelector('.ctr-history-detail')?.remove(); row.querySelector('.ctr-history-main').setAttribute('aria-expanded', 'false'); });
        if (!open) { li.classList.add('open'); li.append(detail(o)); button.setAttribute('aria-expanded', 'true'); }
      };
      const kitchen = o => o.sentAt ? 'in kitchen' : o.readyAt ? `kitchen ${whenShort(kitchenTime(o))}` : '';
      const orderRow = o => {
        const li = el('li', { class: 'ctr-history-row' }), who = describe(o);
        const main = el('button', { type: 'button', class: 'ctr-history-main', 'aria-expanded': 'false', onclick: e => toggle(li, e.currentTarget, o) },
          el('span', { class: 'ctr-history-copy' },
            el('strong', {}, ticket(o.number), who ? el('span', { class: 'ctr-history-desc' }, ` · ${who}`) : null),
            el('span', {}, [timeOf(o.createdAt), o.readyAt ? `ready ${whenShort(o.readyAt)}` : '', kitchen(o), o.lines.map(l => `${l.name} ×${l.qty}`).join(', ')].filter(Boolean).join(' · '))),
          el('span', { class: 'ctr-history-side' }, el('strong', {}, money(o.total)), el('span', { class: o.paidAt ? 'ctr-paid' : partPaid(o) ? 'ctr-unpaid part' : 'ctr-unpaid' }, o.paidAt ? 'Paid' : partPaid(o) ? 'Part paid' : 'Due')));
        li.append(el('div', { class: 'ctr-history-line' }, main, o.paidAt ? el('span', { class: 'ctr-open-gap', 'aria-hidden': 'true' })
          : el('button', { type: 'button', class: 'primary-button ctr-open', 'aria-label': `Open order ${o.number}`, onclick: () => openOrder(idOf(o)) }, 'Open')));
        return li;
      };
      const paymentRow = o => el('li', { class: 'ctr-history-row' },
        el('div', { class: 'ctr-history-main' },
          el('span', { class: 'ctr-history-copy' },
            el('strong', {}, money(o.total), el('span', { class: 'ctr-history-desc' }, ` · ${methodLabel[o.method] || 'Cash'}`)),
            el('span', {}, [`Order ${ticket(o.number)}`, Number.isFinite(o.received) ? `Received ${money(o.received)}` : '', o.change > 0 ? `Change ${money(o.change)}` : ''].filter(Boolean).join(' · '))),
          el('span', { class: 'ctr-history-side' }, el('span', {}, timeOf(o.paidAt)))));
      let day = null;
      for (const o of rows) {
        const k = dayKey(when(o));
        if (k !== day) {
          day = k; const d = days.get(k);
          list.append(el('li', { class: 'ctr-history-day' }, el('span', {}, dayLabel(when(o))),
            el('span', {}, isOrders ? `${d.count} order${d.count === 1 ? '' : 's'}` : money(d.total))));
        }
        list.append(isOrders ? orderRow(o) : paymentRow(o));
      }
      const title = isOrders ? 'Orders' : 'Payment history';
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet ctr-history-sheet', role: 'dialog', 'aria-label': title }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, title), close), list));
    }
    if (sheet === 'receipt' && receipt) {
      return el('div', { class: 'ctr-sheet-wrap' },
        el('div', { class: 'ctr-sheet ctr-receipt', role: 'dialog', 'aria-label': 'Payment received' },
          el('span', { class: 'ctr-done-icon' }, svg(ICON.check)),
          el('h3', {}, 'Payment received'),
          el('p', { class: 'ctr-receipt-meta' }, [`Order ${ticket(receipt.number)}`, describe(receipt), 'Cash'].filter(Boolean).join(' · ')),
          el('dl', { class: 'ctr-sums' },
            el('dt', {}, 'Total'), el('dd', {}, money(receipt.total)),
            el('dt', {}, 'Cash received'), el('dd', {}, money(receipt.received)),
            el('dt', { class: 'ctr-total' }, 'Change to give'), el('dd', { class: 'ctr-total' }, money(receipt.change))),
          el('button', { type: 'button', class: 'primary-button ctr-complete', onclick: () => { sheet = null; receipt = null; render(); dialog.querySelector('#counter-search')?.focus(); } }, 'New order')));
    }
    return null;
  }

  function render() {
    if (drag) endDrag(true, false);
    if (panelDrag) endPanelDrag(true);
    syncPops();
    const focusId = document.activeElement?.id;
    // (a pop-up drawn again keeps where its groups, or its row of quick notes, were scrolled)
    const popScroll = [dialog.querySelector('.cx-pu-groups')?.scrollTop || 0, dialog.querySelector('.cx-qn')?.scrollLeft || 0, dialog.querySelector('.cx-pkl')?.scrollTop || 0];
    // The order type choices and the order menu dim the whole screen, the top banner too; what they show stays above the
    // dimming.
    root.replaceChildren(
      // (under a pop-up the order is seen as it is, but taps there are taps outside the pop-up, keys too)
      el('div', { class: `cx-shell${arranging ? ' arranging' : ''}`, 'data-style': menuStyle, inert: POPS.includes(sheet) }, orderPanel(), menuSide()),
      typeMenu || optionsMenu ? el('div', { class: 'cx-scrim', onclick: () => (typeMenu ? openTypeMenu(false) : openOptions(false)) }) : '',
      ...[sheetView()].flat().filter(Boolean));
    renderMenuBody();
    fitGst();
    paintMsg();
    const lines = dialog.querySelector('.cx-lines');
    if (lines && dialog.open) { lines.scrollTop = scrollMemo.lines; scrollMemo.lines = lines.scrollTop; }
    placePop();
    const groupsEl = dialog.querySelector('.cx-pu-groups'), quickEl = dialog.querySelector('.cx-qn');
    if (groupsEl) groupsEl.scrollTop = popScroll[0];
    if (quickEl) quickEl.scrollLeft = popScroll[1];
    const pickEl = dialog.querySelector('.cx-pkl'); if (pickEl) pickEl.scrollTop = popScroll[2];
    // Typing carries on where it was (search, a note, a reason, or a custom item's name or note while it is the one being
    // typed in)
    const typingOn = focusId === 'counter-search' || focusId === 'counter-note' || focusId === 'counter-reason' || focusId === 'counter-dish-reason' || (customPop && focusId === `counter-custom-${customPop.field}`);
    if (typingOn) { const f = dialog.querySelector(`#${focusId}`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
  }
  // Messages on the Counter go in its message bar (Update 7); with the Counter not on screen, the system's toast
  function toast(message) { if (dialog.open) { say(message); return; } if (typeof window.toast === 'function') window.toast(message); else document.querySelector('#toast') && (document.querySelector('#toast').textContent = message); }
  // GST on one line (Update 7): "GST 5% (CGST 2.5% ₹x + SGST 2.5% ₹x)"; when it doesn't fit (very large bills), without
  // the percentages in the brackets: "GST 5% (CGST ₹x + SGST ₹x)". Never on two lines.
  function fitGst() {
    const row = dialog.querySelector('.cx-tl.gst'), label = row?.querySelector('span'), inner = label?.querySelector('i'), value = row?.querySelector('b');
    if (!row || !inner) return;
    const room = row.clientWidth - value.offsetWidth - parseFloat(getComputedStyle(row).columnGap || 0);
    if (label.scrollWidth > room && inner.dataset.short) inner.textContent = inner.dataset.short;
  }

  function goBack() {
    if (!dialog.open) return false;
    if (typeMenu) { openTypeMenu(false); return true; }
    if (optionsMenu) { openOptions(false); return true; }
    // The pop-ups: the modifier one closes keeping its choices (or shows what is still needed), the quantity one closes
    // as it was, and the note one first puts the keyboard away, then is done.
    if (sheet === 'mods') { if (modPop?.note) setModsNote(); else closeMods(); return true; } // (the note typed in it: back to the choices)
    if (sheet === 'qty') { cancelQty(); return true; }
    if (sheet === 'discount') { cancelDiscount(); return true; }
    // (Update 7: the service charge, the dish discount (step 2 goes back to step 1) and a void close changing nothing;
    // a reason being typed puts the keyboard away first)
    if (sheet === 'service') { cancelService(); return true; }
    if (sheet === 'dish') { if (dishPop?.typing) dialog.querySelector('#counter-dish-reason')?.blur(); else if (dishPop?.step === 2) { dishPop.step = 1; render(); } else cancelDish(); return true; }
    if (sheet === 'void') { if (voidPop?.typing) dialog.querySelector('#counter-reason')?.blur(); else cancelVoid(); return true; }
    if (sheet === 'schedule') { if (scheduleDraft?.cal) { scheduleDraft.cal = null; render(); } else closeSchedule(); return true; }
    if (sheet === 'note') { if (notePop?.typing) dialog.querySelector('#counter-note')?.blur(); else doneNote(); return true; }
    // the custom item: what is being typed in is set first; then it closes, adding nothing (as ✕)
    if (sheet === 'custom') { if (customPop?.field) customSet(); else closeCustom(); return true; }
    if (sheet && sheet !== 'receipt') { sheet = null; render(); return true; }
    if (sheet === 'receipt') { sheet = null; receipt = null; render(); return true; }
    if (panelArranging) { setPanelArranging(false); return true; }
    if (arranging) { setArranging(false); return true; }
    if (selected) { selected = null; render(); return true; } // a selected line goes back to a plain one
    if (msg?.kind === 'error') { dropMsg(); return true; } // (an error message stays until Retry or ✕: Back is ✕ too)
    if (query) { query = ''; render(); return true; }
    if (category && menuStyle === 'grid') { category = null; renderMenuBody(); return true; } // inside a category: back to all of them
    if (fromFloor && window.RestroFloor) { fromFloor = false; window.RestroFloor.open(); return true; } // opened from a table: Back returns to the Floor
    if (fromOrders && window.RestroOrders) { fromOrders = false; window.RestroOrders.open(); return true; } // opened from Orders: Back returns there
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  // Tapping anywhere outside the selected line puts it back to a plain line (the pop-ups and the sheets opened from it
  // leave it as it is). The tap still does its own job: on another line, that line is selected instead.
  dialog.addEventListener('click', event => {
    if (!selected || !dialog.open) return;
    if (event.target.closest?.('.cx-line')?.dataset.line === selected || event.target.closest?.('.cx-layer, .ctr-sheet-wrap')) return;
    selected = null; render();
  }, true);
  // Remember where the order list was scrolled while Counter is on screen (a hidden list reports 0, so it is ignored then).
  root.addEventListener('scroll', event => {
    if (dialog.open && event.target.classList?.contains('cx-lines')) scrollMemo.lines = event.target.scrollTop;
  }, true);
  // Leaving Counter ends rearranging, the selection, the number pop-ups and the message; the order, the page and
  // everything else (an open modifier, note, custom item, dish discount or void pop-up too, with its line selected) stay
  // as they were.
  dialog.addEventListener('close', () => {
    if (press) { clearTimeout(press.timer); press = null; } if (drag) endDrag(true, false); arranging = false;
    if (panelPress) { clearTimeout(panelPress.timer); panelPress = null; } if (panelDrag) endPanelDrag(true); panelArranging = false;
    typeMenu = false; optionsMenu = false; deleteArmed = false; if (msg) clearTimeout(msg.timer); msg = null;
    if (sheet !== 'mods' && sheet !== 'note' && sheet !== 'void') selected = null;
    if (sheet === 'qty' || sheet === 'discount' || sheet === 'service' || sheet === 'server') { sheet = null; qtyPop = null; discPop = null; servicePop = null; serverPop = null; }
    if (dishPop) dishPop.typing = false;
    if (voidPop) voidPop.typing = false;
    if (notePop) notePop.typing = false;
    if (customPop) { tidyCustom(customPop, customPop.field); customPop.field = null; }
  });
  // The quantity and discount pop-ups and a custom item's price pad from a keyboard too: digits, Backspace, Enter for
  // Done, Apply or Set price (Esc is Back)
  document.addEventListener('keydown', event => {
    if (!dialog.open) return;
    const pad = sheet === 'qty' ? { press: pressQty, enter: doneQty } : sheet === 'discount' ? { press: pressDisc, enter: applyDiscount } : sheet === 'custom' && customPop?.field === 'price' ? { press: pressPrice, enter: customSet }
      : sheet === 'service' ? { press: pressService, enter: applyService } : sheet === 'dish' && dishPop?.step === 2 && !dishPop.typing ? { press: pressDish, enter: applyDish } : null;
    if (!pad) return;
    if (/^\d$/.test(event.key) || (event.key === '.' && sheet === 'service')) { event.preventDefault(); pad.press(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); pad.press('back'); }
    else if (event.key === 'Enter') { event.preventDefault(); pad.enter(); }
  }, true);
  // The keyboard put away by the system (Back on the tablet, or its own key): the line typed on (a note, a reason) lets go
  // of it too, and the pop-up comes down again.
  if (window.visualViewport) {
    let tallest = visualViewport.height;
    visualViewport.addEventListener('resize', () => {
      tallest = Math.max(tallest, visualViewport.height);
      if (visualViewport.height < tallest * .9) return;
      if (notePop?.typing || modPop?.note) dialog.querySelector('#counter-note')?.blur();
      if (voidPop?.typing) dialog.querySelector('#counter-reason')?.blur();
      if (dishPop?.typing) dialog.querySelector('#counter-dish-reason')?.blur();
      if (customPop && (customPop.field === 'name' || customPop.field === 'note')) customSet();
    });
  }
  // Toasts must show above this full-screen app.
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode); else if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  // Shown first, then drawn, so the lists can return to where they were scrolled. Nothing is reset here.
  // (It opens on the view of the pills, or the part of the rail, with the selected category.)
  function openCounter() { typeMenu = false; optionsMenu = false; deleteArmed = false; pillView = null; railScroll = null; if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach(d => d.close()); dialog.showModal(); render(); dialog.querySelector('#counter-title')?.focus({ preventScroll: true });
    // (an order-ready text or buzz that failed while no one was looking: orders.js)
    const missed = window.RestroOrders?.takeNotice?.(); if (missed) window.RestroCounter.notice(missed); }

  // ---------- for the Orders app (Update Pack 3) ----------
  // A saved order's kitchen, for its KOT button: its KOTs (number, time, dishes; failed when the print didn't go, and
  // why), the dishes the kitchen doesn't have yet (what a new KOT would send: "2 × Butter naan", "Medium spicy") and,
  // for an order scheduled for later, when it goes to the kitchen.
  const dishesOf = k => (k.lines || []).filter(l => l.qty > 0).map(l => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(', ');
  function kitchenOf(uid) {
    const rec = loadOrders().find(o => idOf(o) === uid); if (!rec) return null;
    const next = sendToKitchen(JSON.parse(JSON.stringify(rec)), Date.now());
    return {
      kots: kotsOf(rec).map((k, i) => ({ id: k.id, no: k.no || i + 1, at: k.at, dishes: dishesOf(k), failed: Boolean(k.failed), why: k.failWhy || '' })),
      unsent: next ? next.lines.map(l => ({ qty: l.qty, name: l.name, mods: (l.mods || []).map(labelOf).join(' · ') })) : [],
      kitchenAt: cleanTime(rec.readyAt) && !rec.sentAt ? kitchenTime(rec) : null
    };
  }
  // Reprints a saved order's KOTs (ids), each with the red REPRINT box and (R) after every dish; one that never printed
  // prints as it was. Resolves { ok, failed: [{ no, why }] }.
  async function reprintKots(uid, ids) {
    const rec = loadOrders().find(o => idOf(o) === uid); if (!rec) return { ok: false, failed: [] };
    const failed = [], at = Date.now(), by = initialsOf(staffName());
    for (const k of kotsOf(rec).filter(x => ids.includes(x.id))) {
      const r = await sendSlip({ ...kitchenSlip(rec, k), ...(k.failed ? {} : { reprint: { at, by } }) }, { uid, id: k.id });
      if (!r.ok) failed.push({ no: k.no, why: r.why });
    }
    return { ok: !failed.length, failed };
  }
  // Sends a saved order's dishes the kitchen doesn't have yet as a new KOT. Resolves { ok, why, no, count }.
  async function sendKitchen(uid) {
    const list = loadOrders(), rec = list.find(o => idOf(o) === uid); if (!rec) return { ok: false };
    const now = Date.now(), kot = sendToKitchen(rec, now); if (!kot) return { ok: true, no: null, count: 0 };
    if (cleanTime(rec.readyAt) && now < kitchenTime(rec)) kot.how = 'early'; // (a scheduled order's, before its kitchen time: "(sent early)")
    rec.kitchenAt = rec.kitchenDoneAt ? now : rec.kitchenAt || rec.sentAt || now;
    delete rec.kitchenDoneAt; rec.savedAt = now; storeOrders(list); if (order.uid === uid) keepOpened(rec);
    await numberKot(uid, kot); // (its number, as it prints)
    const r = await sendSlip(kitchenSlip(rec, kot), { uid, id: kot.id });
    return { ...r, no: kot.no, count: kot.lines.reduce((n, l) => n + l.qty, 0) };
  }
  // Deletes saved orders not paid yet (Orders: one, or several picked together), with the reason. They come off Orders
  // and the Counter for good (there are no grey Cancelled rows), their tables and pagers are free, and each is kept for
  // the record (Analytics: who, when, why, the amount, whether a KOT or the bill had printed). The kitchen gets one slip:
  // ORDER CANCELLED for one order, or one compact ORDERS CANCELLED slip for several (each order's number, its KOTs and
  // its time; "—" for one that never reached the kitchen); none when none of them reached it. Paid orders and
  // delivery-app orders are never deleted here.
  function deleteOrders(uids, reason) {
    const list = loadOrders(), now = Date.now(), by = staffName(), why = cleanReason(reason);
    const gone = list.filter(o => uids.includes(idOf(o)) && !o.paidAt && !o.platform);
    if (!gone.length || !why) return { count: 0, kitchen: 0 };
    const reached = gone.filter(o => kotsOf(o).length);
    for (const rec of gone) { keepCancelled(rec, { at: now, reason: why, by }); window.RestroSync?.removed('orders', idOf(rec)); }
    storeOrders(list.filter(o => !gone.includes(o)));
    const ids = new Set(gone.map(idOf)), numbers = new Set(gone.map(o => o.number));
    const keep = held.filter(h => !(h.uid ? ids.has(h.uid) : h.number && numbers.has(h.number)));
    if (keep.length !== held.length) { held.filter(h => !keep.includes(h)).forEach(h => window.RestroSync?.removed('held', h.heldId)); held = keep; store(HELD_KEY, held); }
    if (order.uid && ids.has(order.uid)) fresh();
    if (reached.length === 1 && gone.length === 1) {
      const rec = reached[0]; sendSlip(kitchenSlip(rec, cancelSlipOf(rec, why, by, now)));
    } else if (reached.length) {
      sendSlip({ kind: 'cancel-bulk', band: 'ORDERS CANCELLED', action: `BULK DELETE · ${gone.length} ORDERS`, at: now, by: by || null, reason: why,
        info: [`By: ${initialsOf(by) || '—'}`, `Reason: ${why}`].join(' · '),
        orders: [...gone].sort((a, b) => createdOf(b) - createdOf(a)).map(o => ({ order: ticket(o.number), kots: kotsOf(o).map((k, i) => k.no || i + 1).join(' · ') || '—', at: createdOf(o) })),
        footer: '— = order never reached the kitchen.',
        printers: Object.entries(window.RestroPrefs?.get('printers') || {}).filter(([, p]) => p && (p.role === 'kitchen' || p.role === 'both')).map(([id, p]) => ({ id, language: p.language || 'English', copies: p.copies || 1 })) });
    }
    if (dialog.open) render();
    return { count: gone.length, kitchen: reached.length };
  }
  // A delivery app's order marked ready (its third button in Orders: Ready, then Marked). Orders tells the platform
  // first (RESTRODevice.integrations.markReady) and keeps it here once the platform answered (Update Pack 4, C7).
  function markReady(uid) {
    const list = loadOrders(), rec = list.find(o => idOf(o) === uid); if (!rec || !rec.platform) return false;
    if (!rec.platformReadyAt) { rec.platformReadyAt = Date.now(); storeOrders(list); }
    return true;
  }
  // Orders (Update Pack 4): a message sent to the customer (Notify) and a pager buzzed (once its dock confirmed it), kept
  // on the order so every tablet shows the short green bar under that button. Orders shows no times (the Pager app will
  // keep when each happened).
  function markSent(uid, field) {
    const list = loadOrders(), rec = list.find(o => idOf(o) === uid); if (!rec) return false;
    rec[field] = Date.now(); storeOrders(list); return true;
  }
  // (a try that went keeps its time and clears the failure; one that didn't keeps when it failed)
  function markTry(uid, went, failed, ok) {
    const list = loadOrders(), rec = list.find(o => idOf(o) === uid); if (!rec) return false;
    if (ok) { rec[went] = Date.now(); delete rec[failed]; } else rec[failed] = Date.now();
    storeOrders(list); return true;
  }
  window.RestroCounter = Object.freeze({
    open() { fromFloor = false; fromOrders = false; openCounter(); },
    // Back from an app Counter opened (Orders): Counter as it was, where it came from unchanged.
    resume() { openCounter(); },
    // From the Floor: Counter opens on that table's order (Dine in, table chosen).
    openTable(id) { if (typeof id !== 'string' || !id) return; openCounter(); fromFloor = true; fromOrders = false; openTable(id); },
    // From the Orders app: Counter opens on that saved order (not paid yet), to add items or take the payment.
    openOrder(ref) { if (!Number.isInteger(ref) && typeof ref !== 'string') return; openCounter(); fromFloor = false; fromOrders = true; openOrder(ref); },
    // Every saved order (Save or Pay), newest first, as kept on this device; pagerOut: the order still has its pager (not
    // docked back, not given to a newer order); pagerBackAt: when its pager came back.
    orders() {
      const list = loadOrders(), { holders, back } = pagerState(list), out = new Set([...holders.values()].flat().map(idOf));
      return JSON.parse(JSON.stringify(allOrders())).map(o => ({ ...o, pagerOut: out.has(idOf(o)), pagerBackAt: back.get(idOf(o)) || null }));
    },
    // The held orders, newest first (as the Orders app's Held view shows them): when each was held, its type, its table
    // (when it goes to one) or customer, the server, the total and its items. Their tables and pagers were released.
    held() {
      return held.filter(h => h && typeof h.heldId === 'string' && Array.isArray(h.lines)).map(h => {
        const r = restoreOrder(h);
        return { heldId: h.heldId, uid: r.uid, savedAt: cleanTime(h.savedAt) || Date.now(), type: r.type, split: r.split, table: r.number && usesTable(r) ? r.table : '', customer: r.customer,
          server: typeof h.server === 'string' ? h.server : null, total: Number.isFinite(h.total) ? h.total : totalsOf(r).total, number: r.number, lines: r.lines };
      }).sort((a, b) => b.savedAt - a.savedAt);
    },
    // From the Held view: Counter opens on that held order, to carry on with it (the order on screen goes to Held first
    // if it has anything not saved).
    resumeHeld(id) { if (typeof id !== 'string' || !held.some(h => h.heldId === id)) return; openCounter(); fromFloor = false; fromOrders = false; resume(id); },
    goBack,
    // Orders (Update Pack 3): a saved order's kitchen, bill or receipt, KOT reprints, a new KOT, deleting, Ready
    kitchenOf, printSaved, reprintKots, sendKitchen, deleteOrders, markReady, prepMinutes: type => prepMinutes(type), kitchenTime: o => kitchenTime(o),
    // (a message or buzz that went, or didn't: Orders' line under Notify or Buzz green, or red until one goes)
    markNotified: uid => markTry(uid, 'notifiedAt', 'notifyFailedAt', true), markBuzzed: uid => markTry(uid, 'buzzedAt', 'buzzFailedAt', true),
    markNotifyFailed: uid => markTry(uid, 'notifiedAt', 'notifyFailedAt', false), markBuzzFailed: uid => markTry(uid, 'buzzedAt', 'buzzFailedAt', false),
    // (the order-ready text and buzz that go by themselves when the kitchen marks the order done: kept on the order
    // first, once; false when it already went)
    // (the ready text and buzz by themselves, orders.js: once for each time the kitchen marks the order done; readyAutoFor
    // keeps which Done mark, kitchenDoneAt, was handled, so a second one after dishes were added sends again)
    markAutoReady: (uid, done) => {
      const list = loadOrders(), rec = list.find(o => idOf(o) === uid);
      if (!rec || !done || rec.readyAutoFor === done) return false;
      rec.readyAutoFor = done; rec.readyAutoAt = Date.now(); storeOrders(list); return true;
    },
    // Their result in this bar while the Counter is open (orders.js), RETRY when it didn't go; a success never covers a
    // failure still showing. False while the Counter is closed.
    notice(m) {
      if (!dialog.open || !m) return false;
      if (msg?.kind === 'error' && m.kind !== 'error') return true;
      say({ kind: m.kind === 'error' ? 'error' : 'confirm', b: m.bold || '', t: m.text || '', retry: m.retry });
      return true;
    },
    // Orders' Held link: the Counter's Held list until the Held page exists (Back returns to Orders, its filters kept)
    openHeld() { openCounter(); fromFloor = false; fromOrders = true; sheet = 'held'; render(); },
    tablesInUse() {
      // (a held order's table was freed when it was held, a saved one's too: Update Pack 4, C11)
      const used = [...loadOrders().filter(o => !o.paidAt), ...held.filter(h => h.number)].filter(usesTable).map(o => o.table);
      if (order.lines.length && usesTable(order)) used.push(order.table);
      return used;
    },
    get order() { return JSON.parse(JSON.stringify(order)); },
    // The order on screen for the lock screen (Navigation & Lock Update 1): "Order #1015" and "Dine-in · Table 12 ·
    // 24 items · ₹4,158"; null with nothing on it
    openSummary() {
      if (!order.lines.length) return null;
      const t = totals(), n = order.number || upcomingNumber(), type = order.type || DEFAULT_TYPE;
      return { title: n ? `Order ${ticket(n)}` : 'An order',
        line: [typeLabel[type], usesTable(order) ? `Table ${tableName(order.table)}` : order.customer?.name || '', plural(t.count, 'item'), amount(t.total)].filter(Boolean).join(' · ') };
    },
    // Settings > Counter > Tiles per row (Update 6): 4 or 3
    get tilesPerRow() { return tilesPerRow; },
    setTilesPerRow(n) {
      if (n !== 3 && n !== 4) return false;
      window.RestroPrefs?.setScoped('counter', { style: menuStyle, perRow: n }); // (restro:prefs-changed applies it)
      return true;
    },
    // Settings > Counter > Menu display style
    menuStyles: MENU_STYLES,
    get menuStyle() { return MENU_STYLES.find(x => x.id === menuStyle); },
    setMenuStyle(id) {
      if (!MENU_STYLES.some(x => x.id === id)) return false;
      window.RestroPrefs?.setScoped('counter', { style: id, perRow: tilesPerRow }); // (restro:prefs-changed applies it)
      return true;
    },
    // A still picture of the Counter as it is now, in a display style: for the previews in Settings. Exactly what Counter
    // shows when it opens again (the order on screen and where its list is scrolled, the buttons and the menu in this
    // tablet's order, the category or search it was on), in that style. What closes when Counter is left (the order
    // types, the menu, a selected line, the message) isn't in it. Nothing in it can be tapped, focused
    // or read out. The order list's
    // place is set once the picture is on screen (data-scroll-top).
    // (perRow (Update 6): the picture with 4 or 3 tiles a row, for Tiles per row's own cards; the Counter's own otherwise)
    preview(style = menuStyle, perRow = tilesPerRow) {
      if (!MENU_STYLES.some(x => x.id === style)) style = menuStyle;
      if (perRow !== 3 && perRow !== 4) perRow = tilesPerRow;
      const was = { typeMenu, optionsMenu, deleteArmed, panelArranging, selected, tilesPerRow };
      typeMenu = false; optionsMenu = false; deleteArmed = false; panelArranging = false; selected = null; tilesPerRow = perRow;
      try {
        const shell = el('div', { class: 'cx-shell', 'data-style': style }, orderPanel(), menuSide());
        shell.querySelector('.cx-area')?.replaceChildren(...menuArea(style, style === menuStyle && perRow === was.tilesPerRow).filter(Boolean));
        for (const node of shell.querySelectorAll('[id]')) node.removeAttribute('id');
        shell.querySelector('.cx-lines')?.setAttribute('data-scroll-top', String(scrollMemo.lines));
        // (the rail as it is on the Counter: where it is scrolled, its fades and More pills)
        const rail = shell.querySelector('.cx-rail');
        if (rail) {
          rail.setAttribute('data-scroll-top', String(railScroll || 0));
          rail.parentElement.classList.toggle('fu', railEdges.up); rail.parentElement.classList.toggle('fd', railEdges.down);
          rail.parentElement.querySelector('.cx-rarr.up').hidden = !railEdges.up; rail.parentElement.querySelector('.cx-rarr.dn').hidden = !railEdges.down;
        }
        return el('div', { class: 'ctr-root cx-still', inert: true, 'aria-hidden': 'true' }, shell);
      } finally { ({ typeMenu, optionsMenu, deleteArmed, panelArranging, selected, tilesPerRow } = was); }
    }
  });
})();
