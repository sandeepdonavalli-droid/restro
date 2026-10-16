'use strict';
// Tile style (Settings > Display): one 3D look for every tile and button in the app, picked from three:
// Chiselled bevel, Keycap and Extruded block. The look is drawn by tiles.css from the data-restro-tiles attribute on
// the page, so it is set here before anything is shown. The choice is a preference kept on this device only.
(() => {
  const root = document.documentElement;
  const storageKey = 'restro.tiles.v1';
  const STYLES = Object.freeze([
    Object.freeze({ id: 'bevel', name: 'Chiselled bevel' }),
    Object.freeze({ id: 'keycap', name: 'Keycap' }),
    Object.freeze({ id: 'block', name: 'Extruded block' })
  ]);
  const byId = new Map(STYLES.map(style => [style.id, style]));
  const defaultId = 'bevel';
  let current = defaultId;
  try { const saved = localStorage.getItem(storageKey); if (byId.has(saved)) current = saved; } catch {}
  root.dataset.restroTiles = current;

  function apply(id) {
    if (!byId.has(id)) return false;
    current = id;
    root.dataset.restroTiles = id;
    try { localStorage.setItem(storageKey, id); } catch {}
    window.dispatchEvent(new CustomEvent('restro:tiles-changed', { detail: { id, name: byId.get(id).name } }));
    return true;
  }
  window.RestroTiles = Object.freeze({ list: STYLES, defaultId, get current() { return byId.get(current); }, apply });

  // Settings > Display: the three looks in a list, each with a sample tile drawn in that look. Picking one uses it on
  // every screen straight away.
  document.addEventListener('DOMContentLoaded', () => {
    const list = document.querySelector('#settings-tiles');
    if (!list) return;
    for (const style of STYLES) {
      const label = document.createElement('label');
      label.className = 'settings-item tile-style';
      label.htmlFor = `tile-style-${style.id}`;
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'tile-style'; input.id = `tile-style-${style.id}`; input.value = style.id;
      const copy = document.createElement('span'); copy.className = 'settings-row-copy';
      const name = document.createElement('strong'); name.textContent = style.name;
      copy.append(name);
      const sample = document.createElement('span');
      sample.className = 'tile-sample'; sample.dataset.tiles = style.id; sample.setAttribute('aria-hidden', 'true');
      const face = document.createElement('span'); face.className = 'tile-sample-face'; face.textContent = 'Order type';
      sample.append(face);
      label.append(input, copy, sample);
      input.addEventListener('change', () => { if (input.checked) apply(style.id); });
      list.append(label);
    }
    const sync = () => list.querySelectorAll('input[name="tile-style"]').forEach(input => { input.checked = input.value === current; });
    window.addEventListener('restro:tiles-changed', sync);
    sync();
  }, { once: true });
})();
