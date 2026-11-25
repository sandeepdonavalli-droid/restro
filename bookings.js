'use strict';
// Bookings (Update Pack 8, C and D): one app, three screens in #bookings-dialog.
// 1. The app (D: B01–B11): Waitlist | Reservations. "‹ Floor", the switch, + Add to waitlist / + New reservation; on the
//    left the day (Today ▾), the filter (All ▾) and the list (who is waiting, or the bookings after the NOW line, then
//    Earlier today, greyed); on the right the one picked: who they are, Edit, where they stand, and Remove / Cancel
//    reservation · Notify · Buzz · Seat now (Notify and Buzz with the short green or red bar: A3). Seat now: a waitlist
//    guest picks a table on the Floor (floor.js, 'seat'), a reservation goes to the Counter.
// 2. Add / Edit waitlist (D: B12–B14), below.
// 3. New / Edit reservation (C2, C4: N01–N04, N08–N10), with Pick a table on the Floor (C3: floor.js, 'reserve'):
// - Customer details: Phone / Walk-in (how the booking was taken); phone first (the country's code from Settings, "+91 |",
//   then the 10 digits), first name, last name. A phone number found in the customers or in past bookings fills in the
//   names, with the green line "Returning guest · found in your customers · 3 visits · last booked 2 Nov".
// - Number of guests: − / +, or the number tapped for the number pad (N03).
// - When: Today · Tomorrow · Pick a date (the Counter's month calendar), the hour · minute (5-minute steps) · AM / PM
//   wheels (inside business hours, as the Counter's Schedule), and what it comes to: "Today, 9:45 PM · in 1 h 33 min ·
//   table shows Reserved from 8:45 PM".
// - Note (optional). The Reservation card: the table (its shape, blue ring and tick), Assign pager (A6: the Counter's
//   pop-up; or a pager tapped on the NFC spot, at once, with Undo), and the summary row.
// - Table (right): the areas with what is free for this party at that time (C2: within the next 2 hours "N free" and
//   "N maybe"; further out, what isn't booked then; "join N tables" when no single table seats them), the best free
//   table auto-picked in the area tapped; Pick a table on the Floor; Prepay & save (the Pay screen: later) and Save.
// - Saved: the confirmation message goes at once (bookings-data.js), and the screen goes back to where it was opened
//   from (the Floor, or Bookings). Never without a table (C1).
// Sizes are the design's pixels on the 1920 x 1080 screen (--fu, launcher.css); bookings.css.
(() => {
  const dialog = document.querySelector('#bookings-dialog');
  if (!dialog) return;
  const B = () => window.RestroBookings, F = () => window.RestroFloor;
  const icon = (name, cls = '') => window.RestroFloorIcons?.svg(name, cls) || document.createElement('span');
  const MIN = 60000, HOUR = 60 * MIN;

  // ---------- small helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const svgOf = (box, inner, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', box); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); s.innerHTML = inner; return s; };
  const clock = t => { const d = new Date(t), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const firstOf = name => String(name || '').trim().split(/\s+/)[0] || '';
  const pad2 = n => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fu = n => `calc(${n} * var(--fu))`;

  // ---------- days and times (as the Counter's Schedule: business days, business hours; prefs.js) ----------
  const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const bizKey = t => window.RestroSync?.dayOf?.(t) || window.RestroPrefs?.businessDay?.(t) || dkey(new Date(t));
  const keyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return dkey(d); };
  const atOn = (k, h, m) => { const d = keyDate(k); if (h * 60 + m <= (window.RestroPrefs?.spillMinutes?.(k) ?? 0)) d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return d.getTime(); };
  const hoursOn = k => (window.RestroPrefs?.hoursOn ? window.RestroPrefs.hoursOn(k) : { from: -Infinity, to: Infinity });
  const breakOn = k => window.RestroPrefs?.breakOn?.(k) || null;
  const inBreak = (b, t) => Boolean(b) && t > b.from && t < b.to;
  const okAt = (k, h, m) => { const w = hoursOn(k), t = w && atOn(k, h, m); return Boolean(w) && t >= w.from && t <= w.to && !inBreak(breakOn(k), t); };
  // the time on a day nearest to h:m inside its hours and not in its break (5-minute steps; `half`: am (false) or pm
  // (true) only), or null when it is closed
  function nearestOpen(k, h, m, half = null) {
    const w = hoursOn(k); if (!w) return null;
    const b = breakOn(k), want = atOn(k, h, m), first = Math.ceil(w.from / 300000) * 300000, last = Math.floor(w.to / 300000) * 300000;
    let best = Math.min(last, Math.max(first, want));
    if ((half != null || inBreak(b, best)) && Number.isFinite(first) && Number.isFinite(last)) {
      let gap = Infinity;
      for (let t = first; t <= last; t += 300000) if ((half == null || (new Date(t).getHours() >= 12) === half) && !inBreak(b, t) && Math.abs(t - want) < gap) { gap = Math.abs(t - want); best = t; }
    }
    const c = new Date(best); return { h: c.getHours(), m: c.getMinutes() };
  }
  const dateWords = k => { const d = keyDate(k); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }; // "Wed 18 Nov"
  const today = () => bizKey(Date.now());
  // "Today, 9:45 PM" · "Wed 18 Nov, 9:45 PM"
  const whenWords = (k, t) => (k === today() ? `Today, ${clock(t)}` : `${dateWords(k)}, ${clock(t)}`);
  // "at 9:45 PM" · "tomorrow 9:45 PM" · "Fri 20 Nov, 9:45 PM"
  const freeWords = (k, t) => (k === today() ? `at ${clock(t)}` : k === addDays(today(), 1) ? `tomorrow ${clock(t)}` : `${dateWords(k)}, ${clock(t)}`);
  const inWords = (t, now) => {
    const m = Math.round((t - now) / MIN); if (m < 60) return `in ${m} min`;
    return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  };

  // ---------- phone numbers (the country from Settings › My Profile) ----------
  const country = () => window.RestroProfile?.country || { code: '91', name: 'India', len: [10], start: '6789', sample: '9xxxx xxxxx' };
  const pretty = digits => {
    const parts = country().sample.split(' ').map(p => p.length); let out = '', i = 0;
    for (const n of parts) { if (i >= digits.length) break; out += (out ? ' ' : '') + digits.slice(i, i + n); i += n; }
    return i < digits.length ? out + digits.slice(i) : out;
  };
  const phoneOk = d => { const c = country(); return c.len.includes(d.length) && (!c.start || c.start.includes(d[0])); };
  const maxDigits = () => Math.max(...country().len);

  // ---------- the guest: saved customers and past bookings (Customers app; bookings-data.js) ----------
  function customersWith(phone) {
    try { const list = JSON.parse(localStorage.getItem('restro.customers.v1') || '[]'); return Array.isArray(list) ? list.filter(c => c && String(c.mobile || '').replace(/\D/g, '').slice(-10) === phone) : []; } catch { return []; }
  }
  // Their visits: the days with an order of theirs, or a booking of theirs they came for
  function visitsOf(phone, except = null) {
    const days = new Set();
    for (const o of window.RestroCounter?.orders?.() || []) if (String(o.customer?.mobile || '').replace(/\D/g, '').slice(-10) === phone && !o.cancelledBy) days.add(bizKey(o.createdAt || Date.parse(o.paidAt) || 0));
    for (const r of B()?.reservations?.() || []) if (r.phone === phone && r.id !== except && (r.status === 'seated' || r.status === 'completed')) days.add(bizKey(r.seatedAt || r.at));
    return days.size;
  }
  function guestOf(phone, except = null) {
    if (!phoneOk(phone)) return null;
    const cust = customersWith(phone)[0] || null, now = Date.now();
    const past = (B()?.reservations?.() || []).filter(r => r.phone === phone && r.id !== except && r.status !== 'cancelled').sort((a, b) => b.at - a.at);
    const last = past.find(r => r.at < now) || null, named = cust ? null : past.find(r => r.first || r.last);
    if (!cust && !past.length) return null;
    const words = String(cust?.name || '').trim().split(/\s+/).filter(Boolean);
    return { where: cust ? 'customers' : 'bookings', first: cust ? words[0] || '' : named?.first || '', last: cust ? words.slice(1).join(' ') : named?.last || '',
      visits: visitsOf(phone, except), lastAt: last ? last.at : null };
  }

  // ---------- the form ----------
  // f: { id (Edit), from: 'floor' | 'bookings', floorFrom, how, phone, first, last, filled (the names came from the
  //   lookup), guests, day, h, m, cal (the calendar's month while it is open), note, area, chosen (an area tapped),
  //   tables, picked: 'auto' | 'floor' | 'current', pager, nfc ({ was } after an NFC tap: Undo), prepaid, was (Edit: the
  //   booking as it was) }
  let f = null, pad = null, pagerOpen = false, toastNode = null, toastTimer = 0;
  const root = el('div', { class: 'bk-root' }); dialog.prepend(root);

  function fresh(opts = {}) {
    const now = Date.now(), k = today(), d = new Date(now + 5 * MIN);
    let h = d.getHours(), m = Math.ceil(d.getMinutes() / 5) * 5; if (m === 60) { h = (h + 1) % 24; m = 0; }
    const n = nearestOpen(k, h, m); if (n) { h = n.h; m = n.m; }
    return { id: null, from: opts.from === 'bookings' ? 'bookings' : 'floor', floorFrom: opts.floorFrom || 'home', how: 'phone', phone: '', first: '', last: '', filled: false,
      guests: 2, day: k, h, m, cal: null, note: '', area: null, chosen: false, tables: [], picked: 'auto', pager: 0, nfc: null, prepaid: 0, was: null };
  }
  function fromBooking(r, opts = {}) {
    const d = new Date(r.at), k = bizKey(r.at);
    return { ...fresh(opts), id: r.id, how: r.how, phone: r.phone, first: r.first, last: r.last, guests: r.guests, day: k, h: d.getHours(), m: d.getMinutes() - (d.getMinutes() % 5),
      note: r.note, area: F()?.areaOf?.(r.tables[0]) || null, chosen: true, tables: [...r.tables], picked: 'current', pager: r.pager && !r.pagerBackAt ? r.pager : 0, prepaid: r.prepaid || 0, was: r };
  }
  const atOf = () => atOn(f.day, f.h, f.m);
  const tablesNow = () => B()?.tablesFor?.({ at: atOf(), guests: f.guests, except: f.id }) || new Map();
  // (C2: the auto-pick joins tables only when no single free table seats the party, in any area: then each area shows
  // "join N tables")
  const areasNow = all => {
    const list = (F()?.areas?.() || []).map(a => ({ ...B().areaFor(a.id, all, f.guests), name: a.name }));
    if (list.some(a => a.pick && a.pick.kind !== 'join')) for (const a of list) if (a.pick?.kind === 'join') { a.pick = null; a.join = 0; a.seats = 0; }
    return list;
  };
  // A table free for this booking at this time: free, or (Edit) its own table with people at it now (F08: they leave
  // before the booking); never another booking's
  const freeFor = (all, id) => { const st = all.get(id)?.state; return st === 'free' || (Boolean(f?.was?.tables.includes(id)) && (st === 'busy' || st === 'maybe')); };
  // The picked tables still fit this party at this time: free for it, and seat them (joined: any)
  const stillOk = (all, ids) => ids.length > 0 && ids.every(id => freeFor(all, id)) && (ids.length > 1 || all.get(ids[0])?.fits);
  // After the guests, the day or the time change: the pick stays while it still fits; else the auto-pick (C2) in the
  // area tapped, or the best area
  function repick() {
    const all = tablesNow();
    if (f.picked !== 'auto' && stillOk(all, f.tables)) return;
    if (f.picked === 'current' && f.was && stillOk(all, f.was.tables)) { f.tables = [...f.was.tables]; return; }
    const areas = areasNow(all);
    const a = (f.chosen && areas.find(x => x.id === f.area)) || B().bestArea(areas);
    f.picked = 'auto'; f.area = a?.id || f.area || areas[0]?.id || null; f.tables = a?.pick ? [...a.pick.tables] : [];
  }
  function chooseArea(id) {
    const all = tablesNow(), a = areasNow(all).find(x => x.id === id); if (!a) return;
    f.area = id; f.chosen = true; f.picked = 'auto'; f.tables = a.pick ? [...a.pick.tables] : [];
    render();
  }

  // ---------- drawing ----------
  function render() {
    root.dataset.view = view || '';
    if (view === 'list') { renderList(); return; }
    if (view === 'wait') { renderWait(); return; }
    renderRes();
  }
  function renderRes() {
    if (!f) { root.replaceChildren(); return; }
    const all = tablesNow(), areas = areasNow(all), now = Date.now();
    const focusId = document.activeElement?.id, sel = focusId && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const parts = [top(), el('div', { class: 'bk-form' },
      el('div', { class: 'bk-left' }, customerCard(), el('div', { class: 'bk-row2' }, guestsCard(), whenCard(now)), noteCard(), reservationCard(all, now)),
      tablePanel(all, areas, now))];
    if (pad) parts.push(padLayer());
    if (pagerOpen) parts.push(pagerLayer());
    root.replaceChildren(...parts);
    if (toastNode) root.append(toastNode);
    if (focusId) { const n = root.querySelector(`#${focusId}`); if (n) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch {} } }
    carets();
  }
  function top() {
    const back = f.from === 'bookings' ? 'Reservations' : 'Floor';
    return el('header', { class: 'bk-top' },
      el('button', { type: 'button', class: 'bk-back', onclick: goBack }, icon('chevron-left'), back),
      el('h2', { id: 'bookings-title', tabindex: '-1' }, f.id ? 'Edit reservation' : 'New reservation'));
  }

  // Customer details
  function customerCard() {
    const c = country(), toggle = el('div', { class: 'bk-seg', role: 'radiogroup', 'aria-label': 'How it was booked' },
      el('button', { type: 'button', role: 'radio', 'aria-checked': String(f.how === 'phone'), class: f.how === 'phone' ? 'on' : '', onclick: () => { f.how = 'phone'; render(); } }, icon('phone'), 'Phone'),
      el('button', { type: 'button', role: 'radio', 'aria-checked': String(f.how === 'walkin'), class: `walk${f.how === 'walkin' ? ' on' : ''}`, onclick: () => { f.how = 'walkin'; render(); } }, icon('walk', 'bk-walk'), 'Walk-in'));
    const phone = field('bk-phone', 'Phone', pretty(f.phone), { type: 'tel', inputmode: 'numeric', prefix: `+${c.code}`, oninput: e => typePhone(e.target) });
    const first = field('bk-first', 'First name', f.first, { autocapitalize: 'words', oninput: e => { f.first = e.target.value.slice(0, 40); f.filled = false; renderSoon(); } });
    const last = field('bk-last', 'Last name', f.last, { autocapitalize: 'words', oninput: e => { f.last = e.target.value.slice(0, 40); f.filled = false; renderSoon(); } });
    return el('section', { class: 'bk-card bk-cust', 'aria-labelledby': 'bk-cust-h' },
      el('h3', { id: 'bk-cust-h' }, 'Customer details'), toggle,
      el('div', { class: 'bk-fields' }, phone, first, last), guestLine());
  }
  // The green line under the phone: who this is (New: found in the customers or the past bookings; Edit: how and when it
  // was booked, and by whom)
  function guestLine() {
    if (f.id && f.was) {
      const r = f.was, v = visitsOf(r.phone, r.id), created = r.createdAt, by = firstOf(r.by);
      const when = bizKey(created) === today() ? clock(created) : `${new Date(created).getDate()} ${MONTHS[new Date(created).getMonth()]}, ${clock(created)}`;
      const rest = [v ? `${v} visit${v === 1 ? '' : 's'}` : '', r.how === 'walkin' ? 'booked in person' : 'booked by phone', by, when].filter(Boolean).join(' · ');
      return el('p', { class: 'bk-guest' }, icon('user-round'), el('b', {}, v ? 'Returning guest' : 'New guest'), ` · ${rest}`);
    }
    const g = guestOf(f.phone); if (!g) return null;
    const d = g.lastAt ? new Date(g.lastAt) : null;
    const rest = [g.where === 'customers' ? 'found in your customers' : 'found in your bookings', g.visits ? `${g.visits} visit${g.visits === 1 ? '' : 's'}` : '', d ? `last booked ${d.getDate()} ${MONTHS[d.getMonth()]}` : ''].filter(Boolean).join(' · ');
    return el('p', { class: 'bk-guest' }, icon('user-round'), el('b', {}, 'Returning guest'), ` · ${rest}`);
  }
  function typePhone(input) {
    const digits = input.value.replace(/\D/g, '').slice(0, maxDigits()), caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/\D/g, '').length;
    f.phone = digits;
    const g = guestOf(digits);
    if (g && (!(f.first || f.last) || f.filled)) { f.first = g.first; f.last = g.last; f.filled = true; }
    else if (!g && f.filled) { f.first = ''; f.last = ''; f.filled = false; }
    const shown = pretty(digits); input.value = shown;
    let pos = 0, seen = 0; while (pos < shown.length && seen < before) { if (/\d/.test(shown[pos])) seen++; pos++; }
    try { input.setSelectionRange(pos, pos); } catch {}
    renderSoon();
  }
  // A field (A5): the label above, the words, the line under them (blue while typing, with our blinking cursor)
  function field(id, label, value, { type = 'text', inputmode = null, prefix = null, autocapitalize = 'off', oninput, placeholder = null } = {}) {
    const input = el('input', { id, type, inputmode, autocomplete: 'off', autocapitalize, spellcheck: 'false', enterkeyhint: 'done', 'aria-label': label, placeholder, oninput });
    input.value = value;
    return el('label', { class: `bk-f${prefix ? ' tel' : ''}`, for: id }, el('span', { class: 'bk-fl' }, label),
      el('span', { class: 'bk-fv' }, prefix ? el('span', { class: 'bk-pre', 'aria-hidden': 'true' }, prefix) : null, input, el('i', { class: 'bk-cur', 'aria-hidden': 'true', hidden: true }), el('span', { class: 'bk-ruler', 'aria-hidden': 'true' })));
  }
  // Our cursor (as the Counter's): blue, 2.5 wide, blinking where the typing goes
  function carets() {
    for (const box of root.querySelectorAll('.bk-fv')) {
      const input = box.querySelector('input'), cur = box.querySelector('.bk-cur'), ruler = box.querySelector('.bk-ruler');
      const on = document.activeElement === input, a = input.selectionStart ?? input.value.length;
      cur.hidden = !on || a !== (input.selectionEnd ?? a); box.closest('.bk-f')?.classList.toggle('on', on);
      if (cur.hidden) continue;
      ruler.textContent = input.value.slice(0, a);
      cur.style.setProperty('--x', `${input.offsetLeft + Math.min(input.clientWidth, Math.max(0, ruler.offsetWidth - input.scrollLeft))}px`);
    }
  }
  let soon = 0;
  function renderSoon() { cancelAnimationFrame(soon); soon = requestAnimationFrame(render); }
  document.addEventListener('selectionchange', () => { if (dialog.open && (f || wf)) carets(); });
  root.addEventListener('focusin', () => carets()); root.addEventListener('focusout', () => setTimeout(carets));

  // Number of guests: − / + (the Counter's glyphs, the number in its quantity blue); the number tapped: the number pad
  // (s: the form, reservation or waitlist; then: what changes with the guests)
  function guestsCard(s = f, then = repick) {
    const step = d => { s.guests = Math.max(1, Math.min(99, s.guests + d)); then(); render(); };
    return el('section', { class: 'bk-card bk-guests', 'aria-labelledby': 'bk-guests-h' }, el('h3', { id: 'bk-guests-h' }, 'Number of guests'),
      el('div', { class: 'bk-step' },
        el('button', { type: 'button', class: 'bk-sb', 'aria-label': 'One guest less', disabled: s.guests <= 1, onclick: () => step(-1) }, svgOf('0 0 24 24', '<path d="M3.5 12h17"/>')),
        el('button', { type: 'button', class: 'bk-sn', 'aria-label': `${s.guests} guests. Tap to type the number`, onclick: () => { pad = { value: '', s, then }; render(); } }, String(s.guests)),
        el('button', { type: 'button', class: 'bk-sb', 'aria-label': 'One guest more', disabled: s.guests >= 99, onclick: () => step(1) }, svgOf('0 0 24 24', '<path d="M3.5 12h17M12 3.5v17"/>'))));
  }

  // When: the day, the wheels, what it comes to
  function whenCard(now) {
    const k = today(), tomorrow = addDays(k, 1), other = f.day !== k && f.day !== tomorrow;
    const pickDay = d => { f.day = d; f.cal = null; fitTime(); repick(); render(); };
    const chip = (label, on, fn, ic = null, closed = false) => el('button', { type: 'button', 'aria-pressed': String(on), class: on ? 'on' : '', disabled: closed, onclick: fn }, ic, label);
    const days = el('div', { class: 'bk-seg bk-days', role: 'group', 'aria-label': 'Day' },
      chip('Today', f.day === k, () => pickDay(k), null, !hoursOn(k)), chip('Tomorrow', f.day === tomorrow, () => pickDay(tomorrow), null, !hoursOn(tomorrow)),
      chip(other ? dateWords(f.day) : 'Pick a date', other, () => { f.cal = f.cal ? null : (other ? f.day : k).slice(0, 7); render(); }, icon('calendar')));
    const at = atOf(), passed = at <= now, closed = !hoursOn(f.day);
    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1)), minutes = Array.from({ length: 12 }, (_, i) => pad2(i * 5)), fives = minutes.map((_, i) => i * 5);
    const hourOf = i => (i + 1) % 12 + (f.h >= 12 ? 12 : 0), changed = () => { fitTime(); repick(); render(); };
    const wheels = el('div', { class: 'bk-wheels' },
      wheel('Hour', hours, (f.h + 11) % 12, true, i => { f.h = hourOf(i); }, changed, i => fives.some(m => okAt(f.day, hourOf(i), m))),
      wheel('Minutes', minutes, f.m / 5, true, i => { f.m = i * 5; }, changed, i => okAt(f.day, f.h, i * 5)),
      wheel('AM or PM', ['AM', 'PM'], f.h >= 12 ? 1 : 0, false, i => { f.h = f.h % 12 + (i ? 12 : 0); f.half = Boolean(i); }, changed, i => Array.from({ length: 12 }, (_, x) => x + i * 12).some(h => fives.some(m => okAt(f.day, h, m)))));
    const sum = closed ? [el('b', {}, whenWords(f.day, at)), el('em', {}, ` · closed ${f.day === k ? 'today' : f.day === tomorrow ? 'tomorrow' : `on ${dateWords(f.day)}`} · pick another day`)]
      : passed ? [el('b', {}, whenWords(f.day, at)), el('em', {}, ` · ${clock(at)} has passed · pick a later time`)]
        : [el('b', {}, whenWords(f.day, at)), ` · ${f.day === k ? inWords(at, now) : f.day === tomorrow ? 'tomorrow' : inDays(f.day)} · table shows Reserved from ${clock(at - HOUR)}`];
    return el('section', { class: 'bk-card bk-when', 'aria-labelledby': 'bk-when-h',
      onclick: e => { if (f.cal && !e.target.closest?.('.bk-cal, .bk-days')) { f.cal = null; render(); } } },
    el('h3', { id: 'bk-when-h' }, 'When'), days, f.cal ? calendar() : null, wheels, el('p', { class: 'bk-sum', 'aria-live': 'polite' }, ...sum));
  }
  const inDays = k => { const n = Math.round((keyDate(k) - keyDate(today())) / (24 * HOUR)); return `in ${n} days`; };
  // (am / pm turned, a day changed: the nearest time inside the hours)
  function fitTime() { const half = f.half ?? null; f.half = null; if (okAt(f.day, f.h, f.m)) return; const n = nearestOpen(f.day, f.h, f.m, half); if (n) { f.h = n.h; f.m = n.m; } }
  // Pick a date: the Counter's month calendar (past days and closed days can't be picked)
  function calendar() {
    const [y, mo] = f.cal.split('-').map(Number), first = new Date(y, mo - 1, 1), start = new Date(y, mo - 1, 1 - (first.getDay() + 6) % 7), k0 = today();
    const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const shift = n => { const t = new Date(y, mo - 1 + n, 1); f.cal = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`; render(); };
    return el('div', { class: 'bk-cal', role: 'group', 'aria-label': 'Pick a date' },
      el('div', { class: 'bk-cal-h' }, el('b', {}, first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
        el('button', { type: 'button', 'aria-label': 'Previous month', disabled: `${y}-${pad2(mo)}` <= k0.slice(0, 7), onclick: () => shift(-1) }, icon('chevron-left')),
        el('button', { type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron-right'))),
      el('div', { class: 'bk-cal-w', 'aria-hidden': 'true' }, ...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => el('span', {}, w))),
      el('div', { class: 'bk-cal-g' }, ...cells.map(c => {
        const k = dkey(c), out = c.getMonth() !== mo - 1, past = k < k0, closed = !out && !past && !hoursOn(k);
        return el('button', { type: 'button', class: `${out || past || closed ? 'off' : ''}${k === k0 ? ' today' : ''}${k === f.day && !out ? ' on' : ''}`.trim() || null, disabled: out || past || closed,
          'aria-pressed': String(k === f.day), 'aria-label': c.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => { f.day = k; f.cal = null; fitTime(); repick(); render(); } }, String(c.getDate()));
      })));
  }
  // A wheel (the Counter's Schedule wheels, as drawn here: three rows, the one picked in the blue band): drag it, tap a
  // row, turn the mouse wheel or use the arrow keys; hours and minutes go round, AM / PM doesn't; rows outside business
  // hours are greyed and turning goes past them
  function wheel(label, values, index, loop, pick, changed, ok = () => true) {
    const n = values.length, box = el('div', { class: 'bk-wh', role: 'listbox', tabindex: '0', 'aria-label': label });
    const band = el('div', { class: 'bk-wh-band', 'aria-hidden': 'true' }), rows = [];
    let cur = index, drag = 0, startY = null, moved = false;
    const rowH = () => (band.offsetHeight ? band.offsetHeight * 36 / 42 : 36);
    const at = i => (loop ? ((i % n) + n) % n : i);
    const paint = () => {
      rows.splice(0).forEach(r => r.remove());
      for (let i = -2; i <= 2; i++) {
        const v = cur + i; if (!loop && (v < 0 || v >= n)) continue;
        const dist = Math.abs(i + drag / rowH());
        const row = el('div', { class: `bk-wh-row${dist < 0.5 ? ' sel' : ''}${ok(at(v)) ? '' : ' off'}`, role: 'option', 'aria-selected': String(i === 0), 'aria-disabled': ok(at(v)) ? null : 'true' }, values[at(v)]);
        row.style.setProperty('--i', String(i)); if (drag) row.style.transform = `translateY(${drag}px)`;
        rows.push(row); box.append(row);
      }
    };
    const go = step => {
      let v = step ? (loop ? at(cur + step) : Math.max(0, Math.min(n - 1, cur + step))) : cur;
      for (let k = 0; v !== cur && !ok(v) && k < n; k++) { const w = v + Math.sign(step); v = loop ? at(w) : w < 0 || w >= n ? cur : w; }
      if (!ok(v)) v = cur;
      drag = 0; if (v !== cur) { cur = v; pick(cur); changed(); return; }
      paint();
    };
    box.append(band);
    box.addEventListener('pointerdown', e => { startY = e.clientY; moved = false; drag = 0; box.setPointerCapture?.(e.pointerId); });
    box.addEventListener('pointermove', e => {
      if (startY == null) return;
      drag = e.clientY - startY; if (Math.abs(drag) > 6) moved = true;
      if (!loop) drag = Math.max(-(n - 1 - cur) * rowH(), Math.min(cur * rowH(), drag));
      paint();
    });
    box.addEventListener('pointerup', e => {
      if (startY == null) return;
      const r = box.getBoundingClientRect(), step = moved ? Math.round(-drag / rowH()) : Math.round((e.clientY - r.top - r.height / 2) / rowH());
      startY = null; go(step);
    });
    box.addEventListener('pointercancel', () => { startY = null; go(0); });
    box.addEventListener('wheel', e => { e.preventDefault(); go(Math.sign(e.deltaY)); }, { passive: false });
    box.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); go(e.key === 'ArrowDown' ? 1 : -1); } });
    paint();
    return box;
  }

  // Note (optional)
  function noteCard() {
    const input = el('input', { id: 'bk-note', type: 'text', maxlength: '200', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', 'aria-label': 'Note', placeholder: 'Birthday, high chair, window side...',
      oninput: e => { f.note = e.target.value; carets(); } });
    input.value = f.note;
    return el('section', { class: 'bk-card bk-note', 'aria-labelledby': 'bk-note-h' }, el('h3', { id: 'bk-note-h' }, 'Note'), el('small', { class: 'bk-hint' }, 'optional'),
      el('label', { class: 'bk-f bk-nf', for: 'bk-note' }, el('span', { class: 'bk-fv' }, pencilIcon(), input, el('i', { class: 'bk-cur', 'aria-hidden': 'true', hidden: true }), el('span', { class: 'bk-ruler', 'aria-hidden': 'true' }))));
  }

  // The Reservation card: the table (or tables joined) as they stand on the floor, what it is, Assign pager, the
  // summary row
  function reservationCard(all, now) {
    const at = atOf(), ts = f.tables.map(id => all.get(id) || F()?.table?.(id)).filter(Boolean), areaName = ts.length ? (F()?.areas?.().find(a => a.id === ts[0].area)?.name || '') : '';
    const seats = ts.reduce((n, t) => n + (t.seats || 0), 0), names = ts.map(t => t.name);
    const hint = f.picked === 'current' ? 'current table' : f.picked === 'floor' ? 'picked on the Floor' : 'auto-picked table';
    let title, sub;
    if (!ts.length) { title = `No tables available for ${f.guests} guest${f.guests === 1 ? '' : 's'} at ${clock(at)}`; sub = 'Pick another area, day or time'; }
    else {
      title = `${ts.length > 1 ? `Tables ${names.join(' + ')}` : `Table ${names[0]}`}${areaName ? ` · ${areaName}` : ''}`;
      if (f.picked === 'current' && f.was && sameTables(f.tables, f.was.tables)) sub = `${seats} seats · reserved for this booking`;
      else if (f.picked === 'auto' && ts.length === 1 && ts[0].seats > f.guests) sub = `No ${f.guests}-seat table free · picked Table ${names[0]} (${seats} seats)`;
      else sub = `${seats} seats · ${ts.length > 1 ? 'joined · ' : ''}free ${freeWords(f.day, at)}`;
    }
    const pagerBtn = f.pager
      ? el('button', { type: 'button', class: 'bk-pager on', onclick: () => { pagerOpen = true; render(); } }, icon('vibration'), `Pager ${f.pager}`)
      : el('button', { type: 'button', class: 'bk-pager', onclick: () => { pagerOpen = true; render(); } }, icon('vibration'), 'Assign pager');
    const pagerHint = f.nfc ? el('div', { class: 'bk-ph nfc' }, el('b', {}, 'Assigned by NFC tap'), el('button', { type: 'button', onclick: undoPager }, 'Undo'))
      : el('div', { class: 'bk-ph' }, el('small', {}, 'optional'), el('span', {}, 'or tap a pager on the NFC spot'));
    const cell = (label, value, cls = '') => el('div', { class: `bk-sc ${cls}`.trim() }, el('small', {}, label), el('b', {}, value));
    const phone = f.phone ? `+${country().code} ${pretty(f.phone)}` : '—';
    return el('section', { class: 'bk-card bk-res', 'aria-labelledby': 'bk-res-h' }, el('h3', { id: 'bk-res-h' }, 'Reservation'), el('small', { class: 'bk-hint' }, ts.length ? hint : ''),
      el('div', { class: 'bk-pick' }, el('div', { class: `bk-tiles${ts.length ? '' : ' none'}` }, ...tiles(ts)),
        el('div', { class: 'bk-what' }, el('b', {}, title), el('span', {}, ts.length ? icon('chair') : null, sub))),
      el('div', { class: 'bk-pg' }, pagerBtn, pagerHint),
      el('div', { class: `bk-sumrow${f.pager ? ' pg' : ''}` }, cell('Customer', [f.first, f.last].filter(Boolean).join(' ') || '—'), cell('Phone', phone), cell('Guests', String(f.guests)), cell('When', whenWords(f.day, at)),
        f.pager ? cell('Pager', `Pager ${f.pager}`, 'violet') : null));
  }
  const sameTables = (a, b) => a.length === b.length && a.every(t => b.includes(t));
  // The tables drawn in their own shapes (a rectangle 124 x 70, a square or a round one 70 across); joined, side by side
  // sharing the rectangles' room by their sizes on the floor plan
  function tiles(ts) {
    if (!ts.length) return [el('i', { class: 'bk-tile none', 'aria-hidden': 'true' })];
    const rects = ts.filter(t => t.shape === 'rect'), room = Math.min(3, ts.length) * 124 - (ts.length - rects.length) * 70, sum = rects.reduce((n, t) => n + (t.w || 1), 0);
    return ts.map(t => el('i', { class: `bk-tile ${t.shape}`, style: t.shape === 'rect' ? `width:${fu(ts.length > 1 ? Math.round(room * (t.w || 1) / sum) : 124)}` : null },
      el('b', {}, t.name), el('em', { 'aria-hidden': 'true' }, svgOf('0 0 24 24', '<path d="M6.5 12.5l3.5 3.5 7.5-8"/>'))));
  }

  // Table (right): the areas, the line on what free means, Pick a table on the Floor, Prepay & save, Save
  function tablePanel(all, areas, now) {
    const at = atOf(), soonNow = at - now <= (B()?.SOON || 2 * HOUR), anyFree = areas.some(a => a.free), anyMaybe = soonNow && areas.some(a => a.maybe);
    const head = f.day === today() ? `free for ${f.guests} guest${f.guests === 1 ? '' : 's'} at ${clock(at)}` : `free for ${f.guests} guest${f.guests === 1 ? '' : 's'} · ${f.day === addDays(today(), 1) ? `tomorrow ${clock(at)}` : `${dateWords(f.day)}, ${clock(at)}`}`;
    const rows = areas.map(a => {
      const on = a.id === f.area, none = !a.free && !a.join && !(soonNow && a.maybe);
      const count = a.free ? [`${a.free} free`, soonNow && a.maybe ? [' · ', el('em', {}, `${a.maybe} maybe`)] : null]
        : a.join ? [`join ${a.join} tables`, soonNow && a.maybe ? [' · ', el('em', {}, `${a.maybe} maybe`)] : null]
          : soonNow && a.maybe ? el('em', {}, `${a.maybe} maybe`) : 'none free';
      return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `bk-area${on ? ' on' : ''}${none ? ' none' : ''}`, disabled: none && !on, onclick: () => chooseArea(a.id) },
        el('i', { class: 'bk-radio', 'aria-hidden': 'true' }), el('b', {}, a.name), el('span', {}, count));
    });
    const sel = areas.find(a => a.id === f.area), joinN = sel?.join || areas.find(a => a.join)?.join || 0;
    const own = f.id && f.was && f.was.tables.length ? `${f.was.tables.length > 1 ? 'Tables' : 'Table'} ${f.was.tables.map(id => F()?.tableName?.(id) || id).join(' + ')} ${f.was.tables.length > 1 ? 'are' : 'is'} this booking's own ${f.was.tables.length > 1 ? 'tables' : 'table'}` : '';
    const freeLine = soonNow ? [el('b', {}, 'Free'), ` = seats ${f.guests} or more and free at ${clock(at)}`] : [el('b', {}, 'Free'), ` = seats ${f.guests} or more and not already booked for ${f.day === today() ? clock(at) : f.day === addDays(today(), 1) ? `tomorrow, ${clock(at)}` : `${dateWords(f.day)}, ${clock(at)}`}`];
    const parts = [];
    if (anyFree || !joinN) parts.push(freeLine); else parts.push([`No single table seats ${f.guests}`]);
    if (anyMaybe) parts.push([el('b', {}, 'maybe'), ` = seats ${f.guests}+, occupied now, bill already printed`]);
    if (joinN) parts.push([el('b', {}, `join ${joinN}`), ` = the auto-pick joins ${joinN} neighbouring free tables`]);
    if (own) parts.push([own]);
    const line = el('p', { class: 'bk-free' }, ...parts.flatMap((p, i) => (i ? [' · ', ...p] : p)));
    const can = canSave(now);
    return el('aside', { class: 'bk-card bk-panel', 'aria-labelledby': 'bk-table-h' },
      el('h3', { id: 'bk-table-h' }, 'Table'), el('small', { class: 'bk-hint' }, head),
      el('p', { class: 'bk-tip' }, icon('check'), 'Pick an area — the best free table is ', el('b', {}, 'auto-picked')),
      el('div', { class: 'bk-areas', role: 'radiogroup', 'aria-label': 'Areas' }, ...rows), line,
      el('button', { type: 'button', class: 'bk-floor', onclick: pickOnFloor }, floorIcon(), 'Pick a table on the Floor'),
      el('div', { class: 'bk-btns' },
        f.prepaid ? el('button', { type: 'button', class: 'bk-prepay paid', disabled: true }, icon('check'), `Prepaid ₹${Math.round(f.prepaid / 100).toLocaleString('en-IN')}`)
          : el('button', { type: 'button', class: 'bk-prepay', disabled: !can, onclick: () => say({ b: 'Prepay', t: ' comes with the Pay screen' }) }, el('span', { class: 'bk-rs', 'aria-hidden': 'true' }, '₹'), 'Prepay & save'),
        el('button', { type: 'button', class: 'bk-save', disabled: !can, onclick: save }, icon('check'), f.id ? 'Save changes' : 'Save reservation')));
  }
  // Saving needs a table that is still free for it (C1), a name, a whole phone number when one is typed, and a time
  // that hasn't passed, on a day the restaurant is open
  function canSave(now = Date.now()) {
    if (!f || !f.tables.length || !(f.first.trim() || f.last.trim())) return false;
    if (f.phone && !phoneOk(f.phone)) return false;
    const at = atOf(); if (at <= now || !okAt(f.day, f.h, f.m)) return false;
    const all = tablesNow(); return f.tables.every(id => freeFor(all, id));
  }
  function save() {
    if (!canSave()) return;
    const rec = B().saveReservation({ id: f.id || undefined, first: f.first.trim(), last: f.last.trim(), phone: f.phone, code: country().code, how: f.how, guests: f.guests, at: atOf(),
      tables: f.tables, note: f.note.trim(), pager: f.pager || 0, pagerAt: f.pager ? (f.was?.pager === f.pager ? f.was.pagerAt : Date.now()) : null, pagerBackAt: null });
    if (!rec) { say('Pick a table first'); return; }
    if (rec.pager) B().pagerTaken?.(rec.pager, rec.id);
    const words = `${rec.tables.length > 1 ? 'Tables' : 'Table'} ${rec.tables.map(id => F()?.tableName?.(id) || id).join(' + ')}`, who = rec.first || B().nameOf(rec) || 'Guest';
    const msg = { b: f.id ? `${who}’s reservation changed` : `${who}’s reservation saved`, t: ` · ${words}, ${whenWords(bizKey(rec.at), rec.at)}` };
    leave(msg, rec.id);
  }

  // ---------- Pick a table on the Floor (C3) ----------
  function pickOnFloor() {
    const at = atOf(), name = [f.first, f.last].filter(Boolean).join(' ').trim();
    F()?.open({ reserve: { back: f.id ? 'Edit reservation' : 'New reservation', who: name, guests: f.guests, at, except: f.id, when: whenWords(f.day, at), tables: [...f.tables], area: f.area,
      picked: f.picked, join: f.tables.length > 1,
      onPick: ids => { if (!f || !ids.length) return; f.tables = ids; f.area = F()?.areaOf?.(ids[0]) || f.area; f.picked = f.was && sameTables(ids, f.was.tables) ? 'current' : 'floor'; render(); } } });
  }

  // ---------- Number of guests: the number pad (N03) ----------
  function padLayer() {
    const v = pad.value, press = k => {
      if (k === 'clear') pad.value = ''; else if (k === 'back') pad.value = pad.value.slice(0, -1);
      else if (pad.value.length < 2 && !(k === '0' && !pad.value)) pad.value += k;
      render();
    };
    const s = pad.s || f, then = pad.then || repick;
    const done = () => { const n = Number(pad.value); if (n >= 1) { s.guests = Math.min(99, n); then(); } pad = null; render(); };
    const key = (k, label, cls = '') => el('button', { type: 'button', class: `bk-key ${cls}`.trim(), 'aria-label': k === 'back' ? 'Delete' : null, onclick: () => press(k) }, label);
    return el('div', { class: 'bk-scrim', onclick: e => { if (e.target === e.currentTarget) { pad = null; render(); } } },
      el('div', { class: 'bk-pad', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bk-pad-t' },
        el('div', { class: 'bk-pad-h' }, el('h3', { id: 'bk-pad-t' }, 'Number of guests'), el('button', { type: 'button', class: 'bk-x', 'aria-label': 'Close', onclick: () => { pad = null; render(); } }, icon('x'))),
        el('div', { class: 'bk-pad-v', role: 'status', 'aria-label': v ? `${v} guests` : `Type the number of guests (now ${s.guests})` }, v ? el('span', {}, v) : null, el('i', { 'aria-hidden': 'true' })),
        el('div', { class: 'bk-keys' }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => key(k, k)), key('clear', 'Clear', 'fn'), key('0', '0'),
          key('back', svgOf('0 0 24 24', '<path d="M8.2 5h11.3A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H8.2a1.5 1.5 0 0 1-1.1-.5L2.5 12l4.6-6.5A1.5 1.5 0 0 1 8.2 5Zm3.4 4.2L14.4 12l-2.8 2.8 1.3 1.3 2.8-2.8 2.8 2.8 1.3-1.3-2.8-2.8 2.8-2.8-1.3-1.3-2.8 2.8-2.8-2.8Z"/>', 'bk-del'), 'fn')),
        el('button', { type: 'button', class: 'bk-done', onclick: done }, 'Done')));
  }
  window.addEventListener('keydown', e => {
    if (!dialog.open || !pad) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); if (pad.value.length < 2 && !(e.key === '0' && !pad.value)) { pad.value += e.key; render(); } }
    else if (e.key === 'Backspace') { e.preventDefault(); pad.value = pad.value.slice(0, -1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); root.querySelector('.bk-done')?.click(); }
  });

  // ---------- Assign pager (A6): the Counter's pop-up; a pager tapped on the NFC spot: at once, with Undo ----------
  // (the form on screen: the reservation's or the waitlist's)
  const form = () => (view === 'wait' ? wf : view === 'res' ? f : null);
  function pagerLayer() {
    const host = el('div', { class: 'bk-pagerhost' }), s = form();
    const built = s && window.RestroCounter?.pagerPicker?.({ current: s.pager, except: s.id, onPick: n => { s.pager = n; s.nfc = null; pagerOpen = false; render(); }, onClose: () => { pagerOpen = false; render(); } });
    if (built) host.append(built); else { pagerOpen = false; }
    return host;
  }
  function undoPager() { const s = form(); if (!s?.nfc) return; s.pager = s.nfc.was; s.nfc = null; render(); }
  // (counter.js asks first: true when Bookings took the tap) A form on screen: the pager is theirs at once, with Undo.
  // The lists with nothing open (A6): the guest or the booking holding that pager, picked.
  function pagerTapped(n) {
    if (!dialog.open || !view) return false;
    if (pad || pagerOpen || L.pop || L.menu) return true;
    if (view === 'list') { listPager(n); return true; }
    const s = form(); if (!s) return false;
    const busy = window.RestroCounter?.pagerInUse?.(n, s.id);
    if (busy) { say({ b: `Pager ${n}`, t: ' is in use' }); return true; }
    s.nfc = { was: s.pager }; s.pager = n; render(); return true;
  }

  // ======================================================================================================================
  // The app (D: B01–B11)
  // ======================================================================================================================
  // L: the tab; where it was opened from (Home or the Floor: "‹ Floor" goes to the Floor either way, Back goes Home when
  // it was opened there) and the Floor's own back (Home or the Counter); per tab the day (a business day; null = today),
  // the filter ('all' or a status) and the one picked; the menu open ('day' | 'filter') and the date menu's month; the
  // pop-up open ({ kind: 'cancel' | 'remove', id, why }).
  const L = { tab: 'waitlist', from: 'home', floorFrom: 'home', day: { waitlist: null, reservations: null }, filter: { waitlist: 'all', reservations: 'all' },
    sel: { waitlist: null, reservations: null }, menu: null, cal: null, pop: null };
  let view = null; // 'list' (the app) · 'wait' (Add / Edit waitlist) · 'res' (New / Edit reservation)
  const W_STATUS = [['waiting', 'Waiting'], ['notified', 'Notified'], ['seated', 'Seated'], ['left', 'Left'], ['noshow', 'No-show']];
  const R_STATUS = [['upcoming', 'Upcoming'], ['seated', 'Seated'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['noshow', 'No-show']];
  // (D: Seated blue, Left grey, Cancelled red, No-show orange; Completed grey as Left)
  const TONE = { seated: 'blue', left: 'grey', completed: 'grey', cancelled: 'red', noshow: 'orange', waiting: 'blue', notified: 'blue', upcoming: 'blue' };
  const activeW = w => w.status === 'waiting' || w.status === 'notified';
  const dayOf = tab => L.day[tab] || today();
  const dayLabel = k => (k === today() ? 'Today' : k === addDays(today(), -1) ? 'Yesterday' : k === addDays(today(), 1) ? 'Tomorrow' : dateWords(k));
  const areaName = id => (id === 'any' ? 'Any area' : F()?.areas?.().find(a => a.id === id)?.name || '');
  const tablesWords = ids => ids.map(id => F()?.tableName?.(id) || id).join(' + ');
  const initialsOf = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const phoneWords = x => (x.phone ? `+${x.code || country().code} ${pretty(x.phone)}` : '');
  const nameWords = x => B()?.nameOf?.(x) || 'Guest';

  // What a tab shows for a day: who is on the list (or the bookings still to come) and the others (Earlier today), each
  // through the filter; the counts for the filter menu; #N on the list
  function listData(tab, now = Date.now()) {
    const k = dayOf(tab), fl = L.filter[tab];
    const keep = x => fl === 'all' || x.status === fl;
    if (tab === 'waitlist') {
      const all = (B()?.waitlist?.() || []).filter(w => bizKey(w.addedAt) === k);
      const active = all.filter(activeW).sort((a, b) => a.addedAt - b.addedAt), past = all.filter(w => !activeW(w)).sort((a, b) => b.addedAt - a.addedAt);
      return { tab, k, all, active: active.filter(keep), past: past.filter(keep), pos: new Map(active.map((w, i) => [w.id, i + 1])),
        counts: Object.fromEntries(W_STATUS.map(([s]) => [s, all.filter(w => w.status === s).length])), shown: all.filter(keep).length, now };
    }
    const all = (B()?.reservations?.() || []).filter(r => bizKey(r.at) === k);
    const active = all.filter(r => r.status === 'upcoming').sort((a, b) => a.at - b.at), past = all.filter(r => r.status !== 'upcoming').sort((a, b) => b.at - a.at);
    return { tab, k, all, active: active.filter(keep), past: past.filter(keep), pos: new Map(),
      counts: Object.fromEntries(R_STATUS.map(([s]) => [s, all.filter(r => r.status === s).length])), shown: all.filter(keep).length, now };
  }
  // The one picked: as tapped, else the first on the list
  const pickedOf = d => { const list = [...d.active, ...d.past]; return list.find(x => x.id === L.sel[d.tab]) || list[0] || null; };

  function renderList() {
    const now = Date.now(), d = listData(L.tab, now), x = pickedOf(d);
    const parts = [listTop(), el('section', { class: 'bl-left', 'aria-label': L.tab === 'waitlist' ? 'Waitlist' : 'Reservations' }, dropdowns(d), listRows(d, x, now)), detail(d, x, now)];
    if (L.menu) parts.push(el('div', { class: 'bl-catch', onclick: () => { L.menu = null; L.cal = null; render(); } }), L.menu === 'filter' ? filterMenu(d) : dayMenu(d));
    if (L.pop) parts.push(popLayer(d, now));
    if (pagerOpen) parts.push(pagerLayer());
    const top = root.querySelector('.bl-scroll')?.scrollTop || 0;
    root.replaceChildren(...parts);
    const sc = root.querySelector('.bl-scroll'); if (sc) sc.scrollTop = top;
    if (toastNode) root.append(toastNode);
  }
  // The top: "‹ Floor", Waitlist | Reservations (no counts), the blue button of the tab
  function listTop() {
    const tab = (id, ic, label) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(L.tab === id), class: L.tab === id ? 'on' : '',
      onclick: () => { if (L.tab !== id) { L.tab = id; L.menu = null; L.cal = null; render(); } } }, icon(ic), label);
    return el('header', { class: 'bl-top' },
      el('h2', { id: 'bookings-title', class: 'bl-hide', tabindex: '-1' }, 'Bookings'),
      el('button', { type: 'button', class: 'bl-floor', onclick: toFloor }, icon('chevron-left'), 'Floor'),
      el('div', { class: 'bl-tabs', role: 'tablist', 'aria-label': 'Waitlist or reservations' }, tab('waitlist', 'timer', 'Waitlist'), tab('reservations', 'calendar', 'Reservations')),
      el('button', { type: 'button', class: 'bl-add', onclick: L.tab === 'waitlist' ? () => openWait(null) : () => window.RestroBookingsApp.newReservation({ from: 'bookings' }) },
        icon('plus'), L.tab === 'waitlist' ? 'Add to waitlist' : 'New reservation'));
  }
  // Today ▾ and All ▾ (the number shown)
  function dropdowns(d) {
    const list = d.tab === 'waitlist' ? W_STATUS : R_STATUS, fl = L.filter[d.tab];
    const menu = which => { L.menu = L.menu === which ? null : which; L.cal = L.menu === 'day' ? (d.k).slice(0, 7) : null; render(); };
    return el('div', { class: 'bl-dds' },
      el('button', { type: 'button', class: `bl-dd day${L.menu === 'day' ? ' open' : ''}`, 'aria-haspopup': 'dialog', 'aria-expanded': String(L.menu === 'day'), onclick: () => menu('day') },
        icon('calendar'), el('b', {}, dayLabel(d.k)), icon('chevron-down', 'bl-cv')),
      el('button', { type: 'button', class: `bl-dd fl${L.menu === 'filter' ? ' open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(L.menu === 'filter'), onclick: () => menu('filter') },
        icon('list-filter'), el('b', {}, fl === 'all' ? 'All' : list.find(([s]) => s === fl)?.[1] || 'All'), el('em', {}, String(d.shown)), icon('chevron-down', 'bl-cv')));
  }
  // The list: who is on it now (or the bookings still to come, under NOW), then Earlier today, greyed
  function listRows(d, x, now) {
    const out = [], isToday = d.k === today(), w = d.tab === 'waitlist';
    if (w) {
      if (isToday) {
        const n = d.active.length, g = d.active.reduce((s, y) => s + y.guests, 0);
        out.push(el('p', { class: 'bl-sec' }, n ? `On the list · ${plural(n, 'group')} · ${plural(g, 'guest')}` : 'On the list · nobody waiting'));
        out.push(...d.active.map(y => waitRow(y, d, x, now)));
        if (d.past.length) out.push(el('p', { class: 'bl-sec' }, 'Earlier today'), ...d.past.map(y => pastRow(y, x)));
      } else {
        out.push(el('p', { class: 'bl-sec' }, `${dateWords(d.k)} · ${plural(d.active.length + d.past.length, 'group')}`), ...[...d.active, ...d.past].sort((a, b) => b.addedAt - a.addedAt).map(y => pastRow(y, x)));
      }
    } else if (isToday) {
      out.push(el('p', { class: 'bl-now' }, el('span', {}, `Now · ${clock(now)}`), el('i', { 'aria-hidden': 'true' })));
      out.push(...d.active.map(r => resRow(r, x, now)));
      if (!d.active.length) out.push(el('p', { class: 'bl-empty' }, L.filter.reservations === 'all' || L.filter.reservations === 'upcoming' ? 'No more bookings today' : ''));
      if (d.past.length) out.push(el('p', { class: 'bl-sec' }, 'Earlier today'), ...d.past.map(r => pastRow(r, x)));
    } else {
      out.push(el('p', { class: 'bl-sec' }, `${dateWords(d.k)} · ${plural(d.active.length + d.past.length, 'booking')}`), ...d.active.map(r => resRow(r, x, now)), ...d.past.map(r => pastRow(r, x)));
    }
    if (!d.active.length && !d.past.length && !(w && isToday) && !(!w && isToday)) out.push(el('p', { class: 'bl-empty' }, w ? 'Nobody on the waitlist that day' : 'No bookings that day'));
    return el('div', { class: 'bl-scroll' }, ...out);
  }
  const pick = (tab, id) => { L.sel[tab] = id; render(); };
  // A waitlist row: #N; the name, the guests · the area · notified · no phone; the pager (or None); the minutes waited
  // against the quote (black on time, orange from 5 minutes before it: D)
  function waitRow(w, d, x, now) {
    const waited = Math.max(0, Math.floor((now - w.addedAt) / MIN)), late = waited >= w.quote - 5;
    const sub = [areaName(w.area), w.status === 'notified' ? 'notified' : '', w.phone ? '' : 'no phone'].filter(Boolean).join(' · ');
    const out = w.pager && !w.pagerBackAt;
    return el('button', { type: 'button', class: `bl-row w${x?.id === w.id ? ' on' : ''}`, 'aria-pressed': String(x?.id === w.id), onclick: () => pick('waitlist', w.id) },
      el('span', { class: 'bl-pos' }, String(d.pos.get(w.id) || '')),
      el('span', { class: 'bl-who' }, el('b', {}, nameWords(w)), el('span', {}, icon('chair'), el('b', {}, String(w.guests)), ` · ${sub}`)),
      el('span', { class: `bl-pg${out ? '' : ' none'}` }, icon('vibration'), out ? String(w.pager) : 'None'),
      el('span', { class: `bl-tm${late ? ' late' : ''}` }, el('span', {}, el('b', {}, String(waited)), 'min'), el('small', {}, `of ${w.quote}`)));
  }
  // A booking still to come: its time ("in 18 min", or late in orange), the name, the guests · the area, the table
  function resRow(r, x, now) {
    const isToday = bizKey(r.at) === today(), late = Math.round((now - r.at) / MIN);
    return el('button', { type: 'button', class: `bl-row r${x?.id === r.id ? ' on' : ''}`, 'aria-pressed': String(x?.id === r.id), onclick: () => pick('reservations', r.id) },
      el('span', { class: 'bl-time' }, el('b', {}, clock(r.at)), isToday ? (late > 0 ? el('small', { class: 'late' }, `${late} min late`) : el('small', {}, inWords(r.at, now))) : null),
      el('span', { class: 'bl-who' }, el('b', {}, nameWords(r)), el('span', {}, icon('chair'), el('b', {}, String(r.guests)), ` · ${areaName(F()?.areaOf?.(r.tables[0]) || '')}`)),
      tableChip(r.tables));
  }
  // (the table as on the floor: a rounded square, or round for a round table; joined: "9 + 19")
  function tableChip(ids, cls = 'bl-tno') {
    const t = F()?.table?.(ids[0]);
    return el('i', { class: `${cls}${ids.length < 2 && t?.shape === 'round' ? ' round' : ''}${ids.length > 1 ? ' wide' : ''}` }, tablesWords(ids));
  }
  // Earlier today: the time, the name, what became of them, greyed
  function pastRow(y, x) {
    const w = Boolean(y.addedAt), [words, tone] = statusOf(y);
    return el('button', { type: 'button', class: `bl-row past${x?.id === y.id ? ' on' : ''}`, 'aria-pressed': String(x?.id === y.id), onclick: () => pick(w ? 'waitlist' : 'reservations', y.id) },
      el('span', { class: 'bl-pt' }, clock(w ? y.addedAt : y.at)), el('span', { class: 'bl-pn' }, nameWords(y)), el('span', { class: `bl-ps ${tone}` }, words));
  }
  // What became of a booking or a guest, for its row: ["Seated · T12", 'blue']
  function statusOf(y) {
    if (y.addedAt) {
      if (y.status === 'seated') return [`Seated${y.tables?.length ? ` · ${y.tables.map(id => `T${F()?.tableName?.(id) || id}`).join(' + ')}` : ''}`, 'blue'];
      return [(W_STATUS.find(([s]) => s === y.status) || [, 'Waiting'])[1], TONE[y.status] || 'grey'];
    }
    return [(R_STATUS.find(([s]) => s === y.status) || [, 'Upcoming'])[1], TONE[y.status] || 'grey'];
  }

  // ---------- the one picked (right) ----------
  function detail(d, x, now) {
    if (!x) return el('section', { class: 'bl-detail none' }, el('p', {}, d.tab === 'waitlist' ? (d.k === today() ? 'Nobody on the waitlist yet' : 'Nobody on the waitlist that day') : 'No bookings to show'));
    return d.tab === 'waitlist' ? waitDetail(x, d, now) : resDetail(x, now);
  }
  // The top: the initials, the name, the phone and new or returning guest, Edit, where they stand
  function detailHead(x, st, onEdit) {
    const name = nameWords(x), v = x.phone ? visitsOf(x.phone, x.addedAt ? null : x.id) : 0;
    return el('div', { class: 'bl-dh' }, el('i', { class: 'bl-av', 'aria-hidden': 'true' }, initialsOf(name)),
      el('div', { class: 'bl-dn' }, el('h3', {}, name), el('p', {}, el('span', {}, x.phone ? phoneWords(x) : 'No phone'), x.phone ? el('b', {}, v ? `Returning guest · ${plural(v, 'visit')}` : 'New guest') : null)),
      el('div', { class: 'bl-dr' }, el('button', { type: 'button', class: 'bl-edit', disabled: !onEdit, onclick: onEdit }, icon('pencil'), 'Edit'),
        el('p', { class: `bl-st ${st.tone}` }, st.icon ? icon(st.icon) : null, st.text)));
  }
  // The messages sent, the last of each kind: ✓ green when it went, ✗ red when it didn't (A3)
  const MSG_WORDS = { added: ['Added to waitlist', 'Waitlist message failed'], confirm: ['Confirmation sent', 'Confirmation failed'], reminder: ['Reminder sent', 'Reminder failed'],
    notify: ['Notify sent', 'Notify failed'], buzz: ['Buzz sent', 'Buzz failed'] };
  function msgItems(x) {
    const last = new Map(); for (const m of x.msgs || []) last.set(m.kind, m);
    const items = ['added', 'confirm', 'reminder', 'notify', 'buzz'].filter(k => last.has(k)).map(k => { const m = last.get(k); return el('span', { class: `bl-msg ${m.ok ? 'ok' : 'no'}` }, icon(m.ok ? 'check' : 'x'), MSG_WORDS[k][m.ok ? 0 : 1]); });
    return items.length ? items : [el('span', { class: 'bl-msg none' }, x.phone ? 'None yet' : 'No phone number')];
  }
  const lastMsg = (x, kind) => [...(x.msgs || [])].reverse().find(m => m.kind === kind) || null;
  // A bottom button (D: equal widths; the Counter's Save / Pay look): red, blue (light) or solid; Notify and Buzz with
  // their short bar under the words, green when the last one went, red when it didn't (A3)
  function dbtn(tone, ic, label, run, off, bar = null) {
    return el('button', { type: 'button', class: `bl-db ${tone}`, disabled: Boolean(off), onclick: run }, ic, label, bar ? el('i', { class: `bl-bar ${bar.ok ? 'ok' : 'no'}`, 'aria-hidden': 'true' }) : null);
  }

  // A waitlist guest: the minutes waited against the quote (the ring), the quote, when they were added and #N, the table
  // that may free first for them, the messages; Guests · Area · Pager · Note; Remove · Notify · Buzz · Seat now
  function waitDetail(w, d, now) {
    const active = activeW(w), end = active ? now : (w.removedAt || w.seatedAt || now), waited = Math.max(0, Math.floor((end - w.addedAt) / MIN)), left = w.quote - waited;
    const late = active && left <= 5, sinceN = w.notifiedAt ? Math.floor((now - w.notifiedAt) / MIN) : 0;
    const st = w.status === 'waiting' ? { text: left > 5 ? 'Waiting · on time' : left >= 0 ? `Waiting · ${left} min left` : `Waiting · ${-left} min over`, tone: left > 5 ? 'blue' : 'orange' }
      : w.status === 'notified' ? (sinceN >= (B()?.RULES?.notifiedFlag || 15 * MIN) / MIN ? { text: `Notified ${sinceN} min ago · not here yet`, tone: 'orange' } : { text: `Notified ${sinceN ? `${sinceN} min ago` : 'just now'}`, tone: 'blue' })
        : { text: `${statusOf(w)[0]} · ${clock(w.removedAt || w.seatedAt || w.addedAt)}`, tone: statusOf(w)[1] };
    const pos = d.pos.get(w.id), out = w.pager && !w.pagerBackAt;
    const lines = [
      el('p', {}, 'Quoted ', el('b', {}, `${w.quote} min`), ' · ', active ? el('b', { class: late ? 'o' : '' }, left >= 0 ? `${left} min left` : `${-left} min over`) : el('b', {}, `waited ${waited} min`)),
      el('p', {}, 'Added ', el('b', {}, clock(w.addedAt)), active && pos ? ` · #${pos} on the list` : ''),
      active ? potentialLine(w, now) : null,
      el('p', { class: 'bl-msgs' }, el('span', { class: 'bl-ml' }, 'Messages'), ...msgItems(w))];
    const tile = (label, value, cls = '') => el('div', { class: `bl-tile ${cls}`.trim() }, el('small', {}, label), value);
    const btns = el('div', { class: 'bl-btns four' },
      active ? dbtn('red', icon('user-round-x'), 'Remove', () => { L.pop = { kind: 'remove', id: w.id, why: w.status === 'notified' ? 'noshow' : 'left' }; render(); })
        : dbtn('blue', icon('list-end'), 'Put back', () => putBack(w), !(w.status === 'left' || w.status === 'noshow') || bizKey(w.addedAt) !== today()),
      dbtn('blue', icon('send-horizontal'), 'Notify', () => notify(w), !active || !w.phone, active && w.phone ? lastMsg(w, 'notify') : null),
      dbtn('blue bz', out ? el('b', {}, String(w.pager)) : el('i', { class: 'bl-dash', 'aria-hidden': 'true' }), 'Buzz', () => buzz(w), !active || !out, active && out ? lastMsg(w, 'buzz') : null),
      dbtn('solid', icon('armchair'), 'Seat now', () => seatWaiting(w), !active));
    return el('section', { class: 'bl-detail w', 'aria-label': nameWords(w) },
      detailHead(w, st, active ? () => openWait(w.id) : null),
      el('div', { class: 'bl-wait' }, ring(waited, w.quote, active ? (late ? 'o' : '') : 'done'), el('div', { class: 'bl-lines' }, ...lines)),
      el('div', { class: 'bl-tiles' },
        tile('Guests', el('b', { class: 'n' }, icon('chair'), el('span', {}, String(w.guests)))),
        tile('Area', el('b', {}, areaName(w.area))),
        tile('Pager', out ? el('b', { class: 'n' }, icon('vibration'), el('span', {}, String(w.pager))) : el('b', { class: 'n off' }, icon('vibration'), el('em', {}, 'None')), out ? 'violet' : ''),
        tile('Note', w.note ? el('b', { class: 'note' }, w.note) : el('b', { class: 'off dash' }, '—'))),
      btns);
  }
  // The ring: the minutes waited against the quote, from the top round; black on time, orange from 5 minutes before it
  function ring(waited, quote, tone) {
    const R = 63, C = 2 * Math.PI * R, part = Math.min(1, quote ? waited / quote : 1);
    const arc = part > 0 ? `<circle cx="71" cy="71" r="${R}" class="bl-arc" stroke-dasharray="${(part * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 71 71)"/>` : '';
    return el('div', { class: `bl-ring ${tone}`.trim(), role: 'img', 'aria-label': `Waited ${waited} minutes of ${quote}` },
      svgOf('0 0 142 142', `<circle cx="71" cy="71" r="${R}" class="bl-track"/>${arc}`), el('b', {}, String(waited)), el('small', {}, 'min'));
  }
  // "Potential table for 6: Table 19 · Terrace, seated 1 h 05": the table that seats them likely to free first (D)
  function potentialLine(w, now) {
    const t = estimates(w.guests, now, w.id).first[w.area === 'any' ? 'any' : w.area] || null;
    if (!t) return el('p', {}, `Potential table for ${w.guests}: `, el('b', {}, 'none seats them'));
    const why = t.state === 'free' ? 'free now' : t.bill ? 'bill printed' : `seated ${since(t.since, now)}`;
    return el('p', {}, `Potential table for ${w.guests}: `, el('b', {}, `Table ${t.name} · ${t.areaName}`), `, ${why}`);
  }
  const since = (t, now) => { const m = Math.max(0, Math.floor((now - t) / MIN)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)}`; };

  // A booking: where it stands; Time · Guests · Table · Booked; the note; the messages and their channel; Cancel
  // reservation · Notify · Seat now
  function resDetail(r, now) {
    const up = r.status === 'upcoming', k = bizKey(r.at), mins = Math.round((r.at - now) / MIN);
    const st = !up ? { text: `${statusOf(r)[0]}${r.statusAt ? ` · ${clock(r.statusAt)}` : ''}`, tone: statusOf(r)[1] }
      : mins >= 0 ? { icon: 'timer', text: `Upcoming · ${k === today() ? inWords(r.at, now) : dayLabel(k)}`, tone: 'blue' } : { icon: 'clock', text: `Running late · ${-mins} min`, tone: 'orange' };
    const t = F()?.table?.(r.tables[0]), area = areaName(t?.area || '');
    const tile = (label, value, sub) => el('div', { class: 'bl-tile r' }, el('small', {}, label), value, el('span', {}, sub));
    const ch = [...(r.msgs || [])].reverse().find(m => m.ch === 'whatsapp' || m.ch === 'sms')?.ch;
    return el('section', { class: 'bl-detail r', 'aria-label': nameWords(r) },
      detailHead(r, st, up ? () => window.RestroBookingsApp.editReservation(r.id, { from: 'bookings' }) : null),
      el('div', { class: 'bl-tiles r' },
        tile('Time', el('b', {}, clock(r.at)), dayLabel(k)),
        tile('Guests', el('b', {}, icon('chair'), String(r.guests)), 'party size'),
        tile('Table', el('b', {}, tableChip(r.tables, 'bl-tno sm'), area), `Reserved from ${clock(r.at - HOUR)}`),
        tile('Booked', el('b', {}, icon(r.how === 'walkin' ? 'walk' : 'phone'), r.how === 'walkin' ? 'Walk-in' : 'By phone'), [firstOf(r.by), clock(r.createdAt)].filter(Boolean).join(' · '))),
      el('div', { class: 'bl-line note' }, el('small', {}, 'Note'), el('b', { class: r.note ? '' : 'off' }, r.note || '—')),
      el('div', { class: 'bl-line msgs' }, el('small', {}, 'Messages'), el('span', { class: 'bl-mi' }, ...msgItems(r)), ch ? el('em', {}, ch === 'whatsapp' ? 'WhatsApp' : 'SMS') : null),
      el('div', { class: 'bl-btns three' },
        dbtn('red', icon('calendar-x'), 'Cancel reservation', () => { L.pop = { kind: 'cancel', id: r.id }; render(); }, !up),
        dbtn('blue', icon('send-horizontal'), 'Notify', () => notify(r), !up || !r.phone, up && r.phone ? lastMsg(r, 'notify') : null),
        dbtn('solid', icon('armchair'), 'Seat now', () => seatReservation(r), !up)));
  }

  // ---------- the menus: Today ▾ (B07, B08) and All ▾ (B04, B06) ----------
  function filterMenu(d) {
    const list = [['all', 'All'], ...(d.tab === 'waitlist' ? W_STATUS : R_STATUS)], fl = L.filter[d.tab];
    return el('div', { class: 'bl-menu fl', role: 'menu', 'aria-label': 'Show' }, ...list.map(([s, label]) => {
      const on = s === fl, n = s === 'all' ? d.all.length : d.counts[s] || 0;
      return el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), class: on ? 'on' : '', onclick: () => { L.filter[d.tab] = s; L.menu = null; render(); } },
        el('span', {}, label), el('em', {}, String(n)), on ? icon('check') : null);
    }));
  }
  // The day: Today · Yesterday · Tomorrow (Reservations) and a month's calendar; the waitlist's history: past days only
  function dayMenu(d) {
    const w = d.tab === 'waitlist', k0 = today(), opts = [[k0, 'Today'], [addDays(k0, -1), 'Yesterday'], ...(w ? [] : [[addDays(k0, 1), 'Tomorrow']])];
    const choose = k => { L.day[d.tab] = k === k0 ? null : k; L.menu = null; L.cal = null; render(); };
    const other = !opts.some(([k]) => k === d.k);
    const [y, mo] = (L.cal || d.k.slice(0, 7)).split('-').map(Number), first = new Date(y, mo - 1, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, mo, 0).getDate();
    const shift = n => { const t = new Date(y, mo - 1 + n, 1); L.cal = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`; render(); };
    const cells = [...Array.from({ length: lead }, () => el('span')), ...Array.from({ length: days }, (_, i) => {
      const k = dkey(new Date(y, mo - 1, i + 1)), off = w && k > k0;
      return el('button', { type: 'button', class: `${k === d.k ? 'on' : ''}${off ? ' off' : ''}`.trim() || null, disabled: off, 'aria-pressed': String(k === d.k), 'aria-label': keyDate(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => choose(k) }, String(i + 1));
    })];
    return el('div', { class: `bl-menu day${w ? ' w' : ''}`, role: 'dialog', 'aria-label': 'Pick a day' },
      el('div', { class: 'bl-days' }, ...opts.map(([k, label]) => el('button', { type: 'button', class: k === d.k ? 'on' : '', 'aria-pressed': String(k === d.k), onclick: () => choose(k) },
        el('b', {}, label), el('small', {}, dateWords(k)), k === d.k ? icon('check') : null)),
      el('button', { type: 'button', class: `bl-pick${other ? ' on' : ''}`, onclick: () => { L.cal = d.k.slice(0, 7); render(); root.querySelector('.bl-cal button.on, .bl-cal button:not([disabled])')?.focus(); } }, icon('calendar'), other ? dateWords(d.k) : 'Pick a date')),
      el('div', { class: 'bl-cal' },
        el('div', { class: 'bl-cal-h' }, el('b', {}, first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
          el('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('chevron-left')),
          el('button', { type: 'button', 'aria-label': 'Next month', disabled: w && `${y}-${pad2(mo)}` >= k0.slice(0, 7), onclick: () => shift(1) }, icon('chevron-right'))),
        el('div', { class: 'bl-cal-w', 'aria-hidden': 'true' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => el('span', {}, x))),
        el('div', { class: 'bl-cal-g' }, ...cells),
        w ? el('p', { class: 'bl-cal-n' }, 'Waitlist history · past days only') : null));
  }

  // ---------- the pop-ups: Cancel reservation (B09), Remove from the waitlist (B10) ----------
  function popLayer(d, now) {
    const card = L.pop.kind === 'cancel' ? cancelPop() : L.pop.kind === 'remove' ? removePop(d, now) : null;
    if (!card) { L.pop = null; return el('span'); }
    return el('div', { class: 'bl-scrim', onclick: e => { if (e.target === e.currentTarget) { L.pop = null; render(); } } }, card);
  }
  const popHead = (ic, title) => el('div', { class: 'bl-pop-h' }, el('i', { class: 'bl-pop-ic' }, ic), el('h3', { id: 'bl-pop-t' }, title),
    el('button', { type: 'button', class: 'bl-x', 'aria-label': 'Close', onclick: () => { L.pop = null; render(); } }, icon('x')));
  function cancelPop() {
    const r = B()?.reservation?.(L.pop.id); if (!r || r.status !== 'upcoming') return null;
    const name = nameWords(r), words = tablesWords(r.tables), many = r.tables.length > 1;
    return el('div', { class: 'bl-pop', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'bl-pop-t' },
      popHead(icon('calendar-x'), `Cancel ${firstOf(name) || 'the'}’s reservation?`),
      el('div', { class: 'bl-pcard bl-sum' }, tableChip(r.tables, 'bl-tno big'), el('div', {}, el('b', {}, `${name} · ${clock(r.at)}`), el('small', {}, `${many ? 'Tables' : 'Table'} ${words} · ${plural(r.guests, 'guest')} · ${r.how === 'walkin' ? 'walk-in' : 'by phone'}`))),
      el('p', { class: 'bl-warn' }, `${many ? 'Tables' : 'Table'} ${words} turn${many ? '' : 's'} `, el('b', {}, 'free'), ' and the booking moves to ', el('b', {}, 'Cancelled'), '. This can’t be undone.'),
      el('div', { class: 'bl-pbtns' },
        el('button', { type: 'button', class: 'bl-pb white', onclick: () => { L.pop = null; render(); } }, 'Keep it'),
        el('button', { type: 'button', class: 'bl-pb danger', onclick: () => { B().cancel(r.id); L.pop = null; render(); say({ b: `${firstOf(name) || 'The'}’s reservation cancelled`, t: ` · ${many ? 'Tables' : 'Table'} ${words} ${many ? 'are' : 'is'} free` }); } }, icon('trash'), 'Cancel reservation')));
  }
  function removePop(d, now) {
    const w = B()?.waiting?.(L.pop.id); if (!w || !activeW(w)) return null;
    const name = nameWords(w), first = firstOf(name) || 'them', out = w.pager && !w.pagerBackAt, waited = Math.max(0, Math.floor((now - w.addedAt) / MIN)), pos = d.pos.get(w.id);
    const choice = (why, label, sub) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(L.pop.why === why), class: `bl-choice${L.pop.why === why ? ' on' : ''}`, onclick: () => { L.pop.why = why; render(); } },
      el('i', { class: 'bk-radio', 'aria-hidden': 'true' }), el('span', {}, el('b', {}, label), el('small', {}, sub)));
    return el('div', { class: 'bl-pop', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'bl-pop-t' },
      popHead(icon('user-round-x'), `Remove ${first} from the waitlist?`),
      el('div', { class: 'bl-pcard bl-sum' }, el('i', { class: `bl-sq${out ? ' violet' : ''}` }, out ? String(w.pager) : `#${pos || ''}`),
        el('div', {}, el('b', {}, `${name} · ${plural(w.guests, 'guest')}`), el('small', {}, [pos ? `#${pos} on the list` : '', `waited ${waited} min`, out ? `Pager ${w.pager}` : ''].filter(Boolean).join(' · ')))),
      el('div', { class: 'bl-choices', role: 'radiogroup', 'aria-label': 'Why' }, choice('noshow', 'No-show', w.status === 'notified' ? 'Notified, didn’t come' : 'Didn’t come back'), choice('left', 'Left', 'Gave up waiting')),
      el('p', { class: 'bl-pcard bl-info' }, 'Moves to ', el('b', {}, 'Earlier today'), `, where you can put ${first} back.${out ? ` Pager ${w.pager} frees once it’s back in the dock.` : ''}`),
      el('div', { class: 'bl-pbtns' },
        el('button', { type: 'button', class: 'bl-pb white', onclick: () => { L.pop = null; render(); } }, 'Keep on list'),
        el('button', { type: 'button', class: 'bl-pb danger', onclick: () => {
          const why = L.pop.why; B().removeWaiting(w.id, why); L.pop = null; render();
          say({ b: `${first} · ${why === 'left' ? 'left' : 'no-show'}`, t: ' · moved to Earlier today' });
        } }, icon('user-round-x'), 'Remove')));
  }
  function putBack(w) { B().putBack(w.id); render(); say({ b: `${firstOf(nameWords(w)) || 'They'}’re back on the list` }); }

  // ---------- Notify, Buzz (A3: at once, no pop-up; the short bar shows how it went) ----------
  async function notify(x) {
    const r = await B()?.message?.('notify', x.id);
    if (r?.none) say('Messages go through the RESTRO Android app');
    render();
  }
  async function buzz(w) {
    const r = await B()?.buzz?.(w.id);
    if (r?.none) say('Pagers start with the RESTRO Android app');
    render();
  }
  // (A6) an NFC tap on the lists: the guest or the booking holding that pager
  function listPager(n) {
    const holder = (B()?.pagersOut?.() || []).find(p => p.n === n);
    if (!holder) { say({ b: `Pager ${n}`, t: ' isn’t with anyone on the lists' }); return; }
    backToList(holder.kind === 'wait' ? 'waitlist' : 'reservations', holder.id);
  }

  // ---------- Seat now ----------
  // A waitlist guest (B11): the Floor picks the table, the best for them picked already (in their area; any area: the
  // one the Floor shows when a table there fits them exactly, else the best anywhere); then back to the Waitlist
  function seatWaiting(w) {
    const now = Date.now(), all = B()?.tablesFor?.({ at: now, guests: w.guests, now, lock: true }) || new Map();
    const areas = (F()?.areas?.() || []).map(a => B().areaFor(a.id, all, w.guests)), seatOk = areas.map(a => ({ ...a, pick: a.pick && a.pick.tables.every(id => all.get(id)?.state === 'free') ? a.pick : null }));
    const shown = seatOk.find(a => a.id === F()?.area && a.pick?.kind === 'exact');
    const best = (w.area !== 'any' ? seatOk.find(a => a.id === w.area && a.pick) : shown) || B().bestArea(seatOk);
    const name = nameWords(w), out = w.pager && !w.pagerBackAt;
    F()?.open({ reserve: { seat: true, title: 'Seat now', back: 'Waitlist', who: name, guests: w.guests, at: now, pager: out ? w.pager : 0, tables: best?.pick ? [...best.pick.tables] : [],
      area: best?.id || (w.area !== 'any' ? w.area : null), picked: 'auto', join: Boolean(best?.pick && best.pick.tables.length > 1),
      onPick: ids => {
        if (!ids.length) return;
        B().seatWaiting(w.id, ids);
        backToList('waitlist', w.id, { b: `${firstOf(name) || 'Guest'} seated`, t: ` · ${ids.length > 1 ? 'Tables' : 'Table'} ${tablesWords(ids)}` });
      } } });
  }
  // A reservation: the Counter, its table, Dine-in, the party; Back there comes here again
  function seatReservation(r) {
    view = null; if (dialog.open) dialog.close();
    window.RestroCounter?.seatBooking?.({ table: r.tables[0], tables: r.tables, guests: r.guests, booking: r.id, back: 'bookings',
      customer: r.phone ? { name: nameWords(r), mobile: r.phone, code: r.code } : null }) || window.RestroCounter?.openTable?.(r.tables[0]);
  }

  // ======================================================================================================================
  // Add / Edit waitlist (D: B12–B14): the reservation's form, as the waitlist needs it
  // ======================================================================================================================
  // wf: { id (Edit), phone, first, last, filled, guests, quote (minutes), quoted (a chip was tapped), area ('any' or an
  //   area), note, pager, nfc ({ was }: Undo), was (Edit: as it was) }
  let wf = null;
  const QUOTES = [10, 15, 20, 30, 45, 60];
  function openWait(id) {
    const w = id ? B()?.waiting?.(id) : null; if (id && (!w || !activeW(w))) return;
    wf = w ? { id: w.id, phone: w.phone, first: w.first, last: w.last, filled: false, guests: w.guests, quote: w.quote, quoted: true, area: w.area, note: w.note, pager: w.pager && !w.pagerBackAt ? w.pager : 0, nfc: null, was: w }
      : { id: null, phone: '', first: '', last: '', filled: false, guests: 2, quote: 30, quoted: false, area: 'any', note: '', pager: 0, nfc: null, was: null };
    view = 'wait'; pad = null; pagerOpen = false; L.menu = null; L.pop = null;
    if (dialog.open) render(); else show();
    dialog.querySelector('#bookings-title')?.focus({ preventScroll: true });
  }
  function leaveWait(msg, id = null) { wf = null; pad = null; pagerOpen = false; backToList('waitlist', id, msg); }

  // How long a party would wait, from the floor now (D: a suggested time from the Floor, and a wait per area): each
  // table that seats them frees at once when it is free (and no booking holds it), in about 10 minutes once its bill is
  // printed, else about 1 h 15 after its party sat down (and at least 15 minutes from now); the groups ahead on the
  // list, for that area or any area, take the first ones. → { per: { any, ‹area› }: minutes or null (no table seats
  // them), first: { any, ‹area› }: the table likely first, why: the reason's words }
  const FREES = { bill: 10, meal: 75, least: 15 };
  function estimates(guests, now = Date.now(), except = null) {
    const all = B()?.tablesFor?.({ at: now, guests, now, lock: true }) || new Map(), areas = F()?.areas?.() || [], mine = except ? B()?.waiting?.(except) : null;
    const ahead = (B()?.waitlist?.() || []).filter(w => activeW(w) && w.id !== except && bizKey(w.addedAt) === today() && (!mine || w.addedAt < mine.addedAt));
    const frees = t => (t.state === 'free' ? 0 : t.state === 'maybe' ? FREES.bill : Math.max(FREES.least, FREES.meal - Math.floor((now - (t.order?.at || now)) / MIN)));
    const fit = [...all.values()].filter(t => t.fits && t.state !== 'booked').map(t => ({ ...t, in: frees(t), bill: t.state === 'maybe', since: t.order?.at || now, areaName: areas.find(a => a.id === t.area)?.name || '' })).sort((a, b) => a.in - b.in);
    const at = (list, before) => (list.length ? list[Math.min(before, list.length - 1)].in + (before >= list.length ? FREES.meal * Math.ceil((before + 1 - list.length) / list.length) : 0) : null);
    const per = { any: at(fit, ahead.length) }, first = { any: fit[0] || null };
    for (const a of areas) { const list = fit.filter(t => t.area === a.id); per[a.id] = at(list, ahead.filter(w => w.area === a.id || w.area === 'any').length); first[a.id] = list[0] || null; }
    const bills = fit.filter(t => t.bill).length, long = fit.filter(t => t.state === 'busy' && now - t.since >= HOUR).length, free = fit.filter(t => t.state === 'free').length;
    const why = free ? `${plural(free, 'table')} for ${guests} ${free === 1 ? 'is' : 'are'} free now`
      : [bills ? `${plural(bills, 'table')} for ${guests} ${bills === 1 ? 'has its bill' : 'have bills'} printed` : '', long ? `${long} seated over 1 h` : ''].filter(Boolean).join(', ')
        || (fit.length ? `every table for ${guests} is busy` : `no table seats ${guests}`);
    return { per, first, why, ahead: ahead.length };
  }
  const round5 = m => Math.max(5, Math.ceil(m / 5) * 5);
  const suggest = m => (m == null ? 60 : QUOTES.find(q => q >= m) || 60);

  function renderWait() {
    if (!wf) { root.replaceChildren(); return; }
    const now = Date.now(), est = estimates(wf.guests, now, wf.id);
    if (!wf.quoted) wf.quote = suggest(est.per.any);
    const focusId = document.activeElement?.id, sel = focusId && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const parts = [el('header', { class: 'bk-top bw' },
      el('button', { type: 'button', class: 'bk-back', onclick: () => leaveWait(null, wf?.id) }, icon('chevron-left'), 'Waitlist'),
      el('h2', { id: 'bookings-title', tabindex: '-1' }, wf.id ? 'Edit waitlist' : 'Add to waitlist')),
    el('div', { class: 'bk-form bw' },
      el('div', { class: 'bk-left' }, waitCustomer(), el('div', { class: 'bk-row2' }, guestsCard(wf, () => {}), quoteCard(est, now)), waitNote(), buzzerCard()),
      areaPanel(est))];
    if (pad) parts.push(padLayer());
    if (pagerOpen) parts.push(pagerLayer());
    root.replaceChildren(...parts);
    if (toastNode) root.append(toastNode);
    if (focusId) { const n = root.querySelector(`#${focusId}`); if (n) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch {} } }
    carets();
  }
  // Customer details: the phone optional, the names; a phone number found pulls up the customer (D: visits only)
  function waitCustomer() {
    const c = country();
    const phone = field('bk-phone', 'Phone', pretty(wf.phone), { type: 'tel', inputmode: 'numeric', prefix: `+${c.code}`, oninput: e => typeWaitPhone(e.target) });
    phone.querySelector('.bk-fl').append(el('small', {}, 'optional'));
    const first = field('bk-first', 'First name', wf.first, { autocapitalize: 'words', oninput: e => { wf.first = e.target.value.slice(0, 40); wf.filled = false; renderSoon(); } });
    const last = field('bk-last', 'Last name', wf.last, { autocapitalize: 'words', oninput: e => { wf.last = e.target.value.slice(0, 40); wf.filled = false; renderSoon(); } });
    const g = wf.phone ? guestOf(wf.phone) : null;
    const line = g ? el('p', { class: 'bk-guest' }, icon('user-round'), el('b', {}, g.visits ? 'Returning guest' : 'Known guest'), ` · ${[g.where === 'customers' ? 'found in your customers' : 'found in your bookings', g.visits ? plural(g.visits, 'visit') : ''].filter(Boolean).join(' · ')}`)
      : !wf.phone ? el('p', { class: 'bk-guest none' }, 'No phone · name only is fine. A phone number pulls up the customer.') : null;
    return el('section', { class: 'bk-card bk-cust bw', 'aria-labelledby': 'bk-cust-h' }, el('h3', { id: 'bk-cust-h' }, 'Customer details'), el('div', { class: 'bk-fields' }, phone, first, last), line);
  }
  function typeWaitPhone(input) {
    const digits = input.value.replace(/\D/g, '').slice(0, maxDigits()), caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/\D/g, '').length;
    wf.phone = digits;
    const g = guestOf(digits);
    if (g && (!(wf.first || wf.last) || wf.filled)) { wf.first = g.first; wf.last = g.last; wf.filled = true; }
    else if (!g && wf.filled) { wf.first = ''; wf.last = ''; wf.filled = false; }
    const shown = pretty(digits); input.value = shown;
    let pos = 0, seen = 0; while (pos < shown.length && seen < before) { if (/\d/.test(shown[pos])) seen++; pos++; }
    try { input.setSelectionRange(pos, pos); } catch {}
    renderSoon();
  }
  // Quoted wait: 10 · 15 · 20 · 30 · 45 · 60 min, the floor's suggestion and why (Edit: when they were added, #N)
  function quoteCard(est, now) {
    const sug = suggest(est.per.any), who = firstOf(wf.first) || (wf.first || wf.last ? firstOf(`${wf.first} ${wf.last}`) : 'They');
    const pos = wf.id ? listData('waitlist', now).pos.get(wf.id) : est.ahead + 1;
    const line = wf.id && wf.was ? el('p', { class: 'bw-why' }, el('b', {}, `Added ${clock(wf.was.addedAt)}`), ` · waiting ${Math.max(0, Math.floor((now - wf.was.addedAt) / MIN))} min · ${who} is `, el('b', {}, `#${pos || '?'}`), ' on the list')
      : el('p', { class: 'bw-why' }, el('b', {}, 'Suggested from the floor:'), ` ${est.why} · ${who} will be `, el('b', {}, `#${pos}`), ' on the list');
    return el('section', { class: 'bk-card bw-quote', 'aria-labelledby': 'bw-quote-h' }, el('h3', { id: 'bw-quote-h' }, 'Quoted wait'),
      el('p', { class: 'bw-sug' }, el('i', { 'aria-hidden': 'true' }), `Suggested ${sug} min`),
      el('div', { class: 'bw-chips', role: 'radiogroup', 'aria-label': 'Quoted wait' }, ...QUOTES.map(q => el('button', { type: 'button', role: 'radio', 'aria-checked': String(wf.quote === q), class: wf.quote === q ? 'on' : '',
        onclick: () => { wf.quote = q; wf.quoted = true; render(); } }, el('b', {}, String(q)), el('small', {}, 'min')))),
      line);
  }
  function waitNote() {
    const input = el('input', { id: 'bk-note', type: 'text', maxlength: '200', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', 'aria-label': 'Note', placeholder: 'Birthday, high chair, window side...',
      oninput: e => { wf.note = e.target.value; carets(); } });
    input.value = wf.note;
    return el('section', { class: 'bk-card bk-note', 'aria-labelledby': 'bk-note-h' }, el('h3', { id: 'bk-note-h' }, 'Note'), el('small', { class: 'bk-hint' }, 'optional'),
      el('label', { class: 'bk-f bk-nf', for: 'bk-note' }, el('span', { class: 'bk-fv' }, pencilIcon(), input, el('i', { class: 'bk-cur', 'aria-hidden': 'true', hidden: true }), el('span', { class: 'bk-ruler', 'aria-hidden': 'true' }))));
  }
  // Buzzer (optional): the Counter's pager button (A6: its pop-up; or a pager tapped on the NFC spot, at once, with
  // Undo) and the summary row
  function buzzerCard() {
    const open = () => { pagerOpen = true; render(); };
    const hint = wf.nfc ? el('div', { class: 'bw-ph nfc' }, el('b', {}, 'Assigned by NFC tap'), el('button', { type: 'button', onclick: undoPager }, 'Undo'))
      : el('p', { class: 'bw-ph' }, wf.pager ? 'Same pagers as the Counter · or tap a pager on the NFC spot to change it' : 'No pager yet · tap a pager on the NFC spot, or call out the name');
    const cell = (label, value, cls = '') => el('div', { class: `bk-sc ${cls}`.trim() }, el('small', {}, label), el('b', {}, value));
    return el('section', { class: 'bk-card bw-buzz', 'aria-labelledby': 'bw-buzz-h' }, el('h3', { id: 'bw-buzz-h' }, 'Buzzer'), el('small', { class: 'bk-hint' }, 'optional'),
      el('div', { class: 'bw-pg' }, el('button', { type: 'button', class: `bk-pager${wf.pager ? ' on' : ''}`, onclick: open }, icon('vibration'), wf.pager ? `Pager ${wf.pager}` : 'Assign pager'), hint,
        wf.pager ? el('button', { type: 'button', class: 'bw-change', onclick: open }, 'Change') : null),
      el('div', { class: 'bk-sumrow bw' }, cell('Customer', [wf.first, wf.last].map(s => s.trim()).filter(Boolean).join(' ') || '—'), cell('Phone', wf.phone ? `+${country().code} ${pretty(wf.phone)}` : '—', wf.phone ? '' : 'off'),
        cell('Guests', String(wf.guests)), cell('Quoted wait', `${wf.quote} min`), cell('Buzzer', wf.pager ? `Pager ${wf.pager}` : '—', wf.pager ? 'violet' : 'off')));
  }
  // Area (right): Any area first, then each area with its wait for this party; Add to waitlist / Save changes
  function areaPanel(est) {
    const rows = [['any', 'Any area'], ...(F()?.areas?.() || []).map(a => [a.id, a.name])].map(([id, name]) => {
      const m = est.per[id], on = wf.area === id, none = m == null;
      return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `bk-area${on ? ' on' : ''}${none ? ' none' : ''}`, disabled: none && !on, onclick: () => { wf.area = id; render(); } },
        el('i', { class: 'bk-radio', 'aria-hidden': 'true' }), el('b', {}, name), el('span', {}, none ? `no table for ${wf.guests}` : m > 60 ? '60+ min' : `~${round5(m)} min`));
    });
    const can = Boolean(wf.first.trim() || wf.last.trim()) && (!wf.phone || phoneOk(wf.phone));
    return el('aside', { class: 'bk-card bk-panel bw', 'aria-labelledby': 'bw-area-h' }, el('h3', { id: 'bw-area-h' }, 'Area'), el('small', { class: 'bk-hint' }, `wait for ${plural(wf.guests, 'guest')}`),
      el('p', { class: 'bk-tip' }, icon('check'), el('b', {}, 'Any area'), ' = seated at the first table that frees up'),
      el('div', { class: 'bk-areas', role: 'radiogroup', 'aria-label': 'Area' }, ...rows),
      el('p', { class: 'bk-free' }, 'Wait times are estimates from the floor right now'),
      el('button', { type: 'button', class: 'bw-save', disabled: !can, onclick: saveWait }, wf.id ? 'Save changes' : 'Add to waitlist'));
  }
  function saveWait() {
    const data = { first: wf.first.trim(), last: wf.last.trim(), phone: wf.phone, code: country().code, guests: wf.guests, quote: wf.quote, area: wf.area, note: wf.note.trim(),
      pager: wf.pager || 0, pagerAt: wf.pager ? (wf.was?.pager === wf.pager ? wf.was.pagerAt : Date.now()) : null, pagerBackAt: null };
    const rec = wf.id ? B()?.editWaiting?.(wf.id, data) : B()?.addWaiting?.(data);
    if (!rec) { say('Add a name first'); return; }
    if (rec.pager) B().pagerTaken?.(rec.pager, rec.id);
    const who = firstOf(nameWords(rec)) || 'Guest';
    leaveWait({ b: wf?.id ? `${who}’s details saved` : `${who} added to the waitlist`, t: wf?.id ? '' : ` · quoted ${rec.quote} min` }, rec.id);
  }

  // ---------- the toast (A5: the Counter's toast) ----------
  function say(m) {
    if (typeof m === 'string') m = { t: m };
    clearTimeout(toastTimer);
    toastNode = el('div', { class: 'bk-toast', role: 'status' }, el('span', {}, m.b ? el('b', {}, m.b) : null, m.t || ''));
    root.querySelector('.bk-toast')?.remove(); root.append(toastNode);
    toastTimer = setTimeout(() => { toastNode?.remove(); toastNode = null; }, 2600);
  }

  // ---------- open, back, leave ----------
  function show() {
    document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
    pad = null; pagerOpen = false; render();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#bookings-title')?.focus({ preventScroll: true });
  }
  // Back: the pop-up or the menu open, the calendar; then the screen before: a form goes back to where it was opened
  // from (nothing is saved); the app to the Floor when it was opened there, else Home (false: the system closes it)
  function goBack() {
    if (!dialog.open || !view) return false;
    if (pagerOpen) { pagerOpen = false; render(); return true; }
    if (pad) { pad = null; render(); return true; }
    if (view === 'list') {
      if (L.pop) { L.pop = null; render(); return true; }
      if (L.menu) { L.menu = null; L.cal = null; render(); return true; }
      if (L.from === 'floor') { toFloor(); return true; }
      return false;
    }
    if (view === 'wait') { leaveWait(null); return true; }
    if (f?.cal) { f.cal = null; render(); return true; }
    leave(null);
    return true;
  }
  // (a reservation's form, saved or not: back to Bookings when it was opened there, else to the Floor, C1)
  function leave(msg, savedId = null) {
    const was = f; f = null; pad = null; pagerOpen = false;
    if (was?.from === 'bookings') { backToList('reservations', savedId, msg); return; }
    view = null;
    if (dialog.open) dialog.close();
    F()?.open({ from: was?.floorFrom === 'counter' ? 'counter' : 'home', table: savedId ? B()?.reservation?.(savedId)?.tables?.[0] : null, say: msg || undefined });
  }
  // The app again, on that tab with that one picked (its day, the filter showing it)
  function backToList(tab, id = null, msg = null) {
    view = 'list'; L.tab = tab; L.menu = null; L.cal = null; L.pop = null;
    if (id) {
      const x = tab === 'waitlist' ? B()?.waiting?.(id) : B()?.reservation?.(id);
      if (x) { const k = bizKey(tab === 'waitlist' ? x.addedAt : x.at); L.day[tab] = k === today() ? null : k; L.filter[tab] = 'all'; L.sel[tab] = id; }
    }
    if (dialog.open) render(); else show();
    if (msg) say(msg);
  }
  // "‹ Floor" (and Back when the app was opened there): the Floor, as it was opened
  function toFloor() {
    view = null; f = null; wf = null; pad = null; pagerOpen = false;
    if (dialog.open) dialog.close();
    F()?.open({ from: L.floorFrom === 'counter' ? 'counter' : 'home' });
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (!goBack()) { view = null; dialog.close(); } });
  dialog.addEventListener('close', () => { clearTimeout(toastTimer); toastNode = null; L.menu = null; L.cal = null; L.pop = null; });
  // (A1) the top bar, the lock or Recent apps close the pop-up or menu open, and only that
  window.addEventListener('restro:close-popups', () => {
    if (!dialog.open || !view) return;
    if (view === 'list') { if (L.menu || L.pop) { L.menu = null; L.cal = null; L.pop = null; render(); } return; }
    const s = form(); if (!s || (!pad && !pagerOpen && !s.cal)) return;
    pad = null; pagerOpen = false; if (s.cal) s.cal = null; render();
  });
  // Bookings, orders or the floor changed (here or on another tablet): what is free now, who is waiting
  const refresh = () => {
    if (!dialog.open || pad || !view) return;
    if (view === 'res' && f && f.picked === 'auto' && !f.chosen) repick();
    render();
  };
  window.addEventListener('restro:bookings-changed', refresh);
  window.addEventListener('restro:data-changed', refresh);
  // (the minutes waited, "in 18 min", the NOW line: each half minute)
  setInterval(() => { if (dialog.open && view && !pad && !pagerOpen && document.activeElement?.tagName !== 'INPUT') render(); }, 30000);

  // ---------- icons drawn here ----------
  // (Material Icons "edit", Apache 2.0) the note's pencil
  function pencilIcon() { return svgOf('0 0 24 24', '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>', 'bk-pencil'); }
  // (ours) Pick a table on the Floor: three tables and a plus
  function floorIcon() { return svgOf('0 0 24 24', '<rect x="3.5" y="4.2" width="7" height="6.4" rx="2"/><rect x="13.5" y="4.2" width="7" height="6.4" rx="2"/><rect x="3.5" y="13.4" width="7" height="6.4" rx="2"/><path d="M14 16.6h6M17 13.6v6"/>', 'fi fi-stroke bk-flic'); }

  window.RestroBookingsApp = Object.freeze({
    // open({ tab: 'waitlist' | 'reservations', from: 'home' | 'floor', floorFrom: 'home' | 'counter', select: id, say })
    // the app: from the Home screen (the Waitlist), the Floor's Waitlist pill or its menu's Reservations, the Counter's
    // Back after a reservation's Seat now
    open(opts = {}) {
      f = null; wf = null; pad = null; pagerOpen = false;
      if (opts.from) { L.from = opts.from === 'floor' ? 'floor' : 'home'; L.floorFrom = opts.floorFrom === 'counter' ? 'counter' : 'home'; }
      const tab = opts.tab === 'reservations' || opts.tab === 'waitlist' ? opts.tab : L.tab;
      backToList(tab, opts.select || null, opts.say || null);
    },
    // newReservation({ from: 'floor' | 'bookings', floorFrom: 'home' | 'counter' }) from the Floor's menu or Bookings;
    // editReservation(id, { from }) from Bookings (its Edit)
    newReservation(opts = {}) {
      f = fresh(opts); view = 'res'; repick(); show();
    },
    editReservation(id, opts = {}) {
      const r = B()?.reservation?.(id); if (!r || r.status !== 'upcoming') return false;
      f = fromBooking(r, opts); view = 'res'; repick(); show(); return true;
    },
    pagerTapped,
    goBack,
    get shown() { return dialog.open; }
  });
})();
