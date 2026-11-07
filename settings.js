'use strict';
// Android-style Settings: a category list beside the selected page on tablets,
// and a single column with a back arrow on narrow screens.
(() => {
  const dialog = document.querySelector('#settings-dialog');
  const shell = dialog.querySelector('.settings-shell');
  const nav = dialog.querySelector('.settings-nav');
  const pageTitle = document.querySelector('#settings-page-title');
  const back = document.querySelector('#settings-back');
  const search = document.querySelector('#settings-search');
  const noResults = document.querySelector('#settings-no-results');
  const entries = [...nav.querySelectorAll('[data-page]')];
  const pages = new Map([...dialog.querySelectorAll('.settings-page')].map(page => [page.dataset.page, page]));
  const twoPane = window.matchMedia('(min-width: 760px)');
  const toastNode = document.querySelector('#toast');
  const toastHome = toastNode.parentElement;
  let current = 'restaurant';

  const isDetailView = () => shell.dataset.view === 'detail';

  // Panels that read live device state are rebuilt each time their page opens.
  function renderLivePanels(id) {
    const devices = window.RestroDeviceControls;
    if (!devices) return;
    if (id === 'wifi') devices.renderInto('wifi', document.querySelector('#settings-wifi-slot'));
    if (id === 'bluetooth') devices.renderInto('bluetooth', document.querySelector('#settings-bluetooth-slot'));
  }

  function show(id, { focus = false } = {}) {
    if (!pages.has(id)) return;
    current = id;
    for (const [pageId, page] of pages) page.hidden = pageId !== id;
    pageTitle.textContent = pages.get(id).dataset.title;
    for (const entry of entries) {
      const selected = entry.dataset.page === id;
      entry.classList.toggle('selected', selected);
      if (selected) entry.setAttribute('aria-current', 'page'); else entry.removeAttribute('aria-current');
    }
    if (id === 'display') window.RestroThemePicker?.reset();
    if (id === 'counter') paintStylePreviews(); else clearStylePreviews();
    renderLivePanels(id);
    dialog.querySelector('.settings-pages').scrollTop = 0;
    if (!twoPane.matches) shell.dataset.view = 'detail';
    if (focus) {
      const target = id === 'restaurant' ? document.querySelector('#restaurant-input') : back;
      (twoPane.matches && target === back ? pages.get(id).querySelector('input,button,a') : target)?.focus({ preventScroll: true });
    }
  }

  function showList() {
    shell.dataset.view = 'list';
    nav.querySelector(`[data-page="${current}"]`)?.focus({ preventScroll: true });
  }

  function goBack() {
    if (!dialog.open) return false;
    if (search.value) { search.value = ''; filter(); search.focus(); return true; }
    if (!twoPane.matches && isDetailView()) { showList(); return true; }
    return false;
  }

  function reset() {
    search.value = ''; filter();
    window.RestroThemePicker?.reset();
    syncSummaries();
    shell.dataset.view = 'list';
    if (twoPane.matches) show('restaurant');
    else { current = 'restaurant'; for (const [pageId, page] of pages) page.hidden = pageId !== current; }
  }

  function filter() {
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    for (const entry of entries) {
      const text = `${entry.textContent} ${entry.dataset.keywords || ''}`.toLowerCase();
      const match = !query || query.split(/\s+/).every(word => text.includes(word));
      (entry.closest('li') || entry).hidden = !match;
      if (match) matches++;
    }
    noResults.hidden = matches > 0;
  }

  function syncSummaries() {

    const status = window.RestroConnectivity?.getStatus?.();
    const online = status ? status.internetAvailable : navigator.onLine;
    const through = status?.wifi?.connected ? 'Wi-Fi' : status?.cellular?.connected ? 'Mobile data' : '';
    const sample = status?.preview?.wifi ? window.RestroWifi?.sampleNetwork : null;
    document.querySelector('#settings-network-summary').textContent = (online ? 'Online' : 'Offline') + (through ? ` · ${through}` : '');
    document.querySelector('#settings-internet-status').textContent = online ? 'Connected to the internet' : 'No internet connection';
    document.querySelector('#settings-network-type').textContent = through || (status?.source === 'browser' ? 'Not reported by this browser' : 'Not connected');
    const mobile = document.querySelector('#settings-mobile-row');
    mobile.hidden = !status?.hasCellular;
    if (status?.hasCellular) document.querySelector('#settings-mobile-status').textContent = status.cellular.connected ? (status.cellular.level === null ? 'Connected' : `Connected · signal ${status.cellular.level} of 4`) : 'Not connected';
    document.querySelector('#settings-wifi-summary').textContent = sample ? `${sample} (sample)` : status?.preview?.wifi ? 'Preview on' : status?.wifi?.connected ? 'Connected' : status?.source === 'browser' ? 'Managed by this device' : 'Not connected';
    const wifi = window.RestroWifi, bt = window.RestroBluetooth;
    if (wifi && !wifi.on && !wifi.isPreview) document.querySelector('#settings-wifi-summary').textContent = 'Off';
    const paired = bt?.connectedCount || 0;
    document.querySelector('#settings-bluetooth-summary').textContent = bt?.unavailableReason ? 'Not available here' : bt && !bt.on ? 'Off' : paired ? `${paired} connected` : 'On · Not connected';
    const sound = window.RestroSound;
    if (sound) document.querySelector('#settings-sound-summary').textContent = sound.volume ? `Volume ${sound.volume}%${sound.touchSounds ? ` · Touch: ${sound.touchStyle.name}` : ''}` : 'Muted';

    const brightness = window.RestroDeviceControls?.brightness ?? 100;
    document.querySelector('#settings-display-summary').textContent = `Brightness ${brightness}%${window.RestroThemes?.current ? ` · ${window.RestroThemes.current.name}` : ''}`;
    document.querySelector('#settings-brightness-value').textContent = `${brightness}%`;
    document.querySelector('#settings-brightness-range').value = String(brightness);
  }

  // Orders: how long before a scheduled order is due it goes to the kitchen (5 to 240 minutes, in 5-minute steps).
  const PREP_KEY = 'restro.counter.prepMinutes.v1';
  const readPrep = () => { try { const n = Number(JSON.parse(localStorage.getItem(PREP_KEY) || '30')); return Number.isFinite(n) ? Math.min(240, Math.max(5, Math.round(n / 5) * 5)) : 30; } catch { return 30; } };
  function showPrep() {
    const n = readPrep();
    document.querySelector('#settings-prep-value').textContent = `${n} min`;
    document.querySelector('#settings-orders-summary').textContent = `Preparation time ${n} min`;
    document.querySelector('#settings-prep-down').disabled = n <= 5;
    document.querySelector('#settings-prep-up').disabled = n >= 240;
  }
  function stepPrep(delta) {
    const n = Math.min(240, Math.max(5, readPrep() + delta));
    try { localStorage.setItem(PREP_KEY, JSON.stringify(n)); } catch {}
    window.RestroSync?.wrote(PREP_KEY);
    showPrep(); window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: n }));
  }
  // Changed on another tablet (sync.js)
  let prepShown = readPrep();
  window.addEventListener('restro:data-changed', event => {
    if (!(event.detail?.collections || []).includes('settings') || readPrep() === prepShown) return;
    prepShown = readPrep(); showPrep(); window.dispatchEvent(new CustomEvent('restro:prep-time-changed', { detail: prepShown }));
  });
  document.querySelector('#settings-prep-down').addEventListener('click', () => stepPrep(-5));
  document.querySelector('#settings-prep-up').addEventListener('click', () => stepPrep(5));
  showPrep();

  // Counter: Menu display style (Category grid, Pills on top, Vertical rail). Each card is the Counter as it is now in
  // that style (RestroCounter.preview) under a copy of the top bar, laid out at the screen's own size and scaled down to
  // the card, made each time the Counter page opens and cleared when it closes. Tapping a card uses it straight away.
  // The choice is a preference kept on this device only (counter.js).
  const counterStyles = document.querySelector('#counter-style-options');
  const styleCards = new Map(), stylePreviews = [];
  const menuStyles = window.RestroCounter?.menuStyles || [];
  let shot = { w: innerWidth, h: innerHeight };
  const fitPreview = box => { const w = box.getBoundingClientRect().width; if (w) box.style.setProperty('--preview-scale', String(w / shot.w)); };
  const previewFit = new ResizeObserver(list => { for (const entry of list) fitPreview(entry.target); });
  // What the top bar inherits from the screen around it, so the cards' own text styles stay out
  const inheritedLooks = ['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow', 'text-rendering', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'visibility', 'cursor', 'list-style', '-webkit-font-smoothing'];
  function paintStylePreviews() {
    const counter = window.RestroCounter, banner = document.querySelector('#top-banner'), appShell = document.querySelector('.app-shell');
    if (!dialog.open || current !== 'counter' || !counter || !banner || !appShell) { clearStylePreviews(); return; }
    const look = getComputedStyle(appShell), widths = stylePreviews.map(box => box.getBoundingClientRect().width);
    shot = { w: innerWidth, h: innerHeight };
    const bar = banner.cloneNode(true);
    for (const part of [bar, ...bar.querySelectorAll('*')]) for (const name of ['autofocus', 'name', 'title', 'aria-live']) part.removeAttribute(name);
    stylePreviews.forEach((box, i) => {
      const screen = document.createElement('span'); screen.className = 'counter-live-screen'; screen.inert = true;
      for (const name of inheritedLooks) screen.style.setProperty(name, look.getPropertyValue(name));
      screen.style.width = `${shot.w}px`; screen.style.height = `${shot.h}px`;
      const app = document.createElement('span'); app.className = 'counter-live-app';
      app.append(counter.preview(box.dataset.counterStyle));
      const pill = document.createElement('span'); pill.className = 'home-live-pill';
      screen.append(i ? bar.cloneNode(true) : bar, app, pill);
      box.style.aspectRatio = `${shot.w} / ${shot.h}`;
      if (widths[i]) box.style.setProperty('--preview-scale', String(widths[i] / shot.w));
      box.replaceChildren(screen);
      // the order list scrolled to where it is on the Counter
      for (const list of screen.querySelectorAll('[data-scroll-top]')) list.scrollTop = Number(list.dataset.scrollTop) || 0;
    });
  }
  function clearStylePreviews() { for (const box of stylePreviews) box.replaceChildren(); }
  function syncCounterStyle() {
    const style = window.RestroCounter?.menuStyle;
    document.querySelector('#settings-counter-summary').textContent = `Menu display: ${style?.name || 'Pills on top'}`;
    for (const [id, card] of styleCards) {
      card.setAttribute('aria-checked', String(id === style?.id));
      card.tabIndex = id === style?.id ? 0 : -1;
      card.querySelector('.theme-state').textContent = id === style?.id ? 'Applied' : id === 'pills' ? 'Default' : '';
    }
  }
  for (const style of menuStyles) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'theme-option counter-style'; card.dataset.counterStyle = style.id;
    card.setAttribute('role', 'radio'); card.setAttribute('aria-label', style.name);
    const box = document.createElement('span'); box.className = 'theme-preview counter-preview'; box.dataset.counterStyle = style.id; box.setAttribute('aria-hidden', 'true');
    stylePreviews.push(box); previewFit.observe(box);
    const caption = document.createElement('span'); caption.className = 'theme-option-caption';
    const name = document.createElement('strong'); name.textContent = style.name;
    const state = document.createElement('span'); state.className = 'theme-state';
    caption.append(name, state); card.append(box, caption);
    card.addEventListener('click', () => window.RestroCounter?.setMenuStyle(style.id));
    styleCards.set(style.id, card); counterStyles.append(card);
  }
  counterStyles.addEventListener('keydown', event => {
    const card = event.target.closest('.counter-style'); if (!card) return;
    const index = menuStyles.findIndex(style => style.id === card.dataset.counterStyle);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % menuStyles.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + menuStyles.length - 1) % menuStyles.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = menuStyles.length - 1;
    else return;
    event.preventDefault(); window.RestroCounter?.setMenuStyle(menuStyles[next].id); styleCards.get(menuStyles[next].id).focus({ preventScroll: true });
  });
  window.addEventListener('restro:counter-style-changed', syncCounterStyle);
  // The screen turned or resized while the Counter page is open: take the pictures again at the new size
  let restyling = 0;
  addEventListener('resize', () => {
    if (!dialog.open || current !== 'counter' || !stylePreviews[0]?.firstChild || (innerWidth === shot.w && innerHeight === shot.h)) return;
    cancelAnimationFrame(restyling); restyling = requestAnimationFrame(paintStylePreviews);
  });
  syncCounterStyle();

  for (const entry of entries) entry.addEventListener('click', () => show(entry.dataset.page, { focus: !twoPane.matches }));
  back.addEventListener('click', showList);
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = entries.find(entry => !(entry.closest('li') || entry).hidden);
    if (first) { event.preventDefault(); show(first.dataset.page, { focus: true }); }
  });
  document.querySelector('#settings-internet-check').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Checking…';
    try { await window.RestroConnectivity?.refresh?.(); } finally { button.disabled = false; button.textContent = 'Check now'; syncSummaries(); }
  });
  document.querySelector('#settings-brightness-range').addEventListener('input', event => window.RestroDeviceControls?.setBrightness(event.target.value));

  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    window.RestroThemePicker?.reset();
    clearStylePreviews();
    if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  });
  // Keep toasts visible above the full-screen Settings app.
  new MutationObserver(() => { if (dialog.open && toastNode.parentElement !== dialog) dialog.append(toastNode); })
    .observe(dialog, { attributes: true, attributeFilter: ['open'] });

  twoPane.addEventListener('change', () => {
    if (twoPane.matches) { shell.dataset.view = 'list'; show(current); }
  });
  for (const type of ['restro:connectivity-changed', 'restro:brightness-changed', 'restro:bluetooth-changed', 'restro:wifi-changed', 'restro:volume-changed', 'restro:theme-changed', 'restro:restaurant-renamed', 'online', 'offline']) {
    window.addEventListener(type, syncSummaries);
  }

  // Names kept for app.js (openSettings) and the system Back button.
  window.RestroThemeSettings = Object.freeze({ reset, goBack, show });
  reset();
})();
