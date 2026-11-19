'use strict';
// The customer's bill and receipt, made in one place (Update Pack 7, H2: the e-receipt is "exactly the printed
// receipt"; owner, 18 Nov 2026: "the receipt should have the bill number and all details"):
// - the bill, receipt or refund slip the POS prints: Counter's Print bill, Orders' Bill / Receipt and the receipt at
//   the payment (counter.js; ANDROID-BRIDGE.md, printer.printBill, has every field);
// - the e-receipt a customer saves or has emailed from the QR page (customer-pages.js), drawn as the printed receipt
//   (Update Pack 7, 06_Receipts-and-KOT/ereceipt_*).
// Both are made from the order as the POS keeps it (restro.counter.orders.v1) by this file, so one order gives the same
// receipt on paper and on the phone: the same numbers, times, dishes, choices, discounts, charges, taxes and payments.
// Once the cloud is connected it makes the phone's copy of the order with copy() and the phone the receipt from it, as
// now (SYNC.md, "A table's QR").
//
// RestroReceipt.of(order, ctx): who and what it is for, its dishes and its sums (the POS's billOf)
//   order: { number, billNo, type, table, split, guests, customer: { name, mobile, code }, server, qr, event: { name,
//     table, floor }, lines: [{ name, price (one, rupees, add-ons in), qty, mods (option ids, or { label, price, sets }
//     as an order keeps them), note, off, offReason }], subtotal, discountPct, discount, servicePct, service, packaging,
//     delivery, taxes, cgst, sgst, tax, roundOff, total (paise, as bill.js works them out) }; without its sums they are
//     worked out from its lines (bill.js)
//   ctx: { restaurant, business (Settings › Business details), taxRate, taxLabel, tableName(id), modLabel(id),
//     formatPhone(number, country), staff (who is signed in: the server of an order not saved yet) }
// RestroReceipt.doc(order, kind, opts): the whole document: of(), what it is (kind 'bill' | 'receipt' | 'refund', and
//   its title), its date and time, the REPRINT box, every payment, what is still due, refunds; opts: ctx and { prints
//   (this kind's earlier prints of the order), pre (a bill before its number), rec (the order as saved, when `order` is
//   the one on the Counter's screen), by (who prints it), copy (the customer's own: never a REPRINT), now }
// RestroReceipt.payments(order, total, full): the order's payments, [{ method, amount (rupees), at, ref }]
// RestroReceipt.copy(order, ctx): the order as its customer may have it (the QR page): what its receipt needs and no
//   more (no kitchen notes, no staff but the server's first name, no history)
// RestroReceipt.draw(doc, opts): Promise<canvas>, the e-receipt as a picture 808 px wide, black on white
(() => {
  const TYPE = { 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', phone: 'Phone call', event: 'Event', online: 'Online' };
  const SERVICE_FOOTER = 'Service charge is optional — ask us to remove it.';
  // (Update Pack 5: a QR order's own methods; paid by QR and not matched yet, H1: "QR")
  const PAID_AS = { cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', swiggy: 'Swiggy', zomato: 'Zomato' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ticket = n => `#${String(n).padStart(2, '0')}`;
  const billLabel = no => (no ? `B-${no}` : null);
  const usesTable = o => Boolean(o.table) && (o.type === 'dine-in' || (Boolean(o.type) && o.split));
  const firstOf = name => (typeof name === 'string' ? name.trim().split(/\s+/)[0] : '') || '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // (a customer's phone: the country code, then 5 + 5 digits, "+91 9xxxx xxxxx" (Update Pack 7, D3); as sent otherwise)
  const slipPhone = (m, code) => { const raw = String(m || '').trim(), d = raw.replace(/\s+/g, ''); return /^\d{10}$/.test(d) ? `+${code || '91'} ${d.slice(0, 5)} ${d.slice(5)}` : raw; };
  // (the restaurant's own phone, where My Profile's formatting isn't at hand: an Indian number as the POS prints it)
  const plainPhone = (number, country) => { const d = String(number || '').replace(/\D/g, ''); return d && (!country || country === 'IN') && d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : d; };
  // "7 Nov 2026 11:58 AM"
  const stamp = t => { const d = new Date(t), h = d.getHours(); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const timeOf = t => (Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : Date.parse(t) || 0);

  // A choice as it prints: "Extra gravy +₹40" (an add-on), "Half" (a choice that sets the price), "Less spicy"
  function choice(m, ctx) {
    if (typeof m === 'string') return ctx.modLabel?.(m) || m;
    if (!m || typeof m !== 'object') return '';
    const price = Number(m.price) || 0;
    return price && !m.sets ? `${m.label} +₹${price.toLocaleString('en-IN')}` : String(m.label || m.id || '');
  }
  // The order's sums (paise): its own, as the POS saved them with it; or worked out from its lines (bill.js)
  function sums(o, ctx) {
    if (['total', 'subtotal', 'roundOff', 'tax'].every(k => Number.isFinite(o[k])) && (Array.isArray(o.taxes) || Number.isFinite(o.cgst))) return o;
    const lines = (o.lines || []).map(l => ({ each: Number(l.price) * 100, qty: l.qty, off: l.off, rate: l.ev && Number.isFinite(Number(l.ev.gst)) ? Number(l.ev.gst) / 100 : undefined }));
    return window.RestroBill.order({ lines, type: o.type || 'dine-in', discountPct: o.discountPct, servicePct: o.servicePct, packaging: o.packaging, delivery: o.delivery }, ctx.taxRate);
  }

  // ---------- the document ----------
  // (25_printed-bill, Counter Update 7, for every kind of order; Update Pack 3, 7 D3, D4 and H2)
  function of(o, ctx = {}) {
    const t = sums(o, ctx), biz = ctx.business || {}, shop = String(ctx.restaurant || '').trim(), type = o.type || 'dine-in';
    const tableName = id => (id && (ctx.tableName?.(id) || id)) || '';
    // (CGST and SGST for each GST rate on the bill, lowest first: Update Pack 7 D4)
    const rates = (t.taxes?.length ? t.taxes : [{ rate: ctx.taxRate, cgst: t.cgst, sgst: t.sgst }]).map(x => ({ ...x, labels: window.RestroBill.labels(x.rate) }));
    const eventTable = o.type === 'event' && o.event?.table ? `Event table ${o.event.floor ? tableName(o.event.table) : o.event.table}` : '';
    return {
      // (the restaurant's name in capitals, as everywhere a customer sees it: owner)
      restaurant: shop && shop !== 'RESTAURANT NAME' ? shop.toLocaleUpperCase('en-IN') : '', address: biz.address || '', gstin: biz.gstin || '', fssai: biz.fssai || '',
      // (Update Pack 3: the restaurant's phone and email, printed under the address)
      phone: biz.phone ? (ctx.formatPhone || plainPhone)(biz.phone, biz.phoneCountry) || biz.phone : '', email: biz.email || '',
      number: o.number ? ticket(o.number) : null, at: Date.now(),
      type: TYPE[type], table: usesTable(o) ? tableName(o.table) : '', guests: o.guests || 0,
      // (Update Pack 7, H2) the server, printed by first name ("Server: ‹first name›"); an order placed by QR has none of
      // its own and says "QR order" there (qr); a takeaway, phone, delivery or event customer with their phone beside the
      // name ("‹customer› · +91 ‹phone›", D3); an event's name and its event table
      server: o.qr === true ? o.server || '' : o.server || ctx.staff || '', qr: o.qr === true,
      customer: !usesTable(o) && !eventTable && String(o.customer?.name || '').trim() ? { name: String(o.customer.name).trim(), phone: slipPhone(o.customer.mobile, o.customer.code) } : null,
      event: o.type === 'event' && o.event?.name ? String(o.event.name) : '', eventTable,
      // each dish with its choices under it and its dish discount as a minus line ("10% off −26.00", "100% off ·
      // Complaint −180.00"); its note is the kitchen's and doesn't print
      lines: (o.lines || []).map(l => {
        const each = Number(l.price) || 0, gross = each * l.qty * 100, off = window.RestroBill.lineOff(gross, l.off);
        return { name: l.name, qty: l.qty, each, total: each * l.qty, modifiers: (l.mods || []).map(m => choice(m, ctx)), note: l.note || '',
          ...(l.off ? { discount: { percent: l.off, reason: l.off === 100 ? l.offReason || '' : '', amount: off / 100, label: `${l.off}% off${l.off === 100 && l.offReason ? ` · ${l.offReason}` : ''}` } } : {}) };
      }),
      subtotal: t.subtotal / 100, discount: t.discountPct ? { label: `Discount ${t.discountPct}%`, percent: t.discountPct, amount: t.discount / 100 } : null,
      serviceCharge: t.servicePct ? { label: `Service charge ${t.servicePct}% (optional)`, percent: t.servicePct, amount: t.service / 100 } : null,
      packaging: t.packaging ? { label: 'Packaging charge', amount: t.packaging / 100 } : null, delivery: t.delivery ? { label: 'Delivery charge', amount: t.delivery / 100 } : null,
      taxes: rates.flatMap(x => [{ label: x.labels.cgst, amount: x.cgst / 100 }, { label: x.labels.sgst, amount: x.sgst / 100 }]), tax: t.tax / 100,
      taxLabel: rates.length > 1 ? 'GST' : rates[0]?.labels.gst || ctx.taxLabel,
      roundOff: t.roundOff / 100, total: t.total / 100,
      footer: [t.servicePct ? SERVICE_FOOTER : '', biz.footer || ''].filter(Boolean)
    };
  }

  // An order's payments, each { method, amount (rupees), at, ref } (Update Pack 7, H2 and I1: an order takes a payment
  // for each round paid by QR, and the rest at the Counter): `payments` on the order when it has them ({ method, amount
  // in paise, at, ref }); otherwise its one payment once paid (`paidAt`), the whole total; or what was paid of it in part
  // (`paidAmount`). A QR order staff saw paid and not matched yet, H1: "QR". `full`: a receipt, so paid in full.
  function payments(o, total, full) {
    if (!o) return [];
    const methodOf = (m, qr) => (qr ? 'QR' : PAID_AS[m] || (typeof m === 'string' && m ? m : 'Cash'));
    const atOf = t => (Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : Date.parse(t) || Date.now());
    if (Array.isArray(o.payments) && o.payments.length)
      return o.payments.filter(p => p && Number(p.amount) > 0).map(p => ({ method: methodOf(p.method), amount: Math.round(Number(p.amount)) / 100, at: atOf(p.at), ref: typeof p.ref === 'string' ? p.ref : '' }));
    const qr = o.qr === true && o.qrPay === 'matching', ref = typeof o.payRef === 'string' ? o.payRef : '';
    if (o.paidAt || full) {
      const how = Array.isArray(o.methods) && o.methods.length > 1 ? o.methods.map(m => methodOf(m)).join(' + ') : methodOf(o.method, qr);
      return [{ method: how, amount: total, at: atOf(o.paidAt), ref }];
    }
    const part = Number(o.paidAmount);
    return part > 0 && part < Math.round(total * 100) ? [{ method: methodOf(o.method), amount: part / 100, at: atOf(o.paidAmountAt), ref }] : [];
  }
  // (Update Pack 7, E4) the dishes refunded by themselves as they sold out while the customer paid: `refunds` on the
  // order, [{ method, amount (paise), at, lines: [{ name, qty }] }]; a box of their own on the receipt, under the PAID
  // boxes (owner, 18 Nov 2026)
  const refundsOf = o => (Array.isArray(o?.refunds) ? o.refunds : []).filter(r => r && Number(r.amount) > 0)
    .map(r => ({ method: PAID_AS[r.method] || (typeof r.method === 'string' ? r.method : ''), amount: Math.round(Number(r.amount)) / 100, at: timeOf(r.at) || Date.now(),
      lines: (Array.isArray(r.lines) ? r.lines : []).filter(l => l && l.name).map(l => ({ name: String(l.name), qty: Number(l.qty) || 1 })) }));

  // Update Pack 3 (04_Printed-slips): the first print of a bill, and of a receipt, is plain; every later print of the
  // same one has a REPRINT box at the top ("Reprinted 7 Nov 2026 12:20 PM · by ‹first name›"). The receipt after
  // payment is a document of its own: TAX INVOICE · RECEIPT, with a PAID box for each payment (the time and the
  // payment's reference). Bill number "At payment" (Update Pack 4): a bill before the payment is "BILL · NOT A TAX
  // INVOICE", with no number (pre).
  function doc(o, kind, opts = {}) {
    const { prints = [], pre = false, rec = null, by = '', copy = false } = opts, now = opts.now || Date.now(), src = rec || o;
    const same = prints.filter(p => (p?.tax === false) === pre), last = same.length && !copy ? { at: now, by } : null;
    // (its date and time: a bill's first print; a receipt the bill's when a bill (a tax invoice) was printed first, as
    // PS01 draws it, otherwise when it was paid (owner, 18 Nov 2026: the real times, the same on paper and on the
    // phone, however late it prints); a reprint keeps it)
    const billAt = kind === 'receipt' && Array.isArray(rec?.bills) ? Number(rec.bills.find(b => b && b.tax !== false)?.at) || 0 : 0;
    const paidAt = kind === 'receipt' ? timeOf(src.paidAt) : 0;
    const bill = { ...of(o, opts), kind, title: kind === 'receipt' ? 'TAX INVOICE · RECEIPT' : kind === 'refund' ? 'REFUND · NOT A TAX INVOICE' : pre ? 'BILL · NOT A TAX INVOICE' : 'TAX INVOICE',
      at: billAt || paidAt || Number(same[0]?.at) || now, reprint: last };
    // (a saved order placed by QR, H2: "QR order" where the server goes, and no staff's name of its own)
    if (rec) { bill.qr = rec.qr === true; if (bill.qr) bill.server = rec.server || ''; }
    // (Update Pack 7, H2) one PAID box per payment, and under them, while the order is part paid, the black DUE box
    if (kind !== 'refund') {
      const pays = payments(src, bill.total, kind === 'receipt'), paid = pays.reduce((s, p) => s + Math.round(p.amount * 100), 0);
      bill.payments = pays; bill.due = pays.length && paid < Math.round(bill.total * 100) ? (Math.round(bill.total * 100) - paid) / 100 : 0;
    }
    // (a QR order cancelled and refunded: a boxed "REFUNDED ₹1,260" where PAID goes, with when it was cancelled; its
    // method once the cloud has refunded it: "REFUNDED · UPI ₹1,260")
    if (kind === 'refund' && rec) bill.refunded = { method: rec.refundedAt ? PAID_AS[rec.refundMethod] || PAID_AS[rec.method] || '' : '', amount: bill.total, at: Number(rec.qrChoice?.at) || Date.parse(rec.refundedAt) || now };
    const back = kind === 'refund' ? [] : refundsOf(src); if (back.length) bill.refunds = back;
    bill.bill = billLabel(pre ? null : src.billNo || o.billNo);
    return bill;
  }

  // ---------- the order as its customer may have it (the QR page) ----------
  // The receipt's part of the order and nothing more: no kitchen notes, no history, no staff but the server's first
  // name; its table and event table by name; each choice as it prints. ctx: { tableName(id), modLabel(id) }.
  function copy(o, ctx = {}) {
    const name = id => (id && (ctx.tableName?.(id) || id)) || '';
    const keep = (from, keys) => Object.fromEntries(keys.filter(k => from[k] != null).map(k => [k, from[k]]));
    return {
      ...keep(o, ['uid', 'number', 'billNo', 'billYear', 'type', 'split', 'guests', 'subtotal', 'discountPct', 'discount', 'servicePct', 'service', 'packaging', 'delivery', 'taxes', 'cgst', 'sgst', 'tax',
        'roundOff', 'total', 'paidAt', 'method', 'methods', 'qrPay', 'payRef', 'paidAmount', 'paidAmountAt', 'createdAt']),
      table: o.table ? name(o.table) : '', server: firstOf(o.server), qr: o.qr === true,
      ...(o.type === 'event' && o.event ? { event: { name: String(o.event.name || ''), table: o.event.table ? String(o.event.floor ? name(o.event.table) : o.event.table) : '' } } : {}),
      // (the customer only where the receipt prints them: not on a table's or an event table's order)
      customer: !usesTable(o) && !(o.type === 'event' && o.event?.table) && o.customer?.name ? { name: String(o.customer.name), mobile: String(o.customer.mobile || ''), ...(o.customer.code ? { code: String(o.customer.code) } : {}) } : null,
      lines: (Array.isArray(o.lines) ? o.lines : []).filter(l => l && Number(l.qty) > 0).map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty,
        ...(l.mods?.length ? { mods: l.mods.map(m => (typeof m === 'string' ? choice(m, ctx) : { label: m.label, price: Number(m.price) || 0, ...(m.sets ? { sets: true } : {}) })) } : {}),
        ...(l.off ? { off: l.off, ...(l.offReason ? { offReason: l.offReason } : {}) } : {}), ...(l.ev ? { ev: { gst: l.ev.gst } } : {}) })),
      payments: (Array.isArray(o.payments) ? o.payments : []).filter(p => p && Number(p.amount) > 0).map(p => ({ method: p.method, amount: Number(p.amount), at: p.at, ref: typeof p.ref === 'string' ? p.ref : '' })),
      bills: (Array.isArray(o.bills) ? o.bills : []).filter(Boolean).map(b => ({ at: b.at, ...(b.tax === false ? { tax: false } : {}) })),
      receipts: (Array.isArray(o.receipts) ? o.receipts : []).filter(Boolean).map(r => ({ at: r.at })),
      ...(Array.isArray(o.refunds) && o.refunds.length ? { refunds: o.refunds } : {})
    };
  }

  // ---------- the e-receipt (Update Pack 7, H2: 06_Receipts-and-KOT/ereceipt_*) ----------
  // Inter, black on white, 808 wide; sizes and spacing as drawn. The parts in the printed receipt's order: the
  // restaurant, its address, phone · email and GSTIN · FSSAI; the title; "Bill #B-45 · Order #07" and the date; the order
  // type, table, guests or the customer and their phone, with "Server: ‹first name›" or "QR order"; the dishes with
  // their choices and dish discounts under them; the sums; GRAND TOTAL; a box for each payment, each refund, the DUE box;
  // the footer. A REPRINT box is for paper only: the customer's copy is never one.
  async function draw(b, opts = {}) {
    const FAM = opts.font || '"CP Receipt", Inter, "DM Sans", sans-serif';
    try { await Promise.all([400, 700].map(w => document.fonts.load(`${w} 25px ${FAM}`, 'A₹'))); } catch {}
    const W = 808, P = 40, INK = '#111111', F = (w, px) => `${w} ${px}px ${FAM}`;
    const cv = document.createElement('canvas'), c = cv.getContext('2d');
    const width = (s, font) => { c.font = font; return c.measureText(s).width; };
    // (too wide: a name smaller, anything else cut with "…")
    const fitFont = (s, w, px, max) => { const k = width(s, F(w, px)); return k > max ? F(w, Math.floor(px * max / k * 10) / 10) : F(w, px); };
    const cut = (s, font, max) => { if (width(s, font) <= max) return s; let t = s; while (t.length > 1 && width(`${t}…`, font) > max) t = t.slice(0, -1); return `${t.trimEnd()}…`; };
    // (onto lines no wider than `first`, then `next`: at spaces, or between the parts of a " · " line)
    const wrap = (s, font, first, next = first, sep = ' ') => {
      const out = []; let line = '';
      for (const w of String(s).split(sep)) {
        const t = line ? `${line}${sep}${w}` : w;
        if (!line || width(t, font) <= (out.length ? next : first)) { line = t; continue; }
        out.push(line); line = w;
      }
      if (line) out.push(line);
      return out.map((l, i) => cut(l, font, i ? next : first));
    };
    const money = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), rupees = n => `₹${n.toLocaleString('en-IN')}`;
    const run = paint => {
      let y = 0;
      const text = (s, x, base, font, align = 'left', color = INK) => { if (!paint) return; c.font = font; c.textAlign = align; c.fillStyle = color; c.fillText(s, x, base); };
      const mid = (s, font, gap) => { y += gap; text(s, W / 2, y, font, 'center'); };
      // (a line: its words on the left, wrapping under themselves (from `indent`) when they don't fit; the amount on the
      // right of the first; on a baseline `gap` below the last, wrapped lines `step` apart)
      const lr = (a, b, font, gap, step = 36, indent = 0, sep = ' ') => {
        y += gap; const room = W - 2 * P - (b ? width(b, font) + 24 : 0), lines = wrap(a, font, room, W - 2 * P - indent, sep);
        lines.forEach((s, i) => { if (i) y += step; text(s, P + (i ? indent : 0), y, font); });
        if (b) text(b, W - P, y - step * (lines.length - 1), font, 'right');
      };
      // (dashes between the parts: 12 long, 4 thick every 20; 6 thick every 18 above the grand total; y is its top)
      const dash = (gap, h = 4, every = 20) => { y += gap; if (paint) { c.fillStyle = INK; for (let x = P; x < W - P; x += every) c.fillRect(x, y, Math.min(12, W - P - x), h); } };
      // (a box 116 tall: PAID, REFUND and REFUNDED with a 4 px line; DUE filled black)
      const box = (a, s, dark, gap) => {
        y += gap;
        if (paint) { c.fillStyle = INK; if (dark) c.fillRect(P, y, W - 2 * P, 116); else { c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(P + 2, y + 2, W - 2 * P - 4, 112); } }
        text(cut(a, F(700, 32.5), W - 2 * P - 40), W / 2, y + 50, F(700, 32.5), 'center', dark ? '#FFFFFF' : INK);
        text(cut(s, F(400, 25), W - 2 * P - 40), W / 2, y + 89.5, F(400, 25), 'center', dark ? '#FFFFFF' : INK); y += 116;
      };
      const f25 = F(400, 25), f26 = F(400, 26), f30 = F(400, 30);
      // the restaurant, its address, phone · email, GSTIN · FSSAI
      y = b.restaurant ? 85 : 43; if (b.restaurant) text(b.restaurant, W / 2, y, fitFont(b.restaurant, 700, 46, W - 2 * P), 'center');
      let g = 42;
      for (const h of [b.address, [b.phone, b.email].filter(Boolean).join(' · '), [b.gstin ? `GSTIN ${b.gstin}` : '', b.fssai ? `FSSAI ${b.fssai}` : ''].filter(Boolean).join(' · ')].filter(Boolean)) {
        wrap(h, f25, W - 2 * P).forEach((s, i) => mid(s, f25, i ? 33.5 : g)); g = 36.5;
      }
      dash(36.5);
      mid(b.title || 'TAX INVOICE', F(700, 30.4), 58);
      lr([b.bill ? `Bill #${b.bill}` : '', b.number ? `Order ${b.number}` : ''].filter(Boolean).join(' · ') || 'Bill', stamp(b.at), f25, 39.5);
      // (a phone number never splits)
      lr([b.type, b.event, b.table ? `Table ${b.table}` : b.eventTable, b.guests ? plural(b.guests, 'guest') : '', b.customer?.name, b.customer?.phone ? b.customer.phone.replace(/ /g, ' ') : ''].filter(Boolean).join(' · '),
        b.server ? `Server: ${firstOf(b.server)}` : b.qr ? 'QR order' : '', f25, 39.5, 33.5, 0, ' · ');
      dash(33);
      // each dish: "2 × Paneer tikka" and its amount; its choices under it ("Half · Medium spicy"), then its discount
      let gap = 57;
      for (const l of b.lines) {
        const lead = width(`${l.qty} × `, f30);
        lr(`${l.qty} × ${l.name}`, money(l.total), f30, gap, 36, lead);
        if (l.modifiers?.length) wrap(l.modifiers.join(' · '), f26, W - 2 * P - 32).forEach(s => { y += 36; text(s, P + 32, y, f26); });
        if (l.discount) { y += 36; const a = `−${money(l.discount.amount)}`; text(cut(l.discount.label, f26, W - 2 * P - 32 - width(a, f26) - 24), P + 32, y, f26); text(a, W - P, y, f26, 'right'); }
        gap = 52;
      }
      dash(33);
      lr('Subtotal', money(b.subtotal), f30, 58);
      if (b.discount) lr(b.discount.label, `−${money(b.discount.amount)}`, f30, 52);
      for (const x of [b.serviceCharge, b.packaging, b.delivery]) if (x) lr(x.label, money(x.amount), f30, 52);
      for (const x of b.taxes || []) lr(x.label, money(x.amount), f30, 52);
      if (b.roundOff) lr('Round off', `${b.roundOff < 0 ? '−' : '+'}${money(Math.abs(b.roundOff))}`, f30, 52);
      dash(32, 6, 18);
      lr('GRAND TOTAL', rupees(b.total), F(700, 42.5), 68);
      dash(36);
      // a box for each payment, each refund (E4: "Sold out as you paid"), a cancelled order's refund; DUE under them
      let next = 28;
      for (const p of b.payments || []) { box(`PAID · ${p.method} ${rupees(p.amount)}`, [stamp(p.at), p.ref ? `Ref ${p.ref}` : ''].filter(Boolean).join(' · '), false, next); next = 20; }
      for (const r of b.refunds || []) { box(`REFUND${r.method ? ` · ${r.method}` : ''} ${rupees(r.amount)}`, 'Sold out as you paid · back in 3–5 days', false, next); next = 20; }
      if (b.refunded) { box(`REFUNDED${b.refunded.method ? ` · ${b.refunded.method}` : ''} ${rupees(b.refunded.amount)}`, `${stamp(b.refunded.at)} · Order cancelled`, false, next); next = 20; }
      if (b.due) box(`DUE ${rupees(b.due)}`, 'Pay on your phone or at the counter', true, next === 28 ? 28 : 16);
      // the footer: "Service charge is optional — ask us to remove it." (with one), then the bill footer
      g = 43; for (const f of b.footer || []) { wrap(f, f25, W - 2 * P).forEach((s, i) => mid(s, f25, i ? 33.5 : g)); g = 36.5; }
      return Math.ceil(y + 50);
    };
    cv.width = W; cv.height = run(false); c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, cv.height); run(true);
    return cv;
  }

  window.RestroReceipt = Object.freeze({ of, doc, payments, copy, draw, stamp, PAID_AS, SERVICE_FOOTER });
})();
