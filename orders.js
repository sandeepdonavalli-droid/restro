'use strict';
// Orders (Update Pack 3, 01_Orders): where staff find any order of the day and act on it without opening it — print the
// bill or receipt, resend the KOT, notify the customer, buzz the pager. Tapping an order opens it where it is worked on
// next: in Counter while it isn't paid (Back comes back here, filters kept), its receipt once it is, a held order carries
// on in Counter.
// - Top: Home (or "‹ Counter" when opened from there), the title, one search box (customer, phone, order #, table,
//   server, dish), the summary pill (Orders · Total · Due, following the tab, filters and day: "Due ₹12,430 · 7 orders"
//   is the Not paid tab) and the day (Today; an earlier day shows that day's orders).
// - Tabs All · Open · Not paid · Closed · Held with their counts (All = Open + Closed + Held), the dropdowns Discounts &
//   voids · order types · staff, and Clear filters while a filter or the search is on. Filters reset when the app is
//   left, the tablet locks or another person signs in; opening an order and coming back keeps them.
// - One row per order (96 tall): date & time, order type, customer / table · server, order status, payment status, and
//   four buttons: Bill / Receipt (with the bill printer's paper level), KOT, Notify (Ready → Marked for delivery apps),
//   Buzz. Headings sort (tap again to reverse; newest first by default). Colour only for exceptions.
// - Long-press starts picking orders to delete: only orders not paid yet, with a reason.
// Row style (Settings › Orders, to come): Classic rows (one white panel) or Floating pills. Delivery apps (Swiggy,
// Zomato…) show the fields their integration sends with the order: platform, platformNo, platformType ('delivery' or
// 'pickup'), pickupAt / readyBy, callCode, handover, riderAt, platformLogo.
(() => {
  const dialog = document.querySelector('#orders-dialog');
  if (!dialog) return;

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
  // Icons: the pack's own (Update Pack 3, 06_html-reference) and Material Symbols Rounded (Apache 2.0) for the rest;
  // m: on the 960 grid, w: on the 24 grid
  const ICON = {
    search: ['m', 'M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z'],
    calendar: ['m', 'M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.02 0 23.51 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.03 0 23.51 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Z'],
    expand: ['m', 'M480-362q-8 0-15-2.5t-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5Z'],
    expandLess: ['m', 'M480-529 324-373q-11 11-28 11t-28-11q-11-11-11-28t11-28l184-184q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l184 184q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-529Z'],
    tag: ['m', 'M856-390 570-104q-12 12-27 18t-30 6q-15 0-30-6t-27-18L103-457q-11-11-17-25.5T80-513v-287q0-33 23.5-56.5T160-880h287q16 0 31 6.5t26 17.5l352 353q12 12 17.5 27t5.5 30q0 15-5.5 29.5T856-390ZM260-640q25 0 42.5-17.5T320-700q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Z'],
    sortDown: ['m', 'M450-274v-496q0-13 8.5-21.5T480-800q13 0 21.5 8.5T510-770v496l227-227q9-9 21-9t21 9q9 9 9 21t-9 21L501-181q-5 5-10 7t-11 2q-6 0-11-2t-10-7L181-459q-9-9-9-21t9-21q9-9 21-9t21 9l227 227Z'],
    sortBoth: ['m', 'm480-208 114-114q9.13-9 22.07-9 12.93 0 21.93 9.1 9 9.11 9 22 0 12.9-9 21.9L501-141q-5 5-10.13 7-5.14 2-11 2-5.87 0-10.87-2-5-2-10-7L322-278q-9-9.13-9-22.07 0-12.93 9.1-21.93 9.11-9 22-9 12.9 0 21.9 9l114 114Zm0-540L366-634q-9.13 9-22.07 9-12.93 0-21.93-9.1-9-9.11-9-22 0-12.9 9-21.9l137-137q5-5 10.13-7 5.14-2 11-2 5.87 0 10.87 2 5 2 10 7l137 137q9 9.13 9 22.07 0 12.93-9.1 21.93-9.11 9-22 9-12.9 0-21.9-9L480-748Z'],
    phone: ['m', 'M798-120q-125 0-247-54.5T329-329Q229-429 174.5-551T120-798q0-18 12-30t30-12h162q14 0 25 9.5t13 22.5l26 140q2 16-1 27t-11 19l-97 98q20 37 47.5 71.5T387-386q31 31 65 57.5t72 48.5l94-94q9-9 23.5-13.5T670-390l138 28q14 4 23 14.5t9 23.5v162q0 18-12 30t-30 12Z'],
    dinein: ['m', 'M672-520H289l-11 80h404l-10-80ZM166-205l43-315h-89q-20 0-31.5-16T82-571l57-200q4-13 14-21t24-8h606q14 0 24 8t14 21l57 200q5 19-6.5 35T840-520h-88l42 315q2 18-9.5 31.5T755-160q-15 0-26.5-9.5T715-194l-22-166H267l-22 166q-2 15-13.5 24.5T205-160q-18 0-29.5-13.5T166-205Z'],
    takeaway: ['m', 'M240-80q-33 0-56.5-23.5T160-160v-480q0-33 23.5-56.5T240-720h80q0-66 47-113t113-47q66 0 113 47t47 113h80q33 0 56.5 23.5T800-640v480q0 33-23.5 56.5T720-80H240Zm160-640h160q0-33-23.5-56.5T480-800q-33 0-56.5 23.5T400-720Zm200 200q17 0 28.5-11.5T640-560v-80h-80v80q0 17 11.5 28.5T600-520Zm-240 0q17 0 28.5-11.5T400-560v-80h-80v80q0 17 11.5 28.5T360-520Z'],
    moped: ['m', 'M280-200q-50 0-85-35t-35-85h-40q-17 0-28.5-11.5T80-360v-80q0-66 47-113t113-47h80q33 0 56.5 23.5T400-520v120h140l140-174v-106h-80q-17 0-28.5-11.5T560-720q0-17 11.5-28.5T600-760h80q33 0 56.5 23.5T760-680v106q0 14-4.5 26.5T743-524L604-350q-11 14-28 22t-35 8H400q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T320-320h-80q0 17 11.5 28.5T280-280Zm80-360H240q-17 0-28.5-11.5T200-680q0-17 11.5-28.5T240-720h120q17 0 28.5 11.5T400-680q0 17-11.5 28.5T360-640Zm400 440q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T800-320q0-17-11.5-28.5T760-360q-17 0-28.5 11.5T720-320q0 17 11.5 28.5T760-280Z'],
    print: ['w', 'M19 8c1.66 0 3 1.34 3 3v6h-4v4H6v-4H2v-6c0-1.66 1.34-3 3-3h1V3h12v5zM8 5v3h8V5zm8 14v-4H8v4zm2-4h2v-4c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v4h2v-2h12zm1-3.5c0 .55-.45 1-1 1s-1-.45-1-1 .45-1 1-1 1 .45 1 1'],
    printOff: ['m', 'M763-84 640-206h80v6q0 33-23.5 56.5T640-120H320q-33 0-56.5-23.5T240-200v-80h-80q-33 0-56.5-23.5T80-360v-160q0-51 35-85.5t85-34.5h6L83-763q-12-12-12-28.5T83-820q12-12 28.5-12t28.5 12l680 680q12 12 12 28t-12 28q-12 12-28.5 12T763-84ZM320-200h320v-6L486-360H320v160Zm522-91q-16 9-34 8t-32-15L502-572q-19-19-8.5-43.5T531-640h229q50 0 85 35t35 85v160q0 25-11 42.5T842-291ZM427-680q-16 0-30.5-6T371-703l-69-69q-19-19-8.5-43.5T331-840h309q33 0 56.5 23.5T720-760v40q0 17-11.5 28.5T680-680H427Zm293 220q17 0 28.5-11.5T760-500q0-17-11.5-28.5T720-540q-17 0-28.5 11.5T680-500q0 17 11.5 28.5T720-460Z'],
    kot: ['w', 'M19.5 3.5 18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2zM19 19H5V5h14zM6 15h12v2H6m0-6h12v2H6m0-6h12v2H6z'],
    notify: ['w', 'm4 6.03 7.5 3.22-7.5-1zm7.5 8.72L4 17.97v-2.22zM2 3v7l15 2-15 2v7l21-9z'],
    ready: ['w', 'M.41 13.41 6 19l1.41-1.42L1.83 12m20.41-6.42L11.66 16.17 7.5 12l-1.43 1.41L11.66 19l12-12M18 7l-1.41-1.42-6.35 6.35 1.42 1.41z'],
    marked: ['w', 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z'],
    void: ['w', 'M12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m2.59 6L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41z'],
    edit: ['m', 'M160-120q-17 0-28.5-11.5T120-160v-97q0-16 6-30.5t17-25.5l505-504q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L313-143q-11 11-25.5 17t-30.5 6h-97Zm544-528 56-56-56-56-56 56 56 56Z'],
    receipt: ['m', 'M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480Z'],
    filterOff: ['m', 'm592-481-57-57 143-182H353l-80-80h487q25 0 36 22t-4 42L592-481Zm-32 194v87q0 17-11.5 28.5T520-160h-80q-17 0-28.5-11.5T400-200v-247L84-763q-11-11-11-27.5T84-819q12-12 28.5-12t28.5 12l679 679q12 12 11.5 28T819-84q-12 11-28 11.5T763-84L560-287Zm-25-251Z'],
    check: ['m', 'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z'],
    close: ['m', 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z'],
    back: ['m', 'm432-480 156 156q11 11 11 28t-11 28q-11 11-28 11t-28-11L348-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l184-184q11-11 28-11t28 11q11 11 11 28t-11 28L432-480Z'],
    trash: ['m', 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z'],
    chat: ['m', 'm240-240-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Zm40-160h240q17 0 28.5-11.5T560-440q0-17-11.5-28.5T520-480H280q-17 0-28.5 11.5T240-440q0 17 11.5 28.5T280-400Zm0-120h400q17 0 28.5-11.5T720-560q0-17-11.5-28.5T680-600H280q-17 0-28.5 11.5T240-560q0 17 11.5 28.5T280-520Zm0-120h400q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720H280q-17 0-28.5 11.5T240-680q0 17 11.5 28.5T280-640Z'],
    sms: ['m', 'M320-520q17 0 28.5-11.5T360-560q0-17-11.5-28.5T320-600q-17 0-28.5 11.5T280-560q0 17 11.5 28.5T320-520Zm160 0q17 0 28.5-11.5T520-560q0-17-11.5-28.5T480-600q-17 0-28.5 11.5T440-560q0 17 11.5 28.5T480-520Zm160 0q17 0 28.5-11.5T680-560q0-17-11.5-28.5T640-600q-17 0-28.5 11.5T600-560q0 17 11.5 28.5T640-520ZM240-240l-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Z']
  };
  // Home: the Set C outline house (as on the navigation bar), stroke 2
  const HOUSE = 'M4.5 11.2 L12 4.6 L19.5 11.2 V18.4 a1.6 1.6 0 0 1 -1.6 1.6 H14.6 V15.4 a2.6 2.6 0 0 0 -5.2 0 V20 H6.1 a1.6 1.6 0 0 1 -1.6 -1.6 Z';
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls = '') {
    const [grid, d] = ICON[name], s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', grid === 'm' ? '0 -960 960 960' : '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `or-i ${cls}`.trim()); s.innerHTML = `<path d="${d}"/>`; return s;
  }
  function house() {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'or-house');
    s.innerHTML = `<path d="${HOUSE}"/>`; return s;
  }
  const appIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode({ ...shortcuts.find(item => item.id === 'orders').art, plain: true }) : document.createElement('span');
    art.classList.add('or-title-icon'); return art;
  };

  // ---------- words and numbers ----------
  const TYPES = { 'dine-in': ['Dine-in', 'dinein', '#9A6B1F'], takeaway: ['Takeaway', 'takeaway', '#2E7D4F'], phone: ['Phone call', 'phone', '#2F5FB3'], delivery: ['Delivery', 'moped', '#6D4BC4'] };
  // Delivery apps: the partner's own logo comes with the integration (platformLogo); until then a plain letter tile
  const PLATFORMS = { swiggy: ['Swiggy', '#E8711F'], zomato: ['Zomato', '#C8303B'] };
  const PAID_BY = { cash: 'Cash', upi: 'UPI', card: 'Card', swiggy: 'Swiggy', zomato: 'Zomato' };
  const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rupees = paise => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  const ticket = n => `#${String(n).padStart(2, '0')}`;
  const timeOf = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, (m, x) => ` ${x.toLowerCase()}m`);
  const clockOf = t => timeOf(t).replace(/ ([ap])m$/, (m, x) => ` ${x.toUpperCase()}M`);
  const dateOf = t => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const minutes = ms => Math.max(0, Math.floor(ms / 60000));
  const initialsOf = name => (typeof name === 'string' && name.trim() ? name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => Array.from(w)[0]).join('').toUpperCase() : '');
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  // "+91 98480 22321"; other lengths as typed
  const phoneOf = c => {
    const m = typeof c?.mobile === 'string' ? c.mobile.replace(/\s+/g, '') : ''; if (!m) return '';
    return `+${c.code || '91'} ${/^\d{10}$/.test(m) ? `${m.slice(0, 5)} ${m.slice(5)}` : m}`;
  };
  const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const todayKey = () => window.RestroSync?.today?.() || localDay(Date.now());
  const dayOfOrder = o => window.RestroSync?.orderDay?.(o) || o.day || localDay(o.createdAt || Date.now());
  const shopName = () => { const n = (localStorage.getItem('restro.restaurantName') || '').trim(); return n && n !== 'RESTAURANT NAME' ? n : ''; };
  const prepMinutes = type => window.RestroCounter?.prepMinutes?.(type) || 30;
  const toast = message => say({ text: message });

  // ---------- an order as a row shows it ----------
  // The order status: Open until it is paid and complete in the kitchen (the kitchen screen marks the order
  // kitchenDoneAt), in either order, and its pager is docked back when it had one (owner, 10 Nov: a pager handed to a
  // newer order counts as back); then Closed. Under Open: Scheduled 8:30 PM (plum) while a scheduled order waits for
  // its kitchen time, even when paid; In kitchen · N min once its KOT went (from the KOT that took it into the kitchen),
  // orange with Open after the kitchen prep time; Ready · N min (green) once the kitchen completed it, until its pager is
  // docked when paid. Without the kitchen screen (a later subscription choice) an order is Open until paid (and its
  // pager docked), then Closed.
  const KITCHEN_SCREEN = true;
  function statusOf(o, now = Date.now()) {
    const waiting = !o.sentAt && Boolean(o.readyAt), screen = KITCHEN_SCREEN && Boolean(o.sentAt), ready = screen && Boolean(o.kitchenDoneAt);
    if (o.paidAt && !waiting && (!screen || ready) && !o.pagerOut) return { text: 'Closed', cls: 'closed', rank: 1 };
    if (waiting) return { text: 'Open', cls: 'open', sub: `Scheduled ${clockOf(o.readyAt)}`, base: `Scheduled ${clockOf(o.readyAt)}`, subCls: 'sch', rank: 0 };
    if (ready) return { text: 'Open', cls: 'open', sub: `Ready · ${minutes(now - o.kitchenDoneAt)} min`, base: 'Ready', subCls: 'rd', rank: 0 };
    if (screen) {
      const n = minutes(now - (Number(o.kitchenAt) || Number(o.sentAt))), late = n > prepMinutes(o.type);
      return { text: 'Open', cls: `open${late ? ' late' : ''}`, sub: `In kitchen · ${n} min`, base: 'In kitchen', subCls: late ? 'late' : '', late, rank: 0 };
    }
    return { text: 'Open', cls: 'open', rank: 0 };
  }
  // Notify works whenever the order has the customer's phone number, until 1 hour 15 minutes after the order is done on
  // every side (Closed, and its pager docked back when it had one)
  const NOTIFY_FOR = 75 * 60000;
  function doneAt(o, status) {
    if (status.cls !== 'closed' || o.pagerOut) return 0;
    return Math.max(Date.parse(o.paidAt) || 0, Number(o.kitchenDoneAt) || 0, o.pager ? Number(o.pagerBackAt) || 0 : 0);
  }
  // What the kitchen doesn't have yet (the KOT button's "KOT 3"): each dish less what went (sent)
  const kitchenKey = (o, l) => `${l.id}@${l.type || o.type}${Array.isArray(l.mods) && l.mods.length ? `#${l.mods.map(m => (typeof m === 'string' ? m : m?.id)).join('+')}` : ''}`;
  function unsentOf(o) {
    const groups = new Map();
    for (const l of o.lines || []) { const k = kitchenKey(o, l); groups.set(k, (groups.get(k) || 0) + (Number(l.qty) || 0)); }
    let n = 0; for (const [k, q] of groups) n += Math.max(0, q - (Number(o.sent?.[k]) || 0)); return n;
  }
  const kotsOf = o => (Array.isArray(o.kots) ? o.kots : []).filter(k => k && (k.kind || 'kot') === 'kot');

  function infoOf(o, held, now) {
    const id = held ? `h:${o.heldId}` : o.uid || `n${o.number}`, when = held ? o.savedAt : o.createdAt;
    const platform = !held && PLATFORMS[o.platform] ? o.platform : null;
    // the type: its icon (in its colour) and name, or the delivery app's logo, "Swiggy · Delivery" and its time
    let type;
    if (platform) {
      const [name, colour] = PLATFORMS[platform], pickup = o.platformType === 'pickup';
      const at = pickup ? o.readyBy : o.pickupAt;
      type = { key: platform, label: `${name} · ${pickup ? 'Pickup' : 'Delivery'}`, platform, colour, logo: typeof o.platformLogo === 'string' ? o.platformLogo : '', time: at ? `${pickup ? 'Ready by' : 'Pickup'} ${timeOf(at)}` : '' };
    } else {
      const keys = o.split ? [...new Set((o.lines || []).map(l => l.type || o.type))].filter(k => TYPES[k]) : [o.type].filter(k => TYPES[k]);
      const first = TYPES[keys[0]] || TYPES['dine-in'];
      type = { key: keys[0] || 'dine-in', keys: keys.length ? keys : ['dine-in'], label: keys.length ? keys.map(k => TYPES[k][0]).join(' + ') : first[0], icon: first[1], colour: first[2] };
    }
    const numbers = held && !o.number ? 'Held order' : platform ? `${PLATFORMS[platform][0]} #${o.platformNo || '—'} · Order ${ticket(o.number)}` : `Order ${ticket(o.number)}`;
    // who: the table (dine-in) with the guests and the server, or the customer with their phone and who took it
    const phone = phoneOf(o.customer), name = o.customer?.name || '', server = o.server || '';
    const dine = !platform && o.table && (o.type === 'dine-in' || o.split);
    const who = dine
      ? { l1: `Table ${tableName(o.table)}${o.guests ? ` · ${o.guests} guest${o.guests === 1 ? '' : 's'}` : ''}`, l2: server ? `Server: ${server}` : '' }
      : { l1: name || (platform ? 'Customer' : 'Guest'), l2: platform ? phone : [phone, phone ? initialsOf(server) : server ? `Server: ${server}` : ''].filter(Boolean).join(' · ') };
    if (platform && (o.callCode || o.handover || (o.platformType !== 'pickup' && o.riderAt))) who.codes = { call: o.callCode || '', handover: o.handover || '', rider: o.platformType !== 'pickup' && o.riderAt ? timeOf(o.riderAt) : '' };
    const status = held ? { text: 'Held', cls: 'held', rank: 2 } : statusOf(o, now);
    // the payment: Not paid / Partially paid (orange), Paid · how (black), Refunded · how (red), Held (grey)
    const paid = !held && Boolean(o.paidAt), refunded = !held && Boolean(o.refundedAt);
    const partial = !held && !paid && Number.isFinite(o.paidAmount) && o.paidAmount > 0 && o.paidAmount < o.total;
    const how = PAID_BY[o.method] || 'Cash';
    const pay = held ? { text: 'Held', cls: 'held', rank: 4 } : refunded ? { text: `Refunded · ${how}`, cls: 'rf', rank: 3 } : paid ? { text: `Paid · ${how}`, cls: 'paid', rank: 2 }
      : partial ? { text: 'Partially paid', cls: 'np', rank: 1 } : { text: 'Not paid', cls: 'np', rank: 0 };
    const kots = held ? [] : kotsOf(o);
    const tags = held ? { disc: false, void: false } : {
      disc: Boolean(o.discountPct) || (o.lines || []).some(l => Number(l.off) > 0),
      void: (Array.isArray(o.kots) ? o.kots : []).some(k => k && (k.kind === 'void' || k.kind === 'changed'))
    };
    const since = held ? 0 : doneAt(o, status), longDone = since > 0 && now - since > NOTIFY_FOR;
    const notifyOn = !held && !longDone && Boolean(phone);
    const waiting = !held && !o.sentAt && Boolean(o.readyAt);
    const unsent = held || waiting ? 0 : unsentOf(o);
    const kot = held ? { look: 'off' } : unsent > 0 ? { look: 'solid', n: unsent } : kots.some(k => k.failed) ? { look: 'err' } : { look: kots.length || waiting ? 'on' : 'off' };
    const third = platform ? { kind: o.platformReadyAt ? 'marked' : 'ready', on: !held } : { kind: 'notify', on: notifyOn };
    const buzz = { no: !held && o.pager ? String(o.pager) : '', on: !held && Boolean(o.pager) && Boolean(o.pagerOut) };
    // can it be deleted (long-press): only orders not paid yet; never a delivery app's (cancelled on the app) or a held one
    const lock = held ? 'Held' : platform ? `${PLATFORMS[platform][0]} · cancel on ${PLATFORMS[platform][0]}` : paid ? 'Paid' : '';
    const hay = [name, o.customer?.mobile || '', phone, o.number != null ? `#${o.number} ${ticket(o.number)} ${o.number}` : '', dine ? `table ${tableName(o.table)}` : '', server,
      ...(o.lines || []).map(l => l.name || ''), o.platformNo || '', type.label].join(' | ').toLowerCase();
    return { o, id, held, when, type, numbers, who, status, pay, tags, kot, third, buzz, lock, hay, phone, name, server, unpaid: !held && !paid && !refunded,
      day: held ? todayKey() : dayOfOrder(o) };
  }

  // ---------- state ----------
  let fromCounter = false;
  let tab = 'all';                       // all · open · unpaid · closed · held
  let query = '';
  let dv = 'all';                        // Discounts & voids: all · disc · void · both
  let typeF = 'all';                     // all, or an order type / delivery app
  let staffF = 'all';                    // all, or a server's name
  let sort = { key: 'when', dir: -1 };   // newest first
  let day = null;                        // null: today
  let menu = null;                       // the dropdown open: dv · type · staff · day
  let picking = null;                    // picking orders to delete: a Set of ids
  let pop = null;                        // a pop-up: { kind, id, … }
  let flash = new Map();                 // id → 'buzzed' (the Buzz button's 2 s "Buzzed")
  let returning = false;                 // an order was opened from here: coming back keeps the filters
  let scrollTop = 0, scrolledAt = 0;
  const filtering = () => Boolean(query.trim()) || dv !== 'all' || typeF !== 'all' || staffF !== 'all';
  function resetFilters() { tab = 'all'; query = ''; dv = 'all'; typeF = 'all'; staffF = 'all'; sort = { key: 'when', dir: -1 }; day = null; menu = null; picking = null; pop = null; scrollTop = 0; }
  // The view and the row style (Settings › Orders › Order list view, Row style; to come): Classic and Classic rows until then
  // (Settings › Orders; Update Pack 3: this tablet's own or every tablet's, prefs.js; lookOverride: a preview's)
  let lookOverride = null, sampleRows = null;
  const look = () => { if (lookOverride) return lookOverride; try { return window.RestroPrefs?.get?.('orders') || {}; } catch { return {}; } };
  const rowStyle = () => (look().rows === 'pills' ? 'pills' : 'classic');
  const viewKind = () => (['split', 'cards', 'board'].includes(look().view) ? look().view : 'classic');
  let chosen = null;                     // Split detail: the order shown on the right
  let closedOpen = false;                // Board: the Closed strip unfolded

  // The day's orders as rows (and the held ones, today), and what the filters and search leave
  function rowsNow() {
    if (sampleRows) return sampleRows;
    const now = Date.now(), d = day || todayKey(), today = d === todayKey();
    const orders = (window.RestroCounter?.orders?.() || []).map(o => infoOf(o, false, now)).filter(r => r.day === d);
    const held = today ? (window.RestroCounter?.held?.() || []).map(o => infoOf(o, true, now)) : [];
    return [...orders, ...held];
  }
  const qOf = () => query.trim().toLowerCase();
  function matches(r) {
    const q = qOf();
    if (q) { const digits = q.replace(/[\s+]/g, ''); if (!r.hay.includes(q) && !(/^\d{3,}$/.test(digits) && r.hay.replace(/\s+/g, '').includes(digits))) return false; }
    if (dv === 'disc' && !r.tags.disc) return false;
    if (dv === 'void' && !r.tags.void) return false;
    if (dv === 'both' && !(r.tags.disc && r.tags.void)) return false;
    if (typeF !== 'all' && !(r.type.platform ? r.type.platform === typeF : r.type.keys.includes(typeF))) return false;
    if (staffF !== 'all' && r.server !== staffF) return false;
    return true;
  }
  const inTab = (r, t) => t === 'all' ? true : t === 'held' ? r.held : t === 'open' ? r.status.text === 'Open' : t === 'closed' ? r.status.text === 'Closed' : r.unpaid;
  const SORTS = {
    when: (a, b) => a.when - b.when,
    type: (a, b) => a.type.label.localeCompare(b.type.label) || b.when - a.when,
    status: (a, b) => a.status.rank - b.status.rank || Number(Boolean(b.status.late)) - Number(Boolean(a.status.late)) || b.when - a.when,
    pay: (a, b) => a.pay.rank - b.pay.rank || b.when - a.when
  };
  function view() {
    const all = rowsNow(), base = all.filter(matches);
    const counts = Object.fromEntries(['all', 'open', 'unpaid', 'closed', 'held'].map(t => [t, base.filter(r => inTab(r, t)).length]));
    const shown = base.filter(r => inTab(r, tab)).sort((a, b) => sort.dir * SORTS[sort.key](a, b));
    return { all, base, counts, shown };
  }

  // ---------- search highlight ----------
  function hl(text) {
    const q = qOf(), s = String(text ?? '');
    if (!q || !s) return s;
    const out = [], low = s.toLowerCase(); let at = 0, i;
    while ((i = low.indexOf(q, at)) !== -1) { if (i > at) out.push(s.slice(at, i)); out.push(el('mark', {}, s.slice(i, i + q.length))); at = i + q.length; }
    if (at < s.length) out.push(s.slice(at));
    return out;
  }

  // ---------- the paper in the bill printer (the Bill / Receipt button) ----------
  let paper = { level: 100, state: 'ok' };
  function setPaper(p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return; } }
    if (!p || typeof p !== 'object') return;
    const level = Number(p.level), state = ['ok', 'low', 'out', 'offline'].includes(p.state) ? p.state : 'ok';
    paper = { level: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100, state };
    if (dialog.open) dialog.querySelectorAll('.or-b.pr').forEach(b => paintPaper(b));
  }
  const paperLook = () => (paper.state === 'offline' ? 'off' : paper.state === 'out' ? 'out' : paper.state === 'low' || paper.level <= 20 ? 'low' : 'ok');
  function paintPaper(b) {
    const look = paperLook();
    b.classList.toggle('low', look === 'low'); b.classList.toggle('out', look === 'out'); b.classList.toggle('poff', look === 'off');
    b.style.setProperty('--used', `${100 - paper.level}%`);
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
  // The bill printer's cover was opened and closed: was a new roll fitted? (OR-P08; confirming resets the level on every
  // tablet through the RESTRO Android app)
  window.addEventListener('restro:printer-cover', e => {
    if (!dialog.open) return;
    const d = e.detail || {};
    pop = { kind: 'roll', printer: typeof d.printer === 'string' && d.printer ? d.printer : 'Bill printer', level: Number.isFinite(Number(d.level)) ? Math.round(Number(d.level)) : paper.level };
    renderLayer();
  });

  // ---------- messages: at the bottom, one at a time; a confirmation 2 s, an Undo 4 s, an error stays with Retry; the
  // timer waits while a finger is on it ----------
  let msg = null;
  const bar = el('div', { class: 'or-msg', role: 'status', 'aria-live': 'polite', hidden: true });
  function say(m) {
    if (typeof m === 'string') m = { text: m };
    if (msg?.timer) clearTimeout(msg.timer);
    msg = { ...m, ms: m.kind === 'error' ? 0 : m.undo ? 4000 : 2000 };
    paintMsg(); runMsg();
  }
  function runMsg() { if (!msg || !msg.ms || msg.held) return; clearTimeout(msg.timer); msg.timer = setTimeout(() => { msg = null; paintMsg(); }, msg.ms); }
  function paintMsg() {
    if (!msg) { bar.hidden = true; bar.replaceChildren(); return; }
    const act = msg.undo ? ['Undo', msg.undo] : msg.retry ? ['Retry', msg.retry] : null;
    bar.className = `or-msg${msg.kind === 'error' ? ' error' : ''}`;
    bar.replaceChildren(...[el('span', { class: 'or-msg-t' }, msg.bold ? el('b', {}, msg.bold) : null, msg.text || ''),
      act ? el('button', { type: 'button', onclick: () => { const run = act[1]; clearTimeout(msg?.timer); msg = null; paintMsg(); run(); } }, act[0]) : null].filter(Boolean));
    bar.hidden = false;
    if (bar.parentElement !== dialog) dialog.append(bar);
  }
  bar.addEventListener('pointerdown', () => { if (msg) { msg.held = true; clearTimeout(msg.timer); } });
  const letGo = () => { if (msg?.held) { msg.held = false; runMsg(); } };
  bar.addEventListener('pointerup', letGo); bar.addEventListener('pointercancel', letGo); bar.addEventListener('pointerleave', letGo);

  // ---------- the parts ----------
  const root = el('div', { class: 'or-root' }); dialog.prepend(root);
  let topEl = null, restEl = null, layerEl = null, listEl = null;

  function topBar(v) {
    const back = fromCounter;
    const home = back
      ? el('button', { type: 'button', class: 'or-home back', 'aria-label': 'Back to Counter', onclick: () => { if (!goBack()) document.querySelector('#system-home')?.click(); } }, icon('back'), 'Counter')
      : el('button', { type: 'button', class: 'or-home', 'aria-label': 'Home', title: 'Home', onclick: () => document.querySelector('#system-home')?.click() }, house());
    const input = el('input', { id: 'orders-search', type: 'search', class: 'or-search-in', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false', placeholder: 'Search customer, phone, order #, table or dish', 'aria-label': 'Search orders' });
    input.value = query;
    const clear = el('button', { type: 'button', class: 'or-search-x', 'aria-label': 'Clear the search', hidden: !query, onclick: () => { query = ''; input.value = ''; syncSearch(); input.focus(); } }, icon('close'));
    const box = el('label', { class: `or-search${query ? ' typed' : ''}` }, icon('search', 'or-search-i'), input, clear);
    function syncSearch() { box.classList.toggle('typed', Boolean(query)); clear.hidden = !query; scrollTop = 0; renderRest(); }
    input.addEventListener('input', () => { query = input.value; syncSearch(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const dayBtn = el('button', { type: 'button', class: `or-dd or-day${menu === 'day' ? ' open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'day'), onclick: e => toggleMenu('day', e.currentTarget) },
      icon('calendar'), dayLabel(day || todayKey()), icon(menu === 'day' ? 'expandLess' : 'expand'));
    return el('div', { class: 'or-top' }, home,
      el('div', { class: 'or-title' }, appIcon(), el('h2', { id: 'orders-title', tabindex: '-1' }, 'Orders')),
      box, summary(v), dayBtn);
  }
  // Orders 42 | Total ₹48,250 | Due ₹12,430 · 7 orders (the rows in view: the tab, filters and day)
  function summary(v) {
    const due = v.shown.filter(r => r.unpaid), total = v.shown.reduce((n, r) => n + (Number(r.o.total) || 0), 0), dueSum = due.reduce((n, r) => n + (Number(r.o.total) || 0), 0);
    return el('div', { class: 'or-sum', 'aria-label': `Orders ${v.shown.length}, total ${rupees(total)}, due ${rupees(dueSum)}, ${due.length} orders` },
      el('span', {}, 'Orders'), el('b', {}, String(v.shown.length)), el('i'),
      el('span', {}, 'Total'), el('b', {}, rupees(total)), el('i'),
      el('span', {}, 'Due'), el('b', { class: 'due' }, rupees(dueSum)), el('span', { class: 'dn' }, `· ${due.length} order${due.length === 1 ? '' : 's'}`));
  }
  function dayLabel(d) {
    if (d === todayKey()) return 'Today';
    const t = new Date(`${d}T12:00:00`), y = new Date(`${todayKey()}T12:00:00`); y.setDate(y.getDate() - 1);
    if (localDay(t) === localDay(y)) return 'Yesterday';
    return t.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  const TABS = [['all', 'All'], ['open', 'Open'], ['unpaid', 'Not paid'], ['closed', 'Closed'], ['held', 'Held']];
  const DV = [['all', 'All orders', 'receipt'], ['disc', 'Discounted', 'tag'], ['void', 'Voided after KOT', 'void'], ['both', 'Discounted and voided', 'ready']];
  function filterBar(v) {
    if (picking) return pickBar(v);
    const tabs = TABS.map(([key, label]) => el('button', { type: 'button', role: 'tab', class: `or-tab${tab === key ? ' on' : ''}`, 'aria-selected': String(tab === key),
      onclick: () => { tab = key; scrollTop = 0; dialog.dataset.view = fromCounter && tab === 'held' ? 'held' : 'orders'; renderRest(); } }, label, el('em', {}, String(v.counts[key]))));
    const dd = (key, label, on, lead) => el('button', { type: 'button', class: `or-dd${on ? ' on' : ''}${menu === key ? ' open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === key),
      onclick: e => toggleMenu(key, e.currentTarget) }, lead ? icon(lead) : null, label, icon(menu === key ? 'expandLess' : 'expand'));
    const typeName = typeF === 'all' ? 'All order types' : PLATFORMS[typeF] ? PLATFORMS[typeF][0] : TYPES[typeF]?.[0] || typeF;
    return el('div', { class: 'or-filters' },
      el('div', { class: 'or-tabs', role: 'tablist', 'aria-label': 'Orders' }, ...tabs),
      el('span', { class: 'or-sp' }),
      filtering() ? el('button', { type: 'button', class: 'or-clear', onclick: () => { query = ''; dv = 'all'; typeF = 'all'; staffF = 'all'; menu = null; scrollTop = 0; render(); } }, icon('filterOff'), 'Clear filters') : null,
      dd('dv', 'Discounts & voids', dv !== 'all', 'tag'),
      dd('type', typeName, typeF !== 'all'),
      dd('staff', staffF === 'all' ? 'All staff' : staffF, staffF !== 'all'));
  }
  // Picking orders to delete (long-press): "3 selected", Select all, why some can't be picked, Cancel, Delete 3 orders
  function pickBar(v) {
    const can = v.shown.filter(r => !r.lock), n = picking.size;
    return el('div', { class: 'or-filters picking' },
      el('span', { class: 'or-picked' }, `${n} selected`),
      el('button', { type: 'button', class: 'or-link', onclick: () => { can.forEach(r => picking.add(r.id)); renderRest(); } }, 'Select all'),
      el('span', { class: 'or-hint' }, 'Paid, Swiggy/Zomato and held orders can’t be deleted'),
      el('span', { class: 'or-sp' }),
      el('button', { type: 'button', class: 'or-cancel', onclick: () => { picking = null; renderRest(); } }, 'Cancel'),
      el('button', { type: 'button', class: 'or-del', disabled: !n, onclick: () => { if (n) { pop = { kind: 'delete', ids: [...picking], reason: '', typing: false }; renderLayer(); } } }, icon('trash'), n === 1 ? 'Delete 1 order' : `Delete ${n} orders`));
  }

  // The list: Classic rows (one white panel, thin lines between orders) or Floating pills (each order its own pill)
  const HEADS = [['when', 'Date & time'], ['type', 'Order type'], [null, 'Customer / table · server'], ['status', 'Order status'], ['pay', 'Payment status'], [null, '']];
  function list(v) {
    const head = el('div', { class: 'or-hd', role: 'row' }, picking ? el('span', { class: 'or-h' }) : null, ...HEADS.map(([key, label]) => {
      if (!key) return el('span', { class: 'or-h', role: 'columnheader' }, label);
      const on = sort.key === key;
      return el('button', { type: 'button', class: `or-h sort${on ? ' on' : ''}`, role: 'columnheader', 'aria-sort': on ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none',
        onclick: () => { sort = on ? { key, dir: -sort.dir } : { key, dir: key === 'when' ? -1 : 1 }; scrollTop = 0; renderRest(); } },
      label, icon(on ? 'sortDown' : 'sortBoth', on && sort.dir > 0 ? 'up' : ''));
    }));
    const rows = el('div', { class: 'or-rows', role: 'rowgroup' }, ...v.shown.map(rowEl));
    const empty = !v.shown.length ? emptyOf(v) : null;
    listEl = el('div', { class: 'or-scroll', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } }, rows, empty);
    return el('div', { class: `or-list ${rowStyle()}${picking ? ' picking' : ''}`, role: 'table', 'aria-label': 'Orders' }, head, listEl);
  }

  // The parts every view is made of (the same icons, labels, chips, colours, tags and buttons)
  function typeLine(r) {
    const t = r.type;
    return t.platform
      ? [t.logo ? el('img', { class: 'or-logo', src: t.logo, alt: '' }) : el('span', { class: 'or-logo', style: `background:${t.colour}`, 'aria-hidden': 'true' }, PLATFORMS[t.platform][0][0]), el('b', {}, hl(t.label)), t.time ? el('span', { class: 'pt' }, t.time) : null]
      : [el('span', { class: 'or-ti', style: `color:${t.colour}` }, icon(t.icon)), el('b', {}, hl(t.label))];
  }
  function codesLine(r) {
    if (!r.who.codes) return null;
    const c = r.who.codes, out = [];
    if (c.call) out.push('Call code', el('b', { class: 'chip y' }, c.call));
    if (c.handover) out.push(out.length ? '· Handover' : 'Handover', el('b', { class: 'chip g' }, c.handover));
    if (c.rider) out.push(`${out.length ? '· ' : ''}Rider arrival ${c.rider}`);
    return out;
  }
  const tagsOf = r => [r.tags.disc ? el('span', { class: 'or-mk', title: 'Discount', 'aria-label': 'Discount' }, icon('tag')) : null, r.tags.void ? el('span', { class: 'or-mk', title: 'Voided after KOT', 'aria-label': 'Voided after KOT' }, icon('void')) : null];
  const statusCellOf = r => el('div', { class: `or-c st ${r.status.cls}`, role: 'cell' }, el('div', { class: 'l1' }, el('b', {}, r.status.text)), el('div', { class: `l2 ${r.status.subCls || ''}`.trim() }, r.status.sub || ' '));
  const payCellOf = r => el('div', { class: `or-c pm ${r.pay.cls}`, role: 'cell' }, el('div', { class: 'l1' }, el('b', {}, r.pay.text)), el('div', { class: 'l2' }, el('span', {}, money(Number(r.o.total) || 0)), ...tagsOf(r)));
  const labelOf = r => `Order ${r.o.number != null ? ticket(r.o.number) : ''}, ${timeOf(r.when)}, ${r.type.label}, ${r.who.l1}, ${r.status.text}${r.status.sub ? ` ${r.status.sub}` : ''}, ${r.pay.text}, ${money(Number(r.o.total) || 0)}`;
  function tappable(r, cls, ...children) {
    const picked = picking?.has(r.id);
    return el('div', { class: `${cls}${picking ? r.lock ? ' locked' : picked ? ' picked' : '' : ''}`, role: 'row', tabindex: '0', 'data-id': r.id, 'aria-label': labelOf(r),
      onclick: e => { if (e.target.closest('.or-bt,.or-oc')) return; if (suppressTap) { suppressTap = false; return; } tapRow(r); },
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); tapRow(r); } } }, ...children);
  }
  // A row: date & time · order type · customer / table · server · order status · payment status · four buttons
  function rowEl(r) {
    const two = (cls, l1, l2, l3) => el('div', { class: `or-c ${cls}`, role: 'cell' }, el('div', { class: 'l1' }, ...[l1].flat()), l2 != null ? el('div', { class: 'l2' }, ...[l2].flat()) : null, l3 ? el('div', { class: 'l2' }, ...[l3].flat()) : null);
    const picked = picking?.has(r.id);
    return tappable(r, 'or-r',
      picking ? el('span', { class: `or-cb${picked ? ' on' : ''}`, 'aria-hidden': 'true' }, picked ? icon('check') : null) : null,
      two('tm', el('b', {}, timeOf(r.when)), dateOf(r.when)),
      two('ty', typeLine(r), hl(r.numbers)),
      two('cu', el('b', {}, hl(r.who.l1)), r.who.l2 ? hl(r.who.l2) : null, codesLine(r)),
      statusCellOf(r), payCellOf(r),
      picking ? el('div', { class: 'or-c lock', role: 'cell' }, r.lock ? el('span', { class: 'or-lock' }, r.lock) : null) : buttons(r));
  }
  // Split detail (OR02, OR03): the list on the left (660), each order its type and payment status, its number, time,
  // customer or table and amount with its tags, its order status, and the codes for a delivery app; the order picked on
  // the right: its header, order status and payment status, the delivery app's Call code / Handover / Pickup or Ready by
  // / Rider arrival, the dishes, the totals worked out from them (the GST line as on the Counter), the four buttons and
  // Open in Counter (clear of the lock's corner).
  function splitView(v) {
    if (!v.shown.some(r => r.id === chosen)) chosen = v.shown[0]?.id || null;
    const item = r => {
      const picked = picking?.has(r.id);
      return tappable(r, `or-li${r.id === chosen ? ' sel' : ''}`,
        el('div', { class: 'or-c' }, el('div', { class: 'l1' }, ...typeLine(r))),
        el('div', { class: `or-c pm r1 ${r.pay.cls}` }, el('div', { class: 'l1' }, el('b', {}, r.pay.text))),
        el('div', { class: 'l2' }, picking ? el('span', { class: `or-cb${picked ? ' on' : ''}`, 'aria-hidden': 'true' }, picked ? icon('check') : null) : null,
          hl(`${r.numbers} · ${timeOf(r.when)} · `), el('b', { class: 'who' }, hl(r.who.l1)), r.who.l2 ? hl(` · ${r.who.l2}`) : null),
        el('div', { class: 'or-c pm r2' }, el('div', { class: 'l2' }, money(Number(r.o.total) || 0), ...tagsOf(r))),
        el('div', { class: `or-c st full ${r.status.cls}` }, el('div', { class: 'l1' }, el('b', {}, r.status.text), r.status.sub ? el('span', { class: `l2 ${r.status.subCls || ''}`.trim() }, r.status.sub) : null)),
        r.who.codes ? el('div', { class: 'or-c full' }, el('div', { class: 'l2' }, ...codesLine(r))) : null);
    };
    listEl = el('div', { class: 'or-ls or-scroll', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } }, ...v.shown.map(item),
      !v.shown.length ? emptyOf(v) : null);
    const r = v.shown.find(x => x.id === chosen);
    return el('div', { class: `or-split ${rowStyle()}` }, listEl, r ? detailOf(r) : el('div', { class: 'or-dt' }));
  }
  function detailOf(r) {
    const o = r.o, lines = Array.isArray(o.lines) ? o.lines : [];
    const sums = window.RestroBill?.order({ lines: lines.map(l => ({ each: Math.round((Number(l.price) || 0) * 100), qty: l.qty, off: l.off })), type: o.type, discountPct: o.discountPct,
      servicePct: o.servicePct, packaging: o.packaging, delivery: o.delivery }, window.RestroMenu?.taxRate ?? 0.05) || { subtotal: o.subtotal || 0, total: o.total || 0, cgst: 0, sgst: 0, tax: 0, roundOff: 0 };
    const gst = window.RestroBill?.labels(window.RestroMenu?.taxRate ?? 0.05) || { cgst: 'CGST', sgst: 'SGST', gst: 'GST', half: '' };
    const count = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0), kots = kotsOf(o).map((k, i) => `#${k.no || i + 1}`);
    const t = r.type, title = t.platform ? `${PLATFORMS[t.platform][0]} #${o.platformNo || '—'} · Order ${ticket(o.number)}` : r.who.l1.startsWith('Table') ? `${r.who.l1.split(' · ')[0]} · Order ${ticket(o.number)}` : `${r.name || t.label} · Order ${ticket(o.number)}`;
    const meta = [t.label, ...(r.who.l1.startsWith('Table') ? [o.guests ? `${o.guests} guest${o.guests === 1 ? '' : 's'}` : '', r.who.l2] : [r.name, r.phone, r.phone ? '' : r.who.l2]),
      timeOf(r.when), dateOf(r.when), kots.length ? `KOT ${kots.join(', ')}` : ''].filter(Boolean).join(' · ');
    const box = (cls, label, value) => el('div', { class: `or-cbx ${cls}` }, el('span', {}, label), el('b', {}, value));
    const c = r.who.codes, pickup = o.platformType === 'pickup';
    const codes = t.platform ? el('div', { class: 'or-codes' }, box('y', 'Call code', o.callCode || '—'), box('g', 'Handover', o.handover || '—'),
      box('', pickup ? 'Ready by' : 'Pickup', (pickup ? o.readyBy : o.pickupAt) ? timeOf(pickup ? o.readyBy : o.pickupAt) : '—'), !pickup ? box('', 'Rider arrival', c?.rider || '—') : null) : null;
    const rupee = p => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
    const dish = l => {
      const each = Math.round((Number(l.price) || 0) * 100), gross = each * (Number(l.qty) || 0), off = window.RestroBill?.lineOff(gross, l.off) || 0;
      return el('div', { class: 'or-dli' }, el('div', { class: 'q' }, `${l.qty} ×`), el('div', { class: 'n' }, l.name, Array.isArray(l.mods) && l.mods.length ? el('small', {}, l.mods.map(m => m?.label || m).join(' · ')) : null),
        el('div', { class: 'e' }, off ? `${l.off}% off` : l.qty > 1 ? `${rupee(each)} ea` : ''), el('div', { class: 'p' }, rupee(gross - off)));
    };
    const tot = [['Subtotal · ' + `${count} item${count === 1 ? '' : 's'}`, money(sums.subtotal)],
      sums.discount ? [`Discount ${sums.discountPct}%`, `−${money(sums.discount)}`] : null,
      sums.service ? [`Service charge ${sums.servicePct}% (optional)`, money(sums.service)] : null,
      sums.packaging ? ['Packaging', money(sums.packaging)] : null, sums.delivery ? ['Delivery', money(sums.delivery)] : null,
      [`${gst.gst} (${gst.cgst} ${money(sums.cgst)} + ${gst.sgst} ${money(sums.sgst)})`, money(sums.tax)],
      sums.roundOff ? ['Round off', `${sums.roundOff > 0 ? '+' : '−'}${money(Math.abs(sums.roundOff))}`] : null].filter(Boolean);
    return el('div', { class: 'or-dt' },
      el('div', { class: 'or-dh' }, el('div', { class: 'or-c' }, el('div', { class: 'l1' }, ...typeLine(r).slice(0, 1), el('b', {}, title)), el('div', { class: 'l2' }, meta))),
      el('div', { class: 'or-stp' }, statusCellOf(r), payCellOf(r)),
      codes,
      el('div', { class: 'or-dl' }, ...lines.map(dish)),
      el('div', { class: 'or-tot' }, ...tot.flatMap(([a, b]) => [el('span', {}, a), el('b', {}, b)]), el('span', { class: 'g' }, 'Total'), el('span', { class: 'g' }, money(sums.total))),
      el('div', { class: 'or-acts' }, r.held ? null : buttons(r),
        el('button', { type: 'button', class: 'or-oc', onclick: () => tapRow(r, true) }, 'Open in Counter', icon('back', 'fwd'))));
  }
  // Cards (OR04): four columns of cards: type and time, the order numbers, the customer (and codes), order status and
  // payment status side by side, the four buttons
  function cardOf(r, board) {
    return tappable(r, board ? 'or-kc' : 'or-cd',
      el('div', { class: 'tp' }, el('div', { class: 'or-c' }, el('div', { class: 'l1' }, ...typeLine(r))),
        board ? el('div', { class: 'tmx' }, timeOf(r.when)) : el('div', { class: 'tmx' }, el('b', {}, timeOf(r.when)), el('span', {}, dateOf(r.when)))),
      el('div', { class: 'sub' }, hl(r.numbers)),
      el('div', { class: 'or-c cux' }, el('div', { class: 'l1' }, el('b', {}, hl(r.who.l1))), r.who.l2 ? el('div', { class: 'l2' }, hl(r.who.l2)) : null, r.who.codes ? el('div', { class: 'l2' }, ...codesLine(r)) : null),
      el('div', { class: 'mid' }, statusCellOf(r), payCellOf(r)),
      picking ? el('div', { class: 'or-c lock' }, r.lock ? el('span', { class: 'or-lock' }, r.lock) : el('span', { class: `or-cb${picking.has(r.id) ? ' on' : ''}` }, picking.has(r.id) ? icon('check') : null)) : buttons(r));
  }
  function cardsView(v) {
    listEl = el('div', { class: 'or-cg or-scroll', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } }, ...v.shown.map(r => cardOf(r, false)), !v.shown.length ? emptyOf(v) : null);
    return el('div', { class: `or-cards ${rowStyle()}` }, listEl);
  }
  // Board (OR05): Scheduled · In kitchen · Ready with their counts (adding up to the Open tab, each column that many
  // cards), and Closed folded into a narrow strip with its count; › unfolds it
  function boardView(v) {
    const open = v.shown.filter(r => !r.held && r.status.text === 'Open'), closed = v.shown.filter(r => r.status.text === 'Closed');
    const COLS = [['Scheduled', '#8A3F9A', r => r.status.subCls === 'sch'], ['In kitchen', '#78716C', r => r.status.subCls !== 'sch' && r.status.subCls !== 'rd'], ['Ready', '#2F7D4F', r => r.status.subCls === 'rd']];
    const col = (name, colour, list, fold) => el('div', { class: 'or-col' },
      el(fold ? 'button' : 'div', { class: 'or-ch2', style: `--c:${colour}`, ...(fold ? { type: 'button', onclick: () => { closedOpen = false; renderRest(); } } : {}) }, el('i'), name, el('em', {}, String(list.length))),
      el('div', { class: 'or-col-in or-scroll' }, ...list.map(r => cardOf(r, true))));
    const cols = COLS.map(([name, colour, test]) => col(name, colour, open.filter(test)));
    const strip = closedOpen ? col('Closed', '#4A9468', closed, true)
      : el('button', { type: 'button', class: 'or-col or-cz', 'aria-label': `Closed, ${closed.length} orders. Show them`, onclick: () => { closedOpen = true; renderRest(); } },
        el('span', { class: 'czi' }, el('i'), el('b', {}, 'Closed'), el('em', {}, String(closed.length)), icon('back', 'fwd')));
    listEl = null;
    return el('div', { class: `or-bd ${rowStyle()}${closedOpen ? ' unfolded' : ''}` }, ...cols, strip);
  }
  const emptyOf = v => el('div', { class: 'or-empty' }, el('strong', {}, v.all.length ? 'No orders match' : day && day !== todayKey() ? 'No orders that day' : 'No orders yet'),
    el('span', {}, v.all.length ? 'Try another tab, or clear the filters.' : 'Orders show here once they are saved or paid in Counter.'));
  // Bill / Receipt (the paper level inside: used part white on top, paper left light blue; amber when low, red with !
  // when out, grey and crossed when the printer is offline) · KOT (blue; "KOT 3" solid when dishes haven't gone to the
  // kitchen; "KOT !" red when a print failed) · Notify, or Ready → Marked for a delivery app · Buzz with the pager's
  // number. Inactive ones are greyed in their place. A tap only does that button's job; a moving finger scrolls.
  function buttons(r) {
    const stop = e => e.stopPropagation();
    const b = (cls, on, label, run, ...content) => el('button', { type: 'button', class: `or-b ${cls}${on ? '' : ' off'}`, 'aria-label': label, 'aria-disabled': on ? null : 'true',
      onclick: e => { stop(e); if (on) run(e.currentTarget); }, onpointerdown: stop }, ...content);
    const paid = r.pay.cls === 'paid' || r.pay.cls === 'rf', look = paperLook();
    const pr = b('pr', !r.held, paid ? 'Print the receipt' : 'Print the bill', () => printOrder(r), icon(look === 'off' ? 'printOff' : 'print'), el('span', {}, paid ? 'Receipt' : 'Bill'));
    if (!r.held) paintPaper(pr);
    const k = r.kot;
    const kot = b(`kot${k.look === 'solid' ? ' solid' : k.look === 'err' ? ' err' : ''}`, k.look !== 'off', k.look === 'solid' ? `Send ${k.n} dishes to the kitchen` : k.look === 'err' ? 'A KOT didn’t print: print it again' : 'Reprint a KOT',
      btn => openKot(r, btn), icon('kot'), el('span', {}, k.look === 'solid' ? `KOT ${k.n}` : k.look === 'err' ? 'KOT !' : 'KOT'));
    const th = r.third;
    const third = th.kind === 'notify'
      ? b('nt', th.on, th.on ? `Notify ${r.name || 'the customer'}` : 'Notify: no phone number', btn => openNotify(r, btn), icon('notify'), el('span', {}, 'Notify'))
      : b('nt', th.on, th.kind === 'marked' ? 'Marked ready' : 'Mark ready', () => markReady(r), icon(th.kind === 'marked' ? 'marked' : 'ready'), el('span', {}, th.kind === 'marked' ? 'Marked' : 'Ready'));
    const buzzed = flash.get(r.id) === 'buzzed';
    const buzz = buzzed ? el('button', { type: 'button', class: 'or-b bz done', 'aria-label': `Pager ${r.buzz.no} buzzed`, onclick: stop, onpointerdown: stop }, icon('check'), el('span', {}, 'Buzzed'))
      : b('bz', r.buzz.on, r.buzz.on ? `Buzz pager ${r.buzz.no}` : r.buzz.no ? `Pager ${r.buzz.no}: back in its dock` : 'Buzz: no pager', () => buzzPager(r), r.buzz.no ? el('em', {}, r.buzz.no) : null, el('span', {}, 'Buzz'));
    return el('div', { class: 'or-bt', role: 'cell' }, pr, kot, third, buzz);
  }

  // ---------- taps on a row, long-press to pick ----------
  let press = null, suppressTap = false;
  root.addEventListener('pointerdown', e => {
    suppressTap = false; // (a long-press's own tap is the only one passed over)
    const row = e.target.closest?.('.or-r'); if (!row || e.target.closest('.or-bt') || e.button !== 0) return;
    press = { row, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => longPress(row), 550) };
  });
  const endPress = e => { if (press && (!e || e.pointerId === press.id)) { clearTimeout(press.timer); press = null; } };
  root.addEventListener('pointermove', e => { if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(e); });
  root.addEventListener('pointerup', endPress); root.addEventListener('pointercancel', endPress);
  function longPress(row) {
    press = null; suppressTap = true;
    const id = row.dataset.id, r = view().shown.find(x => x.id === id);
    if (!picking) picking = new Set();
    if (r && !r.lock) picking.add(id);
    renderRest();
  }
  function tapRow(r, open = false) {
    if (!picking && !open && viewKind() === 'split' && chosen !== r.id) { chosen = r.id; renderRest(); return; }
    if (picking) {
      if (r.lock) { say({ text: `${r.lock.split(' · ')[0]} orders can’t be deleted` }); return; }
      if (picking.has(r.id)) picking.delete(r.id); else picking.add(r.id);
      renderRest(); return;
    }
    if (r.held) { returning = true; window.RestroCounter?.resumeHeld(r.o.heldId); return; }
    if (r.type.platform) { say({ text: `${PLATFORMS[r.type.platform][0]} orders open with the ${PLATFORMS[r.type.platform][0]} integration` }); return; }
    if (r.pay.cls === 'paid' || r.pay.cls === 'rf') { showReceipt(r.o); return; }
    returning = true; window.RestroCounter?.openOrder(r.o.uid || r.o.number);
  }

  // ---------- the buttons' jobs ----------
  async function printOrder(r) {
    const uid = r.o.uid || r.o.number;
    if (typeof window.RestroCounter?.printSaved !== 'function') return;
    const res = await window.RestroCounter.printSaved(uid);
    const what = res.kind === 'receipt' ? 'Receipt' : 'Bill';
    if (res.ok) say({ bold: `${what} ${res.reprint ? 'reprinted' : 'printed'}`, text: ` · Order ${ticket(r.o.number)}` });
    else say({ kind: 'error', bold: `The ${what.toLowerCase()} didn’t print`, text: res.why === 'number' ? ' · can’t reach the main system for its bill number' : ` · Order ${ticket(r.o.number)}`, retry: () => printOrder(r) });
    render();
  }
  function buzzPager(r) {
    const pager = window.RESTRODevice?.pager, n = r.buzz.no;
    if (typeof pager?.buzz !== 'function') { say('Pagers start with the RESTRO Android app'); return; }
    const who = [r.name || (r.who.l1.startsWith('Table') ? r.who.l1.split(' · ')[0] : ''), `Order ${ticket(r.o.number)}`].filter(Boolean).join(', ');
    Promise.resolve(pager.buzz(Number(n))).then(ok => {
      if (ok === false) { say({ kind: 'error', bold: `Pager ${n}`, text: ' didn’t buzz', retry: () => buzzPager(r) }); return; }
      flash.set(r.id, 'buzzed'); renderRest(); say({ bold: `Pager ${n}`, text: ` buzzed · ${who}` });
      setTimeout(() => { flash.delete(r.id); if (dialog.open) renderRest(); }, 2000);
    }, () => say({ kind: 'error', bold: `Pager ${n}`, text: ' didn’t buzz', retry: () => buzzPager(r) }));
  }
  function markReady(r) {
    if (r.third.kind === 'marked') return;
    if (window.RestroCounter?.markReady?.(r.o.uid)) { say({ bold: 'Marked ready', text: ` · ${r.type.label.split(' · ')[0]} #${r.o.platformNo || ''}` }); render(); }
  }

  // ---------- pop-ups ----------
  // Notify (OR-P01): the customer's name, phone, order and type · the message · Order ready / Bill / Running late ·
  // WhatsApp / SMS. Through the RESTRO Android app (RESTRODevice.whatsapp, RESTRODevice.sms; WhatsApp falls back to SMS).
  function openNotify(r, btn) { pop = { kind: 'notify', id: r.id, template: 'ready', anchor: anchorOf(btn) }; renderLayer(); }
  function message(r, template) {
    const hi = r.name ? `Hi ${r.name}, ` : 'Hi, ', no = ticket(r.o.number), shop = shopName(), from = shop ? [' from ', shop] : [];
    const type = r.type.key;
    if (template === 'bill') return [hi, 'the bill for your order ', el('b', {}, no), ...from, ' is ', el('b', {}, money(Number(r.o.total) || 0)), '.'];
    if (template === 'late') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'running a little late'), '. We’ll message you as soon as it’s ready.'];
    if (type === 'dine-in') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready'), '.'];
    if (type === 'delivery') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready'), ' and will be with you soon.'];
    return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready for pickup'), '. Please show this message at the counter.'];
  }
  const plain = nodes => nodes.map(n => (typeof n === 'string' ? n : n.textContent)).join('');
  async function sendNotify(r, channel) {
    const text = plain(message(r, pop?.template || 'ready')), dev = window.RESTRODevice, to = r.o.customer?.mobile, code = r.o.customer?.code || '91';
    const sms = typeof dev?.sms?.send === 'function', wa = typeof dev?.whatsapp?.send === 'function';
    if (!sms && !wa) { say('Messages start with the RESTRO Android app'); return; }
    pop = null; renderLayer();
    const send = async how => { try { return (await (how === 'whatsapp' ? dev.whatsapp : dev.sms).send({ to, code, text, order: r.o.uid })) !== false; } catch { return false; } };
    let used = channel === 'whatsapp' && wa ? 'whatsapp' : sms ? 'sms' : null;
    let ok = used ? await send(used) : false;
    if (!ok && used === 'whatsapp' && sms) { used = 'sms'; ok = await send('sms'); }
    if (ok) say({ bold: used === 'whatsapp' ? 'WhatsApp sent' : 'SMS sent', text: ` to ${r.name || 'the customer'}` });
    else say({ kind: 'error', bold: 'The message didn’t go', text: ` · ${r.name || 'the customer'}`, retry: () => sendNotify(r, channel) });
  }
  function notifyCard(r) {
    const tpl = pop.template;
    const chip = (key, label) => el('button', { type: 'button', class: `or-tpl${tpl === key ? ' on' : ''}`, 'aria-pressed': String(tpl === key), onclick: () => { pop.template = key; renderLayer(); } }, label);
    return el('div', { class: 'or-pop notify', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Notify ${r.name || 'the customer'}` },
      el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Notify ${r.name || 'the customer'}`), el('p', {}, [r.phone, `Order ${ticket(r.o.number)}`, r.type.label].filter(Boolean).join(' · '))), closeX()),
      el('p', { class: 'or-msg-box' }, ...message(r, tpl)),
      el('div', { class: 'or-tpls' }, chip('ready', 'Order ready'), chip('bill', 'Bill'), chip('late', 'Running late')),
      el('div', { class: 'or-chs' },
        el('button', { type: 'button', class: 'or-ch wa', onclick: () => sendNotify(r, 'whatsapp') }, icon('chat'), 'WhatsApp'),
        el('button', { type: 'button', class: 'or-ch sm', onclick: () => sendNotify(r, 'sms') }, icon('sms'), 'SMS')));
  }
  // KOT (OR-P03 to P06): dishes not sent yet → Send N dishes to kitchen (what went is listed under it, tick to reprint
  // too); otherwise Reprint KOT: every KOT with its number, time and dishes, tick one or several (Select all). A KOT
  // that didn't print is ticked, in red, with why ("Kitchen printer was out of paper — KOT 160 didn’t print.").
  function openKot(r, btn) {
    const k = window.RestroCounter?.kitchenOf?.(r.o.uid || r.o.number); if (!k) return;
    const failed = k.kots.filter(x => x.failed);
    pop = { kind: 'kot', id: r.id, uid: r.o.uid || r.o.number, k, picked: new Set(failed.map(x => x.id)), anchor: anchorOf(btn) };
    renderLayer();
  }
  const WHY = { paper: 'Kitchen printer was out of paper', offline: 'Kitchen printer was offline', cover: 'Kitchen printer’s cover was open' };
  function kotCard(r) {
    const { k, picked } = pop, failed = k.kots.filter(x => x.failed), sending = k.unsent.length > 0;
    const count = k.unsent.reduce((n, l) => n + l.qty, 0);
    const who = r.who.l1.startsWith('Table') ? r.who.l1.split(' · ')[0] : r.name || r.type.label;
    const tick = x => el('button', { type: 'button', class: `or-kotc${picked.has(x.id) ? ' on' : ''}${x.failed ? ' failed' : ''}`, role: 'checkbox', 'aria-checked': String(picked.has(x.id)),
      onclick: () => { if (picked.has(x.id)) picked.delete(x.id); else picked.add(x.id); renderLayer(); } },
    el('span', { class: 'or-cb', 'aria-hidden': 'true' }, picked.has(x.id) ? icon('check') : null),
    el('span', { class: 'or-kotc-t' }, el('b', {}, `KOT ${x.no}`, x.failed ? el('i', {}, ' · didn’t print') : null), el('small', {}, x.dishes)), el('span', { class: 'or-kotc-at' }, timeOf(x.at)));
    const n = picked.size, red = !sending && failed.length > 0 && [...picked].every(id => failed.some(f => f.id === id)) && n > 0;
    const label = sending ? `Send ${count} dish${count === 1 ? '' : 'es'} to kitchen${n ? ` · reprint ${n === 1 ? 'KOT' : `${n} KOTs`}` : ''}`
      : !n ? 'Reprint' : n === 1 ? `Reprint KOT ${k.kots.find(x => picked.has(x.id)).no}` : n === k.kots.length && n > 1 ? `Reprint all ${n} KOTs` : `Reprint ${n} KOTs`;
    const why = failed.length ? `${WHY[failed[0].why] || 'Kitchen printer didn’t answer'} — ${failed.length === 1 ? `KOT ${failed[0].no} didn’t print` : `${failed.length} KOTs didn’t print`}.` : '';
    return el('div', { class: 'or-pop kot', role: 'dialog', 'aria-modal': 'true', 'aria-label': sending ? `Send KOT, ${who}` : `Reprint KOT, ${who}` },
      el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `${sending ? 'Send KOT' : 'Reprint KOT'} · ${who}`), el('p', {}, `Order ${ticket(r.o.number)} · ${r.type.label}`)), closeX()),
      why ? el('p', { class: 'or-why' }, icon('kot'), why) : null,
      sending ? [
        el('p', { class: 'or-lab' }, k.kitchenAt ? `Not sent yet · ${count} · goes to the kitchen at ${clockOf(k.kitchenAt)}` : `Not sent yet · ${count}`),
        el('div', { class: 'or-unsent' }, ...k.unsent.map(l => el('p', {}, el('b', {}, `${l.qty} ×`), ` ${l.name}`, l.mods ? el('span', { class: 'mod' }, ` · ${l.mods}`) : null))),
        k.kots.length ? el('p', { class: 'or-lab' }, 'Already sent') : null]
        : el('p', { class: 'or-lab' }, failed.length ? 'Tick to reprint' : 'All dishes already sent · tick to reprint',
          k.kots.length > 1 ? el('button', { type: 'button', class: 'or-link', onclick: () => { k.kots.forEach(x => picked.add(x.id)); renderLayer(); } }, 'Select all') : null),
      k.kots.length ? el('div', { class: 'or-kots' }, ...k.kots.map(tick)) : !sending ? el('p', { class: 'or-none' }, 'Nothing has gone to the kitchen yet.') : null,
      el('button', { type: 'button', class: `or-go${red ? ' red' : ''}`, disabled: !sending && !n, onclick: () => runKot(r) }, icon('kot'), label));
  }
  async function runKot(r) {
    const { k, picked, uid } = pop, ids = [...picked], sending = k.unsent.length > 0, no = ticket(r.o.number);
    pop = null; renderLayer();
    const C = window.RestroCounter;
    if (sending) {
      const res = await C.sendKitchen(uid);
      if (!res.ok) say({ kind: 'error', bold: 'Kitchen printer didn’t print', text: ` · KOT ${res.no} · Order ${no}`, retry: () => C.reprintKots(uid, []) });
      else say({ bold: `KOT ${res.no} sent`, text: ` · ${res.count} dish${res.count === 1 ? '' : 'es'} · Order ${no}` });
    }
    if (ids.length) {
      const res = await C.reprintKots(uid, ids);
      if (res.ok) { if (!sending) say({ bold: ids.length === 1 ? 'KOT reprinted' : `${ids.length} KOTs reprinted`, text: ` · Order ${no}` }); }
      else say({ kind: 'error', bold: `${res.failed.length === 1 ? `KOT ${res.failed[0].no}` : `${res.failed.length} KOTs`} didn’t print`, text: ` · ${WHY[res.failed[0].why] || 'Kitchen printer didn’t answer'}`, retry: () => openKotById(r.id) });
    }
    render();
  }
  function openKotById(id) { const r = view().shown.find(x => x.id === id); const btn = dialog.querySelector(`[data-id="${CSS.escape(id)}"] .or-b.kot`); if (r) openKot(r, btn); }
  // Delete (picked orders): "Delete 3 orders?" · what the kitchen gets · Reason (required) and its line · the two
  // reasons this restaurant gives most (learned, as the void reasons are: the list "@delete") · Clear ..... the red button
  const learned = id => { try { const kept = JSON.parse(localStorage.getItem('restro.quickNotes.v1') || 'null'), out = new Map(); for (const x of Array.isArray(kept?.lists?.[id]) ? kept.lists[id] : []) { const t = (typeof x === 'string' ? x : x?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t); } return [...out.values()]; } catch { return []; } };
  function deleteCard() {
    const rows = view().all.filter(r => pop.ids.includes(r.id)), n = rows.length, reached = rows.filter(r => kotsOf(r.o).length).length;
    const reasons = learned('@delete').slice(0, 2), reason = pop.reason;
    const input = el('input', { id: 'orders-reason', type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', placeholder: 'Type the reason here', 'aria-label': 'Reason' });
    input.value = reason;
    const line = el('label', { class: `or-line${reason ? '' : ' empty'}` }, icon('edit'), input);
    const go = el('button', { type: 'button', class: 'or-go red', disabled: !reason.trim(), onclick: () => confirmDelete() }, icon('trash'), n === 1 ? 'Delete order' : `Delete ${n} orders`);
    const clear = el('button', { type: 'button', class: 'or-clear-t', disabled: !reason, onclick: () => { pop.reason = ''; input.value = ''; sync(); input.focus(); } }, 'Clear');
    const chips = reasons.map(x => el('button', { type: 'button', class: `or-tpl${reason.trim().toLowerCase() === x.toLowerCase() ? ' on' : ''}`, onclick: () => { pop.reason = x; input.value = x; sync(); } }, x));
    function sync() { line.classList.toggle('empty', !pop.reason); go.disabled = !pop.reason.trim(); clear.disabled = !pop.reason; chips.forEach((c, i) => c.classList.toggle('on', pop.reason.trim().toLowerCase() === reasons[i].toLowerCase())); }
    input.addEventListener('input', () => { pop.reason = input.value; sync(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return el('div', { class: 'or-pop del', role: 'dialog', 'aria-modal': 'true', 'aria-label': n === 1 ? 'Delete order' : `Delete ${n} orders` },
      el('div', { class: 'or-pop-head' }, el('div', { class: 'or-del-h' }, el('i', { 'aria-hidden': 'true' }, icon('trash')), el('div', {}, el('h3', {}, n === 1 ? `Delete order ${ticket(rows[0].o.number)}?` : `Delete ${n} orders?`),
        el('p', {}, 'They come off Orders and the Counter · tables and pagers free'))), closeX()),
      reached ? el('p', { class: 'or-why' }, icon('kot'), n === 1 ? 'An ORDER CANCELLED slip will print in the kitchen.' : `One ORDERS CANCELLED slip for ${reached === 1 ? '1 order' : `${reached} orders`} will print in the kitchen.`) : null,
      el('p', { class: 'or-lab' }, 'Reason (required)'), line,
      el('p', { class: 'or-lab' }, 'Top reasons'),
      chips.length ? el('div', { class: 'or-tpls' }, ...chips) : el('p', { class: 'or-none' }, 'Your most-used reasons will show up here after 15 days.'),
      el('div', { class: 'or-pop-foot' }, clear, go));
  }
  function confirmDelete() {
    const ids = pop.ids, reason = pop.reason.trim(); if (!reason) return;
    const uids = view().all.filter(r => ids.includes(r.id) && !r.lock).map(r => r.o.uid || `n${r.o.number}`);
    const res = window.RestroCounter?.deleteOrders?.(uids, reason) || { count: 0 };
    pop = null; picking = null; render();
    if (res.count) say({ bold: res.count === 1 ? 'Order deleted' : `${res.count} orders deleted`, text: res.kitchen ? ` · ${res.count === 1 ? 'ORDER CANCELLED' : 'ORDERS CANCELLED'} slip sent to the kitchen` : '' });
  }
  // New paper roll? (OR-P08)
  function rollCard() {
    const p = pop;
    return el('div', { class: 'or-pop roll', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New paper roll?' },
      el('div', { class: 'or-roll-h' }, el('i', { 'aria-hidden': 'true' }, icon('print')), el('div', {}, el('h3', {}, 'New paper roll?'), el('p', {}, `The bill printer’s cover was opened · ${p.printer}`))),
      el('p', { class: 'or-msg-box' }, 'If you fitted a ', el('b', {}, 'new roll'), ', the paper level resets to ', el('b', {}, '100%'), '. If you only cleared a jam or checked it, choose ', el('b', {}, 'No'), ' and it keeps counting from ', el('b', {}, `${p.level}%`), '.'),
      el('div', { class: 'or-chs' },
        el('button', { type: 'button', class: 'or-ch no', onclick: () => { pop = null; renderLayer(); } }, 'No, same roll'),
        el('button', { type: 'button', class: 'or-ch sm', onclick: () => { pop = null; renderLayer(); try { window.RESTRODevice?.printer?.newRoll?.(); } catch {} setPaper({ level: 100, state: 'ok' }); say({ bold: 'New roll', text: ' · paper level 100%' }); } }, 'Yes, new roll')));
  }
  const closeX = () => el('button', { type: 'button', class: 'or-x', 'aria-label': 'Close', onclick: () => { pop = null; renderLayer(); } }, icon('close'));
  // A pop-up opened from a row's button sits beside it: its right edge 10 left of the button, level with the row
  function anchorOf(btn) { const r = btn?.getBoundingClientRect?.(), box = root.getBoundingClientRect(); return r ? { right: box.right - r.left + 10 * fu(), mid: (r.top + r.bottom) / 2 - box.top } : null; }
  const probe = el('span', { class: 'or-probe', 'aria-hidden': 'true' }), fu = () => (probe.offsetWidth / 100) || 1; // (the design's pixel, --fu)

  // ---------- dropdown menus (OR-P12): under their button ----------
  function toggleMenu(key, btn) { menu = menu === key ? null : key; menuAt = btn ? btn.getBoundingClientRect() : null; render(); }
  let menuAt = null;
  function menuView(v) {
    const items = [];
    const item = (on, label, count, lead, pick, sep) => { if (sep) items.push(el('div', { class: 'or-sepm' })); items.push(el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), class: `or-it${on ? ' on' : ''}`, onclick: () => { pick(); menu = null; scrollTop = 0; render(); } }, lead, el('span', { class: 'or-it-t' }, label), count != null ? el('em', {}, String(count)) : null)); };
    const box = name => el('span', { class: 'ii' }, icon(name));
    const others = (field) => v.all.filter(r => { const keep = { dv, typeF, staffF }; return withFilters({ ...keep, [field]: 'all' }, r); });
    if (menu === 'dv') {
      const pool = others('dv');
      DV.forEach(([key, label, ic], i) => item(dv === key, label, pool.filter(r => key === 'all' || (key === 'disc' ? r.tags.disc : key === 'void' ? r.tags.void : r.tags.disc && r.tags.void)).length, box(ic), () => { dv = key; }, i === 1));
    } else if (menu === 'type') {
      const pool = others('typeF'), keys = [...Object.keys(TYPES), ...Object.keys(PLATFORMS).filter(p => v.all.some(r => r.type.platform === p))];
      item(typeF === 'all', 'All order types', pool.length, box('receipt'), () => { typeF = 'all'; });
      keys.forEach((key, i) => item(typeF === key, TYPES[key]?.[0] || PLATFORMS[key][0], pool.filter(r => (r.type.platform ? r.type.platform === key : r.type.keys.includes(key))).length,
        TYPES[key] ? el('span', { class: 'ii', style: `color:${TYPES[key][2]}` }, icon(TYPES[key][1])) : el('span', { class: 'ii logo', style: `background:${PLATFORMS[key][1]}` }, PLATFORMS[key][0][0]), () => { typeF = key; }, i === 0));
    } else if (menu === 'staff') {
      const pool = others('staffF'), names = [...new Set(v.all.map(r => r.server).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      item(staffF === 'all', 'All staff', pool.length, box('receipt'), () => { staffF = 'all'; });
      names.forEach((name, i) => item(staffF === name, name, pool.filter(r => r.server === name).length, el('span', { class: 'ii av' }, initialsOf(name)), () => { staffF = name; }, i === 0));
    } else if (menu === 'day') {
      const days = [...new Set([todayKey(), ...(window.RestroCounter?.orders?.() || []).map(dayOfOrder)])].sort().reverse().slice(0, 31);
      const counts = new Map(); for (const o of window.RestroCounter?.orders?.() || []) counts.set(dayOfOrder(o), (counts.get(dayOfOrder(o)) || 0) + 1);
      days.forEach(d => item((day || todayKey()) === d, dayLabel(d), counts.get(d) || 0, box('calendar'), () => { day = d === todayKey() ? null : d; }));
    }
    const box2 = root.getBoundingClientRect(), at = menuAt, right = at ? at.right - box2.left : 0;
    const style = at ? `top:${at.bottom - box2.top + 6 * fu()}px;${right > box2.width * .6 ? `right:${box2.right - at.right}px` : `left:${at.left - box2.left + 8 * fu()}px`}` : '';
    return el('div', { class: 'or-menu-wrap', onclick: e => { if (e.target === e.currentTarget) { menu = null; render(); } } },
      el('div', { class: 'or-menu', role: 'menu', style }, ...items));
  }
  function withFilters(f, r) { const keep = { dv, typeF, staffF }; ({ dv, typeF, staffF } = f); const ok = matches(r); ({ dv, typeF, staffF } = keep); return ok; }

  // ---------- rendering ----------
  function render() {
    const v = view();
    topEl = topBar(v); restEl = el('div', { class: 'or-rest' });
    layerEl = el('div', { class: 'or-layer' });
    root.replaceChildren(topEl, restEl, layerEl, probe);
    fillRest(v); fillLayer(v);
    if (msg && bar.parentElement !== dialog) dialog.append(bar);
  }
  function renderRest() {
    if (!topEl) { render(); return; }
    const v = view();
    topEl.querySelector('.or-sum')?.replaceWith(summary(v));
    fillRest(v); fillLayer(v);
  }
  function renderLayer() { if (!layerEl) { render(); return; } fillLayer(view()); }
  function fillRest(v) {
    const kind = viewKind();
    restEl.replaceChildren(filterBar(v), kind === 'split' ? splitView(v) : kind === 'cards' ? cardsView(v) : kind === 'board' ? boardView(v) : list(v));
    if (listEl) listEl.scrollTop = scrollTop;
  }
  function fillLayer(v) {
    const parts = [];
    if (menu) parts.push(menuView(v));
    if (pop) {
      const r = pop.kind === 'notify' || pop.kind === 'kot' ? v.all.find(x => x.id === pop.id) : null;
      const card = pop.kind === 'notify' && r ? notifyCard(r) : pop.kind === 'kot' && r ? kotCard(r) : pop.kind === 'delete' ? deleteCard() : pop.kind === 'roll' ? rollCard() : null;
      if (card) {
        if (pop.anchor) card.style.cssText = `right:${pop.anchor.right}px;--mid:${pop.anchor.mid}px`;
        card.classList.toggle('anchored', Boolean(pop.anchor));
        // a tap outside closes Notify and KOT; the delete and paper-roll questions wait for an answer
        parts.push(el('div', { class: 'or-scrim', onclick: e => { if (e.target === e.currentTarget && (pop.kind === 'notify' || pop.kind === 'kot')) { pop = null; renderLayer(); } } }, card));
      } else pop = null;
    }
    layerEl.replaceChildren(...parts);
    if (pop?.anchor) requestAnimationFrame(placePop);
  }
  // (an anchored pop-up level with its row, kept inside the app)
  function placePop() {
    const card = layerEl?.querySelector('.or-pop.anchored'); if (!card) return;
    const box = root.getBoundingClientRect(), h = card.offsetHeight, mid = parseFloat(card.style.getPropertyValue('--mid')) || box.height / 2, pad = 12 * fu();
    card.style.top = `${Math.max(pad, Math.min(box.height - h - 24 * fu(), mid - h / 2))}px`;
  }

  // A paid order's receipt, over the list (its details page comes later): the order, the items, the sums and the payment
  let receipt = null;
  function closeReceipt() { if (!receipt) return false; receipt.remove(); receipt = null; return true; }
  function showReceipt(o) {
    closeReceipt();
    const r = infoOf(o, false, Date.now()), sub = Number.isFinite(o.subtotal) ? o.subtotal : o.lines.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0);
    const pct = window.RestroBill?.pct(o.discountPct) ?? null, split = Number.isFinite(o.cgst) && Number.isFinite(o.sgst);
    const gst = window.RestroBill?.labels(window.RestroMenu?.taxRate) || { cgst: 'CGST', sgst: 'SGST' };
    const rate = sub ? Math.round((o.tax / sub) * 1000) / 10 : 0, cash = (o.method || 'cash') === 'cash' && Number.isFinite(o.received);
    const row = (a, b, cls) => [el('dt', cls ? { class: cls } : {}, a), el('dd', cls ? { class: cls } : {}, b)];
    receipt = el('div', { class: 'or-scrim receipt', onclick: e => { if (e.target === e.currentTarget) closeReceipt(); } },
      el('div', { class: 'or-pop or-receipt', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Receipt, order ${ticket(o.number)}` },
        el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Receipt · Order ${ticket(o.number)}`), el('p', {}, [r.type.label, r.who.l1, `${dateOf(o.createdAt)} · ${timeOf(o.createdAt)}`].filter(Boolean).join(' · '))),
          el('button', { type: 'button', class: 'or-x', 'aria-label': 'Close', onclick: closeReceipt }, icon('close'))),
        el('ul', { class: 'or-rc-lines' }, ...o.lines.map(l => el('li', {},
          el('span', { class: 'q' }, `${l.qty} ×`), el('span', { class: 'n' }, l.name,
            Array.isArray(l.mods) && l.mods.length ? el('small', {}, l.mods.map(m => (m.price && !m.sets ? `${m.label} +₹${m.price}` : m.label)).join(' · ')) : null,
            window.RestroBill?.pct(l.off) ? el('small', {}, `${l.off}% off${l.off === 100 && l.offReason ? ` · ${l.offReason}` : ''}`) : null),
          el('span', { class: 'a' }, money(Math.round(l.price * 100) * l.qty))))),
        el('dl', { class: 'or-rc-sums' },
          ...row('Subtotal', money(sub)),
          ...(pct && Number.isFinite(o.discount) ? row(`Discount ${pct}%`, `−${money(o.discount)}`) : []),
          ...(o.servicePct && Number(o.service) ? row(`Service charge ${o.servicePct}% (optional)`, money(o.service)) : []),
          ...(Number(o.packaging) ? row('Packaging charge', money(o.packaging)) : []),
          ...(Number(o.delivery) ? row('Delivery charge', money(o.delivery)) : []),
          ...(split ? [...row(gst.cgst, money(o.cgst)), ...row(gst.sgst, money(o.sgst))] : row(rate ? `GST ${rate}%` : 'GST', money(o.tax || 0))),
          ...(Number(o.roundOff) ? row('Round off', `${o.roundOff < 0 ? '−' : '+'}${money(Math.abs(o.roundOff))}`) : []),
          ...row('Total', money(o.total), 'tot'),
          ...(cash ? [...row('Cash received', money(o.received)), ...row('Change given', money(o.change || 0))] : [])),
        el('p', { class: 'or-rc-paid' }, `${r.pay.text} · ${timeOf(Date.parse(o.paidAt) || o.createdAt)}`)));
    dialog.append(receipt);
    receipt.querySelector('.or-x')?.focus({ preventScroll: true });
  }

  // ---------- keeping up ----------
  // Orders saved, paid, held or deleted on another tablet (sync.js), a pager docked back: at once. While open, every 30
  // seconds for the kitchen minutes, unless a finger is scrolling or a menu or pop-up is open.
  window.addEventListener('restro:data-changed', e => { const names = e.detail?.collections || []; if (dialog.open && (names.includes('orders') || names.includes('held')) && !menu) renderRest(); });
  window.addEventListener('restro:pager-docked', () => { if (dialog.open && !menu) renderRest(); });
  // (Settings › Orders: the list view and row style, chosen here or for all tablets on another)
  window.addEventListener('restro:prefs-changed', e => { if (e.detail?.name === 'orders' && dialog.open) render(); });
  let timer = null;
  dialog.addEventListener('close', () => {
    clearInterval(timer); timer = null; closeReceipt();
    // leaving the app resets the filters; opening an order (and coming back) keeps them
    if (!returning) { resetFilters(); fromCounter = false; }
    menu = null; pop = null; picking = null; if (msg) { clearTimeout(msg.timer); msg = null; paintMsg(); }
  });
  window.addEventListener('restro:screen-locked', () => { returning = false; resetFilters(); if (dialog.open) render(); });
  window.addEventListener('restro:staff-signed-in', () => { returning = false; resetFilters(); if (dialog.open) render(); });
  // Back: closes a menu, a pop-up or the receipt first; picking stops; then to Counter when Orders was opened from there
  function goBack() {
    if (!dialog.open || !fromCounter || !window.RestroCounter) return false;
    fromCounter = false; returning = false; window.RestroCounter.resume(); return true;
  }
  dialog.addEventListener('cancel', event => {
    if (closeReceipt()) { event.preventDefault(); return; }
    if (menu || pop || picking) { event.preventDefault(); menu = null; pop = null; picking = null; render(); return; }
    if (goBack()) event.preventDefault();
  });

  // Toasts from elsewhere show above this full-screen app (and go back to Counter, or home, after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) (document.querySelector('#counter-dialog[open]') || toastHome).append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  // ---------- Settings › Orders (Update Pack 3): a still picture of this page ----------
  // The page as it is now (today's orders, no search or filters) in a list view and row style, for Settings' live
  // previews. With no orders yet: built-in sample orders (tables and amounts only: no names or phone numbers), and
  // `sample` says so. → { node, sample }
  function sampleOrders(now) {
    const m = n => now - n * 60000;
    const O = (n, mins, type, total, extra = {}) => ({ uid: `sample${n}`, number: n, type, table: '', guests: 0, customer: null, lines: [{ id: 'paneer-tikka', name: 'Paneer tikka', qty: 1, price: 260, type }],
      sent: { [`paneer-tikka@${type}`]: 1 }, total: total * 100, createdAt: m(mins), sentAt: m(mins - 1), kitchenAt: m(mins - 1), kots: [{ id: `k${n}`, kind: 'kot', no: n, at: m(mins - 1), lines: [] }], ...extra });
    return [
      O(12, 4, 'phone', 2814, { readyAt: null }),
      O(11, 9, 'dine-in', 4158, { table: 'T12', guests: 4 }),
      O(10, 16, 'delivery', 646, { method: 'card', paidAt: new Date(m(16)).toISOString() }),
      O(9, 25, 'takeaway', 1040, { kitchenDoneAt: m(6), method: 'upi', paidAt: new Date(m(24)).toISOString(), pager: 3, pagerOut: true }),
      O(8, 39, 'dine-in', 945, { table: 'T4', guests: 2 }),
      O(7, 47, 'phone', 819, { sentAt: null, kitchenAt: null, kots: [], sent: {}, readyAt: now + 63 * 60000, method: 'upi', paidAt: new Date(m(46)).toISOString() }),
      O(6, 52, 'takeaway', 1320, { kitchenDoneAt: m(29), method: 'cash', paidAt: new Date(m(50)).toISOString() }),
      O(5, 67, 'dine-in', 1848, { table: 'T7', guests: 3, kitchenDoneAt: m(37), method: 'cash', paidAt: new Date(m(32)).toISOString() }),
      O(4, 85, 'takeaway', 560, { kitchenDoneAt: m(62), method: 'card', paidAt: new Date(m(61)).toISOString() }),
      O(3, 96, 'dine-in', 1210, { table: 'T2', guests: 2, kitchenDoneAt: m(66), method: 'upi', paidAt: new Date(m(58)).toISOString() })];
  }
  function preview({ view: v = 'classic', rows = 'classic' } = {}) {
    const keep = { tab, query, dv, typeF, staffF, sort, day, menu, picking, pop, chosen, closedOpen, listEl, scrollTop, flash };
    tab = 'all'; query = ''; dv = 'all'; typeF = 'all'; staffF = 'all'; sort = { key: 'when', dir: -1 }; day = null; menu = null; picking = null; pop = null; closedOpen = false; flash = new Map(); scrollTop = 0;
    lookOverride = { view: v, rows };
    try {
      let vv = view(); const sample = !vv.all.length;
      if (sample) { const now = Date.now(); sampleRows = sampleOrders(now).map(o => infoOf(o, false, now)); vv = view(); }
      const kind = viewKind();
      const node = el('div', { class: 'or-root' }, topBar(vv), el('div', { class: 'or-rest' }, filterBar(vv), kind === 'split' ? splitView(vv) : kind === 'cards' ? cardsView(vv) : kind === 'board' ? boardView(vv) : list(vv)));
      for (const n of node.querySelectorAll('[id]')) n.removeAttribute('id');
      return { node, sample };
    } finally {
      lookOverride = null; sampleRows = null;
      ({ tab, query, dv, typeF, staffF, sort, day, menu, picking, pop, chosen, closedOpen, listEl, scrollTop, flash } = keep);
    }
  }

  window.RestroOrders = Object.freeze({
    preview,
    // open() from the home screen (or Back from an order opened here: the filters as they were); open({ from: 'counter' })
    // from Counter's Orders button; open({ from: 'counter', view: 'held' }) from Counter's Held button; open({ find: id })
    // for one order (a pager tapped on the NFC spot: its order number searched, on its day).
    open(options = {}) {
      const back = returning && !options.from && !options.view && !options.find;
      returning = false;
      document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      if (!back) { resetFilters(); fromCounter = options.from === 'counter'; tab = options.view === 'held' ? 'held' : 'all'; }
      const found = options.find ? (window.RestroCounter?.orders?.() || []).find(o => (o.uid || `n${o.number}`) === options.find) : null;
      if (found) { query = ticket(found.number); const d = dayOfOrder(found); day = d === todayKey() ? null : d; }
      dialog.dataset.view = fromCounter && tab === 'held' ? 'held' : 'orders'; // (Recents counts Held as Counter's)
      watchPaper(); render();
      if (!dialog.open) dialog.showModal();
      clearInterval(timer); timer = setInterval(() => { if (dialog.open && !menu && !pop && Date.now() - scrolledAt > 2000) renderRest(); }, 30000);
      dialog.querySelector('#orders-title')?.focus({ preventScroll: true });
    },
    // An order's status as this page shows it ({ text: 'Open' or 'Closed', cls, sub, subCls }), for the home screen
    status: o => { const s = statusOf(o); return { text: s.text, cls: s.cls.split(' ')[0], sub: s.base, subCls: s.subCls === 'rd' ? 'ready' : s.subCls === 'sch' ? 'scheduled' : s.base ? 'kitchen' : undefined }; },
    goBack
  });
})();
