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
  const items = new Map(), categoryOf = new Map();
  for (const category of menu.categories) for (const item of category.items) { items.set(item.id, item); categoryOf.set(item.id, category); }
  const categoryById = new Map(menu.categories.map(c => [c.id, c]));

  // ---------- storage ----------
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let held = load(HELD_KEY, []); if (!Array.isArray(held)) held = [];
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
  const nextNumber = () => { const n = Number(load(NUM_KEY, 1001)) || 1001; store(NUM_KEY, n + 1); return n; };

  // ---------- state ----------
  // A new order starts with no order type. Dine in can have a table (picked on the Floor); Takeaway / Delivery a customer.
  const blankOrder = () => ({ type: null, split: false, table: '', customer: null, lines: [], heldId: null });
  const cleanCustomer = c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
    ? { id: c.id, name: c.name.slice(0, 60), mobile: String(c.mobile || '').replace(/\D/g, '').slice(0, 15), code: String(c.code || '').replace(/\D/g, '').slice(0, 4), address: String(c.address || '').slice(0, 200) } : null;
  const TYPES = ['dine-in', 'takeaway', 'delivery'];
  // With Split on, each line keeps its own type; otherwise every line follows the order type.
  const lineType = line => order.split ? (line.type || order.type) : order.type;
  const keyOf = line => `${line.id}@${lineType(line)}`;
  let qtyKey = null, qtyValue = '';
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, clearArmed = false;
  let cashInput = '';                                   // cash typed on the payment sheet
  const scrollMemo = { lines: 0 };                      // where the order list was scrolled

  // Leaving Counter (Home, Recents, or the app/page restarting) keeps everything as it was:
  // the order on screen, plus the category or search the menu was showing.
  const saveDraft = () => store(DRAFT_KEY, { order, category, query });
  (() => {
    const saved = load(DRAFT_KEY, null);
    if (!saved || typeof saved !== 'object') return;
    const o = saved.order;
    if (o && Array.isArray(o.lines)) {
      const type = TYPES.includes(o.type) ? o.type : null;
      order = { type, split: Boolean(type) && o.split === true, table: typeof o.table === 'string' ? o.table : '', customer: cleanCustomer(o.customer), heldId: typeof o.heldId === 'string' ? o.heldId : null,
        lines: o.lines.filter(l => l && items.has(l.id) && Number.isInteger(l.qty) && l.qty > 0 && l.qty < 1000).map(l => ({ id: l.id, qty: l.qty, type: TYPES.includes(l.type) ? l.type : type })) };
      tidy();
    }
    if (menu.categories.some(c => c.id === saved.category)) category = saved.category;
    if (typeof saved.query === 'string') query = saved.query.slice(0, 80);
  })();

  // ---------- money (all maths in paise) ----------
  const totals = () => {
    const subtotal = order.lines.reduce((sum, line) => sum + items.get(line.id).price * 100 * line.qty, 0);
    const tax = Math.round(subtotal * menu.taxRate);
    // Total is exactly subtotal + GST (no rounding to the rupee), so the rows on the ticket always add up.
    return { subtotal, tax, total: subtotal + tax, count: order.lines.reduce((n, l) => n + l.qty, 0) };
  };
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
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c.9-3.6 3.6-5.6 7-5.6s6.1 2 7 5.6"/>',
    personAdd: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3.4 3.3-5.6 6.5-5.6 1.6 0 3 .5 4.1 1.4M18.5 13v6M15.5 16h6"/>'
  };

  // ---------- actions ----------
  function add(id) {
    const type = order.type, line = order.lines.find(l => l.id === id && lineType(l) === type);
    if (line) line.qty += 1; else order.lines.push({ id, qty: 1, type });
    selected = null; clearArmed = false; render();
    const row = dialog.querySelector(`[data-line="${id}@${type}"]`); row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('just-added');
  }
  function setQty(key, qty) {
    order.lines = qty > 0 ? order.lines.map(l => keyOf(l) === key ? { ...l, qty } : l) : order.lines.filter(l => keyOf(l) !== key);
    if (qty <= 0) selected = null; render();
  }
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
  function setType(type) {
    order.type = type;
    if (!order.split) order.lines.forEach(l => { l.type = type; });
    render();
  }
  function setSplit(on) {
    if (on) order.lines.forEach(l => { l.type = l.type || order.type; });
    order.split = on;
    if (!on) { order.lines.forEach(l => { l.type = order.type; }); tidy(); if (typeLabel[order.type]) toast(`Split off · all items ${typeLabel[order.type].toLowerCase()}`); }
    selected = null; render();
  }
  function hold() {
    if (!order.lines.length) return false;
    const entry = { ...order, heldId: order.heldId || `h${Date.now()}`, savedAt: Date.now(), total: totals().total };
    held = [entry, ...held.filter(h => h.heldId !== entry.heldId)].slice(0, 30); store(HELD_KEY, held);
    return true;
  }
  function newOrder({ keep = true } = {}) {
    if (keep && hold()) toast(`Order saved · ${held.length} held`);
    order = blankOrder(); selected = null; sheet = null; clearArmed = false; render();
  }
  function resume(id) {
    const entry = held.find(h => h.heldId === id); if (!entry) return;
    if (order.lines.length && order.heldId !== id) hold();
    held = held.filter(h => h.heldId !== id); store(HELD_KEY, held);
    const type = TYPES.includes(entry.type) ? entry.type : null;
    order = { type, split: Boolean(type) && Boolean(entry.split), table: entry.table || '', customer: cleanCustomer(entry.customer), lines: entry.lines.filter(l => items.has(l.id)).map(l => ({ ...l, type: l.type || type })), heldId: entry.heldId };
    sheet = null; selected = null; render(); toast('Order resumed');
  }
  function removeHeld(id) { held = held.filter(h => h.heldId !== id); store(HELD_KEY, held); render(); }
  function complete(received) {
    const t = totals(); if (!t.count || received < t.total) return;
    const number = nextNumber();
    const done = { number, type: order.type, split: order.split, table: order.table, customer: order.customer, lines: order.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: items.get(l.id).price, qty: l.qty, type: lineType(l) })), ...t, method: 'cash', received, change: received - t.total, paidAt: new Date().toISOString() };
    const list = load(DONE_KEY, []); store(DONE_KEY, [done, ...(Array.isArray(list) ? list : [])].slice(0, 500));
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    receipt = done; sheet = 'receipt'; order = blankOrder(); selected = null; category = null; query = ''; cashInput = ''; render();
    window.RestroSound?.play('tick');
    window.dispatchEvent(new CustomEvent('restro:order-paid', { detail: done }));
  }

  // ---------- rendering ----------
  const typeLabel = { 'dine-in': 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  // Middle of the title row: empty until an order type is chosen. Dine in → a Table box (opens the Floor);
  // Takeaway / Delivery → Add Customer (opens Customers). Once chosen, they show the table / the customer.
  function orderTarget() {
    if (order.type === 'dine-in') {
      const name = tableName(order.table);
      return el('button', { type: 'button', class: `ctr-table-box${name ? ' set' : ''}`, 'aria-label': name ? `Table ${name}. Tap to change the table` : 'Select a table', onclick: pickTable },
        el('span', { class: 'ctr-table-label' }, 'Table'), el('strong', {}, name || 'Select'));
    }
    if (order.type === 'takeaway' || order.type === 'delivery') {
      const c = order.customer;
      return el('button', { type: 'button', class: `ctr-customer${c ? ' set' : ''}`, 'aria-label': c ? `Customer ${c.name}. Tap to change the customer` : 'Add customer', onclick: pickCustomer },
        svg(c ? ICON.person : ICON.personAdd), el('span', {}, c ? c.name : 'Add Customer'));
    }
    return el('span', { class: 'ctr-title-gap', 'aria-hidden': 'true' });
  }
  function pickTable() {
    window.RestroFloor?.open({ pick: true, current: order.table, onPick: table => { order.table = table.id; render(); } });
  }
  function pickCustomer() {
    window.RestroCustomers?.open({ pick: true, needAddress: order.type === 'delivery', current: order.customer?.id, onPick: c => { order.customer = cleanCustomer(c); render(); } });
  }
  // How an order is described in Held orders and on the receipt: type, then the table or the customer.
  const describe = o => {
    const type = o.split ? `Split · ${[...new Set(o.lines.map(l => typeLabel[l.type || o.type]).filter(Boolean))].join(' + ')}` : typeLabel[o.type] || '';
    const who = o.type === 'dine-in' && o.table ? `Table ${tableName(o.table)}` : o.type && o.type !== 'dine-in' && o.customer ? o.customer.name : '';
    return [type, who].filter(Boolean).join(' · ');
  };
  function orderPanel() {
    const t = totals();
    const header = el('div', { class: 'ctr-order-head' },
      el('div', { class: 'ctr-titlebar' },
        el('div', { class: 'ctr-title-left' },
          el('button', { class: 'ctr-icon-button ctr-back', type: 'button', 'aria-label': 'Home', title: 'Home', onclick: () => { const home = document.querySelector('#system-home'); if (home) home.click(); else dialog.close(); } }, svg(ICON.home)),
          el('h2', { id: 'counter-title', class: 'visually-hidden', tabindex: '-1' }, 'Counter')),
        orderTarget()),
      // Order type: names only on the left (Dine in · Takeaway / Delivery); Split above Trash on the right.
      el('div', { class: 'ctr-type-row' },
        el('div', { class: 'ctr-types', role: 'group', 'aria-label': 'Order type' },
          ...TYPES.map(key => el('button', { type: 'button', 'aria-pressed': String(order.type === key), class: `ctr-type-btn ${order.type === key ? 'on' : ''}`, onclick: () => setType(key) }, typeLabel[key]))),
        el('div', { class: 'ctr-side' },
          el('button', { type: 'button', role: 'switch', 'aria-checked': String(order.split), class: `ctr-type-btn ctr-split ${order.split ? 'on' : ''}`, disabled: !order.type, title: order.type ? null : 'Choose an order type first', onclick: () => setSplit(!order.split) }, 'Split'),
          el('button', { class: `ctr-text-button ctr-clear ${clearArmed ? 'armed' : ''}`, type: 'button', 'aria-label': clearArmed ? 'Tap again to clear the order' : 'Clear order', title: 'Clear order', disabled: !order.lines.length, onclick: () => {
          if (!clearArmed) { clearArmed = true; render(); setTimeout(() => { if (clearArmed) { clearArmed = false; render(); } }, 3000); return; }
          order.lines = []; order.heldId = null; clearArmed = false; selected = null; render(); toast('Order cleared');
        } }, svg(ICON.trash)))));
    const list = el('ul', { class: 'ctr-lines', 'aria-label': 'Items in this order' });
    if (!order.lines.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No items yet'), el('span', {}, 'Tap a category, then an item to add it.')));
    const lineRow = line => {
      const item = items.get(line.id), key = keyOf(line), open = selected === key;
      const li = el('li', { class: `ctr-line ${open ? 'open' : ''}`, 'data-line': key, style: `--stripe:${categoryOf.get(line.id).color}` },
        el('div', { class: 'ctr-line-main' },
          el('button', { type: 'button', class: 'ctr-line-select', 'aria-expanded': String(open), onclick: () => { selected = open ? null : key; render(); } },
            el('span', { class: 'ctr-line-name' }, item.name)),
          el('div', { class: 'ctr-qty' },
            el('button', { type: 'button', class: 'ctr-qty-btn', 'aria-label': `One less ${item.name}`, onclick: () => setQty(key, line.qty - 1) }, svg(ICON.minus)),
            el('button', { type: 'button', class: 'ctr-qty-num', 'aria-label': `Quantity ${line.qty}. Tap to type a quantity`, onclick: () => { qtyKey = key; qtyValue = ''; sheet = 'qty'; render(); } }, String(line.qty)),
            el('button', { type: 'button', class: 'ctr-qty-btn', 'aria-label': `One more ${item.name}`, onclick: () => setQty(key, line.qty + 1) }, svg(ICON.plus))),
          el('button', { type: 'button', class: 'ctr-line-price', tabindex: '-1', 'aria-hidden': 'true', onclick: () => { selected = open ? null : key; render(); } }, rupees(item.price * line.qty))));
      if (open) {
        li.append(el('div', { class: 'ctr-line-edit' },
          el('span', { class: 'ctr-unit' }, `${rupees(item.price)} each`),
          el('button', { type: 'button', class: 'ctr-text-button danger', onclick: () => setQty(key, 0) }, svg(ICON.trash), 'Remove')));
        // Split order: move this item to another order type (no label; the buttons match the order type buttons above).
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

    const sums = el('dl', { class: 'ctr-sums' },
      el('dt', {}, 'Subtotal'), el('dd', {}, money(t.subtotal)),
      el('dt', {}, menu.taxLabel), el('dd', {}, money(t.tax)),
      el('dt', { class: 'ctr-total' }, 'Total'), el('dd', { class: 'ctr-total' }, money(t.total)));

    const actions = el('div', { class: 'ctr-actions' },
      el('button', { type: 'button', class: 'ctr-secondary', disabled: !t.count, onclick: () => newOrder() }, 'Save'),
      el('button', { type: 'button', class: 'primary-button ctr-pay', disabled: !t.count, 'aria-label': t.count ? `Pay ${money(t.total)}` : null, onclick: () => { cashInput = ''; sheet = 'pay'; render(); } }, 'Pay'));

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
    const top = el('div', { class: 'ctr-menu-top' }, search,
      el('button', { type: 'button', class: 'ctr-tool', onclick: () => { sheet = 'held'; render(); } }, svg(ICON.held), 'Held', held.length ? el('span', { class: 'ctr-badge' }, String(held.length)) : null),
      el('button', { type: 'button', class: 'ctr-tool', onclick: () => newOrder() }, svg(ICON.plus), 'New order'));
    return el('section', { class: 'ctr-menu', 'aria-label': 'Menu' }, top, el('div', { class: 'ctr-menu-body' }));
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

  function layoutPages(view, pager, dots) {
    const width = pager.clientWidth, height = pager.clientHeight;
    if (!width || !height) { pageCount = 1; menuLayout = null; pager.append(el('div', { class: 'ctr-page' }, ...view.tiles)); return; } // not on screen: laid out when shown
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
    const r = pager.getBoundingClientRect(), { cols, tileH } = menuLayout, colW = (r.width - (cols - 1) * GAP) / cols;
    const px = x - r.left, py = y - r.top; if (px < 0 || py < 0 || px > r.width || py > r.height) return null;
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
    if (sheet === 'held') {
      const list = el('ul', { class: 'ctr-held' });
      if (!held.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No held orders'), el('span', {}, 'Tap Save on an order to keep it here.')));
      for (const h of held) {
        const count = h.lines.reduce((n, l) => n + l.qty, 0), time = new Date(h.savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        list.append(el('li', {},
          el('div', { class: 'ctr-held-copy' }, el('strong', {}, describe(h) || 'Order'), el('span', {}, `${count} item${count === 1 ? '' : 's'} · ${money(h.total)} · saved ${time}`)),
          el('button', { type: 'button', class: 'ctr-text-button danger', 'aria-label': 'Delete held order', onclick: () => removeHeld(h.heldId) }, svg(ICON.trash)),
          el('button', { type: 'button', class: 'primary-button ctr-resume', onclick: () => resume(h.heldId) }, 'Resume')));
      }
      return el('div', { class: 'ctr-sheet-wrap', onclick: e => { if (e.target.classList.contains('ctr-sheet-wrap')) { sheet = null; render(); } } },
        el('div', { class: 'ctr-sheet', role: 'dialog', 'aria-label': 'Held orders' }, el('div', { class: 'ctr-sheet-head' }, el('h3', {}, 'Held orders'), close), list));
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
    const searchHadFocus = document.activeElement?.id === 'counter-search', tableHadFocus = document.activeElement?.id === 'counter-table';
    root.replaceChildren(el('div', { class: 'ctr-shell' }, orderPanel(), menuPanel()), sheetView() || '');
    renderMenuBody();
    const lines = dialog.querySelector('.ctr-lines');
    if (lines && dialog.open) { lines.scrollTop = scrollMemo.lines; scrollMemo.lines = lines.scrollTop; }
    if (searchHadFocus) { const s = dialog.querySelector('#counter-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    if (tableHadFocus) dialog.querySelector('#counter-table')?.focus();
  }
  function toast(message) { if (typeof window.toast === 'function') window.toast(message); else document.querySelector('#toast') && (document.querySelector('#toast').textContent = message); }

  function goBack() {
    if (!dialog.open) return false;
    if (sheet && sheet !== 'receipt') { sheet = null; render(); return true; }
    if (sheet === 'receipt') { sheet = null; receipt = null; render(); return true; }
    if (arranging) { setArranging(false); return true; }
    if (query) { query = ''; render(); return true; }
    if (category) { category = null; renderMenuBody(); return true; }
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
  dialog.addEventListener('close', () => { clearTimeout(holdTimer); holdTimer = null; gesture = null; if (drag) endDrag(true, false); arranging = false; });
  // Toasts must show above this full-screen app.
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode); else if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroCounter = Object.freeze({
    // Shown first, then drawn, so the lists can return to where they were scrolled. Nothing is reset here.
    open() { if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach(d => d.close()); dialog.showModal(); render(); dialog.querySelector('#counter-title')?.focus({ preventScroll: true }); },
    goBack,
    tablesInUse() {
      const used = held.filter(h => h.table && (h.type === 'dine-in' || h.split)).map(h => h.table);
      if (order.table && order.lines.length && (order.type === 'dine-in' || order.split)) used.push(order.table);
      return used;
    },
    get order() { return JSON.parse(JSON.stringify(order)); }
  });
})();
