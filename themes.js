'use strict';
(() => {
  const root = document.documentElement;
  const storageKey = 'restro.theme.v1';
  const catalog = window.RestroThemeCatalog;
  const byId = new Map(catalog.map(theme => [theme.id, theme]));
  const defaultId = window.RestroDefaultTheme;
  let activeId = defaultId;

  // Every screen is pure white with no theme colour: white surfaces, neutral greys for lines and text, a dark slate
  // where a theme colour used to be (buttons, the selected page dot, focus). These colours are the same whatever theme
  // is chosen; the chosen theme now only picks the app pictures. Colour that carries meaning (order types, categories,
  // paid / not paid) is set by each screen itself. Border lines (edge, line, panel-edge, side-edge) are #cbcfd5: as dark
  // as they were with the themes (Matte Clay's #d4cdc4), in a neutral grey, so tiles and panels stand out on white.
  const PURE = {
    scheme: 'light', bg: '#ffffff', 'bg-top': '#ffffff', 'bg-end': '#ffffff', text: '#1f2933', muted: '#6b7280',
    'tile-top': '#ffffff', 'tile-bottom': '#ffffff', edge: '#cbcfd5', 'card-middle': '#ffffff', panel: '#ffffff',
    'panel-top': '#ffffff', 'panel-edge': '#cbcfd5', line: '#cbcfd5', bar: '#1f2933', 'bar-top': '#27313b', 'bar-line': '#27313b',
    accent: '#1f2933', 'accent-top': '#374151', 'accent-ink': '#1f2933', 'on-accent': '#ffffff', dot: '#d1d5db', track: '#e5e7eb',
    'side-top': '#ffffff', 'side-middle': '#f9fafb', 'side-bottom': '#e5e7eb', 'side-edge': '#cbcfd5', 'edge-glow': '#cbcfd544',
    highlight: '#ffffffbb', shadow: '#0000001a', 'soft-shadow': '#00000012', 'accent-wash': '#f3f4f6', backdrop: '#11182770'
  };
  function apply(id, persist = true) {
    const theme = byId.get(id);
    if (!theme) return false;
    for (const [name, value] of Object.entries(PURE)) {
      root.style.setProperty(`--palette-${name}`, value);
    }
    activeId = id;
    root.dataset.restroTheme = 'W';      // pure white: the themes' own extra styles (tinted tiles, shadows) stay off
    root.dataset.restroArtwork = id;     // the chosen theme still picks the pictures
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PURE.bar);
    if (persist) {
      try { localStorage.setItem(storageKey, id); } catch {}
    }
    window.dispatchEvent(new CustomEvent('restro:theme-changed', { detail: { id, name: theme.name } }));
    return true;
  }
  // Retired palettes migrate to Matte Clay; saved choices among the six remain.
  // This preference never contains customer pages, app order or restaurant name.
  try {
    const saved = localStorage.getItem(storageKey);
    if (byId.has(saved)) activeId = saved;
    else if (saved) localStorage.setItem(storageKey, defaultId);
  } catch {}
  apply(activeId, false);
  window.RestroThemes = Object.freeze({
    list: catalog,
    defaultId,
    get current() { return byId.get(activeId); },
    apply
  });

  document.addEventListener('DOMContentLoaded', () => {
    // The theme picker lives in place on the Settings > Themes page.
    const options = document.querySelector('#theme-options');
    const applyButton = document.querySelector('#theme-apply');
    const status = document.querySelector('#theme-apply-status');
    const buttons = new Map();
    let pendingId = activeId;

    function paintSwatch(element, theme) {
      element.style.setProperty('--swatch-top', theme.tokens['tile-top']);
      element.style.setProperty('--swatch-bottom', theme.tokens['tile-bottom']);
      element.style.setProperty('--swatch-edge', theme.tokens.edge);
      element.style.setProperty('--swatch-accent', theme.tokens.accent);
    }
    function refresh() {
      const current = byId.get(activeId), pending = byId.get(pendingId);
      const currentName = document.querySelector('#current-theme-name'), swatch = document.querySelector('#current-theme-swatch');
      if (currentName) currentName.textContent = current.name;
      if (swatch) paintSwatch(swatch, current);
      document.querySelector('#theme-selection-name').textContent = pending.name;
      status.textContent = pendingId === activeId ? 'Current theme' : 'Ready to apply';
      applyButton.disabled = pendingId === activeId;
      for (const [id, button] of buttons) {
        button.setAttribute('aria-checked', String(id === pendingId));
        button.tabIndex = id === pendingId ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === activeId ? 'Applied' : id === pendingId ? 'Selected' : id === defaultId ? 'Default' : '';
      }
    }
    function select(id, focus = false) {
      if (!byId.has(id)) return;
      pendingId = id; refresh();
      if (focus) buttons.get(id).focus({ preventScroll: true });
    }
    window.RestroThemePicker = Object.freeze({
      reset() { pendingId = activeId; refresh(); },
      focusCurrent() { const button = buttons.get(pendingId); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' }); }
    });

    // Preview each selected skin using the same shared app/artwork catalog.
    for (const theme of catalog) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option'; button.dataset.themeOption = theme.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', `${theme.id} ${theme.name}`);
      const preview = document.createElement('span'); preview.className = 'theme-preview'; preview.setAttribute('aria-hidden', 'true');
      for (const [name, value] of Object.entries(theme.tokens)) preview.style.setProperty(`--preview-${name}`, value);
      const tiles = document.createElement('span'); tiles.className = 'theme-preview-tiles';
      for (const item of [shortcuts[0], shortcuts[3], apps.settings]) {
        const tile = document.createElement('span'); tile.className = 'theme-preview-tile'; tile.append(artNode(item.art, theme.id)); tiles.append(tile);
      }
      preview.append(tiles);
      const caption = document.createElement('span'); caption.className = 'theme-option-caption';
      const number = document.createElement('span'); number.className = 'theme-number'; number.textContent = theme.id;
      const name = document.createElement('strong'); name.textContent = theme.name;
      const state = document.createElement('span'); state.className = 'theme-state';
      caption.append(number, name, state); button.append(preview, caption);
      button.addEventListener('click', () => select(theme.id));
      buttons.set(theme.id, button); options.append(button);
    }
    options.addEventListener('keydown', event => {
      const current = event.target.closest('.theme-option');
      if (!current) return;
      const index = catalog.findIndex(theme => theme.id === current.dataset.themeOption);
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % catalog.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + catalog.length - 1) % catalog.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = catalog.length - 1;
      else return;
      event.preventDefault(); select(catalog[next].id, true); buttons.get(catalog[next].id).scrollIntoView({ block: 'nearest' });
    });
    applyButton.addEventListener('click', () => {
      if (apply(pendingId)) { refresh(); status.textContent = `${byId.get(activeId).name} applied`; }
    });
    window.addEventListener('restro:theme-changed', () => { pendingId = activeId; refresh(); });
    refresh();
  }, { once: true });
})();
