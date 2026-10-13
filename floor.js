'use strict';
// Floor: the restaurant's tables.
// - From Counter (Dine in → Table box): tap a table to put it on the order; Counter comes straight back.
// - From the home screen's Floor shortcut: see the tables and which ones are in use.
(() => {
  const dialog = document.querySelector('#floor-dialog');
  if (!dialog) return;
  const plan = window.RestroFloorPlan && Array.isArray(window.RestroFloorPlan.areas) ? window.RestroFloorPlan : { areas: [] };
  const tables = plan.areas.flatMap(area => (area.tables || []).map(table => ({ ...table, area: area.id })));
  let pick = null;                         // { current, onPick } while Counter is choosing a table
  let areaId = plan.areas[0]?.id || null;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const svg = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = path; return s; };
  const ICON = { home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h4v-5h3v5h4V10"/>', back: '<path d="m15 6-6 6 6 6"/>' };
  const floorIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode(shortcuts.find(item => item.id === 'floor').art) : document.createElement('span');
    art.classList.add('floor-title-icon'); return art;
  };

  // Rendered into its own root so the system bar and toasts placed in the dialog survive re-renders.
  const root = el('div', { class: 'floor-root' }); dialog.prepend(root);

  const tableName = id => tables.find(table => table.id === id)?.name || '';

  function render() {
    const inUse = new Set(window.RestroCounter?.tablesInUse?.() || []);
    const area = plan.areas.find(a => a.id === areaId) || plan.areas[0];
    const head = el('div', { class: 'floor-head' },
      el('button', { type: 'button', class: 'floor-nav', 'aria-label': pick ? 'Back to Counter' : 'Home', title: pick ? 'Back' : 'Home',
        onclick: () => { if (pick) close(); else document.querySelector('#system-home')?.click(); } }, svg(pick ? ICON.back : ICON.home)),
      floorIcon(),
      el('h2', { id: 'floor-title', tabindex: '-1' }, pick ? 'Select a table' : 'Floor'));
    const tabs = plan.areas.length > 1 ? el('div', { class: 'floor-areas', role: 'tablist', 'aria-label': 'Areas' },
      ...plan.areas.map(a => el('button', { type: 'button', role: 'tab', 'aria-selected': String(a === area), class: a === area ? 'on' : '', onclick: () => { areaId = a.id; render(); } }, a.name))) : null;
    const grid = el('div', { class: 'floor-grid' }, ...(area ? area.tables : []).map(table => tableTile(table, inUse)));
    root.replaceChildren(head, tabs || '', grid);
  }

  // A table drawn from above: chairs on both sides, the table number in the middle.
  function tableTile(table, inUse) {
    const selected = Boolean(pick) && pick.current === table.id, busy = !selected && inUse.has(table.id);
    const chairs = n => el('span', { class: 'floor-chairs', 'aria-hidden': 'true' }, ...Array.from({ length: n }, () => el('span', { class: 'floor-chair' })));
    const status = selected ? 'Selected' : busy ? 'In use' : '';
    const shape = table.seats <= 2 ? ' round' : table.seats >= 6 ? ' long' : '';
    const body = [chairs(Math.ceil(table.seats / 2)),
      el('span', { class: `floor-table${shape}` }, el('strong', {}, table.name)),
      chairs(Math.floor(table.seats / 2)),
      el('span', { class: 'floor-meta' }, `${table.seats} seats`, status ? el('span', { class: 'floor-status' }, status) : null)];
    const label = `Table ${table.name}, ${table.seats} seats${status ? `, ${status.toLowerCase()}` : ''}`;
    const cls = `floor-tile${selected ? ' selected' : ''}${busy ? ' busy' : ''}`;
    return pick ? el('button', { type: 'button', class: cls, 'aria-label': label, onclick: () => choose(table) }, ...body)
      : el('div', { class: cls, role: 'img', 'aria-label': label }, ...body);
  }

  function choose(table) {
    const done = pick?.onPick;
    close();
    done?.({ id: table.id, name: table.name, seats: table.seats });
  }
  function close() { pick = null; if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => { pick = null; });

  // Toasts must show above this full-screen app (and go back to Counter, or home, after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) (document.querySelector('#counter-dialog[open]') || toastHome).append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  window.RestroFloor = Object.freeze({
    // open({ pick: true, current: 'T4', onPick(table) }) from Counter; open() from the home screen.
    open(options = {}) {
      if (options.pick) {
        pick = { current: options.current || null, onPick: typeof options.onPick === 'function' ? options.onPick : null };
        const current = tables.find(table => table.id === pick.current); if (current) areaId = current.area;
      } else {
        pick = null;
        document.querySelectorAll('dialog[open]').forEach(d => d.close());
      }
      render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('#floor-title')?.focus({ preventScroll: true });
    },
    tableName,
    get tables() { return tables.map(({ id, name, seats, area }) => ({ id, name, seats, area })); }
  });
})();
