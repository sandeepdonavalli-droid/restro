'use strict';
// Orders: a full-screen app with every saved order (Save or Pay), newest first, one order to a row: everything about
// the order reads from left to right in five columns — the time with the date under it, the order type, the customer or
// table with the server under it, the order status (Open or Closed, with where the order is under Open), and the
// payment (the amount with the payment status under it) —
// then two round buttons side by side, well apart, with no column name: text the customer (when the order has their
// phone number, whatever the status, until 1 hour 15 minutes after the order is done on every side) and buzz the
// order's pager, its number on the button (whatever the status, until the pager is docked back; then greyed out,
// keeping the number for the record). The ticket number
// shows on the opened order. The list scrolls by touch, with no scroll bar, over the buttons too. Tapping an order
// anywhere but its buttons opens it: in Counter while it isn't paid (Back returns here), as its receipt once it is; a tap
// around the buttons does nothing, so a near miss never opens the order.
// Held (Counter's Held button) is the same page for the orders on hold, newest first, in the same columns: when it was
// held, its type, the customer or table with the server, Held as its order status, and the total with Held under it,
// both Held in grey; both round buttons are greyed out (its table and pager were released when it was held). Tapping
// a held order carries on with it in Counter.
(() => {
  const dialog = document.querySelector('#orders-dialog');
  if (!dialog) return;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const svg = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = path; return s; };
  const ICON = { home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h4v-5h3v5h4V10"/>', back: '<path d="m15 6-6 6 6 6"/>',
    send: '<path d="M21 3 10.2 13.8"/><path d="M21 3 14.3 21l-4.1-7.2L3 9.7Z"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>' };
  const appIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode(shortcuts.find(item => item.id === 'orders').art) : document.createElement('span');
    art.classList.add('ord-title-icon'); return art;
  };

  // The order types in Counter's words and colours.
  const TYPES = { 'dine-in': ['Dine in', '#d4743a'], takeaway: ['Takeaway', '#c9a227'], delivery: ['Delivery', '#c4534a'], phone: ['Phone call', '#5f9a4c'] };
  const METHODS = { cash: 'Cash', upi: 'UPI', card: 'Card' };
  const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dayKey = when => { const d = new Date(when); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const timeOf = when => new Date(when).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const whenShort = when => dayKey(when) === dayKey(Date.now()) ? timeOf(when) : `${new Date(when).toLocaleDateString('en-IN', { weekday: 'short' })} ${timeOf(when)}`;
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';

  // The type (or, for an order with Modify, the types its items go as) and the colour of its first one.
  function typeOf(o) {
    const keys = o.split ? [...new Set(o.lines.map(l => l.type || o.type))] : [o.type];
    const known = keys.filter(k => TYPES[k]);
    const first = TYPES[known[0]] || TYPES['dine-in'];
    return { label: known.length ? known.map(k => TYPES[k][0]).join(' + ') : first[0], color: first[1] };
  }
  // The customer's name, the table, or Guest when the order has neither.
  const nameOf = o => [o.customer?.name, o.table ? `Table ${tableName(o.table)}` : ''].filter(Boolean).join(' · ') || 'Guest';
  // The order status: Open (orange) until the order is done, then Closed (green). With the kitchen screen (KDS, to
  // build: it marks the order `kitchenDoneAt` when the kitchen marks the whole order complete), done means paid and
  // marked complete. Under Open: Scheduled with its time (plum) while the order waits for its kitchen time, even when it
  // is paid; In kitchen (grey) once it goes to the kitchen; then Ready (green) once the kitchen marks it complete (a paid
  // order closes then). Without the kitchen screen, Open and Closed only, by the payment.
  // Every restaurant has the kitchen screen for now (the full software); subscription levels will decide it later.
  const KITCHEN_SCREEN = true;
  function statusOf(o) {
    const waiting = !o.sentAt && Boolean(o.readyAt), screen = KITCHEN_SCREEN && Boolean(o.sentAt), ready = screen && Boolean(o.kitchenDoneAt);
    if (o.paidAt && !waiting && (!screen || ready)) return { text: 'Closed', cls: 'closed' };
    const sub = waiting ? [`Scheduled ${whenShort(o.readyAt)}`, 'scheduled'] : ready ? ['Ready', 'ready'] : screen ? ['In kitchen', 'kitchen'] : [];
    return { text: 'Open', cls: 'open', sub: sub[0], subCls: sub[1] };
  }
  // When the order was done on every side: Closed (paid, and complete in the kitchen) with its pager back in its dock
  // (when it had one); 0 while it isn't. Text greys out 1 hour 15 minutes after that: the customer is long gone.
  const TEXT_FOR = 75 * 60000;
  function doneAt(o, status) {
    if (status.cls !== 'closed' || o.pagerOut) return 0;
    return Math.max(Date.parse(o.paidAt) || 0, Number(o.kitchenDoneAt) || 0, o.pager ? Number(o.pagerBackAt) || 0 : 0);
  }
  const COLUMNS = [['Date & time', 'ord-when'], ['Order type', 'ord-typecell'], [() => ['Customer / ', el('span', { class: 'ord-keep' }, 'Table - Server')], 'ord-name'], ['Order status', 'ord-status'], ['Payment status', 'ord-pay'], ['', 'ord-acts']];
  // (the name column's heading, on a small tablet, breaks only after the slash)
  // The date under the time, in numbers: 03/11/2026 (day/month/year)
  const fullDate = when => new Date(when).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const cell = (cls, ...content) => el('span', { class: `ord-c ${cls}` }, ...content);
  // Two details in one column, one under the other: the main one, and a smaller one under it (left out when empty)
  const twoLines = (cls, main, sub, subCls = '') => cell(`ord-two ${cls}`, el('span', { class: 'ord-main' }, main), sub ? el('span', { class: `ord-sub ${subCls}`.trim() }, sub) : null);

  function row(o) {
    const held = view === 'held', when = held ? o.savedAt : o.createdAt;
    const type = typeOf(o), status = held ? { text: 'Held', cls: 'held' } : statusOf(o), paid = !held && Boolean(o.paidAt), name = nameOf(o);
    // Payment status: Paid (with how), Not paid or Partially paid (orange), Refunded (red; once refunds are kept); Held (grey).
    const refunded = !held && Boolean(o.refundedAt), partial = !held && !paid && Number.isFinite(o.paidAmount) && o.paidAmount > 0 && o.paidAmount < o.total;
    const pay = held ? 'Held' : refunded ? 'Refunded' : paid ? `Paid · ${METHODS[o.method] || 'Cash'}` : partial ? 'Partially paid' : 'Not paid';
    const payClass = held ? 'held' : refunded ? 'refunded' : paid ? 'paid' : 'unpaid';
    const phone = typeof o.customer?.mobile === 'string' && o.customer.mobile.trim() ? o.customer.mobile.trim() : '';
    // The two round buttons: text the customer (greyed out without a phone number) and buzz the pager ("Buzz" over its
    // number; "Buzz" greyed out without one). A tap on either only does its action, or nothing when it is greyed out; a
    // tap between or around them does nothing; neither ever opens the order. Text works whenever the order has the
    // customer's phone number, whatever its status (a customer may need it again after leaving the pager, or never had
    // one), until the order has been done on every side for over 1 hour 15 minutes. Buzz works while the order still has
    // its pager, whatever its status: until the pager is docked back in its docking station (or goes to a newer order);
    // then it is greyed out, its number staying for the record of which pager the order had. A held order has both
    // greyed out (its pager was released when it was held).
    const since = held ? 0 : doneAt(o, status), longDone = since > 0 && Date.now() - since > TEXT_FOR;
    const off = held ? 'the order is on hold' : longDone ? 'the order was done over 1 hour 15 minutes ago' : '';
    const textOn = !off && Boolean(phone), buzzOn = !held && Boolean(o.pager) && Boolean(o.pagerOut), pagerNo = !held && o.pager ? String(o.pager) : '';
    const bubble = (cls, on, label, act, ...content) => el('button', { type: 'button', class: `ord-bubble ${cls}${on ? '' : ' off'}`, 'aria-disabled': on ? null : 'true', 'aria-label': label,
      onclick: e => { e.stopPropagation(); if (on) act(); }, onkeydown: e => e.stopPropagation() }, ...content);
    const acts = el('span', { class: 'ord-c ord-acts', onclick: e => e.stopPropagation() },
      bubble('ord-text', textOn, textOn ? `Text ${name}` : `Text: ${off || 'no phone number'}`, () => textCustomer(o), svg(ICON.send)),
      bubble('ord-ping', buzzOn, buzzOn ? `Buzz pager ${o.pager}` : pagerNo ? `Pager ${pagerNo}: back in its dock` : `Buzz: ${held ? off : 'no pager'}`, () => buzzPager(o), el('span', { class: 'ord-ping-word' }, 'Buzz'), pagerNo ? el('span', { class: 'ord-ping-no' }, pagerNo) : null));
    const cells = [
      twoLines('ord-when', timeOf(when), fullDate(when)),
      cell('ord-typecell', el('span', { class: 'ord-type' }, type.label)),
      twoLines('ord-name', name, o.server || ''),
      status.sub ? twoLines(`ord-status ${status.cls}`, status.text, status.sub, status.subCls) : cell(`ord-status ${status.cls}`, status.text),
      twoLines('ord-pay', money(o.total), pay, payClass),
      acts];
    const label = held
      ? `Held order, ${timeOf(when)}, ${fullDate(when)}, ${type.label}, ${name}${o.server ? `, server ${o.server}` : ''}, ${money(o.total)}`
      : `Order ${o.number}, ${timeOf(when)}, ${fullDate(when)}, ${type.label}, ${name}${o.server ? `, server ${o.server}` : ''}, ${status.text}${status.sub ? `, ${status.sub}` : ''}, ${money(o.total)}, ${pay}${pagerNo ? `, buzzer ${pagerNo}` : ''}`;
    const open = () => (held ? window.RestroCounter?.resumeHeld(o.heldId) : paid ? showReceipt(o) : window.RestroCounter?.openOrder(o.uid || o.number));
    return el('div', { class: 'ord-row ord-open', role: 'listitem', tabindex: '0', style: `--type:${type.color}`, 'aria-label': `${label}. ${paid ? 'Open the receipt' : 'Open in Counter'}`, onclick: open,
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(); } } }, ...cells);
  }

  // A paid order's receipt, over the list: its ticket number, the order, the items, the sums and the payment.
  const ticket = n => `#${String(n).padStart(2, '0')}`;
  let receipt = null;
  function closeReceipt() { if (!receipt) return false; receipt.remove(); receipt = null; return true; }
  function showReceipt(o) {
    closeReceipt();
    const type = typeOf(o), sub = Number.isFinite(o.subtotal) ? o.subtotal : o.lines.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0);
    const rate = sub ? Math.round((o.tax / sub) * 1000) / 10 : 0;
    const cash = (o.method || 'cash') === 'cash' && Number.isFinite(o.received);
    receipt = el('div', { class: 'ord-sheet-wrap', onclick: e => { if (e.target === e.currentTarget) closeReceipt(); } },
      el('div', { class: 'ord-receipt', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Receipt, order ${ticket(o.number)}` },
        el('div', { class: 'ord-receipt-head' },
          el('h3', {}, 'Receipt'),
          el('button', { type: 'button', class: 'ord-x', 'aria-label': 'Close', onclick: closeReceipt }, svg(ICON.close))),
        el('p', { class: 'ord-receipt-no' }, ticket(o.number)),
        el('p', { class: 'ord-receipt-meta' }, [type.label, nameOf(o)].join(' · ')),
        el('p', { class: 'ord-receipt-meta ord-sub' }, [`${fullDate(o.createdAt)} · ${timeOf(o.createdAt)}`, o.server || ''].filter(Boolean).join(' · ')),
        el('ul', { class: 'ord-receipt-lines' }, ...o.lines.map(l => el('li', {},
          el('span', { class: 'ord-receipt-item' }, l.name), el('span', { class: 'ord-receipt-qty' }, `× ${l.qty}`), el('span', { class: 'ord-receipt-amt' }, money(Math.round(l.price * 100) * l.qty))))),
        el('dl', { class: 'ord-receipt-sums' },
          el('dt', {}, 'Subtotal'), el('dd', {}, money(sub)),
          el('dt', {}, rate ? `GST ${rate}%` : 'GST'), el('dd', {}, money(o.tax || 0)),
          el('dt', { class: 'ord-receipt-total' }, 'Total'), el('dd', { class: 'ord-receipt-total' }, money(o.total)),
          ...(cash ? [el('dt', {}, 'Cash received'), el('dd', {}, money(o.received)), el('dt', {}, 'Change given'), el('dd', {}, money(o.change || 0))] : [])),
        el('p', { class: 'ord-receipt-paid' }, `Paid · ${METHODS[o.method] || 'Cash'} · ${timeOf(o.paidAt)}`)));
    dialog.append(receipt);
    receipt.querySelector('.ord-x')?.focus({ preventScroll: true });
  }
  // Texting the customer and buzzing pagers go through the Android app (RESTRODevice.sms, RESTRODevice.pager); without
  // it, the button says so.
  function textCustomer(o) {
    const sms = window.RESTRODevice?.sms;
    if (typeof sms?.send !== 'function') { toast('Texting starts with the RESTRO Android app'); return; }
    const shop = (localStorage.getItem('restro.restaurantName') || '').trim(), named = shop && shop !== 'RESTAURANT NAME';
    const text = `Your order ${ticket(o.number)} is ready.${named ? ` – ${shop}` : ''}`;
    Promise.resolve(sms.send({ to: o.customer.mobile, code: o.customer.code || '91', text, order: o.uid })).then(ok => toast(ok === false ? 'The text didn’t go' : `Text sent to ${o.customer.name || 'the customer'}`), () => toast('The text didn’t go'));
  }
  function buzzPager(o) {
    const pager = window.RESTRODevice?.pager;
    if (typeof pager?.buzz !== 'function') { toast('Pagers start with the RESTRO Android app'); return; }
    Promise.resolve(pager.buzz(o.pager)).then(ok => toast(ok === false ? `Pager ${o.pager} didn’t buzz` : `Pager ${o.pager} buzzed`), () => toast(`Pager ${o.pager} didn’t buzz`));
  }
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };

  // Rendered into its own root so the system bar and toasts placed in the dialog survive re-renders.
  const root = el('div', { class: 'ord-root' }); dialog.prepend(root);
  const scrollTops = { orders: 0, held: 0 }; let scrolledAt = 0;
  let fromCounter = false;                 // opened with Counter's Orders or Held button: Back returns to Counter
  let view = 'orders';                     // 'orders', or 'held' (Counter's Held button)

  // Orders (and held orders) saved, paid, held, resumed or deleted on another tablet (sync.js) show at once
  window.addEventListener('restro:data-changed', e => {
    const names = e.detail?.collections || [];
    if (dialog.open && names.includes(view === 'held' ? 'held' : 'orders')) render();
  });
  // A pager docked back on this (the main) system: its order's Buzz goes grey at once (Counter records it first)
  window.addEventListener('restro:pager-docked', () => { if (dialog.open && view === 'orders') render(); });

  function render() {
    const held = view === 'held';
    const orders = (held ? window.RestroCounter?.held?.() : window.RestroCounter?.orders?.()) || [];
    const head = el('div', { class: 'ord-head' },
      el('button', { type: 'button', class: 'ord-nav', 'aria-label': fromCounter ? 'Back to Counter' : 'Home', title: fromCounter ? 'Back' : 'Home',
        onclick: () => { if (!goBack()) document.querySelector('#system-home')?.click(); } }, svg(fromCounter ? ICON.back : ICON.home)),
      appIcon(),
      el('h2', { id: 'orders-title', tabindex: '-1' }, held ? 'Held' : 'Orders'));
    // The column names stay at the top while the rows scroll under them.
    const grid = orders.length
      ? el('div', { class: 'ord-list', onscroll: e => { scrollTops[view] = e.currentTarget.scrollTop; scrolledAt = Date.now(); } },
        el('div', { class: 'ord-cols', 'aria-hidden': 'true' }, ...COLUMNS.map(([name, cls]) => el('span', { class: `ord-c ${cls}` }, typeof name === 'function' ? name() : name))),
        el('div', { class: 'ord-rows', role: 'list', 'aria-label': held ? 'Held orders, newest first' : 'Orders, newest first' }, ...orders.map(row)))
      : held
        ? el('div', { class: 'ord-empty' }, el('strong', {}, 'No held orders'), el('span', {}, 'Orders on hold stay here until the end of the day.'))
        : el('div', { class: 'ord-empty' }, el('strong', {}, 'No orders yet'), el('span', {}, 'Orders show here once they are saved or paid in Counter.'));
    root.replaceChildren(head, orders.length ? el('div', { class: 'ord-body' }, grid) : grid);
    if (orders.length) grid.scrollTop = scrollTops[view];
  }

  // While open, the tiles keep up with the kitchen (a scheduled order goes to the kitchen at its time).
  let timer = null;
  dialog.addEventListener('close', () => { clearInterval(timer); timer = null; fromCounter = false; closeReceipt(); });
  // Back: to Counter when Orders was opened from there; otherwise Orders closes (to the home screen).
  function goBack() {
    if (!dialog.open || !fromCounter || !window.RestroCounter) return false;
    fromCounter = false; window.RestroCounter.resume(); return true;
  }
  dialog.addEventListener('cancel', event => { if (closeReceipt() || goBack()) event.preventDefault(); }); // Back closes a receipt first

  // Toasts must show above this full-screen app (and go back to Counter, or home, after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) (document.querySelector('#counter-dialog[open]') || toastHome).append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroOrders = Object.freeze({
    // open() from the home screen (or Back from an order); open({ from: 'counter' }) from Counter's Orders button;
    // open({ from: 'counter', view: 'held' }) from Counter's Held button.
    open(options = {}) {
      document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      fromCounter = options.from === 'counter';
      view = options.view === 'held' ? 'held' : 'orders';
      dialog.dataset.view = view; // (Recents counts Held as Counter's)
      render();
      if (!dialog.open) dialog.showModal();
      clearInterval(timer); timer = setInterval(() => { if (dialog.open && Date.now() - scrolledAt > 2000) render(); }, 30000); // not while a finger is scrolling
      dialog.querySelector('#orders-title')?.focus({ preventScroll: true });
    },
    // An order's status as this page shows it ({ text: 'Open' or 'Closed', cls, sub, subCls }), for the home screen
    status: o => statusOf(o),
    goBack
  });
})();
