'use strict';
// Orders: a full-screen app with every saved order (Save or Pay), newest first, one order to a row: everything about
// the order reads from left to right — the ticket number (made by the system), the date and time, the order type, the
// order name (the customer, the table, or Guest), the order status, the payment status, the server, the buzzer
// (pager), the items and the total. Tapping an order that is not paid yet opens it in Counter; Back returns here.
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
  const ICON = { home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h4v-5h3v5h4V10"/>', back: '<path d="m15 6-6 6 6 6"/>' };
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
  const dateOf = when => { const d = new Date(when); return d.toLocaleDateString('en-IN', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); };
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
    if (!o.sentAt) return o.readyAt ? { text: `Scheduled · ${whenShort(o.readyAt)}`, cls: 'scheduled' } : { text: 'Saved', cls: '' };
    return o.paidAt ? { text: 'Completed', cls: 'done' } : { text: 'In kitchen', cls: 'kitchen' };
  }
  const COLUMNS = ['Ticket', 'Date & time', 'Type', 'Name', 'Order status', 'Payment status', 'Server', 'Buzzer', 'Items', 'Total'];
  const cell = (cls, ...content) => el('span', { class: `ord-c ${cls}` }, ...content);

  function row(o) {
    const type = typeOf(o), status = statusOf(o), paid = Boolean(o.paidAt), items = o.lines.reduce((n, l) => n + l.qty, 0), name = nameOf(o);
    // Payment status: Paid (with how), Not paid or Partially paid (orange), Refunded (red; once refunds are kept).
    const refunded = Boolean(o.refundedAt), partial = !paid && Number.isFinite(o.paidAmount) && o.paidAmount > 0 && o.paidAmount < o.total;
    const pay = refunded ? 'Refunded' : paid ? `Paid · ${METHODS[o.method] || 'Cash'}` : partial ? 'Partially paid' : 'Not paid';
    const payClass = refunded ? 'refunded' : paid ? 'paid' : 'unpaid';
    const cells = [
      cell('ord-ticket', `#${o.number}`),
      cell('ord-when', `${dateOf(o.createdAt)} · ${timeOf(o.createdAt)}`),
      cell('ord-typecell', el('span', { class: 'ord-type' }, type.label)),
      cell('ord-name', name),
      cell(`ord-status ${status.cls}`, status.text),
      cell(`ord-pay ${payClass}`, pay),
      cell('ord-server', o.server || '—'),
      cell('ord-buzzer', o.pager ? String(o.pager) : '—'),
      cell('ord-items', String(items)),
      cell('ord-total', money(o.total))];
    const label = `Order ${o.number}, ${dateOf(o.createdAt)} ${timeOf(o.createdAt)}, ${type.label}, ${name}, ${status.text}, ${pay}, ${items} item${items === 1 ? '' : 's'}, ${money(o.total)}`;
    return paid
      ? el('div', { class: 'ord-row', role: 'listitem', style: `--type:${type.color}`, 'aria-label': label }, ...cells)
      : el('button', { type: 'button', class: 'ord-row', role: 'listitem', style: `--type:${type.color}`, 'aria-label': `${label}. Open in Counter`, onclick: () => window.RestroCounter?.openOrder(o.number) }, ...cells);
  }

  // Rendered into its own root so the system bar and toasts placed in the dialog survive re-renders.
  const root = el('div', { class: 'ord-root' }); dialog.prepend(root);
  let scrollTop = 0;
  let fromCounter = false;                 // opened with Counter's Orders button: Back returns to Counter

  function render() {
    const orders = window.RestroCounter?.orders?.() || [];
    const head = el('div', { class: 'ord-head' },
      el('button', { type: 'button', class: 'ord-nav', 'aria-label': fromCounter ? 'Back to Counter' : 'Home', title: fromCounter ? 'Back' : 'Home',
        onclick: () => { if (!goBack()) document.querySelector('#system-home')?.click(); } }, svg(fromCounter ? ICON.back : ICON.home)),
      appIcon(),
      el('h2', { id: 'orders-title', tabindex: '-1' }, 'Orders'));
    // The column names stay at the top while the rows scroll under them.
    const grid = orders.length
      ? el('div', { class: 'ord-list', onscroll: e => { scrollTop = e.currentTarget.scrollTop; } },
        el('div', { class: 'ord-cols', 'aria-hidden': 'true' }, ...COLUMNS.map((name, i) => el('span', { class: `ord-c ${['ord-ticket', 'ord-when', 'ord-typecell', 'ord-name', 'ord-status', 'ord-pay', 'ord-server', 'ord-buzzer', 'ord-items', 'ord-total'][i]}` }, name))),
        el('div', { class: 'ord-rows', role: 'list', 'aria-label': 'Orders, newest first' }, ...orders.map(row)))
      : el('div', { class: 'ord-empty' }, el('strong', {}, 'No orders yet'), el('span', {}, 'Orders show here once they are saved or paid in Counter.'));
    root.replaceChildren(head, grid);
    if (orders.length) grid.scrollTop = scrollTop;
  }

  // While open, the tiles keep up with the kitchen (a scheduled order goes to the kitchen at its time).
  let timer = null;
  dialog.addEventListener('close', () => { clearInterval(timer); timer = null; fromCounter = false; });
  // Back: to Counter when Orders was opened from there; otherwise Orders closes (to the home screen).
  function goBack() {
    if (!dialog.open || !fromCounter || !window.RestroCounter) return false;
    fromCounter = false; window.RestroCounter.resume(); return true;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });

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
      clearInterval(timer); timer = setInterval(() => { if (dialog.open) render(); }, 30000);
      dialog.querySelector('#orders-title')?.focus({ preventScroll: true });
    },
    goBack
  });
})();
