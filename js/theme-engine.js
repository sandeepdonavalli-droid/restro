'use strict';
(() => {
  const root = document.documentElement;
  const storageKey = 'restro.batteryPreview.theme.v1';
  const catalog = window.RestroThemeCatalog;
  const byId = new Map(catalog.map(theme => [theme.id, theme]));
  let activeId = 'original';

  function apply(id, persist = true) {
    const theme = byId.get(id);
    if (!theme) return false;
    for (const [name, value] of Object.entries(theme.tokens)) {
      root.style.setProperty(`--palette-${name}`, value);
    }
    activeId = id;
    root.dataset.restroTheme = id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.bar);
    if (persist) {
      try { localStorage.setItem(storageKey, id); } catch {}
    }
    window.dispatchEvent(new CustomEvent('restro:theme-changed', { detail: { id, name: theme.name } }));
    return true;
  }
  // Apply before the first paint. Preferences never contain icons or app layout.
  try { const saved = localStorage.getItem(storageKey); if (byId.has(saved)) activeId = saved; } catch {}
  apply(activeId, false);
  window.RestroThemes = Object.freeze({
    list: catalog,
    get current() { return byId.get(activeId); },
    apply
  });

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.querySelector('#settings-dialog');
    const general = document.querySelector('#settings-general');
    const themesView = document.querySelector('#settings-themes');
    const back = document.querySelector('#themes-back');
    const options = document.querySelector('#theme-options');
    const applyButton = document.querySelector('#theme-apply');
    const status = document.querySelector('#theme-apply-status');
    const buttons = new Map();
    let pendingId = activeId;

    function paintSwatch(element, theme) {
      element.style.setProperty('--swatch-top', theme.tokens['tile-top']);
      element.style.setProperty('--swatch-bottom', theme.tokens['tile-bottom']);
      element.style.setProperty('--swatch-edge', theme.tokens.edge);
    }
    function refresh() {
      const current = byId.get(activeId), pending = byId.get(pendingId);
      document.querySelector('#current-theme-name').textContent = current.name;
      paintSwatch(document.querySelector('#current-theme-swatch'), current);
      document.querySelector('#theme-selection-name').textContent = pending.name;
      status.textContent = pendingId === activeId ? 'Current theme' : 'Ready to apply';
      applyButton.disabled = pendingId === activeId;
      for (const [id, button] of buttons) {
        button.setAttribute('aria-checked', String(id === pendingId));
        button.tabIndex = id === pendingId ? 0 : -1;
        button.querySelector('.theme-state').textContent = id === activeId ? 'Applied' : id === pendingId ? 'Selected' : '';
      }
    }
    function select(id, focus = false) {
      if (!byId.has(id)) return;
      pendingId = id; refresh();
      if (focus) buttons.get(id).focus({ preventScroll: true });
    }
    function showGeneral() {
      pendingId = activeId;
      themesView.hidden = true; general.hidden = false; back.hidden = true;
      dialog.classList.remove('showing-themes');
      document.querySelector('#settings-title').textContent = 'Settings';
      refresh();
    }
    function goBack() {
      if (themesView.hidden) return false;
      showGeneral(); document.querySelector('#themes-open').focus({ preventScroll: true });
      return true;
    }
    window.RestroThemeSettings = Object.freeze({ reset: showGeneral, goBack });

    // Previews reuse the same live artwork definitions as the launcher and Recents.
    // No theme owns a logo, icon file, copied app page, or customer app arrangement.
    for (const theme of catalog) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-option'; button.dataset.themeOption = theme.id;
      button.setAttribute('role', 'radio'); button.setAttribute('aria-label', `${theme.id === 'original' ? 'Original' : theme.id} ${theme.name}`);
      const preview = document.createElement('span'); preview.className = 'theme-preview'; preview.setAttribute('aria-hidden', 'true');
      for (const [name, value] of Object.entries(theme.tokens)) preview.style.setProperty(`--preview-${name}`, value);
      const tiles = document.createElement('span'); tiles.className = 'theme-preview-tiles';
      for (const item of [shortcuts[0], shortcuts[3], apps.settings]) {
        const tile = document.createElement('span'); tile.className = 'theme-preview-tile'; tile.append(artNode(item.art)); tiles.append(tile);
      }
      preview.append(tiles);
      const caption = document.createElement('span'); caption.className = 'theme-option-caption';
      const number = document.createElement('span'); number.className = 'theme-number'; number.textContent = theme.id === 'original' ? 'Original' : theme.id;
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
    document.querySelector('#themes-open').addEventListener('click', () => {
      pendingId = activeId;
      general.hidden = true; themesView.hidden = false; back.hidden = false;
      dialog.classList.add('showing-themes'); document.querySelector('#settings-title').textContent = 'Themes';
      refresh(); buttons.get(activeId).focus({ preventScroll: true }); buttons.get(activeId).scrollIntoView({ block: 'nearest' });
    });
    back.addEventListener('click', goBack);
    applyButton.addEventListener('click', () => {
      if (apply(pendingId)) { refresh(); status.textContent = `${byId.get(activeId).name} applied`; }
    });
    dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });
    dialog.addEventListener('close', showGeneral);
    window.addEventListener('restro:theme-changed', () => { pendingId = activeId; refresh(); });
    refresh();
  }, { once: true });
})();
