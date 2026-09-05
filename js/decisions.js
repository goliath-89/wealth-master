"use strict";
// Wealth Master — decision support (P3.8, scenario S3)
//
// "Should I overpay the loan or invest the money?"
//
// The comparison most tools get wrong: they weigh interest saved against investment
// growth and stop there. That is not apples to apples, because clearing a loan early
// frees the instalment itself, and every ringgit of that can then be invested for the
// remaining years. Ignoring the freed instalment makes overpaying look far worse than it
// is. Both options here spend the SAME money every month and are valued at the SAME
// horizon.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./loans.js"), require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (loans, ent) {

  // Future value of a monthly contribution stream, compounding monthly at an annual
  // rate. Uses the twelfth root so twelve months actually delivers the annual figure.
  function futureValue(monthly, annualPct, months) {
    if (!months || months <= 0 || !monthly) return 0;
    var i = Math.pow(1 + (Number(annualPct) || 0) / 100, 1 / 12) - 1;
    if (i === 0) return monthly * months;
    return monthly * (Math.pow(1 + i, months) - 1) / i;
  }

  // Value of a lump already invested, grown for a number of months.
  function grow(amount, annualPct, months) {
    if (!amount) return 0;
    return amount * Math.pow(1 + (Number(annualPct) || 0) / 100, months / 12);
  }

  function round(n) { return Math.round(n * 100) / 100; }

  // Compares putting a spare monthly amount into the loan against investing it.
  //
  // Returns null when the loan has no usable terms. For a flat-rate facility it returns
  // a verdict with `flatRate: true` and no overpay branch, because paying extra into a
  // hire purchase does not reduce charges fixed on day one — the honest alternative
  // there is early settlement, not overpayment.
  function overpayVsInvest(liability, opts) {
    opts = opts || {};
    var spare = Number(opts.monthlyAmount) || 0;
    var growthPct = Number(opts.growthPct) || 0;
    var horizon = parseInt(opts.horizonMonths, 10) || 120;

    var baseline = loans.scheduleFor(liability);
    if (!baseline.rows.length || baseline.error) return null;

    if (baseline.basis === "flat") {
      // No overpay branch to compute: the term charges do not move.
      var settle = loans.ruleOf78Settlement(baseline, opts.instalmentsPaid || 0);
      return {
        flatRate: true,
        horizonMonths: horizon,
        monthlyAmount: spare,
        investOnly: round(futureValue(spare, growthPct, horizon)),
        settlement: settle,
        verdict: "invest",
        reason: "Paying extra into a flat-rate hire purchase does not reduce the term " +
          "charges, which were fixed when the agreement was signed. Investing the money " +
          "is better on those terms alone — the only way to cut the interest is to settle " +
          "the facility early."
      };
    }

    // --- Option A: overpay -------------------------------------------------
    var accelerated = loans.reducingSchedule({
      principal: liability.principal,
      ratePct: liability.ratePct,
      tenureMonths: liability.tenureMonths,
      startPeriod: liability.startDate ? String(liability.startDate).slice(0, 7) : null,
      instalment: baseline.instalment,
      extraMonthly: spare
    });
    if (accelerated.error) return null;

    var clearedAt = accelerated.months;
    // Once the loan is gone, the instalment AND the spare amount are both free to
    // invest. This is the term the naive comparison omits.
    var freedMonths = Math.max(0, horizon - clearedAt);
    var overpayInvested = futureValue(baseline.instalment + spare, growthPct, freedMonths);
    var overpayDebtLeft = clearedAt <= horizon ? 0 : balanceAt(accelerated, horizon);
    var overpayNet = overpayInvested - overpayDebtLeft;

    // --- Option B: invest --------------------------------------------------
    var investedDuring = futureValue(spare, growthPct, Math.min(horizon, baseline.months));
    var baselineDebtLeft = baseline.months <= horizon ? 0 : balanceAt(baseline, horizon);
    // If the loan finishes inside the horizon on its own schedule, the instalment frees
    // up here too — otherwise this option would be unfairly penalised.
    var investFreedMonths = Math.max(0, horizon - baseline.months);
    var investedAfter = futureValue(baseline.instalment + spare, growthPct, investFreedMonths) +
      grow(investedDuring, growthPct, investFreedMonths);
    var investNet = (investFreedMonths > 0 ? investedAfter : investedDuring) - baselineDebtLeft;

    var difference = overpayNet - investNet;
    var verdict = Math.abs(difference) < Math.max(1000, Math.abs(investNet) * 0.01)
      ? "similar" : (difference > 0 ? "overpay" : "invest");

    return {
      flatRate: false,
      horizonMonths: horizon,
      monthlyAmount: spare,
      growthPct: growthPct,
      loanRatePct: Number(liability.ratePct) || 0,
      overpay: {
        clearedAfterMonths: clearedAt,
        monthsSaved: baseline.months - clearedAt,
        interestSaved: round(baseline.totalInterest - accelerated.totalInterest),
        investedAfterClearing: round(overpayInvested),
        debtRemaining: round(overpayDebtLeft),
        netAtHorizon: round(overpayNet)
      },
      invest: {
        invested: round(investFreedMonths > 0 ? investedAfter : investedDuring),
        interestPaid: baseline.totalInterest,
        debtRemaining: round(baselineDebtLeft),
        netAtHorizon: round(investNet)
      },
      difference: round(Math.abs(difference)),
      verdict: verdict,
      // The intuition behind the answer, which usually holds: overpaying wins when the
      // loan costs more than the investment is assumed to return. Stated as a comparison
      // the owner can sanity-check rather than a black box.
      reason: verdict === "similar"
        ? "The two land within about one per cent of each other, which is inside the " +
          "margin of error on any growth assumption. Treat them as equivalent and choose " +
          "on other grounds — certainty, or flexibility."
        : verdict === "overpay"
          ? "The loan costs more than the investment is assumed to return, so clearing " +
            "the debt wins — and once it is cleared the whole instalment is free to invest."
          : "The investment is assumed to return more than the loan costs, so the money " +
            "works harder invested. That assumption is doing the work, and it is not a " +
            "guarantee the way the loan's interest is."
    };
  }

  function balanceAt(schedule, monthIndex) {
    var row = schedule.rows[Math.min(monthIndex, schedule.rows.length) - 1];
    return row ? row.balance : schedule.principal;
  }

  // The rate an investment would have to return to match overpaying — the break-even a
  // decision can be checked against later, when a real return is known.
  function breakEvenGrowth(liability, opts) {
    opts = opts || {};
    var lo = 0, hi = 30;
    for (var k = 0; k < 60; k++) {
      var mid = (lo + hi) / 2;
      var res = overpayVsInvest(liability, {
        monthlyAmount: opts.monthlyAmount,
        growthPct: mid,
        horizonMonths: opts.horizonMonths
      });
      if (!res || res.flatRate) return null;
      if (res.overpay.netAtHorizon > res.invest.netAtHorizon) lo = mid; else hi = mid;
    }
    return round((lo + hi) / 2);
  }

  return {
    futureValue: futureValue,
    grow: grow,
    overpayVsInvest: overpayVsInvest,
    breakEvenGrowth: breakEvenGrowth
  };
});
