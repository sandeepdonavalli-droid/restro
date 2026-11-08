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
  for (const g of groups.values()) for (const o of g.options) optionOf.set(o.id, { ...o, group: g.id, kind: g.kind === 'spice' ? 'spice' : 'other', price: Number(o.price) || 0 });
  const groupsOf = id => { const list = items.get(id)?.modifiers ?? categoryOf.get(id)?.modifiers; return (Array.isArray(list) ? list : []).map(g => groups.get(g)).filter(Boolean); };
  const cleanMods = (id, mods) => {
    const picked = new Set((Array.isArray(mods) ? mods : []).map(m => (typeof m === 'string' ? m : m?.id)));
    return groupsOf(id).flatMap(g => { const on = g.options.filter(o => picked.has(o.id)).map(o => o.id); return g.required ? on.slice(0, 1) : on; });
  };
  // What tells two lines of the same item and type apart: their choices (a saved order keeps them as { id, label, ... })
  const modsKey = mods => (Array.isArray(mods) && mods.length ? `#${mods.map(m => (typeof m === 'string' ? m : m?.id)).join('+')}` : '');
  const cleanNote = n => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
  // One of a line's item with its add-ons (rupees), and a choice as it shows on its pill ("Extra gravy +₹40")
  const eachOf = line => items.get(line.id).price + (line.mods || []).reduce((sum, m) => sum + (optionOf.get(m)?.price || 0), 0);
  const modLabel = id => { const o = optionOf.get(id); return o ? (o.price ? `${o.label} +₹${o.price.toLocaleString('en-IN')}` : o.label) : id; };

  // ---------- storage ----------
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  // Shared data (orders, held) is passed to sync after every save, so the other tablets get it (sync.js).
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} window.RestroSync?.wrote(key); };
  // Held: only tickets put on Hold. They are kept until the end of the day, then cleared (nothing else is cleared).
  let held = load(HELD_KEY, []); if (!Array.isArray(held)) held = [];
  // Orders: every order saved with Save or Pay, newest first, each Paid or Not paid (payment is not always taken upfront).
  // Orders not yet paid are always kept; of the paid ones, the latest 500.
  const createdOf = o => (Number.isFinite(o.createdAt) && o.createdAt > 0 ? o.createdAt : Date.parse(o.paidAt)) || 0;
  const loadOrders = () => { const list = load(DONE_KEY, []); return (Array.isArray(list) ? list : []).filter(o => o && typeof o === 'object' && Number.isFinite(o.number) && Number.isFinite(o.total) && Array.isArray(o.lines)); };
  const storeOrders = list => {
    const byNew = [...list].sort((a, b) => createdOf(b) - createdOf(a));
    store(DONE_KEY, [...byNew.filter(o => !o.paidAt), ...byNew.filter(o => o.paidAt).slice(0, 500)].sort((a, b) => createdOf(b) - createdOf(a)));
  };
  // How long before a scheduled order is due it goes to the kitchen (Settings → Orders; 30 minutes unless changed).
  const prepMinutes = () => { const n = Number(load(PREP_KEY, 30)); return Number.isFinite(n) ? Math.min(240, Math.max(5, Math.round(n / 5) * 5)) : 30; };
  const kitchenTime = o => o.readyAt - prepMinutes() * 60000;
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
  // Vertical rail. A preference of this tablet only.
  const STYLE_KEY = 'restro.counter.menuStyle.v1';
  const MENU_STYLES = Object.freeze([Object.freeze({ id: 'grid', name: 'Category grid' }), Object.freeze({ id: 'pills', name: 'Pills on top' }), Object.freeze({ id: 'rail', name: 'Vertical rail' })]);
  let menuStyle = (() => { const v = load(STYLE_KEY, 'pills'); return MENU_STYLES.some(x => x.id === v) ? v : 'pills'; })();
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
  const blankOrder = () => ({ type: null, split: false, table: '', customer: null, pager: 0, pagerAt: null, readyAt: null, holdUntil: null, heldId: null, number: null, uid: null, lines: [] });
  const cleanCustomer = c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
    ? { id: c.id, name: c.name.slice(0, 60), mobile: String(c.mobile || '').replace(/\D/g, '').slice(0, 15), code: String(c.code || '').replace(/\D/g, '').slice(0, 4), address: String(c.address || '').slice(0, 200) } : null;
  const TYPES = ['dine-in', 'takeaway', 'delivery', 'phone'];
  const cleanPager = n => Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
  // A pager's life on an order: handed out (pagerAt; an order from before this kept its creation time) and back
  // (pagerBackAt: docked in its docking station, or handed to another order, which it can only be once it is back).
  const pagerTime = o => Number(o.pagerAt) || createdOf(o);
  // Which order has each pager now: the one it was last handed to, until it comes back. (Never an order it was handed
  // to before that: it came back from there before it could be handed out again.)
  function pagerHolders(list) {
    const holders = new Map();
    for (const o of [...list].sort((a, b) => pagerTime(b) - pagerTime(a))) { const n = cleanPager(o.pager); if (n && !holders.has(n)) holders.set(n, o); }
    for (const [n, o] of [...holders]) if (o.pagerBackAt) holders.delete(n);
    return holders;
  }
  const holdsPager = (o, holders = pagerHolders(loadOrders())) => { const h = holders.get(cleanPager(o.pager)); return Boolean(h) && idOf(h) === idOf(o); };
  // When each order's pager came back (an order from before this, given the same pager as a later one: when the later
  // one was given it)
  function pagersBack(list) {
    const back = new Map(), later = new Map();
    for (const o of [...list].sort((a, b) => pagerTime(b) - pagerTime(a))) {
      const n = cleanPager(o.pager); if (!n) continue;
      const at = Number(o.pagerBackAt) || (later.has(n) ? pagerTime(later.get(n)) : 0);
      if (at) back.set(idOf(o), at);
      later.set(n, o);
    }
    return back;
  }
  const cleanTime = t => Number.isFinite(t) && t > 0 ? t : null;
  // An order read back from storage (the draft, Held or Orders), keeping only what is valid.
  const restoreOrder = o => {
    const type = TYPES.includes(o.type) ? o.type : null;
    return { type, split: o.split === true, table: typeof o.table === 'string' ? o.table : '', customer: cleanCustomer(o.customer),
      pager: cleanPager(o.pager), pagerAt: cleanTime(o.pagerAt), readyAt: cleanTime(o.readyAt), holdUntil: cleanTime(o.holdUntil),
      heldId: typeof o.heldId === 'string' ? o.heldId : null, number: Number.isInteger(o.number) ? o.number : null, uid: typeof o.uid === 'string' ? o.uid : null,
      lines: (Array.isArray(o.lines) ? o.lines : []).filter(l => l && items.has(l.id) && Number.isInteger(l.qty) && l.qty > 0 && l.qty < 1000)
        .map(l => ({ id: l.id, qty: l.qty, type: TYPES.includes(l.type) ? l.type : type, mods: cleanMods(l.id, l.mods), note: cleanNote(l.note) })) };
  };
  // A saved order put on screen: its pager shows only while the order still has it. One that came back (docked, or
  // handed to another order) is no longer the order's: the pager slot is empty, so whatever pager is there when the
  // order is saved again is its pager (the same one handed back, another one, or none: then it keeps the number of the
  // one it had, for the record).
  const onScreen = saved => { const r = restoreOrder(saved); if (r.pager && !holdsPager(saved)) { r.pager = 0; r.pagerAt = null; } return r; };
  // An order with no type chosen goes as Dine in, with no table: a table chosen earlier is set aside (as when the type
  // changes to Takeaway) and comes back if Dine in is chosen again.
  const DEFAULT_TYPE = 'dine-in';
  const usesTable = o => Boolean(o.table) && (o.type === 'dine-in' || (Boolean(o.type) && o.split));
  // With Modify on (called "split" in the code), each line keeps its own type; otherwise every line follows the order type.
  const typeOf = (o, line) => (o.split ? line.type || o.type : o.type) || DEFAULT_TYPE;
  const lineType = line => typeOf(order, line);
  // What a saved order looks like, to tell whether the copy on screen has changes not saved yet.
  const signature = o => JSON.stringify([o.type, o.split, o.table, o.customer?.id || '', o.pager || 0, o.readyAt || 0, o.lines.map(l => [l.id, l.qty, typeOf(o, l), modsKey(l.mods), l.note || ''])]);
  const keyOf = line => `${line.id}@${lineType(line)}${modsKey(line.mods)}`;
  let qtyKey = null, qtyValue = '';
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, typeMenu = false, optionsMenu = false, deleteArmed = false, highlight = false;
  let undo = null;                                      // the dish just taken off: { line, at, key, name, timer } (the Undo bar)
  let itemSheet = null;                                 // the options sheet: { id, key (the line, when changing it), mods }
  let noteKey = null, noteDraft = '';                   // the note sheet: the line, and the text typed so far
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
  const totalsOf = o => {
    const subtotal = o.lines.reduce((sum, line) => sum + eachOf(line) * 100 * line.qty, 0);
    const tax = Math.round(subtotal * menu.taxRate);
    // Total is exactly subtotal + GST (no rounding to the rupee), so the rows on the ticket always add up.
    return { subtotal, tax, total: subtotal + tax, count: o.lines.reduce((n, l) => n + l.qty, 0) };
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
      const lines = r.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: items.get(l.id).price, qty: l.qty, type: typeOf(r, l) }));
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
  // An item with modifier groups opens its options sheet first (it is added once they are confirmed); any other goes
  // straight on. The same item with the same choices (and type) adds one to that line; other choices make a line of
  // their own, as each line keeps its own modifiers and note.
  function add(id) {
    const offered = groupsOf(id);
    if (offered.length) { itemSheet = { id, key: null, mods: offered.filter(g => g.required).map(g => g.default || g.options[0].id) }; sheet = 'item'; render(); return; }
    addLine(id, []);
  }
  function addLine(id, mods) {
    const type = order.type, key = `${id}@${type || DEFAULT_TYPE}${modsKey(mods)}`, line = order.lines.find(l => keyOf(l) === key);
    if (line) line.qty += 1; else order.lines.push({ id, qty: 1, type, mods: [...mods], note: '' });
    selected = null; render();
    const row = [...dialog.querySelectorAll('.cx-line')].find(r => r.dataset.line === key); row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('just-added');
  }
  // A line's choices changed (its options sheet): that line only. Its note: that line only; empty takes it off.
  function setMods(key, mods) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.mods = cleanMods(line.id, mods); tidy(); selected = null; render();
  }
  function setNote(key, note) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.note = cleanNote(note); render();
  }
  function setQty(key, qty) {
    if (qty <= 0) { removeLine(key); return; }
    order.lines = order.lines.map(l => keyOf(l) === key ? { ...l, qty } : l); render();
  }
  // Taking a dish off (− at 1, 0 on the number pad, a swipe, or the Delete key) happens straight away; the Undo bar above
  // Subtotal ("Chicken biryani removed · UNDO") brings it back exactly as it was (quantity, choices, note, place) for
  // 5 seconds. Another dish taken off replaces the bar.
  function removeLine(key) {
    const at = order.lines.findIndex(l => keyOf(l) === key); if (at < 0) return;
    const line = order.lines[at];
    clearUndo();
    // (kept with the order it came off: another order on screen has no Undo bar)
    undo = { order, line: JSON.parse(JSON.stringify(line)), at, key, name: items.get(line.id).name };
    undo.timer = setTimeout(() => { undo = null; if (dialog.open) render(); }, 5000);
    order.lines.splice(at, 1);
    if (selected === key) selected = null;
    render();
  }
  const undoShown = () => (undo && undo.order === order ? undo : null);
  function undoRemove() {
    const u = undoShown(); clearUndo(); if (!u) return;
    const same = order.lines.find(l => keyOf(l) === u.key);
    if (same) same.qty += u.line.qty; else order.lines.splice(Math.min(u.at, order.lines.length), 0, u.line);
    tidy(); render();
  }
  function clearUndo() { if (undo) clearTimeout(undo.timer); undo = null; }
  // Merge lines that ended up with the same item, type and choices (both notes are kept).
  function tidy() {
    const merged = [];
    for (const line of order.lines) {
      const type = lineType(line), mods = line.mods || [], same = merged.find(m => m.id === line.id && m.type === type && modsKey(m.mods) === modsKey(mods));
      if (!same) { merged.push({ id: line.id, qty: line.qty, type, mods: [...mods], note: line.note || '' }); continue; }
      same.qty += line.qty;
      if (line.note && line.note !== same.note) same.note = cleanNote(same.note ? `${same.note} · ${line.note}` : line.note);
    }
    order.lines = merged;
  }
  function moveLine(key, type) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.type = type; tidy(); selected = `${line.id}@${type}${modsKey(line.mods)}`; render();
  }
  // Changing the order type puts every item on the new type, with Modify on or off (with Modify on, items can then be
  // moved to other types again). The same item on two types becomes one line. No type (null) means the default, Dine in.
  function setType(type) {
    if (order.type === type) return;
    order.type = type;
    order.lines.forEach(l => { l.type = type; }); tidy();
    selected = null; render();
  }
  // The three-line menu (the blue button left of search): Highlight order and Delete order.
  function openOptions(open) {
    optionsMenu = open; deleteArmed = false; render();
    if (open) dialog.querySelector('.cx-mi:not(:disabled)')?.focus({ preventScroll: true });
  }
  // Highlight order: the order takes the whole left side, top to bottom, to go through and edit its items; the menu side
  // is dimmed. A tap on the dimmed side or Back ends it, and so does the last item going.
  function setHighlight(on) {
    highlight = on; optionsMenu = false; deleteArmed = false;
    if (on) scrollMemo.lines = 0; // the order shows from its first item
    render();
    if (!on) dialog.querySelector('.cx-mb')?.focus({ preventScroll: true });
  }
  // Anything on screen to delete: items, a type, a table, a customer, a pager, a ready time, Modify, or a saved order.
  const hasOrder = () => Boolean(order.lines.length || order.number || order.type || order.table || order.customer || order.pager || order.readyAt || order.split);
  // Delete order: the first tap asks again (Tap again to delete, until the menu closes); the second deletes the order
  // on screen. A saved order (opened from Orders, not paid) comes off Orders too.
  function tapDelete() {
    if (!deleteArmed) { deleteArmed = true; render(); dialog.querySelector('.cx-mi.del')?.focus({ preventScroll: true }); return; }
    const n = order.number;
    if (n) { const list = loadOrders(), gone = o => (order.uid ? idOf(o) === order.uid : o.number === n) && !o.paidAt; list.filter(gone).forEach(o => window.RestroSync?.removed('orders', idOf(o))); storeOrders(list.filter(o => !gone(o))); }
    if (order.heldId) { window.RestroSync?.removed('held', order.heldId); held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    fresh(); toast(n ? `Order ${ticket(n)} deleted` : 'Order deleted');
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
  const fresh = () => { order = blankOrder(); baseline = null; opened = null; selected = null; sheet = null; itemSheet = null; noteKey = null; typeMenu = false; optionsMenu = false; deleteArmed = false; highlight = false; scheduleDraft = null; render(); };
  // Sends the items not sent yet to the kitchen, as one kitchen ticket. There is no kitchen screen or printer yet,
  // so the ticket is recorded on the order. Returns how many items went.
  function sendToKitchen(entry, now = Date.now()) {
    if (!entry.sent || typeof entry.sent !== 'object') entry.sent = {};
    const lines = [];
    for (const l of entry.lines) {
      const key = `${l.id}@${l.type}${modsKey(l.mods)}`, n = l.qty - (Number(entry.sent[key]) || 0); if (n <= 0) continue;
      lines.push({ id: l.id, name: l.name, qty: n, type: l.type, ...(l.mods?.length ? { mods: l.mods } : {}), ...(l.note ? { note: l.note } : {}) }); entry.sent[key] = l.qty;
    }
    if (!lines.length) return 0;
    entry.sentAt = entry.sentAt || now; entry.kots = [...(Array.isArray(entry.kots) ? entry.kots : []), { at: now, lines }].slice(-30);
    return lines.reduce((n, l) => n + l.qty, 0);
  }
  // The saved order (not paid yet) the order on screen carries on, if any
  const savedOf = list => (order.uid ? list.find(o => idOf(o) === order.uid && !o.paidAt) : order.number ? list.find(o => o.number === order.number && !o.paidAt) : null);
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
      ? { pager: onScreenPager, pagerAt: order.pagerAt || prev?.pagerAt || (prev ? createdOf(prev) : now), ...(untouched && prev.pagerBackAt ? { pagerBackAt: prev.pagerBackAt } : {}) }
      : record ? { pager: prev.pager, ...(prev.pagerAt ? { pagerAt: prev.pagerAt } : {}), ...(prev.pagerBackAt ? { pagerBackAt: prev.pagerBackAt } : {}) } : { pager: 0 };
    let entry = { uid: prev ? idOf(prev) : window.RestroSync?.newId('o') || `o${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, number, type: order.type || DEFAULT_TYPE, split: order.split, table: order.type ? order.table : '', customer: order.customer, ...pagerFields, readyAt: order.readyAt || null,
      // each line's price is one with its add-ons; its choices (with their names, for the bill and the kitchen) and note
      lines: order.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: eachOf(l), qty: l.qty, type: lineType(l),
        ...(l.mods?.length ? { mods: l.mods.map(m => ({ id: m, label: optionOf.get(m)?.label || m, kind: optionOf.get(m)?.kind || 'other', price: optionOf.get(m)?.price || 0 })) } : {}),
        ...(l.note ? { note: l.note } : {}) })), ...totals(),
      createdAt: prev ? createdOf(prev) : now, savedAt: now, day: prev ? prev.day : given?.day || window.RestroSync?.today(), sent: prev && prev.sent && typeof prev.sent === 'object' ? { ...prev.sent } : {}, sentAt: prev ? cleanTime(prev.sentAt) : null, kots: prev && Array.isArray(prev.kots) ? prev.kots : [],
      method: pay ? pay.method : null, received: pay ? pay.received : null, change: pay ? pay.change : null, paidAt: pay ? new Date(now).toISOString() : null,
      // the server: whoever was signed in when the order was first saved (staff sign-in)
      server: prev && prev.server ? prev.server : window.RestroStaff?.current?.name || null, serverId: prev && prev.serverId ? prev.serverId : window.RestroStaff?.current?.id || null,
      // kept from the kitchen screen: the kitchen's "complete" (until more items go to the kitchen)
      ...(prev?.kitchenDoneAt ? { kitchenDoneAt: prev.kitchenDoneAt } : {}),
      // an order this tablet had from before it joined the others keeps its own number until the main system settles it
      ...(prev?.numberProvisional ? { numberProvisional: true } : {}), ...(prev && Number.isInteger(prev.numberWas) ? { numberWas: prev.numberWas } : {}) };
    // Changed on another tablet since it was opened here: both tablets' changes are kept (items added on both, and so on)
    if (prev && opened && window.RestroSync && JSON.stringify(prev) !== opened) entry = window.RestroSync.mergeRecord('orders', JSON.parse(opened), entry, prev);
    // (a pager handed out here is out, even if the one it replaced came back on another tablet meanwhile)
    if (entry.pagerBackAt && !pagerFields.pagerBackAt && entry.pager === pagerFields.pager && (entry.pagerAt || 0) === (pagerFields.pagerAt || 0)) delete entry.pagerBackAt;
    const sentNow = !entry.readyAt || kitchenTime(entry) <= now ? sendToKitchen(entry, now) : 0;
    if (sentNow) delete entry.kitchenDoneAt; // more for the kitchen: not complete any more
    // A pager handed out or given up here: every other order that had that number is back from it (a pager can only be
    // handed out once it is back), each keeping when it came back for the record (the one that had it till now: now)
    const others = list.filter(o => idOf(o) !== entry.uid);
    if (!untouched && !record) {
      const back = pagersBack(list), numbers = new Set([cleanPager(prev?.pager), cleanPager(entry.pager)].filter(Boolean));
      for (const o of others) if (numbers.has(cleanPager(o.pager)) && !o.pagerBackAt) o.pagerBackAt = back.get(idOf(o)) || now;
    }
    storeOrders([entry, ...others]);
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    return { entry, sentNow, isNew: !prev };
  }
  // Fires the order on screen (Save, or Pay with the payment). With other tablets, only while this tablet reaches the
  // main system or the cloud, as a new order takes its number from them, so no two orders share one. Otherwise it says
  // so and the order stays on screen. Returns what upsertOrder does, or null.
  let firing = false;
  const cantFire = pay => {
    const st = window.RestroSync?.status();
    return `${!st?.cloud.setUp ? 'Can’t reach the main system' : st.paired ? 'No connection' : 'No internet'} · ${pay ? 'payment not taken' : 'order not saved'}`;
  };
  async function fire(pay) {
    const sync = window.RestroSync, target = order;
    if (firing || !order.lines.length) return null;
    if (sync && !sync.canFire()) { toast(cantFire(pay)); return null; }
    let given = null;
    if (sync && !savedOf(loadOrders())) {
      firing = true;
      try { given = await sync.takeNumber(); } catch { given = null; } finally { firing = false; }
      if (!given) { toast(cantFire(pay)); return null; }
      if (order !== target || !order.lines.length) return null; // another order took the screen meanwhile
    }
    return upsertOrder(pay, given);
  }
  // Save: the order goes to Orders (not paid yet) and to the kitchen; a new order starts.
  async function saveOrder() {
    const done = await fire(null); if (!done) return;
    const { entry, sentNow, isNew } = done;
    const kitchen = sentNow ? (isNew ? 'sent to kitchen' : `${sentNow} more item${sentNow === 1 ? '' : 's'} sent to kitchen`) : entry.readyAt && !entry.sentAt ? `kitchen at ${whenShort(kitchenTime(entry))}` : '';
    toast([`Order ${ticket(entry.number)} saved`, kitchen].filter(Boolean).join(' · '));
    fresh();
  }
  // Hold (new orders): the ticket waits in Held until the end of the day, as the customer may call or come back.
  function holdTicket() {
    if (!order.lines.length || order.number) return;
    const freed = [usesTable(order) ? `table ${tableName(order.table)}` : '', order.pager ? `pager ${order.pager}` : ''].filter(Boolean);
    hold(); toast(`On hold until the end of the day${freed.length ? ` · ${freed.join(' and ')} free` : ''}`); fresh();
  }
  // Schedule: the time the customer wants the order ready. It is saved with Save or Pay, and goes to the kitchen
  // the preparation time before.
  function setSchedule(readyAt) {
    if (!Number.isFinite(readyAt)) return;
    order.readyAt = readyAt; scheduleDraft = null; sheet = null; render();
    toast(`Ready by ${whenShort(readyAt)} · Save or Pay to keep it`);
  }
  function resume(id) {
    const entry = held.find(h => h.heldId === id); if (!entry) return;
    if (order.heldId !== id) park();
    window.RestroSync?.removed('held', id); held = held.filter(h => h.heldId !== id); store(HELD_KEY, held);
    order = restoreOrder(entry);
    // A held copy of a saved order carries on with that order (unless it has been paid since). A new order comes back
    // without a table or a pager: they were released when it was held.
    const saved = order.number ? loadOrders().find(o => (order.uid ? idOf(o) === order.uid : o.number === order.number) && !o.paidAt) : null;
    if (!saved) { order.number = null; order.uid = null; order.table = ''; order.pager = 0; order.pagerAt = null; }
    else {
      order.number = saved.number;
      // (the saved order's pager came back meanwhile: no longer on screen, as when the order is opened)
      if (order.pager && order.pager === cleanPager(saved.pager) && !holdsPager(saved)) { order.pager = 0; order.pagerAt = null; }
    }
    baseline = saved ? signature(onScreen(saved)) : null; opened = saved ? JSON.stringify(saved) : null;
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
    // the ticket carries its kitchen time, so tablets sending the same scheduled order make the same ticket (sync keeps one)
    for (const o of list) if (cleanTime(o.readyAt) && kitchenTime(o) <= now && sendToKitchen(o, kitchenTime(o))) { announceKitchen(o); sent++; }
    if (sent) storeOrders(list);
    if (dialog.open && (heldChanged || (sent && sheet === 'orders'))) render();
  }
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
  // reports it (restro:pager-docked, { number }). The order that had the pager lets it go (pagerBackAt): its Buzz goes
  // grey (the number stays, for the record), and the pager is free for another order. The mark syncs to the other
  // tablets. Opened again, the order shows no pager.
  window.addEventListener('restro:pager-docked', e => {
    const n = cleanPager(Number(e.detail?.number)), list = loadOrders(), holder = n ? pagerHolders(list).get(n) : null;
    if (!holder) return;
    holder.pagerBackAt = Date.now(); storeOrders(list);
    if (dialog.open) render();
  });
  // Changes from another tablet (sync.js): Held and Orders show them at once, and so does the saved order on screen.
  window.addEventListener('restro:data-changed', e => {
    const names = e.detail?.collections || [];
    if (names.includes('held')) { held = load(HELD_KEY, []); if (!Array.isArray(held)) held = []; if (order.heldId && !order.number && !held.some(h => h.heldId === order.heldId)) order.heldId = null; }
    if (names.includes('orders') && (order.uid || order.number)) followOpenOrder();
    if (dialog.open && (names.includes('held') || names.includes('orders'))) render();
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
    const before = new Map((was ? was.lines : []).map(l => [`${l.id}@${typeOf(was, l)}${modsKey(l.mods)}`, l.qty]));
    const added = unsaved ? order.lines.map(l => ({ ...l, qty: l.qty - (before.get(keyOf(l)) || 0) })).filter(l => l.qty > 0) : [];
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
  }

  // ---------- rendering ----------
  const typeLabel = { 'dine-in': 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery', phone: 'Phone call' };
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  function pickTable() {
    window.RestroFloor?.open({ pick: true, current: order.table, onPick: table => {
      order.table = table.id;
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
  // ---------- the Counter screen (POS Counter Handoff) ----------
  // The order panel on the left (context buttons, the order's lines, totals, Save and Pay) and the menu on the right
  // (the three-line menu, search, Held · Orders · Payment history, then the menu in the display style chosen in
  // Settings > Counter). Sizes are the design's 1440 x 900 screen scaled to the tablet (counter.css). Icons are
  // Material Symbols Rounded (filled), as in the design.
  const MI = {
    receipt_long: 'M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480Z',
    restaurant: 'M280-600v-240q0-17 11.5-28.5T320-880q17 0 28.5 11.5T360-840v240h40v-240q0-17 11.5-28.5T440-880q17 0 28.5 11.5T480-840v240q0 56-34.5 98T360-446v326q0 17-11.5 28.5T320-80q-17 0-28.5-11.5T280-120v-326q-51-14-85.5-56T160-600v-240q0-17 11.5-28.5T200-880q17 0 28.5 11.5T240-840v240h40Zm400 200h-80q-17 0-28.5-11.5T560-440v-240q0-70 51.5-135T718-880q18 0 30 14t12 33v713q0 17-11.5 28.5T720-80q-17 0-28.5-11.5T680-120v-280Z',
    local_mall: 'M200-80q-33 0-56.5-23.5T120-160v-480q0-33 23.5-56.5T200-720h80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720h80q33 0 56.5 23.5T840-640v480q0 33-23.5 56.5T760-80H200Zm160-640h240q0-50-35-85t-85-35q-50 0-85 35t-35 85Zm119 320q74 0 134-49t59-110q0-17-11-29t-28-12q-14 0-25 9t-16 27q-11 38-43 61t-70 23q-38 0-70.5-23T366-564q-5-19-15-27.5t-24-8.5q-17 0-28.5 12T287-559q0 61 59 110t133 49Z',
    moped: 'M280-200q-50 0-85-35t-35-85h-40q-17 0-28.5-11.5T80-360v-80q0-66 47-113t113-47h80q33 0 56.5 23.5T400-520v120h140l140-174v-106h-80q-17 0-28.5-11.5T560-720q0-17 11.5-28.5T600-760h80q33 0 56.5 23.5T760-680v106q0 14-4.5 26.5T743-524L604-350q-11 14-28 22t-35 8H400q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T320-320h-80q0 17 11.5 28.5T280-280Zm80-360H240q-17 0-28.5-11.5T200-680q0-17 11.5-28.5T240-720h120q17 0 28.5 11.5T400-680q0 17-11.5 28.5T360-640Zm400 440q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T800-320q0-17-11.5-28.5T760-360q-17 0-28.5 11.5T720-320q0 17 11.5 28.5T760-280Z',
    call: 'M798-120q-125 0-247-54.5T329-329Q229-429 174.5-551T120-798q0-18 12-30t30-12h162q14 0 25 9.5t13 22.5l26 140q2 16-1 27t-11 19l-97 98q20 37 47.5 71.5T387-386q31 31 65 57.5t72 48.5l94-94q9-9 23.5-13.5T670-390l138 28q14 4 23 14.5t9 23.5v162q0 18-12 30t-30 12Z',
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
    swap_vert: 'M360-440q-17 0-28.5-11.5T320-480v-247l-75 75q-11 11-27.5 11T189-652q-12-12-12-28.5t12-28.5l143-143q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l144 144q12 12 11.5 28T531-652q-12 11-28 11.5T475-652l-75-75v247q0 17-11.5 28.5T360-440ZM600-97q-8 0-15-2.5t-13-8.5L428-252q-12-12-11.5-28t12.5-28q12-11 28-11.5t28 11.5l75 75v-247q0-17 11.5-28.5T600-520q17 0 28.5 11.5T640-480v247l75-75q11-11 27.5-11t28.5 11q12 12 12 28.5T771-251L628-108q-6 6-13 8.5T600-97Z',
    delete: 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z',
    chevron_left: 'm432-480 156 156q11 11 11 28t-11 28q-11 11-28 11t-28-11L348-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l184-184q11-11 28-11t28 11q11 11 11 28t-11 28L432-480Z',
    close: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
    person: 'M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-240v-32q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v32q0 33-23.5 56.5T720-160H240q-33 0-56.5-23.5T160-240Z',
    table_restaurant: 'M672-520H289l-11 80h404l-10-80ZM166-205l43-315h-89q-20 0-31.5-16T82-571l57-200q4-13 14-21t24-8h606q14 0 24 8t14 21l57 200q5 19-6.5 35T840-520h-88l42 315q2 18-9.5 31.5T755-160q-15 0-26.5-9.5T715-194l-22-166H267l-22 166q-2 15-13.5 24.5T205-160q-18 0-29.5-13.5T166-205Z'
  };
  const mi = (name, size) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 -960 960 960'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', `cx-i s${size}`);
    s.innerHTML = `<path d="${MI[name]}"/>`; return s;
  };
  const typeIcon = { 'dine-in': 'restaurant', takeaway: 'local_mall', delivery: 'moped', phone: 'call' };
  // ₹2,270 for whole rupees, ₹113.50 otherwise
  const amount = paise => `₹${(paise / 100).toLocaleString('en-IN', paise % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // A context button: its icon, its name and, on Order type, the ▾ arrow. Colour: grey (not set), amber (order type),
  // violet (pager), white (an order type to pick, over the dimmed screen); Print bill is the light blue one.
  const ctxButton = (colour, icon, size, label, props = {}, arrow = false) =>
    el('button', { type: 'button', class: `cx-b ${colour}`, ...props }, mi(icon, size), label ? el('span', { class: 'cx-b-label' }, label) : null, arrow ? mi('expand_more', 18) : null);
  // A chip in the order header: grey, pink (a ready time), dark (Modify on); Hold is round, an icon only.
  const chip = (colour, icon, size, label, props = {}) =>
    el('button', { type: 'button', class: `cx-chip ${colour}`, ...props }, mi(icon, size), label ? el('span', { class: 'cx-b-label' }, label) : null);

  function orderPanel() {
    const t = totals(), c = order.customer, table = tableName(order.table);
    // Counter Update 3. The context row: Order type ▾ · Add Customer (Choose table / Table 7 for Dine in) · Pager · Print
    // bill (an icon); then the order header: Order #1015 · Schedule · Modify · Hold ........ 24 items. Hold any of them to
    // rearrange its group (below). Order type opens the four types, two by two, over both, over the dimmed screen.
    const typeBtn = ctxButton(order.type ? 'amber' : 'grey unset', order.type ? typeIcon[order.type] : 'receipt_long', 20, typeLabel[order.type] || 'Order type',
      { class: `cx-b ${order.type ? 'amber' : 'grey unset'} cx-type`, 'aria-haspopup': 'true', 'aria-expanded': String(typeMenu), 'aria-label': order.type ? `Order type ${typeLabel[order.type]}. Tap to change` : 'Choose the order type', onclick: () => openTypeMenu(true) }, true);
    const who = order.type === 'dine-in'
      ? ctxButton('grey', 'table_restaurant', 19, table ? `Table ${table}` : 'Choose table', { class: 'cx-b grey cx-who', 'aria-label': table ? `Table ${table}. Tap to change the table` : 'Choose table', onclick: pickTable })
      : ctxButton('grey', c ? 'person' : 'person_add', 19, c ? c.name : 'Add Customer', { class: 'cx-b grey cx-who', 'aria-label': c ? `Customer ${c.name}. Tap to change the customer` : 'Add customer', onclick: pickCustomer });
    const pager = ctxButton(order.pager ? 'violet' : 'grey', 'vibration', 19, order.pager ? `Pager ${order.pager}` : 'Pager',
      { class: `cx-b ${order.pager ? 'violet' : 'grey'} sm cx-pager`, 'aria-label': order.pager ? `Pager ${order.pager}. Tap to change the pager` : 'Assign a pager', onclick: () => { sheet = 'pager'; render(); } });
    const print = ctxButton('print', 'print', 28, '', { class: 'cx-b print cx-print', 'aria-label': 'Print bill', title: 'Print bill', disabled: !order.lines.length, onclick: printBill });
    const schedule = chip(order.readyAt ? 'pink' : 'grey', 'schedule', 17, order.readyAt ? whenShort(order.readyAt) : 'Schedule',
      { class: `cx-chip ${order.readyAt ? 'pink' : 'grey'} cx-sched`, 'aria-label': order.readyAt ? `Ready by ${whenShort(order.readyAt)}. Tap to change` : 'Schedule', onclick: () => { scheduleDraft = null; sheet = 'schedule'; render(); } });
    const modify = chip(order.split ? 'dark' : 'grey', 'edit', 17, 'Modify', { class: `cx-chip ${order.split ? 'dark' : 'grey'} cx-modify`, role: 'switch', 'aria-checked': String(order.split), onclick: () => setSplit(!order.split) });
    const holdBtn = chip('hold', 'pause_circle', 20, '', { class: 'cx-chip hold cx-hold', 'aria-label': 'Hold', title: order.number ? 'This order is saved in Orders' : 'Hold', disabled: !order.lines.length || Boolean(order.number), onclick: holdTicket });
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
        el('h2', { id: 'counter-title', tabindex: '-1' }, number ? `Order ${ticket(number)}` : 'New order'),
        el('div', { class: 'cx-chips', 'data-group': 'head' }, ...group('head'))),
      el('span', { class: 'cx-count' }, t.count ? plural(t.count, 'item') : 'No items'));

    // The order's lines, one under another with a hairline between: name · − quantity + (the number in blue: tap it for the
    // number pad) · "₹220 ea" (more than one) and the line total; under them its choices as a line of coloured text, and
    // its note.
    // Tap a line to select it (light blue, a blue bar on its left): its choices become pills (tap one to change them) and
    // "Add note / Edit note" shows. − / + and the number work straight away on any line. With Modify on, the selected
    // line also shows the order types to move it to.
    const list = el('ul', { class: 'cx-lines', 'aria-label': 'Items in this order' });
    if (!order.lines.length) list.append(el('li', { class: 'cx-empty' }, el('strong', {}, 'No items yet'), el('span', {}, 'Tap an item to add it.')));
    const lineRow = line => {
      const item = items.get(line.id), key = keyOf(line), sel = selected === key, open = order.split && sel, each = eachOf(line);
      const mods = (line.mods || []).map(m => {
        const kind = `cx-mc ${optionOf.get(m)?.kind === 'spice' ? 'sp' : 'nn'}`;
        return sel ? el('button', { type: 'button', class: kind, 'aria-label': `${modLabel(m)}. Tap to change the choices`, onclick: () => openItemSheet(key) }, modLabel(m)) : el('span', { class: kind }, modLabel(m));
      });
      return el('li', { class: `cx-line${sel ? ' sel' : ''}${open ? ' open' : ''}`, 'data-line': key, onkeydown: e => { if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest?.('button')) { e.preventDefault(); removeLine(key); } } },
        el('div', { class: 'cx-row', onclick: e => { if (!e.target.closest?.('.cx-stp, .cx-mcs button, .cx-an, .cx-move')) selectLine(key); } },
          el('div', { class: 'cx-nm' }, el('button', { type: 'button', class: 'cx-nm-btn', 'aria-expanded': String(sel) }, item.name)),
          el('div', { class: 'cx-stp' },
            el('button', { type: 'button', class: 'cx-sb', 'aria-label': line.qty > 1 ? `One less ${item.name}` : `Remove ${item.name}`, onclick: () => setQty(key, line.qty - 1) }, mi('remove', 22)),
            el('button', { type: 'button', class: 'cx-qty', 'aria-label': `Quantity ${line.qty}. Tap to type a quantity`, onclick: () => openQtyPad(key) }, String(line.qty)),
            el('button', { type: 'button', class: 'cx-sb', 'aria-label': `One more ${item.name}`, onclick: () => setQty(key, line.qty + 1) }, mi('add', 22))),
          el('div', { class: 'cx-lt' }, line.qty > 1 ? el('small', {}, `${rupees(each)} ea`) : null, el('b', {}, rupees(each * line.qty))),
          mods.length ? el('div', { class: 'cx-mcs' }, ...mods) : null,
          sel ? el('button', { type: 'button', class: 'cx-an', 'aria-label': `${line.note ? 'Edit the note' : 'Add a note'} for ${item.name}`, onclick: () => openNoteSheet(key) }, mi('edit', 14), el('span', {}, line.note ? 'Edit note' : 'Add note')) : null,
          line.note ? el('div', { class: 'cx-cmt' }, mi('receipt_long', 14), el('span', {}, line.note)) : null,
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

    // Totals: Subtotal and GST (the total is on Pay); Save and Pay at the bottom, the same size, no icons. The Undo bar,
    // while there is one, floats just above Subtotal.
    const u = undoShown();
    const sums = el('div', { class: 'cx-tot' },
      u ? el('div', { class: 'cx-undo', role: 'status' }, el('span', {}, el('b', {}, u.name), ' removed'), el('button', { type: 'button', onclick: undoRemove }, 'UNDO')) : null,
      el('div', { class: 'cx-r' }, el('span', {}, 'Subtotal'), el('span', {}, amount(t.subtotal))),
      el('div', { class: 'cx-r' }, el('span', {}, menu.taxLabel), el('span', {}, amount(t.tax))),
      el('div', { class: 'cx-act' },
        el('button', { type: 'button', class: 'cx-save', disabled: !t.count, onclick: saveOrder }, 'Save'),
        el('button', { type: 'button', class: 'cx-pay', disabled: !t.count, 'aria-label': `Pay ${amount(t.total)}`, onclick: () => { cashInput = ''; sheet = 'pay'; render(); } }, `Pay\u00A0\u00A0${amount(t.total)}`)));

    return el('aside', { class: `cx-order${panelArranging ? ' arranging' : ''}${typeMenu ? ' picking' : ''}`, 'aria-label': 'Current order' }, pick, row, head, list, sums);
  }
  // Tap a line: it is selected (another one was, it isn't any more); tapping the selected one again keeps it so.
  function selectLine(key) { if (selected === key) return; selected = key; render(); }
  // The quantity pad, opened by tapping the blue number on any line: beside the order, level with the line
  function openQtyPad(key) { qtyKey = key; qtyValue = ''; sheet = 'qty'; render(); }

  // The menu side: the three-line menu (Highlight order, Delete order; Print bill is in the context row), search, then
  // Held · Orders · Payment history; under them the menu itself (renderMenuBody).
  function menuSide() {
    const search = el('label', { class: 'cx-sr' }, mi('search', 22), el('span', { class: 'visually-hidden' }, 'Search menu items'),
      el('input', { id: 'counter-search', type: 'search', placeholder: 'Search menu items', autocomplete: 'off', enterkeyhint: 'search', value: query,
        oninput: e => { query = e.target.value; renderMenuBody(); },
        onkeydown: e => {
          if (e.key !== 'Enter') return;
          const code = query.trim().toUpperCase(), byCode = [...items.values()].find(i => i.code === code), found = matches();
          const pick = byCode || (found.length === 1 ? found[0] : null);
          if (pick) { e.preventDefault(); query = ''; add(pick.id); if (sheet !== 'item') dialog.querySelector('#counter-search')?.focus(); }
        } }));
    const top = el('div', { class: 'cx-tb' },
      el('button', { type: 'button', class: `cx-mb${optionsMenu ? ' lifted' : ''}`, 'aria-label': 'Menu', title: 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': String(optionsMenu), onclick: () => openOptions(!optionsMenu) }, mi('menu', 22)),
      search,
      // Held opens the held orders in the Orders app; Orders opens the Orders app; Back there returns to Counter as it was.
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { if (window.RestroOrders) window.RestroOrders.open({ from: 'counter', view: 'held' }); else { sheet = 'held'; render(); } } }, mi('pause_circle', 19), 'Held'),
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { if (window.RestroOrders) window.RestroOrders.open({ from: 'counter' }); else { sheet = 'orders'; render(); } } }, mi('receipt_long', 19), 'Orders'),
      el('button', { type: 'button', class: 'cx-tc', onclick: () => { sheet = 'payments'; render(); } }, mi('history', 19), 'Payment history'));
    // The menu: 14 below the button, over the dimmed screen. Highlight order needs items; Delete order asks again before
    // it deletes the order on screen.
    const pop = optionsMenu ? el('div', { class: 'cx-pop', role: 'menu', 'aria-label': 'Menu' },
      el('button', { type: 'button', role: 'menuitem', class: 'cx-mi', disabled: !order.lines.length, onclick: () => setHighlight(true) }, mi('swap_vert', 26), 'Highlight order'),
      el('div', { class: 'cx-sep', role: 'separator' }),
      el('button', { type: 'button', role: 'menuitem', class: `cx-mi del${deleteArmed ? ' armed' : ''}`, disabled: !hasOrder(), onclick: tapDelete }, mi('delete', 26),
        deleteArmed ? (order.number ? `Tap again to delete ${ticket(order.number)}` : 'Tap again to delete') : 'Delete order')) : null;
    return el('section', { class: 'cx-main', 'aria-label': 'Menu' }, top, pop, el('div', { class: 'cx-area' }),
      // (Not while a sheet such as Pay is open: the sheet dims the whole screen itself. The number pad leaves it as it is.)
      highlight && (!sheet || sheet === 'qty') ? el('div', { class: 'cx-dim', onclick: () => setHighlight(false) }) : null);
  }

  const matches = () => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    return categoriesInOrder().flatMap(itemsInOrder).filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase() === q);
  };
  // An item: the veg / non-veg mark, its name and price. The whole card adds it (its options sheet first, if it has
  // modifier groups); hold it to rearrange.
  const itemCard = item => el('button', { type: 'button', class: 'cx-card', 'data-id': item.id, onclick: () => add(item.id),
    'aria-label': `Add ${item.name}, ${rupees(item.price)}${item.veg === false ? ', non-veg' : item.veg ? ', veg' : ''}` },
    item.veg == null ? null : el('em', { class: item.veg ? 'veg' : 'non', 'aria-hidden': 'true' }), el('b', {}, item.name), el('span', {}, rupees(item.price)));
  const itemGrid = (c, cols) => el('div', { class: `cx-grid cols-${cols}`, 'data-arrange': 'items', 'data-cat': c.id }, ...itemsInOrder(c).map(itemCard));
  const resultGrid = (list, cols) => el('div', { class: `cx-grid cols-${cols}` }, ...list.map(itemCard));
  const scroller = (...children) => el('div', { class: 'cx-scroll' }, ...children);
  // A category in the Category grid: its food icon on a tint of its colour, its name and how many items it has
  const categoryTile = c => el('button', { type: 'button', class: 'cx-cat', 'data-id': c.id, style: `--cat:${c.color}`, onclick: () => { category = c.id; renderMenuBody(); } },
    el('span', { class: 'cx-ci' }, c.icon ? el('img', { src: c.icon, alt: '', draggable: 'false' }) : null),
    el('span', { class: 'cx-cat-copy' }, el('b', {}, c.name), el('span', {}, plural(c.items.length, 'item'))));
  const categoryPill = (c, on) => el('button', { type: 'button', class: `cx-pl${on ? ' on' : ''}`, 'data-id': c.id, 'aria-pressed': String(on), onclick: () => { category = c.id; renderMenuBody(); } }, c.name);

  // The menu in each display style (Settings > Counter > Menu display style). Search results show in the same cards.
  // grid: "All categories" and the category tiles; a category: "‹ All categories", its colour bar, name and count, then
  //   its items, three across.
  // pills (the default): the category pills, wrapping, then the selected category's items, three across.
  // rail: the category pills down the left (it scrolls), the items two across beside them.
  function menuArea(style = menuStyle) {
    const q = query.trim();
    if (q) {
      const found = matches();
      return [el('h3', { class: 'cx-h' }, found.length ? `${plural(found.length, 'result')} for “${q}”` : `No items match “${q}”`), scroller(resultGrid(found, style === 'rail' ? 2 : 3))];
    }
    const list = categoriesInOrder();
    if (style === 'grid') {
      const c = category && categoryById.get(category);
      if (!c) return [el('h3', { class: 'cx-h' }, 'All categories'), scroller(el('div', { class: 'cx-cats', 'data-arrange': 'categories' }, ...list.map(categoryTile)))];
      return [el('div', { class: 'cx-crumb' },
        el('button', { type: 'button', class: 'cx-bk', onclick: () => { category = null; renderMenuBody(); } }, mi('chevron_left', 24), 'All categories'),
        el('i', { style: `background:${c.color}`, 'aria-hidden': 'true' }), el('b', {}, c.name), el('span', { class: 'cnt' }, plural(c.items.length, 'item'))),
        scroller(itemGrid(c, 3))];
    }
    const c = (category && categoryById.get(category)) || list[0];
    const pills = list.map(x => categoryPill(x, x === c));
    if (style === 'rail') return [el('div', { class: 'cx-split' }, el('div', { class: 'cx-rail', 'data-arrange': 'categories' }, ...pills), scroller(itemGrid(c, 2)))];
    return [el('div', { class: 'cx-pills', 'data-arrange': 'categories' }, ...pills), scroller(itemGrid(c, 3))];
  }
  const scrollMenu = { key: '', top: 0 };
  function renderMenuBody() {
    saveDraft(); // every change to the order or to the menu view comes through here, so it is always kept
    if (drag) endDrag(true, false);
    const area = dialog.querySelector('.cx-area'); if (!area) return;
    const view = `${menuStyle}|${query.trim() ? `q:${query.trim()}` : category || ''}`;
    const was = area.querySelector('.cx-scroll')?.scrollTop || 0;
    area.replaceChildren(...menuArea());
    // The same view keeps where it was scrolled; another one starts at the top
    const scroll = area.querySelector('.cx-scroll'); if (scroll) scroll.scrollTop = view === scrollMenu.key ? was : 0;
    scrollMenu.key = view;
  }

  // ---------- rearranging the menu ----------
  // Hold a category (tile, pill or rail pill) or an item card: they all jiggle and the one held follows the finger, the
  // others making room as it passes over them. Let go to keep the new order (kept on this device). A tap anywhere else,
  // or Back, finishes; while they jiggle, a tap doesn't add an item or open a category. Search results keep the menu's
  // order.
  let arranging = false, drag = null, press = null, suppressClick = false;
  function setArranging(on) {
    if (arranging === on) return;
    if (!on && drag) endDrag(true, false);
    arranging = on; dialog.querySelector('.cx-shell')?.classList.toggle('arranging', on);
  }
  // Where a tile is laid out (its jiggle and any slide in progress left out), so tiles passing by never change the
  // place under the finger
  const placeOf = tile => { const r = tile.parentElement.getBoundingClientRect(); return { left: r.left + tile.offsetLeft, top: r.top + tile.offsetTop, width: tile.offsetWidth, height: tile.offsetHeight }; };
  // The tile that follows the finger: the tile itself as it is at rest (no shadow or frame of its own), kept in the same
  // list so it looks exactly the same (it floats above everything, out of the list's layout)
  function ghostOf(tile, r) {
    const ghost = tile.cloneNode(true);
    ghost.classList.add('cx-ghost'); ghost.removeAttribute('data-id'); ghost.removeAttribute('data-tile'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
    for (const node of ghost.querySelectorAll('button')) node.tabIndex = -1;
    Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
    tile.parentElement.append(ghost);
    return ghost;
  }
  function startDrag(tile, pointerId, x, y) {
    const list = tile.parentElement; if (!list?.dataset.arrange || !tile.isConnected) return;
    setArranging(true);
    const r = placeOf(tile), ghost = ghostOf(tile, r);
    tile.classList.add('cx-origin');
    drag = { list, tile, pointerId, ghost, ox: x - (r.left + r.width / 2), oy: y - (r.top + r.height / 2), start: [...list.children].map(n => n.dataset.id) };
    try { list.setPointerCapture(pointerId); } catch {}
  }
  function moveDrag(x, y) {
    const d = drag; d.ghost.style.left = `${x - d.ox}px`; d.ghost.style.top = `${y - d.oy}px`;
    const tiles = [...d.list.children].filter(n => n.dataset.id);
    const over = tiles.find(t => { if (t === d.tile) return false; const p = placeOf(t); return x >= p.left && x <= p.left + p.width && y >= p.top && y <= p.top + p.height; });
    if (!over) return;
    // The tiles that change place slide from where they are shown to their new place
    const before = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
    tiles.forEach(t => t.getAnimations().forEach(a => { if (a.id === 'cx-slide') a.cancel(); }));
    if (tiles.indexOf(d.tile) < tiles.indexOf(over)) over.after(d.tile); else over.before(d.tile);
    for (const t of tiles) {
      if (t === d.tile) continue;
      const a = before.get(t), b = t.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      try { const run = t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' }); run.id = 'cx-slide'; } catch {}
    }
  }
  // Let go: the order shown is kept. Cancelled: the tiles go back to how they were.
  function endDrag(cancel, rerender = true) {
    const d = drag; if (!d) return; drag = null;
    d.ghost.remove(); d.tile.classList.remove('cx-origin');
    const ids = [...d.list.children].map(n => n.dataset.id).filter(Boolean);
    if (!cancel && ids.join('|') !== d.start.join('|')) saveMenuOrder(d.list.dataset.arrange === 'categories' ? { kind: 'categories' } : { kind: 'items', catId: d.list.dataset.cat }, ids);
    if (rerender) renderMenuBody();
  }
  root.addEventListener('pointerdown', event => {
    const tile = event.target.closest?.('[data-arrange] > [data-id]');
    if (arranging && !drag && !tile) setArranging(false); // a tap anywhere else finishes rearranging
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
    if (!event.target.closest?.('[data-arrange]')) return;
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

  // ---------- options and notes ----------
  // An item's options sheet (its modifier groups): to add it (the required choices start on their defaults), or to change
  // a line's choices (tap one of its modifiers; that line only). Its note: free text for the kitchen, that line only.
  // (Both are simple sheets until their designs come.)
  function openItemSheet(key) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    const mods = [...(line.mods || [])];
    for (const g of groupsOf(line.id)) if (g.required && !mods.some(m => optionOf.get(m)?.group === g.id)) mods.push(g.default || g.options[0].id);
    itemSheet = { id: line.id, key, mods: cleanMods(line.id, mods) }; sheet = 'item'; render();
  }
  function openNoteSheet(key) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    noteKey = key; noteDraft = line.note || ''; sheet = 'note'; render();
  }

  // ---------- Print bill ----------
  // The bill for the order on screen: each item with its modifiers and note under it, then the sums. The RESTRO Android
  // app prints it on the restaurant's printer (RESTRODevice.printer.printBill, ANDROID-BRIDGE.md); in a browser it goes
  // to the browser's printing.
  function billOf(o = order) {
    const t = totalsOf(o), shop = (localStorage.getItem('restro.restaurantName') || '').trim();
    return {
      restaurant: shop && shop !== 'RESTAURANT NAME' ? shop : '', number: o.number ? ticket(o.number) : null, at: Date.now(),
      type: typeLabel[o.type || DEFAULT_TYPE], table: usesTable(o) ? tableName(o.table) : '', customer: o.customer ? o.customer.name : '', pager: cleanPager(o.pager) || null,
      lines: o.lines.map(l => ({ name: items.get(l.id).name, qty: l.qty, each: eachOf(l), total: eachOf(l) * l.qty, modifiers: (l.mods || []).map(modLabel), note: l.note || '' })),
      subtotal: t.subtotal / 100, tax: t.tax / 100, taxLabel: menu.taxLabel, total: t.total / 100
    };
  }
  function printBill() {
    if (!order.lines.length) return;
    const bill = billOf(), printer = window.RESTRODevice?.printer;
    if (typeof printer?.printBill === 'function') {
      Promise.resolve(printer.printBill(bill)).then(ok => toast(ok === false ? 'The bill didn’t print' : 'Bill sent to the printer'), () => toast('The bill didn’t print'));
      return;
    }
    let page = document.querySelector('#print-bill');
    if (!page) { page = el('div', { id: 'print-bill', 'aria-hidden': 'true' }); document.body.append(page); }
    const r = n => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    page.replaceChildren(
      bill.restaurant ? el('h1', {}, bill.restaurant) : null,
      el('p', {}, [bill.number ? `Order ${bill.number}` : 'Bill', new Date(bill.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })].join(' · ')),
      el('p', {}, [bill.type, bill.table ? `Table ${bill.table}` : '', bill.customer, bill.pager ? `Pager ${bill.pager}` : ''].filter(Boolean).join(' · ')),
      el('table', {}, ...bill.lines.map(l => el('tbody', {},
        el('tr', {}, el('td', {}, `${l.qty} × ${l.name}`), el('td', {}, r(l.total))),
        ...l.modifiers.map(m => el('tr', { class: 'sub' }, el('td', { colspan: '2' }, m))),
        l.note ? el('tr', { class: 'sub note' }, el('td', { colspan: '2' }, l.note)) : null))),
      el('table', { class: 'sums' }, el('tbody', {},
        el('tr', {}, el('td', {}, 'Subtotal'), el('td', {}, r(bill.subtotal))),
        el('tr', {}, el('td', {}, bill.taxLabel), el('td', {}, r(bill.tax))),
        el('tr', { class: 'total' }, el('td', {}, 'Total'), el('td', {}, r(bill.total))))));
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

  function sheetView() {
    if (!sheet) return null;
    const t = totals();
    const close = el('button', { type: 'button', class: 'ctr-icon-button', 'aria-label': 'Close', onclick: () => { sheet = null; render(); } }, svg(ICON.close));
    let body;
    // An item's options (adding it, or changing a line's choices): each modifier group with its choices; a required one
    // (spice level) always has one, which can be changed but not cleared. The button shows the price of one.
    if (sheet === 'item' && itemSheet) {
      const s = itemSheet, item = items.get(s.id), line = s.key ? order.lines.find(l => keyOf(l) === s.key) : null;
      if (!item || (s.key && !line)) { sheet = null; itemSheet = null; return null; }
      const each = item.price + s.mods.reduce((n, m) => n + (optionOf.get(m)?.price || 0), 0);
      const shut = () => { sheet = null; itemSheet = null; render(); };
      const toggle = (g, o) => {
        const on = s.mods.includes(o.id);
        if (g.required) { if (on) return; s.mods = [...s.mods.filter(m => optionOf.get(m)?.group !== g.id), o.id]; }
        else s.mods = on ? s.mods.filter(m => m !== o.id) : [...s.mods, o.id];
        s.mods = cleanMods(s.id, s.mods); render();
      };
      const done = () => { const mods = cleanMods(s.id, s.mods), key = s.key; sheet = null; itemSheet = null; if (key) setMods(key, mods); else addLine(s.id, mods); };
      return el('div', { class: 'cx-sheet-wrap', onclick: e => { if (e.target === e.currentTarget) shut(); } },
        el('div', { class: 'cx-sheet', role: 'dialog', 'aria-label': `${item.name}: choices` },
          el('div', { class: 'cx-sheet-head' },
            el('div', {}, el('h3', {}, item.name), el('p', {}, rupees(item.price))),
            el('button', { type: 'button', class: 'cx-x', 'aria-label': 'Close', onclick: shut }, mi('close', 22))),
          ...groupsOf(s.id).map(g => el('div', { class: 'cx-og', role: g.required ? 'radiogroup' : 'group', 'aria-label': g.name },
            el('div', { class: 'cx-og-head' }, el('strong', {}, g.name), el('span', {}, g.required ? 'Choose one' : 'Optional')),
            el('div', { class: 'cx-og-options' }, ...g.options.map(o => {
              const on = s.mods.includes(o.id);
              return el('button', { type: 'button', role: g.required ? 'radio' : 'checkbox', 'aria-checked': String(on), class: `cx-opt${on ? ' on' : ''}${g.kind === 'spice' ? ' sp' : ''}`, onclick: () => toggle(g, o) },
                o.label, o.price ? el('span', { class: 'cx-opt-price' }, `+₹${o.price.toLocaleString('en-IN')}`) : null);
            })))),
          el('button', { type: 'button', class: 'cx-confirm', onclick: done }, s.key ? 'Update' : 'Add to order', el('span', {}, `${rupees(each)}${s.key && line.qty > 1 ? ' ea' : ''}`))));
    }
    // A line's note for the kitchen: one text field and Save. Saving it empty removes the note.
    if (sheet === 'note' && noteKey) {
      const line = order.lines.find(l => keyOf(l) === noteKey);
      if (!line) { sheet = null; noteKey = null; return null; }
      const item = items.get(line.id);
      const shut = () => { sheet = null; noteKey = null; render(); };
      const field = el('textarea', { id: 'counter-note', class: 'cx-note-field', rows: '3', maxlength: '200', enterkeyhint: 'done', placeholder: 'For the kitchen, e.g. pack the gravy separately', 'aria-label': `Note for ${item.name}` });
      field.value = noteDraft;
      field.addEventListener('input', () => { noteDraft = field.value; });
      const save = () => { const key = noteKey, text = field.value; sheet = null; noteKey = null; setNote(key, text); };
      field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } });
      setTimeout(() => { if (sheet !== 'note' || document.activeElement === field) return; field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
      return el('div', { class: 'cx-sheet-wrap', onclick: e => { if (e.target === e.currentTarget) shut(); } },
        el('div', { class: 'cx-sheet cx-note-sheet', role: 'dialog', 'aria-label': `Note for ${item.name}` },
          el('div', { class: 'cx-sheet-head' },
            el('div', {}, el('h3', {}, line.note ? 'Edit note' : 'Add note'), el('p', {}, item.name)),
            el('button', { type: 'button', class: 'cx-x', 'aria-label': 'Close', onclick: shut }, mi('close', 22))),
          field,
          el('div', { class: 'cx-sheet-actions' },
            line.note ? el('button', { type: 'button', class: 'cx-plain', onclick: () => { field.value = ''; save(); } }, 'Remove note') : null,
            el('button', { type: 'button', class: 'cx-confirm', onclick: save }, 'Save'))));
    }

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
    // The number pad for a line's quantity (Counter Update 3): a card beside the order, level with the line, the rest of
    // the screen as it is. "<dish> · quantity", the value (the line's quantity until a key is pressed) and its price
    // each; 1–9, ⌫, 0 and a green Done. Done sets it (0 takes the dish off, with Undo); a tap outside closes it unchanged.
    if (sheet === 'qty') {
      const line = order.lines.find(l => keyOf(l) === qtyKey);
      if (!line) { sheet = null; return null; }
      const item = items.get(line.id), key = keyOf(line);
      const shut = () => { sheet = null; qtyKey = null; render(); };
      const done = () => { const n = parseInt(qtyValue, 10); sheet = null; qtyKey = null; if (Number.isFinite(n) && n !== line.qty) setQty(key, n); else render(); };
      const press = k => {
        if (k === 'done') { done(); return; }
        if (k === '⌫') qtyValue = qtyValue.slice(0, -1);
        else if (qtyValue.length < 3) qtyValue = (qtyValue === '0' ? '' : qtyValue) + k;
        render();
      };
      setTimeout(() => {
        if (dialog._padKeys) return; dialog._padKeys = true;
        document.addEventListener('keydown', e => {
          if (sheet !== 'qty' || !dialog.open) return;
          if (/^\d$/.test(e.key)) { e.preventDefault(); dialog.querySelector(`.cx-np-keys [data-key="${e.key}"]`)?.click(); }
          else if (e.key === 'Backspace') { e.preventDefault(); dialog.querySelector('.cx-np-keys [data-key="⌫"]')?.click(); }
          else if (e.key === 'Enter') { e.preventDefault(); dialog.querySelector('.cx-np-keys [data-key="done"]')?.click(); }
        }, true);
      });
      return [el('div', { class: 'cx-np-catch', onclick: shut }),
        el('div', { class: 'cx-np', role: 'dialog', 'aria-label': `Quantity for ${item.name}`, 'data-line': key },
          el('h4', {}, `${item.name} · quantity`),
          el('div', { class: 'cx-np-disp' }, el('output', { 'aria-live': 'polite' }, qtyValue || String(line.qty)), el('small', {}, `${rupees(eachOf(line))} ea`)),
          el('div', { class: 'cx-np-keys' }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'done'].map(k =>
            el('button', { type: 'button', class: k === 'done' ? 'ok' : '', 'data-key': k, 'aria-label': k === '⌫' ? 'Backspace' : k === 'done' ? 'Done' : k, onclick: () => press(k) }, k === 'done' ? 'Done' : k))))];
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
    // Assign Pager: the pagers by number; a pager on another open order shows "In use" (it can still be chosen). A held
    // order's pager was released when it was held (a saved order's held copy has the saved order's).
    if (sheet === 'pager') {
      // (a pager is in use while another order has it, until the pager is docked back, whether that order is open or
      // closed; a saved order's held copy has the saved order's)
      const mine = o => (order.uid ? idOf(o) === order.uid : o.number === order.number);
      const inUse = new Set([...held.filter(h => h.number).map(h => cleanPager(h.pager)), ...[...pagerHolders(loadOrders())].filter(([, o]) => !mine(o)).map(([n]) => n)].filter(Boolean));
      const choose = n => { order.pager = n; order.pagerAt = n ? Date.now() : null; sheet = null; render(); }; // handed out now (even the same number again)
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
    // Schedule: the day and time the customer wants the order ready. It goes to the kitchen the preparation time before.
    // Schedule works from the start: the time can be picked before any item is added. The day is picked on top; the time
    // with three wheels, Hour · Minutes (in 5s) · AM or PM, each scrolled (or tapped) until the value sits in the band.
    if (sheet === 'schedule') {
      const nowMs = Date.now(), today = new Date(), prep = prepMinutes();
      const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
      if (!scheduleDraft) {
        // The time already on the order, or else the soonest the kitchen can have it ready (now plus the preparation
        // time, on to the next 5 minutes).
        const r = new Date(order.readyAt || Math.ceil((nowMs + prep * 60000) / 300000) * 300000), day = days.findIndex(x => dayKey(x) === dayKey(r));
        scheduleDraft = { day: Math.max(day, 0), hour: r.getHours(), minute: r.getMinutes() - r.getMinutes() % 5 };
      }
      const d = scheduleDraft;
      const at = () => new Date(days[d.day].getFullYear(), days[d.day].getMonth(), days[d.day].getDate(), d.hour, d.minute).getTime();
      const dayName = i => i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[i].toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
      const pickBtn = (label, on, onclick) => el('button', { type: 'button', class: `ctr-pick${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick }, label);
      const summary = el('div', { class: 'ctr-sched-summary', 'aria-live': 'polite' });
      const confirm = el('button', { type: 'button', class: 'primary-button ctr-complete' }, 'Schedule');
      // The summary and the Schedule button follow the wheels as they turn (the sheet itself is not redrawn).
      const update = () => {
        const readyAt = at(), now = Date.now(), ok = readyAt > now, kitchenAt = readyAt - prep * 60000;
        summary.replaceChildren(...(ok
          ? [el('strong', {}, `Ready by ${d.day < 2 ? dayName(d.day).toLowerCase() : days[d.day].toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeOf(readyAt)}`),
             el('span', {}, kitchenAt <= now ? 'Goes to the kitchen now' : `Goes to the kitchen at ${whenShort(kitchenAt)} (${prep} min before)`)]
          : [el('strong', {}, `${timeOf(readyAt)} has passed`), el('span', {}, 'Choose a later time')]));
        confirm.disabled = !ok; confirm.onclick = () => setSchedule(at());
      };
      // A wheel: the value in the middle band is the one picked. Scroll it, tap a value, or use the arrow keys.
      const ROW = 40;
      const wheel = (label, values, index, pick) => {
        let current = index;
        const list = el('div', { class: 'ctr-wheel-list', role: 'listbox', tabindex: '0', 'aria-label': label });
        const items = values.map((v, i) => el('div', { class: 'ctr-wheel-item', role: 'option', 'aria-selected': String(i === index), onclick: () => list.scrollTo({ top: i * ROW, behavior: 'smooth' }) }, v));
        list.append(...items);
        list.addEventListener('scroll', () => {
          const i = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / ROW)));
          if (i === current) return;
          items[current].setAttribute('aria-selected', 'false'); items[i].setAttribute('aria-selected', 'true'); current = i;
          pick(i); update();
        });
        list.addEventListener('keydown', e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          list.scrollTo({ top: Math.max(0, Math.min(values.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1))) * ROW, behavior: 'smooth' });
        });
        queueMicrotask(() => { list.scrollTop = index * ROW; }); // once the sheet is on screen
        return el('div', { class: 'ctr-wheel' }, el('div', { class: 'ctr-wheel-band', 'aria-hidden': 'true' }), list);
      };
      const hours = Array.from({ length: 12 }, (_, i) => String(i + 1)), minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
      const wheels = el('div', { class: 'ctr-wheels' },
        wheel('Hour', hours, (d.hour + 11) % 12, i => { d.hour = (i + 1) % 12 + (d.hour >= 12 ? 12 : 0); }),
        wheel('Minutes', minutes, d.minute / 5, i => { d.minute = i * 5; }),
        wheel('AM or PM', ['AM', 'PM'], d.hour >= 12 ? 1 : 0, i => { d.hour = d.hour % 12 + (i ? 12 : 0); }));
      update();
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet ctr-sched-sheet', role: 'dialog', 'aria-label': 'Schedule order' },
          el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Schedule order'), close),
          el('div', { class: 'ctr-sched-days', role: 'group', 'aria-label': 'Day' }, ...days.map((_, i) => pickBtn(dayName(i), d.day === i, () => { d.day = i; render(); }))),
          wheels,
          summary,
          el('div', { class: 'ctr-sched-actions' },
            order.readyAt ? el('button', { type: 'button', class: 'ctr-secondary', onclick: () => { order.readyAt = null; scheduleDraft = null; sheet = null; render(); toast('Schedule removed'); } }, 'Remove schedule') : null,
            confirm)));
    }
    // Orders: every saved order, newest first, with its payment status (Paid or Not paid) and where it is with the kitchen.
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
          el('dt', {}, 'Subtotal'), el('dd', {}, money(o.subtotal || 0)),
          el('dt', {}, menu.taxLabel), el('dd', {}, money(o.tax || 0)),
          el('dt', { class: 'ctr-total' }, 'Total'), el('dd', { class: 'ctr-total' }, money(o.total))),
        el('p', { class: 'ctr-history-pay' }, o.paidAt
          ? [`Paid ${timeOf(o.paidAt)}`, methodLabel[o.method] || 'Cash', Number.isFinite(o.received) ? `received ${money(o.received)}` : '', o.change > 0 ? `change ${money(o.change)}` : ''].filter(Boolean).join(' · ')
          : 'Not paid'));
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
          el('span', { class: 'ctr-history-side' }, el('strong', {}, money(o.total)), el('span', { class: o.paidAt ? 'ctr-paid' : 'ctr-unpaid' }, o.paidAt ? 'Paid' : 'Not paid')));
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
    const focusId = document.activeElement?.id;
    if (highlight && !order.lines.length) highlight = false; // the last item went: back to the usual view
    // The order type choices and the three-line menu dim the whole screen, the top banner too; what they show stays
    // above the dimming.
    root.replaceChildren(
      el('div', { class: `cx-shell${highlight ? ' highlight' : ''}${arranging ? ' arranging' : ''}`, 'data-style': menuStyle }, orderPanel(), menuSide()),
      typeMenu || optionsMenu ? el('div', { class: 'cx-scrim', onclick: () => (typeMenu ? openTypeMenu(false) : openOptions(false)) }) : '',
      ...[sheetView()].flat().filter(Boolean));
    renderMenuBody();
    const lines = dialog.querySelector('.cx-lines');
    if (lines && dialog.open) { lines.scrollTop = scrollMemo.lines; scrollMemo.lines = lines.scrollTop; }
    placeQtyPad();
    // Typing carries on where it was (search, or a note)
    if (focusId === 'counter-search' || focusId === 'counter-note') { const f = dialog.querySelector(`#${focusId}`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
  }
  // The number pad: 16 to the right of the order panel, its top 30.6 below the top of the line it is for (as in the
  // design), and always on the screen
  function placeQtyPad() {
    const pad = dialog.querySelector('.cx-np'), panel = dialog.querySelector('.cx-order'); if (!pad || !panel) return;
    const line = [...dialog.querySelectorAll('.cx-line')].find(li => li.dataset.line === pad.dataset.line);
    const p = panel.getBoundingClientRect(), u = p.width / 532, top = dialog.getBoundingClientRect().top + 12 * u;
    const want = line ? line.getBoundingClientRect().top + 30.6 * u : top;
    pad.style.left = `${p.right + 16 * u}px`;
    pad.style.top = `${Math.max(top, Math.min(want, innerHeight - pad.offsetHeight - 12 * u))}px`;
  }
  function toast(message) { if (typeof window.toast === 'function') window.toast(message); else document.querySelector('#toast') && (document.querySelector('#toast').textContent = message); }

  function goBack() {
    if (!dialog.open) return false;
    if (typeMenu) { openTypeMenu(false); return true; }
    if (optionsMenu) { openOptions(false); return true; }
    if (sheet && sheet !== 'receipt') { sheet = null; itemSheet = null; noteKey = null; render(); return true; }
    if (sheet === 'receipt') { sheet = null; receipt = null; render(); return true; }
    if (highlight) { setHighlight(false); return true; } // a sheet opened from it closes first
    if (panelArranging) { setPanelArranging(false); return true; }
    if (arranging) { setArranging(false); return true; }
    if (selected) { selected = null; render(); return true; } // a selected line goes back to a plain one
    if (query) { query = ''; render(); return true; }
    if (category && menuStyle === 'grid') { category = null; renderMenuBody(); return true; } // inside a category: back to all of them
    if (fromFloor && window.RestroFloor) { fromFloor = false; window.RestroFloor.open(); return true; } // opened from a table: Back returns to the Floor
    if (fromOrders && window.RestroOrders) { fromOrders = false; window.RestroOrders.open(); return true; } // opened from Orders: Back returns there
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  // Tapping anywhere outside the selected line puts it back to a plain line (the number pad and the sheets opened from it
  // leave it as it is). The tap still does its own job: on another line, that line is selected instead.
  dialog.addEventListener('click', event => {
    if (!selected || !dialog.open) return;
    if (event.target.closest?.('.cx-line')?.dataset.line === selected || event.target.closest?.('.cx-np, .cx-np-catch, .cx-sheet-wrap, .ctr-sheet-wrap')) return;
    selected = null; render();
  }, true);
  // Remember where the order list was scrolled while Counter is on screen (a hidden list reports 0, so it is ignored then).
  root.addEventListener('scroll', event => {
    if (dialog.open && event.target.classList?.contains('cx-lines')) scrollMemo.lines = event.target.scrollTop;
  }, true);
  // Leaving Counter ends rearranging, the selection, the number pad and the Undo bar; the order, the page and everything
  // else stay as they were.
  dialog.addEventListener('close', () => {
    if (press) { clearTimeout(press.timer); press = null; } if (drag) endDrag(true, false); arranging = false;
    if (panelPress) { clearTimeout(panelPress.timer); panelPress = null; } if (panelDrag) endPanelDrag(true); panelArranging = false;
    typeMenu = false; optionsMenu = false; deleteArmed = false; selected = null; clearUndo();
    if (sheet === 'qty') { sheet = null; qtyKey = null; }
  });
  // Toasts must show above this full-screen app.
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode); else if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  // Shown first, then drawn, so the lists can return to where they were scrolled. Nothing is reset here.
  function openCounter() { typeMenu = false; optionsMenu = false; deleteArmed = false; highlight = false; if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach(d => d.close()); dialog.showModal(); render(); dialog.querySelector('#counter-title')?.focus({ preventScroll: true }); }
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
      const list = loadOrders(), out = new Set([...pagerHolders(list).values()].map(idOf)), back = pagersBack(list);
      return JSON.parse(JSON.stringify(allOrders())).map(o => ({ ...o, pagerOut: out.has(idOf(o)), pagerBackAt: back.get(idOf(o)) || null }));
    },
    // The held orders, newest first (as the Orders app's Held view shows them): when each was held, its type, its table
    // (when it goes to one) or customer, the server, the total and its items. Their tables and pagers were released.
    held() {
      return held.filter(h => h && typeof h.heldId === 'string' && Array.isArray(h.lines)).map(h => {
        const r = restoreOrder(h);
        return { heldId: h.heldId, savedAt: cleanTime(h.savedAt) || Date.now(), type: r.type, split: r.split, table: r.number && usesTable(r) ? r.table : '', customer: r.customer,
          server: typeof h.server === 'string' ? h.server : null, total: Number.isFinite(h.total) ? h.total : totalsOf(r).total, number: r.number, lines: r.lines };
      }).sort((a, b) => b.savedAt - a.savedAt);
    },
    // From the Held view: Counter opens on that held order, to carry on with it (the order on screen goes to Held first
    // if it has anything not saved).
    resumeHeld(id) { if (typeof id !== 'string' || !held.some(h => h.heldId === id)) return; openCounter(); fromFloor = false; fromOrders = false; resume(id); },
    goBack,
    tablesInUse() {
      // (a held order's table was freed when it was held; a saved order's held copy has the saved order's)
      const used = [...loadOrders().filter(o => !o.paidAt), ...held.filter(h => h.number)].filter(usesTable).map(o => o.table);
      if (order.lines.length && usesTable(order)) used.push(order.table);
      return used;
    },
    get order() { return JSON.parse(JSON.stringify(order)); },
    // Settings > Counter > Menu display style
    menuStyles: MENU_STYLES,
    get menuStyle() { return MENU_STYLES.find(x => x.id === menuStyle); },
    setMenuStyle(id) {
      if (!MENU_STYLES.some(x => x.id === id)) return false;
      menuStyle = id; try { localStorage.setItem(STYLE_KEY, JSON.stringify(id)); } catch {}
      if (dialog.open) render(); else renderMenuBody();
      window.dispatchEvent(new CustomEvent('restro:counter-style-changed', { detail: { id } }));
      return true;
    },
    // A still picture of the Counter as it is now, in a display style: for the previews in Settings. Exactly what Counter
    // shows when it opens again (the order on screen and where its list is scrolled, the buttons and the menu in this
    // tablet's order, the category or search it was on), in that style. What closes when Counter is left (the order
    // types, the menu, Highlight order, a selected line, the Undo bar) isn't in it. Nothing in it can be tapped, focused
    // or read out. The order list's
    // place is set once the picture is on screen (data-scroll-top).
    preview(style = menuStyle) {
      if (!MENU_STYLES.some(x => x.id === style)) style = menuStyle;
      const was = { typeMenu, optionsMenu, deleteArmed, highlight, panelArranging, selected, undo };
      typeMenu = false; optionsMenu = false; deleteArmed = false; highlight = false; panelArranging = false; selected = null; undo = null;
      try {
        const shell = el('div', { class: 'cx-shell', 'data-style': style }, orderPanel(), menuSide());
        shell.querySelector('.cx-area')?.replaceChildren(...menuArea(style));
        for (const node of shell.querySelectorAll('[id]')) node.removeAttribute('id');
        shell.querySelector('.cx-lines')?.setAttribute('data-scroll-top', String(scrollMemo.lines));
        return el('div', { class: 'ctr-root cx-still', inert: true, 'aria-hidden': 'true' }, shell);
      } finally { ({ typeMenu, optionsMenu, deleteArmed, highlight, panelArranging, selected, undo } = was); }
    }
  });
})();
