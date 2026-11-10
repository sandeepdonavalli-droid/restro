'use strict';
// An order's sums, worked out the same way wherever an order is totalled: the Counter, an order merged from two tablets
// (sync.js) and the bills. All in paise, rounded half up to the paisa (Counter Update 7, CounterUpdate7.kt):
// 1. Each line: its price × quantity, less its dish discount (a percentage, 100 for a complimentary dish).
//    Subtotal = the lines after their dish discounts.
// 2. The order discount: a percentage of the subtotal (1 to 100).
// 3. The service charge (dine-in only, never automatic): a percentage of what is left after the discount.
// 4. The packaging charge (takeaway, delivery, phone: as set in Settings) and the delivery charge (delivery only).
// 5. GST on all of that, as CGST and SGST, half the rate each (5%: 2.5% + 2.5%), each rounded to the paisa.
// 6. The total to pay, rounded to the nearest rupee (50 paise and up go up); the difference is the round off.
(() => {
  // a / b rounded half up, in whole numbers (exact: no floating point on the way)
  const half = (a, b) => (a >= 0 ? Math.floor((2 * a + b) / (2 * b)) : -Math.floor((-2 * a + b) / (2 * b)));
  const pct = value => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null; };
  // A service charge rate: up to one decimal place (2.5%, 7.5%), above 0 and at most 20%
  const rate = value => { const n = Math.round(Number(value) * 10) / 10; return Number.isFinite(n) && n > 0 && n <= 20 ? n : null; };
  // Half the GST rate, in hundredths of a percent (0.05: 250, i.e. 2.5%)
  const halfOf = taxRate => Math.round((Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0) * 10000 / 2);
  const paise = rupees => Math.round((Number(rupees) || 0) * 100);
  // A line's dish discount in paise: its gross (price × quantity) × the percentage
  const lineOff = (gross, p) => (pct(p) ? half(gross * pct(p), 100) : 0);

  // o: { lines: [{ each (paise for one, add-ons in), qty, off (dish discount %) }], type, discountPct, servicePct,
  //      packaging, delivery (paise) }
  function order(o, taxRate) {
    const lines = Array.isArray(o?.lines) ? o.lines : [];
    let gross = 0, dishDiscount = 0, comp = 0;
    for (const l of lines) {
      const g = Math.round(Number(l.each) || 0) * (Number(l.qty) || 0), off = lineOff(g, l.off);
      gross += g; dishDiscount += off; if (pct(l.off) === 100) comp += off;
    }
    const subtotal = gross - dishDiscount, p = pct(o?.discountPct);
    const discount = p ? half(subtotal * p, 100) : 0, after = subtotal - discount;
    const sp = o?.type === 'dine-in' ? rate(o?.servicePct) : null;
    const service = sp ? half(after * Math.round(sp * 10), 1000) : 0;
    const packaging = o?.type && o.type !== 'dine-in' ? Math.max(0, Math.round(Number(o?.packaging) || 0)) : 0;
    const delivery = o?.type === 'delivery' ? Math.max(0, Math.round(Number(o?.delivery) || 0)) : 0;
    const taxable = after + service + packaging + delivery, h = halfOf(taxRate);
    const cgst = half(taxable * h, 10000), sgst = cgst, exact = taxable + cgst + sgst, total = half(exact, 100) * 100;
    return { gross, dishDiscount, complimentary: comp, subtotal, discountPct: p, discount, servicePct: sp, service, packaging, delivery, taxable, cgst, sgst, tax: cgst + sgst, exact, roundOff: total - exact, total };
  }
  // The earlier form (Counter Update 6): a subtotal, the order discount and the GST rate
  const totals = (subtotal, discountPct, taxRate) => order({ lines: [{ each: subtotal, qty: 1 }], discountPct }, taxRate);
  // "CGST 2.5%", "SGST 2.5%", "GST 5%" and the half rate "2.5%" for a GST rate (0.05)
  const labels = taxRate => { const h = `${halfOf(taxRate) / 100}%`; return { cgst: `CGST ${h}`, sgst: `SGST ${h}`, gst: `GST ${halfOf(taxRate) * 2 / 100}%`, half: h }; };
  // A charge as set in Settings › Billing & charges (prefs.js) for an order of this type, in paise. Packaging: a flat
  // amount for the order, or each dish's own (`packagingOf(id)`, rupees, set on the dish in Inventory) × its quantity.
  function charges(type, lines, billing, packagingOf = () => 0) {
    const pk = billing?.packaging, dl = billing?.delivery;
    let packaging = 0;
    if (pk?.on && type && type !== 'dine-in' && pk.types?.includes(type))
      packaging = pk.mode === 'dish' ? (lines || []).reduce((s, l) => s + paise(packagingOf(l.id)) * (Number(l.qty) || 0), 0) : paise(pk.flat);
    const delivery = dl?.on && type === 'delivery' ? paise(dl.flat) : 0;
    return { packaging, delivery };
  }
  window.RestroBill = Object.freeze({ pct, rate, order, totals, labels, charges, lineOff });
})();
