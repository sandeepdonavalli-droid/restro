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
    if (id === 'themes') window.RestroThemePicker?.reset();
    renderLivePanels(id);
    dialog.querySelector('.settings-pages').scrollTop = 0;
    if (!twoPane.matches) shell.dataset.view = 'detail';
    if (focus) {
      const target = id === 'restaurant' ? document.querySelector('#restaurant-input') : id === 'themes' ? null : back;
      if (id === 'themes') window.RestroThemePicker?.focusCurrent();
      else (twoPane.matches && target === back ? pages.get(id).querySelector('input,button,a') : target)?.focus({ preventScroll: true });
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
    const name = document.querySelector('#restaurant-name')?.textContent.trim() || 'RESTAURANT NAME';
    document.querySelector('#settings-profile-name').textContent = name;
    document.querySelector('#settings-profile-avatar').textContent = name.charAt(0) || 'R';

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
    const paired = window.RestroBluetooth?.connectedCount || 0;
    document.querySelector('#settings-bluetooth-summary').textContent = paired ? `${paired} connected` : 'Not connected';

    const brightness = window.RestroDeviceControls?.brightness ?? 100;
    document.querySelector('#settings-display-summary').textContent = `Brightness ${brightness}%`;
    document.querySelector('#settings-brightness-value').textContent = `${brightness}%`;
    document.querySelector('#settings-brightness-range').value = String(brightness);
  }

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
    if (toastNode.parentElement === dialog) toastHome.append(toastNode);
  });
  // Keep toasts visible above the full-screen Settings app.
  new MutationObserver(() => { if (dialog.open && toastNode.parentElement !== dialog) dialog.append(toastNode); })
    .observe(dialog, { attributes: true, attributeFilter: ['open'] });

  twoPane.addEventListener('change', () => {
    if (twoPane.matches) { shell.dataset.view = 'list'; show(current); }
  });
  for (const type of ['restro:connectivity-changed', 'restro:brightness-changed', 'restro:bluetooth-changed', 'restro:wifi-changed', 'restro:restaurant-renamed', 'online', 'offline']) {
    window.addEventListener(type, syncSummaries);
  }

  // Names kept for app.js (openSettings) and the system Back button.
  window.RestroThemeSettings = Object.freeze({ reset, goBack, show });
  reset();
})();
