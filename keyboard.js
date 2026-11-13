'use strict';
// RESTRO's own keyboard (owner, 13 Nov 2026). Nothing may cover or move the navigation bar or the lock, and Android
// draws its own keyboard over every app, so the tablet's keyboard never opens in RESTRO: every field that takes typing
// has inputmode="none", and this keyboard opens instead, just above the navigation bar (in the swipe mode, above the
// strip that keeps the handle and the lock). On a touch screen only; on a computer, its own keyboard types.
// - Letters, with a row of numbers on top; ?123 for symbols; a number pad for number fields (inputmode numeric,
//   decimal or tel).
// - Shift: one capital, or held on with two quick taps (caps lock). Capitals come by themselves where the field asks
//   (autocapitalize: words, sentences, characters).
// - Enter does what the field asks for (enterkeyhint): search, done, next; a new line in a box of several lines.
// - ⌄ puts the keyboard away, as Back does. A key on a physical keyboard puts it away too, until a field is tapped.
// - The field stays in view: where the keyboard would cover it, the list it is in scrolls it up.
(() => {
  const root = document.documentElement;
  const touchScreen = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const takesTyping = el => (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|tel|url|number|password)$/.test(el.type)))
    && !el.readOnly && !el.disabled;
  if (!touchScreen) { window.RestroKeyboard = Object.freeze({ shown: () => false }); return; }

  // ---------- The tablet's own keyboard stays down: inputmode="none" on every field that takes typing ----------
  // (what the field asked for is kept in data-osk-mode, for this keyboard's layout)
  function quiet(el) {
    if (!takesTyping(el) || el.dataset.oskMode !== undefined) return;
    el.dataset.oskMode = el.getAttribute('inputmode') || '';
    el.setAttribute('inputmode', 'none');
  }
  const quietAll = node => { if (node.nodeType !== 1) return; quiet(node); node.querySelectorAll?.('input,textarea').forEach(quiet); };
  quietAll(document.body);
  new MutationObserver(records => { for (const r of records) for (const node of r.addedNodes) quietAll(node); }).observe(document.body, { childList: true, subtree: true });

  // ---------- The keys ----------
  const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    back: svg('<path d="M21 5H8.5L2.5 12l6 7H21z"/><path d="M11.5 9l6 6M17.5 9l-6 6"/>'),
    shift: svg('<path d="M12 3.5 4 12.5h4.5V20h7v-7.5H20z"/>'),
    lock: svg('<path d="M12 2.5 4 11h4.5v5h7v-5H20z"/><path d="M8.5 20.5h7"/>'),
    hide: svg('<path d="M6 9l6 6 6-6"/>'),
    search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
    done: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    next: svg('<path d="M4 12h15M13 6l6 6-6 6"/>'),
    send: svg('<path d="M3.5 11.5 20.5 4l-5 16.5-4-7z"/><path d="M11.5 13.5 20.5 4"/>'),
    enter: svg('<path d="M19.5 5v6.5a3 3 0 0 1-3 3H5"/><path d="M9 10.5 5 14.5l4 4"/>')
  };
  const NAMES = { ',': 'Comma', '.': 'Full stop', ' ': 'Space', '@': 'At', '#': 'Hash', '₹': 'Rupee', '_': 'Underscore', '&': 'And',
    '-': 'Minus', '+': 'Plus', '(': 'Open bracket', ')': 'Close bracket', '/': 'Slash', '*': 'Star', '"': 'Double quote', "'": 'Apostrophe',
    ':': 'Colon', ';': 'Semicolon', '!': 'Exclamation mark', '?': 'Question mark', '%': 'Percent', '=': 'Equals', '~': 'Tilde', '`': 'Backtick',
    '|': 'Bar', '\\': 'Backslash', '<': 'Less than', '>': 'Greater than', '[': 'Open square bracket', ']': 'Close square bracket',
    '{': 'Open curly bracket', '}': 'Close curly bracket', '^': 'Caret' };
  const NUMBERS = Array.from({ length: 10 }, (_, i) => String((i + 1) % 10)); // 1 2 … 9 0
  // Each row's keys: a character, or { k: what it does, w: its width in keys }, or { gap } (a little space)
  const PAGES = {
    abc: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', { k: 'back', w: 1.5 }],
      [{ gap: 0.5 }, 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', { k: 'enter', w: 1.5 }],
      [{ k: 'shift', w: 1.5 }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', { k: 'shift', w: 1.5 }],
      [{ k: 'sym', w: 2, t: '?123' }, { c: ',', fn: true }, { k: 'space', w: 6 }, { c: '.', fn: true }, { k: 'hide', w: 2 }]
    ],
    sym: [
      ['@', '#', '₹', '_', '&', '-', '+', '(', ')', '/', { k: 'back', w: 1.5 }],
      [{ gap: 0.5 }, '*', '"', "'", ':', ';', '!', '?', '%', '=', { k: 'enter', w: 1.5 }],
      ['~', '`', '|', '\\', '<', '>', '[', ']', '{', '}', '^'],
      [{ k: 'abc', w: 2, t: 'ABC' }, { c: ',', fn: true }, { k: 'space', w: 6 }, { c: '.', fn: true }, { k: 'hide', w: 2 }]
    ]
  };

  const osk = document.createElement('div');
  osk.id = 'restro-keyboard'; osk.className = 'osk'; osk.hidden = true;
  osk.setAttribute('role', 'group'); osk.setAttribute('aria-label', 'Keyboard');
  document.body.append(osk);

  let current = null, page = 'abc', shift = 'off', lastShift = 0, pad = 'abc', side = '', hint = 'done', email = false;
  let hardware = null, padded = null;

  function key(spec) {
    const s = typeof spec === 'string' ? { c: spec } : spec;
    if (s.gap) { const g = document.createElement('span'); g.className = 'osk-gap'; g.style.flexGrow = String(s.gap); return g; }
    const b = document.createElement('button');
    b.type = 'button'; b.tabIndex = -1; b.className = 'osk-k';
    if (s.w) b.style.flexGrow = String(s.w);
    if (s.c !== undefined) {
      b.dataset.c = s.c; b.textContent = s.c; b.setAttribute('aria-label', NAMES[s.c] || s.c);
      if (s.fn) b.classList.add('fn');
    } else {
      b.dataset.k = s.k; b.classList.add('fn', s.k);
      if (s.t) b.textContent = s.t;
      else if (s.k !== 'space') b.innerHTML = ICON[s.k] || '';
      b.setAttribute('aria-label', { back: 'Backspace', enter: 'Enter', shift: 'Shift', sym: 'Numbers and symbols', abc: 'Letters', space: 'Space', hide: 'Hide the keyboard' }[s.k]);
    }
    return b;
  }
  function row(keys, cls = '') {
    const r = document.createElement('div'); r.className = `osk-row${cls ? ` ${cls}` : ''}`;
    for (const k of keys) r.append(key(k));
    return r;
  }
  // Draws the page: letters or symbols (the numbers row on top), or the number pad
  function draw() {
    osk.replaceChildren();
    osk.dataset.page = pad === 'num' ? 'num' : page;
    if (pad === 'num') {
      const grid = document.createElement('div'); grid.className = 'osk-pad';
      const keys = ['1', '2', '3', { k: 'back' }, '4', '5', '6', { k: 'enter' }, '7', '8', '9'];
      for (const k of keys) grid.append(key(k));
      if (side) grid.append(key({ c: side, fn: true }));
      const zero = key('0'); zero.classList.add('zero'); if (!side) zero.classList.add('wide'); grid.append(zero);
      grid.append(key({ k: 'hide' }));
      osk.append(grid);
    } else {
      osk.append(row(NUMBERS, 'nums'));
      const rows = PAGES[page].map(keys => keys.map(k => (email && page === 'abc' && typeof k === 'object' && k.c === ',' && k.fn ? { c: '@', fn: true } : k)));
      for (const keys of rows) osk.append(row(keys));
    }
    paint();
  }
  // Capitals on the letters, Shift's look, and Enter's sign for this field
  function paint() {
    const up = page === 'abc' && shift !== 'off';
    for (const b of osk.querySelectorAll('.osk-row:not(.nums) .osk-k[data-c]')) {
      const c = b.dataset.c; if (!/^[a-z]$/.test(c)) continue;
      b.textContent = up ? c.toUpperCase() : c;
    }
    for (const b of osk.querySelectorAll('.osk-k.shift')) {
      b.classList.toggle('on', shift !== 'off'); b.classList.toggle('locked', shift === 'lock');
      b.innerHTML = shift === 'lock' ? ICON.lock : ICON.shift;
      b.setAttribute('aria-pressed', String(shift !== 'off'));
    }
    for (const b of osk.querySelectorAll('.osk-k.enter')) {
      b.innerHTML = ICON[hint] || ICON.enter;
      b.setAttribute('aria-label', { search: 'Search', done: 'Done', next: 'Next', go: 'Go', send: 'Send', enter: 'New line' }[hint] || 'Enter');
    }
  }

  // ---------- Which keyboard a field gets ----------
  function setUp(f) {
    const mode = (f.dataset.oskMode || '').toLowerCase();
    const number = mode === 'numeric' || mode === 'decimal' || mode === 'tel' || (!mode && (f.type === 'tel' || f.type === 'number'));
    pad = number ? 'num' : 'abc';
    side = !number ? '' : mode === 'decimal' || (!mode && f.type === 'number') ? '.' : mode === 'tel' || (!mode && f.type === 'tel') ? '+' : '';
    email = mode === 'email' || f.type === 'email';
    page = 'abc';
    const h = (f.getAttribute('enterkeyhint') || '').toLowerCase();
    hint = f instanceof HTMLTextAreaElement ? 'enter' : ['search', 'done', 'next', 'go', 'send'].includes(h) ? (h === 'go' ? 'next' : h) : 'done';
    shift = capsOf(f) === 'characters' ? 'lock' : 'off';
    autoShift();
  }
  function capsOf(f) {
    const a = (f.getAttribute('autocapitalize') || f.form?.getAttribute('autocapitalize') || '').toLowerCase();
    if (a === 'characters' || a === 'words') return a;
    if (a === 'sentences' || a === 'on') return 'sentences';
    if (a === 'none' || a === 'off') return 'none';
    return f instanceof HTMLTextAreaElement || f.type === 'text' ? 'sentences' : 'none';
  }
  // A capital by itself at the start (and after a full stop, or a space in a field of names)
  function autoShift() {
    if (!current || pad === 'num' || page !== 'abc' || shift === 'lock') return;
    const mode = capsOf(current);
    let at = null; try { at = current.selectionStart; } catch {}
    const before = current.value.slice(0, at ?? current.value.length);
    const up = mode === 'words' ? /(^|\s)$/.test(before) : mode === 'sentences' ? /(^\s*|[.!?]\s+|\n)$/.test(before) : false;
    shift = up ? 'once' : 'off';
  }

  // ---------- Typing into the field ----------
  // (as typing does: the field's own input events, its length limit and undo)
  function edit(text, inputType) {
    const f = current;
    let s = null, e = null; try { s = f.selectionStart; e = f.selectionEnd; } catch {}
    if (s == null) { s = e = f.value.length; }
    if (inputType === 'deleteContentBackward') { if (s === e) { if (!s) return; s -= 1; } text = ''; }
    const max = f.maxLength >= 0 ? f.maxLength : Infinity, room = max - (f.value.length - (e - s));
    if (text.length > room) text = text.slice(0, Math.max(0, room));
    if (!text && inputType === 'insertText') return;
    try { f.setRangeText(text, s, e, 'end'); } catch { f.value = f.value.slice(0, s) + text + f.value.slice(e); }
    f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: text || null }));
  }
  function put(text) {
    if (!document.execCommand('insertText', false, text)) edit(text, 'insertText');
    if (shift === 'once') shift = 'off';
    autoShift(); paint();
  }
  function erase() {
    if (!document.execCommand('delete', false)) edit('', 'deleteContentBackward');
    autoShift(); paint();
  }
  const fieldsIn = box => [...box.querySelectorAll('input,textarea')].filter(el => takesTyping(el) && el.getClientRects().length);
  function enter() {
    const f = current;
    if (f instanceof HTMLTextAreaElement) { put('\n'); return; }
    const init = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
    const go = f.dispatchEvent(new KeyboardEvent('keydown', init));
    if (go) f.dispatchEvent(new KeyboardEvent('keypress', init));
    f.dispatchEvent(new KeyboardEvent('keyup', init));
    // The field acted on Enter itself: it moved on, let go, or keeps the typing (a quick pick added, say)
    if (document.activeElement !== f || !go) return;
    // A form sends itself as Enter sends it: when it has a send button, or this is its one field
    const form = f.form;
    if (form && (form.querySelector('button[type=submit],input[type=submit],button:not([type])') || fieldsIn(form).length === 1)) {
      form.requestSubmit?.(); if (document.activeElement !== f) return;
    }
    if (hint === 'next') {
      const box = f.closest('form,dialog') || document.body, list = fieldsIn(box), next = list[list.indexOf(f) + 1];
      if (next) { next.focus(); return; }
    }
    f.blur();
  }
  function tapShift() {
    const now = performance.now();
    if (shift === 'lock') shift = 'off';
    else if (shift === 'once') shift = now - lastShift < 350 ? 'lock' : 'off';
    else shift = 'once';
    lastShift = now; paint();
  }
  function act(b) {
    const f = current;
    if (!f || !f.isConnected || document.activeElement !== f) { if (takesTyping(document.activeElement)) show(document.activeElement); else hide(); return; }
    const k = b.dataset.k;
    if (k === 'back') erase();
    else if (k === 'enter') enter();
    else if (k === 'hide') f.blur();
    else if (k === 'shift') tapShift();
    else if (k === 'sym' || k === 'abc') { page = k; if (page === 'abc') autoShift(); draw(); }
    else if (k === 'space') put(' ');
    else { const c = b.dataset.c; put(page === 'abc' && pad !== 'num' && shift !== 'off' && /^[a-z]$/.test(c) ? c.toUpperCase() : c); }
  }

  // ---------- The finger on the keys: the field keeps the focus ----------
  const downs = new Map();
  let repeatWait = 0, repeatEvery = 0;
  const stopRepeat = () => { clearTimeout(repeatWait); clearInterval(repeatEvery); };
  osk.addEventListener('pointerdown', e => {
    e.preventDefault();
    const b = e.target.closest?.('.osk-k'); if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
    b.classList.add('down'); downs.set(e.pointerId, b);
    try { b.setPointerCapture(e.pointerId); } catch {}
    // Backspace goes at once, and again and again while held; Shift at once
    if (b.dataset.k === 'back') { act(b); stopRepeat(); repeatWait = setTimeout(() => { repeatEvery = setInterval(() => { if (current) erase(); else stopRepeat(); }, 60); }, 420); }
    else if (b.dataset.k === 'shift') act(b);
  });
  const lift = (e, done) => {
    const b = downs.get(e.pointerId); if (!b) return;
    downs.delete(e.pointerId); b.classList.remove('down');
    if (b.dataset.k === 'back') stopRepeat();
    else if (done && b.dataset.k !== 'shift') act(b);
  };
  osk.addEventListener('pointerup', e => lift(e, true));
  osk.addEventListener('pointercancel', e => lift(e, false));
  osk.addEventListener('mousedown', e => e.preventDefault());
  osk.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- Showing and hiding ----------
  // The keyboard sits in the window on top (an HTML modal dialog makes everything outside it untappable), just under the
  // navigation bar's layer; the bar and the lock stay over it.
  function show(f) {
    if (hardware === f) return;
    hardware = null;
    if (current !== f) unpad();
    current = f;
    setUp(f);
    const host = f.closest('dialog[open]') || document.body;
    if (osk.parentElement !== host) host.append(osk);
    draw();
    osk.hidden = false; root.toggleAttribute('data-osk', true);
    requestAnimationFrame(() => keepInView(f));
  }
  function hide() {
    stopRepeat(); downs.clear();
    current = null; osk.hidden = true; root.toggleAttribute('data-osk', false);
    unpad();
  }
  // The field stays in view: the list it is in scrolls it up, with room added under the list while the keyboard is up
  function keepInView(f) {
    if (current !== f || osk.hidden) return;
    const top = osk.getBoundingClientRect().top - 16, r = f.getBoundingClientRect();
    if (r.bottom <= top) return;
    let s = f.parentElement;
    while (s && s !== document.body && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    if (!s || s === document.body) return;
    const cover = Math.ceil(s.getBoundingClientRect().bottom - top);
    if (cover > 0 && !padded) { padded = { el: s, was: s.style.paddingBottom }; s.style.paddingBottom = `${parseFloat(getComputedStyle(s).paddingBottom) + cover}px`; }
    s.scrollTop += Math.ceil(f.getBoundingClientRect().bottom - top);
  }
  function unpad() { if (padded) { padded.el.style.paddingBottom = padded.was; padded = null; } }

  document.addEventListener('pointerdown', e => { const f = e.target.closest?.('input,textarea'); if (f && takesTyping(f)) { quiet(f); if (hardware === f) hardware = null; } }, true);
  document.addEventListener('focusin', e => {
    const f = e.target;
    if (takesTyping(f)) { quiet(f); show(f); } else if (!osk.contains(f)) hide();
  }, true);
  document.addEventListener('focusout', e => {
    if (e.target !== current) return;
    setTimeout(() => { const a = document.activeElement; if (a === current || takesTyping(a)) return; hide(); }, 0);
  }, true);
  // A physical keyboard: this one goes away until a field is tapped
  document.addEventListener('keydown', e => {
    if (!e.isTrusted || !current || osk.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Delete') { const f = current; hide(); hardware = f; }
  }, true);
  window.addEventListener('resize', () => { if (current && !osk.hidden) requestAnimationFrame(() => keepInView(current)); });

  window.RestroKeyboard = Object.freeze({ shown: () => !osk.hidden });
})();
