'use strict';
(() => {
  const root = document.documentElement;
  const storageKey = 'restro.theme.v1';
  const catalog = window.RestroThemeCatalog;
  const byId = new Map(catalog.map(theme => [theme.id, theme]));
  const defaultId = window.RestroDefaultTheme;
  let activeId = defaultId;

  // Every page but the home screen is pure white with no theme colour: white surfaces, neutral greys for lines and text, a
  // dark slate where a theme colour used to be (buttons, the selected page dot, focus). These colours are the same
  // whatever theme is chosen. Colour that carries meaning (order types, categories, paid / not paid) is set by each screen
  // itself. Border lines (edge, line, panel-edge, side-edge) are #cbcfd5, so tiles and panels stand out on white.
  const PURE = {
    scheme: 'light', bg: '#ffffff', 'bg-top': '#ffffff', 'bg-end': '#ffffff', text: '#1f2933', muted: '#6b7280',
    'tile-top': '#ffffff', 'tile-bottom': '#ffffff', edge: '#cbcfd5', 'card-middle': '#ffffff', panel: '#ffffff',
    'panel-top': '#ffffff', 'panel-edge': '#cbcfd5', line: '#cbcfd5', bar: '#1f2933', 'bar-top': '#27313b', 'bar-line': '#27313b',
    accent: '#1f2933', 'accent-top': '#374151', 'accent-ink': '#1f2933', 'on-accent': '#ffffff', dot: '#d1d5db', track: '#e5e7eb',
    'side-top': '#ffffff', 'side-middle': '#f9fafb', 'side-bottom': '#e5e7eb', 'side-edge': '#cbcfd5', 'edge-glow': '#cbcfd544',
    highlight: '#ffffffbb', shadow: '#0000001a', 'soft-shadow': '#00000012', 'accent-wash': '#f3f4f6', backdrop: '#11182770'
  };
  // Home screen background (Settings > Display, under the themes): Default, or Mirror, the active theme's mirror picture
  // (assets/home-backgrounds) in place of its own background. The smallest picture that covers the screen is used. Home
  // screen only (launcher.css); kept on this device like the theme, and kept when the theme changes.
  const backgroundKey = 'restro.homeBackground.v1';
  const BACKGROUNDS = Object.freeze([Object.freeze({ id: 'default', name: 'Default' }), Object.freeze({ id: 'mirror', name: 'Mirror' })]);
  const MIRROR_SIZES = [[1440, 900], [1920, 1200], [2560, 1600], [2880, 1800], [4320, 2700]];
  let backgroundId = 'default', mirrorSize = null;
  try { if (localStorage.getItem(backgroundKey) === 'mirror') backgroundId = 'mirror'; } catch {}
  function paintBackground() {
    root.dataset.homeBackground = backgroundId;
    if (backgroundId !== 'mirror') { root.style.removeProperty('--home-mirror'); return; }
    const dpr = window.devicePixelRatio || 1, need = Math.max(innerWidth * dpr, innerHeight * dpr * 1.6);
    const fit = MIRROR_SIZES.find(([width]) => width >= need) || MIRROR_SIZES.at(-1);
    if (!mirrorSize || fit[0] > mirrorSize[0]) mirrorSize = fit;   // a larger screen gets a larger picture, never a smaller one
    const url = new URL(`assets/home-backgrounds/${activeId}-mirror-${mirrorSize[0]}x${mirrorSize[1]}.webp`, document.baseURI).href;
    root.style.setProperty('--home-mirror', `url("${url}")`);
  }
  function applyBackground(id, persist = true) {
    if (!BACKGROUNDS.some(background => background.id === id)) return false;
    backgroundId = id; paintBackground();
    if (persist) { try { localStorage.setItem(backgroundKey, id); } catch {} }
    window.dispatchEvent(new CustomEvent('restro:home-background-changed', { detail: { id } }));
    return true;
  }
  addEventListener('resize', () => { if (backgroundId === 'mirror') paintBackground(); });

  // The chosen theme is the home screen's (White, Sea breeze or Aurora: theme-data.js); the pages keep the colours above
  function apply(id, persist = true) {
    const theme = byId.get(id);
    if (!theme) return false;
    for (const [name, value] of Object.entries(PURE)) {
      root.style.setProperty(`--palette-${name}`, value);
    }
    activeId = id;
    root.dataset.restroTheme = 'W';      // the pages: pure white
    root.dataset.homeTheme = id;         // the home screen: launcher.css, status-bar.css
    paintBackground();                   // its background, Default or Mirror, in this theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PURE.bar);
    if (persist) {
      try { localStorage.setItem(storageKey, id); } catch {}
    }
    window.dispatchEvent(new CustomEvent('restro:theme-changed', { detail: { id, name: theme.name } }));
    return true;
  }
  // The six earlier themes are gone: a tablet that had one of them starts on White.
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
    apply,
    backgrounds: BACKGROUNDS,
    get background() { return backgroundId; },
    applyBackground
  });

  document.addEventListener('DOMContentLoaded', () => {
    // The theme picker lives in place on the Settings > Display page
    const options = document.querySelector('#theme-options');
    const applyButton = document.querySelector('#theme-apply');
    const status = document.querySelector('#theme-apply-status');
    const backgroundOptions = document.querySelector('#home-background-options');
    const buttons = new Map(), backgroundButtons = new Map();
    let pendingId = activeId, pendingBackground = backgroundId;

    function refresh() {
      const pending = byId.get(pendingId), unchanged = pendingId === activeId && pendingBackground === backgroundId;
      document.querySelector('#theme-selection-name').textContent = pendingBackground === 'mirror' ? `${pending.name} · Mirror` : pending.name;
      status.textContent = unchanged ? 'Current theme' : 'Ready to apply';
      applyButton.disabled = unchanged;
      for (const [id, button] of buttons) {
        button.setAttribute('aria-checked', String(id === pendingId));
        button.tabIndex = id === pendingId ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === activeId ? 'Applied' : id === pendingId ? 'Selected' : id === defaultId ? 'Default' : '';
      }
      // The background choices show the selected theme, as it looks with each
      for (const [id, button] of backgroundButtons) {
        button.setAttribute('aria-checked', String(id === pendingBackground));
        button.tabIndex = id === pendingBackground ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === backgroundId ? 'Applied' : id === pendingBackground ? 'Selected' : '';
        const preview = button.querySelector('.background-preview'), src = `assets/home-backgrounds/previews/${pendingId}-${id}.webp`;
        if (preview.getAttribute('src') !== src) preview.src = src;
      }
    }
    function select(id, focus = false) {
      if (!byId.has(id)) return;
      pendingId = id; refresh();
      if (focus) buttons.get(id).focus({ preventScroll: true });
    }
    function selectBackground(id, focus = false) {
      if (!backgroundButtons.has(id)) return;
      pendingBackground = id; refresh();
      if (focus) backgroundButtons.get(id).focus({ preventScroll: true });
    }
    window.RestroThemePicker = Object.freeze({
      reset() { pendingId = activeId; pendingBackground = backgroundId; refresh(); },
      focusCurrent() { const button = buttons.get(pendingId); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' }); }
    });

    // Each theme as a small home screen: its background, its top bar, three app icons and a widget card (settings.css)
    for (const theme of catalog) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option'; button.dataset.themeOption = theme.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', theme.name);
      const preview = document.createElement('span'); preview.className = 'theme-preview home-preview'; preview.dataset.homeTheme = theme.id;
      preview.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span'); bar.className = 'home-preview-bar';
      const icons = document.createElement('span'); icons.className = 'home-preview-icons';
      for (const item of [shortcuts[0], shortcuts[3], apps.settings]) {
        const icon = document.createElement('span'); icon.className = 'home-preview-icon'; icon.append(artNode(item.art)); icons.append(icon);
      }
      const card = document.createElement('span'); card.className = 'home-preview-card';
      preview.append(bar, icons, card);
      const caption = document.createElement('span'); caption.className = 'theme-option-caption';
      const name = document.createElement('strong'); name.textContent = theme.name;
      const state = document.createElement('span'); state.className = 'theme-state';
      caption.append(name, state); button.append(preview, caption);
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
    // Home screen background: Default and Mirror, each shown as the selected theme's home screen with it
    for (const background of BACKGROUNDS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option'; button.dataset.backgroundOption = background.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', `${background.name} background`);
      const preview = document.createElement('img'); preview.className = 'theme-preview background-preview'; preview.alt = '';
      preview.width = 720; preview.height = 450; preview.decoding = 'async';
      const caption = document.createElement('span'); caption.className = 'theme-option-caption';
      const name = document.createElement('strong'); name.textContent = background.name;
      const state = document.createElement('span'); state.className = 'theme-state';
      caption.append(name, state); button.append(preview, caption);
      button.addEventListener('click', () => selectBackground(background.id));
      backgroundButtons.set(background.id, button); backgroundOptions.append(button);
    }
    backgroundOptions.addEventListener('keydown', event => {
      const current = event.target.closest('.theme-option');
      if (!current) return;
      const index = BACKGROUNDS.findIndex(background => background.id === current.dataset.backgroundOption);
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % BACKGROUNDS.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + BACKGROUNDS.length - 1) % BACKGROUNDS.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = BACKGROUNDS.length - 1;
      else return;
      event.preventDefault(); selectBackground(BACKGROUNDS[next].id, true);
    });
    applyButton.addEventListener('click', () => {
      const themeOk = pendingId === activeId || apply(pendingId);
      if (pendingBackground !== backgroundId) applyBackground(pendingBackground);
      if (themeOk) { refresh(); status.textContent = `${applyButton.previousElementSibling.querySelector('strong').textContent} applied`; }
    });
    window.addEventListener('restro:theme-changed', () => { pendingId = activeId; refresh(); });
    window.addEventListener('restro:home-background-changed', () => { pendingBackground = backgroundId; refresh(); });
    refresh();
  }, { once: true });
})();
