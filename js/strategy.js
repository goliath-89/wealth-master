"use strict";
// Wealth Master — multi-debt payoff strategy (FR-3.8)
//
// Avalanche (highest rate first) against snowball (smallest balance first) against
// paying only the minimums.
//
// Two things make this harder than the usual spreadsheet, and both matter in Malaysia:
//
// 1. AVALANCHE MUST RANK BY EFFECTIVE RATE, NOT THE QUOTED ONE. A hire purchase quoted
//    at 3.4% flat actually costs about 6.27%. Ranked on the quoted figure it looks
//    cheaper than a 4.35% mortgage and gets paid last, which is precisely backwards.
//
// 2. EXTRA MONEY AIMED AT A FLAT-RATE LOAN DOES NOTHING until it can settle the loan
//    outright. The term charges were fixed on day one, so "attacking" a hire purchase
//    with an extra RM 500 a month buys no interest saving at all — it only prepays
//    instalments. The honest model is to accumulate until the Rule of 78 settlement
//    figure is reachable, then settle.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./loans.js"), require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (loans, ent) {

  function round(n) { return Math.round(n * 100) / 100; }

  // A working copy of each debt, so a simulation never touches the stored records.
  function prepare(state) {
    return ent.live(state.liabilities).map(function (l) {
      var schedule = loans.scheduleFor(l);
      if (!schedule.rows.length || schedule.error) return null;
      return {
        id: l.id,
        name: l.name,
        basis: schedule.basis,
        quotedRatePct: Number(l.ratePct) || 0,
        // What it actually costs, which is what a rate-ordered strategy must use.
        effectiveRatePct: schedule.effectiveRatePct,
        instalment: schedule.instalment,
        balance: schedule.principal,
        monthlyRate: (Number(l.ratePct) || 0) / 100 / 12,
        schedule: schedule,
        instalmentsPaid: 0,
        totalInstalments: schedule.rows.length,
        interestPaid: 0,
        settlementPot: 0,
        cleared: false,
        clearedInMonth: null
      };
    }).filter(Boolean);
  }

  var ORDERS = {
    avalanche: function (a, b) { return b.effectiveRatePct - a.effectiveRatePct; },
    snowball: function (a, b) { return a.balance - b.balance; },
    minimums: null
  };

  // Runs one strategy month by month.
  //
  // `extraMonthly` is spare money on top of every minimum. When a debt clears, its
  // instalment is added to the extra pool — the rollover that makes either strategy work.
  function run(state, strategyName, extraMonthly, capMonths) {
    var debts = prepare(state);
    if (!debts.length) return null;

    var order = ORDERS[strategyName];
    var limit = capMonths || 600;
    var extra = Number(extraMonthly) || 0;
    var totalInterest = 0;
    var month = 0;
    var clearedOrder = [];

    while (month < limit && debts.some(function (d) { return !d.cleared; })) {
      month++;
      var pool = extra;

      // Every debt takes its minimum first.
      debts.forEach(function (d) {
        if (d.cleared) return;
        if (d.basis === "flat") {
          // Flat: the instalment is fixed and the interest within it is fixed. Paying
          // it does not change what remains owed in charges.
          var row = d.schedule.rows[d.instalmentsPaid];
          if (row) {
            d.interestPaid += row.interest;
            totalInterest += row.interest;
            d.balance = round(d.balance - row.principal);
          }
          d.instalmentsPaid++;
          if (d.instalmentsPaid >= d.totalInstalments) {
            d.cleared = true;
            d.clearedInMonth = month;
            clearedOrder.push({ id: d.id, name: d.name, month: month, via: "term" });
            pool += d.instalment;
          }
        } else {
          var interest = round(d.balance * d.monthlyRate);
          var principal = round(d.instalment - interest);
          // The final scheduled instalment clears whatever is left, exactly as the
          // engine does. Without this the sen of rounding residue survives into an
          // extra month and reports debt-free one month later than it is.
          if (principal >= d.balance || d.instalmentsPaid >= d.totalInstalments - 1) {
            principal = d.balance;
          }
          d.interestPaid += interest;
          totalInterest += interest;
          d.balance = round(d.balance - principal);
          d.instalmentsPaid++;
          if (d.balance <= 0) {
            d.cleared = true;
            d.clearedInMonth = month;
            clearedOrder.push({ id: d.id, name: d.name, month: month, via: "paid off" });
            pool += d.instalment;
          }
        }
      });

      if (!order || pool <= 0) continue;

      // Direct the pool at the target debt.
      var open = debts.filter(function (d) { return !d.cleared; }).sort(order);
      var target = open[0];
      if (!target) continue;

      if (target.basis === "flat") {
        // Extra cannot reduce the charges, so it accumulates until settlement is
        // affordable. Anything left over after settling rolls to the next debt.
        target.settlementPot = round(target.settlementPot + pool);
        var settle = loans.ruleOf78Settlement(target.schedule, target.instalmentsPaid);
        if (settle && target.settlementPot >= settle.settlementAmount) {
          // Settling means the remaining charges are never incurred — the saving shows
          // up as interest NOT added to the running total from here on.
          target.settlementPot = round(target.settlementPot - settle.settlementAmount);
          target.balance = 0;
          target.cleared = true;
          target.clearedInMonth = month;
          clearedOrder.push({ id: target.id, name: target.name, month: month, via: "settled early" });
          pool = target.settlementPot;
          target.settlementPot = 0;

          var next = debts.filter(function (d) { return !d.cleared; }).sort(order)[0];
          if (next && next.basis !== "flat" && pool > 0) {
            next.balance = round(Math.max(0, next.balance - pool));
            if (next.balance <= 0) {
              next.cleared = true;
              next.clearedInMonth = month;
              clearedOrder.push({ id: next.id, name: next.name, month: month, via: "paid off" });
            }
          }
        }
      } else {
        target.balance = round(Math.max(0, target.balance - pool));
        if (target.balance <= 0) {
          target.cleared = true;
          target.clearedInMonth = month;
          clearedOrder.push({ id: target.id, name: target.name, month: month, via: "paid off" });
        }
      }
    }

    return {
      strategy: strategyName,
      extraMonthly: extra,
      monthsToDebtFree: month,
      totalInterest: round(totalInterest),
      order: clearedOrder,
      debts: debts.map(function (d) {
        return {
          id: d.id, name: d.name, basis: d.basis,
          quotedRatePct: d.quotedRatePct,
          effectiveRatePct: round(d.effectiveRatePct),
          clearedInMonth: d.clearedInMonth,
          interestPaid: round(d.interestPaid)
        };
      })
    };
  }

  // All three, plus which wins and by how much.
  function compare(state, extraMonthly) {
    var minimums = run(state, "minimums", 0);
    if (!minimums) return null;

    var avalanche = run(state, "avalanche", extraMonthly);
    var snowball = run(state, "snowball", extraMonthly);

    var best = [avalanche, snowball].sort(function (a, b) {
      return a.totalInterest - b.totalInterest;
    })[0];

    return {
      minimums: minimums,
      avalanche: avalanche,
      snowball: snowball,
      best: best.strategy,
      // Against paying only the minimums — the number that answers "is this worth doing".
      interestSavedVsMinimums: round(minimums.totalInterest - best.totalInterest),
      monthsSavedVsMinimums: minimums.monthsToDebtFree - best.monthsToDebtFree,
      // Between the two strategies, which is usually small and worth saying so.
      avalancheAdvantage: round(snowball.totalInterest - avalanche.totalInterest)
    };
  }

  // Ranked by what each debt actually costs. Surfaces the flat-rate reordering, which is
  // the whole reason a quoted-rate ranking misleads.
  function costOrder(state) {
    return prepare(state)
      .map(function (d) {
        return {
          id: d.id, name: d.name, basis: d.basis,
          quotedRatePct: d.quotedRatePct,
          effectiveRatePct: round(d.effectiveRatePct),
          balance: d.balance,
          understated: d.basis === "flat" && d.effectiveRatePct > d.quotedRatePct + 0.5
        };
      })
      .sort(function (a, b) { return b.effectiveRatePct - a.effectiveRatePct; });
  }

  return { prepare: prepare, run: run, compare: compare, costOrder: costOrder };
});
