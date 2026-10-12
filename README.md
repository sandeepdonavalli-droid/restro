# RESTRO · Restaurant POS

Android-tablet-style restaurant POS launcher, built as a plain HTML/CSS/JS web app.
Split out of the original single-file `restro-battery-preview.html` (dated 7 Oct 2026);
behaviour and visuals are unchanged.

## Run it

Serve the folder with any static server and open `index.html`:

    python3 -m http.server 8000      # then visit http://localhost:8000

(Opening the file directly also works in most browsers.)

## Layout

    index.html              Markup: launcher, dialogs, quick controls, calculator
    css/01-base.css         Core layout, banner, dashboard, dialogs
    css/02-artwork.css      App tile artwork and lettering
    css/03-quick-drawer.css Pull-down quick controls drawer
    css/04-system-bars.css  Status bar and Android navigation bar
    css/05-theme-colors.css Shared colour layer for every theme
    css/06-settings.css     Settings screen
    css/07-controls.css     Quick-control tiles
    css/08-fullscreen.css   Full-display sizing
    css/09-battery.css      Battery icon states
    js/theme-catalog.js     Theme colour tokens (Graphite, Copper, ...)
    js/theme-engine.js      Applies/saves the chosen theme
    js/assets.js            Image path lookup used by the launcher
    js/device-bridge.js     Battery/device status bridge (sample data in browser)
    js/01-layout.js         App page/position rules (move, add/delete pages)
    js/02-launcher.js       App catalog, tiles, drag-to-arrange, dialogs, settings
    js/03-insights.js       Insights widget (sales, orders, most sold)
    js/04-quick-controls.js Quick controls drawer, brightness, calculator, camera
    js/05-battery-status.js Status-bar battery icon
    js/06-notifications.js  Notifications panel
    js/07-navigation.js     Back / Home / Recents navigation bar
    js/dev-battery-preview.js  Browser-only battery test harness (remove for production)
    assets/                 Images the app loads
    design-source/          Full-size artwork sheets the icons were cut from (not loaded)

## Status

Launcher shell, theming, insights widget, quick controls and system UI are done.
All sales/order figures are sample data. Core POS screens (Counter, Floor, Orders,
Pager Hub, End Day, Menu, etc.) are tiles only — not yet built.
