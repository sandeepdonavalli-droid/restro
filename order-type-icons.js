'use strict';
// Order-type icons (Update Pack 5, Icon Pack 1): the one set for every app, kept only here, so no screen can pick its
// own. Dine-in (and "Dine-in + Takeaway") is the fork & knife; the table is only ever the table number, never Dine-in;
// Takeaway is the bag with the smile handle; Delivery (our own riders) the motorbike; Online the globe; Phone call the
// handset (unchanged). Swiggy and Zomato show their own app marks. The Counter draws them plain in the label's colour;
// Orders on a tile in the type's colour (orders.js). tools/check_order_icons.py fails if an order type's icon is drawn
// anywhere else, or if one of the old icons (round table, the Orders bag, the scooter, the old Online) comes back.
(() => {
  const NS = 'http://www.w3.org/2000/svg', M = '0 -960 960 960';
  // box: the viewBox; d: the path, filled (Material Symbols Rounded, Apache 2.0), or with stroke: a 2-wide outline
  const ICONS = {
    dineIn: { box: M, d: 'M280-600v-240q0-17 11.5-28.5T320-880q17 0 28.5 11.5T360-840v240h40v-240q0-17 11.5-28.5T440-880q17 0 28.5 11.5T480-840v240q0 56-34.5 98T360-446v326q0 17-11.5 28.5T320-80q-17 0-28.5-11.5T280-120v-326q-51-14-85.5-56T160-600v-240q0-17 11.5-28.5T200-880q17 0 28.5 11.5T240-840v240h40Zm400 200h-80q-17 0-28.5-11.5T560-440v-240q0-70 51.5-135T718-880q18 0 30 14t12 33v713q0 17-11.5 28.5T720-80q-17 0-28.5-11.5T680-120v-280Z' },
    table: { box: M, d: 'M672-520H289l-11 80h404l-10-80ZM166-205l43-315h-89q-20 0-31.5-16T82-571l57-200q4-13 14-21t24-8h606q14 0 24 8t14 21l57 200q5 19-6.5 35T840-520h-88l42 315q2 18-9.5 31.5T755-160q-15 0-26.5-9.5T715-194l-22-166H267l-22 166q-2 15-13.5 24.5T205-160q-18 0-29.5-13.5T166-205Z' },
    takeaway: { box: M, d: 'M200-80q-33 0-56.5-23.5T120-160v-480q0-33 23.5-56.5T200-720h80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720h80q33 0 56.5 23.5T840-640v480q0 33-23.5 56.5T760-80H200Zm160-640h240q0-50-35-85t-85-35q-50 0-85 35t-35 85Zm119 320q74 0 134-49t59-110q0-17-11-29t-28-12q-14 0-25 9t-16 27q-11 38-43 61t-70 23q-38 0-70.5-23T366-564q-5-19-15-27.5t-24-8.5q-17 0-28.5 12T287-559q0 61 59 110t133 49Z' },
    delivery: { box: M, d: 'M160-200q-66 0-113-47T0-360q0-57 36.5-101t93.5-55l-28-24H30q-13 0-21.5-8.5T0-570q0-13 8.5-21.5T30-600h150l100 60 146-55q7-2 14-3.5t15-1.5h111l-62-80h-64q-17 0-28.5-11.5T400-720q0-17 11.5-28.5T440-760h63q19 0 35.5 8.5T566-729l60 77 105-53q10-5 19.5 1t9.5 17v67q0 8-6 14t-14 6h-72l70 92q15-6 30.5-9t31.5-3q66 0 113 47t47 113q0 66-47 113t-113 47q-66 0-113-47t-47-113q0-27 9.5-52.5T676-460l-20-24-124 186q-5 8-14 13t-19 5h-84q-8 0-14.5-2.5T389-290l-69-60q-5 63-51 106.5T160-200Zm0-80q33 0 56.5-23.5T240-360q0-33-23.5-56.5T160-440q-33 0-56.5 23.5T80-360q0 33 23.5 56.5T160-280Zm640 0q33 0 56.5-23.5T880-360q0-33-23.5-56.5T800-440q-33 0-56.5 23.5T720-360q0 33 23.5 56.5T800-280Z' },
    phone: { box: M, d: 'M798-120q-125 0-247-54.5T329-329Q229-429 174.5-551T120-798q0-18 12-30t30-12h162q14 0 25 9.5t13 22.5l26 140q2 16-1 27t-11 19l-97 98q20 37 47.5 71.5T387-386q31 31 65 57.5t72 48.5l94-94q9-9 23.5-13.5T670-390l138 28q14 4 23 14.5t9 23.5v162q0 18-12 30t-30 12Z' },
    // (the globe: a circle, an ellipse and two lines of latitude, as the pack's ic_order_online.svg)
    online: { box: '0 0 24 24', d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0ZM8 12a4 9 0 1 0 8 0a4 9 0 1 0 -8 0ZM3.6 8.5h16.8M3.6 15.5h16.8', stroke: 2 }
  };
  // each order type's icon ("Dine-in + Takeaway": Dine-in's)
  const TYPE = { 'dine-in': 'dineIn', 'dine-in+takeaway': 'dineIn', takeaway: 'takeaway', delivery: 'delivery', phone: 'phone', online: 'online' };
  const nameOf = key => (ICONS[key] ? key : TYPE[key] || null);
  // The icon as an <svg> with the given class: filled in its colour, or (Online) outlined in it
  function svg(key, cls = '') {
    const ic = ICONS[nameOf(key)]; if (!ic) return null;
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', ic.box); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    s.innerHTML = ic.stroke ? `<path d="${ic.d}" fill="none" stroke="currentColor" stroke-width="${ic.stroke}"/>` : `<path d="${ic.d}"/>`;
    return s;
  }
  window.RestroOrderTypeIcons = Object.freeze({ svg, has: key => Boolean(nameOf(key)), keyOf: type => TYPE[type] || null });
})();
