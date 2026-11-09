'use strict';
// An order's sums (Counter Update 6), worked out the same way wherever an order is totalled: the Counter, an order
// merged from two tablets (sync.js) and the receipts. All in paise.
// - A discount is a percentage of the subtotal, 1 to 100, rounded to the paisa.
// - GST is charged on what is left (the taxable amount) as CGST and SGST, half the rate each (5%: 2.5% + 2.5%), each
//   rounded to the paisa.
// - The total to pay is rounded to the nearest rupee (50 paise and up go up); the difference is the round off printed
//   on the bill.
(() => {
  const pct = value => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null; };
  // Half the GST rate, in hundredths of a percent (0.05: 250, i.e. 2.5%)
  const halfOf = rate => Math.round((Number.isFinite(rate) && rate > 0 ? rate : 0) * 10000 / 2);
  function totals(subtotal, discountPct, taxRate) {
    const p = pct(discountPct), half = halfOf(taxRate);
    const discount = p ? Math.round(subtotal * p / 100) : 0, taxable = subtotal - discount;
    const cgst = Math.round(taxable * half / 10000), sgst = cgst, exact = taxable + cgst + sgst;
    const total = Math.round(exact / 100) * 100;
    return { subtotal, discountPct: p, discount, cgst, sgst, tax: cgst + sgst, roundOff: total - exact, total };
  }
  // "CGST 2.5%", "SGST 2.5%" for a GST rate (0.05)
  const labels = taxRate => { const half = `${halfOf(taxRate) / 100}%`; return { cgst: `CGST ${half}`, sgst: `SGST ${half}` }; };
  window.RestroBill = Object.freeze({ pct, totals, labels });
})();
