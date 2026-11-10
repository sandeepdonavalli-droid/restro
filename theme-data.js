// The home screen's three themes (POS Home Handoff and its Update 1). A theme changes the home screen only: its
// background, top bar, widgets, app names, page dots and icon shadows (launcher.css, status-bar.css). Every other page
// keeps its own look under the light top bar. White is the default.
window.RestroThemeCatalog = [
  { id: 'white', name: 'White', line: 'Default · light grey and white, plain and bright.' },
  { id: 'sea-breeze', name: 'Sea breeze', line: 'Soft mint, sky blue and lilac. Light and calm.' },
  { id: 'aurora', name: 'Aurora', line: 'Deep teal, blue and violet on dark. The top bar stays dark in the apps.' }
];
window.RestroDefaultTheme = 'white';
