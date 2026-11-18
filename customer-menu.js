'use strict';
// The customer menu's 7 templates (Update Pack 7, B and C). RestroCustomerMenu.page(options) draws the menu as a
// customer sees it when they scan: QR Studio shows it in a phone (Menu design, QS7 and QS8), and the customer pages will
// use the same page. Looks are in customer-menu.css; nothing here follows the tablet's theme (B1).
// - templates: [{ id, name, photos }]: Night, Fresh grid, Café, Editorial (with dish photos) and Chalkboard, Classic
//   list, Minimal (without). The ids are stored (restro.menuDesign.v1 in qr-studio.js), so they never change.
// - page({ template, accent, kind, pill, restaurant, logo, categories, cart, status, onDish }):
//     template: one of the ids; accent: '#RRGGBB' for the buttons, tabs and cart bar, or null for the template's own;
//     kind: 'table' | 'takeaway' | 'menu' (Menu QR: view only, no add buttons, no cart, no bell: C6; the Help bell is on
//       Table QRs only: H1); pill: the pill's words (Table 7, Takeaway, Menu); restaurant: its name; logo: the logo
//     photo's address or null (B2); categories: [{ id, name, items: [{ id, name, desc, price (rupees), veg, photo, out }]
//       }] (out: sold out, C4); cart: { ‹dish id›: quantity }; status: true draws a phone's status bar (QR Studio's
//       preview); onDish(id): a dish tapped.
(() => {
  // (accent: the template's own colour for its buttons, tabs and cart bar, the first of QR Studio's accent colours)
  const TEMPLATES = Object.freeze([
    { id: 'night', name: 'Night', photos: true, accent: '#D9B867' }, { id: 'fresh-grid', name: 'Fresh grid', photos: true, accent: '#1F6B4F' },
    { id: 'cafe', name: 'Café', photos: true, accent: '#2B1D14' }, { id: 'editorial', name: 'Editorial', photos: true, accent: '#8C2F39' },
    { id: 'chalkboard', name: 'Chalkboard', photos: false, accent: '#F5D26C' }, { id: 'classic-list', name: 'Classic list', photos: false, accent: '#B5530A' },
    { id: 'minimal', name: 'Minimal', photos: false, accent: '#D62829' }
  ].map(Object.freeze));
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.3 15.3 4.7 4.7"/>',
    menu: ['0 0 14 11', '<path d="M1 1h12M1 5.5h12M1 10h8"/>'],
    bell: '<path d="M6.5 11a5.5 5.5 0 0 1 11 0v4.4l1.3 1.85H5.2l1.3-1.85z"/><path d="M9.6 19.3a2.4 2.4 0 0 0 4.8 0"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    // (a dish without its photo yet, in a template with photos: Material Symbols' restaurant, Apache 2.0)
    dish: ['0 -960 960 960', '<path d="M280-80v-366q-51-14-85.5-56T160-600v-280h80v280h40v-280h80v280h40v-280h80v280q0 56-34.5 98T360-446v366h-80Zm400 0v-320H560v-280q0-83 58.5-141.5T760-880v800h-80Z"/>'],
    check: '<path d="m5.5 12.4 4.2 4.2 8.8-8.9"/>'
  };
  function icon(name) {
    const [box, body] = Array.isArray(ICONS[name]) ? ICONS[name] : ['0 0 24 24', ICONS[name]];
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', box); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `ci ci-${name}`); s.innerHTML = body; return s;
  }
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
  const rupees = n => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // (an accent's text: dark on a light accent, white on a dark one)
  function onAccent(hex) {
    const v = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!v) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(v[1].slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#14120E' : '#FFFFFF';
  }

  function page(o) {
    const t = TEMPLATES.find(x => x.id === o.template) || TEMPLATES[0], kind = o.kind || 'table', view = kind === 'menu';
    const cats = (o.categories || []).filter(c => c.items?.length), cart = o.cart || {};
    const bell = kind === 'table' || kind === 'event-table';
    const root = el('div', { class: `cm cm-t-${t.id} k-${kind}${bell ? '' : ' no-bell'}${view ? ' view' : ''}` });
    if (o.accent && onAccent(o.accent)) { root.style.setProperty('--acc', o.accent); root.style.setProperty('--on-acc', onAccent(o.accent)); root.classList.add('own-acc'); }
    const top = el('header', { class: 'cm-top', style: o.logo ? `background-image:url("${String(o.logo).replace(/"/g, '%22')}")` : null },
      o.status ? el('div', { class: 'cm-status', 'aria-hidden': 'true' }, el('span', {}, '9:41'), el('i', {}, el('b'))) : null,
      el('div', { class: 'cm-hrow' }, el('h1', { class: 'cm-name' }, o.restaurant || ''), o.pill ? el('span', { class: 'cm-pill' }, o.pill) : null));
    const tabs = cats.map((c, i) => el('button', { type: 'button', class: `cm-tab${i === 0 ? ' on' : ''}`, 'data-cat': c.id }, c.name));
    const bar = el('nav', { class: 'cm-cats', 'aria-label': 'Categories' }, el('div', { class: 'cm-tabs' }, tabs),
      el('button', { type: 'button', class: 'cm-search', 'aria-label': 'Search' }, icon('search')));
    const dish = d => {
      const n = cart[d.id] || 0, photo = t.photos && d.photo;
      // (the add button: "Add" and a plus, "Added" and a tick once in the cart; each template shows the words, the
      // sign or both. A sold-out dish: "Sold out" in its place, and the dish greyed: C4)
      const add = d.out ? el('span', { class: 'cm-add out' }, el('span', { class: 'cm-add-t' }, 'Sold out')) : view ? null
        : el('button', { type: 'button', class: `cm-add${n ? ' on' : ''}`, 'aria-label': n ? `${d.name} added` : `Add ${d.name}` }, el('span', { class: 'cm-add-t' }, n ? 'Added' : 'Add'), icon(n ? 'check' : 'plus'));
      // (a template with photos keeps the photo's place for a dish without one yet, with a plain plate there)
      return el('div', { class: `cm-dish${d.out ? ' out' : ''}`, 'data-id': d.id, onclick: o.onDish ? () => o.onDish(d.id) : null },
        photo ? el('span', { class: 'cm-ph', style: `background-image:url("${String(d.photo).replace(/"/g, '%22')}")` }) : t.photos ? el('span', { class: 'cm-ph none' }, icon('dish')) : null,
        el('div', { class: 'cm-dt' }, el('p', { class: 'cm-dn' }, el('i', { class: `cm-mk${d.veg === false ? ' nv' : ''}`, 'aria-label': d.veg === false ? 'Non-veg' : 'Veg' }), el('b', {}, d.name)),
          d.desc ? el('p', { class: 'cm-dd' }, d.desc) : null),
        el('div', { class: 'cm-dr' }, el('b', { class: 'cm-pr', 'aria-label': rupees(d.price) }, el('span', { class: 'cm-rs' }, '₹'), rupees(d.price).slice(1)), add));
    };
    const secs = cats.map(c => el('section', { class: 'cm-sec', 'data-cat': c.id }, el('h2', { class: 'cm-sh' }, el('span', {}, c.name), el('small', {}, plural(c.items.length, 'dish', 'dishes'))),
      el('div', { class: 'cm-list' }, c.items.map(dish))));
    const scroll = el('div', { class: 'cm-scroll' }, top, bar, el('main', { class: 'cm-body' }, secs));
    root.append(scroll, el('button', { type: 'button', class: 'cm-menu' }, icon('menu'), 'Menu'));
    if (!view) {
      if (bell) root.append(el('button', { type: 'button', class: 'cm-bell', 'aria-label': 'Help' }, icon('bell')));
      const items = Object.entries(cart).filter(([id]) => cats.some(c => c.items.some(d => d.id === id)));
      const count = items.reduce((s, [, q]) => s + q, 0), total = items.reduce((s, [id, q]) => s + q * (cats.flatMap(c => c.items).find(d => d.id === id)?.price || 0), 0);
      if (count) root.append(el('button', { type: 'button', class: 'cm-cart' }, el('b', {}, `${plural(count, 'item', 'items')} · ${rupees(total)}`), el('span', {}, 'View cart ›')));
    }
    // (the category bar marks the category on show, and a tap goes to it)
    scroll.addEventListener('scroll', () => {
      const y = scroll.scrollTop + bar.offsetHeight + 2; let on = secs[0];
      for (const s of secs) if (s.offsetTop <= y) on = s;
      for (const b of tabs) b.classList.toggle('on', b.dataset.cat === on?.dataset.cat);
    }, { passive: true });
    for (const b of tabs) b.addEventListener('click', () => { const s = secs.find(x => x.dataset.cat === b.dataset.cat); if (s) scroll.scrollTo({ top: s.offsetTop - bar.offsetHeight + 1 }); });
    return root;
  }
  window.RestroCustomerMenu = Object.freeze({ templates: TEMPLATES, page });
})();
