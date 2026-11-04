'use strict';
// Orders: a full-screen app with every saved order (Save or Pay), newest first, one order to a row: everything about
// the order reads from left to right in five columns — the time with the date under it, the order type, the customer or
// table with the server under it, the order status, and the payment (the amount with the payment status under it) —
// then two round buttons side by side, well apart, with no column name: text the customer (when the order has their
// phone number) and buzz the order's pager, its number on the button (whatever the payment status). The ticket number
// shows on the opened order. The list scrolls by touch, with no scroll bar, over the buttons too. Tapping an order
// anywhere but its buttons opens it: in Counter while it isn't paid (Back returns here), as its receipt once it is; a tap
// around the buttons does nothing, so a near miss never opens the order.
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
  // Where the order is: waiting for its time (scheduled, with its ready time), with the kitchen, or completed (paid and sent).
  function statusOf(o) {
    if (!o.sentAt) return o.readyAt ? { text: 'Scheduled', sub: whenShort(o.readyAt), cls: 'scheduled' } : { text: 'Saved', cls: '' };
    return o.paidAt ? { text: 'Completed', cls: 'done' } : { text: 'In kitchen', cls: 'kitchen' };
  }
  const COLUMNS = [['Date & time', 'ord-when'], ['Order type', 'ord-typecell'], [() => ['Customer / ', el('span', { class: 'ord-keep' }, 'Table - Server')], 'ord-name'], ['Order status', 'ord-status'], ['Payment status', 'ord-pay'], ['', 'ord-acts']];
  // (the name column's heading, on a small tablet, breaks only after the slash)
  // The date under the time, in numbers: 03/11/2026 (day/month/year)
  const fullDate = when => new Date(when).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const cell = (cls, ...content) => el('span', { class: `ord-c ${cls}` }, ...content);
  // Two details in one column, one under the other: the main one, and a smaller one under it (left out when empty)
  const twoLines = (cls, main, sub, subCls = '') => cell(`ord-two ${cls}`, el('span', { class: 'ord-main' }, main), sub ? el('span', { class: `ord-sub ${subCls}`.trim() }, sub) : null);

  function row(o) {
    const type = typeOf(o), status = statusOf(o), paid = Boolean(o.paidAt), name = nameOf(o);
    // Payment status: Paid (with how), Not paid or Partially paid (orange), Refunded (red; once refunds are kept).
    const refunded = Boolean(o.refundedAt), partial = !paid && Number.isFinite(o.paidAmount) && o.paidAmount > 0 && o.paidAmount < o.total;
    const pay = refunded ? 'Refunded' : paid ? `Paid · ${METHODS[o.method] || 'Cash'}` : partial ? 'Partially paid' : 'Not paid';
    const payClass = refunded ? 'refunded' : paid ? 'paid' : 'unpaid';
    const phone = typeof o.customer?.mobile === 'string' && o.customer.mobile.trim() ? o.customer.mobile.trim() : '';
    // The two round buttons: text the customer (greyed out without a phone number) and buzz the pager ("Buzz" over its
    // number; "Buzz" greyed out without one). A tap on either only does its action, or nothing when it is greyed out; a
    // tap between or around them does nothing; neither ever opens the order.
    const bubble = (cls, on, label, act, ...content) => el('button', { type: 'button', class: `ord-bubble ${cls}${on ? '' : ' off'}`, 'aria-disabled': on ? null : 'true', 'aria-label': label,
      onclick: e => { e.stopPropagation(); if (on) act(); }, onkeydown: e => e.stopPropagation() }, ...content);
    const acts = el('span', { class: 'ord-c ord-acts', onclick: e => e.stopPropagation() },
      bubble('ord-text', Boolean(phone), phone ? `Text ${name}` : 'Text: no phone number', () => textCustomer(o), svg(ICON.send)),
      bubble('ord-ping', Boolean(o.pager), o.pager ? `Buzz pager ${o.pager}` : 'Buzz: no pager', () => buzzPager(o), el('span', { class: 'ord-ping-word' }, 'Buzz'), o.pager ? el('span', { class: 'ord-ping-no' }, String(o.pager)) : null));
    const cells = [
      twoLines('ord-when', timeOf(o.createdAt), fullDate(o.createdAt)),
      cell('ord-typecell', el('span', { class: 'ord-type' }, type.label)),
      twoLines('ord-name', name, o.server || ''),
      status.sub ? twoLines(`ord-status ${status.cls}`, status.text, status.sub) : cell(`ord-status ${status.cls}`, status.text),
      twoLines('ord-pay', money(o.total), pay, payClass),
      acts];
    const label = `Order ${o.number}, ${timeOf(o.createdAt)}, ${fullDate(o.createdAt)}, ${type.label}, ${name}${o.server ? `, server ${o.server}` : ''}, ${status.text}${status.sub ? ` ${status.sub}` : ''}, ${money(o.total)}, ${pay}${o.pager ? `, buzzer ${o.pager}` : ''}`;
    const open = () => (paid ? showReceipt(o) : window.RestroCounter?.openOrder(o.uid || o.number));
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
  let scrollTop = 0, scrolledAt = 0;
  let fromCounter = false;                 // opened with Counter's Orders button: Back returns to Counter

  // Orders saved, paid or deleted on another tablet (sync.js) show at once
  window.addEventListener('restro:data-changed', e => { if (dialog.open && (e.detail?.collections || []).includes('orders')) render(); });

  function render() {
    const orders = window.RestroCounter?.orders?.() || [];
    const head = el('div', { class: 'ord-head' },
      el('button', { type: 'button', class: 'ord-nav', 'aria-label': fromCounter ? 'Back to Counter' : 'Home', title: fromCounter ? 'Back' : 'Home',
        onclick: () => { if (!goBack()) document.querySelector('#system-home')?.click(); } }, svg(fromCounter ? ICON.back : ICON.home)),
      appIcon(),
      el('h2', { id: 'orders-title', tabindex: '-1' }, 'Orders'));
    // The column names stay at the top while the rows scroll under them.
    const grid = orders.length
      ? el('div', { class: 'ord-list', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } },
        el('div', { class: 'ord-cols', 'aria-hidden': 'true' }, ...COLUMNS.map(([name, cls]) => el('span', { class: `ord-c ${cls}` }, typeof name === 'function' ? name() : name))),
        el('div', { class: 'ord-rows', role: 'list', 'aria-label': 'Orders, newest first' }, ...orders.map(row)))
      : el('div', { class: 'ord-empty' }, el('strong', {}, 'No orders yet'), el('span', {}, 'Orders show here once they are saved or paid in Counter.'));
    root.replaceChildren(head, orders.length ? el('div', { class: 'ord-body' }, grid) : grid);
    if (orders.length) grid.scrollTop = scrollTop;
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
    // open() from the home screen (or Back from an order); open({ from: 'counter' }) from Counter's Orders button.
    open(options = {}) {
      document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      fromCounter = options.from === 'counter';
      render();
      if (!dialog.open) dialog.showModal();
      clearInterval(timer); timer = setInterval(() => { if (dialog.open && Date.now() - scrolledAt > 2000) render(); }, 30000); // not while a finger is scrolling
      dialog.querySelector('#orders-title')?.focus({ preventScroll: true });
    },
    goBack
  });
})();
