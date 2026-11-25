'use strict';
// Bookings (Update Pack 8, C and D). This part: New reservation and Edit reservation (C2, C4: N01–N04, N08–N10), with
// Pick a table on the Floor (C3: floor.js, its 'reserve' mode). The lists (Waitlist, Reservations: D) come next.
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
  document.addEventListener('selectionchange', () => { if (dialog.open && f) carets(); });
  root.addEventListener('focusin', () => carets()); root.addEventListener('focusout', () => setTimeout(carets));

  // Number of guests: − / + (the Counter's glyphs, the number in its quantity blue); the number tapped: the number pad
  function guestsCard() {
    const step = d => { f.guests = Math.max(1, Math.min(99, f.guests + d)); repick(); render(); };
    return el('section', { class: 'bk-card bk-guests', 'aria-labelledby': 'bk-guests-h' }, el('h3', { id: 'bk-guests-h' }, 'Number of guests'),
      el('div', { class: 'bk-step' },
        el('button', { type: 'button', class: 'bk-sb', 'aria-label': 'One guest less', disabled: f.guests <= 1, onclick: () => step(-1) }, svgOf('0 0 24 24', '<path d="M3.5 12h17"/>')),
        el('button', { type: 'button', class: 'bk-sn', 'aria-label': `${f.guests} guests. Tap to type the number`, onclick: () => { pad = { value: '' }; render(); } }, String(f.guests)),
        el('button', { type: 'button', class: 'bk-sb', 'aria-label': 'One guest more', disabled: f.guests >= 99, onclick: () => step(1) }, svgOf('0 0 24 24', '<path d="M3.5 12h17M12 3.5v17"/>'))));
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
    const done = () => { const n = Number(pad.value); if (n >= 1) { f.guests = Math.min(99, n); repick(); } pad = null; render(); };
    const key = (k, label, cls = '') => el('button', { type: 'button', class: `bk-key ${cls}`.trim(), 'aria-label': k === 'back' ? 'Delete' : null, onclick: () => press(k) }, label);
    return el('div', { class: 'bk-scrim', onclick: e => { if (e.target === e.currentTarget) { pad = null; render(); } } },
      el('div', { class: 'bk-pad', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bk-pad-t' },
        el('div', { class: 'bk-pad-h' }, el('h3', { id: 'bk-pad-t' }, 'Number of guests'), el('button', { type: 'button', class: 'bk-x', 'aria-label': 'Close', onclick: () => { pad = null; render(); } }, icon('x'))),
        el('div', { class: 'bk-pad-v', role: 'status', 'aria-label': v ? `${v} guests` : `Type the number of guests (now ${f.guests})` }, v ? el('span', {}, v) : null, el('i', { 'aria-hidden': 'true' })),
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
  function pagerLayer() {
    const host = el('div', { class: 'bk-pagerhost' });
    const built = window.RestroCounter?.pagerPicker?.({ current: f.pager, except: f.id, onPick: n => { f.pager = n; f.nfc = null; pagerOpen = false; render(); }, onClose: () => { pagerOpen = false; render(); } });
    if (built) host.append(built); else { pagerOpen = false; }
    return host;
  }
  function undoPager() { if (!f?.nfc) return; f.pager = f.nfc.was; f.nfc = null; render(); }
  // (counter.js asks first: true when the form took the pager)
  function pagerTapped(n) {
    if (!dialog.open || !f) return false;
    if (pad || pagerOpen) return true;
    const busy = window.RestroCounter?.pagerInUse?.(n, f.id);
    if (busy) { say({ b: `Pager ${n}`, t: ' is in use' }); return true; }
    f.nfc = { was: f.pager }; f.pager = n; render(); return true;
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
  // Back: the pop-up open, the calendar, else where the form came from (nothing is saved)
  function goBack() {
    if (!dialog.open) return false;
    if (pagerOpen) { pagerOpen = false; render(); return true; }
    if (pad) { pad = null; render(); return true; }
    if (f?.cal) { f.cal = null; render(); return true; }
    leave(null);
    return true;
  }
  function leave(msg, savedId = null) {
    const was = f; f = null; pad = null; pagerOpen = false;
    if (dialog.open) dialog.close();
    if (!was || was.from === 'floor') F()?.open({ from: was?.floorFrom === 'counter' ? 'counter' : 'home', table: savedId ? B()?.reservation?.(savedId)?.tables?.[0] : null, say: msg || undefined });
    else window.RestroBookingsApp?.open?.({ tab: 'reservations', select: savedId, say: msg || undefined });
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); goBack(); });
  dialog.addEventListener('close', () => { clearTimeout(toastTimer); toastNode = null; });
  // (A1) the top bar, the lock or Recent apps close the pop-up open, and only that
  window.addEventListener('restro:close-popups', () => { if (!dialog.open || !f || (!pad && !pagerOpen && !f.cal)) return; pad = null; pagerOpen = false; f.cal = null; render(); });
  // Bookings, orders or the floor changed (here or on another tablet): what is free now
  const refresh = () => { if (dialog.open && f && !pad) { if (f.picked === 'auto' && !f.chosen) repick(); render(); } };
  window.addEventListener('restro:bookings-changed', refresh);
  window.addEventListener('restro:data-changed', refresh);
  setInterval(() => { if (dialog.open && f && !pad && !pagerOpen && document.activeElement?.tagName !== 'INPUT') render(); }, 30000);

  // ---------- icons drawn here ----------
  // (Material Icons "edit", Apache 2.0) the note's pencil
  function pencilIcon() { return svgOf('0 0 24 24', '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>', 'bk-pencil'); }
  // (ours) Pick a table on the Floor: three tables and a plus
  function floorIcon() { return svgOf('0 0 24 24', '<rect x="3.5" y="4.2" width="7" height="6.4" rx="2"/><rect x="13.5" y="4.2" width="7" height="6.4" rx="2"/><rect x="3.5" y="13.4" width="7" height="6.4" rx="2"/><path d="M14 16.6h6M17 13.6v6"/>', 'fi fi-stroke bk-flic'); }

  window.RestroBookingsApp = Object.freeze({
    // newReservation({ from: 'floor' | 'bookings', floorFrom: 'home' | 'counter' }) from the Floor's menu or Bookings;
    // editReservation(id, { from }) from Bookings (its Edit)
    newReservation(opts = {}) {
      f = fresh(opts); repick(); show();
    },
    editReservation(id, opts = {}) {
      const r = B()?.reservation?.(id); if (!r || r.status !== 'upcoming') return false;
      f = fromBooking(r, opts); repick(); show(); return true;
    },
    pagerTapped,
    goBack,
    get shown() { return dialog.open; }
  });
})();
