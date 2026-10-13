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
  const HELD_KEY = 'restro.counter.held.v1', DONE_KEY = 'restro.counter.orders.v1', NUM_KEY = 'restro.counter.nextNumber.v1';
  const items = new Map(), categoryOf = new Map();
  for (const category of menu.categories) for (const item of category.items) { items.set(item.id, item); categoryOf.set(item.id, category); }

  // ---------- storage ----------
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let held = load(HELD_KEY, []); if (!Array.isArray(held)) held = [];
  const nextNumber = () => { const n = Number(load(NUM_KEY, 1001)) || 1001; store(NUM_KEY, n + 1); return n; };

  // ---------- state ----------
  const blankOrder = () => ({ type: 'dine-in', table: '', lines: [], heldId: null });
  let order = blankOrder(), category = null, query = '', selected = null, sheet = null, receipt = null, clearArmed = false;

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
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>'
  };
  // The Counter app's own artwork; it follows the active theme like the home tile.
  const counterIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode(shortcuts.find(item => item.id === 'register').art) : document.createElement('span');
    art.classList.add('ctr-title-icon'); return art;
  };
  const vegMark = veg => el('span', { class: `veg-mark ${veg ? 'veg' : 'non-veg'}`, role: 'img', 'aria-label': veg ? 'Vegetarian' : 'Non-vegetarian' });

  // ---------- actions ----------
  function add(id) {
    const line = order.lines.find(l => l.id === id);
    if (line) line.qty += 1; else order.lines.push({ id, qty: 1 });
    selected = null; clearArmed = false; render();
    const row = dialog.querySelector(`[data-line="${id}"]`); row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('just-added');
  }
  function setQty(id, qty) {
    order.lines = qty > 0 ? order.lines.map(l => l.id === id ? { ...l, qty } : l) : order.lines.filter(l => l.id !== id);
    if (qty <= 0) selected = null; render();
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
    order = { type: entry.type, table: entry.table || '', lines: entry.lines.filter(l => items.has(l.id)), heldId: entry.heldId };
    sheet = null; selected = null; render(); toast('Order resumed');
  }
  function removeHeld(id) { held = held.filter(h => h.heldId !== id); store(HELD_KEY, held); render(); }
  function complete(received) {
    const t = totals(); if (!t.count || received < t.total) return;
    const number = nextNumber();
    const done = { number, type: order.type, table: order.table, lines: order.lines.map(l => ({ id: l.id, name: items.get(l.id).name, price: items.get(l.id).price, qty: l.qty })), ...t, method: 'cash', received, change: received - t.total, paidAt: new Date().toISOString() };
    const list = load(DONE_KEY, []); store(DONE_KEY, [done, ...(Array.isArray(list) ? list : [])].slice(0, 500));
    if (order.heldId) { held = held.filter(h => h.heldId !== order.heldId); store(HELD_KEY, held); }
    receipt = done; sheet = 'receipt'; order = blankOrder(); selected = null; category = null; query = ''; render();
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
          el('h2', { id: 'counter-title' }, 'Counter')),
        counterIcon(),
        el('button', { class: `ctr-text-button ${clearArmed ? 'armed' : ''}`, type: 'button', disabled: !order.lines.length, onclick: () => {
          if (!clearArmed) { clearArmed = true; render(); setTimeout(() => { if (clearArmed) { clearArmed = false; render(); } }, 3000); return; }
          order.lines = []; order.heldId = null; clearArmed = false; selected = null; render(); toast('Order cleared');
        } }, clearArmed ? 'Tap again to clear' : 'Clear')),
      el('div', { class: 'ctr-type', role: 'radiogroup', 'aria-label': 'Order type' },
        ...Object.entries(typeLabel).map(([key, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(order.type === key), class: order.type === key ? 'on' : '', onclick: () => { order.type = key; render(); } }, label))),
      order.type === 'dine-in' ? el('label', { class: 'ctr-table' }, el('span', {}, 'Table'),
        el('input', { id: 'counter-table', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '—', value: order.table, oninput: e => { order.table = e.target.value.replace(/[^\dA-Za-z]/g, '').toUpperCase(); e.target.value = order.table; } })) : null);

    const list = el('ul', { class: 'ctr-lines', 'aria-label': 'Items in this order' });
    if (!order.lines.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No items yet'), el('span', {}, 'Tap a category, then an item to add it.')));
    for (const line of order.lines) {
      const item = items.get(line.id), open = selected === line.id;
      const li = el('li', { class: `ctr-line ${open ? 'open' : ''}`, 'data-line': line.id, style: `--stripe:${categoryOf.get(line.id).color}` },
        el('button', { type: 'button', class: 'ctr-line-main', 'aria-expanded': String(open), onclick: () => { selected = open ? null : line.id; render(); } },
          vegMark(item.veg),
          el('span', { class: 'ctr-line-name' }, item.name),
          el('span', { class: 'ctr-line-qty' }, `×${line.qty}`),
          el('span', { class: 'ctr-line-price' }, rupees(item.price * line.qty))));
      if (open) li.append(el('div', { class: 'ctr-line-edit' },
        el('span', { class: 'ctr-unit' }, `${rupees(item.price)} each`),
        el('div', { class: 'ctr-stepper' },
          el('button', { type: 'button', class: 'ctr-icon-button', 'aria-label': `One less ${item.name}`, onclick: () => setQty(line.id, line.qty - 1) }, svg(ICON.minus)),
          el('output', { 'aria-live': 'polite' }, String(line.qty)),
          el('button', { type: 'button', class: 'ctr-icon-button', 'aria-label': `One more ${item.name}`, onclick: () => setQty(line.id, line.qty + 1) }, svg(ICON.plus))),
        el('button', { type: 'button', class: 'ctr-text-button danger', onclick: () => setQty(line.id, 0) }, svg(ICON.trash), 'Remove')));
      list.append(li);
    }

    const sums = el('dl', { class: 'ctr-sums' },
      el('dt', {}, `Subtotal${t.count ? ` · ${t.count} item${t.count === 1 ? '' : 's'}` : ''}`), el('dd', {}, money(t.subtotal)),
      el('dt', {}, menu.taxLabel), el('dd', {}, money(t.tax)),
      t.roundOff ? el('dt', {}, 'Round off') : null, t.roundOff ? el('dd', {}, `${t.roundOff > 0 ? '+' : '−'}${money(Math.abs(t.roundOff))}`) : null,
      el('dt', { class: 'ctr-total' }, 'Total'), el('dd', { class: 'ctr-total' }, money(t.total)));

    const fast = el('div', { class: 'ctr-fast' }, el('p', {}, 'Fast pay with cash'),
      el('div', { class: 'ctr-fast-row' },
        ...cashOptions(t.total).map(value => el('button', { type: 'button', class: 'ctr-chip', disabled: !t.count, onclick: () => complete(value) }, money(value).replace('.00', ''))),
        el('button', { type: 'button', class: 'ctr-chip', disabled: !t.count, onclick: () => { sheet = 'pay'; render(); } }, 'Custom')));

    const actions = el('div', { class: 'ctr-actions' },
      el('button', { type: 'button', class: 'ctr-secondary', disabled: !t.count, onclick: () => newOrder() }, 'Save'),
      el('button', { type: 'button', class: 'primary-button ctr-pay', disabled: !t.count, onclick: () => { sheet = 'pay'; render(); } }, t.count ? `Pay ${money(t.total)}` : 'Pay'));

    return el('section', { class: 'ctr-order', 'aria-label': 'Current order' }, header, list, el('div', { class: 'ctr-foot' }, sums, fast, actions));
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
    const qty = order.lines.find(l => l.id === item.id)?.qty || 0;
    return el('button', { type: 'button', class: 'ctr-item', style: `--stripe:${categoryOf.get(item.id).color}`, onclick: () => add(item.id), 'aria-label': `Add ${item.name}, ${rupees(item.price)}${qty ? `, ${qty} in order` : ''}` },
      el('span', { class: 'ctr-item-top' }, vegMark(item.veg), qty ? el('span', { class: 'ctr-badge' }, String(qty)) : null),
      el('span', { class: 'ctr-item-name' }, item.name), el('span', { class: 'ctr-item-price' }, rupees(item.price)));
  }
  function renderMenuBody() {
    const body = dialog.querySelector('.ctr-menu-body'); if (!body) return;
    body.replaceChildren();
    if (query.trim()) {
      const found = matches();
      body.append(el('div', { class: 'ctr-crumb' }, el('strong', {}, found.length ? `${found.length} result${found.length === 1 ? '' : 's'} for “${query.trim()}”` : `No items match “${query.trim()}”`)),
        el('div', { class: 'ctr-grid items' }, ...found.map(itemTile)));
      return;
    }
    if (category) {
      const c = menu.categories.find(x => x.id === category);
      body.append(el('div', { class: 'ctr-crumb' },
        el('button', { type: 'button', class: 'ctr-text-button', onclick: () => { category = null; renderMenuBody(); } }, svg(ICON.chevron), 'All categories'),
        el('strong', { style: `--stripe:${c.color}`, class: 'ctr-crumb-name' }, c.name)),
        el('div', { class: 'ctr-grid items' }, ...c.items.map(itemTile)));
      return;
    }
    body.append(el('div', { class: 'ctr-grid categories' }, ...menu.categories.map(c =>
      el('button', { type: 'button', class: 'ctr-category', style: `--stripe:${c.color}`, onclick: () => { category = c.id; renderMenuBody(); } },
        el('span', { class: 'ctr-category-name' }, c.name), el('span', { class: 'ctr-category-count' }, `${c.items.length} items`)))));
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
      const input = el('input', { id: 'counter-received', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: (t.total / 100).toString() });
      const update = () => {
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
    if (sheet === 'held') {
      const list = el('ul', { class: 'ctr-held' });
      if (!held.length) list.append(el('li', { class: 'ctr-empty' }, el('strong', {}, 'No held orders'), el('span', {}, 'Tap Save on an order to keep it here.')));
      for (const h of held) {
        const count = h.lines.reduce((n, l) => n + l.qty, 0), time = new Date(h.savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        list.append(el('li', {},
          el('div', { class: 'ctr-held-copy' }, el('strong', {}, `${typeLabel[h.type]}${h.table ? ` · Table ${h.table}` : ''}`), el('span', {}, `${count} item${count === 1 ? '' : 's'} · ${money(h.total)} · saved ${time}`)),
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
          el('p', { class: 'ctr-receipt-meta' }, `Order #${receipt.number} · ${typeLabel[receipt.type]}${receipt.table ? ` · Table ${receipt.table}` : ''} · Cash`),
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
    const scroll = dialog.querySelector('.ctr-lines')?.scrollTop || 0;
    root.replaceChildren(el('div', { class: 'ctr-shell' }, orderPanel(), menuPanel()), sheetView() || '');
    renderMenuBody();
    const lines = dialog.querySelector('.ctr-lines'); if (lines) lines.scrollTop = scroll;
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
  // Toasts must show above this full-screen app.
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode); else if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroCounter = Object.freeze({
    open() { if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach(d => d.close()); render(); dialog.showModal(); dialog.querySelector('#counter-search')?.focus({ preventScroll: true }); },
    goBack,
    get order() { return JSON.parse(JSON.stringify(order)); }
  });
})();
