'use strict';
// The Sync button (Update Pack 4, A5; the same as Counter Update 5 §9): one component in every app, layout and theme;
// only its place and size change per layout (top right of the controls). A tap forces an immediate sync. States:
// normal · syncing (light blue, the arrows turning) · synced (green cloud ✓, 2 s) · pending (amber, the number of
// changes waiting to go up) · offline (grey crossed-out cloud: nothing to sync with; everything is kept on this tablet
// meanwhile). RestroSyncButton.create({ cls }) → the button; every one on screen follows the sync status by itself.
(() => {
  const PATHS = {
    sync: 'M240-478q0 45 17 87.5t53 78.5l10 10v-58q0-17 11.5-28.5T360-400q17 0 28.5 11.5T400-360v160q0 17-11.5 28.5T360-160H200q-17 0-28.5-11.5T160-200q0-17 11.5-28.5T200-240h70l-16-14q-52-46-73-105t-21-119q0-94 48-170.5T337-766q14-8 29.5-1t20.5 23q5 15-.5 30T367-691q-58 32-92.5 88.5T240-478Zm480-4q0-45-17-87.5T650-648l-10-10v58q0 17-11.5 28.5T600-560q-17 0-28.5-11.5T560-600v-160q0-17 11.5-28.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720h-70l16 14q49 49 71.5 106.5T800-482q0 94-48 170.5T623-194q-14 8-29.5 1T573-216q-5-15 .5-30t19.5-23q58-32 92.5-88.5T720-482Z',
    cloudDone: 'm413-395-56-56q-12-12-28-12t-28 12q-12 12-12 28.5t12 28.5l85 86q12 12 28 12t28-12l169-169q12-12 12-29t-12-29q-12-12-29-12t-29 12L413-395ZM260-160q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 75-52.5 127.5T740-160H260Z',
    cloudOff: 'M260-160q-92 0-156-64T40-380q0-77 47.5-137T210-594q3-8 6-15.5t6-16.5L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-27.5 11.5T764-83l-78-77H260Zm604-50L322-751q35-24 74.5-36.5T480-800q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 39-15 72.5T864-210Z'
  };
  let busy = false, syncedUntil = 0, timer = 0;
  function look() {
    const st = window.RestroSync?.status?.();
    if (busy || (st?.upstream === 'cloud' && st.cloud?.state === 'syncing')) return { kind: 'syncing' };
    if (Date.now() < syncedUntil) return { kind: 'synced' };
    const reached = st?.upstream === 'hub' ? st.local?.state === 'connected' : st?.upstream === 'cloud' ? st.cloud?.state !== 'offline' : false;
    if (!reached) return { kind: 'offline' };
    return st.waiting > 0 ? { kind: 'pending', count: st.waiting } : { kind: 'normal' };
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function create({ cls = '' } = {}) {
    const l = look(), s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 -960 960 960'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'sync-btn-i');
    s.innerHTML = `<path d="${PATHS[l.kind === 'synced' ? 'cloudDone' : l.kind === 'offline' ? 'cloudOff' : 'sync']}"/>`;
    const label = { normal: 'Sync now', syncing: 'Syncing', synced: 'Synced', pending: `Sync now: ${plural(l.count || 0, 'change')} waiting`,
      offline: 'Sync now: offline, everything is saved on this tablet' }[l.kind];
    const b = document.createElement('button');
    b.type = 'button'; b.className = `sync-btn ${l.kind}${cls ? ` ${cls}` : ''}`; b.dataset.cls = cls; b.title = label; b.setAttribute('aria-label', label);
    b.append(s);
    if (l.kind === 'pending') { const n = document.createElement('span'); n.className = 'sync-btn-n'; n.setAttribute('aria-hidden', 'true'); n.textContent = l.count > 99 ? '99+' : String(l.count); b.append(n); }
    b.addEventListener('click', syncNow);
    return b;
  }
  function paint() {
    for (const old of document.querySelectorAll('.sync-btn')) {
      const focused = document.activeElement === old, next = create({ cls: old.dataset.cls || '' });
      old.replaceWith(next); if (focused) next.focus({ preventScroll: true });
    }
  }
  async function syncNow() {
    const sync = window.RestroSync; if (busy || typeof sync?.syncNow !== 'function') return;
    busy = true; syncedUntil = 0; paint();
    const started = Date.now();
    try { await sync.syncNow(); } catch {}
    await new Promise(done => setTimeout(done, Math.max(0, 700 - (Date.now() - started)))); // (turning long enough to be seen)
    busy = false;
    if (look().kind === 'normal') { syncedUntil = Date.now() + 2000; clearTimeout(timer); timer = setTimeout(paint, 2000); }
    paint();
  }
  window.addEventListener('restro:sync-status', paint);
  window.RestroSyncButton = Object.freeze({ create, paint, syncNow });
})();
