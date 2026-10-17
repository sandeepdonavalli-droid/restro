'use strict';
// Employees (the owner only) and signing in with a PIN.
// - Employees: the owner adds each person with a name, a role and a 4-digit PIN, changes them, or deletes them. It has
//   the Customers app's look (header, list rows, form fields). The first time it asks for the owner's own account.
// - Signing in: once accounts exist, the lock screen asks for a PIN when the app opens and whenever the tablet locks
//   (the Android app reports the tablet's button). The PIN says who it is: their name shows at the top left and goes on
//   the orders they take (Orders, Server). Locking signs them out. Five wrong PINs in a row pause the pad for 30 seconds.
// The accounts themselves are kept by staff.js (on this tablet for now, in the cloud in Phase 2).
(() => {
  const dialog = document.querySelector('#employees-dialog');
  const Staff = window.RestroStaff;
  if (!dialog || !Staff) return;

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
    plus: '<path d="M12 5v14M5 12h14"/>', chevron: '<path d="m9 6 6 6-6 6"/>',
    del: '<path d="M9 6h11v12H9l-6-6 6-6Z"/><path d="m12 9 5 6m0-6-5 6"/>'
  };
  const appIcon = () => {
    const art = typeof artNode === 'function' && typeof apps !== 'undefined' && apps.employees ? artNode(apps.employees.art) : document.createElement('span');
    art.classList.add('cust-title-icon'); return art;
  };
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };
  const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const isOwner = () => Staff.current?.role === 'owner';

  // ---------- Employees app ----------
  let form = null;   // null: the list; { id, name, role, pin, original } while adding or editing
  let errors = {}, busy = false, deleteArmed = false, deleteTimer = null;
  // Rendered into its own root (with the Customers app's class, for its look) so the system bar and toasts placed in
  // the dialog survive re-renders.
  const root = el('div', { class: 'cust-root emp-root' }); dialog.prepend(root);

  function render() {
    const setup = !Staff.hasAccounts();
    const title = setup ? 'Owner account' : form ? (form.id ? 'Edit employee' : 'New employee') : 'Employees';
    const back = Boolean(form) && !setup;
    const head = el('div', { class: 'cust-head' },
      el('button', { type: 'button', class: 'cust-nav', 'aria-label': back ? 'Back to employees' : 'Home', title: back ? 'Back' : 'Home',
        onclick: () => { if (back) closeForm(); else document.querySelector('#system-home')?.click(); } }, svg(back ? ICON.back : ICON.home)),
      appIcon(),
      el('h2', { id: 'employees-title', tabindex: '-1' }, title));
    root.replaceChildren(head, form ? formView(setup) : listView());
  }

  function listView() {
    const me = Staff.current;
    const row = p => el('li', {}, el('button', { type: 'button', class: 'cust-row', onclick: () => openForm(p) },
      el('span', { class: 'cust-avatar', 'aria-hidden': 'true' }, initials(p.name)),
      el('span', { class: 'cust-copy' }, el('strong', {}, p.name), el('span', {}, `${p.roleName} · PIN ••••`)),
      me && me.id === p.id ? el('span', { class: 'emp-tag' }, 'Signed in') : null,
      svg(ICON.chevron)));
    return el('div', { class: 'cust-body' },
      el('div', { class: 'emp-tools' }, el('button', { type: 'button', class: 'cust-new', onclick: () => openForm(null) }, svg(ICON.plus), 'New employee')),
      el('ul', { class: 'cust-list', 'aria-label': 'Employees' }, Staff.list().map(row)));
  }

  function formView(setup) {
    const field = (id, label, control, error, hint, group) => el('div', { class: 'cust-field' },
      group ? el('span', { class: 'emp-label', id: `${id}-label` }, label) : el('label', { for: id }, label), control,
      hint ? el('p', { class: 'cust-hint', id: `${id}-hint` }, hint) : null, error ? el('p', { class: 'cust-error', role: 'alert' }, error) : null);
    const name = el('input', { id: 'emp-name', type: 'text', autocomplete: 'off', maxlength: String(Staff.maxName), value: form.name,
      oninput: e => { form.name = e.target.value; } });
    const roles = el('div', { class: 'emp-roles', role: 'radiogroup', 'aria-labelledby': 'emp-role-label' },
      Staff.roles.map(r => el('button', { type: 'button', role: 'radio', 'aria-checked': String(form.role === r.id), class: `ctr-pick${form.role === r.id ? ' on' : ''}`,
        onclick: () => { form.role = r.id; render(); } }, r.name)));
    return el('form', { class: 'cust-body cust-form', novalidate: true, onsubmit: e => { e.preventDefault(); submit(setup); } },
      setup ? el('p', { class: 'emp-intro' }, 'First, your own account as the owner. Only the owner can add and change employees.') : null,
      field('emp-name', 'Name', name, errors.name),
      setup ? null : field('emp-role', 'Role', roles, errors.role, null, true),
      field('emp-pin', 'PIN', pinBoxes(), errors.pin,
        form.id ? 'Leave it empty to keep the current PIN.' : '4 digits, different for each person. It’s what they type to sign in.'),
      el('div', { class: 'cust-actions' },
        form.id ? el('button', { type: 'button', class: `cust-delete${deleteArmed ? ' armed' : ''}`, onclick: removePerson }, deleteArmed ? 'Tap again to delete' : 'Delete employee') : null,
        el('button', { type: 'submit', class: 'primary-button cust-save', disabled: busy }, 'Save')));
  }
  // Four boxes showing a dot per digit typed; the (invisible) field over them takes the typing, with the number keyboard.
  function pinBoxes() {
    const boxes = [0, 1, 2, 3].map(() => el('span', { 'aria-hidden': 'true' }));
    const paint = () => boxes.forEach((b, i) => { b.textContent = i < form.pin.length ? '•' : ''; b.classList.toggle('next', i === Math.min(form.pin.length, 3)); });
    const input = el('input', { id: 'emp-pin', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', 'aria-describedby': 'emp-pin-hint', value: form.pin,
      oninput: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); if (v !== e.target.value) e.target.value = v; form.pin = v; paint(); } });
    paint();
    return el('div', { class: 'emp-pin' }, input, boxes);
  }

  function openForm(p) {
    form = p ? { id: p.id, name: p.name, role: p.role, pin: '', original: p.name } : { id: null, name: '', role: 'server', pin: '' };
    errors = {}; deleteArmed = false; render();
    dialog.querySelector(p ? '#employees-title' : '#emp-name')?.focus({ preventScroll: true });
  }
  function closeForm() { form = null; errors = {}; deleteArmed = false; render(); dialog.querySelector('#employees-title')?.focus({ preventScroll: true }); }

  async function submit(setup) {
    if (busy) return;
    busy = true; errors = {}; render();
    const res = form.id ? await Staff.update(form.id, { name: form.name, role: form.role, pin: form.pin })
      : await Staff.add({ name: form.name, role: setup ? 'owner' : form.role, pin: form.pin });
    busy = false;
    if (res.error) { errors = { [res.error.field]: res.error.message }; render(); dialog.querySelector(`#emp-${res.error.field}`)?.focus({ preventScroll: true }); return; }
    if (setup) { Staff.signIn(res.person.id); syncLockMode(); }
    form = null; errors = {}; render(); toast(`${res.person.name} saved`);
    if (!isOwner()) close(); // changed their own role: Employees is for owners
  }

  function removePerson() {
    if (!form?.id) return;
    if (!deleteArmed) {
      deleteArmed = true; render(); clearTimeout(deleteTimer);
      deleteTimer = setTimeout(() => { if (deleteArmed) { deleteArmed = false; if (form) render(); } }, 3000);
      return;
    }
    const res = Staff.remove(form.id); deleteArmed = false;
    if (res.error) { render(); toast(res.error); return; }
    const name = form.original; form = null; errors = {}; render(); toast(`${name} deleted`);
  }

  function close() { form = null; errors = {}; deleteArmed = false; if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => { form = null; errors = {}; busy = false; deleteArmed = false; });

  // Toasts must show above this full-screen app (and go back home after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroEmployees = Object.freeze({
    open() {
      if (Staff.hasAccounts() && !isOwner()) { toast('Only the owner can open Employees.'); return; }
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      form = Staff.hasAccounts() ? null : { id: null, name: '', role: 'owner', pin: '' };
      errors = {}; deleteArmed = false; render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector(form ? '#emp-name' : '#employees-title')?.focus({ preventScroll: true });
    },
    goBack() { if (!dialog.open || !form || !Staff.hasAccounts()) return false; closeForm(); return true; }
  });

  // ---------- signing in with a PIN (on the lock screen) ----------
  const lock = document.querySelector('#screen-lock-dialog');
  const lockTitle = lock?.querySelector('#screen-lock-title');
  const Screen = window.RestroScreenLock;
  let entry = '', checking = false, wrong = 0, waitUntil = 0, waitTimer = null, sayTimer = null;
  const dots = el('div', { class: 'pin-dots', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => el('i')));
  const key = (label, value, extra = {}) => el('button', { type: 'button', class: 'ctr-pad-key', onclick: () => press(value), ...extra }, label);
  const pad = el('div', { class: 'pin-pad', role: 'group', 'aria-label': 'PIN' },
    [...'123456789'].map(d => key(d, d)), el('span', { class: 'pin-blank', 'aria-hidden': 'true' }), key('0', '0'), key(svg(ICON.del), 'del', { 'aria-label': 'Delete' }));
  const panel = el('div', { class: 'pin-panel' }, dots, pad);
  lockTitle?.after(panel);

  const paintDots = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length));
  function say(text, ms) {
    clearTimeout(sayTimer);
    if (lockTitle) lockTitle.textContent = text;
    if (ms) sayTimer = setTimeout(() => { if (Date.now() >= waitUntil) say('Enter your PIN'); }, ms);
  }
  function press(value) {
    if (checking || Date.now() < waitUntil || !lock.classList.contains('pin-mode')) return;
    if (value === 'del') entry = entry.slice(0, -1);
    else if (entry.length < 4) entry += value;
    paintDots();
    if (entry.length === 4) check();
  }
  async function check() {
    checking = true;
    const person = await Staff.verify(entry);
    checking = false; entry = ''; paintDots();
    if (person) { wrong = 0; say('Enter your PIN'); Staff.signIn(person.id); Screen?.unlock(); return; }
    dots.classList.remove('wrong'); void dots.offsetWidth; dots.classList.add('wrong');
    if (++wrong < 5) { say('Wrong PIN. Try again.', 2000); return; }
    wrong = 0; pause(Date.now() + 30000);
  }
  // The pause after five wrong PINs, kept for the session so reopening the page doesn't skip it
  const WAIT = 'restro.staff.wait.v1';
  function pause(until) {
    waitUntil = until; clearInterval(waitTimer);
    try { sessionStorage.setItem(WAIT, String(until)); } catch {}
    const tick = () => {
      const left = Math.ceil((waitUntil - Date.now()) / 1000);
      if (left <= 0) { clearInterval(waitTimer); waitUntil = 0; try { sessionStorage.removeItem(WAIT); } catch {} say('Enter your PIN'); }
      else say(`Too many tries. Try again in ${left} s.`);
    };
    tick(); waitTimer = setInterval(tick, 1000);
  }
  try { const until = Number(sessionStorage.getItem(WAIT)); if (until > Date.now()) pause(until); } catch {}
  lock?.addEventListener('keydown', e => {
    if (!lock.classList.contains('pin-mode')) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  });

  // Accounts exist: only a PIN ends a lock, and the lock screen shows the pad instead of Unlock.
  function syncLockMode() {
    const on = Staff.hasAccounts();
    Screen?.requirePin(on);
    if (!lock) return;
    lock.classList.toggle('pin-mode', on);
    if (!lockTitle) return;
    if (Date.now() >= waitUntil) lockTitle.textContent = on ? 'Enter your PIN' : 'Screen locked';
    // The lock screen opens with "Enter your PIN" focused (read out, and no key looks pressed); digits typed on a
    // keyboard work too.
    lockTitle.toggleAttribute('autofocus', on);
    if (on) lockTitle.setAttribute('tabindex', '-1'); else lockTitle.removeAttribute('tabindex');
  }
  // The signed-in person's name at the top left (in capitals, like the restaurant's)
  const nameNode = document.querySelector('#server-name');
  function paintName() {
    if (!nameNode) return;
    const p = Staff.current;
    nameNode.textContent = p ? p.name.toUpperCase() : 'SERVER NAME';
    if (typeof window.alignBannerText === 'function') window.alignBannerText();
  }
  window.addEventListener('restro:staff-signed-in', () => { paintName(); if (dialog.open && !isOwner()) close(); });
  window.addEventListener('restro:staff-changed', () => { syncLockMode(); if (dialog.open && !form) render(); });
  // Locking signs the person out; whatever was open waits under the lock for the next person (Employees closes).
  window.addEventListener('restro:screen-locked', () => {
    entry = ''; paintDots();
    if (Staff.hasAccounts()) { Staff.signOut(); if (dialog.open) close(); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    syncLockMode(); paintName();
    if (Staff.hasAccounts() && !Staff.current) Screen?.lock();
  });
})();
