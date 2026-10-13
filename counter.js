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

  // ---------- storage ----------
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let held = load(HELD_KEY, []); if (!Array.isArray(held)) held = [];
  const nextNumber = () => { const n = Number(load(NUM_KEY, 1001)) || 1001; store(NUM_KEY, n + 1); return n; };

  // ---------- state ----------
  const blankOrder = () => ({ type: 'dine-in', split: false, table: '', lines: [], heldId: null });
  const TYPES = ['dine-in', 'takeaway', 'delivery'];
  // With Split on, each line keeps its own type; otherwise every line follows the order type.
  const lineType = line => order.split ? (line.type || order.type) : order.type;
  const keyOf = line => `${line.id}@${lineType(line)}`;
  let qtyKey = null, qtyValue = '';
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, clearArmed = false;
  let cashInput = '';                                   // cash typed on the payment sheet
  const scrollMemo = { lines: 0, menu: 0, view: '' };   // where the order list and the menu were scrolled

  // Leaving Counter (Home, Recents, or the app/page restarting) keeps everything as it was:
  // the order on screen, plus the category or search the menu was showing.
  const saveDraft = () => store(DRAFT_KEY, { order, category, query });
  (() => {
    const saved = load(DRAFT_KEY, null);
    if (!saved || typeof saved !== 'object') return;
    const o = saved.order;
    if (o && Array.isArray(o.lines)) {
      const type = TYPES.includes(o.type) ? o.type : 'dine-in';
      order = { type, split: o.split === true, table: typeof o.table === 'string' ? o.table : '', heldId: typeof o.heldId === 'string' ? o.heldId : null,
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
    const gross = subtotal + tax, total = Math.round(gross / 100) * 100;
    return { subtotal, tax, roundOff: total - gross, total, count: order.lines.reduce((n, l) => n + l.qty, 0) };
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
    'dine-in': '<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6M16 21V3c2 1 3 3.5 3 7h-3"/>',
    takeaway: '<path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    delivery: '<path d="M3 7h10v9H3zM13 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    split: '<path d="M12 3v7M12 10l-6 6M12 10l6 6M6 16v5M18 16v5"/>'
  };
  // The Counter app's own artwork; it follows the active theme like the home tile.
  const counterIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode(shortcuts.find(item => item.id === 'register').art) : document.createElement('span');
    art.classList.add('ctr-title-icon'); return art;
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
    if (!on) { order.lines.forEach(l => { l.type = order.type; }); tidy(); toast(`Split off · all items ${typeLabel[order.type].toLowerCase()}`); }
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
    order = { type: entry.type, split: Boolean(entry.split), table: entry.table || '', lines: entry.lines.filter(l => items.has(l.id)).map(l => ({ ...l, type: l.type || entry.type })), heldId: entry.heldId };
    sheet = null; selected = null; render(); toast('Order resumed');
  }
  function removeHeld(id) { held = held.filter(h => h.heldId !== id); store(HELD_KEY, held); render(); }
  function complete(received) {
    const t = totals(); if (!t.count || received < t.total) return;
    const number = nextNumber();
    const done = { number, type: order.type, split: order.split, table: order.table, lines: order.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: items.get(l.id).price, qty: l.qty, type: lineType(l) })), ...t, method: 'cash', received, change: received - t.total, paidAt: new Date().toISOString() };
    const list = load(DONE_KEY, []); store(DONE_KEY, [done, ...(Array.isArray(list) ? list : [])].slice(0, 500));
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    receipt = done; sheet = 'receipt'; order = blankOrder(); selected = null; category = null; query = ''; cashInput = ''; render();
    window.RestroSound?.play('tick');
    window.dispatchEvent(new CustomEvent('restro:order-paid', { detail: done }));
  }

  // ---------- rendering ----------
  const typeLabel = { 'dine-in': 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
  function orderPanel() {
    const t = totals();
    const header = el('div', { class: 'ctr-order-head' },
      el('div', { class: 'ctr-titlebar' },
        el('div', { class: 'ctr-title-left' },
          el('button', { class: 'ctr-icon-button ctr-back', type: 'button', 'aria-label': 'Home', title: 'Home', onclick: () => { const home = document.querySelector('#system-home'); if (home) home.click(); else dialog.close(); } }, svg(ICON.home)),
          el('h2', { id: 'counter-title', tabindex: '-1' }, 'Counter')),
        counterIcon(),
        el('button', { class: `ctr-text-button ctr-clear ${clearArmed ? 'armed' : ''}`, type: 'button', 'aria-label': clearArmed ? 'Tap again to clear the order' : 'Clear order', title: 'Clear order', disabled: !order.lines.length, onclick: () => {
          if (!clearArmed) { clearArmed = true; render(); setTimeout(() => { if (clearArmed) { clearArmed = false; render(); } }, 3000); return; }
          order.lines = []; order.heldId = null; clearArmed = false; selected = null; render(); toast('Order cleared');
        } }, svg(ICON.trash))),
      // Order type: names only, two rows on the left — Dine in · Takeaway / Delivery · Split.
      el('div', { class: 'ctr-types', role: 'group', 'aria-label': 'Order type' },
        ...TYPES.map(key => el('button', { type: 'button', 'aria-pressed': String(order.type === key), class: `ctr-type-btn ${order.type === key ? 'on' : ''}`, onclick: () => setType(key) }, typeLabel[key])),
        el('button', { type: 'button', role: 'switch', 'aria-checked': String(order.split), class: `ctr-type-btn ctr-split ${order.split ? 'on' : ''}`, onclick: () => setSplit(!order.split) }, 'Split')),
      order.split ? el('p', { class: 'ctr-split-note' }, `Split order · new items go to ${typeLabel[order.type]}. Tap an item to move it.`) : null);

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
        if (order.split) li.append(el('div', { class: 'ctr-move', role: 'radiogroup', 'aria-label': `Serve ${item.name} as` },
          el('span', {}, 'Serve as'),
          ...TYPES.map(type => el('button', { type: 'button', role: 'radio', 'aria-checked': String(lineType(line) === type), class: lineType(line) === type ? 'on' : '', onclick: () => moveLine(key, type) }, typeLabel[type]))));
      }
      return li;
    };
    if (order.split) {
      for (const type of TYPES) {
        const group = order.lines.filter(l => lineType(l) === type); if (!group.length) continue;
        const count = group.reduce((n, l) => n + l.qty, 0);
        list.append(el('li', { class: 'ctr-group' }, svg(ICON[type]), el('span', {}, typeLabel[type]), el('span', { class: 'ctr-group-count' }, `${count} item${count === 1 ? '' : 's'}`)));
        group.forEach(line => list.append(lineRow(line)));
      }
    } else order.lines.forEach(line => list.append(lineRow(line)));

    const sums = el('dl', { class: 'ctr-sums' },
      el('dt', {}, `Subtotal${t.count ? ` · ${t.count} item${t.count === 1 ? '' : 's'}` : ''}`), el('dd', {}, money(t.subtotal)),
      el('dt', {}, menu.taxLabel), el('dd', {}, money(t.tax)),
      t.roundOff ? el('dt', {}, 'Round off') : null, t.roundOff ? el('dd', {}, `${t.roundOff > 0 ? '+' : '−'}${money(Math.abs(t.roundOff))}`) : null,
      el('dt', { class: 'ctr-total' }, 'Total'), el('dd', { class: 'ctr-total' }, money(t.total)));

    const actions = el('div', { class: 'ctr-actions' },
      el('button', { type: 'button', class: 'ctr-secondary', disabled: !t.count, onclick: () => newOrder() }, 'Save'),
      el('button', { type: 'button', class: 'primary-button ctr-pay', disabled: !t.count, onclick: () => { cashInput = ''; sheet = 'pay'; render(); } }, t.count ? `Pay ${money(t.total)}` : 'Pay'));

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
    return el('section', { class: 'ctr-menu', 'aria-label': 'Menu' }, top, el('div', { class: 'ctr-menu-body' }),
      menu.sample ? el('p', { class: 'ctr-sample' }, 'Sample menu. Replace it with your own in Menu.') : null);
  }

  const matches = () => { const q = query.trim().toLowerCase(); if (!q) return []; return [...items.values()].filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase() === q); };
  function itemTile(item) {
    const qty = order.lines.filter(l => l.id === item.id).reduce((n, l) => n + l.qty, 0);
    return el('button', { type: 'button', class: 'ctr-item', style: `--stripe:${categoryOf.get(item.id).color}`, onclick: () => add(item.id), 'aria-label': `Add ${item.name}, ${rupees(item.price)}${qty ? `, ${qty} in order` : ''}` },
      el('span', { class: 'ctr-item-name' }, item.name),
      el('span', { class: 'ctr-item-foot' }, el('span', { class: 'ctr-item-price' }, rupees(item.price)), qty ? el('span', { class: 'ctr-badge' }, String(qty)) : null));
  }
  function renderMenuBody() {
    saveDraft(); // every change to the order or to the menu view comes through here, so it is always kept
    const body = dialog.querySelector('.ctr-menu-body'); if (!body) return;
    const q = query.trim(), view = q ? `q:${q}` : category ? `c:${category}` : 'all';
    if (q) {
      const found = matches();
      body.replaceChildren(el('div', { class: 'ctr-crumb' }, el('strong', {}, found.length ? `${found.length} result${found.length === 1 ? '' : 's'} for “${q}”` : `No items match “${q}”`)),
        el('div', { class: 'ctr-grid items' }, ...found.map(itemTile)));
    } else if (category) {
      const c = menu.categories.find(x => x.id === category);
      body.replaceChildren(el('div', { class: 'ctr-crumb' },
        el('button', { type: 'button', class: 'ctr-text-button', onclick: () => { category = null; renderMenuBody(); } }, svg(ICON.chevron), 'All categories'),
        el('strong', { style: `--stripe:${c.color}`, class: 'ctr-crumb-name' }, c.name)),
        el('div', { class: 'ctr-grid items' }, ...c.items.map(itemTile)));
    } else {
      // "All categories" stays at the top of the grid too: same look as the back button, without the arrow.
      body.replaceChildren(el('div', { class: 'ctr-crumb' }, el('span', { class: 'ctr-text-button ctr-crumb-root' }, 'All categories')),
        el('div', { class: 'ctr-grid categories' }, ...menu.categories.map(c =>
          el('button', { type: 'button', class: 'ctr-category', style: `--stripe:${c.color}`, onclick: () => { category = c.id; renderMenuBody(); } },
            el('span', { class: 'ctr-category-name' }, c.name), el('span', { class: 'ctr-category-count' }, `${c.items.length} items`)))));
    }
    // Same view (e.g. after adding an item, or coming back to Counter): stay where it was scrolled. New view: start at the top.
    if (view !== scrollMemo.view) { scrollMemo.view = view; scrollMemo.menu = 0; }
    if (dialog.open) { body.scrollTop = scrollMemo.menu; scrollMemo.menu = body.scrollTop; }
  }

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
          el('div', { class: 'ctr-held-copy' }, el('strong', {}, h.split ? `Split · ${[...new Set(h.lines.map(l => typeLabel[l.type || h.type]))].join(' + ')}` : typeLabel[h.type]), el('span', {}, `${count} item${count === 1 ? '' : 's'} · ${money(h.total)} · saved ${time}`)),
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
          el('p', { class: 'ctr-receipt-meta' }, `Order #${receipt.number} · ${receipt.split ? `Split · ${[...new Set(receipt.lines.map(l => typeLabel[l.type]))].join(' + ')}` : typeLabel[receipt.type]} · Cash`),
          el('dl', { class: 'ctr-sums' },
            el('dt', {}, 'Total'), el('dd', {}, money(receipt.total)),
            el('dt', {}, 'Cash received'), el('dd', {}, money(receipt.received)),
            el('dt', { class: 'ctr-total' }, 'Change to give'), el('dd', { class: 'ctr-total' }, money(receipt.change))),
          el('button', { type: 'button', class: 'primary-button ctr-complete', onclick: () => { sheet = null; receipt = null; render(); dialog.querySelector('#counter-search')?.focus(); } }, 'New order')));
    }
    return null;
  }

  function render() {
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
    if (query) { query = ''; render(); return true; }
    if (category) { category = null; renderMenuBody(); return true; }
    return false;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  // Remember scroll positions while Counter is on screen (a hidden list reports 0, so it is ignored then).
  root.addEventListener('scroll', event => {
    if (!dialog.open) return;
    if (event.target.classList?.contains('ctr-lines')) scrollMemo.lines = event.target.scrollTop;
    else if (event.target.classList?.contains('ctr-menu-body')) scrollMemo.menu = event.target.scrollTop;
  }, true);
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
    get order() { return JSON.parse(JSON.stringify(order)); }
  });
})();
