'use strict';
// Home screen widgets, beside the apps, live from this tablet's data (orders saved here or synced from the others):
// - Today's sales: the total paid today, against the same time on the same day last week, by the hour, with the
//   orders paid, the average ticket and the cash taken. Opens Analytics.
// - Orders: how many are open and ready, the latest three open ones with where they are. An order opens in Counter.
// - Floor: the tables, the ones in use highlighted. A table opens its order (or a new one) in Counter.
// - Pager Hub: the pagers out with customers, longest wait first. A pager buzzes.
// Everything follows the data: on any change from another tablet, when an app closes, and every 30 seconds (the waits).
// Home-screen badges (Update Pack 5, J), at the end: Orders' counts each order showing KOT ! and each Pending QR payment.
(() => {
  const panel = document.querySelector('#home-widgets');
  if (!panel) return;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const rupees = paise => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  const ticket = n => `#${String(n).padStart(2, '0')}`;
  const dayKey = when => { const d = new Date(when); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const paidTime = o => Date.parse(o.paidAt) || 0;
  const minutes = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const TYPES = { 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', phone: 'Phone call' };
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); else { const t = document.querySelector('#toast'); if (t) { t.textContent = message; t.classList.add('visible'); setTimeout(() => t.classList.remove('visible'), 2400); } } };
  const shortcutOf = id => (typeof shortcuts !== 'undefined' ? shortcuts.find(item => item.id === id) : null);
  const icon = id => { const item = shortcutOf(id); return item && typeof appIcon === 'function' ? appIcon(item) : el('span', { class: 'app-icon' }); };

  // A widget: its app's icon, name and a line on how things stand (the whole head opens the app), then its body
  function card(cls, id, name, line, open, ...body) {
    const head = el('button', { type: 'button', class: 'hw-head', 'aria-label': `${name}: ${line}. Open ${name}`, onclick: open }, id ? icon(id) : null,
      el('span', { class: 'hw-titles' }, el('span', { class: 'hw-title' }, name), el('span', { class: 'hw-line' }, line)));
    return el('section', { class: `hw-card ${cls}`, 'aria-label': name }, head, ...body);
  }

  function salesCard(orders, now) {
    const today = dayKey(now), paid = orders.filter(o => o.paidAt && dayKey(paidTime(o)) === today);
    const total = paid.reduce((n, o) => n + (o.total || 0), 0), cash = paid.filter(o => (o.method || 'cash') === 'cash').reduce((n, o) => n + (o.total || 0), 0);
    // Against the same time on the same day last week, when there were sales then
    const weekAgo = now - 7 * 864e5, lastKey = dayKey(weekAgo);
    const last = orders.filter(o => o.paidAt && dayKey(paidTime(o)) === lastKey && paidTime(o) <= weekAgo).reduce((n, o) => n + (o.total || 0), 0);
    const weekday = new Date(weekAgo).toLocaleDateString('en-IN', { weekday: 'long' });
    const change = last ? Math.round(((total - last) / last) * 100) : null;
    // By the hour: the last seven hours, this hour (in the accent) and the next two
    const hour = new Date(now).getHours(), hours = Array.from({ length: 10 }, (_, i) => hour - 7 + i);
    const byHour = hours.map(h => h > hour ? null : paid.filter(o => new Date(paidTime(o)).getHours() === h && dayKey(paidTime(o)) === today).reduce((n, o) => n + (o.total || 0), 0));
    const top = Math.max(1, ...byHour.filter(v => v != null));
    const bars = el('div', { class: 'hw-bars', 'aria-hidden': 'true' }, ...byHour.map((v, i) => el('span', {
      class: `hw-bar${v == null ? ' later' : hours[i] === hour ? ' now' : ''}`, style: `height:${v == null ? 8 : Math.max(6, Math.round((v / top) * 100))}%` })));
    const stat = (label, value) => el('div', { class: 'hw-stat' }, el('span', {}, label), el('strong', {}, value));
    const open = () => { if (typeof openApp === 'function') openApp('analytics'); };
    return el('section', { class: 'hw-card hw-sales', 'aria-label': "Today's sales" },
      el('button', { type: 'button', class: 'hw-sales-head', 'aria-label': `Today's sales ${rupees(total)}. Open Analytics`, onclick: open },
        el('span', { class: 'hw-title' }, "Today's sales"),
        el('span', { class: 'hw-sales-row' },
          el('span', { class: 'hw-sales-figures' }, el('strong', { class: 'hw-total' }, rupees(total)),
            change != null ? el('span', { class: 'hw-line' }, `${change >= 0 ? '+' : '−'}${Math.abs(change)}% vs. last ${weekday}`) : el('span', { class: 'hw-line' }, paid.length ? 'Paid today' : 'No sales yet today')),
          bars)),
      el('div', { class: 'hw-stats' }, stat('Orders', String(paid.length)), stat('Avg. ticket', paid.length ? rupees(total / paid.length) : '₹0'), stat('Cash', rupees(cash))));
  }

  function ordersCard(orders, now) {
    const statusOf = o => window.RestroOrders?.status?.(o) || { text: o.paidAt ? 'Closed' : 'Open' };
    const open = orders.filter(o => statusOf(o).text === 'Open').sort((a, b) => b.createdAt - a.createdAt);
    const ready = open.filter(o => statusOf(o).sub === 'Ready').length;
    const line = open.length ? `${open.length} open${ready ? ` · ${ready} ready to serve` : ''}` : 'No open orders';
    const where = o => o.table ? `Table ${window.RestroFloor?.tableName(o.table) || o.table}` : o.customer?.name || TYPES[o.type] || 'Order';
    // (Update Pack 5, H1, OR0: a QR order whose payment is Pending, its chip in Due's orange; tapped, its Customer paid? pop-up in Orders)
    const chip = s => (s.sub === 'Ready' ? 'ready' : s.sub === 'In kitchen' ? 'kitchen' : s.sub === 'Pending' ? 'pending' : String(s.sub || '').startsWith('Scheduled') ? 'scheduled' : 'open');
    const rows = open.slice(0, 3).map(o => {
      const s = statusOf(o), label = s.sub || 'Open';
      const go = () => (s.sub === 'Pending' ? window.RestroOrders?.open({ confirm: o.uid || `n${o.number}` }) : o.paidAt ? window.RestroOrders?.open() : window.RestroCounter?.openOrder(o.uid || o.number));
      return el('button', { type: 'button', class: 'hw-order', 'aria-label': `Order ${ticket(o.number)}, ${where(o)}, ${minutes(now - o.createdAt)}, ${label}`, onclick: go },
        el('strong', {}, ticket(o.number)), el('span', { class: 'hw-where' }, `${where(o)} · ${minutes(now - o.createdAt)}`), el('span', { class: `hw-chip ${chip(s)}` }, label.replace(/^Scheduled /, '')));
    });
    return card('hw-orders', 'orders', 'Orders', line, () => window.RestroOrders?.open(),
      el('div', { class: 'hw-list' }, ...rows));
  }

  function floorCard() {
    const tables = window.RestroFloor?.tables || [], used = new Set(window.RestroCounter?.tablesInUse?.() || []);
    const busy = tables.filter(t => used.has(t.id)).length;
    const grid = el('div', { class: 'hw-tables' }, ...tables.slice(0, 20).map(t => el('button', {
      type: 'button', class: `hw-table${used.has(t.id) ? ' busy' : ''}`, 'aria-label': `Table ${t.name}${used.has(t.id) ? ', in use' : ', free'}`, onclick: () => window.RestroCounter?.openTable(t.id) }, t.name)));
    return card('hw-floor', 'floor', 'Floor', `${busy} of ${tables.length} occupied`, () => window.RestroFloor?.open(), grid);
  }

  function pagersCard(orders, now) {
    // (one tile a pager: shared by a customer's orders, the newest one's wait)
    const since = o => o.pagerAt || o.createdAt, newest = new Map();
    for (const o of orders) if (o.pagerOut && o.pager && (!newest.has(o.pager) || since(o) > since(newest.get(o.pager)))) newest.set(o.pager, o);
    const out = [...newest.values()].sort((a, b) => since(a) - since(b));
    const buzz = n => {
      const pager = window.RESTRODevice?.pager;
      if (typeof pager?.buzz !== 'function') { toast('Pagers start with the RESTRO Android app'); return; }
      Promise.resolve(pager.buzz(n)).then(ok => toast(ok === false ? `Pager ${n} didn’t buzz` : `Pager ${n} buzzed`), () => toast(`Pager ${n} didn’t buzz`));
    };
    const tiles = out.slice(0, 4).map(o => el('button', { type: 'button', class: 'hw-pager', 'aria-label': `Pager ${o.pager}, waiting ${minutes(now - (o.pagerAt || o.createdAt))}. Buzz it`, onclick: () => buzz(o.pager) },
      el('strong', {}, String(o.pager).padStart(2, '0')), el('span', {}, minutes(now - (o.pagerAt || o.createdAt)))));
    return card('hw-pagers', 'pager-hub', 'Pager Hub', out.length ? `${out.length} waiting` : 'No pagers out', () => window.RestroPagerHub?.open(),
      tiles.length ? el('div', { class: 'hw-pager-grid' }, ...tiles) : null);
  }

  function render() {
    const now = Date.now(), orders = window.RestroCounter?.orders?.() || [];
    panel.replaceChildren(salesCard(orders, now), ordersCard(orders, now), el('div', { class: 'hw-pair' }, floorCard(), pagersCard(orders, now)));
    paintBadges();
  }

  // ---------- home-screen badges (Update Pack 5, J) ----------
  // A 40 amber circle (home units) with its white bold number at an app's icon, top right, and a 6 gap round it cut
  // through the icon to the home background (launcher.css). Orders: each order showing KOT ! and each Pending QR payment
  // (RestroOrders.attention). Each item clears by itself once fixed. QR Studio's comes with QR Studio; other apps have
  // none until the owner defines them. In the dock and on the pages alike, wherever the app is.
  const counts = () => ({ orders: window.RestroOrders?.attention?.() || 0 });
  function paintBadges() {
    const n = counts();
    for (const host of document.querySelectorAll('#home :is(.shortcut[data-app],.app-tile[data-id])')) {
      const id = host.dataset.app || host.dataset.id, count = n[id] || 0, text = count > 99 ? '99+' : String(count);
      let badge = host.querySelector(':scope > .app-badge');
      if (host.classList.contains('has-badge') !== count > 0) host.classList.toggle('has-badge', count > 0);
      if (!count) { badge?.remove(); continue; }
      if (!badge) { badge = el('span', { class: 'app-badge', 'aria-hidden': 'true' }); host.append(badge); }
      if (badge.textContent !== text) badge.textContent = text;
    }
  }
  // (the dock and the pages are drawn again when apps move: the badges go back on)
  const homeApps = document.querySelector('#home .workspace');
  if (homeApps) new MutationObserver(paintBadges).observe(homeApps, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', render);
  window.addEventListener('restro:data-changed', render);
  window.addEventListener('restro:pager-docked', render);
  // An app closing (back to the home screen) may have changed orders, tables or pagers
  document.addEventListener('close', event => { if (event.target instanceof HTMLDialogElement) render(); }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) render(); }, 30000);

  // The insights the home screen used to show open from Recents as before
  window.RestroInsights = Object.freeze({
    openDetail(id) {
      const routes = { 'last-order': 'order-details-dialog', 'most-sold': 'most-sold-dialog', 'daily-sales': 'analytics-dialog' };
      if (!routes[id] || typeof openDialog !== 'function') return false;
      openDialog(routes[id]); return true;
    }
  });
})();
