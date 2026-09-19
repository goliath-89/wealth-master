"use strict";
// Wealth Master — headline change and category totals (P5.2, docs/ui-redesign-plan.md)
//
// Two figures the Kubera-style headline needs, kept out of the render layer so the
// arithmetic is testable and cannot drift from what the Net worth screen draws.
//
// Both read the SAME net worth positions the screen and the sidebar read, rather than
// re-summing valuations. That is the whole point: the strip is a decomposition of the
// total above it, so it has to reconcile to it to the sen (AC-1). A holding left out of
// net worth because no rate converts it (FR-9.6) is left out here too, and named, rather
// than quietly landing in a category and making the strip disagree with the headline.
//
// Categories follow the agreed definitions (decision D1/D2):
//   Free Cash    cash-class accounts flagged liquid
//   Investments  investment-class accounts, plus cash-class accounts marked illiquid
//                (a fixed deposit you cannot break is not spendable cash)
//   Retirement   retirement-class accounts — EPF, PRS
//   Use assets   physical assets at full value; equity against a linked loan is a
//                per-asset view (nw.equityFor), never a category total, or the strip
//                would count the loan twice
//   Other        anything else, shown only when it holds something
//   Liabilities  every liability, reported positive and subtracted by the caller
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./networth.js"), require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (nw, ent) {

  var ASSET_CATEGORIES = [
    { key: "freeCash", label: "Free Cash" },
    { key: "investments", label: "Investments" },
    { key: "retirement", label: "Retirement" },
    { key: "useAssets", label: "Use assets" },
    { key: "other", label: "Other" }
  ];

  function holdingCategory(state, line) {
    var h = ent.byId(state.holdings, line.id);
    var acct = h ? ent.byId(state.accounts, h.accountId) : null;
    var cls = acct && acct.class ? acct.class : "other";
    if (cls === "cash") return line.liquid ? "freeCash" : "investments";
    if (cls === "investment") return "investments";
    if (cls === "retirement") return "retirement";
    return "other";
  }

  // The strip under the headline: one total per category at `period`, plus the figures it
  // must reconcile to. `reconciles` is part of the return rather than a test-only check —
  // a strip that does not add up to the total above it is a bug the screen should not hide.
  function categoryTotals(state, period) {
    var pos = nw.positionAt(state, period);
    var totals = {}, marks = {}, counts = {};
    ASSET_CATEGORIES.forEach(function (c) { totals[c.key] = 0; marks[c.key] = false; counts[c.key] = 0; });
    var liabilities = 0, liabilitiesPartial = false;

    pos.lines.forEach(function (line) {
      if (line.kind === "liability") {
        liabilities += line.balance;
        if (line.stale) liabilitiesPartial = true;
        return;
      }
      // Left out of net worth for want of a rate, so left out of the strip too.
      if (line.convertible === false) return;
      var key = line.kind === "asset" ? "useAssets" : holdingCategory(state, line);
      totals[key] += line.balance;
      counts[key] += 1;
      if (line.stale) marks[key] = true;
    });

    var categories = ASSET_CATEGORIES.filter(function (c) {
      // "Other" is a catch-all, not a fact about the portfolio: show it only when it holds
      // something. The four named categories always show, so a zero reads as "nothing here
      // yet" rather than as a category that has gone missing.
      return c.key !== "other" || totals.other !== 0;
    }).map(function (c) {
      return { key: c.key, label: c.label, total: totals[c.key], partial: marks[c.key], count: counts[c.key] };
    });

    var assets = categories.reduce(function (sum, c) { return sum + c.total; }, 0);
    return {
      period: pos.period,
      categories: categories,
      liabilities: liabilities,
      liabilitiesPartial: liabilitiesPartial,
      assets: assets,
      net: assets - liabilities,
      partial: pos.partial,
      unconverted: pos.unconverted,
      // To the sen: the strip is a decomposition of the headline, not a second opinion.
      reconciles: Math.abs(assets - pos.assets) < 0.005 &&
        Math.abs((assets - liabilities) - pos.net) < 0.005
    };
  }

  // Change over a window, for the headline's "1 month" and "1 year" figures.
  //
  // Returns null when the history is too short to answer, and the screen says so. A year
  // of history that is not there cannot be reported as RM 0 — that is the same mistake as
  // treating a blank balance as zero, one horizon up.
  function deltaOver(points, months) {
    if (!points || points.length < months + 1) return null;
    var later = points[points.length - 1];
    var earlier = points[points.length - 1 - months];
    var change = nw.changeBetween(earlier, later);
    return {
      months: months,
      from: earlier.period,
      to: later.period,
      delta: change.delta,
      pct: change.pct,
      // Either end resting on carried-forward figures makes the change less certain than
      // it looks, so the flag travels with it.
      partial: !!(earlier.partial || later.partial)
    };
  }

  return {
    categoryTotals: categoryTotals, deltaOver: deltaOver, ASSET_CATEGORIES: ASSET_CATEGORIES,
    holdingCategory: holdingCategory
  };
});
