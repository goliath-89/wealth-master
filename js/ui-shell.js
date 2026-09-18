"use strict";
// Wealth Master — app shell (P5.1, docs/ui-redesign-plan.md)
//
// The sidebar answers "what am I worth" before any screen is opened: Net worth, assets and
// debts sit beside their navigation items, the way Kubera's sidebar does. The figures are
// read from the same net worth series the Net worth screen draws, never recomputed here,
// so the sidebar cannot disagree with the screen it links to.
//
// Two rules carried over from the rest of the app:
//   - Nothing recorded shows nothing, not "RM 0". A blank sidebar is honest; a zero is a
//     claim (blank is not zero).
//   - A total resting on carried-forward figures keeps its asterisk, here as everywhere.
//     A compact headline number is exactly where staleness is easiest to lose.
//
// Rendering reads state and writes text; it never mutates state.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./networth.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (nw, val) {

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Compact ringgit for a narrow column: RM 1.42m, RM 540k, RM 950. Two decimals on
  // millions because the sidebar is where a month's movement should still be visible.
  function navAmount(n) {
    var abs = Math.abs(n);
    var sign = n < 0 ? "−" : "";
    if (abs >= 1000000) return sign + "RM " + (abs / 1000000).toFixed(2) + "m";
    if (abs >= 10000) return sign + "RM " + Math.round(abs / 1000) + "k";
    if (abs >= 1000) return sign + "RM " + (abs / 1000).toFixed(1) + "k";
    return sign + "RM " + Math.round(abs);
  }

  function periodName(period) {
    var parts = String(period).split("-");
    return MONTHS[parseInt(parts[1], 10) - 1] + " " + parts[0];
  }

  // What the shell shows, as data — so the rules above are testable without a DOM.
  function navTotals(state, through) {
    var pts = nw.series(state, through || val.currentPeriod());
    if (!pts.length) return null;
    var now = pts[pts.length - 1];
    var mark = now.partial ? "*" : "";
    return {
      period: now.period,
      periodLabel: periodName(now.period),
      partial: now.partial,
      net: navAmount(now.net) + mark,
      assets: navAmount(now.assets) + mark,
      debts: now.liabilities ? navAmount(now.liabilities) + mark : ""
    };
  }

  function renderNavTotals(state, doc) {
    var t = navTotals(state);
    function put(id, text, title) {
      var el = doc.getElementById(id);
      if (!el) return;
      el.textContent = text;
      if (title) el.setAttribute("title", title); else el.removeAttribute("title");
    }
    var staleNote = t && t.partial ? "Includes figures carried forward from an earlier month" : "";
    put("navNet", t ? t.net : "", staleNote);
    put("navAssets", t ? t.assets : "", staleNote);
    put("navDebts", t ? t.debts : "", staleNote);
    put("topPeriod", t ? "As of " + t.periodLabel + (t.partial ? "*" : "") : "", staleNote);
  }

  return { navAmount: navAmount, navTotals: navTotals, renderNavTotals: renderNavTotals };
});
