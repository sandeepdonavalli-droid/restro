'use strict';
// Customers: the restaurant's customer list.
// - From Counter (Takeaway / Delivery → Add Customer): pick a customer, or add a new one, for the order.
// - From the Customers app on the home screen: look up, add, edit or delete customers.
// Customer details are kept on this device until the RESTRO backend exists (security plan, Phase 2).
// They are never part of the code or the website.
(() => {
  const dialog = document.querySelector('#customers-dialog');
  if (!dialog) return;
  const KEY = 'restro.customers.v1', MAX_NAME = 60, MAX_ADDRESS = 200;

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
  const ICON = {
    home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h4v-5h3v5h4V10"/>', back: '<path d="m15 6-6 6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>', chevron: '<path d="m9 6 6 6-6 6"/>'
  };
  const appIcon = () => {
    const art = typeof artNode === 'function' && typeof apps !== 'undefined' && apps.customers ? artNode(apps.customers.art) : document.createElement('span');
    art.classList.add('cust-title-icon'); return art;
  };
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };

  // ---------- data ----------
  const clean = c => ({ id: String(c.id), name: String(c.name || '').slice(0, MAX_NAME), mobile: String(c.mobile || '').replace(/\D/g, '').slice(0, 15),
    code: String(c.code || '').replace(/\D/g, '').slice(0, 4), address: String(c.address || '').slice(0, MAX_ADDRESS), createdAt: Number(c.createdAt) || Date.now() });
  let customers = [];
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) customers = saved.filter(c => c && c.id && c.name).map(clean); } catch {}
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(customers)); } catch {} window.RestroSync?.wrote(KEY); };
  // Customers added, changed or deleted on another tablet (sync.js) show here at once
  window.addEventListener('restro:data-changed', e => {
    if (!(e.detail?.collections || []).includes('customers')) return;
    try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); customers = Array.isArray(saved) ? saved.filter(c => c && c.id && c.name).map(clean) : []; } catch {}
    if (dialog.open && !form) render();
  });

  // Mobile numbers follow the restaurant's country (Settings → My Profile).
  const country = () => window.RestroProfile?.country || { code: '91', name: 'India', len: [10], start: '6789', sample: '98765 43210' };
  const lengths = c => c.len.length > 1 ? `${c.len[0]}–${c.len.at(-1)}` : String(c.len[0]);
  const nationalDigits = (value, c) => {
    let d = String(value).replace(/\D/g, ''); const max = Math.max(...c.len);
    if (d.length > max && d.startsWith('00' + c.code)) d = d.slice(2 + c.code.length); else if (d.length > max && d.startsWith(c.code)) d = d.slice(c.code.length);
    if (d.length > max && d.startsWith('0')) d = d.slice(1); else if (d.length === max + 1 && d.startsWith('0')) d = d.slice(1);
    return d;
  };
  const pretty = (digits, c) => {
    const sample = c.sample.split(' ').map(part => part.length); let out = '', i = 0;
    for (const n of sample) { if (i >= digits.length) break; out += (out ? ' ' : '') + digits.slice(i, i + n); i += n; }
    return i < digits.length ? out + digits.slice(i) : out;
  };
  const phoneText = c => { if (!c.mobile) return ''; const here = country(); return `+${c.code || here.code} ${(c.code || here.code) === here.code ? pretty(c.mobile, here) : c.mobile}`; };
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

  // ---------- state ----------
  let pick = null;   // { needAddress, current, onPick } while Counter is choosing a customer
  let form = null;   // null: the list; { id, name, mobile, code, address } while adding or editing
  let errors = {}, query = '', deleteArmed = false, deleteTimer = null;

  // Rendered into its own root so the system bar and toasts placed in the dialog survive re-renders.
  const root = el('div', { class: 'cust-root' }); dialog.prepend(root);

  function render() {
    const title = form ? (form.id ? 'Edit customer' : 'New customer') : pick ? 'Add customer' : 'Customers';
    const back = Boolean(form || pick);
    const head = el('div', { class: 'cust-head' },
      el('button', { type: 'button', class: 'cust-nav', 'aria-label': form ? 'Back to customers' : pick ? 'Back to Counter' : 'Home', title: back ? 'Back' : 'Home',
        onclick: () => { if (form) closeForm(); else if (pick) close(); else document.querySelector('#system-home')?.click(); } }, svg(back ? ICON.back : ICON.home)),
      appIcon(),
      el('h2', { id: 'customers-title', tabindex: '-1' }, title));
    root.replaceChildren(head, form ? formView() : listView());
  }

  function listView() {
    const search = el('label', { class: 'cust-search' }, svg(ICON.search), el('span', { class: 'visually-hidden' }, 'Search customers'),
      el('input', { id: 'customers-search', type: 'search', placeholder: 'Search by name or mobile', autocomplete: 'off', enterkeyhint: 'search', value: query,
        oninput: e => { query = e.target.value; fillList(); } }));
    const ul = el('ul', { class: 'cust-list', 'aria-label': 'Customers' });
    fillList(ul);
    return el('div', { class: 'cust-body' }, el('div', { class: 'cust-tools' }, search,
      el('button', { type: 'button', class: 'cust-new', onclick: () => openForm(null) }, svg(ICON.plus), 'New customer')), ul);
  }
  function fillList(ul = root.querySelector('.cust-list')) {
    if (!ul) return;
    const q = query.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    const found = customers.filter(c => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.mobile.includes(qd))).sort((a, b) => a.name.localeCompare(b.name));
    ul.replaceChildren(...(found.length ? found.map(row) : [el('li', { class: 'cust-empty' },
      el('strong', {}, customers.length ? 'No customers match' : 'No customers yet'),
      el('span', {}, customers.length ? 'Check the name or number, or add a new customer.' : 'Tap New customer to add one.'))]));
  }
  function row(c) {
    const current = Boolean(pick) && pick.current === c.id;
    return el('li', {}, el('button', { type: 'button', class: `cust-row${current ? ' current' : ''}`, onclick: () => choose(c) },
      el('span', { class: 'cust-avatar', 'aria-hidden': 'true' }, initials(c.name)),
      el('span', { class: 'cust-copy' }, el('strong', {}, c.name), el('span', {}, [phoneText(c), c.address].filter(Boolean).join(' · '))),
      current ? el('span', { class: 'cust-tag' }, 'On this order') : svg(ICON.chevron)));
  }

  function formView() {
    const c = country(), needAddress = Boolean(pick?.needAddress), code = form.code || c.code;
    const field = (id, label, control, error, hint) => el('div', { class: 'cust-field' }, el('label', { for: id }, label), control,
      hint ? el('p', { class: 'cust-hint' }, hint) : null, error ? el('p', { class: 'cust-error', role: 'alert' }, error) : null);
    const name = el('input', { id: 'cust-name', type: 'text', autocomplete: 'off', maxlength: String(MAX_NAME), value: form.name, oninput: e => { form.name = e.target.value; } });
    const mobile = el('input', { id: 'cust-mobile', type: 'tel', inputmode: 'numeric', autocomplete: 'off', placeholder: code === c.code ? c.sample : '', value: form.mobile,
      oninput: e => { const v = e.target.value.replace(/[^\d ]/g, ''); if (v !== e.target.value) e.target.value = v; form.mobile = v; } });
    const address = el('textarea', { id: 'cust-address', rows: '3', maxlength: String(MAX_ADDRESS), placeholder: needAddress ? 'House or flat, street, area' : 'Optional',
      oninput: e => { form.address = e.target.value; } });
    address.value = form.address;
    return el('form', { class: 'cust-body cust-form', novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } },
      field('cust-name', 'Name', name, errors.name),
      field('cust-mobile', 'Mobile number', el('div', { class: 'cust-phone' }, el('span', { class: 'cust-code', 'aria-hidden': 'true' }, `+${code}`), mobile), errors.mobile,
        code === c.code ? `${lengths(c)}-digit mobile number in ${c.name}` : null),
      field('cust-address', needAddress ? 'Delivery address' : 'Address', address, errors.address),
      el('div', { class: 'cust-actions' },
        form.id ? el('button', { type: 'button', class: `cust-delete${deleteArmed ? ' armed' : ''}`, onclick: removeCustomer }, deleteArmed ? 'Tap again to delete' : 'Delete customer') : null,
        el('button', { type: 'submit', class: 'primary-button cust-save' }, pick ? 'Save and add to order' : 'Save')));
  }

  function openForm(c) {
    const q = query.trim(), digitsOnly = q && /^[\d\s+]+$/.test(q);
    form = c ? { id: c.id, name: c.name, mobile: c.mobile, code: c.code, address: c.address }
      : { id: null, name: digitsOnly ? '' : q, mobile: digitsOnly ? q.replace(/[^\d ]/g, '') : '', code: '', address: '' };
    errors = {}; deleteArmed = false; render();
    dialog.querySelector(c ? '#customers-title' : '#cust-name')?.focus({ preventScroll: true });
  }
  function closeForm() { form = null; errors = {}; deleteArmed = false; render(); dialog.querySelector('#customers-title')?.focus({ preventScroll: true }); }

  function submit() {
    const c = country(), code = form.code || c.code, rules = code === c.code ? c : null;
    const name = form.name.trim().replace(/\s+/g, ' '), mobile = rules ? nationalDigits(form.mobile, rules) : form.mobile.replace(/\D/g, ''), address = form.address.trim();
    errors = {};
    if (!name) errors.name = 'Enter the customer’s name.';
    if (!mobile) errors.mobile = 'Enter a mobile number.';
    else if (rules && (!rules.len.includes(mobile.length) || (rules.start && !rules.start.includes(mobile[0]))))
      errors.mobile = `Enter a ${lengths(rules)}-digit ${rules.name} mobile number${rules.start ? ` starting with ${[...rules.start].join(', ').replace(/, (\d)$/, ' or $1')}` : ''}.`;
    else if (!rules && (mobile.length < 6 || mobile.length > 15)) errors.mobile = 'Enter a valid mobile number.';
    else if (customers.some(x => x.mobile === mobile && (x.code || c.code) === code && x.id !== form.id)) errors.mobile = 'A customer with this mobile number already exists. Search for them instead.';
    if (pick?.needAddress && !address) errors.address = 'Enter the delivery address.';
    if (Object.keys(errors).length) { render(); dialog.querySelector('.cust-error')?.closest('.cust-field')?.querySelector('input,textarea')?.focus(); return; }
    let saved = form.id ? customers.find(x => x.id === form.id) : null;
    if (saved) Object.assign(saved, { name, mobile, code, address });
    else { saved = { id: `cu${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, mobile, code, address, createdAt: Date.now() }; customers.push(saved); }
    store();
    if (pick) { finish(saved); return; }
    form = null; errors = {}; render(); toast(`${name} saved`);
  }

  function removeCustomer() {
    if (!form?.id) return;
    if (!deleteArmed) {
      deleteArmed = true; render(); clearTimeout(deleteTimer);
      deleteTimer = setTimeout(() => { if (deleteArmed) { deleteArmed = false; if (form) render(); } }, 3000);
      return;
    }
    const gone = customers.find(x => x.id === form.id);
    window.RestroSync?.removed('customers', form.id); customers = customers.filter(x => x.id !== form.id); store();
    form = null; errors = {}; deleteArmed = false; render(); toast(`${gone ? gone.name : 'Customer'} deleted`);
  }

  // Tapping a customer: from Counter it goes on the order (Delivery needs an address first); otherwise it opens for editing.
  function choose(c) {
    if (!pick) { openForm(c); return; }
    if (pick.needAddress && !c.address.trim()) { openForm(c); errors = { address: 'Add the delivery address for this order.' }; render(); dialog.querySelector('#cust-address')?.focus(); return; }
    finish(c);
  }
  function finish(c) {
    const done = pick?.onPick;
    close();
    done?.({ id: c.id, name: c.name, mobile: c.mobile, code: c.code || country().code, address: c.address });
  }
  function close() { pick = null; form = null; errors = {}; deleteArmed = false; if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => { pick = null; form = null; errors = {}; query = ''; deleteArmed = false; });

  // Toasts must show above this full-screen app (and go back to Counter, or home, after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) (document.querySelector('#counter-dialog[open]') || toastHome).append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroCustomers = Object.freeze({
    // open({ pick: true, needAddress, current, onPick(customer) }) from Counter; open() from the home screen.
    open(options = {}) {
      if (options.pick) pick = { needAddress: Boolean(options.needAddress), current: options.current || null, onPick: typeof options.onPick === 'function' ? options.onPick : null };
      else { pick = null; document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
      form = null; errors = {}; query = ''; deleteArmed = false;
      render();
      if (!dialog.open) dialog.showModal();
      if (pick && !customers.length) openForm(null); // nobody saved yet: go straight to New customer
      else dialog.querySelector('#customers-title')?.focus({ preventScroll: true });
    },
    goBack() { if (!dialog.open || !form) return false; closeForm(); return true; },
    phoneText
  });
})();
