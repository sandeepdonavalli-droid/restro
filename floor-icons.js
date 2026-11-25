'use strict';
// Icons for the Floor and Bookings (Update Pack 8), as the designs draw them:
// - stroke icons: Lucide (ISC licence, assets/icons/LUCIDE-LICENSE.txt), 24 x 24, stroke 2, round ends;
// - filled icons: Google's Material Symbols Rounded (Apache 2.0), as the Counter's, on its 960 grid (the pager: the
//   Counter's own);
// - our own: Move / Merge (two tables joined) and Move items (lines with an arrow), as the menu rows draw them; the
//   armchair (guests and seats), drawn to the designs' own chair on a 30 x 30 grid (the glyph fills it); walk-in (a
//   person walking), on a 12 x 17 grid.
// RestroFloorIcons.svg(name, cls): a new <svg>, aria-hidden, data-i = its name (for sizes per icon in the styles).
(() => {
  const STROKE = {
    'armchair': "<path d='M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3'/> <path d='M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z'/> <path d='M5 18v2'/> <path d='M19 18v2'/>",
    'arrow-right': "<path d='M5 12h14'/> <path d='m12 5 7 7-7 7'/>",
    'bell': "<path d='M10.268 21a2 2 0 0 0 3.464 0'/> <path d='M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'/>",
    'calendar': "<path d='M8 2v3'/> <path d='M16 2v3'/> <rect x='3' y='3' width='18' height='18' rx='2'/> <path d='M3 9h18'/>",
    'calendar-x': "<path d='M8 2v3'/> <path d='M16 2v3'/> <rect x='3' y='3' width='18' height='18' rx='2'/> <path d='M3 9h18'/> <path d='m14 13-4 4'/> <path d='m10 13 4 4'/>",
    'calendar-days': "<path d='M8 2v3'/> <path d='M16 2v3'/> <rect x='3' y='3' width='18' height='18' rx='2'/> <path d='M3 9h18'/> <path d='M8 13h.01'/> <path d='M12 13h.01'/> <path d='M16 13h.01'/> <path d='M8 17h.01'/> <path d='M12 17h.01'/> <path d='M16 17h.01'/>",
    'calendar-clock': "<path d='M16 2v3'/> <path d='M17 15.5v1.7l1 .625'/> <path d='M21 8.936V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h3.935'/> <path d='M3 9h9.873'/> <path d='M8 2v3'/> <circle cx='17' cy='17' r='5'/>",
    'check': "<path d='M20 6 9 17l-5-5'/>",
    'chevron-down': "<path d='m6 9 6 6 6-6'/>",
    'chevron-left': "<path d='m15 18-6-6 6-6'/>",
    'chevron-right': "<path d='m9 18 6-6-6-6'/>",
    'clock': "<circle cx='12' cy='12' r='10'/> <path d='M12 6v6l4 2'/>",
    'layout-grid': "<rect width='7' height='7' x='3' y='3' rx='1'/> <rect width='7' height='7' x='14' y='3' rx='1'/> <rect width='7' height='7' x='14' y='14' rx='1'/> <rect width='7' height='7' x='3' y='14' rx='1'/>",
    'list-filter': "<path d='M2 5h20'/> <path d='M6 12h12'/> <path d='M9 19h6'/>",
    'menu': "<path d='M4 5h16'/> <path d='M4 12h16'/> <path d='M4 19h16'/>",
    'pencil': "<path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/> <path d='m15 5 4 4'/>",
    'phone': "<path d='M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384'/>",
    'send-horizontal': "<path d='M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z'/> <path d='M6 12h16'/>",
    'timer': "<line x1='10' x2='14' y1='2' y2='2'/> <line x1='12' x2='15' y1='14' y2='11'/> <circle cx='12' cy='14' r='8'/>",
    'user': "<path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/> <circle cx='12' cy='7' r='4'/>",
    'user-round': "<circle cx='12' cy='8' r='5'/> <path d='M20 21a8 8 0 0 0-16 0'/>",
    'user-round-x': "<path d='m16.5 16.5 5 5'/> <path d='M2 21a8 8 0 0 1 11.531-7.18'/> <path d='m21.5 16.5-5 5'/> <circle cx='10' cy='8' r='5'/>",
    'user-x': "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/> <circle cx='9' cy='7' r='4'/> <line x1='17' x2='22' y1='8' y2='13'/> <line x1='22' x2='17' y1='8' y2='13'/>",
    'x': "<path d='M18 6 6 18'/> <path d='m6 6 12 12'/>",
    'users': "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/> <path d='M16 3.128a4 4 0 0 1 0 7.744'/> <path d='M22 21v-2a4 4 0 0 0-3-3.87'/> <circle cx='9' cy='7' r='4'/>",
    'vibrate': "<path d='m2 8 2 2-2 2 2 2-2 2'/> <path d='m22 8-2 2 2 2-2 2 2 2'/> <rect width='8' height='14' x='8' y='5' rx='1'/>",
    'footprints': "<path d='M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z'/> <path d='M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z'/> <path d='M16 17h4'/> <path d='M4 13h4'/>",
    'sticky-note': "<path d='M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z'/> <path d='M15 3v5a1 1 0 0 0 1 1h5'/>",
    'list-end': "<path d='M16 5H3'/> <path d='M16 12H3'/> <path d='M9 19H3'/> <path d='m16 16-3 3 3 3'/> <path d='M21 5v12a2 2 0 0 1-2 2h-6'/>",
    'link-2': "<path d='M9 17H7A5 5 0 0 1 7 7h2'/> <path d='M15 7h2a5 5 0 1 1 0 10h-2'/> <line x1='8' x2='16' y1='12' y2='12'/>",
    trash: "<path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M3 6h18'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/>",
    'circle-check': "<circle cx='12' cy='12' r='10'/><path d='m16 9-5.5 5.5L8 12'/>",
    plus: "<path d='M5 12h14'/><path d='M12 5v14'/>",
    minus: "<path d='M5 12h14'/>",
    // (ours) two tables joined: Move / Merge tables, Merge, Unmerge
    merge: "<rect x='2.5' y='7' width='8.5' height='10' rx='3'/><rect x='13' y='7' width='8.5' height='10' rx='3'/><path d='M11 12h2'/>",
    // (ours) three lines and an arrow: Move items
    'move-items': "<path d='M3 6h14'/><path d='M3 12h9'/><path d='M3 18h9'/><path d='M15 18h6'/><path d='m18.5 15.5 2.5 2.5-2.5 2.5'/>"
  };
  // (ours) walk-in: a person walking, as the reservation's Phone / Walk-in switch draws it (on its own 12 x 17 grid)
  const WALK = "<circle cx='5' cy='2.6' r='1.55'/><path d='M4.9 5.25 4.6 10.75M4.5 6.1 1.8 8.4M5.3 6.2 8.7 8l2.1.8M4.3 11 2.1 15.4M4.9 11l1.9 1.4v3'/>";
  // (ours) the armchair: a tall back with its cushion, the arms joined to the seat, two short legs
  const OWN = {
    chair: 'M9 0H21A4 4 0 0 1 25 4V11C25 12.6 21 12.4 21 14.5V15.5A1.5 1.5 0 0 1 19.5 17H10.5A1.5 1.5 0 0 1 9 15.5V14.5C9 12.4 5 12.6 5 11V4A4 4 0 0 1 9 0Z' +
      'M0 15.1A3.35 3.35 0 0 1 6.7 15.1V20H23.3V15.1A3.35 3.35 0 0 1 30 15.1V23A4 4 0 0 1 26.7 26.94V30H23.3V27H6.7V30H3.3V26.94A4 4 0 0 1 0 23Z'
  };
  const FILL = {
    vibration: 'M40-600q17 0 28.5 11.5T80-560v160q0 17-11.5 28.5T40-360q-17 0-28.5-11.5T0-400v-160q0-17 11.5-28.5T40-600Zm120-80q17 0 28.5 11.5T200-640v320q0 17-11.5 28.5T160-280q-17 0-28.5-11.5T120-320v-320q0-17 11.5-28.5T160-680Zm760 80q17 0 28.5 11.5T960-560v160q0 17-11.5 28.5T920-360q-17 0-28.5-11.5T880-400v-160q0-17 11.5-28.5T920-600Zm-120-80q17 0 28.5 11.5T840-640v320q0 17-11.5 28.5T800-280q-17 0-28.5-11.5T760-320v-320q0-17 11.5-28.5T800-680ZM320-120q-33 0-56.5-23.5T240-200v-560q0-33 23.5-56.5T320-840h320q33 0 56.5 23.5T720-760v560q0 33-23.5 56.5T640-120H320Z'
  };
  function svg(name, cls = '') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.dataset.i = name;
    if (name === 'walk') { s.setAttribute('viewBox', '0 0 12 17'); s.setAttribute('class', `fi fi-stroke ${cls}`.trim()); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = WALK; return s; }
    if (OWN[name]) { s.setAttribute('viewBox', '0 0 30 30'); s.setAttribute('class', `fi fi-fill ${cls}`.trim()); s.innerHTML = `<path d="${OWN[name]}"/>`; return s; }
    if (FILL[name]) { s.setAttribute('viewBox', '0 -960 960 960'); s.setAttribute('class', `fi fi-fill ${cls}`.trim()); s.innerHTML = `<path d="${FILL[name]}"/>`; return s; }
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `fi fi-stroke ${cls}`.trim());
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = STROKE[name] || ''; return s;
  }
  window.RestroFloorIcons = Object.freeze({ svg, has: name => Boolean(STROKE[name] || FILL[name] || OWN[name] || name === 'walk') });
})();
