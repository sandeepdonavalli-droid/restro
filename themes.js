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
  const BACKGROUNDS = Object.freeze([Object.freeze({ id: 'default', name: 'Default', line: 'The theme’s own colours.' }),
    Object.freeze({ id: 'mirror', name: 'Mirror', line: 'The theme’s colours as faceted glass, across the whole screen.' })]);
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
    // The apps have two themes, Light and Midnight (Update Pack 2): Home on Aurora Dark gives Midnight, a plain deep navy,
    // the same in every app; White and Sea breeze give Light. Only the Counter has Midnight so far (counter-midnight.css).
    root.dataset.appTheme = id === 'aurora' ? 'midnight' : 'light';
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

    // Every preview is this tablet's home screen as it is right now (its own apps and pages, the dock, the widgets and
    // the name), copied each time the Display page opens and shown small, in a theme and with a background
    // (settings.css). Only a picture: nothing in it can be tapped, focused or read out. Cleared when Settings closes.
    const picker = options.closest('dialog'), previews = [];
    let shotWidth = innerWidth, shotHeight = innerHeight;
    const scaleOf = box => { const width = box.getBoundingClientRect().width; if (width) box.style.setProperty('--preview-scale', String(width / shotWidth)); };
    const fit = new ResizeObserver(entries => { for (const entry of entries) scaleOf(entry.target); });
    function previewBox(themeId, background) {
      const box = document.createElement('span'); box.className = 'theme-preview home-preview home-live';
      box.dataset.homeTheme = themeId; box.dataset.homeBackground = background; box.setAttribute('aria-hidden', 'true');
      previews.push(box); fit.observe(box); return box;
    }
    function copyOf(node) {
      const copy = node.cloneNode(true);
      copy.style.removeProperty('transform'); // a swipe's zoom, if one was under way
      for (const part of [copy, ...copy.querySelectorAll('*')]) for (const name of ['autofocus', 'name', 'title', 'aria-live']) part.removeAttribute(name);
      return copy;
    }
    // What the top bar and the home inherit from the screen around them, so the cards' own text styles stay out
    const inherited = ['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow', 'text-rendering', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'visibility', 'cursor', 'list-style', '-webkit-font-smoothing'];
    function paintPreviews() {
      const shell = document.querySelector('.app-shell'), banner = document.querySelector('#top-banner'), home = document.querySelector('#home');
      if (!picker?.open || !shell || !banner || !home) { for (const box of previews) box.replaceChildren(); return; }
      // One copy, then one more of it for each card; the cards measured once, before any goes in
      const look = getComputedStyle(shell), widths = previews.map(box => box.getBoundingClientRect().width);
      shotWidth = innerWidth; shotHeight = innerHeight;
      const screen = document.createElement('span'); screen.className = 'home-live-screen'; screen.inert = true;
      for (const name of inherited) screen.style.setProperty(name, look.getPropertyValue(name));
      screen.style.width = `${shotWidth}px`; screen.style.height = `${shotHeight}px`;
      const pill = document.createElement('span'); pill.className = 'home-live-pill';
      screen.append(copyOf(banner), copyOf(home), pill);
      previews.forEach((box, i) => {
        box.style.aspectRatio = `${shotWidth} / ${shotHeight}`;
        if (widths[i]) box.style.setProperty('--preview-scale', String(widths[i] / shotWidth));
        box.replaceChildren(i ? screen.cloneNode(true) : screen);
      });
    }
    // The screen turned or resized while the Display page is open: take the pictures again at the new size
    let resizing = 0;
    addEventListener('resize', () => {
      if (!picker?.open || !previews[0]?.firstChild || (innerWidth === shotWidth && innerHeight === shotHeight)) return;
      cancelAnimationFrame(resizing); resizing = requestAnimationFrame(paintPreviews);
    });

    function refresh() {
      const pending = byId.get(pendingId), unchanged = pendingId === activeId && pendingBackground === backgroundId;
      document.querySelector('#theme-selection-name').textContent = pendingBackground === 'mirror' ? `${pending.name} · Mirror` : pending.name;
      status.textContent = unchanged ? 'Current theme' : 'Ready to apply';
      applyButton.disabled = unchanged;
      for (const [id, button] of buttons) {
        button.setAttribute('aria-checked', String(id === pendingId));
        button.tabIndex = id === pendingId ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === activeId ? 'Applied' : '';
      }
      // Each theme is shown with the background selected; each background in the theme selected
      for (const [, button] of buttons) button.querySelector('.home-live').dataset.homeBackground = pendingBackground;
      for (const [id, button] of backgroundButtons) {
        button.setAttribute('aria-checked', String(id === pendingBackground));
        button.tabIndex = id === pendingBackground ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === backgroundId ? 'Applied' : '';
        button.querySelector('.home-live').dataset.homeTheme = pendingId;
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
      reset() { pendingId = activeId; pendingBackground = backgroundId; paintPreviews(); refresh(); },
      focusCurrent() { const button = buttons.get(pendingId); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' }); }
    });

    // An option's top: the radio, its name with "Applied" at the end, and its line
    function tileTop(name, line) {
      const top = document.createElement('span'); top.className = 'st-tile-top';
      const radio = document.createElement('span'); radio.className = 'st-rd';
      const title = document.createElement('b'); title.textContent = name;
      const state = document.createElement('span'); state.className = 'theme-state';
      const text = document.createElement('span'); text.className = 'theme-line'; text.textContent = line || '';
      top.append(radio, title, state, text); return top;
    }
    // Each theme as this home screen in it
    for (const theme of catalog) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option st-tile'; button.dataset.themeOption = theme.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', theme.name);
      const preview = previewBox(theme.id, pendingBackground);
      button.append(tileTop(theme.name, theme.line), preview);
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
    // Home screen background: Default and Mirror, each as this home screen in the selected theme with it
    for (const background of BACKGROUNDS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option st-tile'; button.dataset.backgroundOption = background.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', `${background.name} background`);
      const preview = previewBox(pendingId, background.id);
      button.append(tileTop(background.name, background.line), preview);
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
