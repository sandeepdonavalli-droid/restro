'use strict';
// The customer's pages around the menu (Update Pack 7, C to E), in the restaurant's template: the dish page, the Menu
// list, search, the cart ("Your order"), checkout, the payment step, Order placed and "Payment didn't go through".
// RestroCustomerPages.mount(host, options) draws them on RestroCustomerMenu's page; the QR link's page (404.html) uses
// it. Looks are in customer-pages.css, on the template's own colours and fonts (customer-menu.css).
// - options: { template, accent, logo, restaurant, kind ('table' | 'takeaway' | 'menu' | 'event' | 'event-table'),
//   place (the pill's words: 'Table 7', 'Takeaway', 'Menu', 'Event', 'Event table 3'), event (the event's name, for
//   an event's QRs), categories (as RestroCustomerMenu.page: [{ id, name, items: [{ id, name, desc, about, price, veg,
//   photo, out }] }]; about: the dish page's longer words), taxRate (0.05: CGST and SGST half each, D4), kds (true: the
//   restaurant has a kitchen display, so Order placed shows the order's status: E1), history (true: the phone's Back
//   closes what is open), full (true: fills the screen), cart ({ ‹dish id›: quantity } to start with), status (true:
//   a phone's status bar on the menu, for a preview) }
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
    bag: '<path d="M5.8 8.5h12.4l-.9 11.2a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9z"/><path d="M9.2 10.5V7.2a2.8 2.8 0 0 1 5.6 0v3.3"/>'
  };
  function icon(name) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `ci ci-${name}`); s.innerHTML = ICONS[name]; return s;
  }
  // ---------- money, in paise (D4): CGST and SGST each to the paisa, then the total to the nearest rupee ----------
  const fmt = (p, paise) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`;
  const tax = rate => `${+(rate * 50).toFixed(2)}%`;
  function bill(lines, rate) {
    const items = lines.reduce((s, l) => s + l.q, 0), itemTotal = lines.reduce((s, l) => s + Math.round(l.d.price * 100) * l.q, 0);
    const half = Math.round(itemTotal * rate / 2), sum = itemTotal + half * 2, toPay = Math.floor((sum + 50) / 100) * 100;
    return { items, itemTotal, cgst: half, sgst: half, roundOff: toPay - sum, toPay };
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const clock = d => `${(d.getHours() % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  // A mobile number as it shows: "9xxxx xxxxx" (D3: India only, 10 digits from 6, 7, 8 or 9)
  const digits = v => String(v || '').replace(/\D/g, '').slice(0, 10);
  const pretty = v => { const d = digits(v); return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };
  const validPhone = v => /^[6-9]\d{9}$/.test(digits(v));
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return v; };

  function mount(host, opts) {
    let o, kind, view, dineIn, restaurant, cats, dishes, t;
    // (the options; again on update: the menu, sold out and the design as the restaurant changes them)
    const setOptions = next => {
      o = { kind: 'table', taxRate: 0.05, kds: false, eventMode: 'both', ...next };
      kind = o.kind; view = kind === 'menu'; dineIn = kind === 'table' || kind === 'event-table';
      restaurant = String(o.restaurant || '').toLocaleUpperCase('en-IN');
      cats = (o.categories || []).filter(c => c.items?.length); dishes = new Map(cats.flatMap(c => c.items.map(d => [d.id, { ...d, cat: c.name }])));
      t = CM().templates.find(x => x.id === o.template) || CM().templates[0];
    };
    setOptions(opts);
    // (a whole event's QR: Dine-in or Takeaway, D3; one that only takes takeaway orders asks nothing)
    const s = { cart: new Map(), note: '', name: '', phone: '', how: o.kind === 'event' && o.eventMode === 'takeaway' ? 'Takeaway' : null, touched: {}, order: null };
    let root, layers = [];
    const cartObj = () => Object.fromEntries(s.cart);
    const lines = () => [...s.cart].map(([id, q]) => ({ d: dishes.get(id), q })).filter(l => l.d && l.q > 0);

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
      const layer = el('div', { class: 'cp-layer cp-dim', onclick: e => { if (e.target === e.currentTarget) close(layer); } }, box);
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
    const setCart = () => CM().setCart(root, cartObj());
    function add(id, q = 1) {
      const d = dishes.get(id); if (!d || d.out || view) return;
      const n = Math.max(0, (s.cart.get(id) || 0) + q); if (n) s.cart.set(id, n); else s.cart.delete(id);
      setCart(); for (const l of layers) l._refresh?.();
    }

    // ---------- the dish page (C1; the Menu QR's: "To order, please ask our staff.", C6) ----------
    // (a dish already in the cart opens at its quantity: Update, or Remove at 0)
    function dishSheet(id) {
      const d = dishes.get(id); if (!d) return;
      const had = s.cart.get(id) || 0, each = Math.round(d.price * 100); let q = had || 1;
      const qty = el('b', { class: 'cp-q' }, String(q)), go = el('button', { type: 'button', class: 'cp-btn cp-go' });
      // (down to 1 for a dish not in the cart yet, as drawn; to 0 for one in it: Remove)
      const minus = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One less', onclick: () => { q = Math.max(had ? 0 : 1, q - 1); show(); } }, icon('minus'));
      const plus = el('button', { type: 'button', class: 'cp-step', 'aria-label': 'One more', onclick: () => { q = Math.min(99, q + 1); show(); } }, icon('plus'));
      const show = () => { qty.textContent = String(q); go.textContent = !q ? 'Remove' : `${had ? 'Update' : 'Add'} · ${fmt(q * each)}`; };
      show();
      const foot = view ? el('p', { class: 'cp-ask' }, 'To order, please ask our staff.')
        : d.out ? el('p', { class: 'cp-ask' }, 'Sold out') : el('div', { class: 'cp-dfoot' }, el('div', { class: 'cp-stepper' }, minus, qty, plus), go);
      const layer = sheet('cp-dish', photo(d, 'big'), el('h3', { class: 'cp-dname' }, mark(d), el('span', {}, d.name)), d.about || d.desc ? el('p', { class: 'cp-dabout' }, d.about || d.desc) : null, foot);
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
            const btn = view ? null : d.out ? el('span', { class: 'cm-add out' }, el('span', { class: 'cm-add-t' }, 'Sold out'))
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
    function totals(b, rate, payLine) {
      const paise = b.roundOff !== 0;
      return el('div', { class: 'cp-totals' },
        el('p', {}, el('span', {}, 'Item total'), el('span', {}, fmt(b.itemTotal, paise))),
        el('p', {}, el('span', {}, `CGST ${tax(rate)}`), el('span', {}, fmt(b.cgst, true))),
        el('p', {}, el('span', {}, `SGST ${tax(rate)}`), el('span', {}, fmt(b.sgst, true))),
        b.roundOff ? el('p', {}, el('span', {}, 'Round off'), el('span', {}, `${b.roundOff > 0 ? '+' : '−'} ${fmt(Math.abs(b.roundOff), true)}`)) : null,
        payLine ? el('p', { class: 'cp-topay' }, el('span', {}, 'To pay'), el('span', {}, fmt(b.toPay))) : null);
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
          totals(b, o.taxRate, true),
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
        totalBox.replaceChildren(totals(bl, o.taxRate, true));
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
    function orderRows(ls) {
      return el('div', { class: 'cp-rows' }, ls.map(({ d, q }) => el('div', { class: 'cp-row' },
        photo(d, 'row'), el('p', { class: 'cp-rname' }, mark(d), el('span', {}, d.name)), el('span', { class: 'cp-x' }, `× ${q}`), price(Math.round(d.price * 100) * q))));
    }

    // ---------- sending the order, then the payment step (D5, D2) ----------
    function send(b) {
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
      const cancel = () => { closeAll(true); failed(b); }, paid = method => { closeAll(true); placed(b, method); };
      const layer = el('div', { class: 'cp-layer cp-page cp-pay' },
        el('header', { class: 'cp-phead' }, el('button', { type: 'button', class: 'cp-pback', 'aria-label': 'Cancel', onclick: cancel }, icon('back')), el('b', {}, 'Payment')),
        el('div', { class: 'cp-pbody' },
          el('div', { class: 'cp-pcard' }, el('div', {}, el('b', {}, restaurant), el('small', {}, kind === 'takeaway' ? 'Takeaway order' : kind === 'event' ? `${o.event || 'Event'} order` : `Order for ${o.place || 'your table'}`)), el('strong', {}, fmt(b.toPay))),
          el('p', { class: 'cp-pnote' }, 'Payments aren’t switched on yet. No money is taken, and the restaurant doesn’t get this order.'),
          el('button', { type: 'button', class: 'cp-pbtn', onclick: () => paid('UPI') }, `Pay by UPI · ${fmt(b.toPay)}`),
          el('button', { type: 'button', class: 'cp-pbtn', onclick: () => paid('Card') }, `Pay by card · ${fmt(b.toPay)}`),
          el('button', { type: 'button', class: 'cp-pbtn ghost', onclick: cancel }, 'Cancel')));
      layer._back = cancel;
      open(layer);
    }

    // ---------- Order placed (E1, E2) and "Payment didn't go through" (E3) ----------
    const band = () => el('header', { class: 'cp-band', style: o.logo ? `background-image:url("${String(o.logo).replace(/"/g, '%22')}")` : null },
      el('div', { class: 'cm-hrow' }, el('h1', { class: 'cm-name' }, restaurant), el('span', { class: 'cm-pill' }, o.place || where())));
    const nextNumber = () => { const n = (Number(store('restro.cp.lastOrder')) || 1000) + 1; store('restro.cp.lastOrder', n); return n; };
    function placed(b, method) {
      const ls = lines(), at = new Date(), number = nextNumber(), who = s.name && s.phone ? `${s.name} · +91 ${pretty(s.phone)}` : '';
      const sub = kind === 'takeaway' ? `${who} · Paid ${fmt(b.toPay)}`
        : kind === 'event' ? `${who} · ${o.event || 'Event'} · ${s.how || 'Dine-in'}`
          : kind === 'event-table' ? `Order #${number} · ${o.event || 'Event'} · Paid ${fmt(b.toPay)}`
            : `Order #${number} · Paid ${fmt(b.toPay)} · ${method}`;
      // (the order's status only with a kitchen display: E1)
      const steps = o.kds ? el('div', { class: 'cp-status' }, label('Status'), [['Sent to the kitchen', clock(at)], ['Cooking', null], [dineIn ? 'Ready · we bring it to your table' : 'Ready · collect at the counter', null]]
        .map(([text, time], i) => el('div', { class: `cp-sstep${i === 0 ? ' done' : ''}` }, el('i', {}), el('p', {}, el('span', {}, text), time ? el('small', {}, time) : null)))) : null;
      const more = () => { s.cart.clear(); s.note = ''; setCart(); closeAll(); };
      const layer = pageLayer('cp-done', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-okdot big' }, icon('check')), el('div', {}, el('h2', { class: 'cp-htitle' }, 'Order placed'), el('p', { class: 'cp-hsub' }, sub))),
        !dineIn ? el('div', { class: 'cp-number' }, el('div', {}, el('p', { class: 'cp-clabel' }, 'Your order number'), el('p', { class: 'cp-csub' }, 'Show this at the counter')), el('b', {}, `#${number}`)) : null,
        steps, label('Your order'), orderRows(ls), s.note ? el('p', { class: 'cp-noteline' }, `Note for the kitchen: “${s.note}”`) : null),
      el('footer', { class: 'cp-bar' }, dineIn ? el('button', { type: 'button', class: 'cp-round', 'aria-label': 'Help' }, icon('bell')) : el('button', { type: 'button', class: 'cp-receipt' }, icon('receipt'), 'Receipt'),
        button('cp-more', 'Order more', more)));
      layer._back = more;
      open(layer);
    }
    function failed(b) {
      const ls = lines();
      const layer = pageLayer('cp-fail', el('div', { class: 'cp-scroll' }, band(),
        el('div', { class: 'cp-hero' }, el('span', { class: 'cp-xdot' }, icon('cross')), el('div', {}, el('h2', { class: 'cp-htitle' }, 'Payment didn’t go through'), el('p', { class: 'cp-hsub' }, 'This order isn’t paid yet.'))),
        el('div', { class: 'cp-box' }, el('p', { class: 'cp-clabel' }, 'What happened'), el('p', {}, 'The payment was cancelled or your bank declined it. If money left your account, your bank sends it back by itself.')),
        el('div', { class: 'cp-box' }, el('p', { class: 'cp-clabel' }, 'Your order is saved'), el('p', {}, `${plural(b.items, 'item', 'items')} · ${fmt(b.toPay)}. We keep it for 15 minutes; it goes to the kitchen as soon as it’s paid.`)),
        label('Your order'), orderRows(ls)),
      el('footer', { class: 'cp-foot two' }, button('cp-go', `Try again · ${fmt(b.toPay)}`, () => { closeAll(true); payStep(b); }), button('cp-ghost', 'Back to cart', () => { closeAll(true); cartSheet(); })));
      layer._back = () => closeAll();
      open(layer);
    }

    // ---------- the menu page itself ----------
    for (const [id, q] of Object.entries(o.cart || {})) if (dishes.has(id) && q > 0 && !dishes.get(id).out) s.cart.set(id, q);
    // (Add puts one in the cart; Added opens the dish page, to change how many. Drawn again on update, where it was,
    // with whatever is open kept open)
    function build() {
      const old = root, top = old?.querySelector('.cm-scroll')?.scrollTop || 0;
      root = CM().page({ template: o.template, accent: o.accent, kind, pill: o.place || where(), restaurant, logo: o.logo, categories: cats, cart: cartObj(), full: o.full, status: o.status,
        onDish: id => dishSheet(id), onAdd: id => (s.cart.get(id) ? dishSheet(id) : add(id)), onMenu: menuList, onSearch: search, onCart: cartSheet });
      root.classList.add('cp-root');
      if (old) { root.append(...layers); old.replaceWith(root); } else host.append(root);
      root.querySelector('.cm-scroll').scrollTop = top; CM().fit(root);
    }
    build();
    // (the restaurant changed its menu, a dish's sold out or the design: the cart keeps what is still on the menu)
    function update(next) {
      setOptions({ ...o, ...next });
      for (const id of [...s.cart.keys()]) if (!dishes.has(id)) s.cart.delete(id);
      build(); for (const l of layers) l._refresh?.();
    }
    return { get root() { return root; }, update, destroy() { if (o.history) removeEventListener('popstate', onPop); root.remove(); } };
  }
  window.RestroCustomerPages = Object.freeze({ mount });
})();
