"use strict";
// Wealth Master — Recap: what moved net worth between two months (P6)
//
// Net worth going up is not one fact but several. Money you put in is not the same
// achievement as money the market handed you, and a month where debt fell is different
// again. Kubera's Recap shows the past as a period; this shows it as a decomposition,
// which is the version that can change a decision.
//
// The identity it reports, and reconciles to the sen:
//
//   change in net worth = contributions − withdrawals + income
//                       + market movement
//                       + revaluation of physical assets
//                       + debt paid down
//
// MARKET MOVEMENT IS A RESIDUAL, and says so wherever it is shown. It is whatever the
// recorded balances did that the recorded flows do not explain: real growth, yes, but
// also a contribution nobody wrote down. Naming it "growth" would dress an unrecorded
// transfer up as performance — the opposite of what this app is for (G5).
//
// Every figure comes from the same positions net worth uses, so a recap cannot disagree
// with the screen it decomposes. Nothing here writes.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./networth.js"), require("./valuations.js"), require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (nw, val, ent) {

  function balancesById(position) {
    var out = {};
    position.lines.forEach(function (line) {
      // A holding no rate can convert is left out of net worth (FR-9.6), so it is left
      // out of the decomposition too rather than counted at face value.
      if (line.convertible === false) return;
      out[line.id] = line.balance;
    });
    return out;
  }

  // Every month after `from` up to and including `to`. The starting month's own flows
  // belong to the period before this one: its balance is where this period begins.
  function periodsAfter(from, to) {
    var out = [];
    var p = nw.nextPeriod(from);
    for (var i = 0; i <= 1200 && nw.monthsBetween(p, to) >= 0; i++) {
      out.push(p);
      p = nw.nextPeriod(p);
    }
    return out;
  }

  function recap(state, from, to) {
    if (!val.isPeriod(from) || !val.isPeriod(to) || nw.monthsBetween(from, to) < 1) return null;

    var start = nw.positionAt(state, from);
    var end = nw.positionAt(state, to);
    var months = periodsAfter(from, to);

    var startById = balancesById(start), endById = balancesById(end);
    var flows = { contributions: 0, withdrawals: 0, income: 0 };
    var perHolding = {};

    ent.live(state.holdings).forEach(function (h) {
      var row = {
        id: h.id, kind: "holding", name: h.name,
        start: startById[h.id] || 0, end: endById[h.id] || 0,
        contributions: 0, withdrawals: 0, income: 0
      };
      months.forEach(function (p) {
        var v = val.valuationFor(state, h.id, p);
        if (!v) return;
        row.contributions += v.contribution || 0;
        row.withdrawals += v.withdrawal || 0;
        row.income += v.income || 0;
      });
      row.change = row.end - row.start;
      row.market = row.change - (row.contributions - row.withdrawals + row.income);
      if (row.start || row.end || row.contributions || row.withdrawals || row.income) {
        perHolding[h.id] = row;
        flows.contributions += row.contributions;
        flows.withdrawals += row.withdrawals;
        flows.income += row.income;
      }
    });

    var holdingsStart = 0, holdingsEnd = 0;
    Object.keys(perHolding).forEach(function (id) {
      holdingsStart += perHolding[id].start;
      holdingsEnd += perHolding[id].end;
    });

    // A house is not bought and sold each month: what changed is the estimate of what it
    // is worth, which is a different kind of fact from a contribution and is kept apart.
    var assets = [];
    var revaluation = 0;
    ent.live(state.assets).forEach(function (a) {
      var s = startById[a.id] || 0, e = endById[a.id] || 0;
      if (!s && !e) return;
      assets.push({ id: a.id, kind: "asset", name: a.name, start: s, end: e, change: e - s });
      revaluation += e - s;
    });

    var debts = [];
    var debtPaid = 0;
    ent.live(state.liabilities).forEach(function (l) {
      var s = startById[l.id] || 0, e = endById[l.id] || 0;
      if (!s && !e) return;
      // Positive means the debt fell over the period, which is why it reads as a gain.
      debts.push({ id: l.id, kind: "liability", name: l.name, start: s, end: e, paidDown: s - e });
      debtPaid += s - e;
    });

    var market = (holdingsEnd - holdingsStart) -
      (flows.contributions - flows.withdrawals + flows.income);

    var parts = [
      { key: "contributions", label: "Contributions", value: flows.contributions },
      { key: "withdrawals", label: "Withdrawals", value: -flows.withdrawals },
      { key: "income", label: "Income", value: flows.income },
      { key: "market", label: "Market movement", value: market, residual: true },
      { key: "revaluation", label: "Asset revaluation", value: revaluation },
      { key: "debtPaid", label: "Debt paid down", value: debtPaid }
    ];
    var sum = parts.reduce(function (t, p) { return t + p.value; }, 0);

    return {
      from: from,
      to: to,
      months: months.length,
      startNet: start.net,
      endNet: end.net,
      change: end.net - start.net,
      pct: start.net === 0 ? null : (end.net - start.net) / Math.abs(start.net) * 100,
      parts: parts,
      holdings: Object.keys(perHolding).map(function (id) { return perHolding[id]; }),
      assets: assets,
      debts: debts,
      // Either end resting on carried-forward figures makes the whole decomposition less
      // certain, so it travels with the result rather than being discoverable.
      partial: !!(start.partial || end.partial),
      startPartial: start.partial,
      endPartial: end.partial,
      // The parts must add up to the change. They do by construction — market movement is
      // the residual — so a false here is a bug, not a rounding matter.
      reconciles: Math.abs(sum - (end.net - start.net)) < 0.005
    };
  }

  return { recap: recap };
});
