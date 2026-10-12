# RESTRO · Restaurant POS

Android-tablet-style restaurant POS launcher (HTML/CSS/JS), pulled from the live
site restro-pos.sandeepdonavalli.chatgpt.site on 12 Oct 2026.

Theme and QR Studio artwork sheets were re-encoded from PNG to WebP (same pixel
size, quality 95) to cut them from ~20 MB to ~2.4 MB; theme-artwork.js and app.js
point at the .webp files. Everything else is byte-for-byte the live source.

Run locally:  python3 -m http.server 8000   then open http://localhost:8000
Publish prep: python3 tools/build.py        (writes dist/index.html)
