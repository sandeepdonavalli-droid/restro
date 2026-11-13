'use strict';
// Orders (Update Pack 4, 01_Orders, the final spec): where staff find any order of the day and act on it without
// opening it — print the bill or receipt, reprint a KOT, notify the customer, buzz the pager, send a scheduled KOT
// early. Tapping an order opens it where it is worked on next: the Counter while it is Due or Part paid (Back
// comes back here, the filters kept); any other order its details page (to come; its receipt until then).
// Three views (Settings › Orders display, branch-wide): Classic (the default: a light sidebar with Home, the title,
// the day, the tabs, the Held link, the filters and the totals card, then the order table), Split detail (an icon
// rail, a 650 list and the order picked) and Cards (an icon rail, a two-row toolbar, four cards a row); each in
// Classic rows or Floating pills. Board is gone: a tablet that had it shows Classic.
// - Tabs All · Open · Closed (All = Open + Closed), and Held as a link with the day's count to the Held page (the
//   Counter's Held list until that page exists): held orders are never listed here.
// - Filters: Payment status (several) · Discounts & voids · Order types (several) · Staff. Clear filters is always
//   there, greyed until something differs from the start (the search, a filter, the tab, the sort or the day).
// - Search: customer name, phone, order number (ours and the delivery app's), table, pager and handover code; not the
//   servers, the dishes or the call code. Letters then a number = a table or pager ("table 12", "T12", "P5", "buzz 5");
//   letters alone = the name as typed; digits alone = phone, order numbers and handover code, all together.
// - Totals: Total = the money already taken that day; Due = what is still to take (Due, and what is left on Part
//   paid), "Due · N orders"; refunds count in neither. Tapping Due lists exactly the orders behind it.
// - Payment status names (Update Pack 5, Update 4.1): Due (orange) · Part paid (red, no method) · Paid - method ·
//   Refunded - method · Partial refund - method · Complimentary · Awaiting Swiggy · Unpaid - Swiggy (the app refused to
//   pay a cancelled order: never collected, so not in Due).
// - Days are business days (RestroSync.dayOf). One day or a range; an order taken one day for another is listed on
//   both, in Due only on its own day. Past days and ranges: only Bill / Receipt works.
// - Today scrolls back (Update Pack 5, H3): past today's last order come the days before, newest first, each under a
//   divider ("YESTERDAY · Sun 8 Nov"), the search, filters, tab and sort applying to each. The totals, the tab counts
//   and "N orders" stay today's ("TODAY · MON 9 NOV" over Classic's totals; "Today's orders" on Split's and Cards'
//   bars). A device keeps 4 business days (RestroSync.keepOrders); older days come from the cloud in batches as the
//   list's end comes into view (offline: "Older orders need internet"). Yesterday, a date or a range shows only that.
// - Long-press starts picking orders to delete: only Due orders that aren't a delivery app's.
// Delivery apps (Swiggy, Zomato…) show what their integration sends with the order: platform, platformNo, platformType
// ('delivery' or 'pickup'), pickupAt / readyBy, callCode, handover, riderAt, platformLogo; and when the app cancels it,
// cancelledBy ('Swiggy'), payout ('awaiting', 'paid' or 'unpaid') and payoutAmount. Orders from the restaurant's own
// website or app (to come) carry online: true and source ('Website' or 'App'), shown where the cashier would be.
// Orders placed by QR (Update Pack 5, K: a Table QR's are Dine-in on its table, a Takeaway QR's Takeaway with the
// customer's name and phone) carry qr: true, are paid first (paidAt, and method 'upi', 'card', 'netbanking' or
// 'wallet') and show a small blue QR tag by the order type; a Takeaway QR's has no cashier. A bill
// paid in part (the Pay screen, to come) carries paidAmount (paise) and paidAmountAt; refunds carry refundedAt,
// refundAmount (paise; less than the total: a partial refund) and refundMethod.
(() => {
  const dialog = document.querySelector('#orders-dialog');
  if (!dialog) return;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  // Icons: the pack's own (Update Pack 4, 05_html-reference) and Material Symbols Rounded (Apache 2.0) for the rest;
  // m: on the 960 grid, w: on the 24 grid, or a viewBox of its own. The order types' icons are the one set every app
  // shares (order-type-icons.js, Update Pack 5 Icon Pack 1): dineIn, takeaway, delivery, online, phone.
  const ICON = {
    search: ['m', 'M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z'],
    calendar: ['m', 'M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.02 0 23.51 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.03 0 23.51 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Z'],
    expand: ['m', 'M480-362q-8 0-15-2.5t-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5Z'],
    tag: ['m', 'M856-390 570-104q-12 12-27 18t-30 6q-15 0-30-6t-27-18L103-457q-11-11-17-25.5T80-513v-287q0-33 23.5-56.5T160-880h287q16 0 31 6.5t26 17.5l352 353q12 12 17.5 27t5.5 30q0 15-5.5 29.5T856-390ZM260-640q25 0 42.5-17.5T320-700q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Z'],
    sortDown: ['m', 'M450-274v-496q0-13 8.5-21.5T480-800q13 0 21.5 8.5T510-770v496l227-227q9-9 21-9t21 9q9 9 9 21t-9 21L501-181q-5 5-10 7t-11 2q-6 0-11-2t-10-7L181-459q-9-9-9-21t9-21q9-9 21-9t21 9l227 227Z'],
    sortBoth: ['m', 'm480-208 114-114q9.13-9 22.07-9 12.93 0 21.93 9.1 9 9.11 9 22 0 12.9-9 21.9L501-141q-5 5-10.13 7-5.14 2-11 2-5.87 0-10.87-2-5-2-10-7L322-278q-9-9.13-9-22.07 0-12.93 9.1-21.93 9.11-9 22-9 12.9 0 21.9 9l114 114Zm0-540L366-634q-9.13 9-22.07 9-12.93 0-21.93-9.1-9-9.11-9-22 0-12.9 9-21.9l137-137q5-5 10.13-7 5.14-2 11-2 5.87 0 10.87 2 5 2 10 7l137 137q9 9.13 9 22.07 0 12.93-9.1 21.93-9.11 9-22 9-12.9 0-21.9-9L480-748Z'],
    print: ['w', 'M19 8c1.66 0 3 1.34 3 3v6h-4v4H6v-4H2v-6c0-1.66 1.34-3 3-3h1V3h12v5zM8 5v3h8V5zm8 14v-4H8v4zm2-4h2v-4c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v4h2v-2h12zm1-3.5c0 .55-.45 1-1 1s-1-.45-1-1 .45-1 1-1 1 .45 1 1'],
    printOff: ['m', 'M763-84 640-206h80v6q0 33-23.5 56.5T640-120H320q-33 0-56.5-23.5T240-200v-80h-80q-33 0-56.5-23.5T80-360v-160q0-51 35-85.5t85-34.5h6L83-763q-12-12-12-28.5T83-820q12-12 28.5-12t28.5 12l680 680q12 12 12 28t-12 28q-12 12-28.5 12T763-84ZM320-200h320v-6L486-360H320v160Zm522-91q-16 9-34 8t-32-15L502-572q-19-19-8.5-43.5T531-640h229q50 0 85 35t35 85v160q0 25-11 42.5T842-291ZM427-680q-16 0-30.5-6T371-703l-69-69q-19-19-8.5-43.5T331-840h309q33 0 56.5 23.5T720-760v40q0 17-11.5 28.5T680-680H427Zm293 220q17 0 28.5-11.5T760-500q0-17-11.5-28.5T720-540q-17 0-28.5 11.5T680-500q0 17 11.5 28.5T720-460Z'],
    kot: ['w', 'M19.5 3.5 18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2zM19 19H5V5h14zM6 15h12v2H6m0-6h12v2H6m0-6h12v2H6z'],
    notify: ['w', 'm4 6.03 7.5 3.22-7.5-1zm7.5 8.72L4 17.97v-2.22zM2 3v7l15 2-15 2v7l21-9z'],
    ready: ['w', 'M.41 13.41 6 19l1.41-1.42L1.83 12m20.41-6.42L11.66 16.17 7.5 12l-1.43 1.41L11.66 19l12-12M18 7l-1.41-1.42-6.35 6.35 1.42 1.41z'],
    marked: ['w', 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2m0 18c-4.41 0-8-3.590-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z'],
    void: ['w', 'M12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m2.59 6L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41z'],
    edit: ['m', 'M160-120q-17 0-28.5-11.5T120-160v-97q0-16 6-30.5t17-25.5l505-504q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L313-143q-11 11-25.5 17t-30.5 6h-97Zm544-528 56-56-56-56-56 56 56 56Z'],
    receipt: ['m', 'M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480Z'],
    all: ['m', 'M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480Z'],
    clock: ['m', 'M520-496v-144q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640v159q0 8 3 15.5t9 13.5l132 132q11 11 28 11t28-11q11-11 11-28t-11-28L520-496ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z'],
    doneCircle: ['m', 'm424-408-86-86q-11-11-28-11t-28 11q-11 11-11 28t11 28l114 114q12 12 28 12t28-12l226-226q11-11 11-28t-11-28q-11-11-28-11t-28 11L424-408Zm56 328q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z'],
    pauseCircle: ['m', 'M400-320q17 0 28.5-11.5T440-360v-240q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v240q0 17 11.5 28.5T400-320Zm160 0q17 0 28.5-11.5T600-360v-240q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v240q0 17 11.5 28.5T560-320ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z'],
    chevron: ['m', 'M504-480 348-636q-11-11-11-28t11-28q11-11 28-11t28 11l184 184q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L404-268q-11 11-28 11t-28-11q-11-11-11-28t11-28l156-156Z'],
    payments: ['m', 'M120-160q-33 0-56.5-23.5T40-240v-400q0-17 11.5-28.5T80-680q17 0 28.5 11.5T120-640v400h640q17 0 28.5 11.5T800-200q0 17-11.5 28.5T760-160H120Zm160-160q-33 0-56.5-23.5T200-400v-320q0-33 23.5-56.5T280-800h560q33 0 56.5 23.5T920-720v320q0 33-23.5 56.5T840-320H280Zm80-80q0-33-23.5-56.5T280-480v80h80Zm400 0h80v-80q-33 0-56.5 23.5T760-400Zm-200-40q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35ZM280-640q33 0 56.5-23.5T360-720h-80v80Zm560 0v-80h-80q0 33 23.5 56.5T840-640Z'],
    filterOff: ['m', 'M580-465 245-800h527q21 0 31 19t-4 36L580-465Zm-20 151v114q0 17-11.5 28.5T520-160h-80q-17 0-28.5-11.5T400-200v-274L82-792q-9-9-9-21.5t9-21.5q9-9 21.5-9t21.5 9l710 710q9 9 9 21t-9 21q-9 9-21.5 9T792-83L560-314Z'],
    person: ['m', 'M480-481q-66 0-108-42t-42-108q0-66 42-108t108-42q66 0 108 42t42 108q0 66-42 108t-108 42ZM160-220v-34q0-38 19-65t49-41q67-30 128.5-45T480-420q62 0 123 15.5T731-360q31 14 50 41t19 65v34q0 25-17.5 42.5T740-160H220q-25 0-42.5-17.5T160-220Z'],
    alert: ['m', 'M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm0-160q17 0 28.5-11.5T520-480v-160q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640v160q0 17 11.5 28.5T480-440Zm0 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z'],
    // (the messages' printer: Material Icons filled print, Apache 2.0)
    printFill: ['w', 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z'],
    cloudOff: ['m', 'M260-160q-92 0-156-64T40-380q0-77 47.5-137T210-594q3-8 6-15.5t6-16.5L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-27.5 11.5T764-83l-78-77H260Zm604-50L322-751q35-24 74.5-36.5T480-800q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 39-15 72.5T864-210Z'],
    add: ['m', 'M440-440H240q-17 0-28.5-11.5T200-480q0-17 11.5-28.5T240-520h200v-200q0-17 11.5-28.5T480-760q17 0 28.5 11.5T520-720v200h200q17 0 28.5 11.5T760-480q0 17-11.5 28.5T720-440H520v200q0 17-11.5 28.5T480-200q-17 0-28.5-11.5T440-240v-200Z'],
    check: ['m', 'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z'],
    close: ['m', 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z'],
    back: ['m', 'm432-480 156 156q11 11 11 28t-11 28q-11 11-28 11t-28-11L348-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l184-184q11-11 28-11t28 11q11 11 11 28t-11 28L432-480Z'],
    trash: ['m', 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm120-160q17 0 28.5-11.5T440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280Zm160 0q17 0 28.5-11.5T600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280Z'],
    chat: ['m', 'm240-240-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Zm40-160h240q17 0 28.5-11.5T560-440q0-17-11.5-28.5T520-480H280q-17 0-28.5 11.5T240-440q0 17 11.5 28.5T280-400Zm0-120h400q17 0 28.5-11.5T720-560q0-17-11.5-28.5T680-600H280q-17 0-28.5 11.5T240-560q0 17 11.5 28.5T280-520Zm0-120h400q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720H280q-17 0-28.5 11.5T240-680q0 17 11.5 28.5T280-640Z'],
    // (the QR tag's glyph, Update Pack 5: three rounded squares, a dot and a corner, on its own 30 grid)
    qr: ['0 0 30 30', 'M3 0h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Zm2 4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H5ZM19 0h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Zm2 4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-4ZM3 16h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Zm2 4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5ZM19 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1ZM27 18h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H19a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h7v-7a1 1 0 0 1 1-1Z'],
    sms: ['m', 'M320-520q17 0 28.5-11.5T360-560q0-17-11.5-28.5T320-600q-17 0-28.5 11.5T280-560q0 17 11.5 28.5T320-520Zm160 0q17 0 28.5-11.5T520-560q0-17-11.5-28.5T480-600q-17 0-28.5 11.5T440-560q0 17 11.5 28.5T480-520Zm160 0q17 0 28.5-11.5T680-560q0-17-11.5-28.5T640-600q-17 0-28.5 11.5T600-560q0 17 11.5 28.5T640-520ZM240-240l-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Z']
  };
  // Home: the Set C outline house (as on the navigation bar), stroke 2
  const HOUSE = 'M4.5 11.2 L12 4.6 L19.5 11.2 V18.4 a1.6 1.6 0 0 1 -1.6 1.6 H14.6 V15.4 a2.6 2.6 0 0 0 -5.2 0 V20 H6.1 a1.6 1.6 0 0 1 -1.6 -1.6 Z';
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls = '') {
    if (!ICON[name] && window.RestroOrderTypeIcons?.has(name)) return window.RestroOrderTypeIcons.svg(name, `or-i ${cls}`.trim());
    const [grid, d] = ICON[name], s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', grid === 'm' ? '0 -960 960 960' : grid === 'w' ? '0 0 24 24' : grid); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `or-i ${cls}`.trim()); s.innerHTML = `<path d="${d}"/>`; return s;
  }
  function house() {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'or-house');
    s.innerHTML = `<path d="${HOUSE}"/>`; return s;
  }
  const appIcon = () => {
    const art = typeof artNode === 'function' && typeof shortcuts !== 'undefined' ? artNode({ ...shortcuts.find(item => item.id === 'orders').art, plain: true }) : document.createElement('span');
    art.classList.add('or-title-icon'); return art;
  };

  // ---------- words and numbers ----------
  // Our order types (the type tile: our own icon in its colour, Icon Pack 1: Online sky blue in Light, rose in Midnight)
  // in the order the Order type filter lists them, then the delivery apps (their logo, from the integration)
  const TYPES = { 'dine-in': ['Dine-in', 'dineIn', '#9A6B1F'], takeaway: ['Takeaway', 'takeaway', '#2E7D4F'], online: ['Online', 'online', '#0284C7'],
    phone: ['Phone call', 'phone', '#2F5FB3'], delivery: ['Delivery', 'delivery', '#6D4BC4'] };
  const TYPE_ORDER = Object.keys(TYPES);
  const PLATFORMS = { swiggy: ['Swiggy', '#E8711F'], zomato: ['Zomato', '#C8303B'] };
  const PAID_BY = { cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', swiggy: 'Swiggy', zomato: 'Zomato' };
  // Payment status (the filter, in this order) and the order of "Due first"
  const PAYS = [['paid', 'Paid'], ['np', 'Due'], ['part', 'Part paid'], ['rf', 'Refunded'], ['prf', 'Partial refund'], ['comp', 'Complimentary'], ['await', 'Awaiting payout'], ['npp', 'Unpaid by platform']];
  const PAY_RANK = { np: 0, part: 1, await: 2, npp: 3, paid: 4, comp: 5, prf: 6, rf: 7 };
  const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rupees = paise => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  const ticket = n => `#${String(n).padStart(2, '0')}`;
  // "7:24 pm" (am and pm always lower-case)
  const timeOf = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, (m, x) => ` ${x.toLowerCase()}m`);
  const dateOf = t => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const shortDay = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const weekday = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });
  const minutes = ms => Math.max(0, Math.floor(ms / 60000));
  // A person's initials: of the first and last name (one name: its first letter); a name typed as initials (two or
  // three capitals) as it is
  const initialsOf = name => {
    const words = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
    if (words.length === 1 && /^[A-Z]{2,3}$/.test(words[0])) return words[0];
    return (words.length > 1 ? [words[0], words.at(-1)] : words).map(w => Array.from(w)[0]).join('').toLocaleUpperCase('en-IN');
  };
  const tableName = id => (id && (window.RestroFloor?.tableName(id) || id)) || '';
  // "+91 90000 00000"; other lengths as typed; a delivery app's number as the app sends it ("+91 80 0000 0000")
  const phoneOf = (c, asSent = false) => {
    const raw = typeof c?.mobile === 'string' ? c.mobile.trim().replace(/\s+/g, ' ') : '', m = raw.replace(/\s+/g, ''); if (!m) return '';
    return `+${c.code || '91'} ${asSent ? raw : /^\d{10}$/.test(m) ? `${m.slice(0, 5)} ${m.slice(5)}` : m}`;
  };
  const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Business days (Update Pack 4, A1: the day runs to its cut-off, not midnight)
  const dayOf = t => window.RestroSync?.dayOf?.(t) || localDay(t - 4 * 3600000);
  const todayKey = () => window.RestroSync?.today?.() || dayOf(Date.now());
  const dayOfOrder = o => window.RestroSync?.orderDay?.(o) || o.day || dayOf(o.createdAt || Date.now());
  const addDays = (key, n) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
  const keyDate = key => new Date(`${key}T12:00:00`);
  const shopName = () => { const n = (localStorage.getItem('restro.restaurantName') || '').trim(); return n && n !== 'RESTAURANT NAME' ? n : ''; };
  const prepMinutes = type => window.RestroCounter?.prepMinutes?.(type) || 30;
  const toast = message => say({ text: message });

  // ---------- an order as a row shows it ----------
  // The order status: Open until it is paid and complete in the kitchen (the kitchen screen marks the order
  // kitchenDoneAt), in either order, and its pager is docked back when it had one; then Closed. Under Open: Scheduled
  // 8:30 pm (plum) while a scheduled order's KOT waits ("Tomorrow 1:00 pm", "Wed 11 Nov 1:00 pm" for another day);
  // In kitchen · N min once its KOT printed, orange with Open past its order type's prep time (a scheduled order only
  // after its ready-by time); Ready · N min (green) once the kitchen completed it. Cancelled (red, "by Swiggy") when a
  // delivery app cancels it. Without the kitchen screen (a later subscription choice) an order is Open until paid.
  const KITCHEN_SCREEN = true;
  // (the day the page shows: "Scheduled 1:00 pm" on that order's own day, "Tomorrow 1:00 pm" the day before; OS5, OS6)
  let refDay = null;
  function schedLine(t, now) {
    const d = dayOf(t), ref = refDay || dayOf(now);
    return d === ref ? `Scheduled ${timeOf(t)}` : d === addDays(ref, 1) ? `Tomorrow ${timeOf(t)}` : `${shortDay(t)} ${timeOf(t)}`;
  }
  function statusOf(o, now = Date.now()) {
    if (o.cancelledBy) return { text: 'Cancelled', cls: 'cancelled', sub: `by ${o.cancelledBy}`, subCls: 'can', closed: true, rank: 2 };
    const waiting = !o.sentAt && Boolean(o.readyAt), screen = KITCHEN_SCREEN && Boolean(o.sentAt), ready = screen && Boolean(o.kitchenDoneAt);
    if (o.paidAt && !waiting && (!screen || ready) && !o.pagerOut) return { text: 'Closed', cls: 'closed', closed: true, rank: 2 };
    if (waiting) return { text: 'Open', cls: 'open', sub: schedLine(o.readyAt, now), base: 'Scheduled', subCls: 'sch', sched: true, rank: 1 };
    if (ready) return { text: 'Open', cls: 'open', sub: `Ready · ${minutes(now - o.kitchenDoneAt)} min`, base: 'Ready', subCls: 'rd', rank: 0 };
    if (screen) {
      const n = minutes(now - (Number(o.kitchenAt) || Number(o.sentAt))), late = o.readyAt ? now > o.readyAt : n > prepMinutes(o.type);
      return { text: 'Open', cls: `open${late ? ' late' : ''}`, sub: `In kitchen · ${n} min`, base: 'In kitchen', subCls: late ? 'late' : '', late, rank: 0 };
    }
    return { text: 'Open', cls: 'open', rank: 0 };
  }
  // The payment status ("Paid - UPI": a hyphen for the payment status only), what of it counts in Total (kept, on the
  // day it was taken) and what is still due
  function payOf(o) {
    const amount = Number(o.total) || 0, app = typeof o.cancelledBy === 'string' ? o.cancelledBy : '';
    const how = Array.isArray(o.methods) && o.methods.length ? o.methods.map(m => PAID_BY[m] || m).join(' + ') : PAID_BY[o.method] || 'Cash';
    if (app) {
      if (o.payout === 'paid') return { key: 'paid', text: `Paid - ${app}`, short: 'Paid', kept: Number.isFinite(o.payoutAmount) ? o.payoutAmount : amount, at: Date.parse(o.payoutAt) || Date.parse(o.paidAt) || 0 };
      if (o.payout === 'unpaid') return { key: 'npp', text: `Unpaid - ${app}`, cls: 'red', short: 'Unpaid', kept: 0 };
      return { key: 'await', text: `Awaiting ${app}`, cls: 'grey', short: 'Awaiting', kept: 0 };
    }
    if (o.paidAt) {
      const at = Date.parse(o.paidAt) || 0;
      if (o.refundedAt) {
        const back = Number(o.refundAmount);
        if (back > 0 && back < amount) return { key: 'prf', text: `Partial refund - ${PAID_BY[o.refundMethod] || how}`, cls: 'red', short: 'Partial refund', kept: amount - back, at, refunded: back };
        return { key: 'rf', text: `Refunded - ${how}`, cls: 'red', short: 'Refunded', kept: 0, at };
      }
      if (amount === 0) return { key: 'comp', text: 'Complimentary', short: 'Complimentary', kept: 0, at };
      return { key: 'paid', text: `Paid - ${how}`, short: 'Paid', kept: amount, at };
    }
    const part = Number(o.paidAmount);
    if (part > 0 && part < amount) return { key: 'part', text: 'Part paid', cls: 'red', short: 'Part paid', kept: part, due: amount - part, at: Number(o.paidAmountAt) || o.createdAt };
    return { key: 'np', text: 'Due', cls: 'np', short: 'Due', kept: 0, due: amount };
  }
  const kotsOf = o => (Array.isArray(o.kots) ? o.kots : []).filter(k => k && (k.kind || 'kot') === 'kot');
  // A scheduled order's KOT waits until its ready-by time less its order type's prep time (kept on the order, kotAt,
  // once it is worked out: a change of prep time in Settings only ever brings it earlier)
  // (the Counter's own reckoning: ready-by less the prep time it was scheduled with, or Settings › Kitchen's if longer)
  const kotTimeOf = o => Number(o.kotAt) || window.RestroCounter?.kitchenTime?.(o) || (Number(o.readyAt) - prepMinutes(o.type) * 60000);

  // The short line under Notify and under Buzz: green when the last message or buzz went, red when the last one didn't
  // (owner, 12 Nov 2026: by hand or by itself), none before the first ('sent' · 'failed' · '')
  // (a failure is kept only until a try goes: the Counter's markNotified / markBuzzed clear it)
  const lastTry = (went, failed) => (failed ? 'failed' : went ? 'sent' : '');
  // ctx: { past } (a past day or a range: only Bill / Receipt works)
  function infoOf(o, now, ctx = {}) {
    const id = o.uid || `n${o.number}`, when = o.createdAt, past = Boolean(ctx.past);
    const platform = PLATFORMS[o.platform] ? o.platform : null;
    // the type: its tile (our icon in its colour, or the delivery app's logo), its name and the app's time
    let type;
    if (platform) {
      const [name, colour] = PLATFORMS[platform], pickup = o.platformType === 'pickup', at = pickup ? o.readyBy : o.pickupAt;
      type = { key: platform, label: `${name} · ${pickup ? 'Pickup' : 'Delivery'}`, platform, name, colour, logo: typeof o.platformLogo === 'string' ? o.platformLogo : '', time: at ? `${pickup ? 'Ready by' : 'Pickup'} ${timeOf(at)}` : '' };
    } else {
      // (Update Pack 5, K) Mixed order types: the first type chosen in the Counter is the order's own (its tile, and the
      // only one the Order type filter counts it under); the others the Counter's Modify added show as "+ Takeaway"
      const key = o.online === true ? 'online' : TYPES[o.type] ? o.type : 'dine-in';
      const added = key === 'online' || !o.split ? [] : [...new Set((o.lines || []).map(l => l.type || o.type))].filter(k => k !== key && TYPES[k]);
      const [label, ic, colour] = TYPES[key];
      type = { key, label: [label, ...added.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b)).map(k => TYPES[k][0])].join(' + '), icon: ic, colour };
    }
    const qr = o.qr === true && !platform;
    const numbers = platform ? `${type.name} #${o.platformNo || '—'} · Order ${ticket(o.number)}` : `Order ${ticket(o.number)}`;
    // who: the table (dine-in) with the guests and the server, or the customer with their phone and who took it
    const phone = phoneOf(o.customer, Boolean(platform)), name = o.customer?.name || '', server = o.server || '';
    const dine = !platform && o.table && (o.type === 'dine-in' || o.split);
    const who = dine
      ? { l1: `Table ${tableName(o.table)}${o.guests ? ` · ${o.guests} guest${o.guests === 1 ? '' : 's'}` : ''}`, l2: server ? `Server: ${server}` : '' }
      : { l1: name || (platform ? 'Customer' : 'Guest'), l2: platform ? phone : [phone, type.key === 'online' ? (o.source === 'App' ? 'App' : 'Website') : phone ? initialsOf(server) : server ? `Server: ${server}` : ''].filter(Boolean).join(' · ') };
    if (platform && (o.callCode || o.handover || (o.platformType !== 'pickup' && o.riderAt))) who.codes = { call: o.callCode || '', handover: o.handover || '', rider: o.platformType !== 'pickup' && o.riderAt ? timeOf(o.riderAt) : '' };
    const status = statusOf(o, now), pay = payOf(o);
    const tags = { disc: Boolean(o.discountPct) || (o.lines || []).some(l => Number(l.off) > 0), void: (Array.isArray(o.kots) ? o.kots : []).some(k => k && (k.kind === 'void' || k.kind === 'changed')) };
    // the four buttons
    const kots = kotsOf(o), queued = !platform && !o.sentAt && Boolean(o.readyAt), kotAt = queued ? kotTimeOf(o) : 0;
    const kot = past ? { look: 'off', label: 'KOT' } : kots.some(k => k.failed) ? { look: 'err', label: 'KOT !' }
      : queued ? { look: 'q', at: kotAt, label: dayOf(kotAt) === (refDay || dayOf(now)) ? timeOf(kotAt) : weekday(kotAt) } : { look: kots.length ? 'on' : 'off', label: 'KOT' };
    const third = platform ? { kind: o.platformReadyAt || status.closed ? 'marked' : 'ready', on: !past }
      : { kind: 'notify', on: !past && Boolean(phone), line: lastTry(o.notifiedAt, o.notifyFailedAt) };
    const buzz = { no: o.pager ? String(o.pager) : '', on: !past && !status.closed && Boolean(o.pager) && Boolean(o.pagerOut), line: lastTry(o.buzzedAt, o.buzzFailedAt) };
    // can it be deleted (long-press): only Due orders, and never a delivery app's (it is cancelled on the app)
    const lock = platform ? `${type.name} · cancel on ${type.name}` : pay.key === 'np' ? '' : pay.key === 'part' ? 'Part paid' : 'Paid';
    const forDay = o.readyAt ? dayOf(o.readyAt) : null, taken = dayOfOrder(o);
    return { o, id, when, type, qr, numbers, who, status, pay, tags, kot, third, buzz, lock, phone, name, server, dine,
      taken, forDay: forDay && forDay !== taken ? forDay : null, paidDay: pay.at ? dayOf(pay.at) : null,
      find: { name: name.toLowerCase(), l1: who.l1.toLowerCase(), phone: (o.customer?.mobile || '').replace(/\D/g, ''), number: o.number, platformNo: String(o.platformNo || ''),
        table: dine ? String(tableName(o.table)).toLowerCase() : '', pager: Number(o.pager) || 0, handover: String(o.handover || '') } };
  }

  // ---------- state ----------
  let fromCounter = false;
  let tab = 'all';                       // all · open · closed
  let query = '';
  let payF = new Set();                  // Payment status: none ticked = all payments
  let dv = null;                         // Discounts & voids: disc · void · both, or none
  let typesF = new Set();                // Order types: none ticked = all order types
  let staffF = null;                     // a person's name, or all staff
  let dueOnly = false;                   // Due was tapped: only the orders behind the Due number
  const SORT0 = { key: 'when', dir: -1 };
  let sort = SORT0;                      // newest first; Order status: { key: 'status', mode: open · sched · closed }
  let range = null;                      // null: today; { from, to } business days
  let menu = null;                       // the menu open: date · pay · dv · type · staff · sort
  let picking = null;                    // picking orders to delete: a Set of ids
  let pop = null;                        // a pop-up: { kind, id, … }
  let flash = new Map();                 // id → 'buzzing' | 'buzzed' (the Buzz button while the dock answers)
  let returning = false;                 // an order was opened from here: coming back keeps the filters
  let scrollTop = 0, scrolledAt = 0;
  const period = () => range || { from: todayKey(), to: todayKey() };
  const isToday = () => !range || (range.from === todayKey() && range.to === todayKey());
  const pastNow = () => { const p = period(); return p.from !== p.to || p.to < todayKey(); };
  const changed = () => Boolean(query.trim()) || payF.size > 0 || Boolean(dv) || typesF.size > 0 || Boolean(staffF) || dueOnly || tab !== 'all' || sort !== SORT0 || !isToday();
  function resetFilters() { tab = 'all'; query = ''; payF = new Set(); dv = null; typesF = new Set(); staffF = null; dueOnly = false; sort = SORT0; range = null; menu = null; picking = null; pop = null; scrollTop = 0; }
  // The view and the row style (Settings › Orders display, branch-wide; lookOverride: a preview's)
  let lookOverride = null, sampleRows = null;
  const look = () => { if (lookOverride) return lookOverride; try { return window.RestroPrefs?.get?.('orders') || {}; } catch { return {}; } };
  const rowStyle = () => (look().rows === 'pills' ? 'pills' : 'classic');
  const viewKind = () => { const v = look().view; return v === 'split' || v === 'cards' ? v : 'classic'; };
  let chosen = null;                     // Split detail: the order shown on the right

  // The orders of the day (or range): taken that day, or taken another day for that day
  function rowsNow() {
    if (sampleRows) return sampleRows;
    const now = Date.now(), { from, to } = period(), past = pastNow(), out = [];
    refDay = from === to ? from : null;
    // (a saved order put on hold is on the Held page, not here: Update Pack 4, K14)
    const onHold = new Set((window.RestroCounter?.held?.() || []).map(h => h.uid).filter(Boolean));
    try {
      const mine = window.RestroCounter?.orders?.() || [];
      for (const o of mine) {
        if (onHold.has(o.uid)) continue;
        const taken = dayOfOrder(o), forDay = o.readyAt ? dayOf(o.readyAt) : null;
        if ((taken >= from && taken <= to) || (forDay && forDay >= from && forDay <= to)) out.push(infoOf(o, now, { past }));
      }
      // (a day or range reaching past the days this device keeps: what came from the cloud for them)
      if (range && from < firstKept()) for (const o of olderOn(from, to, new Set(mine.map(o => o.uid || `n${o.number}`)))) out.push(infoOf(o, now, { past: true }));
    } finally { refDay = null; }
    return out;
  }
  const heldCount = () => (isToday() ? (window.RestroCounter?.held?.() || []).length : 0);

  // ---------- search ----------
  // Letters then a number (the space optional) = a table or a pager; letters alone = a name as typed; digits alone =
  // phone, order numbers (ours and the delivery app's) and handover code, all together. No fuzzy matching otherwise.
  const TABLE_WORDS = new Set(['table', 't', 'tavle', 'tabel', 'tabl', 'tble', 'tabe']);
  const PAGER_WORDS = new Set(['pager', 'buzzer', 'buzz', 'buz', 'p', 'b', 'pagr', 'peger', 'pagar', 'buzzr', 'buzer']);
  function parsed() {
    const s = query.trim().toLowerCase(); if (!s) return null;
    const m = s.match(/^([a-z]+)\s*(\d+)$/);
    if (m && TABLE_WORDS.has(m[1])) return { kind: 'table', n: String(Number(m[2])) };
    if (m && PAGER_WORDS.has(m[1])) return { kind: 'pager', n: Number(m[2]) };
    if (/^[\d\s+#-]+$/.test(s) && /\d/.test(s)) return { kind: 'digits', d: s.replace(/\D/g, '') };
    return { kind: 'text', s };
  }
  function hit(r, q = parsed()) {
    if (!q) return true;
    const f = r.find;
    if (q.kind === 'table') return f.table === q.n;
    if (q.kind === 'pager') return f.pager === q.n;
    if (q.kind === 'digits') {
      const d = q.d.replace(/^0+(?=\d)/, '');
      return (q.d.length >= 3 && f.phone.includes(q.d)) || String(f.number) === d || f.platformNo === q.d || f.handover === q.d;
    }
    return f.name.includes(q.s) || f.l1.includes(q.s);
  }
  // The matched part highlighted (what: 'name' the customer column's first line · 'phone' · 'number' our order number ·
  // 'platform' the app's number · 'handover' its chip)
  function hl(text, what) {
    const s = String(text ?? ''), q = parsed(); if (!q || !s) return s;
    let at = -1, len = 0;
    if (q.kind === 'text' && what === 'name') { at = s.toLowerCase().indexOf(q.s); len = q.s.length; }
    else if (q.kind === 'table' && what === 'name') { const m = s.match(new RegExp(`^Table ${q.n}(?!\\d)`)); if (m) { at = 0; len = m[0].length; } }
    else if (q.kind === 'digits' && what === 'phone' && q.d.length >= 3) return markDigits(s, q.d);
    else if (q.kind === 'digits' && what === 'number') { const m = s.match(/#(\d+)$/); if (m && String(Number(m[1])) === q.d.replace(/^0+(?=\d)/, '')) { at = s.length - m[1].length - 1; len = m[1].length + 1; } }
    else if (q.kind === 'digits' && (what === 'platform' || what === 'handover') && s === q.d) { at = 0; len = s.length; }
    if (at < 0) return s;
    return [s.slice(0, at), el('mark', {}, s.slice(at, at + len)), s.slice(at + len)].filter(x => x !== '');
  }
  function markDigits(s, d) {
    const map = []; for (let i = 0; i < s.length; i++) if (/\d/.test(s[i])) map.push(i);
    const digits = map.map(i => s[i]).join(''), k = digits.indexOf(d); if (k < 0) return s;
    const a = map[k], b = map[k + d.length - 1] + 1;
    return [s.slice(0, a), el('mark', {}, s.slice(a, b)), s.slice(b)].filter(x => x !== '');
  }
  // (K3) a pager search names what matched: "Matched pager 5 · P5, B5, buzz 5 and pager 5 all find it"
  function matchHint() {
    const q = parsed(); if (q?.kind !== 'pager') return null;
    return el('p', { class: 'or-mhint' }, 'Matched ', el('b', {}, `pager ${q.n}`), ` · P${q.n}, B${q.n}, buzz ${q.n} and pager ${q.n} all find it`);
  }
  const numbersOf = r => (r.type.platform ? [`${r.type.name} #`, hl(r.o.platformNo || '—', 'platform'), ' · ', hl(`Order ${ticket(r.o.number)}`, 'number')] : [hl(r.numbers, 'number')]);

  // ---------- filters, tabs, sorting, totals ----------
  function matches(r, skip = '') {
    if (!hit(r)) return false;
    if (skip !== 'pay' && payF.size && !payF.has(r.pay.key)) return false;
    if (skip !== 'pay' && dueOnly && !dueOf(r)) return false;
    if (skip !== 'dv' && dv && !(dv === 'disc' ? r.tags.disc : dv === 'void' ? r.tags.void : r.tags.disc && r.tags.void)) return false;
    if (skip !== 'type' && typesF.size && !typesF.has(r.type.key) && !(r.qr && typesF.has('qr'))) return false;
    if (skip !== 'staff' && staffF && r.server !== staffF) return false;
    return true;
  }
  // behind the Due number: Due or Part paid, for this day (an order for another day counts on its own day)
  function dueOf(r) { const { from, to } = period(); return (r.pay.key === 'np' || r.pay.key === 'part') && (!r.forDay || (r.forDay >= from && r.forDay <= to)); }
  const inTab = (r, t) => t === 'all' ? true : t === 'open' ? !r.status.closed : r.status.closed;
  const STATUS_MODES = ['open', 'sched', 'closed'];
  const STATUS_SORT = {
    open: (a, b) => (a.status.closed - b.status.closed) || (a.status.rank - b.status.rank) || Number(Boolean(b.status.late)) - Number(Boolean(a.status.late)) || b.when - a.when,
    sched: (a, b) => Number(Boolean(b.status.sched)) - Number(Boolean(a.status.sched)) || (a.status.sched ? a.o.readyAt - b.o.readyAt : 0) || (a.status.closed - b.status.closed) || b.when - a.when,
    closed: (a, b) => (b.status.closed - a.status.closed) || b.when - a.when
  };
  function sorter() {
    if (sort.key === 'status') return STATUS_SORT[sort.mode] || STATUS_SORT.open;
    if (sort.key === 'type') return (a, b) => sort.dir * a.type.label.localeCompare(b.type.label) || b.when - a.when;
    if (sort.key === 'pay') return (a, b) => sort.dir * (PAY_RANK[a.pay.key] - PAY_RANK[b.pay.key]) || b.when - a.when;
    return (a, b) => sort.dir * (a.when - b.when);
  }
  function totalsOf(rows) {
    const { from, to } = period(); let total = 0, due = 0, dueN = 0;
    for (const r of rows) {
      if (r.paidDay && r.paidDay >= from && r.paidDay <= to) total += r.pay.kept;
      if (dueOf(r)) { due += r.pay.due || 0; dueN++; }
    }
    return { orders: rows.length, total, due, dueN };
  }
  function view() {
    const all = rowsNow(), base = all.filter(r => matches(r));
    const counts = { all: base.length, open: base.filter(r => inTab(r, 'open')).length, closed: base.filter(r => inTab(r, 'closed')).length };
    const shown = base.filter(r => inTab(r, tab)).sort(sorter());
    const v = { all, base, counts, shown, totals: totalsOf(shown) };
    v.back = backDays(v); v.list = [...shown, ...v.back.flatMap(g => g.rows)];
    return v;
  }

  // ---------- Today scrolls back (Update Pack 5, H3) ----------
  // A device keeps 4 business days of orders (today and the 3 before: RestroSync.keepOrders); older days come from the
  // cloud when they're wanted, kept here in memory only: Today's list scrolling back past the kept days (4 days at a time,
  // as its end comes into view), or a day or range picked that reaches back that far.
  const KEPT = () => window.RestroSync?.daysKept || 4;
  const firstKept = () => window.RestroSync?.firstKept?.() || addDays(todayKey(), -(KEPT() - 1));
  const older = { days: new Set(), orders: new Map(), busy: false, more: true };   // the days read · uid → order
  const askCloud = () => typeof window.RestroSync?.olderOrders === 'function' && window.RestroSync.cloudReachable?.() === true;
  async function readOlder(from, to) {
    if (older.busy || !askCloud()) return;
    older.busy = true;
    try {
      const r = await window.RestroSync.olderOrders({ from, to });
      for (const o of r.orders) older.orders.set(o.uid || `n${o.number}`, o);
      for (let d = from; d <= to; d = addDays(d, 1)) older.days.add(d);
      if (!range) older.more = r.more;
    } catch {} // (the cloud counts as unreachable until a sync gets through: the end says so)
    finally { older.busy = false; if (dialog.open) renderRest(); }
  }
  // the orders of a past day that came from the cloud (the device's own copy wins)
  const olderOn = (from, to, mine) => [...older.orders.values()].filter(o => !mine.has(o.uid || `n${o.number}`) && (() => {
    const taken = dayOfOrder(o), forDay = o.readyAt ? dayOf(o.readyAt) : null;
    return (taken >= from && taken <= to) || (forDay && forDay >= from && forDay <= to);
  })());
  // The days before today, newest first: [{ day, rows }] with what the search, filters and tab let through, each day's
  // in the sort chosen; an order taken one day for another is listed once, on the later day. Not while Due's own list
  // shows (that is today's).
  function backDays(v) {
    if (range || dueOnly || sampleRows) return [];
    const today = todayKey(), now = Date.now(), seen = new Set(v.all.map(r => r.id)), out = [];
    const onHold = new Set((window.RestroCounter?.held?.() || []).map(h => h.uid).filter(Boolean));
    const mine = (window.RestroCounter?.orders?.() || []).filter(o => !onHold.has(o.uid)), ids = new Set(mine.map(o => o.uid || `n${o.number}`));
    const orders = [...mine, ...[...older.orders.values()].filter(o => !ids.has(o.uid || `n${o.number}`))];
    let last = firstKept(); while (older.days.has(addDays(last, -1))) last = addDays(last, -1);
    for (let day = addDays(today, -1); day >= last; day = addDays(day, -1)) {
      const rows = [];
      refDay = day;
      try {
        for (const o of orders) {
          const id = o.uid || `n${o.number}`; if (seen.has(id)) continue;
          const taken = dayOfOrder(o), forDay = o.readyAt ? dayOf(o.readyAt) : null;
          if (taken === day || forDay === day) { seen.add(id); rows.push(infoOf(o, now, { past: true })); }
        }
      } finally { refDay = null; }
      const shown = rows.filter(r => matches(r) && inTab(r, tab)).sort(sorter());
      if (shown.length) out.push({ day, rows: shown });
    }
    v.backTo = last;
    return out;
  }
  // "YESTERDAY · Sun 8 Nov", then "SATURDAY · Sat 7 Nov" and on
  const dayDivider = day => el('div', { class: 'or-dayd', role: 'row' }, el('span', { class: 'or-dayd-in', role: 'cell' },
    el('b', {}, day === addDays(todayKey(), -1) ? 'YESTERDAY' : keyDate(day).toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()), el('span', {}, `· ${shortDay(keyDate(day))}`)));
  // The end of Today's list (and of a day or range reaching past the kept days): older days from the cloud as it comes
  // into view, or why there are none
  function listEnd(v) {
    if (dueOnly || sampleRows) return null;
    if (!(range ? missingOlder() : older.more)) return null;
    if (!askCloud()) return el('div', { class: 'or-dayend', role: 'row' }, el('span', { role: 'cell' }, icon('cloudOff'), 'Older orders need internet'));
    return el('div', { class: 'or-dayend more', role: 'row', 'data-more': '1' }, el('span', { role: 'cell' }, older.busy ? 'Loading older orders…' : 'Older orders'));
  }
  // (a day or range picked that reaches past the kept days, with some of those days not read from the cloud yet)
  function missingOlder() {
    const { from, to } = period(), first = firstKept();
    for (let d = from; d < first && d <= to; d = addDays(d, 1)) if (!older.days.has(d)) return true;
    return false;
  }
  // (the next batch, once the end of the list is in view)
  function watchEnd() {
    const end = listEl?.querySelector('[data-more]'); if (!end || older.busy) return;
    const io = new IntersectionObserver(entries => {
      if (!entries.some(x => x.isIntersecting)) return; io.disconnect();
      if (range) { const first = firstKept(); readOlder(range.from, range.to < first ? range.to : addDays(first, -1)); }
      else { const last = v0().backTo || firstKept(); readOlder(addDays(last, -KEPT()), addDays(last, -1)); }
    }, { root: listEl, rootMargin: '0px 0px 300px 0px' });
    io.observe(end);
  }
  let lastView = null;
  const v0 = () => lastView || {};
  // Today's list, the days before it and the end: every layout's list (Classic's rows, Split's list, the cards)
  function listItems(v, item) {
    if (!range && !v.all.length) return [emptyOf(v)];   // (G1: no order yet today, as before: New order · See yesterday)
    if (!v.shown.length && !v.back.length) return [emptyOf(v), listEnd(v)];
    return [...v.shown.map(item), ...v.back.flatMap(g => [dayDivider(g.day), ...g.rows.map(item)]), listEnd(v)];
  }

  // ---------- the paper in the bill printer (the Bill / Receipt button) ----------
  let paper = { level: 100, state: 'ok' };
  function setPaper(p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return; } }
    if (!p || typeof p !== 'object') return;
    const level = Number(p.level), state = ['ok', 'low', 'out', 'offline'].includes(p.state) ? p.state : 'ok';
    const was = paperLook();
    paper = { level: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100, state };
    if (dialog.open) dialog.querySelectorAll('.or-b.pr').forEach(b => paintPaper(b));
    // (P07) the bill printer's paper has just run low: "Bill printer paper low · 18% left · keep a new roll ready" until ✕
    if (dialog.open && was === 'ok' && paperLook() === 'low') say({ kind: 'warn', ic: 'printFill', bold: `Bill printer paper low · ${paper.level}% left`, text: ' · keep a new roll ready' });
  }
  const paperLook = () => (paper.state === 'offline' ? 'off' : paper.state === 'out' || paper.level <= 0 ? 'out' : paper.state === 'low' || paper.level <= 20 ? 'low' : 'ok');
  function paintPaper(b) {
    const look = paperLook();
    b.classList.toggle('low', look === 'low'); b.classList.toggle('out', look === 'out'); b.classList.toggle('poff', look === 'off');
    b.style.setProperty('--used', `${100 - paper.level}%`);
  }
  function readPaper() {
    const printer = window.RESTRODevice?.printer; if (typeof printer?.paperStatus !== 'function') return;
    try { Promise.resolve(printer.paperStatus()).then(setPaper, () => {}); } catch {}
  }
  let paperStop = null;
  function watchPaper() {
    try { paperStop?.(); } catch {} paperStop = null;
    const printer = window.RESTRODevice?.printer;
    if (typeof printer?.subscribePaperStatus === 'function') { try { const stop = printer.subscribePaperStatus(setPaper); if (typeof stop === 'function') paperStop = stop; } catch {} }
    readPaper();
  }
  window.addEventListener('restro:printer-paper', e => setPaper(e.detail));
  window.addEventListener('restro:device-ready', watchPaper);
  // The bill printer's cover was opened and closed: was a new roll fitted? (OR-P08; confirming resets the level on every
  // tablet through the RESTRO Android app)
  window.addEventListener('restro:printer-cover', e => {
    if (!dialog.open) return;
    const d = e.detail || {};
    pop = { kind: 'roll', printer: typeof d.printer === 'string' && d.printer ? d.printer : 'Bill printer', level: Number.isFinite(Number(d.level)) ? Math.round(Number(d.level)) : paper.level };
    renderLayer();
  });

  // ---------- messages (Update Pack 4, A4): a dark bar at the bottom centre that hugs what it says; one at a time; a
  // confirmation 2 s, an error stays with RETRY and ✕; the timer waits while a finger is on it ----------
  let msg = null;
  const bar = el('div', { class: 'or-msg', role: 'status', 'aria-live': 'polite', hidden: true });
  function say(m) {
    if (typeof m === 'string') m = { text: m };
    if (msg?.timer) clearTimeout(msg.timer);
    msg = { ...m, ms: m.kind === 'error' || m.kind === 'busy' || m.kind === 'warn' ? 0 : m.undo ? 4000 : 2000 };
    paintMsg(); runMsg();
  }
  function runMsg() { if (!msg || !msg.ms || msg.held) return; clearTimeout(msg.timer); msg.timer = setTimeout(() => { msg = null; paintMsg(); }, msg.ms); }
  function paintMsg() {
    if (!msg) { bar.hidden = true; bar.replaceChildren(); return; }
    const act = msg.undo ? ['UNDO', msg.undo] : msg.retry ? ['RETRY', msg.retry] : null, error = msg.kind === 'error', busy = msg.kind === 'busy', warn = msg.kind === 'warn';
    bar.className = `or-msg${error ? ' error' : busy ? ' busy' : warn ? ' warn' : ''}`;
    bar.replaceChildren(...[msg.ic ? el('span', { class: 'or-msg-g', 'aria-hidden': 'true' }, icon(msg.ic)) : el('span', { class: 'or-msg-i', 'aria-hidden': 'true' }, busy ? null : error ? el('b', {}, '!') : icon('check')),
      el('span', { class: 'or-msg-t' }, msg.lead || '', msg.bold ? el('b', {}, msg.bold) : null, msg.text || ''),
      act ? el('button', { type: 'button', class: 'or-msg-a', onclick: () => { const run = act[1]; clearTimeout(msg?.timer); msg = null; paintMsg(); run(); } }, act[0]) : null,
      error || warn ? el('button', { type: 'button', class: 'or-msg-x', 'aria-label': 'Close', onclick: () => { msg = null; paintMsg(); } }, icon('close')) : null].filter(Boolean));
    bar.hidden = false;
    if (bar.parentElement !== dialog) dialog.append(bar);
  }
  bar.addEventListener('pointerdown', () => { if (msg) { msg.held = true; clearTimeout(msg.timer); } });
  const letGo = () => { if (msg?.held) { msg.held = false; runMsg(); } };
  bar.addEventListener('pointerup', letGo); bar.addEventListener('pointercancel', letGo); bar.addEventListener('pointerleave', letGo);
  // A result of the order-ready text or buzz that went by itself (below): here while Orders is open, else in the
  // Counter's bar while the Counter is open; a failure no one saw waits for Orders or the Counter to open. A success
  // never covers a failure still showing.
  let waiting = null;
  function notice(m) {
    if (dialog.open) { if (msg?.kind === 'error' && m.kind !== 'error') return; say(m); return; }
    if (window.RestroCounter?.notice?.(m)) return;
    if (m.kind === 'error') waiting = m;
  }

  // ---------- offline (Update Pack 4, A6; G7, K5, K6): a quiet note under the search; nothing is greyed ----------
  let offlineSince = null;
  const readOnline = () => { const st = window.RestroConnectivity?.getStatus?.(); return st ? st.internetAvailable !== false : navigator.onLine !== false; };
  function trackOnline() { const on = readOnline(); if (!on && !offlineSince) offlineSince = Date.now(); if (on) offlineSince = null; }
  window.addEventListener('restro:connectivity-changed', () => { const was = Boolean(offlineSince); trackOnline(); if (dialog.open && was !== Boolean(offlineSince)) render(); });
  const offlineNote = () => (offlineSince ? el('div', { class: 'or-offline', role: 'status' }, icon('cloudOff'),
    el('span', {}, el('b', {}, `Offline since ${timeOf(offlineSince)}.`), ' Orders, KOTs and printing keep working. Changes save on this tablet and sync when the internet is back.')) : null);

  // ---------- the pieces every view is made of ----------
  const root = el('div', { class: 'or-root' }); dialog.prepend(root);
  let layerEl = null, listEl = null, searchEl = null, frame = null;
  // Home (a raised white circle, the outline house); "‹ Counter" when Orders was opened from there (Back returns)
  function homeBtn(inRail = false) {
    const back = () => { if (!goBack()) document.querySelector('#system-home')?.click(); };
    if (fromCounter && inRail) return el('button', { type: 'button', class: 'or-home', 'aria-label': 'Back to Counter', title: 'Back to Counter', onclick: back }, icon('back'));
    return fromCounter
      ? el('button', { type: 'button', class: 'or-home back', 'aria-label': 'Back to Counter', onclick: back }, icon('back'), 'Counter')
      : el('button', { type: 'button', class: 'or-home', 'aria-label': 'Home', title: 'Home', onclick: () => document.querySelector('#system-home')?.click() }, house());
  }
  const titleEl = () => el('div', { class: 'or-title' }, appIcon(), el('h2', { id: 'orders-title', tabindex: '-1' }, 'Orders'));
  // The day: Today / Yesterday / Tomorrow / "Fri 6 Nov" / "2 – 8 Nov"
  function dayLabel(key) {
    const today = todayKey();
    if (key === today) return 'Today';
    if (key === addDays(today, -1)) return 'Yesterday';
    if (key === addDays(today, 1)) return 'Tomorrow';
    return keyDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  }
  function periodLabel() {
    const { from, to } = period(); if (from === to) return dayLabel(from);
    const a = keyDate(from), b = keyDate(to), mon = d => d.toLocaleDateString('en-GB', { month: 'short' });
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${mon(b)}` : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
  }
  // A dropdown pill (the day, the four filters): its icon, its words and the chevron; blue-tinted while a filter is on
  function pill(key, lead, label, on, cls = '') {
    return el('button', { type: 'button', class: `or-dd${cls ? ` ${cls}` : ''}${on ? ' on' : ''}${menu === key ? ' open' : ''}`, 'data-menu': key, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === key),
      onclick: e => toggleMenu(key, e.currentTarget) }, lead ? icon(lead) : null, el('span', { class: 'or-dd-t' }, label), el('span', { class: 'or-cv' }, icon('expand'))); // (the chevron stays down while the menu is open: E1, E5, D5)
  }
  const datePill = cls => pill('date', 'calendar', periodLabel(), false, cls);
  function filterPills(cls) {
    const first = (set, names) => { const list = [...set]; return list.length ? `${names(list[0])}${list.length > 1 ? ` +${list.length - 1}` : ''}` : null; };
    const payName = k => PAYS.find(p => p[0] === k)?.[1] || k, typeName = k => TYPES[k]?.[0] || PLATFORMS[k]?.[0] || (k === 'qr' ? 'QR' : k);
    const dvName = { disc: 'Discounted', void: 'Voided after KOT', both: 'Discounted and voided' };
    // (tapping Due ticks Due and Part paid: the pill reads just "Due", the Due total being both)
    return [pill('pay', 'payments', (dueOnly ? 'Due' : first(payF, payName)) || 'All payments', payF.size > 0 || dueOnly, cls),
      pill('dv', 'tag', dv ? dvName[dv] : 'Discounts & voids', Boolean(dv), cls),
      pill('type', 'dineIn', first(typesF, typeName) || 'All order types', typesF.size > 0, cls),
      pill('staff', 'person', staffF || 'All staff', Boolean(staffF), cls)];
  }
  // Clear filters: always there; greyed until something differs from the start, then one tap resets it all
  function clearBtn(cls = '') {
    const on = changed();
    return el('button', { type: 'button', class: `or-clear${cls ? ` ${cls}` : ''}${on ? '' : ' off'}`, 'aria-disabled': on ? null : 'true',
      onclick: () => { if (!changed()) return; resetFilters(); render(); } }, icon('filterOff'), 'Clear filters');
  }
  // The search box (built once per full drawing so typing never loses it)
  function searchBox(cls = '') {
    const input = el('input', { id: 'orders-search', type: 'search', class: 'or-search-in', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false',
      placeholder: 'Search name, phone, order #, table, pager, code', 'aria-label': 'Search orders' });
    input.value = query;
    const clear = el('button', { type: 'button', class: 'or-search-x', 'aria-label': 'Clear the search', hidden: !query, onclick: () => { query = ''; input.value = ''; syncSearch(); input.focus(); } }, icon('close'));
    input.addEventListener('input', () => { query = input.value; syncSearch(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return el('label', { class: `or-search${cls ? ` ${cls}` : ''}${query ? ' typed' : ''}` }, icon('search', 'or-search-i'), input, clear);
  }
  function syncSearch() {
    if (searchEl) { searchEl.classList.toggle('typed', Boolean(query)); searchEl.querySelector('.or-search-x').hidden = !query; }
    scrollTop = 0; renderRest();
  }
  const syncBtn = cls => window.RestroSyncButton?.create({ cls: `or-sync${cls ? ` ${cls}` : ''}` }) || null;
  // Tabs: All · Open · Closed with their counts, and Held as a link (the day's held orders, on their own page)
  const TABS = [['all', 'All', 'receipt'], ['open', 'Open', 'clock'], ['closed', 'Closed', 'doneCircle']];
  function pickTab(key) { tab = key; scrollTop = 0; renderRest(); }
  function tabsPills(v) {
    return el('div', { class: 'or-tabs', role: 'tablist', 'aria-label': 'Orders' }, ...TABS.map(([key, label, ic]) => el('button', { type: 'button', role: 'tab', class: `or-tab${tab === key ? ' on' : ''}`, 'aria-selected': String(tab === key),
      onclick: () => pickTab(key) }, icon(ic), el('span', { class: 'or-tab-t' }, label), el('em', {}, String(v.counts[key])))),
    el('i', { class: 'or-hsep', 'aria-hidden': 'true' }),
    el('button', { type: 'button', class: 'or-tab or-held', 'aria-label': `Held orders, ${heldCount()}`, onclick: openHeld }, icon('pauseCircle'), el('span', { class: 'or-tab-t' }, 'Held'), el('em', {}, String(heldCount())), el('span', { class: 'or-held-go' }, icon('chevron'))));
  }
  function openHeld() { returning = true; if (window.RestroCounter?.openHeld) window.RestroCounter.openHeld(); else toast('Held orders are on the Counter'); }
  // Totals: Orders · Total · Due · N orders › (Due taps to the orders behind it; at ₹0 it is grey and does nothing)
  function dueTap() { if (!view().totals.due) return; payF = new Set(['np', 'part']); dueOnly = true; tab = 'all'; scrollTop = 0; render(); }
  // (Update Pack 5, H3) on Today, labelled as today's: Classic's card under "TODAY · MON 9 NOV", the bars' "Today's orders"
  const todayLab = () => `TODAY · ${shortDay(keyDate(todayKey())).toUpperCase()}`;
  const ordersWord = () => (range ? 'Orders' : 'Today’s orders');
  function totalsCard(v) {
    const t = v.totals, live = t.due > 0;
    return el('div', { class: 'or-tot3' },
      el('div', {}, el('span', {}, 'Orders'), el('b', {}, String(t.orders))),
      el('div', {}, el('span', {}, 'Total'), el('b', {}, rupees(t.total))),
      el(live ? 'button' : 'div', { class: `due${live ? '' : ' zero'}`, ...(live ? { type: 'button', 'aria-label': `Due, ${t.dueN} orders, ${rupees(t.due)}: show them`, onclick: dueTap } : {}) },
        el('span', {}, `Due · ${t.dueN} order${t.dueN === 1 ? '' : 's'}`), el('b', {}, rupees(t.due)), el('span', { class: 'or-tapc' }, icon('chevron'))));
  }

  // ---------- Classic: the sidebar and the order table ----------
  function sideEl(v) {
    return el('aside', { class: 'or-side' },
      el('div', { class: 'or-sh' }, homeBtn(), titleEl()),
      datePill('or-fd'), tabsPills(v),
      el('p', { class: 'or-flab' }, 'FILTERS'), ...filterPills('or-fd'), range ? null : el('p', { class: 'or-tlab' }, todayLab()), totalsCard(v));
  }
  // The heading: tap to sort (again: the other way; Order status goes Open first → Scheduled first → Closed first)
  const HEADS = [['when', 'Date & time'], [null, ''], ['type', 'Order type'], [null, 'Customer / table · server'], ['status', 'Order status'], ['pay', 'Payment status'], [null, '']];
  function headTap(key) {
    if (key === 'status') sort = sort.key === 'status' ? { key, mode: STATUS_MODES[(STATUS_MODES.indexOf(sort.mode) + 1) % 3] } : { key, mode: 'open' };
    else if (key === 'when') sort = sort.key === 'when' ? (sort.dir < 0 ? { key, dir: 1 } : SORT0) : SORT0;
    else sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 };
    scrollTop = 0; renderRest();
  }
  function sheetEl(v) {
    const head = el('div', { class: 'or-hd', role: 'row' }, picking ? el('span', { class: 'or-h' }) : null, ...HEADS.map(([key, label]) => {
      if (!key) return el('span', { class: 'or-h', role: 'columnheader' }, label);
      const on = sort.key === key, up = on && (key === 'status' ? sort.mode === 'open' : sort.dir > 0);
      return el('button', { type: 'button', class: `or-h sort${on ? ' on' : ''}`, role: 'columnheader', 'aria-sort': on ? (up ? 'ascending' : 'descending') : 'none', onclick: () => headTap(key) },
        label, icon(on ? 'sortDown' : 'sortBoth', up ? 'up' : ''));
    }));
    listEl = el('div', { class: 'or-scroll', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } },
      el('div', { class: 'or-rows', role: 'rowgroup' }, ...listItems(v, rowEl)));
    return el('div', { class: `or-sheet ${rowStyle()}${picking ? ' picking' : ''}`, role: 'table', 'aria-label': 'Orders' }, matchHint(), head, listEl);
  }
  // The type tile: our icon in its colour on a light tint of it, or the delivery app's logo on its tint
  function tileOf(r, cls = 'or-tt') {
    const t = r.type;
    return t.platform
      ? el('span', { class: `${cls} app`, style: `background:${t.colour}1A`, 'aria-hidden': 'true' }, t.logo ? el('img', { class: 'or-logo', src: t.logo, alt: '' }) : el('span', { class: 'or-logo', style: `background:${t.colour}` }, t.name[0]))
      : el('span', { class: cls, style: `background:${t.colour}1A;color:${t.colour}`, 'aria-hidden': 'true' }, icon(t.icon));
  }
  function codesLine(r) {
    if (!r.who.codes) return null;
    const c = r.who.codes, out = [];
    if (c.call) out.push('Call code', el('b', { class: 'chip y' }, c.call));
    if (c.handover) { const q = parsed(), on = q?.kind === 'digits' && q.d === c.handover; out.push(out.length ? '· Handover' : 'Handover', el('b', { class: `chip g${on ? ' hit' : ''}` }, c.handover)); }
    if (c.rider) out.push(`${out.length ? '· ' : ''}Rider arrival ${c.rider}`);
    return out;
  }
  // "+91 90000 00000 · AB": the phone never breaks across lines
  const whoLine = r => {
    const l2 = r.who.l2; if (!l2) return null;
    if (r.phone && l2.startsWith(r.phone)) return el('span', {}, el('span', { class: 'nb' }, hl(r.phone, 'phone')), l2.slice(r.phone.length));
    return l2;
  };
  // (Update Pack 5, K) the small blue QR tag by the order type of an order placed by QR
  const qrTag = r => (r.qr ? el('span', { class: 'or-qr', title: 'Placed by QR' }, icon('qr'), 'QR') : null);
  const tagsOf = r => [r.tags.disc ? el('span', { class: 'or-mk', title: 'Discount', 'aria-label': 'Discount' }, icon('tag')) : null, r.tags.void ? el('span', { class: 'or-mk', title: 'Voided after KOT', 'aria-label': 'Voided after KOT' }, icon('void')) : null];
  const statusCellOf = r => el('div', { class: `or-c st ${r.status.cls}`, role: 'cell' }, el('div', { class: 'l1' }, el('b', {}, r.status.text)), el('div', { class: `l2 ${r.status.subCls || ''}`.trim() }, r.status.sub || '\u00A0'));
  // the amount under the payment status: the order's total; what is still due on Part paid (K1); what was
  // refunded on Partial refund (Y1)
  const payAmount = r => (r.pay.key === 'prf' ? `${money(r.pay.refunded)} refunded` : r.pay.key === 'part' ? `${money(r.pay.due)} due` : money(Number(r.o.total) || 0));
  // The payment status; a long one ("Partial refund - Card") is drawn smaller in every view, as the designs do (Classic
  // 16.5, Split and Cards 15.5)
  const payLabel = r => el('b', r.pay.text.length >= 19 ? { class: 'long' } : {}, r.pay.text);
  const payCellOf = r => el('div', { class: `or-c pm ${r.pay.cls || ''}`.trim(), role: 'cell' }, el('div', { class: 'l1' }, payLabel(r)),
    el('div', { class: 'l2' }, el('span', {}, payAmount(r)), ...tagsOf(r)));
  const labelOf = r => `Order ${r.o.number != null ? ticket(r.o.number) : ''}, ${timeOf(r.when)}, ${r.type.label}, ${r.who.l1}, ${r.status.text}${r.status.sub ? ` ${r.status.sub}` : ''}, ${r.pay.text}, ${money(Number(r.o.total) || 0)}`;
  function tappable(r, cls, ...children) {
    const picked = picking?.has(r.id);
    return el('div', { class: `${cls}${picking ? r.lock ? ' locked' : picked ? ' picked' : '' : ''}`, role: 'row', tabindex: '0', 'data-id': r.id, 'aria-label': labelOf(r),
      onclick: e => { if (e.target.closest('.or-bt,.or-open')) return; if (suppressTap) { suppressTap = false; return; } tapRow(r); },
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); tapRow(r); } } }, ...children);
  }
  // A row: date & time · the type tile · order type · customer / table · server · order status · payment status · the
  // four buttons
  function rowEl(r) {
    const cell = (cls, l1, l2, l3) => el('div', { class: `or-c ${cls}`, role: 'cell' }, el('div', { class: 'l1' }, ...[l1].flat()), l2 != null ? el('div', { class: 'l2' }, ...[l2].flat()) : null, l3 ? el('div', { class: 'l2' }, ...[l3].flat()) : null);
    const picked = picking?.has(r.id);
    return tappable(r, 'or-r',
      picking ? el('span', { class: `or-cb${picked ? ' on' : ''}`, 'aria-hidden': 'true' }, picked ? icon('check') : null) : null,
      cell('tm', el('b', {}, timeOf(r.when)), dateOf(r.when)),
      tileOf(r),
      cell('ty', [el('b', {}, r.type.label), qrTag(r), r.type.time ? el('span', { class: 'pt' }, r.type.time) : null], numbersOf(r)),
      cell('cu', el('b', {}, hl(r.who.l1, 'name')), whoLine(r), codesLine(r)),
      statusCellOf(r), payCellOf(r),
      picking ? el('div', { class: 'or-c lock', role: 'cell' }, r.lock ? el('span', { class: 'or-lock' }, r.lock) : null) : buttons(r));
  }
  // Nothing to list (G1–G6): the day is empty (New order on the Counter · See yesterday), or nothing matches the search
  // and filters, named in the words (Clear filters · Pick another day)
  function dayWords() {
    const { from, to } = period(), today = todayKey();
    if (from !== to) return `between ${periodLabel()}`;
    return from === today ? 'today' : from === addDays(today, -1) ? 'yesterday' : from === addDays(today, 1) ? 'tomorrow' : `on ${dayLabel(from)}`;
  }
  const ebtn = (cls, ic, label, run) => el('button', { type: 'button', class: `or-ebtn ${cls}`, onclick: run }, icon(ic), label);
  function emptyOf(v) {
    const pickDay = e => { e.stopPropagation(); toggleMenu('date', root.querySelector('[data-menu="date"]') || e.currentTarget); };
    if (!v.all.length) {
      const today = isToday();
      return el('div', { class: 'or-empty' }, el('span', { class: 'ei', 'aria-hidden': 'true' }, icon('receipt')),
        el('strong', {}, today ? 'No orders yet today' : `No orders ${dayWords()}`),
        el('p', {}, 'Orders taken on the Counter, Floor or from Swiggy and Zomato will show up here as soon as they come in.'),
        el('div', { class: 'eb' }, today ? ebtn('pri', 'add', 'New order on the Counter', () => window.RestroCounter?.open()) : null,
          today ? ebtn('sec', 'calendar', 'See yesterday', () => { const y = addDays(todayKey(), -1); range = { from: y, to: y }; scrollTop = 0; render(); }) : ebtn('sec', 'calendar', 'Pick another day', pickDay)));
    }
    const q = query.trim(), on = [];
    const first = (set, name) => [...set].map(name).join(' or ');
    if (payF.size) on.push(first(payF, k => PAYS.find(x => x[0] === k)?.[1] || k));
    if (dv) on.push({ disc: 'Discounted', void: 'Voided after KOT', both: 'Discounted and voided' }[dv]);
    if (typesF.size) on.push(first(typesF, k => TYPES[k]?.[0] || PLATFORMS[k]?.[0] || (k === 'qr' ? 'QR' : k)));
    if (staffF) on.push(staffF);
    const words = [];
    on.forEach((w, i) => { if (i) words.push(i === on.length - 1 ? ' and ' : ', '); words.push(el('b', {}, w)); });
    const tabOnly = !q && !on.length && v.base.length;
    return el('div', { class: 'or-empty' }, el('span', { class: 'ei', 'aria-hidden': 'true' }, icon('search')),
      el('strong', {}, tabOnly ? `No ${tab} orders` : q ? `No orders match “${q}”` : 'No orders match'),
      el('p', {}, ...(tabOnly ? ['Try another tab, or clear the filters.'] : [`Nothing ${dayWords()}`, q ? [' for ', el('b', {}, q)] : null, on.length ? [' with ', ...words] : null,
        q ? '. Check the number, try another day, or clear the filters.' : '. Try another day, or clear the filters.'].flat().filter(Boolean))),
      el('div', { class: 'eb' }, ebtn('pri', 'filterOff', 'Clear filters', () => { resetFilters(); render(); }), ebtn('sec', 'calendar', 'Pick another day', pickDay)));
  }
  // Bill / Receipt (the paper level inside: used part white on top, paper left light blue; amber when low, red with !
  // when out, grey and crossed when the printer is offline) · KOT (blue: reprint; "KOT !" red when a print failed; plum
  // with its time while a scheduled KOT waits) · Notify, or Ready → Marked for a delivery app · Buzz with the pager's
  // number. A short green bar under Notify once a message went, and under Buzz once the dock confirmed the buzz.
  // Inactive ones are greyed in their place. A tap does only that button's job; a moving finger scrolls.
  function buttons(r) {
    const stop = e => e.stopPropagation();
    const b = (cls, on, label, run, ...content) => el('button', { type: 'button', class: `or-b ${cls}${on ? '' : ' off'}`, 'aria-label': label, 'aria-disabled': on ? null : 'true',
      onclick: e => { stop(e); if (on) run(e.currentTarget); }, onpointerdown: stop }, ...content);
    const bill = r.pay.key === 'np' || r.pay.key === 'part', look = paperLook();
    const pr = b('pr', true, bill ? 'Print the bill' : 'Print the receipt', () => printOrder(r), icon(look === 'off' ? 'printOff' : 'print'), el('span', {}, bill ? 'Bill' : 'Receipt'));
    paintPaper(pr);
    const k = r.kot;
    const kot = b(`kot${k.look === 'err' ? ' err' : k.look === 'q' ? ' sk' : ''}`, k.look !== 'off', k.look === 'err' ? 'A KOT didn’t print: print it again' : k.look === 'q' ? `Scheduled KOT: prints by itself at ${timeOf(k.at)}` : 'Reprint a KOT',
      btn => openKot(r, btn), icon('kot'), el('span', {}, k.label));
    const th = r.third;
    const third = th.kind === 'notify'
      ? b(`nt${th.line ? ` ${th.line}` : ''}`, th.on, th.on ? `Notify ${r.name || 'the customer'}` : 'Notify: no phone number', btn => openNotify(r, btn), icon('notify'), el('span', {}, 'Notify'))
      : b('nt', th.on, th.kind === 'marked' ? 'Marked ready' : 'Mark ready', () => markReady(r), icon(th.kind === 'marked' ? 'marked' : 'ready'), el('span', {}, th.kind === 'marked' ? 'Marked' : 'Ready'));
    const state = flash.get(r.id);
    const pq = parsed(), pagerHit = pq?.kind === 'pager' && pq.n === Number(r.buzz.no);
    const buzz = b(`bz${r.buzz.line ? ` ${r.buzz.line}` : ''}${state === 'buzzing' ? ' busy' : ''}${pagerHit ? ' hit' : ''}`, r.buzz.on, r.buzz.on ? `Buzz pager ${r.buzz.no}` : r.buzz.no ? `Pager ${r.buzz.no}: back in its dock` : 'Buzz: no pager', () => buzzPager(r),
      r.buzz.no ? el('em', {}, r.buzz.no) : null, el('span', {}, 'Buzz'));
    return el('div', { class: 'or-bt', role: 'cell' }, pr, kot, third, buzz);
  }

  // ---------- Split detail (OR02, OR03) and Cards (OR04): an icon rail with Home, the tabs and the Held link ----------
  function railEl(v) {
    const block = (key, label, ic, count, extra = {}) => el('button', { type: 'button', role: key ? 'tab' : null, class: `or-rtb${key && tab === key ? ' on' : ''}${extra.cls ? ` ${extra.cls}` : ''}`,
      'aria-selected': key ? String(tab === key) : null, 'aria-label': `${label}, ${count}`, onclick: extra.onclick || (() => pickTab(key)) },
    el('span', { class: 'or-ri' }, icon(ic), el('em', {}, String(count))), el('span', { class: 'or-rtb-t' }, label));
    return el('nav', { class: 'or-rail', 'aria-label': 'Orders' }, homeBtn(true), ...TABS.map(([key, label, ic]) => block(key, label, ic, v.counts[key])),
      el('i', { class: 'or-rsep', 'aria-hidden': 'true' }), block(null, 'Held', 'pauseCircle', heldCount(), { cls: 'or-held', onclick: openHeld }));
  }
  // Sort (Split, Cards): the menu's choices; "Date & time" (newest first) or "Order status · Scheduled first"
  const SORTS = [['when', 'Date & time', ['Newest first', 'Oldest first']], ['type', 'Order type', ['A to Z', 'Z to A']], ['status', 'Order status', ['Open first', 'Scheduled first', 'Closed first']], ['pay', 'Payment status', ['Due first', 'Paid first']]];
  const sortChoice = () => sort.key === 'status' ? STATUS_MODES.indexOf(sort.mode) : sort.key === 'when' ? (sort.dir < 0 ? 0 : 1) : (sort.dir > 0 ? 0 : 1);
  function setSort(key, i) {
    sort = key === 'status' ? { key, mode: STATUS_MODES[i] } : key === 'when' ? (i ? { key, dir: 1 } : SORT0) : { key, dir: i ? -1 : 1 };
  }
  // (the arrow points up only for the second of two choices: Oldest first, Z to A, Paid first; D4, D5, OS10)
  // the arrow: up for Oldest first, Z to A, Paid first and Order status · Open first (F1–F3, as on Classic's heading)
  const sortUp = () => (sort.key === 'status' ? sort.mode === 'open' : sortChoice() === 1);
  // "Date & time", "Order status" for a key's first choice; "Order status · Scheduled first" otherwise
  function sortWords() {
    const [, name, choices] = SORTS.find(x => x[0] === sort.key), i = sortChoice();
    return i === 0 ? [name] : [name, ` · ${choices[i]}`];
  }
  // The totals in a row (Split's footer, Cards' toolbar): Orders | Total | Due · N orders ›
  function totsBar(v, cls) {
    const t = v.totals, live = t.due > 0;
    return el('div', { class: `or-tots ${cls}` },
      el('div', { class: 'tc' }, el('span', {}, ordersWord()), el('b', {}, String(t.orders))),
      el('div', { class: 'tc' }, el('span', {}, 'Total'), el('b', {}, rupees(t.total))),
      el(live ? 'button' : 'div', { class: `tc due${live ? '' : ' zero'}`, ...(live ? { type: 'button', 'aria-label': `Due, ${t.dueN} orders, ${rupees(t.due)}: show them`, onclick: dueTap } : {}) },
        el('span', {}, `Due · ${t.dueN} order${t.dueN === 1 ? '' : 's'}`), el('b', {}, rupees(t.due)), el('span', { class: 'or-tapc' }, icon('chevron'))));
  }
  // The picking bar's pieces (Split, Cards)
  const pickedPill = () => el('span', { class: 'or-picked' }, `${picking.size} selected`);
  function selectAllBtn(v) {
    const can = v.shown.filter(r => !r.lock), all = can.length > 0 && can.every(r => picking.has(r.id));
    return el('button', { type: 'button', class: 'or-link', onclick: () => { if (all) can.forEach(r => picking.delete(r.id)); else can.forEach(r => picking.add(r.id)); render(); } }, all ? 'Unselect all' : 'Select all');
  }
  const pickHint = () => el('span', { class: 'or-hint' }, 'Paid and Swiggy/Zomato orders can’t be deleted');
  const cancelPick = () => el('button', { type: 'button', class: 'or-cancel', onclick: () => { picking = null; render(); } }, 'Cancel');
  const deletePick = () => { const n = picking.size; return el('button', { type: 'button', class: 'or-del', disabled: !n, onclick: () => { if (n) { pop = { kind: 'delete', ids: [...picking], reason: '' }; renderLayer(); } } }, icon('trash'), n === 1 ? 'Delete 1 order' : `Delete ${n} orders`); };

  // A list item (Split): the tile · type, numbers and time, who, the status, a failed KOT, the codes · payment
  function liEl(r) {
    const c = r.who.codes, picked = picking?.has(r.id);
    const lines = [
      el('div', { class: 'l1' }, el('b', {}, r.type.label), qrTag(r), r.type.time ? el('span', { class: 'pt' }, r.type.time) : null),
      el('div', { class: 'l2' }, ...numbersOf(r), ` · ${timeOf(r.when)}${(range && range.from !== range.to) || (!range && r.taken !== todayKey()) ? ` · ${dateOf(r.when)}` : ''}`),
      el('div', { class: 'l2' }, el('b', { class: 'cn' }, hl(r.who.l1, 'name')), ...(r.who.l2 ? [' · ', ...(r.phone && r.who.l2.startsWith(r.phone) ? [el('span', { class: 'nb' }, hl(r.phone, 'phone')), r.who.l2.slice(r.phone.length)] : [r.who.l2])] : [])),
      el('div', { class: `lst ${r.status.cls}` }, el('b', {}, r.status.text), r.status.sub ? el('span', { class: `ss ${r.status.subCls || ''}`.trim() }, r.status.sub) : null),
      r.kot.look === 'err' ? el('div', { class: 'kfl' }, icon('alert'), 'KOT failed · tap the order to reprint') : null];
    if (c && (c.call || c.handover)) lines.push(el('div', { class: 'lc' }, ...codesLine({ who: { codes: { ...c, rider: '' } } })));
    if (c?.rider) lines.push(el('div', { class: 'lc' }, `Rider arrival ${c.rider}`));
    return tappable(r, `or-li${!picking && chosen === r.id ? ' sel' : ''}`,
      picking ? el('span', { class: `or-cb${picked ? ' on' : ''}`, 'aria-hidden': 'true' }, picked ? icon('check') : null) : null,
      tileOf(r, 'or-tt s52'), el('div', { class: 'or-lm' }, ...lines),
      el('div', { class: `or-lr ${r.pay.cls || ''}`.trim() }, el('div', { class: 'l1' }, payLabel(r)),
        el('div', { class: 'l2' }, payAmount(r), ...tagsOf(r)),
        picking && r.lock ? el('span', { class: 'or-lock' }, r.lock) : null));
  }
  // The order picked, on the right (Split): its tile and title, what it is, the status and payment, the delivery
  // app's codes, the dishes, the sums, then the four buttons and Open
  const kotNos = o => kotsOf(o).map((k, i) => `#${k.no || i + 1}`).join(', ');
  function sumsOf(o) {
    const lines = Array.isArray(o.lines) ? o.lines : [], items = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
    const sub = Number.isFinite(o.subtotal) ? o.subtotal : lines.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0);
    const rate = window.RestroMenu?.taxRate ?? 0.05, labels = window.RestroBill?.labels(rate) || { cgst: 'CGST 2.5%', sgst: 'SGST 2.5%', gst: 'GST 5%' };
    const b = window.RestroBill?.order({ lines: [{ each: sub, qty: 1 }], type: o.type, discountPct: o.discountPct, servicePct: o.servicePct, packaging: o.packaging, delivery: o.delivery }, rate);
    return { items, sub, labels, b };
  }
  function detailEl(r) {
    const o = r.o, { items, sub, labels, b } = sumsOf(o), queued = r.kot.look === 'q';
    // (a word found in the name or table is marked in the list, not in this title; a number found is marked in both: F2, K4)
    const title = r.type.platform ? numbersOf(r) : r.dine ? [r.who.l1.split(' · ')[0], ' · ', hl(`Order ${ticket(o.number)}`, 'number')] : [r.name || r.type.label, ' · ', hl(`Order ${ticket(o.number)}`, 'number')];
    const meta = r.type.platform ? [`${r.type.label} · ${r.name || 'Customer'}`, r.phone ? [' · ', el('span', { class: 'nb' }, r.phone)] : null]
      : r.dine ? [r.type.label, r.qr ? ' · QR' : '', o.guests ? ` · ${o.guests} guest${o.guests === 1 ? '' : 's'}` : '', r.server ? ` · Server: ${r.server}` : '']
        : [r.type.label, r.qr ? ' · QR' : '', r.phone ? [' · ', el('span', { class: 'nb' }, r.phone)] : null];
    // (OS4, OS7) "KOT prints at 8:00 pm" today; "KOT prints Tue 10 Nov, 12:20 pm" on another day
    const kots = queued ? (dayOf(r.kot.at) === todayKey() ? ` · KOT prints at ${timeOf(r.kot.at)}` : ` · KOT prints ${shortDay(r.kot.at)}, ${timeOf(r.kot.at)}`) : kotsOf(o).length ? ` · KOT ${kotNos(o)}` : '';
    const c = r.who.codes, cbx = (cls, label, value) => el('div', { class: `cb ${cls}` }, el('span', {}, label), el('b', {}, value));
    const sumRow = (label, value, cls) => [el('span', cls ? { class: cls } : {}, label), el(cls ? 'span' : 'b', cls ? { class: cls } : {}, value)];
    const lines = (Array.isArray(o.lines) ? o.lines : []).filter(l => l.qty > 0);
    return el('div', { class: 'or-dt', 'data-id': r.id },
      el('div', { class: 'or-dh' }, tileOf(r, 'or-tt s64'), el('div', { class: 'dhm' }, el('div', { class: 'dtt' }, ...title.flat()),
        el('div', { class: 'dmeta' }, ...meta.flat().filter(Boolean), ` · ${timeOf(o.createdAt)} · ${dateOf(o.createdAt)}${kots}`))),
      el('div', { class: 'or-stp' }, statusCellOf(r), payCellOf(r)),
      r.type.platform && (c || r.type.time) ? el('div', { class: 'or-codes' },
        c?.call ? cbx('y', 'Call code', c.call) : null, c?.handover ? cbx(`g${parsed()?.d === c.handover ? ' hit' : ''}`, 'Handover', c.handover) : null,
        r.type.time ? cbx('', o.platformType === 'pickup' ? 'Ready by' : 'Pickup', r.type.time.replace(/^(Pickup|Ready by) /, '')) : null, c?.rider ? cbx('', 'Rider arrival', c.rider) : null) : null,
      el('div', { class: 'or-dl' }, ...lines.map(l => el('div', { class: 'dli' }, el('div', { class: 'q' }, `${l.qty} ×`),
        el('div', { class: 'n' }, l.name, Array.isArray(l.mods) && l.mods.length ? el('small', {}, l.mods.map(m => (typeof m === 'string' ? m : m.label)).filter(Boolean).join(' · ')) : null),
        el('div', { class: 'e' }, l.qty > 1 ? `${rupees(Math.round(l.price * 100))} ea` : ''), el('div', { class: 'pz' }, rupees(Math.round(l.price * 100) * l.qty))))),
      el('div', { class: 'or-dtot' }, ...sumRow(`Subtotal · ${items} item${items === 1 ? '' : 's'}`, money(sub)),
        ...(b?.discount ? sumRow(`Discount ${b.discountPct}%`, `−${money(b.discount)}`) : []),
        ...(b?.service ? sumRow(`Service charge ${b.servicePct}% (optional)`, money(b.service)) : []),
        ...(b?.packaging ? sumRow('Packaging', money(b.packaging)) : []), ...(b?.delivery ? sumRow('Delivery charge', money(b.delivery)) : []),
        ...(b ? sumRow(`${labels.gst} (${labels.cgst} ${money(b.cgst)} + ${labels.sgst} ${money(b.sgst)})`, money(b.tax)) : []),
        ...(b?.roundOff ? sumRow('Round off', `${b.roundOff < 0 ? '−' : '+'}${money(Math.abs(b.roundOff))}`) : []),
        ...sumRow('Total', money(Number(o.total) || 0), 'g')),
      el('div', { class: 'or-acts' }, buttons(r), el('button', { type: 'button', class: 'or-open', onclick: () => tapRow(r, true) }, 'Open', icon('chevron'))));
  }
  // Picking orders to delete in Split (H1): the right side lists them, with Cancel and Delete
  function pickSummary(v) {
    const rows = v.all.filter(r => picking.has(r.id)), sum = rows.reduce((n, r) => n + (Number(r.o.total) || 0), 0), n = rows.length;
    return el('div', { class: 'or-dt or-psum' },
      el('div', { class: 'or-dh' }, el('span', { class: 'or-ptrash', 'aria-hidden': 'true' }, icon('trash')), el('div', { class: 'dhm' }, el('div', { class: 'dtt' }, n === 1 ? '1 order selected' : `${n} orders selected`),
        el('div', { class: 'dmeta' }, 'Only orders that aren’t paid can be deleted.'))),
      el('div', { class: 'or-plist' }, ...rows.map(r => el('div', { class: 'pr' }, el('span', {}, el('b', {}, r.dine ? r.who.l1.split(' · ')[0] : r.name || r.type.label), ` · ${r.dine ? r.type.label : r.type.label} · Order ${ticket(r.o.number)}`), el('b', { class: 'am' }, money(Number(r.o.total) || 0)))),
        n ? el('div', { class: 'pr tot' }, el('b', {}, `Due · ${n} order${n === 1 ? '' : 's'}`), el('b', {}, money(sum))) : null),
      el('div', { class: 'or-pfoot' }, cancelPick(), deletePick()));
  }
  // (a new tab, search, filter, sort or day shows the first order of the new list: OS10, F2)
  let lastListKey = '';
  const listKey = () => JSON.stringify([tab, query.trim(), [...payF], dv, [...typesF], staffF, dueOnly, sort, range]);
  function splitLayout(v, search) {
    const key = listKey(); if (key !== lastListKey) { lastListKey = key; if (!picking) chosen = null; }
    if (!picking && !v.list.some(r => r.id === chosen)) chosen = v.list[0]?.id || null;
    const r = v.list.find(x => x.id === chosen);
    listEl = el('div', { class: 'or-ls', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } }, ...listItems(v, liEl));
    const r1 = el('div', { class: 'or-r1' }, titleEl(), datePill('or-dd2'), syncBtn('s48'));
    const head = picking
      ? [slot(r1, 'r1'), slot(el('div', { class: 'or-r2 pick' }, pickedPill(), selectAllBtn(v)), 'pick'), slot(el('p', { class: 'or-phint' }, pickHint()), 'hint')]
      : [slot(r1, 'r1'), el('div', { class: 'or-r2' }, search, slot(clearBtn('or-clr2'), 'clear')), slot(el('div', { class: 'or-r3' }, ...filterPills('or-dd2')), 'filters'), offlineNote()];
    return el('div', { class: `or-split ${rowStyle()}${picking ? ' picking' : ''}`, 'data-kind': 'split' }, slot(railEl(v), 'rail'),
      el('div', { class: 'or-pane' }, el('div', { class: 'or-ph' }, ...head),
        slot(el('div', { class: 'or-mh-slot' }, matchHint()), 'mhint'),
        slot(el('div', { class: 'or-sorth' }, el('span', {}, `${v.shown.length} order${v.shown.length === 1 ? '' : 's'}`),
          el('button', { type: 'button', class: `or-so${menu === 'sort' ? ' open' : ''}`, 'aria-haspopup': 'menu', onclick: e => toggleMenu('sort', e.currentTarget) }, el('span', {}, 'Sort'), ...sortWords(), icon('sortDown', sortUp() ? 'up' : ''))), 'sorth'),
        slot(listEl, 'list'), slot(totsBar(v, 'foot'), 'tots')),
      slot(el('div', { class: 'or-dp' }, picking ? pickSummary(v) : r ? detailEl(r) : null), 'detail'));
  }

  // A card (Cards): the tile, type and numbers, the time and date · who · the status and payment · the four buttons
  function cardEl(r) {
    const c = r.who.codes, picked = picking?.has(r.id);
    return tappable(r, 'or-cd',
      el('div', { class: 'or-chd' }, picking ? el('span', { class: `or-cb${picked ? ' on' : ''}`, 'aria-hidden': 'true' }, picked ? icon('check') : null) : null,
        tileOf(r, 'or-tt s48'),
        el('div', { class: 'chm' }, el('div', { class: 'l1' }, el('b', {}, r.type.label), qrTag(r)), el('div', { class: 'l2' }, ...numbersOf(r)), r.type.time ? el('div', { class: 'l2' }, r.type.time) : null),
        el('div', { class: 'tmx' }, el('b', {}, timeOf(r.when)), el('span', {}, dateOf(r.when)))),
      el('div', { class: 'or-cu' }, el('div', { class: 'cn' }, hl(r.who.l1, 'name')), r.who.l2 ? el('div', { class: 'cph' }, whoLine(r)) : null,
        c && (c.call || c.handover) ? el('div', { class: 'lc' }, ...codesLine({ who: { codes: { ...c, rider: '' } } })) : null, c?.rider ? el('div', { class: 'lc' }, `Rider arrival ${c.rider}`) : null),
      el('div', { class: 'or-mid' }, statusCellOf(r), payCellOf(r)),
      picking ? el('div', { class: 'or-c lock' }, r.lock ? el('span', { class: 'or-lock' }, r.lock) : null) : buttons(r));
  }
  function cardsLayout(v, search) {
    listEl = el('div', { class: 'or-cg', onscroll: e => { scrollTop = e.currentTarget.scrollTop; scrolledAt = Date.now(); } }, ...listItems(v, cardEl));
    const r1 = picking
      ? [titleEl(), slot(el('div', { class: 'or-pickbar' }, pickedPill(), selectAllBtn(v), pickHint(), el('span', { class: 'or-sp' }), cancelPick(), deletePick(), syncBtn('s54')), 'pick')]
      : [titleEl(), el('span', { class: 'or-gap10', 'aria-hidden': 'true' }), search, slot(el('div', { class: 'or-tools' }, clearBtn('or-clr2'), datePill('or-dd2'), syncBtn('s54')), 'tools')];
    return el('div', { class: `or-cards ${rowStyle()}${picking ? ' picking' : ''}`, 'data-kind': 'cards' }, slot(railEl(v), 'rail'),
      el('div', { class: 'or-cmain' }, el('div', { class: 'or-top3' }, el('div', { class: 'or-c1' }, ...r1),
        slot(el('div', { class: 'or-c2' }, ...filterPills('or-dd2'),
          el('button', { type: 'button', class: `or-dd or-dd2 or-sortd${menu === 'sort' ? ' open' : ''}`, 'aria-haspopup': 'menu', onclick: e => toggleMenu('sort', e.currentTarget) },
            el('span', { class: 'sl' }, 'Sort'), el('span', { class: 'or-dd-t' }, ...sortWords()), icon('sortDown', `ar${sortUp() ? ' up' : ''}`), el('span', { class: 'or-cv' }, icon('expand'))),
          totsBar(v, 'bar')), 'c2'), offlineNote(), slot(el('div', { class: 'or-mh-slot' }, matchHint()), 'mhint')),
      slot(listEl, 'list')));
  }

  // ---------- taps on a row, long-press to pick ----------
  let press = null, suppressTap = false;
  root.addEventListener('pointerdown', e => {
    suppressTap = false; // (a long-press's own tap is the only one passed over)
    const row = e.target.closest?.('.or-r,.or-li,.or-cd'); if (!row || e.target.closest('.or-bt') || e.button !== 0) return;
    press = { row, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => longPress(row), 550) };
  });
  const endPress = e => { if (press && (!e || e.pointerId === press.id)) { clearTimeout(press.timer); press = null; } };
  root.addEventListener('pointermove', e => { if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(e); });
  root.addEventListener('pointerup', endPress); root.addEventListener('pointercancel', endPress);
  function longPress(row) {
    press = null; suppressTap = true;
    const id = row.dataset.id, r = view().list.find(x => x.id === id);
    if (!picking) picking = new Set();
    if (r && !r.lock) picking.add(id);
    menu = null; render();
  }
  // Open: Due and Part paid orders in the Counter (Back comes back here); any other order its details page,
  // which comes later: its receipt until then (a delivery app's order: on the app's integration)
  function tapRow(r, open = false) {
    if (!picking && !open && viewKind() === 'split') { if (chosen !== r.id) { chosen = r.id; renderRest(); } return; }
    if (picking) {
      if (r.lock) { say({ text: `${r.lock.split(' · ')[0]} orders can’t be deleted` }); return; }
      if (picking.has(r.id)) picking.delete(r.id); else picking.add(r.id);
      render(); return;
    }
    if (r.pay.key === 'np' || r.pay.key === 'part') {
      if (r.type.platform) { say({ text: `${r.type.name} orders open with the ${r.type.name} integration` }); return; }
      returning = true; window.RestroCounter?.openOrder(r.id); return;
    }
    showReceipt(r.o);
  }

  // ---------- the buttons' jobs ----------
  async function printOrder(r) {
    if (typeof window.RestroCounter?.printSaved !== 'function') return;
    const res = await window.RestroCounter.printSaved(r.id, r.o);
    const what = res.kind === 'receipt' ? 'Receipt' : 'Bill';
    const look = paperLook();
    if (res.ok) say({ bold: `${what} ${res.reprint ? 'reprinted' : 'printed'}`, text: ` · Order ${ticket(r.o.number)}` });
    else if (res.why === 'number') say({ kind: 'error', bold: `${what} didn’t print`, text: ' · can’t reach the main system for its bill number', retry: () => printOrder(r) });
    else if (look === 'off') say({ kind: 'error', ic: 'printOff', bold: 'Bill printer offline', text: ' · check its power and cable', retry: () => printOrder(r) });
    else if (look === 'out') say({ kind: 'error', ic: 'printFill', bold: 'Bill printer is out of paper' });
    else say({ kind: 'error', bold: `${what} didn’t print`, text: ` · Order ${ticket(r.o.number)}`, retry: () => printOrder(r) });
    renderRest();
  }
  // Buzz: two steps (P02): "Buzzing pager 7… · ‹customer or table›, Order #15" while the Buzz button keeps a blue ring, then "Pager 7
  // buzzed" once the pager system confirms it (the short green bar under Buzz), or "didn't respond" with RETRY.
  // RESTRODevice.pager.buzz(number) resolves when the buzz is confirmed (ANDROID-BRIDGE.md).
  // (auto: the kitchen marked the order done; no "Buzzing…", and the result goes where it can be seen: notice)
  function buzzPager(r, auto = false) {
    const pager = window.RESTRODevice?.pager, n = r.buzz.no, show = auto ? notice : say;
    if (typeof pager?.buzz !== 'function') { if (!auto) say('Pagers start with the RESTRO Android app'); return; }
    if (flash.get(r.id) === 'buzzing') return;
    const who = [r.name || (r.dine ? r.who.l1.split(' · ')[0] : ''), `Order ${ticket(r.o.number)}`].filter(Boolean).join(', ');
    flash.set(r.id, 'buzzing'); if (!auto) say({ kind: 'busy', lead: 'Buzzing ', bold: `pager ${n}…`, text: ` · ${who}` });
    if (dialog.open) renderRest();
    const done = ok => {
      flash.delete(r.id);
      if (ok) { window.RestroCounter?.markBuzzed?.(r.id); show({ bold: `Pager ${n} buzzed`, text: ` · ${who}` }); }
      else { window.RestroCounter?.markBuzzFailed?.(r.id); show({ kind: 'error', bold: `Pager ${n} didn’t respond`, text: ' · check it’s charged and in range', retry: () => buzzPager(r, auto) }); }
      if (dialog.open) renderRest();
    };
    try { Promise.resolve(pager.buzz(Number(n))).then(res => done(res !== false), () => done(false)); } catch { done(false); }
  }
  // Ready (a delivery app's order): no "are you sure"; the app is told through its integration, then Marked. Offline it
  // can't go (P13); the app not answering is an error with RETRY (C8).
  async function markReady(r) {
    if (r.third.kind === 'marked') return;
    const app = r.type.name, nos = `${app} #${r.o.platformNo || ''} · Order ${ticket(r.o.number)}`, retry = () => markReady(r);
    if (!readOnline()) { say({ kind: 'error', ic: 'cloudOff', bold: `Offline · couldn’t send “Ready” to ${app}`, text: ` · Order ${ticket(r.o.number)}`, retry }); return; }
    const tell = window.RESTRODevice?.integrations?.markReady;
    let ok = true;
    if (typeof tell === 'function') { try { ok = (await tell({ platform: r.o.platform, id: r.o.platformNo || null, order: r.o.uid || null })) !== false; } catch { ok = false; } }
    if (!ok) { say({ kind: 'error', bold: `${app} didn’t receive “Ready”`, text: ` · ${nos}`, retry }); return; }
    window.RestroCounter?.markReady?.(r.id);
    say({ bold: `Order ready sent to ${app}`, text: ` · ${nos}` }); renderRest();
  }

  // ---------- the order-ready text and the buzz, by themselves (Update Pack 4; ANDROID-BRIDGE.md) ----------
  // When the kitchen screen marks an order complete (kitchenDoneAt), the customer gets the "Order ready" text, as
  // Settings › Orders says (SMS, WhatsApp falling back to SMS, or Off), when the order has their phone number, and the
  // order's pager buzzes when it has one out. The main system sends them, or a tablet working on its own, so each goes
  // out once however many tablets there are: the order keeps which Done mark was handled (readyAutoFor, and when:
  // readyAutoAt) before anything goes. Not for a delivery app's orders (they have Ready), nor for a Done mark over 30
  // minutes old (a main system that was off).
  // Once for each Done mark (owner, 13 Nov 2026): dishes added to an order that isn't paid yet, after it was ready, send
  // it back to the kitchen (its Done mark is cleared); when they are done, the text and the buzz go again. A paid order
  // can't take more dishes (it doesn't open on the Counter): more food is a new order, with its own number, and the pager
  // goes to that order.
  const AUTO_WITHIN = 30 * 60000;
  const sendsHere = () => { const s = window.RestroSync?.status?.(); return !s || Boolean(s.device?.main) || !s.paired; };
  async function textReady(r, how) {
    const res = await deliver(r, how, 'ready');
    if (res.none) return;
    notice(res.ok ? sentNote(r, 'ready', res.used) : failNote(r, res.used, () => textReady(r, how)));
    if (dialog.open) renderRest();
  }
  let autoBusy = false;
  async function autoReady() {
    if (autoBusy || !sendsHere()) return;
    autoBusy = true;
    try {
      const now = Date.now();
      for (const o of window.RestroCounter?.orders?.() || []) {
        const done = Number(o.kitchenDoneAt);
        if (!done || o.readyAutoFor === done || o.cancelledBy || PLATFORMS[o.platform] || now - done > AUTO_WITHIN || done > now + 60000) continue;
        const r = infoOf(o, now);
        if (!window.RestroCounter?.markAutoReady?.(r.id, done)) continue;
        const how = window.RestroPrefs?.get?.('readyMessage')?.send || 'sms';
        if (r.buzz.on && r.buzz.no) buzzPager(r, true);
        if (how !== 'off' && r.third.kind === 'notify' && r.third.on) await textReady(r, how);
      }
    } finally { autoBusy = false; }
  }
  window.addEventListener('restro:data-changed', e => { if ((e.detail?.collections || []).includes('orders')) autoReady(); });
  setInterval(autoReady, 15000); setTimeout(autoReady, 3000);

  // ---------- pop-ups ----------
  // Notify (OR-P01): the customer's name, phone, order and type · the message · Order ready / Bill / Running late
  // (Order scheduled first while a scheduled order's KOT waits) · WhatsApp / SMS. Through the RESTRO Android app
  // (RESTRODevice.whatsapp, RESTRODevice.sms; WhatsApp falls back to SMS). Sent: kept on the order (notifiedAt).
  function openNotify(r, btn) { pop = { kind: 'notify', id: r.id, from: 'nt', template: r.kot.look === 'q' ? 'scheduled' : 'ready', anchor: anchorOf(btn) }; renderLayer(); }
  function message(r, template) {
    const hi = r.name ? `Hi ${r.name}, ` : 'Hi, ', no = ticket(r.o.number), shop = shopName(), from = shop ? [' from ', shop] : [];
    const type = r.type.key;
    if (template === 'scheduled') { const at = r.o.readyAt, day = dayOf(at) === dayOf(Date.now()) ? 'today' : dayOf(at) === addDays(dayOf(Date.now()), 1) ? 'tomorrow' : `on ${shortDay(at)}`;
      return [hi, 'your order ', el('b', {}, no), ...from, ' is booked for ', el('b', {}, `${timeOf(at)} ${day}`), '. We’ll have it ready on time.']; }
    if (template === 'bill') return [hi, 'the bill for your order ', el('b', {}, no), ...from, ' is ', el('b', {}, money(Number(r.o.total) || 0)), '.'];
    if (template === 'late') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'running a little late'), '. We’ll message you as soon as it’s ready.'];
    if (type === 'dine-in') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready'), '.'];
    if (type === 'delivery') return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready'), ' and will be with you soon.'];
    return [hi, 'your order ', el('b', {}, no), ...from, ' is ', el('b', {}, 'ready for pickup'), '. Please show this message at the counter.'];
  }
  const plain = nodes => nodes.map(n => (typeof n === 'string' ? n : n.textContent)).join('');
  const sentWords = (r, template) => template === 'scheduled' ? `booked for ${timeOf(r.o.readyAt)}` : template === 'bill' ? 'bill' : template === 'late' ? 'running late'
    : ['dine-in', 'delivery'].includes(r.type.key) ? 'ready' : 'ready for pickup';
  // The message itself, with or without the pop-up: WhatsApp or SMS, WhatsApp falling back to SMS. { ok, used } once
  // tried ('whatsapp' · 'sms'); { none } when this tablet has no way to send messages.
  async function deliver(r, channel, template) {
    const text = plain(message(r, template)), dev = window.RESTRODevice, to = r.o.customer?.mobile, code = r.o.customer?.code || '91';
    const sms = typeof dev?.sms?.send === 'function', wa = typeof dev?.whatsapp?.send === 'function';
    if (!sms && !wa) return { none: true };
    const send = async how => { try { return (await (how === 'whatsapp' ? dev.whatsapp : dev.sms).send({ to, code, text, order: r.o.uid })) !== false; } catch { return false; } };
    let used = channel === 'whatsapp' && wa ? 'whatsapp' : sms ? 'sms' : null;
    let ok = used ? await send(used) : false;
    if (!ok && used === 'whatsapp' && sms) { used = 'sms'; ok = await send('sms'); }
    if (ok) window.RestroCounter?.markNotified?.(r.id); else window.RestroCounter?.markNotifyFailed?.(r.id);
    return { ok, used: used || channel };
  }
  // What the bar says once it went, and when it didn't (with RETRY)
  const sentNote = (r, template, used) => ({ bold: `Sent to ${r.name || 'the customer'} on ${used === 'whatsapp' ? 'WhatsApp' : 'SMS'}`, text: ` · Order ${ticket(r.o.number)} ${sentWords(r, template)}` });
  const failNote = (r, used, retry) => ({ kind: 'error', bold: `Couldn’t send the ${used === 'whatsapp' ? 'WhatsApp message' : 'SMS'} to ${r.name || 'the customer'}`,
    text: ` · Order ${ticket(r.o.number)} · ${used === 'whatsapp' ? 'WhatsApp' : 'the SMS service'} didn’t answer`, retry });
  async function sendNotify(r, channel, template = pop?.template || 'ready') {
    const dev = window.RESTRODevice;
    if (typeof dev?.sms?.send !== 'function' && typeof dev?.whatsapp?.send !== 'function') { say('Messages go through the RESTRO Android app'); return; }
    pop = null; renderLayer();
    const { ok, used } = await deliver(r, channel, template);
    say(ok ? sentNote(r, template, used) : failNote(r, used, () => sendNotify(r, channel, template)));
    renderRest();
  }
  function notifyCard(r) {
    const tpl = pop.template, queued = r.kot.look === 'q';
    const chip = (key, label) => el('button', { type: 'button', class: `or-tpl${tpl === key ? ' on' : ''}`, 'aria-pressed': String(tpl === key), onclick: () => { pop.template = key; renderLayer(); } }, label);
    return el('div', { class: 'or-pop notify', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Notify ${r.name || 'the customer'}` },
      el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Notify ${r.name || 'the customer'}`), el('p', {}, [r.phone, `Order ${ticket(r.o.number)}`, r.type.label].filter(Boolean).join(' · '))), closeX()),
      el('p', { class: 'or-msg-box' }, ...message(r, tpl)),
      el('div', { class: 'or-tpls' }, queued ? chip('scheduled', 'Order scheduled') : null, chip('ready', 'Order ready'), chip('bill', 'Bill'), chip('late', 'Running late')),
      el('div', { class: 'or-chs' },
        el('button', { type: 'button', class: 'or-ch wa', onclick: () => sendNotify(r, 'whatsapp') }, icon('chat'), 'WhatsApp'),
        el('button', { type: 'button', class: 'or-ch sm', onclick: () => sendNotify(r, 'sms') }, icon('sms'), 'SMS')));
  }
  // KOT (OR-P04 to P06): reprint only — every KOT of the order with its number, time and dishes, tick one or several
  // (Select all); a KOT that didn't print is ticked, in red, with why. A scheduled KOT still waiting (OS1): "Prints by
  // itself at 8:00 pm", its dishes, Keep schedule or Send now.
  function openKot(r, btn) {
    const k = window.RestroCounter?.kitchenOf?.(r.id); if (!k) return;
    const failed = k.kots.filter(x => x.failed);
    pop = { kind: r.kot.look === 'q' ? 'queued' : 'kot', id: r.id, from: 'kot', uid: r.id, k, picked: new Set(failed.map(x => x.id)), anchor: anchorOf(btn) };
    renderLayer();
  }
  const WHY = { paper: 'Kitchen printer was out of paper', offline: 'Kitchen printer was offline', cover: 'Kitchen printer’s cover was open' };
  const whoOf = r => (r.dine ? r.who.l1.split(' · ')[0] : r.name || r.type.label);
  function kotCard(r) {
    const { k, picked } = pop, failed = k.kots.filter(x => x.failed), shown = [...failed, ...k.kots.filter(x => !x.failed)];
    const tick = x => el('button', { type: 'button', class: `or-kotc${picked.has(x.id) ? ' on' : ''}${x.failed ? ' failed' : ''}`, role: 'checkbox', 'aria-checked': String(picked.has(x.id)),
      onclick: () => { if (picked.has(x.id)) picked.delete(x.id); else picked.add(x.id); renderLayer(); } },
    el('span', { class: `or-cb${picked.has(x.id) ? ' on' : ''}`, 'aria-hidden': 'true' }, picked.has(x.id) ? icon('check') : null),
    el('span', { class: 'or-kotc-t' }, el('b', {}, `KOT ${x.no}`, x.failed ? el('i', {}, ' · didn’t print') : null), el('small', {}, x.dishes)), el('span', { class: 'or-kotc-at' }, timeOf(x.at)));
    const n = picked.size, red = failed.length > 0 && n > 0 && [...picked].every(id => failed.some(f => f.id === id));
    const label = !n ? 'Reprint' : n === 1 ? `Reprint KOT ${k.kots.find(x => picked.has(x.id)).no}` : n === k.kots.length && n > 2 ? `Reprint all ${n} KOTs` : `Reprint ${n} KOTs`;
    const why = failed.length ? `${WHY[failed[0].why] || 'Kitchen printer didn’t answer'} — ${failed.length === 1 ? `KOT ${failed[0].no} didn’t print` : `${failed.length} KOTs didn’t print`}.` : '';
    return el('div', { class: 'or-pop kot', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Reprint KOT, ${whoOf(r)}` },
      el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Reprint KOT · ${whoOf(r)}`), el('p', {}, `Order ${ticket(r.o.number)} · ${r.type.label}`)), closeX()),
      why ? el('p', { class: 'or-why' }, icon('alert'), why) : null,
      el('p', { class: 'or-lab' }, failed.length || k.unsent.length ? 'Tick to reprint' : 'All dishes sent · tick to reprint',
        el('button', { type: 'button', class: 'or-link', onclick: () => { shown.forEach(x => picked.add(x.id)); renderLayer(); } }, 'Select all')),
      shown.length ? el('div', { class: 'or-kots' }, ...shown.map(tick)) : el('p', { class: 'or-none' }, 'Nothing has gone to the kitchen yet.'),
      el('button', { type: 'button', class: `or-go${red ? ' red' : ''}`, disabled: !n, onclick: () => runKot(r) }, icon('kot'), label));
  }
  // A scheduled KOT still waiting (OS1): when it prints by itself and why, its dishes, Keep schedule or Send now
  function queuedCard(r) {
    const { k } = pop, at = r.kot.at, ready = r.o.readyAt, mins = Math.round((ready - at) / 60000), other = dayOf(at) !== dayOf(Date.now());
    return el('div', { class: 'or-pop kot queued', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Scheduled KOT, ${whoOf(r)}` },
      el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Scheduled KOT · ${whoOf(r)}`), el('p', {}, `Order ${ticket(r.o.number)} · ${r.type.label} · ready by ${timeOf(ready)}`)), closeX()),
      el('div', { class: 'or-qwhen' }, el('span', { class: 'qi', 'aria-hidden': 'true' }, icon('clock')),
        el('div', {}, el('b', {}, `Prints by itself at ${timeOf(at)}${other ? ` on ${shortDay(at)}` : ''}`), el('span', {}, `${mins} min before ${timeOf(ready)} · kitchen prep time. Nothing to do.`))),
      el('p', { class: 'or-lab' }, 'Dishes on this KOT'),
      el('div', { class: 'or-unsent' }, ...k.unsent.map(l => el('p', {}, el('b', {}, `${l.qty} ×`), ` ${l.name}`, l.mods ? el('span', { class: 'mod' }, ` · ${l.mods}`) : null))),
      el('div', { class: 'or-chs' },
        el('button', { type: 'button', class: 'or-ch grey', onclick: () => { pop = null; renderLayer(); } }, 'Keep schedule'),
        el('button', { type: 'button', class: 'or-ch grey', onclick: () => sendNow(r) }, icon('kot'), 'Send now')));
  }
  async function sendNow(r) {
    const uid = pop.uid; pop = null; renderLayer();
    const res = await window.RestroCounter?.sendKitchen?.(uid); if (!res) return;
    if (res.ok) say({ bold: `KOT ${res.no} sent`, text: ` · Order ${ticket(r.o.number)}` });
    else {
      const kot = window.RestroCounter?.kitchenOf?.(uid)?.kots?.find(x => x.no === res.no);
      const again = async () => { const rr = kot ? await window.RestroCounter.reprintKots(uid, [kot.id]) : { ok: false }; if (rr.ok) say({ bold: `KOT ${res.no} sent`, text: ` · Order ${ticket(r.o.number)}` }); else say({ kind: 'error', bold: 'Kitchen printer offline', text: ` · KOT ${res.no} didn’t print · Order ${ticket(r.o.number)}`, retry: again }); render(); };
      say({ kind: 'error', bold: 'Kitchen printer offline', text: ` · KOT ${res.no} didn’t print · Order ${ticket(r.o.number)}`, retry: again });
    }
    render();
  }
  async function runKot(r) {
    const { picked, uid, k } = pop, ids = [...picked], no = ticket(r.o.number);
    pop = null; renderLayer();
    if (!ids.length) return;
    const res = await window.RestroCounter.reprintKots(uid, ids);
    if (res.ok) say({ bold: ids.length === 1 ? `KOT ${k.kots.find(x => x.id === ids[0])?.no ?? ''} reprinted` : `${ids.length} KOTs reprinted`, text: ` · Order ${no}` });
    else say({ kind: 'error', bold: `${res.failed.length === 1 ? `KOT ${res.failed[0].no}` : `${res.failed.length} KOTs`} didn’t print`, text: ` · ${WHY[res.failed[0].why] || 'Kitchen printer didn’t answer'}`, retry: () => openKotById(r.id) });
    render();
  }
  function openKotById(id) { const r = view().list.find(x => x.id === id); const btn = dialog.querySelector(`[data-id="${CSS.escape(id)}"] .or-b.kot`); if (r) openKot(r, btn); }
  // Delete (picked orders, OR-P11): "Delete 3 orders?" · what the kitchen gets · Reason (required) first · the six
  // reasons this restaurant gives most (learned: the list "@delete", published every 15 days) · Clear ..... the red
  // button. (PIN required for staff without the delete access comes with access levels.)
  const learned = id => { try { const kept = JSON.parse(localStorage.getItem('restro.quickNotes.v1') || 'null'), out = new Map(); for (const x of Array.isArray(kept?.lists?.[id]) ? kept.lists[id] : []) { const t = (typeof x === 'string' ? x : x?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t); } return [...out.values()]; } catch { return []; } };
  function deleteCard() {
    const rows = view().all.filter(r => pop.ids.includes(r.id)), n = rows.length, reached = rows.filter(r => kotsOf(r.o).length);
    const queued = rows.filter(r => !kotsOf(r.o).length && r.o.readyAt);
    const reasons = learned('@delete').slice(0, 6), reason = pop.reason;
    const input = el('input', { id: 'orders-reason', type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', placeholder: 'Type the reason here', 'aria-label': 'Reason' });
    input.value = reason;
    const line = el('label', { class: `or-line${reason ? '' : ' empty'}` }, icon('edit'), input);
    const go = el('button', { type: 'button', class: 'or-dgo2', disabled: !reason.trim(), onclick: () => confirmDelete() }, n === 1 ? 'Delete order' : `Delete ${n} orders`);
    const clear = el('button', { type: 'button', class: 'or-clear-t', disabled: !reason, onclick: () => { pop.reason = ''; input.value = ''; sync(); input.focus(); } }, 'Clear');
    const chips = reasons.map(x => el('button', { type: 'button', class: `or-rsn-c${reason.trim().toLowerCase() === x.toLowerCase() ? ' on' : ''}`, onclick: () => { pop.reason = x; input.value = x; sync(); } }, x));
    function sync() { line.classList.toggle('empty', !pop.reason); go.disabled = !pop.reason.trim(); clear.disabled = !pop.reason; chips.forEach((c, i) => c.classList.toggle('on', pop.reason.trim().toLowerCase() === reasons[i].toLowerCase())); }
    input.addEventListener('input', () => { pop.reason = input.value; sync(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const due = rows.reduce((s, r) => s + (Number(r.o.total) || 0), 0);
    const slip = reached.length === rows.length
      ? (n === 1 ? ['An ', el('b', {}, 'ORDER CANCELLED'), ' slip will print in the kitchen. This can’t be undone.'] : ['One ', el('b', {}, 'ORDER CANCELLED'), ' slip listing ', el('b', {}, `all ${n} orders`), ' and their KOTs will print in the kitchen. This can’t be undone.'])
      : reached.length ? `ORDER CANCELLED slip for ${reached.map(r => ticket(r.o.number)).join(', ')} will print · ${rows.filter(r => !reached.includes(r)).map(r => ticket(r.o.number)).join(', ')} wasn’t sent yet, nothing prints for ${rows.length - reached.length === 1 ? 'it' : 'them'}`
        : queued.length ? 'The kitchen hasn’t got this order yet, so nothing prints in the kitchen. The queued KOT is cancelled.' : 'Nothing has gone to the kitchen, so nothing prints there.';
    return el('div', { class: 'or-pop del', role: 'dialog', 'aria-modal': 'true', 'aria-label': n === 1 ? 'Delete order' : `Delete ${n} orders` },
      el('div', { class: 'or-del-head' }, el('i', { class: 'or-del-i', 'aria-hidden': 'true' }, el('span')), el('h3', {}, n === 1 ? `Delete order ${ticket(rows[0].o.number)}?` : `Delete ${n} orders?`),
        el('span', { class: 'or-del-sub' }, `${rows.map(r => ticket(r.o.number)).join(' · ')} · ${rupees(due)} due`), el('span', { class: 'or-sp' }), closeX()),
      el('p', { class: 'or-why del' }, icon('kot'), el('span', {}, ...[slip].flat())),
      el('p', { class: 'or-dlab' }, 'Reason (required)'), line,
      el('p', { class: 'or-dlab' }, 'Top reasons'),
      chips.length ? el('div', { class: 'or-rsn' }, ...chips) : el('p', { class: 'or-rsn-none' }, 'Your most-used reasons will show up here after 15 days.'),
      el('div', { class: 'or-pop-foot' }, clear, el('span', { class: 'or-sp' }), el('button', { type: 'button', class: 'or-dcancel2', onclick: () => { pop = null; renderLayer(); } }, 'Cancel'), go));
  }
  function confirmDelete() {
    const ids = pop.ids, reason = pop.reason.trim(); if (!reason) return;
    const rows = view().all.filter(r => ids.includes(r.id) && !r.lock), uids = rows.map(r => r.id);
    const res = window.RestroCounter?.deleteOrders?.(uids, reason) || { count: 0 };
    pop = null; picking = null; render();
    if (res.count) say({ bold: res.count === 1 ? 'Order deleted' : `${res.count} orders deleted`, text: ` · ${rows.map(r => ticket(r.o.number)).join(', ')}` });
  }
  // New paper roll? (OR-P08)
  function rollCard() {
    const p = pop;
    return el('div', { class: 'or-pop roll', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New paper roll?' },
      el('div', { class: 'or-roll-h' }, el('i', { 'aria-hidden': 'true' }, icon('print')), el('div', {}, el('h3', {}, 'New paper roll?'), el('p', {}, `The bill printer’s cover was opened · ${p.printer}`))),
      el('p', { class: 'or-msg-box' }, 'If you fitted a ', el('b', {}, 'new roll'), ', the paper level resets to ', el('b', {}, '100%'), ' on every tablet. If you only cleared a jam or checked it, choose ', el('b', {}, 'No'), ' and it keeps counting from ', el('b', {}, `${p.level}%`), '.'),
      el('div', { class: 'or-chs' },
        el('button', { type: 'button', class: 'or-ch no', onclick: () => { pop = null; renderLayer(); } }, 'No, same roll'),
        el('button', { type: 'button', class: 'or-ch sm', onclick: () => { pop = null; renderLayer(); try { window.RESTRODevice?.printer?.newRoll?.(); } catch {} setPaper({ level: 100, state: 'ok' }); say({ bold: 'New roll', text: ' · paper level 100%' }); } }, 'Yes, new roll')));
  }
  const closeX = () => el('button', { type: 'button', class: 'or-x', 'aria-label': 'Close', onclick: () => { pop = null; renderLayer(); } }, icon('close'));
  // A pop-up opened from a row's button sits beside it: its right edge 10 left of the button, level with the row
  function anchorOf(btn) {
    const group = btn?.closest?.('.or-bt') || btn, r = group?.getBoundingClientRect?.(), row = btn?.closest?.('.or-r,.or-li,.or-cd,.or-dt')?.getBoundingClientRect?.() || r, box = root.getBoundingClientRect();
    // (Classic, P01, P04, P05: a little above the row's middle, never higher than just under the table's heading)
    const classic = Boolean(btn?.closest?.('.or-r')), u = fu();
    return r ? { right: Math.max(16 * u, box.right - r.left + 38 * u), mid: (row.top + row.bottom) / 2 - box.top - (classic ? 52 * u : 0), min: classic ? 174 * u : 12 * u } : null;
  }
  const probe = el('span', { class: 'or-probe', 'aria-hidden': 'true' }), fu = () => (probe.offsetWidth / 100) || 1; // (the design's pixel, --fu)

  // ---------- menus: under their pill ----------
  function toggleMenu(key, btn) {
    menu = menu === key ? null : key; menuAt = btn ? btn.getBoundingClientRect() : null;
    if (menu === 'date') { const { from, to } = period(); datePick = { from, to, taps: 0, month: from.slice(0, 7) }; }
    render();
  }
  // ---------- the day or days (E1, E2): Today · Yesterday · Tomorrow, or a calendar; one tap a day, a second tap a
  // range; nothing changes until Show orders ----------
  let datePick = null;
  const shortOf = key => keyDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  function pickWords(p) {
    if (p.from === p.to) { const d = dayLabel(p.from); return [el('b', {}, ['Today', 'Yesterday', 'Tomorrow'].includes(d) ? `${d} · ${shortOf(p.from)}` : shortOf(p.from))]; }
    const a = keyDate(p.from), b = keyDate(p.to), n = Math.round((b - a) / 86400000) + 1, wd = d => d.toLocaleDateString('en-GB', { weekday: 'short' }), mon = d => d.toLocaleDateString('en-GB', { month: 'short' });
    // (on two lines when it doesn't fit beside the buttons: after the dash, or before the number of days)
    const start = a.getMonth() === b.getMonth() ? `${wd(a)} ${a.getDate()} –` : `${wd(a)} ${a.getDate()} ${mon(a)} –`;
    return [el('b', {}, start), ' ', el('b', { class: 'or-dend' }, `${wd(b)} ${b.getDate()} ${mon(b)}`), ' ', el('span', { class: 'nw or-ddays' }, el('span', { class: 'or-ddot' }, '· '), `${n} days`)];
  }
  // "Showing …": when the days go onto a line of their own, without the dot in front
  function showing(p) {
    const show = el('span', { class: 'or-dshow' }, 'Showing ', ...pickWords(p));
    requestAnimationFrame(() => {
      const end = show.querySelector('.or-dend'), days = show.querySelector('.or-ddays'); if (!show.isConnected || !end || !days) return;
      if (days.getBoundingClientRect().top > end.getBoundingClientRect().top + 2) show.classList.add('two');
    });
    return show;
  }
  function datePop() {
    const p = datePick, today = todayKey(), [y, m] = p.month.split('-').map(Number);
    const set = (from, to) => { datePick = { ...p, from, to, month: from.slice(0, 7) }; renderLayer(); };
    const opt = (key, name, sub) => { const on = p.from === key && p.to === key; return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `or-dopt${on ? ' on' : ''}`, onclick: () => set(key, key) },
      el('span', { class: `or-rd${on ? ' on' : ''}`, 'aria-hidden': 'true' }), el('span', { class: 'or-dopt-t' }, el('b', {}, name), el('small', {}, sub))); };
    const month = (yy, mm) => { datePick = { ...p, month: `${yy}-${String(mm).padStart(2, '0')}` }; renderLayer(); };
    const step = n => { const d = new Date(y, m - 1 + n, 1); month(d.getFullYear(), d.getMonth() + 1); };
    const tap = key => { const taps = p.taps || 0; if (taps % 2 === 0) datePick = { ...p, from: key, to: key, taps: taps + 1 }; else { const [a, b] = [p.from, key].sort(); datePick = { ...p, from: a, to: b, taps: taps + 1 }; } renderLayer(); };
    // the month: Monday first, the days around it greyed
    const first = new Date(y, m - 1, 1), lead = (first.getDay() + 6) % 7, cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(y, m - 1, 1 - lead + i), key = localDay(d), inMonth = d.getMonth() === m - 1;
      if (i >= 35 && !inMonth && d.getDate() <= 7 && i % 7 === 0) break;
      const ends = key === p.from || key === p.to, mid = p.from !== p.to && key > p.from && key < p.to;
      cells.push(el('button', { type: 'button', class: `or-day${inMonth ? '' : ' out'}${ends ? ' end' : ''}${mid ? ' mid' : ''}${p.from !== p.to && key === p.from ? ' first' : ''}${p.from !== p.to && key === p.to ? ' last' : ''}${key === today ? ' today' : ''}`,
        'aria-label': d.toDateString(), 'aria-pressed': String(ends), onclick: () => tap(key) }, el('span', {}, String(d.getDate()))));
    }
    const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('en-GB', { month: 'long' }));
    const sel = (value, opts, on) => el('label', { class: 'or-dsel' }, el('select', { onchange: e => on(Number(e.target.value)) }, ...opts.map(([v, t]) => { const o = el('option', { value: String(v) }, t); if (v === value) o.selected = true; return o; })), icon('expand'));
    const years = []; for (let yy = y - 3; yy <= y + 1; yy++) years.push([yy, String(yy)]);
    return el('div', { class: 'or-datepop', role: 'dialog', 'aria-label': 'Show orders for' },
      el('div', { class: 'or-dleft' }, el('p', { class: 'or-mh' }, 'SHOW ORDERS FOR'),
        opt(today, 'Today', shortOf(today)), opt(addDays(today, -1), 'Yesterday', shortOf(addDays(today, -1))), opt(addDays(today, 1), 'Tomorrow', `${shortOf(addDays(today, 1))} · scheduled`),
        el('p', { class: 'or-dhint' }, 'Or tap a date on the calendar. Tap two dates to see everything in between.')),
      el('div', { class: 'or-dright' },
        el('div', { class: 'or-dhead' }, sel(m, months.map((t, i) => [i + 1, t]), mm => month(y, mm)), sel(y, years, yy => month(yy, m)), el('span', { class: 'or-sp' }),
          el('button', { type: 'button', class: 'or-dnav', 'aria-label': 'Previous month', onclick: () => step(-1) }, icon('back')),
          el('button', { type: 'button', class: 'or-dnav', 'aria-label': 'Next month', onclick: () => step(1) }, icon('chevron'))),
        el('div', { class: 'or-dweek' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => el('span', {}, d))),
        el('div', { class: 'or-dgrid' }, ...cells),
        el('div', { class: 'or-dfoot' }, showing(p),
          el('button', { type: 'button', class: 'or-dcancel', onclick: () => { menu = null; datePick = null; render(); } }, 'Cancel'),
          el('button', { type: 'button', class: 'or-dgo', onclick: () => { range = p.from === today && p.to === today ? null : { from: p.from, to: p.to }; menu = null; datePick = null; scrollTop = 0; render(); } }, 'Show orders'))));
  }
  let menuAt = null;
  function menuView(v) {
    const items = [];
    const box = name => el('span', { class: 'ii' }, icon(name));
    const check = on => el('span', { class: `or-cb${on ? ' on' : ''}`, 'aria-hidden': 'true' }, on ? icon('check') : null);
    const row = (on, label, count, lead, pick, { role = 'menuitemcheckbox', sub = '' } = {}) => items.push(el('button', { type: 'button', role, 'aria-checked': String(on), class: `or-it${on ? ' on' : ''}`,
      onclick: () => { pick(); scrollTop = 0; render(); } }, lead, el('span', { class: 'or-it-t' }, label, sub ? el('small', {}, sub) : null), count != null ? el('em', {}, String(count)) : null));
    const sep = () => items.push(el('div', { class: 'or-sepm' }));
    let head = '', foot = '';
    if (menu === 'pay') {
      head = 'PAYMENT STATUS'; foot = 'Tick one or more · the order type shows which delivery app';
      row(false, 'All payments', v.all.length, check(false), () => { payF = new Set(); dueOnly = false; }); sep();
      PAYS.forEach(([key, label]) => row(payF.has(key), label, v.all.filter(r => r.pay.key === key).length, check(payF.has(key)), () => { dueOnly = false; if (payF.has(key)) payF.delete(key); else payF.add(key); payF = new Set(payF); }));
    } else if (menu === 'dv') {
      foot = 'Tap again to show all orders';
      [['disc', 'Discounted', 'tag'], ['void', 'Voided after KOT', 'void'], ['both', 'Discounted and voided', 'ready']].forEach(([key, label, ic]) =>
        row(dv === key, label, v.all.filter(r => key === 'disc' ? r.tags.disc : key === 'void' ? r.tags.void : r.tags.disc && r.tags.void).length, box(ic), () => { dv = dv === key ? null : key; }, { role: 'menuitemradio' }));
    } else if (menu === 'type') {
      // (Update Pack 5, K) Dine-in · Takeaway · Online · Phone call · Delivery · the delivery apps · QR: each order under
      // its own type (a mixed one under its first type only), and QR every order placed by QR, whatever its type
      head = 'ORDER TYPES'; foot = 'Tick one or more · QR shows every order placed by QR, Dine-in or Takeaway';
      row(false, 'All order types', v.all.length, check(false), () => { typesF = new Set(); }); sep();
      const apps = Object.keys(PLATFORMS), tick = key => () => { if (typesF.has(key)) typesF.delete(key); else typesF.add(key); typesF = new Set(typesF); };
      [...Object.keys(TYPES), ...apps].forEach(key => {
        const lead = el('span', { class: 'or-mi' }, check(typesF.has(key)), TYPES[key] ? el('span', { class: 'ii t', style: `background:${TYPES[key][2]}1A;color:${TYPES[key][2]}` }, icon(TYPES[key][1])) : el('span', { class: 'ii t', style: `background:${PLATFORMS[key][1]}1A` }, el('span', { class: 'or-logo', style: `background:${PLATFORMS[key][1]}` }, PLATFORMS[key][0][0])));
        row(typesF.has(key), TYPES[key]?.[0] || PLATFORMS[key][0], v.all.filter(r => r.type.key === key).length, lead, tick(key));
      });
      row(typesF.has('qr'), 'QR', v.all.filter(r => r.qr).length, el('span', { class: 'or-mi' }, check(typesF.has('qr')), el('span', { class: 'ii t qr' }, icon('qr'))), tick('qr'));
    } else if (menu === 'staff') {
      head = 'STAFF'; foot = 'Server on dine-in orders, cashier on the rest';
      const people = window.RestroStaff?.list?.() || [], names = [...new Set([...people.map(p => p.name), ...v.all.map(r => r.server).filter(Boolean)])];
      row(false, 'All staff', null, check(false), () => { staffF = null; }, { role: 'menuitemradio' }); sep();
      names.forEach(name => row(staffF === name, name, null, check(staffF === name), () => { staffF = staffF === name ? null : name; }, { role: 'menuitemradio', sub: people.find(p => p.name === name)?.roleName || '' }));
    } else if (menu === 'sort') {
      head = 'SORT BY'; foot = 'Customer / table · server can’t be sorted';
      for (const [key, name, choices] of SORTS) {
        const on = sort.key === key, i = on ? sortChoice() : 0;
        items.push(el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), class: `or-it or-sorti${on ? ' on' : ''}`, onclick: () => { if (!on) { setSort(key, 0); scrollTop = 0; render(); } } },
          el('span', { class: `or-rd${on ? ' on' : ''}`, 'aria-hidden': 'true' }), el('span', { class: 'or-it-t' }, name), on ? null : el('small', { class: 'or-def' }, choices[0])));
        if (on) items.push(el('div', { class: 'or-seg', role: 'group', 'aria-label': name }, ...choices.map((ch, k) => el('button', { type: 'button', class: k === i ? 'on' : '', 'aria-pressed': String(k === i),
          onclick: () => { setSort(key, k); scrollTop = 0; render(); } }, ch))));
      }
    }
    if (menu === 'date' && datePick) {
      // (E1–E8) Classic: under the sidebar, flush with the pill's left; Split: 14 in from the list pane's left edge;
      // Cards: flush with the right end of the toolbar
      const box3 = root.getBoundingClientRect(), at = menuAt, u = fu(), w = 840 * u, kind = viewKind();
      const pane = kind === 'split' ? root.querySelector('.or-pane')?.getBoundingClientRect() : null, tools = kind === 'cards' ? root.querySelector('.or-tools')?.getBoundingClientRect() : null;
      const x = !at ? 0 : kind === 'classic' ? at.left : pane ? pane.left + 14 * u : (tools ? tools.right : at.right) - w;
      const pop = datePop();
      pop.style.cssText = at ? `top:${at.bottom - box3.top + (kind === 'classic' ? 33 : kind === 'cards' ? 7 : 10) * u}px;left:${Math.max(16 * u, Math.min(box3.width - w - 16 * u, x - box3.left))}px` : '';
      return el('div', { class: 'or-menu-wrap', onclick: e => { if (e.target === e.currentTarget) { menu = null; datePick = null; render(); } } }, pop);
    }
    const keep = ['pay', 'type', 'staff', 'sort'].includes(menu); // (several can be ticked, or a choice under the row: the menu stays open)
    if (!keep) items.forEach(b => b.addEventListener('click', () => { menu = null; }, { capture: true }));
    const box2 = root.getBoundingClientRect(), at = menuAt, right = at ? at.right - box2.left : 0, u = fu();
    let style = at ? `top:${at.bottom - box2.top + 8 * u}px;${right > box2.width * .6 ? `right:${box2.right - at.right}px` : `left:${at.left - box2.left}px`}` : '';
    if (at && menu !== 'sort') requestAnimationFrame(() => fitMenu(at));
    // Sort (D4–D7): wider while Order status (three choices) is picked; in Split over the sort row, flush with the list
    // pane's edge; in Cards under the Sort pill, 52 left of its middle (as drawn)
    const wide = menu === 'sort' && sort.key === 'status', w = (wide ? 460 : 380) * u;
    if (menu === 'sort' && at) {
      const pane = root.querySelector('.or-pane')?.getBoundingClientRect();
      style = pane ? `top:${at.top - box2.top - 23 * u}px;left:${pane.right - box2.left + 4 * u - w}px;width:${w}px`
        : `top:${at.bottom - box2.top + 6 * u}px;left:${Math.max(12 * u, Math.min(box2.width - w - 12 * u, (at.left + at.right) / 2 - box2.left - w / 2 - 52 * u))}px;width:${w}px`;
    }
    return el('div', { class: 'or-menu-wrap', onclick: e => { if (e.target === e.currentTarget) { menu = null; render(); } } },
      el('div', { class: `or-menu m-${menu}`, role: 'menu', style }, head ? el('p', { class: 'or-mh' }, head) : null, ...items, foot ? el('p', { class: 'or-mf' }, foot) : null));
  }

  // A menu taller than the room under its pill moves up until it ends above the totals card (Classic) or 24 above the
  // bottom; never above the top of the app
  function fitMenu(at) {
    const m = layerEl?.querySelector('.or-menu'); if (!m) return;
    const box = root.getBoundingClientRect(), u = fu(), tot = root.querySelector('.or-tot3')?.getBoundingClientRect();
    const limit = (tot && tot.top > at.bottom ? tot.top - 36 * u : box.bottom - 24 * u) - box.top, h = m.offsetHeight, top = at.bottom - box.top + 8 * u;
    if (top + h > limit) m.style.top = `${Math.max(12 * u, limit - h)}px`;
  }

  // ---------- picking orders to delete (OR-P10): "3 selected", Select all / Unselect all, why some can't be picked,
  // Cancel and Delete 3 orders ----------
  function pickBar(v) {
    const can = v.shown.filter(r => !r.lock), n = picking.size, all = can.length > 0 && can.every(r => picking.has(r.id));
    return el('div', { class: 'or-pickbar' },
      el('span', { class: 'or-picked' }, `${n} selected`),
      el('button', { type: 'button', class: 'or-link', onclick: () => { if (all) can.forEach(r => picking.delete(r.id)); else can.forEach(r => picking.add(r.id)); render(); } }, all ? 'Unselect all' : 'Select all'),
      el('span', { class: 'or-hint' }, 'Paid and Swiggy/Zomato orders can’t be deleted'),
      el('span', { class: 'or-sp' }),
      el('button', { type: 'button', class: 'or-cancel', onclick: () => { picking = null; render(); } }, 'Cancel'),
      el('button', { type: 'button', class: 'or-del', disabled: !n, onclick: () => { if (n) { pop = { kind: 'delete', ids: [...picking], reason: '' }; renderLayer(); } } }, icon('trash'), n === 1 ? 'Delete 1 order' : `Delete ${n} orders`),
      syncBtn());
  }

  // ---------- drawing ----------
  // A whole view: Classic is the sidebar and, on the right, the search row (search · Clear filters · Sync, or the
  // picking bar) over the table. The search box is made once per full drawing and kept while the rest is redrawn.
  // (the parts redrawn around the search box while typing carry data-slot; the search box is never taken off the page)
  const slot = (node, name) => { node.dataset.slot = name; return node; };
  function layout(v, search) {
    const kind = viewKind();
    if (kind === 'split') return splitLayout(v, search);
    if (kind === 'cards') return cardsLayout(v, search);
    const top = picking ? [slot(pickBar(v), 'pick')] : [search, slot(el('div', { class: 'or-tools' }, clearBtn(), syncBtn()), 'tools')];
    return el('div', { class: `or-classic ${rowStyle()}${picking ? ' picking' : ''}`, 'data-kind': 'classic' }, slot(sideEl(v), 'side'),
      el('div', { class: 'or-main' }, el('div', { class: `or-srow${picking ? ' picking' : ''}` }, ...top), offlineNote(), slot(sheetEl(v), 'sheet')));
  }
  function render() {
    const v = view(); lastView = v;
    searchEl = searchBox(viewKind() === 'classic' ? '' : 'or-sb2');
    layerEl = el('div', { class: `or-layer${rowStyle() === 'pills' ? ' pills' : ''}` }); // (Floating pills: menus round off too)
    frame = layout(v, searchEl);
    root.replaceChildren(frame, layerEl, probe);
    fitLabels();
    if (listEl) listEl.scrollTop = scrollTop;
    fillLayer(v); watchEnd();
    if (msg && bar.parentElement !== dialog) dialog.append(bar);
  }
  // Everything but the search box: the parts around it are drawn again in place, so typing (and the keyboard) carries on
  function renderRest() {
    if (!frame || !searchEl?.isConnected || picking || frame.dataset.kind !== viewKind()) { render(); return; }
    const v = view(), next = layout(v, el('span')); lastView = v;
    frame.className = next.className;
    for (const part of next.querySelectorAll('[data-slot]')) frame.querySelector(`[data-slot="${part.dataset.slot}"]`)?.replaceWith(part);
    fitLabels();
    if (listEl) listEl.scrollTop = scrollTop;
    fillLayer(v); watchEnd();
  }
  function renderLayer() { if (!layerEl) { render(); return; } fillLayer(view()); }
  // (a payment status too long for its column is set smaller until it fits, as the designs do: "Partial refund - Card";
  // never under 15)
  function fitLabels() {
    for (const b of root.querySelectorAll('.or-c.pm .l1 b, .or-lr .l1 b')) {
      b.style.fontSize = '';
      const u = fu(), room = b.parentElement.clientWidth, need = b.scrollWidth;
      if (need > room + 0.5) { const fs = parseFloat(getComputedStyle(b).fontSize); b.style.fontSize = `${Math.max(15 * u, Math.floor((fs * (room - 6 * u) / need) * 4) / 4)}px`; }
    }
  }
  function fillLayer(v) {
    for (const b of root.querySelectorAll('.or-b.kot, .or-b.nt')) b.classList.toggle('opener', Boolean(pop?.anchor) && b.closest('[data-id]')?.dataset.id === pop.id && b.classList.contains(pop.from));
    const parts = [];
    if (menu) parts.push(menuView(v));
    if (pop) {
      const r = ['notify', 'kot', 'queued'].includes(pop.kind) ? v.all.find(x => x.id === pop.id) : null;
      const card = pop.kind === 'notify' && r ? notifyCard(r) : pop.kind === 'kot' && r ? kotCard(r) : pop.kind === 'queued' && r ? queuedCard(r) : pop.kind === 'delete' ? deleteCard() : pop.kind === 'roll' ? rollCard() : null;
      if (card) {
        if (pop.anchor) card.style.cssText = `right:${pop.anchor.right}px;--mid:${pop.anchor.mid}px;--min:${pop.anchor.min}px`;
        card.classList.toggle('anchored', Boolean(pop.anchor));
        // a tap outside closes Notify and KOT; the delete and paper-roll questions wait for an answer
        parts.push(el('div', { class: `or-scrim k-${pop.kind}`, onclick: e => { if (e.target === e.currentTarget && ['notify', 'kot', 'queued'].includes(pop.kind)) { pop = null; renderLayer(); } } }, card));
      } else pop = null;
    }
    layerEl.replaceChildren(...parts);
    if (pop?.anchor) requestAnimationFrame(placePop);
  }
  // (an anchored pop-up level with its row, kept inside the app)
  function placePop() {
    const card = layerEl?.querySelector('.or-pop.anchored'); if (!card) return;
    const box = root.getBoundingClientRect(), h = card.offsetHeight, mid = parseFloat(card.style.getPropertyValue('--mid')) || box.height / 2, pad = parseFloat(card.style.getPropertyValue('--min')) || 12 * fu();
    card.style.top = `${Math.max(Math.min(pad, box.height - h - 24 * fu()), Math.min(box.height - h - 24 * fu(), mid - h / 2))}px`;
  }

  // A paid order's receipt, over the list (its details page comes later): the order, the items, the sums and the payment
  let receipt = null;
  function closeReceipt() { if (!receipt) return false; receipt.remove(); receipt = null; return true; }
  function showReceipt(o) {
    closeReceipt();
    const r = infoOf(o, Date.now()), sub = Number.isFinite(o.subtotal) ? o.subtotal : o.lines.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0);
    const pct = window.RestroBill?.pct(o.discountPct) ?? null, split = Number.isFinite(o.cgst) && Number.isFinite(o.sgst);
    const gst = window.RestroBill?.labels(window.RestroMenu?.taxRate) || { cgst: 'CGST', sgst: 'SGST' };
    const rate = sub ? Math.round((o.tax / sub) * 1000) / 10 : 0, cash = (o.method || 'cash') === 'cash' && Number.isFinite(o.received);
    const row = (a, b, cls) => [el('dt', cls ? { class: cls } : {}, a), el('dd', cls ? { class: cls } : {}, b)];
    receipt = el('div', { class: 'or-scrim receipt', onclick: e => { if (e.target === e.currentTarget) closeReceipt(); } },
      el('div', { class: 'or-pop or-receipt', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Receipt, order ${ticket(o.number)}` },
        el('div', { class: 'or-pop-head' }, el('div', {}, el('h3', {}, `Receipt · Order ${ticket(o.number)}`), el('p', {}, [r.type.label, r.who.l1, `${dateOf(o.createdAt)} · ${timeOf(o.createdAt)}`].filter(Boolean).join(' · '))),
          el('button', { type: 'button', class: 'or-x', 'aria-label': 'Close', onclick: closeReceipt }, icon('close'))),
        el('ul', { class: 'or-rc-lines' }, ...o.lines.map(l => el('li', {},
          el('span', { class: 'q' }, `${l.qty} ×`), el('span', { class: 'n' }, l.name,
            Array.isArray(l.mods) && l.mods.length ? el('small', {}, l.mods.map(m => (m.price && !m.sets ? `${m.label} +₹${m.price}` : m.label)).join(' · ')) : null,
            window.RestroBill?.pct(l.off) ? el('small', {}, `${l.off}% off${l.off === 100 && l.offReason ? ` · ${l.offReason}` : ''}`) : null),
          el('span', { class: 'a' }, money(Math.round(l.price * 100) * l.qty))))),
        el('dl', { class: 'or-rc-sums' },
          ...row('Subtotal', money(sub)),
          ...(pct && Number.isFinite(o.discount) ? row(`Discount ${pct}%`, `−${money(o.discount)}`) : []),
          ...(o.servicePct && Number(o.service) ? row(`Service charge ${o.servicePct}% (optional)`, money(o.service)) : []),
          ...(Number(o.packaging) ? row('Packaging charge', money(o.packaging)) : []),
          ...(Number(o.delivery) ? row('Delivery charge', money(o.delivery)) : []),
          ...(split ? [...row(gst.cgst, money(o.cgst)), ...row(gst.sgst, money(o.sgst))] : row(rate ? `GST ${rate}%` : 'GST', money(o.tax || 0))),
          ...(Number(o.roundOff) ? row('Round off', `${o.roundOff < 0 ? '−' : '+'}${money(Math.abs(o.roundOff))}`) : []),
          ...row('Total', money(o.total), 'tot'),
          ...(cash ? [...row('Cash received', money(o.received)), ...row('Change given', money(o.change || 0))] : [])),
        el('p', { class: 'or-rc-paid' }, `${r.pay.text} · ${timeOf(Date.parse(o.paidAt) || o.createdAt)}`)));
    dialog.append(receipt);
    receipt.querySelector('.or-x')?.focus({ preventScroll: true });
  }

  // ---------- keeping up ----------
  // Orders saved, paid, held or deleted on another tablet (sync.js), a pager docked back: at once. While open, every 30
  // seconds for the kitchen minutes, unless a finger is scrolling or a menu or pop-up is open.
  window.addEventListener('restro:data-changed', e => { const names = e.detail?.collections || []; if (dialog.open && (names.includes('orders') || names.includes('held')) && !menu) renderRest(); });
  window.addEventListener('restro:pager-docked', () => { if (dialog.open && !menu) renderRest(); });
  // (Settings › Orders display: the view and the row style, chosen on any tablet of the branch)
  window.addEventListener('restro:prefs-changed', e => { if (e.detail?.name === 'orders' && dialog.open) render(); });
  let timer = null;
  dialog.addEventListener('close', () => {
    clearInterval(timer); timer = null; closeReceipt();
    // leaving the app resets the filters; opening an order (and coming back) keeps them
    if (!returning) { resetFilters(); fromCounter = false; }
    menu = null; pop = null; picking = null; if (msg) { clearTimeout(msg.timer); msg = null; paintMsg(); }
  });
  window.addEventListener('restro:screen-locked', () => { returning = false; resetFilters(); if (dialog.open) render(); });
  window.addEventListener('restro:staff-signed-in', () => { returning = false; resetFilters(); if (dialog.open) render(); });
  // Back: closes a menu, a pop-up or the receipt first; picking stops; then to Counter when Orders was opened from there
  // (the tablet's Back comes here through RestroSystem.back; Escape on a keyboard through the dialog's cancel)
  function goBack() {
    if (!dialog.open) return false;
    if (closeReceipt()) return true;
    if (menu || pop || picking) { menu = null; pop = null; picking = null; render(); return true; }
    if (!fromCounter || !window.RestroCounter) return false;
    fromCounter = false; returning = false; window.RestroCounter.resume(); return true;
  }
  dialog.addEventListener('cancel', event => { if (goBack()) event.preventDefault(); });

  // Toasts from elsewhere show above this full-screen app (and go back to Counter, or home, after it closes).
  const toastNode = document.querySelector('#toast'), toastHome = toastNode?.parentElement;
  new MutationObserver(() => {
    if (!toastNode) return;
    if (dialog.open) dialog.append(toastNode);
    else if (toastNode.parentElement === dialog) (document.querySelector('#counter-dialog[open]') || toastHome).append(toastNode);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  // ---------- Settings › Orders display: a still picture of this page ----------
  // The page as it is now (today's orders, no search or filters) in a view and row style, for Settings' live previews.
  // With no orders yet: built-in sample orders (tables and amounts only: no names or phone numbers), and `sample` says
  // so. → { node, sample }
  function sampleOrders(now) {
    const m = n => now - n * 60000;
    const O = (n, mins, type, total, extra = {}) => ({ uid: `sample${n}`, number: n, type, table: '', guests: 0, customer: null, lines: [{ id: 'paneer-tikka', name: 'Paneer tikka', qty: 1, price: 260, type }],
      total: total * 100, createdAt: m(mins), sentAt: m(mins - 1), kitchenAt: m(mins - 1), kots: [{ id: `k${n}`, kind: 'kot', no: n, at: m(mins - 1), lines: [] }], ...extra });
    return [
      O(12, 4, 'phone', 2814),
      O(11, 9, 'dine-in', 4158, { table: 'T12', guests: 4 }),
      O(10, 16, 'delivery', 646, { method: 'card', paidAt: new Date(m(16)).toISOString() }),
      O(9, 25, 'takeaway', 1040, { kitchenDoneAt: m(6), method: 'upi', paidAt: new Date(m(24)).toISOString(), pager: 3, pagerOut: true }),
      O(8, 39, 'dine-in', 945, { table: 'T4', guests: 2 }),
      O(7, 47, 'phone', 819, { sentAt: null, kitchenAt: null, kots: [], readyAt: now + 63 * 60000, method: 'upi', paidAt: new Date(m(46)).toISOString() }),
      O(6, 52, 'takeaway', 1320, { kitchenDoneAt: m(29), method: 'cash', paidAt: new Date(m(50)).toISOString() }),
      O(5, 67, 'dine-in', 1848, { table: 'T7', guests: 3, kitchenDoneAt: m(37), method: 'cash', paidAt: new Date(m(32)).toISOString() }),
      O(4, 85, 'takeaway', 560, { kitchenDoneAt: m(62), method: 'card', paidAt: new Date(m(61)).toISOString() }),
      O(3, 96, 'dine-in', 1210, { table: 'T2', guests: 2, kitchenDoneAt: m(66), method: 'upi', paidAt: new Date(m(58)).toISOString() })];
  }
  function preview({ view: vk = 'classic', rows = 'classic' } = {}) {
    const keep = { tab, query, payF, dv, typesF, staffF, dueOnly, sort, range, menu, picking, pop, chosen, listEl, scrollTop, flash };
    tab = 'all'; query = ''; payF = new Set(); dv = null; typesF = new Set(); staffF = null; dueOnly = false; sort = SORT0; range = null; menu = null; picking = null; pop = null; flash = new Map(); scrollTop = 0;
    lookOverride = { view: vk, rows };
    try {
      let vv = view(); const sample = !vv.all.length;
      if (sample) { const now = Date.now(); sampleRows = sampleOrders(now).map(o => infoOf(o, now)); vv = view(); }
      const node = el('div', { class: 'or-root' }, layout(vv, searchBox(vk === 'classic' ? '' : 'or-sb2')));
      for (const n of node.querySelectorAll('[id]')) n.removeAttribute('id');
      return { node, sample };
    } finally {
      lookOverride = null; sampleRows = null;
      ({ tab, query, payF, dv, typesF, staffF, dueOnly, sort, range, menu, picking, pop, chosen, listEl, scrollTop, flash } = keep);
    }
  }

  window.RestroOrders = Object.freeze({
    preview,
    // open() from the home screen (or Back from an order opened here: the filters as they were); open({ from: 'counter' })
    // from Counter's Orders button; open({ find: id }) for one order (a pager tapped on the NFC spot: its order number
    // searched, on its day).
    open(options = {}) {
      const back = returning && !options.from && !options.find;
      returning = false;
      document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
      if (!back) { resetFilters(); fromCounter = options.from === 'counter'; older.days.clear(); older.orders.clear(); older.more = true; }
      const found = options.find ? (window.RestroCounter?.orders?.() || []).find(o => (o.uid || `n${o.number}`) === options.find) : null;
      if (found) { query = String(found.number); const d = dayOfOrder(found); range = d === todayKey() ? null : { from: d, to: d }; }
      dialog.dataset.view = 'orders';
      trackOnline(); watchPaper(); render();
      if (!dialog.open) dialog.showModal();
      clearInterval(timer); timer = setInterval(() => { if (dialog.open && !menu && !pop && Date.now() - scrolledAt > 2000) renderRest(); }, 30000);
      dialog.querySelector('#orders-title')?.focus({ preventScroll: true });
      if (waiting) { const m = waiting; waiting = null; say(m); }
    },
    // A failure of the order-ready text or buzz that no one saw yet, for the Counter's bar when it opens (taken once)
    takeNotice() { const m = waiting; waiting = null; return m; },
    // An order's status as this page shows it ({ text: 'Open', 'Closed' or 'Cancelled', cls, sub, subCls }), for the
    // home screen
    status: o => { const s = statusOf(o); return { text: s.text, cls: s.cls.split(' ')[0], sub: s.base, subCls: s.subCls === 'rd' ? 'ready' : s.subCls === 'sch' ? 'scheduled' : s.base ? 'kitchen' : undefined }; },
    goBack
  });
})();
