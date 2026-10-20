'use strict';
// Counter: take an order, total it with GST, and settle it (cash for now).
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
  // The six tiles of the order panel, in the order they were rearranged (hold a tile, as with the menu; kept on this device).
  const PANEL_KEY = 'restro.counter.panelOrder.v1';
  const PANEL_TILES = ['type', 'customer', 'pager', 'modify', 'schedule', 'hold'];
  let panelOrder = ordered(PANEL_TILES, load(PANEL_KEY, null));
  const tileAt = key => ({ 'data-tile': key, style: `order:${panelOrder.indexOf(key)}` });
  let panelArranging = false, panelDrag = null, panelGesture = null, panelHold = null, panelSuppress = false;
  // Ticket numbers come from sync (in blocks from the main system or the cloud once there are other tablets, so no two
  // tablets give the same number); on its own a tablet counts on as before.
  const nextNumber = () => { if (window.RestroSync) return window.RestroSync.nextNumber(); const n = Number(load(NUM_KEY, 1001)) || 1001; store(NUM_KEY, n + 1); return n; };
  const idOf = o => o.uid || `n${o.number}`; // an order's id everywhere (orders from before sync are known by their number)

  // ---------- state ----------
  // A new order starts with no order type. Dine in can have a table (picked on the Floor); every other order a customer.
  // Any order can have a pager, and a ready-by time (Schedule). number: set once the order is saved (Save or Pay).
  const blankOrder = () => ({ type: null, split: false, table: '', customer: null, pager: 0, readyAt: null, holdUntil: null, heldId: null, number: null, uid: null, lines: [] });
  const cleanCustomer = c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
    ? { id: c.id, name: c.name.slice(0, 60), mobile: String(c.mobile || '').replace(/\D/g, '').slice(0, 15), code: String(c.code || '').replace(/\D/g, '').slice(0, 4), address: String(c.address || '').slice(0, 200) } : null;
  const TYPES = ['dine-in', 'takeaway', 'delivery', 'phone'];
  const cleanPager = n => Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
  const cleanTime = t => Number.isFinite(t) && t > 0 ? t : null;
  // An order read back from storage (the draft, Held or Orders), keeping only what is valid.
  const restoreOrder = o => {
    const type = TYPES.includes(o.type) ? o.type : null;
    return { type, split: o.split === true, table: typeof o.table === 'string' ? o.table : '', customer: cleanCustomer(o.customer),
      pager: cleanPager(o.pager), readyAt: cleanTime(o.readyAt), holdUntil: cleanTime(o.holdUntil),
      heldId: typeof o.heldId === 'string' ? o.heldId : null, number: Number.isInteger(o.number) ? o.number : null, uid: typeof o.uid === 'string' ? o.uid : null,
      lines: (Array.isArray(o.lines) ? o.lines : []).filter(l => l && items.has(l.id) && Number.isInteger(l.qty) && l.qty > 0 && l.qty < 1000).map(l => ({ id: l.id, qty: l.qty, type: TYPES.includes(l.type) ? l.type : type })) };
  };
  // An order with no type chosen goes as Dine in, with no table: a table chosen earlier is set aside (as when the type
  // changes to Takeaway) and comes back if Dine in is chosen again.
  const DEFAULT_TYPE = 'dine-in';
  const usesTable = o => Boolean(o.table) && (o.type === 'dine-in' || (Boolean(o.type) && o.split));
  // With Modify on (called "split" in the code), each line keeps its own type; otherwise every line follows the order type.
  const typeOf = (o, line) => (o.split ? line.type || o.type : o.type) || DEFAULT_TYPE;
  const lineType = line => typeOf(order, line);
  // What a saved order looks like, to tell whether the copy on screen has changes not saved yet.
  const signature = o => JSON.stringify([o.type, o.split, o.table, o.customer?.id || '', o.pager || 0, o.readyAt || 0, o.lines.map(l => [l.id, l.qty, typeOf(o, l)])]);
  const keyOf = line => `${line.id}@${lineType(line)}`;
  let qtyKey = null, qtyValue = '';
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, typeMenu = false, optionsMenu = false, deleteArmed = false, highlight = false;
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
    const subtotal = o.lines.reduce((sum, line) => sum + items.get(line.id).price * 100 * line.qty, 0);
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
  function add(id) {
    const type = order.type, goesAs = type || DEFAULT_TYPE, line = order.lines.find(l => l.id === id && lineType(l) === goesAs);
    if (line) line.qty += 1; else order.lines.push({ id, qty: 1, type });
    selected = null; render();
    const row = dialog.querySelector(`[data-line="${id}@${goesAs}"]`); row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('just-added');
  }
  function setQty(key, qty) {
    order.lines = qty > 0 ? order.lines.map(l => keyOf(l) === key ? { ...l, qty } : l) : order.lines.filter(l => keyOf(l) !== key);
    if (qty <= 0) selected = null; render();
  }
  // Removing an item (swipe it left, or the Delete key on it) shows no message: the line just goes.
  function removeLine(key) { setQty(key, 0); }
  // Merge lines that ended up with the same item and type.
  function tidy() {
    const merged = [];
    for (const line of order.lines) {
      const type = lineType(line), same = merged.find(m => m.id === line.id && m.type === type);
      if (same) same.qty += line.qty; else merged.push({ id: line.id, qty: line.qty, type });
    }
    order.lines = merged;
  }
  function moveLine(key, type) {
    const line = order.lines.find(l => keyOf(l) === key); if (!line) return;
    line.type = type; tidy(); selected = `${line.id}@${type}`; render();
  }
  // Changing the order type puts every item on the new type, with Modify on or off (with Modify on, items can then be
  // moved to other types again). The same item on two types becomes one line. No type (null) means the default, Dine in.
  function setType(type) {
    if (order.type === type) return;
    order.type = type;
    order.lines.forEach(l => { l.type = type; }); tidy();
    selected = null; render();
  }
  // The options menu (the round button at the top of the divider): Highlight order and Delete order.
  function openOptions(open) {
    optionsMenu = open; deleteArmed = false; render();
    if (open) dialog.querySelector('.ctr-options-item:not(:disabled)')?.focus({ preventScroll: true });
  }
  // Highlight order: the order takes the whole left side, top to bottom, to go through and edit its items; the menu side
  // is dimmed. A tap on the dimmed side or Back ends it, and so does the last item going.
  function setHighlight(on) {
    highlight = on; optionsMenu = false; deleteArmed = false;
    if (on) scrollMemo.lines = 0; // the order shows from its first item
    render();
    if (!on) dialog.querySelector('.ctr-options')?.focus({ preventScroll: true });
  }
  // Anything on screen to delete: items, a type, a table, a customer, a pager, a ready time, Modify, or a saved order.
  const hasOrder = () => Boolean(order.lines.length || order.number || order.type || order.table || order.customer || order.pager || order.readyAt || order.split);
  // Delete order: the first tap asks again (Tap again to delete, until the menu closes); the second deletes the order
  // on screen. A saved order (opened from Orders, not paid) comes off Orders too.
  function tapDelete() {
    if (!deleteArmed) { deleteArmed = true; render(); dialog.querySelector('.ctr-options-item.danger')?.focus({ preventScroll: true }); return; }
    const n = order.number;
    if (n) { const list = loadOrders(), gone = o => (order.uid ? idOf(o) === order.uid : o.number === n) && !o.paidAt; list.filter(gone).forEach(o => window.RestroSync?.removed('orders', idOf(o))); storeOrders(list.filter(o => !gone(o))); }
    if (order.heldId) { window.RestroSync?.removed('held', order.heldId); held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    fresh(); toast(n ? `Order #${n} deleted` : 'Order deleted');
  }
  // Order type: the four types open right over the tile; picking one sets it (every item moves to it) and closes them.
  // Picking the type already chosen takes it off again: the tile shows Order type, and the order goes as Dine in.
  function openTypeMenu(open) {
    typeMenu = open; render();
    (open ? dialog.querySelector('.ctr-type-pop [aria-pressed="true"]') || dialog.querySelector('.ctr-type-pop .ctr-type-btn') : dialog.querySelector('.ctr-type-pick'))?.focus({ preventScroll: true });
  }
  function pickType(key) {
    typeMenu = false;
    setType(order.type === key ? null : key);
    dialog.querySelector('.ctr-type-pick')?.focus({ preventScroll: true });
  }
  function setSplit(on) {
    if (on) order.lines.forEach(l => { l.type = l.type || order.type; });
    order.split = on;
    if (!on) { order.lines.forEach(l => { l.type = order.type; }); tidy(); toast(`Modify off · all items ${typeLabel[order.type || DEFAULT_TYPE].toLowerCase()}`); }
    selected = null; render();
  }
  // Puts the order on screen in Held, until the end of the day.
  function hold() {
    if (!order.lines.length) return false;
    const entry = { ...order, heldId: order.heldId || window.RestroSync?.newId('h') || `h${Date.now()}`, savedAt: Date.now(), total: totals().total, holdUntil: endOfDay() };
    held = [entry, ...held.filter(h => h.heldId !== entry.heldId)].slice(0, 100); store(HELD_KEY, held);
    return true;
  }
  // Before another order takes the screen, the one on it goes to Held if it has anything not saved: a new order with
  // items, or a saved order with changes. A saved order with no changes is already in Orders.
  function park() {
    if (!order.lines.length || (order.number && signature(order) === baseline)) return false;
    return hold();
  }
  const fresh = () => { order = blankOrder(); baseline = null; opened = null; selected = null; sheet = null; typeMenu = false; optionsMenu = false; deleteArmed = false; highlight = false; scheduleDraft = null; render(); };
  // Sends the items not sent yet to the kitchen, as one kitchen ticket. There is no kitchen screen or printer yet,
  // so the ticket is recorded on the order. Returns how many items went.
  function sendToKitchen(entry, now = Date.now()) {
    if (!entry.sent || typeof entry.sent !== 'object') entry.sent = {};
    const lines = [];
    for (const l of entry.lines) { const key = `${l.id}@${l.type}`, n = l.qty - (Number(entry.sent[key]) || 0); if (n > 0) { lines.push({ id: l.id, name: l.name, qty: n, type: l.type }); entry.sent[key] = l.qty; } }
    if (!lines.length) return 0;
    entry.sentAt = entry.sentAt || now; entry.kots = [...(Array.isArray(entry.kots) ? entry.kots : []), { at: now, lines }].slice(-30);
    return lines.reduce((n, l) => n + l.qty, 0);
  }
  // Saves the order on screen in Orders (Save, or Pay with the payment) and sends it to the kitchen, unless it is
  // scheduled for later: then it goes at its ready time minus the preparation time. Saving again sends only what was added.
  function upsertOrder(pay) {
    const now = Date.now(), list = loadOrders();
    const prev = order.uid ? list.find(o => idOf(o) === order.uid && !o.paidAt) : order.number ? list.find(o => o.number === order.number && !o.paidAt) : null;
    const number = prev ? prev.number : nextNumber(), provisional = !prev && Boolean(window.RestroSync?.provisional);
    let entry = { uid: prev ? idOf(prev) : window.RestroSync?.newId('o') || `o${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, number, type: order.type || DEFAULT_TYPE, split: order.split, table: order.type ? order.table : '', customer: order.customer, pager: order.pager || 0, readyAt: order.readyAt || null,
      lines: order.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: items.get(l.id).price, qty: l.qty, type: lineType(l) })), ...totals(),
      createdAt: prev ? createdOf(prev) : now, savedAt: now, sent: prev && prev.sent && typeof prev.sent === 'object' ? { ...prev.sent } : {}, sentAt: prev ? cleanTime(prev.sentAt) : null, kots: prev && Array.isArray(prev.kots) ? prev.kots : [],
      method: pay ? pay.method : null, received: pay ? pay.received : null, change: pay ? pay.change : null, paidAt: pay ? new Date(now).toISOString() : null,
      // the server: whoever was signed in when the order was first saved (staff sign-in)
      server: prev && prev.server ? prev.server : window.RestroStaff?.current?.name || null, serverId: prev && prev.serverId ? prev.serverId : window.RestroStaff?.current?.id || null,
      // a number given while cut off from the main system stays provisional until the main system settles it
      ...(provisional || prev?.numberProvisional ? { numberProvisional: true } : {}), ...(prev && Number.isInteger(prev.numberWas) ? { numberWas: prev.numberWas } : {}) };
    // Changed on another tablet since it was opened here: both tablets' changes are kept (items added on both, and so on)
    if (prev && opened && window.RestroSync && JSON.stringify(prev) !== opened) entry = window.RestroSync.mergeRecord('orders', JSON.parse(opened), entry, prev);
    const sentNow = !entry.readyAt || kitchenTime(entry) <= now ? sendToKitchen(entry, now) : 0;
    storeOrders([entry, ...list.filter(o => idOf(o) !== entry.uid)]);
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    return { entry, sentNow, isNew: !prev };
  }
  // Save: the order goes to Orders (not paid yet) and to the kitchen; a new order starts.
  function saveOrder() {
    if (!order.lines.length) return;
    const { entry, sentNow, isNew } = upsertOrder(null);
    const kitchen = sentNow ? (isNew ? 'sent to kitchen' : `${sentNow} more item${sentNow === 1 ? '' : 's'} sent to kitchen`) : entry.readyAt && !entry.sentAt ? `kitchen at ${whenShort(kitchenTime(entry))}` : '';
    toast([`Order #${entry.number} saved`, kitchen].filter(Boolean).join(' · '));
    fresh();
  }
  // Hold (new orders): the ticket waits in Held until the end of the day, as the customer may call or come back.
  function holdTicket() {
    if (!order.lines.length || order.number) return;
    hold(); toast('On hold until the end of the day'); fresh();
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
    // A held copy of a saved order carries on with that order (unless it has been paid since).
    const saved = order.number ? loadOrders().find(o => (order.uid ? idOf(o) === order.uid : o.number === order.number) && !o.paidAt) : null;
    if (!saved) { order.number = null; order.uid = null; } else order.number = saved.number;
    baseline = saved ? signature(restoreOrder(saved)) : null; opened = saved ? JSON.stringify(saved) : null;
    sheet = null; selected = null; render(); toast('Order resumed');
  }
  // Opens a saved order that is not paid yet (by its id, or its number), to add items or take the payment.
  function openOrder(ref) {
    const saved = loadOrders().find(o => (typeof ref === 'string' ? idOf(o) === ref : o.number === ref) && !o.paidAt);
    if (order.number && (saved ? (order.uid ? order.uid === idOf(saved) : order.number === saved.number) : order.number === ref)) { sheet = null; render(); return; }
    if (!saved) return;
    park();
    order = restoreOrder(saved); baseline = signature(order); opened = JSON.stringify(saved);
    sheet = null; selected = null; render(); toast(`Order #${saved.number} opened`);
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
    window.RestroNotifications?.push({ id: `kitchen-${o.number}`, title: `Order #${o.number} sent to kitchen`, message, source: 'Counter', appId: 'register' });
    window.RestroSound?.play('alert');
    toast(`Order #${o.number} sent to kitchen · ready by ${whenShort(o.readyAt)}`);
  }
  setInterval(sweep, 20000);
  document.addEventListener('DOMContentLoaded', sweep);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sweep(); });
  window.addEventListener('restro:prep-time-changed', () => { sweep(); if (dialog.open && (sheet === 'orders' || sheet === 'schedule')) render(); });
  // Changes from another tablet (sync.js): Held and Orders show them at once, and so does the saved order on screen.
  window.addEventListener('restro:data-changed', e => {
    const names = e.detail?.collections || [];
    if (names.includes('held')) { held = load(HELD_KEY, []); if (!Array.isArray(held)) held = []; if (order.heldId && !order.number && !held.some(h => h.heldId === order.heldId)) order.heldId = null; }
    if (names.includes('orders') && (order.uid || order.number)) followOpenOrder();
    if (dialog.open && (names.includes('held') || names.includes('orders'))) render();
  });
  // An order numbered while this tablet was cut off from the main system, whose number someone else could have: the main
  // system gave it the next free number.
  window.addEventListener('restro:orders-renumbered', e => {
    const list = (e.detail?.orders || []).filter(r => Number.isInteger(r.from) && Number.isInteger(r.to));
    if (!list.length) return;
    for (const r of list) if (order.uid && order.uid === r.uid) order.number = r.to;
    toast(list.length > 2 ? `${list.length} orders have new numbers` : list.map(r => `Order #${r.from} is now #${r.to}`).join(' · '));
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
      order = restoreOrder(stored); baseline = signature(order); opened = JSON.stringify(stored);
      return;
    }
    const n = order.number, was = opened ? restoreOrder(JSON.parse(opened)) : null;
    const before = new Map((was ? was.lines : []).map(l => [`${l.id}@${typeOf(was, l)}`, l.qty]));
    const added = unsaved ? order.lines.map(l => ({ ...l, qty: l.qty - (before.get(keyOf(l)) || 0) })).filter(l => l.qty > 0) : [];
    const how = stored ? 'paid' : 'deleted';
    if (added.length) {
      order = { ...order, number: null, uid: null, heldId: null, lines: added }; baseline = null; opened = null; selected = null;
      toast(`Order #${n} was ${how} on another tablet · your new items are a new order`);
    } else { fresh(); toast(`Order #${n} was ${how} on another tablet`); }
  }
  // A table tapped on the Floor: the order on that table (on screen, saved and not paid, or held) if it has one,
  // otherwise a new Dine in order with the table already chosen. An order on screen with anything not saved goes to Held.
  function openTable(id) {
    const forTable = o => o.table === id && usesTable(o);
    query = ''; category = null;
    if (forTable(order) && (order.lines.length || order.number)) { selected = null; sheet = null; render(); return; }
    const open = loadOrders().find(o => !o.paidAt && forTable(o));
    if (open) { openOrder(idOf(open)); return; }
    const waiting = held.find(forTable);
    if (waiting) { resume(waiting.heldId); return; }
    const parked = park();
    order = { ...blankOrder(), type: 'dine-in', table: id }; baseline = null; opened = null; selected = null; sheet = null; render();
    if (parked) toast(`Previous order on hold · ${held.length} held`);
  }
  // Pay: the order is saved as paid (and goes to the kitchen if it has not yet), then the receipt shows.
  function complete(received) {
    const t = totals(); if (!t.count || received < t.total) return;
    const { entry } = upsertOrder({ method: 'cash', received, change: received - t.total });
    receipt = entry; sheet = 'receipt'; order = blankOrder(); baseline = null; opened = null; selected = null; category = null; query = ''; cashInput = ''; render();
    window.RestroSound?.play('tick');
    window.dispatchEvent(new CustomEvent('restro:order-paid', { detail: entry }));
  }

  // ---------- rendering ----------
  const typeLabel = { 'dine-in': 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery', phone: 'Phone call' };
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  // Middle of the title row: two slots, the same for every order type except one thing. The first is Choose table for
  // Dine in (opens the Floor) and Add Customer for every other order (opens Customers); the second is Assign Pager.
  // Once chosen, each shows what was chosen (dashed until then).
  function orderTargets() {
    const c = order.customer, name = tableName(order.table);
    const first = order.type === 'dine-in'
      ? el('button', { ...tileAt('customer'), type: 'button', class: `ctr-target${name ? ' set' : ''}`, 'aria-label': name ? `Table ${name}. Tap to change the table` : 'Choose table', onclick: pickTable },
          svg(ICON.table), el('span', {}, name ? `Table ${name}` : 'Choose table'))
      : el('button', { ...tileAt('customer'), type: 'button', class: `ctr-target${c ? ' set' : ''}`, 'aria-label': c ? `Customer ${c.name}. Tap to change the customer` : 'Add customer', onclick: pickCustomer },
          svg(c ? ICON.person : ICON.personAdd), el('span', {}, c ? c.name : 'Add Customer'));
    const pager = el('button', { ...tileAt('pager'), type: 'button', class: `ctr-target${order.pager ? ' set' : ''}`, 'aria-label': order.pager ? `Pager ${order.pager}. Tap to change the pager` : 'Assign pager', onclick: () => { sheet = 'pager'; render(); } },
      svg(ICON.pager), el('span', {}, order.pager ? `Pager ${order.pager}` : 'Assign Pager'));
    return el('div', { class: 'ctr-targets' }, first, pager);
  }
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
  function orderPanel() {
    const t = totals();
    // Six tiles, three per row (placed by counter.css): Order type · Add Customer or Choose table · Assign Pager /
    // Modify · Schedule · Hold. Order type opens the four types right over itself. Home is the system bar's.
    const header = el('div', { class: `ctr-order-head${panelArranging ? ' arranging' : ''}` },
      el('h2', { id: 'counter-title', class: 'visually-hidden', tabindex: '-1' }, 'Counter'),
      el('button', { ...tileAt('type'), type: 'button', class: `ctr-type-btn ctr-type-pick${order.type ? ' on' : ''}`, 'data-type': order.type || null, 'aria-haspopup': 'true', 'aria-expanded': String(typeMenu),
        'aria-label': order.type ? `Order type ${typeLabel[order.type]}. Tap to change` : 'Choose the order type', onclick: () => openTypeMenu(true) }, typeLabel[order.type] || 'Order type'),
      el('div', { class: 'ctr-titlebar' }, orderTargets()),
      el('div', { class: 'ctr-type-row' },
        el('div', { class: 'ctr-side' },
          el('button', { ...tileAt('modify'), type: 'button', role: 'switch', 'aria-checked': String(order.split), class: `ctr-type-btn ctr-split ${order.split ? 'on' : ''}`, onclick: () => setSplit(!order.split) }, 'Modify')),
        el('div', { class: 'ctr-side ctr-mid' },
          el('button', { ...tileAt('schedule'), type: 'button', class: `ctr-type-btn ctr-schedule ${order.readyAt ? 'on' : ''}`, 'aria-label': order.readyAt ? `Ready by ${whenShort(order.readyAt)}. Tap to change` : 'Schedule',
            onclick: () => { scheduleDraft = null; sheet = 'schedule'; render(); } }, order.readyAt ? whenShort(order.readyAt) : 'Schedule'),
          el('button', { ...tileAt('hold'), type: 'button', class: 'ctr-type-btn ctr-hold', disabled: !order.lines.length || Boolean(order.number), title: order.number ? 'This order is saved in Orders' : null, onclick: holdTicket }, 'Hold'))),
      // The four order types, opened from Order type: two by two over the tiles, on the two columns where Order type is
      // (wherever it has been moved to).
      typeMenu && el('div', { class: 'ctr-type-pop' },
        el('div', { class: 'ctr-types', role: 'group', 'aria-label': 'Order type' },
          ...TYPES.map((key, i) => el('button', { style: `grid-area:${1 + Math.floor(i / 2)} / ${Math.min(panelOrder.indexOf('type') % 3, 1) + 1 + i % 2}`, type: 'button', 'aria-pressed': String(order.type === key), class: `ctr-type-btn ${order.type === key ? 'on' : ''}`, onclick: () => pickType(key) }, typeLabel[key])))));
    const list = el('ul', { class: 'ctr-lines', 'aria-label': 'Items in this order' });
    if (!order.lines.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No items yet'), el('span', {}, 'Tap a category, then an item to add it.')));
    const lineRow = line => {
      const item = items.get(line.id), key = keyOf(line), open = selected === key;
      const li = el('li', { class: `ctr-line ${open ? 'open' : ''}`, 'data-line': key },
        el('div', { class: 'ctr-line-main' },
          el('button', { type: 'button', class: 'ctr-line-select', 'aria-expanded': String(open), onclick: () => { selected = open ? null : key; render(); },
            onkeydown: e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLine(key); } } },
            el('span', { class: 'ctr-line-text' }, el('span', { class: 'ctr-line-name' }, item.name), open ? el('span', { class: 'ctr-unit' }, `@ ${rupees(item.price)}`) : null)),
          el('div', { class: 'ctr-qty' },
            el('button', { type: 'button', class: 'ctr-qty-btn', 'aria-label': `One less ${item.name}`, onclick: () => setQty(key, line.qty - 1) }, svg(ICON.minus)),
            el('button', { type: 'button', class: 'ctr-qty-num', 'aria-label': `Quantity ${line.qty}. Tap to type a quantity`, onclick: () => { qtyKey = key; qtyValue = ''; sheet = 'qty'; render(); } }, String(line.qty)),
            el('button', { type: 'button', class: 'ctr-qty-btn', 'aria-label': `One more ${item.name}`, onclick: () => setQty(key, line.qty + 1) }, svg(ICON.plus))),
          el('button', { type: 'button', class: 'ctr-line-price', tabindex: '-1', 'aria-hidden': 'true', onclick: () => { selected = open ? null : key; render(); } }, rupees(item.price * line.qty))));
      if (open) {
        // Modify on: move this item to another order type (the buttons match the order type buttons above).
        if (order.split) li.append(el('div', { class: 'ctr-move', role: 'radiogroup', 'aria-label': `Serve ${item.name} as` },
          ...TYPES.map(type => el('button', { type: 'button', role: 'radio', 'aria-checked': String(lineType(line) === type), class: lineType(line) === type ? 'on' : '', onclick: () => moveLine(key, type) }, typeLabel[type]))));
      }
      return li;
    };
    if (order.split) {
      for (const type of TYPES) {
        const group = order.lines.filter(l => lineType(l) === type); if (!group.length) continue;
        const count = group.reduce((n, l) => n + l.qty, 0);
        list.append(el('li', { class: 'ctr-group' }, el('span', {}, typeLabel[type]), el('span', { class: 'ctr-group-count' }, `${count} item${count === 1 ? '' : 's'}`)));
        group.forEach(line => list.append(lineRow(line)));
      }
    } else order.lines.forEach(line => list.append(lineRow(line)));

    // Subtotal and tax; the total is on the Pay tile (no Total line), which leaves more room for the order's items.
    const sums = el('dl', { class: 'ctr-sums' },
      el('dt', {}, 'Subtotal'), el('dd', {}, money(t.subtotal)),
      el('dt', {}, menu.taxLabel), el('dd', {}, money(t.tax)));

    const actions = el('div', { class: 'ctr-actions' },
      el('button', { type: 'button', class: 'ctr-secondary', disabled: !t.count, onclick: saveOrder }, 'Save'),
      el('button', { type: 'button', class: 'primary-button ctr-pay', disabled: !t.count, 'aria-label': `Pay ${money(t.total)}`, onclick: () => { cashInput = ''; sheet = 'pay'; render(); } },
        el('span', {}, 'Pay'), el('span', { class: 'ctr-pay-amount' }, money(t.total))));

    return el('section', { class: 'ctr-order', 'aria-label': 'Current order' }, header, list, el('div', { class: 'ctr-foot' }, sums, actions));
  }

  function menuPanel() {
    const search = el('label', { class: 'ctr-search' }, svg(ICON.search), el('span', { class: 'visually-hidden' }, 'Search'),
      el('input', { id: 'counter-search', type: 'search', placeholder: 'Search', autocomplete: 'off', enterkeyhint: 'search', value: query,
        oninput: e => { query = e.target.value; renderMenuBody(); },
        onkeydown: e => {
          if (e.key !== 'Enter') return;
          const code = query.trim().toUpperCase(), byCode = [...items.values()].find(i => i.code === code), found = matches();
          const pick = byCode || (found.length === 1 ? found[0] : null);
          if (pick) { e.preventDefault(); add(pick.id); query = ''; render(); dialog.querySelector('#counter-search')?.focus(); }
        } }));
    // Options: a round button at the top of the divider. The divider goes round it (it curves out under the button,
    // wraps its right side and runs up to the top edge), so the button sits in a bubble of the order panel.
    // The 35px button's centre is 18.5px in and 16px down here: the line wraps it at 21px (3px clear), curves into the
    // divider at 17px and meets the top edge 32.67px in.
    const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bubble.setAttribute('class', 'ctr-bubble'); bubble.setAttribute('aria-hidden', 'true'); bubble.setAttribute('viewBox', '0 0 42 56');
    bubble.innerHTML = '<path class="ctr-bubble-fill" d="M1 54H1.5A17 17 0 0 1 18.5 37A21 21 0 0 0 32.67 .5V0H1Z"/>'
      + '<path class="ctr-bubble-line" d="M1.5 54A17 17 0 0 1 18.5 37A21 21 0 0 0 32.67 .5"/>';
    const top = el('div', { class: 'ctr-menu-top' },
      bubble,
      el('button', { type: 'button', class: 'ctr-options', 'aria-label': 'Options', title: 'Options', 'aria-haspopup': 'menu', 'aria-expanded': String(optionsMenu), onclick: () => openOptions(!optionsMenu) }, svg(ICON.menu)),
      // The options menu, under the button. Highlight order needs items; Delete order asks again before it deletes the
      // order on screen.
      optionsMenu && el('div', { class: 'ctr-options-menu', role: 'menu', 'aria-label': 'Options' },
        el('button', { type: 'button', role: 'menuitem', class: 'ctr-options-item', disabled: !order.lines.length, onclick: () => setHighlight(true) },
          svg(ICON.expand), 'Highlight order'),
        el('button', { type: 'button', role: 'menuitem', class: `ctr-options-item danger${deleteArmed ? ' armed' : ''}`, disabled: !hasOrder(), onclick: tapDelete },
          svg(ICON.trash), deleteArmed ? (order.number ? `Tap again to delete #${order.number}` : 'Tap again to delete') : 'Delete order')),
      search,
      el('button', { type: 'button', class: 'ctr-tool', onclick: () => { sheet = 'held'; render(); } }, svg(ICON.held), el('span', { class: 'ctr-tool-label' }, 'Held'), held.length ? el('span', { class: 'ctr-badge' }, String(held.length)) : null),
      // Orders opens the Orders app (all orders, one to a row); Back there returns to Counter as it was.
      el('button', { type: 'button', class: 'ctr-tool', onclick: () => { if (window.RestroOrders) window.RestroOrders.open({ from: 'counter' }); else { sheet = 'orders'; render(); } } }, svg(ICON.orders), el('span', { class: 'ctr-tool-label' }, 'Orders')),
      el('button', { type: 'button', class: 'ctr-tool', onclick: () => { sheet = 'payments'; render(); } }, svg(ICON.history), el('span', { class: 'ctr-tool-label' }, 'Payment history')));
    return el('section', { class: 'ctr-menu', 'aria-label': 'Menu' }, top, el('div', { class: 'ctr-menu-body' }),
      // (Not while a sheet such as the quantity pad or Pay is open: the sheet dims the whole screen itself.)
      highlight && !sheet && el('div', { class: 'ctr-highlight-scrim', onclick: () => setHighlight(false) }));
  }

  const matches = () => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    return categoriesInOrder().flatMap(itemsInOrder).filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase() === q);
  };
  function itemTile(item) {
    const qty = order.lines.filter(l => l.id === item.id).reduce((n, l) => n + l.qty, 0);
    return el('button', { type: 'button', class: 'ctr-item', 'data-id': item.id, style: `--stripe:${categoryOf.get(item.id).color}`, onclick: () => add(item.id), 'aria-label': `Add ${item.name}, ${rupees(item.price)}${qty ? `, ${qty} in order` : ''}` },
      el('span', { class: 'ctr-item-name' }, item.name), el('span', { class: 'ctr-item-price' }, rupees(item.price)));
  }
  const categoryTile = c => el('button', { type: 'button', class: 'ctr-category', 'data-id': c.id, style: `--stripe:${c.color}`, onclick: () => { category = c.id; renderMenuBody(); } },
    el('span', { class: 'ctr-category-name' }, c.name));
  // ---------- menu pages (like More apps on the home screen) ----------
  // Tiles fill a page (3 categories / 4 items per row, as many rows as fit); the rest flow onto the next page.
  // Swipe sideways or tap the dots to change page. Hold a tile to rearrange: drag it to a new place,
  // hold it near the left or right edge to change page, then tap empty space (or Back) to finish.
  const GAP = 10, TILE_MIN = 65;
  const pageMemo = { view: '', page: 0 };
  let menuState = null, menuLayout = null, pageCount = 1, arranging = false, drag = null, gesture = null, holdTimer = null, suppressClick = false, lastWheel = 0;
  const columnsFor = (kind, width) => kind === 'categories'
    ? ((width - 2 * GAP) / 3 >= 130 ? 3 : Math.max(1, Math.floor((width + GAP) / (130 + GAP))))
    : ((width - 3 * GAP) / 4 >= 120 ? 4 : Math.max(1, Math.floor((width + GAP) / (120 + GAP))));

  // What the menu shows: search results, one category's items, or all categories.
  function menuView() {
    const q = query.trim();
    if (q) {
      const found = matches();
      return { key: `q:${q}`, kind: 'search', ids: found.map(i => i.id), tiles: found.map(itemTile),
        crumb: [el('strong', {}, found.length ? `${found.length} result${found.length === 1 ? '' : 's'} for “${q}”` : `No items match “${q}”`)] };
    }
    const c = category && categoryById.get(category);
    if (c) {
      const list = itemsInOrder(c);
      return { key: `c:${c.id}`, kind: 'items', catId: c.id, ids: list.map(i => i.id), tiles: list.map(itemTile),
        crumb: [el('button', { type: 'button', class: 'ctr-text-button', onclick: () => { category = null; renderMenuBody(); } }, svg(ICON.chevron), 'All categories'),
          el('strong', { style: `--stripe:${c.color}`, class: 'ctr-crumb-name' }, c.name)] };
    }
    const list = categoriesInOrder();
    // "All categories" stays at the top of the grid too: same look as the back button, without the arrow.
    return { key: 'all', kind: 'categories', ids: list.map(x => x.id), tiles: list.map(categoryTile),
      crumb: [el('span', { class: 'ctr-text-button ctr-crumb-root' }, 'All categories')] };
  }

  function renderMenuBody() {
    saveDraft(); // every change to the order or to the menu view comes through here, so it is always kept
    if (drag) endDrag(true, false);
    const body = dialog.querySelector('.ctr-menu-body'); if (!body) return;
    const view = menuView();
    if (view.kind === 'search') arranging = false; // search results keep the menu's order
    if (view.key !== pageMemo.view) { pageMemo.view = view.key; pageMemo.page = 0; }
    menuState = view;
    dialog.querySelector('.ctr-menu')?.classList.toggle('arranging', arranging);
    const pager = el('div', { class: 'ctr-pager' }), dots = el('div', { class: 'ctr-dots' });
    body.replaceChildren(el('div', { class: 'ctr-crumb' }, ...view.crumb), el('div', { class: 'ctr-pages' }, pager, dots));
    layoutPages(view, pager, dots);
  }

  // Room on the right and at the bottom of the pages for the tiles' 3D depth (tiles.css sets it for the tile style in
  // Settings), so the depth of the last column and the last row is not cut off at the edge of the page.
  const tileRoom = pager => { const cs = getComputedStyle(pager); return { x: parseFloat(cs.getPropertyValue('--tile-room-x')) || 0, y: parseFloat(cs.getPropertyValue('--tile-room-y')) || 0 }; };
  function layoutPages(view, pager, dots) {
    if (!pager.clientWidth || !pager.clientHeight) { pageCount = 1; menuLayout = null; pager.append(el('div', { class: 'ctr-page' }, ...view.tiles)); return; } // not on screen: laid out when shown
    const room = tileRoom(pager), width = pager.clientWidth - room.x, height = pager.clientHeight - room.y;
    const cols = columnsFor(view.kind, width), colWidth = (width - (cols - 1) * GAP) / cols;
    // Every tile in the list gets the height of the tallest (a long name may take two lines), so rows stay even.
    const probe = el('div', { class: 'ctr-probe', style: `width:${colWidth}px` }, ...view.tiles);
    pager.append(probe);
    const tileH = Math.max(TILE_MIN, ...view.tiles.map(t => t.offsetHeight));
    probe.remove();
    menuLayout = { cols, tileH, per: cols * Math.max(1, Math.floor((height + GAP) / (tileH + GAP))) };
    buildPages(view.tiles, pager, dots);
  }
  // Puts the tiles into pages (reusing the same tile elements), with the dots underneath.
  function buildPages(tiles, pager = dialog.querySelector('.ctr-pager'), dots = dialog.querySelector('.ctr-dots')) {
    if (!menuLayout || !pager || !dots) return;
    const { cols, tileH, per } = menuLayout, chunks = [];
    for (let i = 0; i < tiles.length; i += per) chunks.push(tiles.slice(i, i + per));
    if (!chunks.length) chunks.push([]);
    // While rearranging, the last page shows its empty places (and a fresh page when it is full) for dropping a tile at the end.
    if (arranging && chunks[chunks.length - 1].length === per) chunks.push([]);
    const track = el('div', { class: 'ctr-track no-transition' });
    chunks.forEach((group, p) => {
      const page = el('div', { class: 'ctr-page', 'data-page': String(p), role: 'group', 'aria-label': `Page ${p + 1} of ${chunks.length}`,
        style: `grid-template-columns:repeat(${cols},minmax(0,1fr));grid-auto-rows:${tileH}px` }, ...group);
      if (arranging) for (let i = group.length; i < per; i++) page.append(el('div', { class: 'ctr-slot' }));
      track.append(page);
    });
    pager.querySelector('.ctr-track')?.remove();
    pager.append(track);
    pageCount = chunks.length;
    pageMemo.page = Math.min(pageMemo.page, pageCount - 1);
    dots.replaceChildren(...(pageCount > 1 ? chunks.map((_, p) => el('button', { type: 'button', class: 'ctr-dot', 'aria-label': `Page ${p + 1}`, onclick: () => goToMenuPage(p) })) : []));
    showMenuPage(false);
  }
  function showMenuPage(animate = true) {
    const track = dialog.querySelector('.ctr-track'); if (!track) return;
    track.classList.toggle('no-transition', !animate);
    track.style.transform = `translateX(-${pageMemo.page * 100}%)`;
    dialog.querySelectorAll('.ctr-page').forEach((page, p) => { page.inert = p !== pageMemo.page; });
    dialog.querySelectorAll('.ctr-dot').forEach((dot, p) => dot.setAttribute('aria-current', String(p === pageMemo.page)));
  }
  function goToMenuPage(p) {
    const next = Math.max(0, Math.min(pageCount - 1, p));
    const changed = next !== pageMemo.page; pageMemo.page = next; showMenuPage(); return changed;
  }
  function setArranging(on) {
    if (arranging === on) return;
    if (!on && drag) endDrag(true, false);
    arranging = on; renderMenuBody();
  }

  // Hold a tile to pick it up: it follows the finger, and the other tiles make room for it live.
  function startDrag(id, pointerId, x, y) {
    if (!menuState || menuState.kind === 'search') return;
    if (!arranging) setArranging(true); // redraws the tiles, so find the tile again
    const tile = [...dialog.querySelectorAll('.ctr-page [data-id]')].find(t => t.dataset.id === id); if (!tile) return;
    const rect = tile.getBoundingClientRect(), ghost = tile.cloneNode(true);
    ghost.classList.add('ctr-drag-ghost'); ghost.removeAttribute('data-id'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
    ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; ghost.style.left = `${x}px`; ghost.style.top = `${y}px`;
    root.append(ghost); tile.classList.add('ctr-drag-origin');
    drag = { id, pointerId, ghost, edgeTimer: null, edgeDir: 0, order: [...menuState.ids] };
    gesture = null;
    try { dialog.querySelector('.ctr-pager').setPointerCapture(pointerId); } catch {}
  }
  // Where each tile is shown right now: its centre (the jiggle doesn't move it), including a slide in progress.
  const centreOf = t => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function previewOrder(order) {
    const tiles = [...dialog.querySelectorAll('.ctr-page [data-id]')], byId = new Map(tiles.map(t => [t.dataset.id, t]));
    const before = new Map(tiles.map(t => [t.dataset.id, { page: t.closest('.ctr-page').dataset.page, ...centreOf(t) }]));
    tiles.forEach(t => t.getAnimations().forEach(a => { if (a.id === 'ctr-slide') a.cancel(); }));
    drag.order = order;
    buildPages(order.map(id => byId.get(id)).filter(Boolean));
    // Tiles that changed place slide from where they were shown to their new place.
    for (const tile of dialog.querySelectorAll('.ctr-page [data-id]')) {
      const was = before.get(tile.dataset.id); if (!was || tile.dataset.id === drag.id || was.page !== tile.closest('.ctr-page').dataset.page) continue;
      const now = centreOf(tile), dx = was.x - now.x, dy = was.y - now.y; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      try { const a = tile.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' }); a.id = 'ctr-slide'; } catch {}
    }
  }
  // The place under the finger, worked out from the page's grid: tiles sliding past never change it (no back-and-forth shaking).
  function cellAt(x, y) {
    const pager = dialog.querySelector('.ctr-pager'), page = dialog.querySelector(`.ctr-page[data-page="${pageMemo.page}"]`);
    if (!pager || !page || !menuLayout) return null;
    const r = pager.getBoundingClientRect(), { cols, tileH } = menuLayout, w = r.width - tileRoom(pager).x, colW = (w - (cols - 1) * GAP) / cols;
    const px = x - r.left, py = y - r.top; if (px < 0 || py < 0 || px > w || py > r.height) return null;
    const col = Math.floor(px / (colW + GAP)), row = Math.floor(py / (tileH + GAP));
    if (col >= cols || px - col * (colW + GAP) > colW || py - row * (tileH + GAP) > tileH) return null; // in a gap between tiles
    return page.children[row * cols + col] || null; // a tile, or an empty place
  }
  function moveDrag(x, y) {
    drag.ghost.style.left = `${x}px`; drag.ghost.style.top = `${y}px`;
    // Over another tile: take its place now (the others shift along). Over an empty place: go to the end.
    const spot = cellAt(x, y);
    if (spot && spot.dataset.id !== drag.id && (spot.dataset.id || spot.classList.contains('ctr-slot'))) {
      const order = drag.order.filter(id => id !== drag.id);
      order.splice(spot.classList.contains('ctr-slot') ? order.length : drag.order.indexOf(spot.dataset.id), 0, drag.id);
      if (order.join('|') !== drag.order.join('|')) previewOrder(order);
    }
    // Held near the left or right edge: move to the previous or next page.
    const r = dialog.querySelector('.ctr-pager').getBoundingClientRect(), inside = y >= r.top && y <= r.bottom;
    const dir = inside && x > r.right - 46 && pageMemo.page < pageCount - 1 ? 1 : inside && x < r.left + 46 && pageMemo.page > 0 ? -1 : 0;
    if (dir !== drag.edgeDir) {
      clearTimeout(drag.edgeTimer); drag.edgeDir = dir;
      if (dir) drag.edgeTimer = setTimeout(() => { if (!drag) return; goToMenuPage(pageMemo.page + dir); drag.edgeDir = 0; }, 650);
    }
  }
  // Let go: the order shown is kept (and saved). Cancelled: the tiles go back to how they were.
  function endDrag(cancel, rerender = true) {
    const d = drag; if (!d) return; drag = null;
    clearTimeout(d.edgeTimer); d.ghost.remove();
    dialog.querySelectorAll('.ctr-drag-origin').forEach(n => n.classList.remove('ctr-drag-origin'));
    if (!cancel && menuState && d.order.join('|') !== menuState.ids.join('|')) saveMenuOrder(menuState, d.order);
    if (rerender) renderMenuBody();
  }

  root.addEventListener('pointerdown', event => {
    if (arranging && !drag && !event.target.closest('.ctr-pages')) setArranging(false); // a tap anywhere else finishes rearranging
    const pager = event.target.closest('.ctr-pager'); if (!pager || event.button !== 0 || drag) return;
    suppressClick = false;
    const tile = event.target.closest('.ctr-page [data-id]');
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, start: performance.now(), tile, moved: false, horizontal: false };
    clearTimeout(holdTimer); holdTimer = null;
    if (tile && menuState?.kind !== 'search') {
      const id = tile.dataset.id, x = event.clientX, y = event.clientY, pointerId = event.pointerId;
      holdTimer = setTimeout(() => { holdTimer = null; if (gesture && !gesture.moved && gesture.id === pointerId) startDrag(id, pointerId, x, y); }, arranging ? 120 : 420);
    }
  });
  root.addEventListener('pointermove', event => {
    if (drag) { if (event.pointerId === drag.pointerId) { event.preventDefault(); moveDrag(event.clientX, event.clientY); } return; }
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) > 8) { gesture.moved = true; clearTimeout(holdTimer); holdTimer = null; }
    if (!gesture.horizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      gesture.horizontal = true;
      try { dialog.querySelector('.ctr-pager').setPointerCapture(event.pointerId); } catch {}
    }
    if (gesture.horizontal) {
      event.preventDefault();
      const track = dialog.querySelector('.ctr-track'); if (!track) return;
      const offset = (pageMemo.page === 0 && dx > 0) || (pageMemo.page === pageCount - 1 && dx < 0) ? dx * .2 : dx; // a little give at the ends
      track.classList.add('no-transition'); track.style.transform = `translateX(calc(-${pageMemo.page * 100}% + ${offset}px))`;
    }
  });
  root.addEventListener('pointerup', event => {
    clearTimeout(holdTimer); holdTimer = null;
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      suppressClick = true;
      const r = dialog.querySelector('.ctr-pager')?.getBoundingClientRect(), outside = !r || event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
      if (outside) setArranging(false); else endDrag(false); // let go outside the menu: no move, and rearranging ends (as on the home screen)
      return;
    }
    if (!gesture || event.pointerId !== gesture.id) return;
    const g = gesture; gesture = null;
    if (g.horizontal) {
      suppressClick = true;
      const dx = event.clientX - g.x, width = dialog.querySelector('.ctr-pager')?.clientWidth || 1;
      const flick = Math.abs(dx) > 35 && performance.now() - g.start < 260;
      if (Math.abs(dx) > Math.min(width * .15, 95) || flick) goToMenuPage(pageMemo.page + (dx < 0 ? 1 : -1)); else showMenuPage();
      return;
    }
    if (g.moved) { suppressClick = true; return; }
    if (arranging && !g.tile) setArranging(false); // a tap on empty space finishes rearranging
  });
  root.addEventListener('pointercancel', event => {
    clearTimeout(holdTimer); holdTimer = null;
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
    if (gesture?.horizontal) showMenuPage();
    gesture = null;
  });
  // No tap after a swipe or a drag, and no tapping tiles while rearranging (it doesn't add items or open categories).
  root.addEventListener('click', event => {
    if (!event.target.closest('.ctr-pager')) return;
    if (suppressClick || arranging) { event.preventDefault(); event.stopPropagation(); }
    suppressClick = false;
  }, true);
  root.addEventListener('contextmenu', event => { if (event.target.closest('.ctr-pager')) event.preventDefault(); });
  root.addEventListener('wheel', event => {
    if (!event.target.closest('.ctr-pager') || pageCount < 2) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY; if (Math.abs(delta) < 8) return;
    event.preventDefault();
    const now = performance.now(); if (now - lastWheel > 480) { goToMenuPage(pageMemo.page + (delta > 0 ? 1 : -1)); lastWheel = now; }
  }, { passive: false });
  root.addEventListener('keydown', event => {
    if (!event.target.closest('.ctr-pages') || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    if (goToMenuPage(pageMemo.page + (event.key === 'ArrowRight' ? 1 : -1))) event.preventDefault();
  });
  // Turning the tablet (or resizing the window) re-flows the pages.
  let relayout = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(relayout); relayout = requestAnimationFrame(() => { if (dialog.open && !drag) renderMenuBody(); }); });
  // A new tile style (Settings) needs a different room for the depth: the pages are laid out again.
  window.addEventListener('restro:tiles-changed', () => { if (dialog.open && !drag) renderMenuBody(); });

  // ---------- swipe an order line left to remove it ----------
  // Drag a line to the left: it slides over a red strip saying Remove. Let go past a third of its width (or flick it)
  // and the item is removed; otherwise it slides back. Up and down still scroll the list.
  let swipe = null, swipeSuppress = false;
  root.addEventListener('pointerdown', event => {
    const li = event.target.closest?.('.ctr-line'); if (!li || event.button !== 0 || swipe?.active) return;
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
      s.li.append(el('span', { class: 'ctr-swipe-label', 'aria-hidden': 'true' }, svg(ICON.trash), 'Remove'));
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
      setTimeout(() => { s.li.classList.remove('swiping', 'settling'); s.li.querySelector('.ctr-swipe-label')?.remove(); }, 180);
    }
  }
  root.addEventListener('pointerup', event => endSwipe(event, false));
  root.addEventListener('pointercancel', event => endSwipe(event, true));
  // A swipe is not a tap: it doesn't open the item, change its quantity, or close the item that is open.
  dialog.addEventListener('click', event => {
    if (swipeSuppress && event.target.closest?.('.ctr-line')) { event.preventDefault(); event.stopImmediatePropagation(); }
    swipeSuppress = false;
  }, true);

  // ---------- rearranging the order panel ----------
  // Hold a tile, as with the menu: the tiles jiggle and the one held follows the finger, the others making room for it
  // live. Let go over the panel to keep the new order (saved); let go outside it to put the tiles back. A tap anywhere
  // else, or Back, finishes. While the tiles jiggle, tapping one does nothing.
  const panelTiles = () => [...dialog.querySelectorAll('.ctr-order-head [data-tile]')];
  function setPanelArranging(on) {
    if (panelArranging === on) return;
    if (!on && panelDrag) endPanelDrag(true);
    panelArranging = on; dialog.querySelector('.ctr-order-head')?.classList.toggle('arranging', on);
  }
  function startPanelDrag(key, pointerId, x, y) {
    const head = dialog.querySelector('.ctr-order-head'), tile = head?.querySelector(`[data-tile="${key}"]`); if (!tile) return;
    setPanelArranging(true);
    const r = tile.getBoundingClientRect(), ghost = tile.cloneNode(true);
    ghost.classList.add('ctr-drag-ghost'); ghost.removeAttribute('data-tile'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
    ghost.style.cssText = `width:${r.width}px;height:${r.height}px;left:${x}px;top:${y}px;--btn:${getComputedStyle(tile).getPropertyValue('--btn')}`;
    head.append(ghost); tile.classList.add('ctr-drag-origin');
    panelDrag = { key, pointerId, ghost, order: [...panelOrder] };
    panelGesture = null;
    try { head.setPointerCapture(pointerId); } catch {}
  }
  // The place under the finger, from the panel's grid (three columns, two rows), so tiles sliding past never change it.
  function panelCellAt(x, y) {
    const head = dialog.querySelector('.ctr-order-head'); if (!head) return -1;
    const cs = getComputedStyle(head), r = head.getBoundingClientRect(), gap = parseFloat(cs.columnGap) || 9;
    const left = r.left + parseFloat(cs.paddingLeft), top = r.top + parseFloat(cs.paddingTop);
    const width = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), colW = (width - 2 * gap) / 3, rowH = parseFloat(cs.gridTemplateRows) || 76;
    const px = x - left, py = y - top; if (px < 0 || py < 0 || px > width || py > 2 * rowH + gap) return -1;
    return Math.min(1, Math.floor(py / (rowH + gap))) * 3 + Math.min(2, Math.floor(px / (colW + gap)));
  }
  function movePanelDrag(x, y) {
    const d = panelDrag; d.ghost.style.left = `${x}px`; d.ghost.style.top = `${y}px`;
    const cell = panelCellAt(x, y); if (cell < 0) return;
    const next = d.order.filter(k => k !== d.key); next.splice(cell, 0, d.key);
    if (next.join() === d.order.join()) return;
    // The tiles that change place slide from where they are shown to their new place.
    const before = new Map(panelTiles().map(t => [t.dataset.tile, centreOf(t)]));
    d.order = next;
    for (const t of panelTiles()) { t.getAnimations().forEach(a => { if (a.id === 'ctr-slide') a.cancel(); }); t.style.order = next.indexOf(t.dataset.tile); }
    for (const t of panelTiles()) {
      if (t.dataset.tile === d.key) continue;
      const was = before.get(t.dataset.tile), now = centreOf(t), dx = was.x - now.x, dy = was.y - now.y; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      try { const a = t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' }); a.id = 'ctr-slide'; } catch {}
    }
  }
  function endPanelDrag(cancel) {
    const d = panelDrag; if (!d) return; panelDrag = null;
    d.ghost.remove();
    if (!cancel && d.order.join() !== panelOrder.join()) { panelOrder = d.order; store(PANEL_KEY, panelOrder); }
    for (const t of panelTiles()) { t.classList.remove('ctr-drag-origin'); t.style.order = panelOrder.indexOf(t.dataset.tile); }
  }
  root.addEventListener('pointerdown', event => {
    const tile = event.target.closest?.('.ctr-order-head [data-tile]');
    if (panelArranging && !panelDrag && !tile) setPanelArranging(false); // a tap anywhere else finishes rearranging
    if (!tile || event.button !== 0 || panelDrag || typeMenu) return;
    panelSuppress = false;
    const key = tile.dataset.tile, x = event.clientX, y = event.clientY, pointerId = event.pointerId;
    panelGesture = { id: pointerId, x, y, moved: false };
    clearTimeout(panelHold);
    panelHold = setTimeout(() => { panelHold = null; if (panelGesture && !panelGesture.moved && panelGesture.id === pointerId) startPanelDrag(key, pointerId, x, y); }, panelArranging ? 120 : 420);
  });
  root.addEventListener('pointermove', event => {
    if (panelDrag) { if (event.pointerId === panelDrag.pointerId) { event.preventDefault(); movePanelDrag(event.clientX, event.clientY); } return; }
    if (panelGesture && event.pointerId === panelGesture.id && Math.hypot(event.clientX - panelGesture.x, event.clientY - panelGesture.y) > 8) { panelGesture.moved = true; clearTimeout(panelHold); panelHold = null; }
  });
  root.addEventListener('pointerup', event => {
    clearTimeout(panelHold); panelHold = null; panelGesture = null;
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    panelSuppress = true;
    const r = dialog.querySelector('.ctr-order-head').getBoundingClientRect();
    endPanelDrag(event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom); // outside the panel: put back
  });
  root.addEventListener('pointercancel', event => {
    clearTimeout(panelHold); panelHold = null; panelGesture = null;
    if (panelDrag && event.pointerId === panelDrag.pointerId) endPanelDrag(true);
  });
  // No tile action after a drag, or while the tiles jiggle.
  root.addEventListener('click', event => {
    if (!event.target.closest?.('.ctr-order-head [data-tile]')) return;
    if (panelSuppress || panelArranging) { event.preventDefault(); event.stopPropagation(); }
    panelSuppress = false;
  }, true);
  root.addEventListener('contextmenu', event => { if (event.target.closest?.('.ctr-order-head [data-tile]')) event.preventDefault(); });

  function sheetView() {
    if (!sheet) return null;
    const t = totals();
    const close = el('button', { type: 'button', class: 'ctr-icon-button', 'aria-label': 'Close', onclick: () => { sheet = null; render(); } }, svg(ICON.close));
    let body;
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
    if (sheet === 'qty') {
      const line = order.lines.find(l => keyOf(l) === qtyKey);
      if (!line) { sheet = null; return null; }
      const item = items.get(line.id);
      const display = el('output', { class: 'ctr-pad-display', 'aria-live': 'polite' }, qtyValue || String(line.qty));
      if (!qtyValue) display.classList.add('placeholder');
      const press = k => {
        if (k === 'C') qtyValue = '';
        else if (k === '⌫') qtyValue = qtyValue.slice(0, -1);
        else if (qtyValue.length < 3) qtyValue = (qtyValue === '0' ? '' : qtyValue) + k;
        render();
      };
      const setBtn = el('button', { type: 'button', class: 'primary-button ctr-complete', disabled: !qtyValue, onclick: () => { const n = parseInt(qtyValue, 10); sheet = null; qtyKey = null; setQty(keyOf(line), Number.isFinite(n) ? n : line.qty); if (n === 0) toast(`${item.name} removed`); } }, qtyValue === '0' ? 'Remove item' : 'Set quantity');
      const pad = el('div', { class: 'ctr-pad' }, ...['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(k =>
        el('button', { type: 'button', class: `ctr-pad-key ${k === 'C' || k === '⌫' ? 'muted' : ''}`, 'aria-label': k === '⌫' ? 'Backspace' : k === 'C' ? 'Clear' : k, onclick: () => press(k) }, k)));
      setTimeout(() => {
        const handler = e => {
          if (sheet !== 'qty') { document.removeEventListener('keydown', handler, true); return; }
          if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
          else if (e.key === 'Backspace') { e.preventDefault(); press('⌫'); }
          else if (e.key === 'Enter' && qtyValue) { e.preventDefault(); dialog.querySelector('.ctr-pad-sheet .ctr-complete')?.click(); }
        };
        if (!dialog._padKeys) { dialog._padKeys = true; document.addEventListener('keydown', e => { if (sheet === 'qty') handler(e); }, true); }
      });
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet ctr-pad-sheet', role: 'dialog', 'aria-label': `Quantity for ${item.name}` },
          el('div', { class: 'ctr-sheet-head' }, el('h3', {}, item.name), close),
          display, pad, setBtn));
    }
    // Held: only tickets put on Hold (newest first). They are cleared at the end of the day.
    if (sheet === 'held') {
      const list = el('ul', { class: 'ctr-held' });
      if (!held.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No held orders'), el('span', {}, 'Orders on hold stay here until the end of the day.')));
      for (const h of held.filter(h => Array.isArray(h.lines))) {
        const count = h.lines.reduce((n, l) => n + l.qty, 0), what = [h.number ? `#${h.number}` : '', describe(h)].filter(Boolean).join(' · ');
        list.append(el('li', {},
          el('div', { class: 'ctr-held-copy' }, el('strong', {}, what || 'Order'), el('span', {}, `${count} item${count === 1 ? '' : 's'} · ${money(h.total)} · held ${timeOf(h.savedAt)}`)),
          el('button', { type: 'button', class: 'ctr-text-button danger', 'aria-label': 'Delete held order', onclick: () => removeHeld(h.heldId) }, svg(ICON.trash)),
          el('button', { type: 'button', class: 'primary-button ctr-resume', onclick: () => resume(h.heldId) }, 'Resume')));
      }
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet', role: 'dialog', 'aria-label': 'Held orders' }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Held orders'), close), list));
    }
    // Assign Pager: the pagers by number; a pager on another open order shows "In use" (it can still be chosen).
    if (sheet === 'pager') {
      const inUse = new Set([...held, ...loadOrders().filter(o => !o.paidAt && o.number !== order.number)].map(o => cleanPager(o.pager)).filter(Boolean));
      const choose = n => { order.pager = n; sheet = null; render(); };
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
            el('strong', {}, `#${o.number}`, who ? el('span', { class: 'ctr-history-desc' }, ` · ${who}`) : null),
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
            el('span', {}, [`Order #${o.number}`, Number.isFinite(o.received) ? `Received ${money(o.received)}` : '', o.change > 0 ? `Change ${money(o.change)}` : ''].filter(Boolean).join(' · '))),
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
          el('p', { class: 'ctr-receipt-meta' }, [`Order #${receipt.number}`, describe(receipt), 'Cash'].filter(Boolean).join(' · ')),
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
    const searchHadFocus = document.activeElement?.id === 'counter-search', tableHadFocus = document.activeElement?.id === 'counter-table';
    if (highlight && !order.lines.length) highlight = false; // the last item went: back to the usual view
    root.replaceChildren(el('div', { class: `ctr-shell${highlight ? ' highlight' : ''}` }, orderPanel(), menuPanel()), typeMenu ? el('div', { class: 'ctr-type-scrim', onclick: () => openTypeMenu(false) }) : '', optionsMenu ? el('div', { class: 'ctr-options-scrim', onclick: () => openOptions(false) }) : '', sheetView() || '');
    renderMenuBody();
    const lines = dialog.querySelector('.ctr-lines');
    if (lines && dialog.open) { lines.scrollTop = scrollMemo.lines; scrollMemo.lines = lines.scrollTop; }
    // The order list's scroll handle (scroll-handle.js) instead of the browser's scroll bar: three sky blue lines
    // together in the middle.
    if (lines) window.RestroScrollHandle?.attach(lines, { host: lines.parentElement, lines: 3, key: 'counter-lines' });
    if (searchHadFocus) { const s = dialog.querySelector('#counter-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    if (tableHadFocus) dialog.querySelector('#counter-table')?.focus();
  }
  function toast(message) { if (typeof window.toast === 'function') window.toast(message); else document.querySelector('#toast') && (document.querySelector('#toast').textContent = message); }

  function goBack() {
    if (!dialog.open) return false;
    if (typeMenu) { openTypeMenu(false); return true; }
    if (optionsMenu) { openOptions(false); return true; }
    if (panelArranging) { setPanelArranging(false); return true; }
    if (sheet && sheet !== 'receipt') { sheet = null; render(); return true; }
    if (sheet === 'receipt') { sheet = null; receipt = null; render(); return true; }
    if (highlight) { setHighlight(false); return true; } // a sheet opened from it closes first

    if (arranging) { setArranging(false); return true; }
    if (query) { query = ''; render(); return true; }
    if (category) { category = null; renderMenuBody(); return true; }
    if (fromFloor && window.RestroFloor) { fromFloor = false; window.RestroFloor.open(); return true; } // opened from a table: Back returns to the Floor
    if (fromOrders && window.RestroOrders) { fromOrders = false; window.RestroOrders.open(); return true; } // opened from Orders: Back returns there
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  // Tapping anywhere outside the open (selected) item puts it back to a plain line. The tap still does its own job.
  dialog.addEventListener('click', event => {
    if (!selected || !dialog.open) return;
    if (event.target.closest?.('.ctr-line')?.dataset.line === selected) return;
    selected = null; render();
  }, true);
  // Remember where the order list was scrolled while Counter is on screen (a hidden list reports 0, so it is ignored then).
  root.addEventListener('scroll', event => {
    if (dialog.open && event.target.classList?.contains('ctr-lines')) scrollMemo.lines = event.target.scrollTop;
  }, true);
  // Leaving Counter ends rearranging; the order, the page and everything else stay as they were.
  dialog.addEventListener('close', () => { clearTimeout(holdTimer); holdTimer = null; gesture = null; if (drag) endDrag(true, false); arranging = false; clearTimeout(panelHold); panelGesture = null; if (panelDrag) endPanelDrag(true); panelArranging = false; });
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
    // Every saved order (Save or Pay), newest first, as kept on this device.
    orders() { return JSON.parse(JSON.stringify(allOrders())); },
    goBack,
    tablesInUse() {
      const used = [...loadOrders().filter(o => !o.paidAt), ...held].filter(usesTable).map(o => o.table);
      if (order.lines.length && usesTable(order)) used.push(order.table);
      return used;
    },
    get order() { return JSON.parse(JSON.stringify(order)); }
  });
})();
