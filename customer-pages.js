'use strict';
// The customer's pages around the menu (Update Pack 7, C to E), in the restaurant's template: the dish page, the Menu
// list, search, the cart ("Your order"), checkout, the payment step, Order placed and "Payment didn't go through".
// RestroCustomerPages.mount(host, options) draws them on RestroCustomerMenu's page; the QR link's page (404.html) uses
// it. Looks are in customer-pages.css, on the template's own colours and fonts (customer-menu.css).
// - options: { template, accent, logo, restaurant, kind ('table' | 'takeaway' | 'menu' | 'event' | 'event-table'),
//   place (the pill's words: 'Table 7', 'Takeaway', 'Menu', 'Event', 'Event table 3'), event (the event's name, for
//   an event's QRs), categories (as RestroCustomerMenu.page: [{ id, name, items: [{ id, name, desc, about, price, veg,
//   photo, out, gst }] }]; about: the dish page's longer words; gst: an event-only dish's own GST rate, 0.18), taxRate
//   (0.05: CGST and SGST half each, D4), kds (true: the restaurant has a kitchen display, so Order placed shows the
//   order's status: E1), history (true: the phone's Back closes what is open), full (true: fills the screen), hint
//   (true: the Help bell's hint on a phone's first visit, C5), cart ({ ‹dish id›: quantity } to start with), status
//   (true: a phone's status bar on the menu, for a preview), code (the QR's own code) }
// - Captain mode (Update Pack 7, J): options.captain, the captain's name, on a Table QR, an event table's or a whole
//   event's, opened in the Captain app (ANDROID-BRIDGE.md, RESTROCaptain): the bar "Captain mode · ‹first name› ·
//   Table 7 · no payment" on every page, no Help bell, "+ Note" under each dish in the cart, Send to kitchen instead of
//   checkout (no payment), Sent to the kitchen. It works while QR ordering is paused or closed (staff orders, J4).
//   onRound(round) sends a round to the restaurant: { code, kind, captain, guests, lines: [{ id, qty, note }],
//   customer, how } and resolves { ok, uid, number, round, by, server, guests, due } or { ok: false, why, dishes }
//   (RestroCounter.captainRound on the POS); onPrintBill({ code, uid }) prints the table's bill there and resolves
//   { ok }; onTables() goes back to the Captain app's tables.
// - Until the cloud takes orders and a payment provider is connected (D2, SYNC.md), nothing leaves the phone: Pay shows
//   a plain payment step that takes no money, and the restaurant doesn't get the order (owner, 18 Nov 2026: "now no
//   order comes in, and for now only for testing").
(() => {
  const CM = () => window.RestroCustomerMenu;
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: '<path d="m14.5 6-6 6 6 6"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    check: '<path d="m5.5 12.4 4.2 4.2 8.8-8.9"/>',
    cross: '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.3 15.3 4.7 4.7"/>',
    bell: '<path d="M6.5 11a5.5 5.5 0 0 1 11 0v4.4l1.3 1.85H5.2l1.3-1.85z"/><path d="M9.6 19.3a2.4 2.4 0 0 0 4.8 0"/>',
    receipt: '<path d="M6.5 3.5h11v17l-2.75-1.6-2.75 1.6-2.75-1.6-2.75 1.6z"/><path d="M9.5 8.5h5M9.5 12h5"/>',
    bag: '<path d="M5.8 8.5h12.4l-.9 11.2a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9z"/><path d="M9.2 10.5V7.2a2.8 2.8 0 0 1 5.6 0v3.3"/>',
    // (the Help bell's sheet, receipts and the messages: Update Pack 7, G, H)
    waiter: '<circle cx="12" cy="8.3" r="3.5"/><path d="M5.7 19.6a6.3 6.3 0 0 1 12.6 0"/>',
    water: '<path d="M7 4.5h10l-1.4 14.9a1.2 1.2 0 0 1-1.2 1.1H9.6a1.2 1.2 0 0 1-1.2-1.1z"/><path d="M7.5 9.6h9"/>',
    cancel: '<circle cx="12" cy="12" r="8.3"/><path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4"/>',
    chat: '<path d="M5.2 5.3h13.6a1.2 1.2 0 0 1 1.2 1.2v9a1.2 1.2 0 0 1-1.2 1.2H10.5L6.4 20v-3.3H5.2A1.2 1.2 0 0 1 4 15.5v-9a1.2 1.2 0 0 1 1.2-1.2z"/><path d="M8.6 11h.1M12 11h.1M15.4 11h.1"/>',
    arrow: '<path d="M19 12H5.5M11 6.2 5.2 12l5.8 5.8"/>',
    photo: '<rect x="4" y="5" width="16" height="14" rx="2.2"/><circle cx="9.2" cy="10" r="1.6"/><path d="m4.6 17.2 4.6-4.4 3.4 3.2 2.4-2.2 4.4 4"/>',
    mail: '<rect x="3.6" y="5.8" width="16.8" height="12.6" rx="2"/><path d="m4.4 7.2 7.6 6 7.6-6"/>',
    pause: '<rect x="6.4" y="5.1" width="3.5" height="13.8" rx="1.6"/><rect x="14.1" y="5.1" width="3.5" height="13.8" rx="1.6"/>',
    moon: '<path d="M19 14.6A7.4 7.4 0 0 1 9.4 5a7.4 7.4 0 1 0 9.6 9.6z"/>',
    clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3 1.9"/>',
    // (a QR that no longer works: three of its corner squares, struck through)
    qroff: '<rect x="4.6" y="4.6" width="5.6" height="5.6" rx="1.1"/><rect x="13.8" y="4.6" width="5.6" height="5.6" rx="1.1"/><rect x="4.6" y="13.8" width="5.6" height="5.6" rx="1.1"/><path d="m3.6 3.6 16.8 16.8"/>',
    // (a dish's note in captain mode, J3)
    pencil: '<path d="M5.2 18.8l.9-4 9.5-9.5a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-9.5 9.5z"/><path d="m14.2 6.7 3.1 3.1"/>',
    calendar: '<rect x="3.6" y="5.6" width="16.8" height="14.4" rx="2.2"/><path d="M3.6 10.2h16.8M8.5 3.6v3.8M15.5 3.6v3.8M9 15h6"/>'
  };
  function icon(name) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `ci ci-${name}`); s.innerHTML = ICONS[name]; return s;
  }
  // ---------- money, in paise (D4): CGST and SGST each to the paisa, then the total to the nearest rupee ----------
  const fmt = (p, paise) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`;
  const tax = rate => `${+(rate * 50).toFixed(2)}%`;
  // (GST per rate: the restaurant's, or an event-only dish's own, as dish.gst. Mixed rates: CGST and SGST for each,
  // D4; half the rate each, rounded half up to the paisa, as bill.js)
  function bill(lines, rate) {
    const items = lines.reduce((s, l) => s + l.q, 0), byRate = new Map();
    for (const l of lines) { const r = Number.isFinite(l.d.gst) ? l.d.gst : rate; byRate.set(r, (byRate.get(r) || 0) + Math.round(l.d.price * 100) * l.q); }
    const taxes = [...byRate].filter(([r]) => r > 0).sort((a, b) => a[0] - b[0])
      .map(([r, base]) => { const h = Math.round(r * 10000 / 2); return { rate: r, half: Math.floor((2 * base * h + 10000) / 20000) }; });
    const itemTotal = [...byRate.values()].reduce((s, v) => s + v, 0), sum = itemTotal + taxes.reduce((s, x) => s + x.half * 2, 0);
    const toPay = Math.floor((sum + 50) / 100) * 100;
    return { items, itemTotal, taxes, roundOff: toPay - sum, toPay };
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const clock = d => `${(d.getHours() % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "Fri 13 Nov"; "today", "tomorrow" or the weekday ("Wednesday") for an opening time (G)
  const dayDate = t => { const d = new Date(t); return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const dayWord = t => {
    const d = new Date(t), now = new Date(), days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? WEEKDAYS[d.getDay()] : `on ${dayDate(t)}`;
  };
  // A mobile number as it shows: "9xxxx xxxxx" (D3: India only, 10 digits from 6, 7, 8 or 9)
  const digits = v => String(v || '').replace(/\D/g, '').slice(0, 10);
  const pretty = v => { const d = digits(v); return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };
  const validPhone = v => /^[6-9]\d{9}$/.test(digits(v));
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return v; };

  function mount(host, opts) {
    let o, kind, view, dineIn, restaurant, cats, dishes, t, paused, blocked, captain;
    // (the options; again on update: the menu, sold out and the design as the restaurant changes them; paused or a
    // message instead of the menu, G)
    const setOptions = next => {
      o = { kind: 'table', taxRate: 0.05, kds: false, eventMode: 'both', ...next };
      kind = o.kind; view = kind === 'menu'; dineIn = kind === 'table' || kind === 'event-table';
      // (captain mode on a table's QR, an event table's or a whole event's, J2: the captain's first name. Staff orders:
      // not paused, closed or turned off with QR ordering, J4; a QR that no longer works or an event not on still stops)
      captain = o.captain && (dineIn || kind === 'event') ? String(o.captain).trim().split(/\s+/)[0].slice(0, 30) || null : null;
      paused = !view && !captain && o.state?.paused === true; blocked = (captain ? ['dead', 'upcoming', 'ended'] : ['dead', 'closed', 'upcoming', 'ended']).includes(o.state?.page) ? o.state : null;
      restaurant = String(o.restaurant || '').toLocaleUpperCase('en-IN');
      cats = (o.categories || []).filter(c => c.items?.length); dishes = new Map(cats.flatMap(c => c.items.map(d => [d.id, { ...d, cat: c.name }])));
      t = CM().templates.find(x => x.id === o.template) || CM().templates[0];
    };
    setOptions(opts);
    // (a whole event's QR: Dine-in or Takeaway, D3; one that only takes takeaway orders asks nothing)
    // (captain mode: each dish's note, { picks, text }, and the guests, J3)
    const s = { cart: new Map(), note: '', name: '', phone: '', how: o.kind === 'event' && o.eventMode === 'takeaway' ? 'Takeaway' : null, touched: {}, order: null, notes: new Map(), guests: 0, sending: false };
    let root, layers = [];
    const cartObj = () => Object.fromEntries(s.cart);
    const lines = () => [...s.cart].map(([id, q]) => ({ d: dishes.get(id), q })).filter(l => l.d && l.q > 0);
    // (a takeaway or event customer: their name with their phone, D3)
    const who = () => (s.name && s.phone ? `${s.name} · +91 ${pretty(s.phone)}` : '');

    // ---------- the layers over the menu: sheets, the Menu list, pages, the sending veil ----------
    // (a stack; with options.history one history entry stands for "something is open", so the phone's Back closes the
    // top layer, or does what its ‹ does: layer._back)
    let armed = false;
    const arm = () => { if (o.history && !armed && layers.length) { history.pushState({ cp: 1 }, ''); armed = true; } };
    const disarm = () => { if (armed && !layers.length) { armed = false; history.back(); } };
    function open(layer, focus) {
      root.append(layer); layers.push(layer); arm();
      requestAnimationFrame(() => { layer.classList.add('in'); focus?.focus({ preventScroll: true }); });
      if (layer.querySelector('.cm-name')) CM().fit(layer);
      return layer;
    }
    function drop(layer) { layers = layers.filter(x => x !== layer); layer.remove(); }
    // (closes one layer, the top one by default)
    function close(layer = layers[layers.length - 1]) { if (!layer) return; drop(layer); disarm(); }
    // (closes everything; next: the page that opens straight after, which keeps the history entry)
    function closeAll(next) { while (layers.length) drop(layers[layers.length - 1]); if (!next) disarm(); }
    const onPop = () => {
      armed = false; const top = layers[layers.length - 1];
      if (top && !top.classList.contains('cp-veil')) { if (top._back) top._back(); else drop(top); }
      arm();
    };
    if (o.history) addEventListener('popstate', onPop);

    const sheet = (cls, ...kids) => {
      const box = el('div', { class: `cp-sheet ${cls}`, role: 'dialog', 'aria-modal': 'true' }, el('span', { class: 'cp-grab', 'aria-hidden': 'true' }), kids);
      // (the Help bell's and the receipt's sheets dim the page behind less: H)
      const layer = el('div', { class: `cp-layer cp-dim${cls.startsWith('cp-help') ? ' cp-hdim' : ''}`, onclick: e => { if (e.target === e.currentTarget) close(layer); } }, box);
      return layer;
    };
    const pageLayer = (cls, ...kids) => el('div', { class: `cp-layer cp-page ${cls}` }, kids);
    const head = title => el('header', { class: 'cp-head' }, el('button', { type: 'button', class: 'cp-back', 'aria-label': 'Back', onclick: () => close() }, icon('back')), el('h2', { class: 'cp-title' }, title));
    const button = (cls, text, onclick, disabled) => el('button', { type: 'button', class: `cp-btn ${cls}`, onclick, disabled }, text);
    // (a section's small heading: "Your order · 5 items"; "Note for the kitchen" with "· optional" lighter)
    const label = (text, light) => el('p', { class: 'cp-label' }, el('span', {}, text), light ? el('small', {}, ` · ${light}`) : null);
    const price = p => el('b', { class: 'cp-amt' }, fmt(p));
    const mark = d => el('i', { class: `cm-mk${d.veg === false ? ' nv' : ''}`, 'aria-label': d.veg === false ? 'Non-veg' : 'Veg' });
    const photo = (d, cls) => (t.photos ? (d.photo ? el('span', { class: `cp-ph ${cls}`, style: `background-image:url("${String(d.photo).replace(/"/g, '%22')}")` }) : el('span', { class: `cp-ph none ${cls}` }, CM().icon('dish'))) : null);

    // ---------- the menu ----------
    // (ordering is on: not the Menu QR, not paused, not a closed QR's menu: G)
    let seeMenu = false;
    const canOrder = () => !view && !paused && !blocked;
    const setCart = () => { CM().setCart(root, cartObj()); dueBar(); noteChips(); };
    function add(id, q = 1) {
      const d = dishes.get(id); if (!d || d.out || !canOrder()) return;
      const n = Math.max(0, (s.cart.get(id) || 0) + q); if (n) s.cart.set(id, n); else { s.cart.delete(id); s.notes.delete(id); }
      setCart(); for (const l of layers) l._refresh?.();
    }

    // ---------- the dish page (C1; the Menu QR's: "To order, please ask our staff.", C6) ----------
    // (a dish already in the cart opens at its quantity: Update, or Remove at 0. A sold-out dish as in the list, C4: its
    // photo grey and "Sold out" where Add goes; it can't be added)
    function dishSheet(id) {
      const d = dishes.get(id); if (!d) return;
      const had = s.cart.get(id) || 0, each = Math.round(d.price * 100); let q = had || 1;
      const qty = el('b', { class: 'cp-q' }, String(q)), go = el('button', { type: 'button', class: 'cp-btn cp-go' });
      // (down to 1 for a dish not in the cart yet, as drawn; to 0 for one in it: Remove)
      const minus = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One less', onclick: () => { q = Math.max(had ? 0 : 1, q - 1); show(); } }, icon('minus'));
      const plus = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One more', onclick: () => { q = Math.min(99, q + 1); show(); } }, icon('plus'));
      const show = () => { qty.textContent = String(q); go.textContent = !q ? 'Remove' : `${had ? 'Update' : 'Add'} · ${fmt(q * each)}`; };
      show();
      const foot = !canOrder() ? el('p', { class: 'cp-ask' }, 'To order, please ask our staff.')
        : d.out ? el('p', { class: 'cp-sold' }, 'Sold out') : el('div', { class: 'cp-dfoot' }, el('div', { class: 'cp-stepper' }, minus, qty, plus), go);
      const layer = sheet(`cp-dish${d.out ? ' out' : ''}`, photo(d, 'big'), el('h3', { class: 'cp-dname' }, mark(d), el('span', {}, d.name)), d.about || d.desc ? el('p', { class: 'cp-dabout' }, d.about || d.desc) : null, foot);
      go.addEventListener('click', () => { close(layer); add(id, q - had); });
      open(layer);
    }

    // ---------- the Menu list: categories and how many dishes (C1) ----------
    function menuList() {
      const layer = el('div', { class: 'cp-layer cp-pop', onclick: e => { if (e.target === e.currentTarget) close(layer); } },
        el('div', { class: 'cp-mlist', role: 'menu' }, el('p', { class: 'cp-mlabel' }, 'Menu'),
          cats.map(c => el('button', { type: 'button', class: 'cp-mrow', role: 'menuitem', onclick: () => { close(layer); CM().goTo(root, c.id); } }, el('span', {}, c.name), el('small', {}, String(c.items.length))))));
      open(layer);
    }

    // ---------- search: dish names and descriptions in every category (C2) ----------
    function search() {
      const input = el('input', { class: 'cp-sinput', type: 'search', placeholder: 'Search dishes', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search dishes' });
      const clear = el('button', { type: 'button', class: 'cp-sclear', 'aria-label': 'Clear', onclick: () => { input.value = ''; draw(); input.focus(); } }, icon('close'));
      const list = el('div', { class: 'cp-results' });
      const draw = () => {
        const q = input.value.trim().toLocaleLowerCase('en-IN'); clear.hidden = !q;
        const found = q ? [...dishes.values()].filter(d => `${d.name} ${d.desc || ''} ${d.about || ''}`.toLocaleLowerCase('en-IN').includes(q)) : [];
        list.replaceChildren(...[
          q ? label(plural(found.length, 'dish', 'dishes')) : null,
          ...found.map(d => {
            const n = s.cart.get(d.id) || 0;
            // (sold out: its tag, on every QR, C4; no + Add where ordering is off: the Menu QR, paused, closed)
            const btn = d.out ? el('span', { class: 'cm-add out' }, el('span', { class: 'cm-add-t' }, 'Sold out')) : !canOrder() ? null
              : el('button', { type: 'button', class: `cp-sadd${n ? ' on' : ''}`, onclick: e => { e.stopPropagation(); if (n) dishSheet(d.id); else add(d.id); } }, n ? ['Added', icon('check')] : ['+ Add']);
            return el('div', { class: `cp-srow${d.out ? ' out' : ''}`, onclick: () => dishSheet(d.id) }, photo(d, 'small'),
              el('div', { class: 'cp-stext' }, el('p', { class: 'cp-sname' }, mark(d), el('b', {}, d.name)), el('p', { class: 'cp-ssub' }, `${d.cat} · ${fmt(Math.round(d.price * 100))}`)), btn);
          }),
          el('p', { class: 'cp-hint' }, 'Searches dish names and descriptions in every category.')].filter(Boolean));
      };
      input.addEventListener('input', draw);
      const layer = pageLayer('cp-search', el('header', { class: 'cp-head' }, el('button', { type: 'button', class: 'cp-back', 'aria-label': 'Back', onclick: () => close(layer) }, icon('back')),
        el('label', { class: 'cp-sfield' }, icon('search'), input, clear)), el('div', { class: 'cp-scroll' }, list));
      layer._refresh = draw; draw();
      open(layer, input);
    }

    // ---------- the cart: "Your order · Table 7" (C1, D1) ----------
    const where = () => (kind === 'takeaway' ? 'Takeaway' : kind === 'event' ? 'Event' : o.place || 'Table');
    function totals(b, payLine, last = 'To pay', first = 'Item total') {
      const paise = b.roundOff !== 0;
      return el('div', { class: 'cp-totals' },
        el('p', {}, el('span', {}, first), el('span', {}, fmt(b.itemTotal, paise))),
        b.taxes.map(x => ['CGST', 'SGST'].map(n => el('p', {}, el('span', {}, `${n} ${tax(x.rate)}`), el('span', {}, fmt(x.half, true))))),
        b.roundOff ? el('p', {}, el('span', {}, 'Round off'), el('span', {}, `${b.roundOff > 0 ? '+' : '−'} ${fmt(Math.abs(b.roundOff), true)}`)) : null,
        payLine ? el('p', { class: 'cp-topay' }, el('span', {}, last), el('span', {}, fmt(b.toPay))) : null);
    }
    function cartSheet() {
      const body = el('div', { class: 'cp-cbody' });
      const layer = sheet('cp-cart', body);
      const draw = () => {
        const ls = lines(); if (!ls.length) { close(layer); return; }
        const b = bill(ls, o.taxRate);
        body.replaceChildren(el('h3', { class: 'cp-ctitle' }, `Your order · ${where()}`),
          el('div', { class: 'cp-rows' }, ls.map(({ d, q }) => el('div', { class: 'cp-row cp-crow', onclick: () => dishSheet(d.id) }, photo(d, 'row'),
            el('div', { class: 'cp-ctext' }, el('p', { class: 'cp-rname' }, el('span', {}, d.name)), el('p', { class: 'cp-each' }, `${fmt(Math.round(d.price * 100))} each`)),
            el('span', { class: 'cp-x' }, `× ${q}`), price(Math.round(d.price * 100) * q)))),
          totals(b, true),
          button('cp-go', `Place order and pay · ${fmt(b.toPay)}`, () => { drop(layer); checkout(); }));
      };
      layer._refresh = draw; draw();
      open(layer);
    }

    // ---------- checkout (D3) ----------
    function checkout() {
      const ev = o.event || 'Event';
      const card = kind === 'takeaway' ? ['Takeaway', 'Collect at the counter', 'Show your order number there', 'Takeaway']
        : kind === 'event' ? [ev, 'Event order', 'No tables · collect at the counter', 'Event']
          : kind === 'event-table' ? [ev, `${o.place || 'Event table'} · Dine-in`, 'Set by the QR you scanned', o.place || 'Event table']
            : ['Your table', `${o.place || 'Table'} · Dine-in`, 'Set by the QR you scanned', o.place || 'Table'];
      // (Takeaway and the whole-event QR: the name and a valid mobile number, both needed; the event: Dine-in or
      // Takeaway too. Pay stays greyed until then)
      const needs = kind === 'takeaway' || kind === 'event';
      const field = (text, input, after) => el('div', { class: 'cp-field' }, label(text), input, after);
      const name = el('input', { class: 'cp-input', type: 'text', autocomplete: 'name', autocapitalize: 'words', maxlength: '40', placeholder: 'So we can call you', value: s.name });
      const phoneIn = el('input', { class: 'cp-pin', type: 'tel', inputmode: 'numeric', autocomplete: 'tel-national', maxlength: '11', placeholder: 'So we can reach you about your order', value: pretty(s.phone) });
      const phoneBox = el('label', { class: 'cp-phone' }, el('span', { class: 'cp-cc' }, '+91'), phoneIn);
      const phoneErr = el('p', { class: 'cp-err', hidden: true }, 'Enter a valid 10-digit mobile number');
      const note = el('input', { class: 'cp-input cp-note', type: 'text', maxlength: '120', placeholder: needs ? 'e.g. less spicy, extra chutney' : 'e.g. less spicy, no onion', value: s.note });
      const pay = el('button', { type: 'button', class: 'cp-btn cp-go' }), why = el('p', { class: 'cp-why' });
      const hows = kind === 'event' && o.eventMode !== 'takeaway' ? ['Dine-in', 'Takeaway'].map(h => el('button', { type: 'button', class: 'cp-how', 'data-how': h, 'aria-pressed': String(s.how === h), onclick: () => { s.how = h; for (const x of hows) x.setAttribute('aria-pressed', String(x.dataset.how === h)); check(); } },
        el('b', {}, h), el('small', {}, h === 'Dine-in' ? 'On a plate, eat here' : 'Packed to go'))) : [];
      const listBox = el('div', {}), totalBox = el('div', {});
      let bl = null;
      const check = () => {
        s.name = name.value.trim(); s.phone = digits(phoneIn.value); s.note = note.value.trim();
        const ok = !needs || Boolean(s.name && validPhone(s.phone) && (kind !== 'event' || s.how));
        phoneErr.hidden = !(s.touched.phone && s.phone && !validPhone(s.phone));
        phoneBox.classList.toggle('bad', !phoneErr.hidden); phoneBox.classList.toggle('on', Boolean(s.phone));
        for (const i of [name, note]) i.classList.toggle('on', Boolean(i.value.trim()));
        pay.disabled = !ok;
        why.textContent = ok ? 'Paid orders go straight to the kitchen.' : kind === 'event' ? 'Choose Dine-in or Takeaway, and add your name and a valid mobile number' : 'Add your name and a valid mobile number to continue';
      };
      const draw = () => {
        const ls = lines(); if (!ls.length) { close(layer); return; }
        bl = bill(ls, o.taxRate);
        listBox.replaceChildren(label(`Your order · ${plural(bl.items, 'item', 'items')}`), orderRows(ls));
        totalBox.replaceChildren(totals(bl, true));
        pay.textContent = `Pay ${fmt(bl.toPay)}`;
      };
      pay.addEventListener('click', () => { if (!pay.disabled && bl) send(bl); });
      phoneIn.addEventListener('input', () => { const end = phoneIn.selectionStart === phoneIn.value.length; phoneIn.value = pretty(phoneIn.value); if (end) phoneIn.setSelectionRange(phoneIn.value.length, phoneIn.value.length); check(); });
      phoneIn.addEventListener('blur', () => { s.touched.phone = true; check(); });
      for (const i of [name, note]) i.addEventListener('input', check);
      const layer = pageLayer('cp-checkout', head('Checkout'), el('div', { class: 'cp-scroll' },
        el('div', { class: 'cp-card' }, el('div', { class: 'cp-ctxt' }, el('p', { class: 'cp-clabel' }, card[0]), el('p', { class: 'cp-ctitle2' }, card[1]), el('p', { class: 'cp-csub' }, card[2])),
          el('span', { class: 'cp-pill' }, kind === 'takeaway' ? icon('bag') : null, card[3])),
        hows.length ? field('How do you want it?', el('div', { class: 'cp-hows' }, hows)) : null,
        needs ? field('Your name', name) : null,
        needs ? field('Phone', phoneBox, phoneErr) : null,
        listBox, el('div', { class: 'cp-field' }, label('Note for the kitchen', 'optional'), note), totalBox),
      el('footer', { class: 'cp-foot' }, pay, why));
      layer._refresh = draw; draw(); check();
      open(layer);
    }
    function orderRows(ls, gone = []) {
      return el('div', { class: 'cp-rows' }, ls.map(({ d, q }) => el('div', { class: `cp-row${gone.some(g => g.d.id === d.id) ? ' gone' : ''}` },
        photo(d, 'row'), el('p', { class: 'cp-rname' }, mark(d), el('span', {}, d.name)), el('span', { class: 'cp-x' }, `× ${q}`), price(Math.round(d.price * 100) * q))));
    }

    // ---------- sending the order, then the payment step (D5, D2) ----------
    function send(b) {
      b = { ...b, lines: lines() };
      const veil = el('div', { class: 'cp-layer cp-veil', role: 'status', 'aria-live': 'polite' });
      const say = (sign, title) => veil.replaceChildren(el('div', { class: 'cp-vbox' }, sign, el('p', { class: 'cp-vtitle' }, title), el('p', { class: 'cp-vsub' }, 'Your payment opens next.')));
      say(el('span', { class: 'cp-spin', 'aria-hidden': 'true' }), `Sending your order to ${restaurant}…`);
      open(veil);
      setTimeout(() => say(el('span', { class: 'cp-okdot' }, icon('check')), `Order received by ${restaurant}`), 1400);
      setTimeout(() => { drop(veil); payStep(b); }, 2600);
    }
    // (the payment provider's own page goes here once one is connected: UPI and cards only, D2. Until then this plain
    // step takes no money; Cancel, or the phone's Back, is a cancelled payment: E3)
    function payStep(b) {
      s.last = b;
      const cancel = () => { closeAll(true); if (b.billFor) billPage(); else failed(b); }, paid = method => { closeAll(true); if (b.billFor) billPaid(b, method); else placed(b, method); };
      const layer = el('div', { class: 'cp-layer cp-page cp-pay' },
        el('header', { class: 'cp-phead' }, el('button', { type: 'button', class: 'cp-pback', 'aria-label': 'Cancel', onclick: cancel }, icon('back')), el('b', {}, 'Payment')),
        el('div', { class: 'cp-pbody' },
          // (whose order: a takeaway or event customer's name with their phone, D3, as the phone videos)
          el('div', { class: 'cp-pcard' }, el('div', {}, el('b', {}, restaurant), el('small', {}, b.billFor ? `${o.place || where()} bill` : kind === 'takeaway' ? `Takeaway · ${who()}` : kind === 'event' ? `${o.event || 'Event'} · ${who()}` : `Order for ${o.place || 'your table'}`)), el('strong', {}, fmt(b.toPay))),
          el('p', { class: 'cp-pnote' }, 'Payments aren’t switched on yet. No money is taken, and the restaurant doesn’t get this order.'),
          el('button', { type: 'button', class: 'cp-pbtn', onclick: () => paid('UPI') }, `Pay by UPI · ${fmt(b.toPay)}`),
          el('button', { type: 'button', class: 'cp-pbtn', onclick: () => paid('Card') }, `Pay by card · ${fmt(b.toPay)}`),
          el('button', { type: 'button', class: 'cp-pbtn ghost', onclick: cancel }, 'Cancel')));
      layer._back = cancel;
      open(layer);
    }

    // ---------- Order placed (E1, E2) and "Payment didn't go through" (E3) ----------
    const band = (pill = true) => el('header', { class: 'cp-band', style: o.logo ? `background-image:url("${String(o.logo).replace(/"/g, '%22')}")` : null },
      el('div', { class: 'cm-hrow' }, el('h1', { class: 'cm-name' }, restaurant), pill ? el('span', { class: 'cm-pill' }, o.place || where()) : null));
    const bellButton = () => el('button', { type: 'button', class: 'cp-round', 'aria-label': 'Help', onclick: helpSheet }, icon('bell'));
    const nextNumber = () => { const n = (Number(store('restro.cp.lastOrder')) || 1000) + 1; store('restro.cp.lastOrder', n); return n; };
    // (this phone's order as the restaurant keeps an order (restro.counter.orders.v1; receipt.js), for its receipt (H2): the
    // order and bill numbers the restaurant gives it once the cloud is connected (SYNC.md), until then this phone's own
    // order number and none for the bill; a QR order, so "QR order" where the server goes; paid in full, with what sold
    // out as the customer paid refunded (E4): the order is for the rest, and the refund is what was paid less that)
    function phoneOrder(kept, gone, b, method, at, number) {
      const type = kind === 'takeaway' ? 'takeaway' : kind === 'event' || kind === 'event-table' ? 'event' : 'dine-in', pay = method === 'Card' ? 'card' : 'upi', t = at.getTime();
      const sums = window.RestroBill.order({ lines: kept.map(l => ({ each: Math.round(l.d.price * 100), qty: l.q, rate: Number.isFinite(l.d.gst) ? l.d.gst : undefined })), type }, o.taxRate);
      return { uid: null, number, billNo: null, type, qr: true, server: '', guests: 0, createdAt: t, table: kind === 'table' ? String(o.table || '') : '',
        ...(type === 'event' ? { event: { name: o.event || 'Event', ...(kind === 'event-table' ? { table: String(o.eventTable || '') } : {}), mode: s.how === 'Takeaway' ? 'takeaway' : 'dine-in' } } : {}),
        customer: !dineIn && s.name && validPhone(s.phone) ? { name: s.name, mobile: digits(s.phone), code: '91' } : null,
        lines: kept.map(l => ({ id: l.d.id, name: l.d.name, price: l.d.price, qty: l.q, ...(Number.isFinite(l.d.gst) ? { ev: { gst: Math.round(l.d.gst * 10000) / 100 } } : {}) })),
        ...sums, paidAt: t, method: pay, payments: [{ method: pay, amount: b.toPay, at: t, ref: '' }],
        refunds: gone.length ? [{ method: pay, amount: b.toPay - sums.total, at: t, lines: gone.map(l => ({ name: l.d.name, qty: l.q })) }] : [] };
    }
    function placed(b, method) {
      const ls = b.lines || lines(), at = new Date(), number = nextNumber();
      // (E4: a dish that sold out while the customer paid is refunded by itself, its amount with GST; the rest goes on)
      const gone = ls.filter(l => dishes.get(l.d.id)?.out), back = gone.length ? bill(gone, o.taxRate) : null;
      const rec = phoneOrder(ls.filter(l => !gone.includes(l)), gone, b, method, at, number), refund = rec.refunds[0]?.amount || 0;
      const sub = (kind === 'takeaway' ? `${who()} · Paid ${fmt(b.toPay)}`
        : kind === 'event' ? `${who()} · ${o.event || 'Event'} · ${s.how || 'Dine-in'}`
          : kind === 'event-table' ? `Order #${number} · ${o.event || 'Event'} · Paid ${fmt(b.toPay)}`
            : `Order #${number} · Paid ${fmt(b.toPay)}${refund ? '' : ` · ${method}`}`) + (refund ? ` · Refund ${fmt(refund)}` : '');
      const order = { at: at.getTime(), number, uid: null, method, paid: b.toPay, refund, who: who(), rec };
      keepMine(ORD_KEY, [...mineOf(ORD_KEY), order]);
      // (the order's status only with a kitchen display: E1)
      const steps = o.kds ? el('div', { class: 'cp-status' }, label('Status'), [['Sent to the kitchen', clock(at)], ['Cooking', null], [dineIn ? 'Ready · we bring it to your table' : 'Ready · collect at the counter', null]]
        // (the steps reached so far, the latest bold: just sent, "Sent to the kitchen"; the kitchen display moves it on)
        .map(([text, time], i, all) => { const now = all.filter(x => x[1]).length - 1; return el('div', { class: `cp-sstep${i < now ? ' done' : i === now ? ' now' : ''}` }, el('i', {}), el('p', {}, el('span', {}, text), time ? el('small', {}, time) : null)); })) : null;
      const more = () => { s.cart.clear(); s.note = ''; setCart(); closeAll(); };
      const layer = pageLayer('cp-done', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-okdot big' }, icon('check')), el('div', {}, el('h2', { class: 'cp-htitle' }, 'Order placed'), el('p', { class: 'cp-hsub' }, sub))),
        gone.length ? el('div', { class: 'cp-refund' }, el('p', { class: 'cp-rtitle' }, `${gone.map(l => l.d.name).join(', ')} sold out as you paid`),
          el('p', {}, `${fmt(refund)} (${fmt(back.itemTotal)} + GST) is refunded to your ${method === 'Card' ? 'card' : 'UPI'} by itself. It usually shows in 3–5 days. The rest of your order is on its way.`)) : null,
        !dineIn ? el('div', { class: 'cp-number big' }, el('div', {}, el('p', { class: 'cp-clabel' }, 'Your order number'), el('p', { class: 'cp-csub' }, 'Show this at the counter')), el('b', {}, `#${number}`)) : null,
        steps, label('Your order'), orderRows(ls, gone), s.note ? el('p', { class: 'cp-noteline' }, `Note for the kitchen: “${s.note}”`) : null),
      el('footer', { class: 'cp-bar' }, dineIn ? bellButton() : el('button', { type: 'button', class: 'cp-receipt', onclick: () => receiptSheet(order) }, icon('receipt'), 'Receipt'),
        button('cp-more', 'Order more', more)));
      // (a request a captain took: "‹first name› is on the way", H1)
      const draw = () => { layer.querySelector(':scope > .cp-onway')?.remove(); const r = dineIn ? takenNow() : null; if (r) layer.append(onTheWay(r)); };
      layer._refresh = draw; draw();
      layer._back = more;
      open(layer);
    }
    function failed(b) {
      const ls = b.lines || lines();
      const layer = pageLayer('cp-fail', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-xdot' }, icon('cross')), el('div', {}, el('h2', { class: 'cp-htitle' }, 'Payment didn’t go through'), el('p', { class: 'cp-hsub' }, 'This order isn’t paid yet.'))),
        el('div', { class: 'cp-box' }, el('p', { class: 'cp-clabel' }, 'What happened'), el('p', {}, 'The payment was cancelled or your bank declined it. If money left your account, your bank sends it back by itself.')),
        el('div', { class: 'cp-box' }, el('p', { class: 'cp-clabel' }, 'Your order is saved'), el('p', {}, `${plural(b.items, 'item', 'items')} · ${fmt(b.toPay)}. We keep it for 15 minutes; it goes to the kitchen as soon as it’s paid.`)),
        label('Your order'), orderRows(ls)),
      el('footer', { class: 'cp-foot two' }, button('cp-go', `Try again · ${fmt(b.toPay)}`, () => { closeAll(true); payStep(b); }), button('cp-ghost', 'Back to cart', () => { closeAll(true); cartSheet(); })));
      layer._back = () => closeAll();
      open(layer);
    }

    // ---------- what this phone keeps of its own, for a day: its help requests, its paid orders, a table's bill paid
    // here (never the restaurant's data; nothing leaves the phone until the cloud: SYNC.md) ----------
    const REQ_KEY = 'restro.cp.requests.v1', ORD_KEY = 'restro.cp.orders.v1', BILLS_KEY = 'restro.cp.billsPaid.v1', DAY = 86400000;
    const qrKey = () => o.key || `${kind}:${o.place || ''}`;
    const mineOf = k => { const all = store(k), list = all && typeof all === 'object' && Array.isArray(all[qrKey()]) ? all[qrKey()] : []; return list.filter(x => x && Number(x.at) > Date.now() - DAY); };
    const keepMine = (k, list) => { const all = store(k); store(k, { ...(all && typeof all === 'object' && !Array.isArray(all) ? all : {}), [qrKey()]: list }); };

    // ---------- a toast above the bottom bar: a request sent or cancelled (H1), a receipt saved or sent (H3) ----------
    let toastEl = null, toastTimer = 0;
    function toast(tone, ic, title, sub) {
      toastEl?.remove(); clearTimeout(toastTimer);
      const page = layers.filter(l => l.classList.contains('cp-page')).at(-1), mine = el('div', { class: `cp-toast ${tone}${page ? '' : ' on-menu'}`, role: 'status', 'aria-live': 'polite' },
        el('span', { class: 'cp-tic' }, icon(ic)), el('p', { class: 'cp-ttx' }, el('b', {}, title), el('small', {}, sub)));
      toastEl = mine; (page || root).append(mine);
      toastTimer = setTimeout(() => { mine.classList.add('out'); setTimeout(() => mine.remove(), 250); if (toastEl === mine) toastEl = null; }, 4000);
    }

    // ---------- the Help bell (H1): a table's QRs, dine-in, on the menu and on Order placed ----------
    const ASKS = { waiter: ['Call a waiter', 'waiter'], water: ['Water', 'water'], bill: ['Ask for the bill', 'receipt'], other: ['Other help', 'chat'] };
    const waitingAsks = () => mineOf(REQ_KEY).filter(r => !r.takenBy && !r.cancelled);
    // (a captain tapped "On my way": "‹first name› is on the way · Water · 7:42 PM", for 10 minutes; the cloud tells the phone)
    const takenNow = () => mineOf(REQ_KEY).filter(r => r.takenBy && Date.now() - (Number(r.takenAt) || 0) < 600000).sort((a, b) => a.takenAt - b.takenAt).at(-1) || null;
    const onTheWay = r => el('div', { class: 'cp-toast accent cp-onway', role: 'status' }, el('span', { class: 'cp-tic' }, icon('check')),
      el('p', { class: 'cp-ttx' }, el('b', {}, `${r.takenBy} is on the way`), el('small', {}, `${r.label} · ${clock(new Date(r.takenAt))}`)));
    function ask(k, note = '') {
      const list = mineOf(REQ_KEY), now = Date.now();
      // (rung again within 5 minutes and not taken: it is with the staff already; after 5 minutes it goes out to
      // everyone again)
      const same = list.find(r => r.kind === k && !r.takenBy && !r.cancelled && now - r.at < 300000 && (r.note || '') === note);
      if (!same) { list.push({ id: `rq${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: k, label: ASKS[k][0], note, at: now }); keepMine(REQ_KEY, list); }
      toast('info', ASKS[k][1], `${ASKS[k][0]} · request sent`, `We’ve told the staff. ${clock(new Date(same ? same.at : now))}`);
    }
    // (every request from this table no captain has taken yet: H1)
    function cancelAsks() {
      const list = mineOf(REQ_KEY), w = list.filter(r => !r.takenBy && !r.cancelled); if (!w.length) return;
      for (const r of w) r.cancelled = Date.now();
      keepMine(REQ_KEY, list);
      toast('info', 'cancel', 'Request cancelled', `${w.map(r => r.label).join(', ')} · the staff won’t come for it.`);
    }
    // (a sheet's rows: an icon in a circle, the words, a line under them; greyed, never hidden)
    const hrow = (ic, title, sub, go, off) => el('button', { type: 'button', class: `cp-hrow${off ? ' off' : ''}`, disabled: off || null, onclick: go },
      el('span', { class: 'cp-hic' }, icon(ic)), el('span', { class: 'cp-htx' }, el('b', {}, title), sub ? el('small', {}, sub) : null));
    const backBtn = go => el('button', { type: 'button', class: 'cp-btn cp-ghost cp-backbtn', onclick: go }, icon('arrow'), el('span', {}, 'Back'));
    const sheetHead = (title, sub) => [el('h3', { class: 'cp-stitle' }, title), el('p', { class: 'cp-shsub' }, sub)];
    function helpSheet() {
      const w = waitingAsks(), paid = paidSoFar();
      const layer = sheet('cp-help', sheetHead('How can we help?', `${o.place || where()} · the staff get it right away`),
        el('div', { class: 'cp-hrows' },
          ['waiter', 'water', 'bill'].map(k => hrow(ASKS[k][1], ASKS[k][0], null, () => { close(layer); ask(k); })),
          hrow('receipt', 'Get a receipt', paid ? `Paid so far ${fmt(paid)}` : 'Nothing paid yet', () => { drop(layer); receiptSheet(null); }, !paid),
          hrow('cancel', 'Cancel request', w.length ? `${w.map(r => r.label).join(', ')} · sent ${clock(new Date(w[0].at))} · not taken yet` : 'No request waiting', () => { close(layer); cancelAsks(); }, !w.length),
          hrow('chat', 'Other help', 'Type a short note', () => { drop(layer); formSheet('Other help', `${o.place || where()} · the staff get it right away`,
            el('input', { class: 'cp-input', type: 'text', maxlength: '120', placeholder: 'Type a short note', 'aria-label': 'Your note', enterkeyhint: 'send' }), 'Send', v => Boolean(v), v => ask('other', v)); })),
        backBtn(() => close(layer)));
      open(layer);
    }
    // (a sheet with one field: Other help's note, a receipt's email address)
    function formSheet(title, sub, field, action, ok, done) {
      const send = el('button', { type: 'button', class: 'cp-btn cp-go', disabled: true }, action);
      field.addEventListener('input', () => { const v = field.value.trim(); send.disabled = !ok(v); field.classList.toggle('on', Boolean(v)); });
      field.addEventListener('keydown', e => { if (e.key === 'Enter' && !send.disabled) send.click(); });
      const layer = sheet('cp-help cp-form', sheetHead(title, sub), field, send, backBtn(() => close(layer)));
      send.addEventListener('click', () => { const v = field.value.trim(); if (!ok(v)) return; close(layer); done(v); });
      open(layer, field);
    }

    // ---------- receipts (H2, H3): the printed receipt, as a photo or by email ----------
    // (Takeaway and a whole event: the order placed; a table: its open order and this phone's orders paid there today)
    // (an order that joined the table's open order is in its payments already: the cloud gives the order's uid; until
    // then nothing reaches the restaurant, so none has one)
    const phoneOrders = () => mineOf(ORD_KEY).filter(x => !o.bill || !x.uid || x.uid !== o.bill.uid);
    const billsPaid = () => { const m = store(BILLS_KEY); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; };
    const billPaidHere = () => (o.bill ? Number(billsPaid()[o.bill.uid]?.amount) || 0 : 0);
    const tableDue = () => (o.bill ? Math.max(0, o.bill.due - billPaidHere()) : 0);
    const paidSoFar = () => (o.bill ? o.bill.paid + billPaidHere() : 0) + phoneOrders().reduce((n, x) => n + (Number(x.paid) || 0) - (Number(x.refund) || 0), 0);
    function receiptSheet(order) {
      const sub = order ? [`Order #${order.number}`, fmt(order.paid), order.who].filter(Boolean).join(' · ')
        : `${o.place || where()} · paid so far ${fmt(paidSoFar())}${tableDue() ? ` · ${fmt(tableDue())} still due` : ''}`;
      const layer = sheet('cp-help', sheetHead('Your receipt', sub), el('div', { class: 'cp-hrows' },
        hrow('photo', 'Save as photo', 'Goes to your phone’s photos', () => { close(layer); savePhoto(order); }),
        hrow('mail', 'Email', 'Type your email address', () => { drop(layer); formSheet('Email your receipt', sub,
          el('input', { class: 'cp-input', type: 'email', inputmode: 'email', autocomplete: 'email', maxlength: '120', placeholder: 'Type your email address', 'aria-label': 'Your email address', enterkeyhint: 'send' }),
          'Send receipt', v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), v => toast('accent', 'mail', 'Receipt sent', `To ${v}`)); })),
        backBtn(() => close(layer)));
      open(layer);
    }
    // (one receipt, as the restaurant prints it (receipt.js, owner 18 Nov 2026: "the receipt should have the bill number
    // and all details"): this phone's order, or the table's open order with its payments and what is still due. Never a
    // REPRINT: it's the customer's own copy)
    const rctx = () => ({ restaurant, business: o.business || {}, taxRate: o.taxRate, copy: true });
    const receiptOf = x => window.RestroReceipt.doc(x.rec, 'receipt', { ...rctx(), rec: x.rec });
    function tableReceipts() {
      const out = [], B = o.bill?.order;
      if (B) {
        // (the bill paid here, I3: on the order as a payment of its own, as the cloud will record it; paid in full, the
        // bill is the receipt, TAX INVOICE · RECEIPT)
        const here = billsPaid()[o.bill.uid], r = { ...B };
        if (here?.amount) {
          const was = window.RestroReceipt.payments(B, B.total / 100, false).map(p => ({ method: p.method, amount: Math.round(p.amount * 100), at: p.at, ref: p.ref }));
          r.payments = [...was, { method: here.method === 'Card' ? 'card' : 'upi', amount: here.amount, at: here.at, ref: '' }];
          if (r.payments.reduce((n, p) => n + p.amount, 0) >= B.total) r.paidAt = here.at;
        }
        // (no bill number yet: the restaurant gives one when it prints the bill or takes the payment, so until then it is
        // "BILL · NOT A TAX INVOICE", as the POS prints a bill before its number)
        const kind = r.paidAt ? 'receipt' : 'bill';
        out.push(window.RestroReceipt.doc(r, kind, { ...rctx(), rec: r, prints: (kind === 'receipt' ? r.receipts : r.bills) || [], pre: kind === 'bill' && !r.billNo }));
      }
      return [...out, ...phoneOrders().filter(x => x.rec).map(receiptOf)];
    }
    async function savePhoto(order) {
      const list = order ? [receiptOf(order)] : tableReceipts(); if (!list.length) return;
      const pics = []; for (const r of list) pics.push(await window.RestroReceipt.draw(r));
      const gap = 24, cv = document.createElement('canvas'), c = cv.getContext('2d');
      cv.width = 808; cv.height = pics.reduce((n, p) => n + p.height, 0) + gap * (pics.length - 1);
      c.fillStyle = '#E8E6E1'; c.fillRect(0, 0, cv.width, cv.height);
      let y = 0; for (const p of pics) { c.drawImage(p, 0, y); y += p.height + gap; }
      const a = el('a', { href: cv.toDataURL('image/png'), download: `${restaurant.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'restaurant'}-receipt.png` });
      document.body.append(a); a.click(); a.remove();
      toast('accent', 'photo', 'Receipt saved', 'In your phone’s photos');
    }

    // ---------- the table's bill (I3): its bar on the menu, its page, paying it on the phone ----------
    // (while the cart is empty and the table's open order has something due: "Table 7 · ₹798 due · Pay bill ›")
    function dueBar() {
      root?.querySelector(':scope > .cp-due')?.remove();
      const due = tableDue();
      if (!dineIn || captain || !canOrder() || s.cart.size || !due) return;
      root.querySelector(':scope > .cm-menu')?.after(el('button', { type: 'button', class: 'cm-cart cp-due', onclick: billPage }, el('b', {}, `${o.place || where()} · ${fmt(due)} due`), el('span', {}, 'Pay bill ›')));
    }
    const roundTotal = r => bill(r.lines.map(l => ({ d: l, q: l.qty })), o.taxRate).toPay;
    const dishNames = r => r.lines.map(l => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join(' · ');
    function billPage() {
      const B = o.bill; if (!B) return;
      const place = o.place || where(), due = tableDue(), dueRounds = B.rounds.filter(r => !r.qr), paidRounds = B.rounds.filter(r => r.qr);
      const dueLines = dueRounds.flatMap(r => r.lines.map(l => ({ d: l, q: l.qty }))), b = bill(dueLines, o.taxRate);
      const layer = pageLayer('cp-checkout cp-billpg', head(`${place} bill`), el('div', { class: 'cp-scroll' },
        el('div', { class: 'cp-card' }, el('div', { class: 'cp-ctxt' }, el('p', { class: 'cp-clabel' }, 'Open bill'), el('p', { class: 'cp-ctitle2' }, `${place} · Dine-in`)), el('span', { class: 'cp-pill' }, place)),
        paidRounds.length ? el('div', { class: 'cp-box cp-paidr' }, paidRounds.map(r => [el('p', { class: 'cp-prow' }, el('span', {}, icon('check'), `Round ${r.n} · paid by QR${r.at ? ` · ${clock(new Date(r.at))}` : ''}`), el('span', {}, fmt(roundTotal(r)))),
          el('p', { class: 'cp-pnames' }, dishNames(r))])) : null,
        dueRounds.map(r => [label(`Still due · Round ${r.n}${r.by && r.by !== 'QR' ? ` · ordered by ${r.by}` : ''}`), orderRows(r.lines.map(l => ({ d: l, q: l.qty })))]),
        el('div', { class: 'cp-totals' }, el('p', {}, el('span', {}, 'Items'), el('span', {}, fmt(b.itemTotal))),
          b.taxes.map(x => ['CGST', 'SGST'].map(n => el('p', {}, el('span', {}, `${n} ${tax(x.rate)}`), el('span', {}, fmt(x.half, true))))),
          el('p', { class: 'cp-topay' }, el('span', {}, 'Due now'), el('span', {}, fmt(due))))),
      el('footer', { class: 'cp-foot' }, button('cp-go', `Pay ${fmt(due)}`, () => { drop(layer); payStep({ ...b, toPay: due, lines: dueLines, billFor: true }); }), el('p', { class: 'cp-why' }, 'Or pay at the counter as usual.')));
      open(layer);
    }
    function billPaid(b, method) {
      const B = o.bill; if (!B) return;
      const m = billsPaid(); m[B.uid] = { amount: (Number(m[B.uid]?.amount) || 0) + b.toPay, method, at: Date.now() }; store(BILLS_KEY, m);
      const place = o.place || where(), dueRounds = B.rounds.filter(r => !r.qr), paidRounds = B.rounds.filter(r => r.qr);
      const more = () => { s.cart.clear(); s.note = ''; setCart(); closeAll(); };
      const layer = pageLayer('cp-done cp-billdone', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-okdot big' }, icon('check')), el('div', {}, el('h2', { class: 'cp-htitle' }, `${place} bill paid`), el('p', { class: 'cp-hsub' }, `Paid ${fmt(b.toPay)} · ${method} · nothing due now`))),
        el('div', { class: 'cp-box cp-paidsum' },
          dueRounds.map(r => el('p', {}, el('span', {}, `Round ${r.n}${r.by && r.by !== 'QR' ? ` · ${r.by}` : ''} · paid just now`), el('span', {}, fmt(dueRounds.length > 1 ? roundTotal(r) : b.toPay)))),
          paidRounds.map(r => el('p', {}, el('span', {}, `Round ${r.n} · paid by QR`), el('span', {}, fmt(roundTotal(r))))),
          el('p', { class: 'cp-ptot' }, el('span', {}, `${place} · total paid`), el('span', {}, fmt(B.paid + billPaidHere())))),
        el('p', { class: 'cp-noteline cp-needrc' }, 'Need a receipt? Tap the bell, then “Get a receipt”.'),
        label(`Paid just now · ${dueRounds.map(r => `Round ${r.n}`).join(', ')}`), orderRows(b.lines || [])),
      el('footer', { class: 'cp-bar' }, bellButton(), button('cp-more', 'Order more', more)));
      layer._back = more;
      open(layer);
    }

    // ---------- instead of the menu (G): closed, a QR that no longer works, an event not on yet or ended ----------
    // (a closed QR's "See the menu": the menu to look at, no ordering, C6)
    let msgLayer = null;
    function message() {
      msgLayer?.remove(); msgLayer = null;
      if (!blocked || seeMenu) return;
      const st = blocked, at = Number(st.opens || st.at) || 0, when = at ? `${dayWord(at)} at ${clock(new Date(at))}` : '';
      // (the QR's pill stays, an event's too; a QR that no longer works has none: G)
      let ic = 'moon', title, sub = '', note = '', see = false, pill = true, thanks = false;
      if (st.page === 'dead') { ic = 'qroff'; title = ['This ', el('b', { class: 'cp-qr' }, 'QR'), ' no longer works.']; sub = 'Please ask staff.'; pill = false; }
      else if (st.page === 'closed') {
        see = true; note = 'You can still look at the menu and prices.';
        if (st.why === 'break') { ic = 'clock'; title = 'We’re closed for a break.'; sub = when && `We open again ${when}.`; }
        else if (st.why === 'weekly') { title = 'We’re closed today.'; sub = when && `We open ${when}.`; }
        else { title = 'We’re closed for today.'; sub = when && `We open ${when}.`; }
      } else if (st.page === 'upcoming') { ic = 'calendar'; title = `This event ${st.again ? 'opens again' : 'begins'} on ${dayDate(at)} at ${clock(new Date(at))}.`; sub = o.event || ''; }
      else { ic = 'calendar'; title = 'This event has ended.'; sub = `${o.event || 'Event'} · ${dayDate(at || Date.now())}`; note = 'Thank you for coming.'; thanks = true; }
      msgLayer = el('div', { class: 'cp-layer cp-page cp-msgpg' }, el('div', { class: 'cp-scroll' }, band(pill),
        el('div', { class: 'cp-msg' }, el('span', { class: 'cp-micon' }, icon(ic)), el('h2', { class: 'cp-mtitle' }, title), sub ? el('p', { class: 'cp-msub' }, sub) : null, note ? el('p', { class: `cp-mnote${thanks ? ' thanks' : ''}` }, note) : null)),
      see ? el('footer', { class: 'cp-foot' }, button('cp-ghost cp-seemenu', 'See the menu', () => { seeMenu = true; build(); })) : null);
      root.append(msgLayer); CM().fit(msgLayer);
    }
    // (paused, by hand or after the last order time: the menu stays, with this at the bottom; no ordering, G)
    const pausedBar = () => el('div', { class: 'cp-paused', role: 'status' }, el('span', { class: 'cp-pic' }, icon('pause')),
      el('p', { class: 'cp-ttx' }, el('b', {}, 'QR ordering is paused.'), el('small', {}, 'Please reach out to staff.')));

    // ---------- paid while the restaurant is offline (E5, Pack 5 Pending): after 30 s with no confirmation, the cloud
    // tells the phone; staff confirm the order by hand ----------
    function paidOffline(b, method = 'UPI') {
      const ls = b.lines || lines(), at = new Date(), number = nextNumber();
      closeAll(true);
      const layer = pageLayer('cp-done cp-offline', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-okdot big paid' }, icon('check')), el('div', {}, el('h2', { class: 'cp-htitle' }, `Paid · ${fmt(b.toPay)}`), el('p', { class: 'cp-hsub' }, `${method} · today at ${clock(at)} · Successful`))),
        el('div', { class: 'cp-refund cp-showstaff' }, el('p', { class: 'cp-rtitle' }, 'Show this screen to our staff'), el('p', {}, 'Our system is offline for a moment, so staff will confirm your order by hand. You don’t need to pay again.')),
        el('div', { class: 'cp-number' }, el('div', {}, el('p', { class: 'cp-clabel' }, 'Order number'), el('p', { class: 'cp-csub' }, dineIn ? `${o.place || where()} · Dine-in` : 'Show this at the counter')), el('b', {}, `#${number}`)),
        label('Your order'), orderRows(ls), totals(b, true, 'Paid')));
      layer._back = () => { s.cart.clear(); s.note = ''; setCart(); closeAll(); };
      open(layer);
    }

    // ---------- captain mode (J): its bar, a dish's note, Send to kitchen, Sent to the kitchen ----------
    const CAPBAR = 34;
    // (the quick picks for a dish's note: fixed, in this order, one or more, J3)
    const PICKS = ['Less spicy', 'More spicy', 'No onion', 'No garlic', 'Jain'];
    const first = v => String(v || '').trim().split(/\s+/)[0] || '';
    const capBar = () => el('div', { class: 'cp-capbar', role: 'note' }, el('b', {}, `Captain mode · ${captain}`), el('span', {}, `${o.place || where()} · no payment`));
    // (a dish's note as the KOT prints it under the dish: the picks, then the captain's own words)
    const noteOf = id => { const n = s.notes.get(id); return n ? [...n.picks, n.text].filter(Boolean).join(' · ') : ''; };
    // ("+ Note" under a dish once it's in the cart, or a pencil and its note; a tap opens the note, J3)
    const noteChip = id => {
      const text = noteOf(id), name = dishes.get(id)?.name || '';
      return el('button', { type: 'button', class: `cp-nchip${text ? ' on' : ''}`, 'data-note': text, 'aria-label': text ? `Note for ${name}: ${text}` : `Add a note for ${name}`, onclick: e => { e.stopPropagation(); noteSheet(id); } },
        text ? [icon('pencil'), el('span', {}, text)] : '+ Note');
    };
    // (on the menu, under each dish in the cart as drawn: in the dish's words in Night, under its price in Fresh grid;
    // in the others the dish's row places it, customer-pages.css)
    const NOTE_AT = { night: '.cm-dt', 'fresh-grid': '.cm-dr' };
    function noteChips() {
      if (!captain || !root) return;
      for (const row of root.querySelectorAll(':scope > .cm-scroll .cm-dish[data-id]')) {
        const id = row.dataset.id, old = row.querySelector('.cp-nchip'), want = s.cart.has(id) && !dishes.get(id)?.out;
        row.classList.toggle('cp-hasnote', want);
        if (old && want && old.dataset.note === noteOf(id)) continue;
        old?.remove(); if (want) (row.querySelector(NOTE_AT[t.id]) || row).append(noteChip(id));
      }
    }
    // "Note for Paneer tikka · Prints on the KOT under this dish": the quick picks, the captain's own words, Save note;
    // ← Back keeps the note as it was
    function noteSheet(id) {
      const d = dishes.get(id); if (!d) return;
      const was = s.notes.get(id) || { picks: [], text: '' }, picks = new Set(was.picks);
      const own = el('input', { class: `cp-input${was.text ? ' on' : ''}`, type: 'text', maxlength: '80', placeholder: 'Type your own note', 'aria-label': 'Your own note', enterkeyhint: 'done', value: was.text });
      const pick = p => el('button', { type: 'button', class: 'cp-pick', 'aria-pressed': String(picks.has(p)), onclick: e => { if (picks.has(p)) picks.delete(p); else picks.add(p); e.currentTarget.setAttribute('aria-pressed', String(picks.has(p))); } }, p);
      const save = () => {
        const text = own.value.replace(/\s+/g, ' ').trim(), list = PICKS.filter(p => picks.has(p));
        if (list.length || text) s.notes.set(id, { picks: list, text }); else s.notes.delete(id);
        close(layer); noteChips(); for (const l of layers) l._refresh?.();
      };
      own.addEventListener('input', () => own.classList.toggle('on', Boolean(own.value.trim())));
      own.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      const layer = sheet('cp-help cp-form cp-notes', sheetHead(`Note for ${d.name}`, 'Prints on the KOT under this dish'), el('div', { class: 'cp-picks' }, PICKS.map(pick)), own,
        button('cp-go', 'Save note', save), backBtn(() => close(layer)));
      open(layer);
    }
    // (a round's dishes: the dish's line, its note under it; on Send to kitchen "+ Note" too, and a tap on the dish changes
    // how many)
    const capRows = (items, edit) => el('div', { class: 'cp-rows' }, items.map(({ d, q, note }) => el('div', { class: `cp-caprow${edit || note ? '' : ' bare'}` },
      el('div', { class: 'cp-row', onclick: edit ? () => dishSheet(d.id) : null }, photo(d, 'row'), el('p', { class: 'cp-rname' }, mark(d), el('span', {}, d.name)), el('span', { class: 'cp-x' }, `× ${q}`), price(Math.round(d.price * 100) * q)),
      edit ? noteChip(d.id) : note ? el('span', { class: 'cp-nchip on' }, icon('pencil'), el('span', {}, note)) : null)));
    // (the round this one will be on the table's open order: Round 1 for a new order)
    const roundNo = () => (o.bill?.rounds?.length || 0) + 1;

    // Send to kitchen (instead of checkout): Round 1 · Dine-in, Server ‹the order's server›, Guests; this round's dishes and
    // their notes; this round with GST and what the table owes after it; no payment, collected at the counter (J3). A
    // whole event's: Dine-in or Takeaway, the customer's name and phone (the KOT needs them)
    function sendPage() {
      if (!captain || !lines().length) return;
      const ev = o.event || 'Event', place = o.place || where(), whole = kind === 'event', server = first(o.bill?.server) || captain;
      // (Guests: the table's so far, or its seats; as the captain set them for this round)
      if (!s.guestsSet) s.guests = Math.min(99, Math.max(1, Number(o.bill?.guests) || Number(o.seats) || 2));
      const gq = el('b', { class: 'cp-q' }), gshow = () => { gq.textContent = String(s.guests); gless.disabled = s.guests <= 1; };
      const gless = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One guest less', onclick: () => { s.guests = Math.max(1, s.guests - 1); s.guestsSet = true; gshow(); } }, icon('minus'));
      const gmore = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One guest more', onclick: () => { s.guests = Math.min(99, s.guests + 1); s.guestsSet = true; gshow(); } }, icon('plus'));
      gshow();
      const field = (text, input, after) => el('div', { class: 'cp-field' }, label(text), input, after);
      const name = el('input', { class: 'cp-input', type: 'text', autocomplete: 'off', autocapitalize: 'words', maxlength: '40', placeholder: 'For the KOT and the counter', value: s.name });
      const phoneIn = el('input', { class: 'cp-pin', type: 'tel', inputmode: 'numeric', autocomplete: 'off', maxlength: '11', placeholder: '10-digit mobile number', value: pretty(s.phone) });
      const phoneBox = el('label', { class: 'cp-phone' }, el('span', { class: 'cp-cc' }, '+91'), phoneIn), phoneErr = el('p', { class: 'cp-err', hidden: true }, 'Enter a valid 10-digit mobile number');
      const hows = whole && o.eventMode !== 'takeaway' ? ['Dine-in', 'Takeaway'].map(h => el('button', { type: 'button', class: 'cp-how', 'data-how': h, 'aria-pressed': String(s.how === h), onclick: () => { s.how = h; for (const x of hows) x.setAttribute('aria-pressed', String(x.dataset.how === h)); check(); } },
        el('b', {}, h), el('small', {}, h === 'Dine-in' ? 'On a plate, eat here' : 'Packed to go'))) : [];
      const listBox = el('div', {}), sumBox = el('div', {}), go = button('cp-go', 'Send to kitchen', () => { if (!go.disabled) sendRound(); }), why = el('p', { class: 'cp-why' });
      const check = () => {
        s.name = name.value.trim(); s.phone = digits(phoneIn.value);
        const ok = !whole || Boolean(s.name && validPhone(s.phone) && s.how);
        phoneErr.hidden = !(s.touched.phone && s.phone && !validPhone(s.phone));
        phoneBox.classList.toggle('bad', !phoneErr.hidden); phoneBox.classList.toggle('on', Boolean(s.phone)); name.classList.toggle('on', Boolean(s.name));
        go.disabled = !ok;
        why.textContent = ok ? 'No payment here · collected at the counter' : 'Choose Dine-in or Takeaway, and add the customer’s name and a valid mobile number';
      };
      phoneIn.addEventListener('input', () => { const end = phoneIn.selectionStart === phoneIn.value.length; phoneIn.value = pretty(phoneIn.value); if (end) phoneIn.setSelectionRange(phoneIn.value.length, phoneIn.value.length); check(); });
      phoneIn.addEventListener('blur', () => { s.touched.phone = true; check(); });
      name.addEventListener('input', check);
      const draw = () => {
        const ls = lines(); if (!ls.length) { close(layer); return; }
        const b = bill(ls, o.taxRate), what = whole ? 'This order' : 'This round';
        listBox.replaceChildren(label(`${what} · ${plural(b.items, 'item', 'items')}`), capRows(ls.map(l => ({ ...l, note: noteOf(l.d.id) })), true));
        sumBox.replaceChildren(el('div', { class: 'cp-box cp-capsum' }, el('p', {}, el('span', {}, `${what} · incl. GST`), el('b', {}, fmt(b.toPay))),
          el('p', { class: 'cp-ptot' }, el('span', {}, whole ? 'Due at the counter' : `${place} · Due after this`), el('span', {}, fmt((whole ? 0 : tableDue()) + b.toPay)))));
      };
      const layer = pageLayer('cp-checkout cp-sendpg', head('Send to kitchen'), el('div', { class: 'cp-scroll' },
        el('div', { class: 'cp-card cp-rcard' }, el('div', { class: 'cp-ctxt' }, el('p', { class: 'cp-clabel' }, kind === 'event-table' ? `${ev} · Round ${roundNo()}` : whole ? `${ev} · Event order` : `Round ${roundNo()} · Dine-in`),
          el('p', { class: 'cp-ctitle2' }, `Server ${server}`)), whole ? null : el('div', { class: 'cp-guests' }, el('div', { class: 'cp-stepper' }, gless, gq, gmore), el('small', {}, 'Guests'))),
        hows.length ? field('How do you want it?', el('div', { class: 'cp-hows' }, hows)) : null,
        whole ? field('Customer’s name', name) : null, whole ? field('Phone', phoneBox, phoneErr) : null,
        listBox, sumBox),
      el('footer', { class: 'cp-foot' }, go, why));
      layer._refresh = draw; draw(); check();
      open(layer);
    }
    // (to the restaurant: the round joins the table's open order, or starts one, and its KOT prints with the notes. Not
    // reached, or a dish sold out meanwhile: it stays here, to send again)
    async function sendRound() {
      const ls = lines(); if (s.sending || !ls.length) return;
      const whole = kind === 'event', place = o.place || where(), items = ls.map(l => ({ ...l, note: noteOf(l.d.id) })), b = bill(ls, o.taxRate), n = roundNo();
      const round = { code: o.code || null, kind, captain: String(o.captain).replace(/\s+/g, ' ').trim(), guests: whole ? 0 : s.guests, lines: items.map(x => ({ id: x.d.id, qty: x.q, ...(x.note ? { note: x.note } : {}) })),
        ...(whole ? { customer: { name: s.name, mobile: digits(s.phone), code: '91' }, how: s.how === 'Takeaway' ? 'takeaway' : 'dine-in' } : {}) };
      s.sending = true;
      const veil = open(el('div', { class: 'cp-layer cp-veil', role: 'status', 'aria-live': 'polite' }, el('div', { class: 'cp-vbox' }, el('span', { class: 'cp-spin', 'aria-hidden': 'true' }),
        el('p', { class: 'cp-vtitle' }, 'Sending to the kitchen…'), el('p', { class: 'cp-vsub' }, whole ? `${o.event || 'Event'} · ${restaurant}` : `${place} · Round ${n}`))));
      let r = null;
      try { r = typeof o.onRound === 'function' ? await o.onRound(round) : null; } catch { r = null; }
      s.sending = false; drop(veil);
      if (!r?.ok) {
        const gone = Array.isArray(r?.dishes) ? r.dishes.filter(x => typeof x === 'string').join(', ') : '';
        toast('info', 'cancel', 'Not sent to the kitchen', r?.why === 'sold-out' && gone ? `${gone} sold out · remove it to send` : `Couldn’t reach ${restaurant} · try again`);
        return;
      }
      // (the table's open order as it is now, until the restaurant's copy comes: this round on it, due)
      const before = whole ? [] : (o.bill?.uid && r.uid && o.bill.uid !== r.uid ? [] : o.bill?.rounds || []);
      if (!whole) {
        const was = o.bill && (!r.uid || o.bill.uid === r.uid) ? o.bill : null, paid = Number(was?.paid) || 0, due = Number(r.due) || 0;
        const mine = { n: Number(r.round) || n, by: first(r.by) || captain, qr: false, at: Date.now(), lines: items.map(x => ({ id: x.d.id, name: x.d.name, qty: x.q, price: x.d.price, veg: x.d.veg, photo: x.d.photo })) };
        o.bill = { payments: [], ...(was || {}), uid: r.uid || was?.uid || null, number: r.number ?? was?.number, rounds: [...before.filter(x => x.n !== mine.n), mine], paid, due, total: paid + due,
          guests: Number(r.guests) || s.guests, server: first(r.server) || first(was?.server) || captain };
      }
      s.cart.clear(); s.notes.clear(); s.guestsSet = false; setCart();
      closeAll(true); sentPage(r, items, b, before);
    }
    // Sent to the kitchen: "Table 7 · Round 1 · by ‹first name›", the table's bill (each round paid or due, what it
    // owes), this round's dishes and notes; Back to my tables · Print bill (on the restaurant's bill printer; settling
    // stays at the Counter, J4) · Add more (the next round joins this bill until it's paid). A whole event's: the
    // customer, their phone and how, "Pay at the counter"
    function sentPage(r, items, b, before) {
      const whole = kind === 'event', place = o.place || where(), by = first(r.by) || captain, n = Number(r.round) || 1, count = items.reduce((a, x) => a + x.q, 0);
      const due = Number.isFinite(Number(r.due)) ? Number(r.due) : b.toPay;
      const rows = whole ? [[`${[s.name, s.phone ? `+91 ${pretty(s.phone)}` : '', s.how || 'Dine-in'].filter(Boolean).join(' · ')} · due`, b.toPay]]
        : [...before.filter(x => x.n < n).map(x => [`Round ${x.n} · ${x.qr ? 'QR · paid' : `${x.by || 'Staff'} · due`}`, roundTotal(x)]), [`Round ${n} · ${by} · due`, b.toPay]];
      const addMore = () => closeAll();
      const printBill = async () => {
        let ok = false;
        try { ok = Boolean((typeof o.onPrintBill === 'function' ? await o.onPrintBill({ code: o.code || null, uid: r.uid || null }) : null)?.ok); } catch { ok = false; }
        if (ok) toast('accent', 'receipt', 'Bill sent to the printer', `${whole ? `Order #${r.number}` : `${place} bill`} · Due ${fmt(due)}`);
        else toast('info', 'cancel', 'The bill didn’t print', 'Try again, or print it at the counter');
      };
      const layer = pageLayer('cp-done cp-sentpg', el('div', { class: 'cp-scroll' },
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-okdot big' }, icon('check')), el('div', {}, el('h2', { class: 'cp-htitle' }, 'Sent to the kitchen'),
          el('p', { class: 'cp-hsub' }, (whole ? [o.event || 'Event', `Order #${r.number}`, `by ${by}`] : [place, `Round ${n}`, `by ${by}`]).join(' · ')))),
        el('div', { class: 'cp-box cp-capsum' }, rows.map(([text, a]) => el('p', {}, el('span', {}, text), el('b', {}, fmt(a)))),
          el('p', { class: 'cp-ptot' }, el('span', {}, whole ? 'Pay at the counter' : `${place} bill`), el('span', {}, `Due ${fmt(due)}`))),
        label(`${whole ? `Order #${r.number}` : `Round ${n}`} · ${plural(count, 'item', 'items')}`), capRows(items, false),
        whole ? null : el('p', { class: 'cp-noteline cp-guestline' }, `Guests: ${Number(r.guests) || s.guests} · the table’s next rounds join this bill until it’s paid.`)),
      el('footer', { class: 'cp-foot cp-capfoot' }, button('cp-go', 'Back to my tables', () => (typeof o.onTables === 'function' ? o.onTables() : closeAll())),
        el('div', { class: 'cp-two' }, button('cp-ghost', 'Print bill', printBill), button('cp-ghost', 'Add more', addMore))));
      layer._back = addMore;
      open(layer);
    }

    // ---------- the Help bell's hint, the first time this phone opens a table's menu (C5) ----------
    // ("Need help? Tap here" above the bell; it goes at the first tap anywhere or after 5 seconds, and never shows again
    // on this phone. Only on the QR link's page: options.hint)
    let hint = null;
    function bellHint() {
      if (!o.hint || !dineIn || captain || !canOrder() || store('restro.cp.bellHint')) return;
      store('restro.cp.bellHint', 1);
      hint = el('p', { class: 'cp-bhint', role: 'note' }, 'Need help? Tap here');
      const go = () => {
        removeEventListener('pointerdown', go, true); clearTimeout(timer);
        const h = hint; hint = null; if (!h) return;
        h.classList.add('out'); setTimeout(() => h.remove(), 250);
      };
      const timer = setTimeout(go, 5000);
      addEventListener('pointerdown', go, true);
      root.append(hint);
    }

    // ---------- the menu page itself ----------
    for (const [id, q] of Object.entries(o.cart || {})) if (dishes.has(id) && q > 0 && !dishes.get(id).out) s.cart.set(id, q);
    // (Add puts one in the cart; Added opens the dish page, to change how many. Drawn again on update, where it was,
    // with whatever is open kept open)
    // (no ordering: the Menu QR, paused, a closed QR: the menu to look at, as the Menu QR's, with the QR's own pill: G)
    function build() {
      const old = root, top = old?.querySelector('.cm-scroll')?.scrollTop || 0, off = !canOrder();
      // (captain mode: its bar over the top of every page, no Help bell, the cart's View cart › opens Send to kitchen, J3)
      root = CM().page({ template: o.template, accent: o.accent, kind: off ? 'menu' : kind, pill: o.place || where(), restaurant, logo: o.logo, categories: cats, cart: off ? {} : cartObj(), full: o.full, status: o.status && !captain,
        bell: !captain, inset: captain ? CAPBAR : 0,
        onDish: id => dishSheet(id), onAdd: id => (s.cart.get(id) ? dishSheet(id) : add(id)), onMenu: menuList, onSearch: search, onCart: captain ? sendPage : cartSheet, onBell: helpSheet });
      root.classList.add('cp-root');
      if (captain) root.classList.add('cp-captain');
      if (off && !view) root.classList.add('cp-off');
      if (hint && dineIn && !off) root.append(hint); else hint = null;
      // (paused: the banner where the Menu button sits, as drawn)
      if (paused) { root.classList.add('cp-pausedpg'); root.append(pausedBar()); }
      const taken = dineIn && !off && !captain ? takenNow() : null;
      if (taken) root.append(onTheWay(taken));
      if (captain) root.append(capBar());
      if (old) { root.append(...layers); old.replaceWith(root); } else host.append(root);
      root.querySelector('.cm-scroll').scrollTop = top; CM().fit(root);
      dueBar(); noteChips(); message();
    }
    build(); bellHint();
    // (the restaurant changed its menu, a dish's sold out or the design: the cart keeps what can still be ordered; a
    // dish sold out since it was added leaves it, C4)
    function update(next) {
      setOptions({ ...o, ...next });
      if (!blocked) seeMenu = false;
      for (const id of [...s.cart.keys()]) if (!dishes.has(id) || dishes.get(id).out) { s.cart.delete(id); s.notes.delete(id); }
      // (the cloud says a captain took a request: { id, takenBy, takenAt }, H1)
      if (Array.isArray(next?.taken) && next.taken.length) {
        const list = mineOf(REQ_KEY);
        for (const x of next.taken) { const r = list.find(y => y.id === x?.id); if (r && !r.cancelled) { r.takenBy = String(x.takenBy || '').split(/\s+/)[0]; r.takenAt = Number(x.takenAt) || Date.now(); } }
        keepMine(REQ_KEY, list);
      }
      build(); for (const l of layers) l._refresh?.();
    }
    // (paidOffline: the cloud's "paid, but the restaurant is offline" for the order being paid, E5)
    return { get root() { return root; }, update, paidOffline: method => s.last && paidOffline(s.last, method), destroy() { if (o.history) removeEventListener('popstate', onPop); root.remove(); } };
  }
  window.RestroCustomerPages = Object.freeze({ mount });
})();
