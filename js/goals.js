"use strict";
// Wealth Master — goal tracking (FR-5.4, scenario S5)
//
// "When can I afford X, and am I on track?"
//
// A goal is measured against specific holdings, not against net worth. Counting a house
// or a locked retirement account toward a house deposit would say you are on track for
// something you cannot actually pay for.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./networth.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, nw, val) {

  function monthlyRate(annualPct) {
    return Math.pow(1 + (Number(annualPct) || 0) / 100, 1 / 12) - 1;
  }

  function round(n) { return Math.round(n * 100) / 100; }

  // Whole months from one YYYY-MM to another. Negative when the target is in the past.
  function monthsUntil(fromPeriod, targetPeriod) {
    return nw.monthsBetween(fromPeriod, targetPeriod);
  }

  // What the goal is currently worth: the linked holdings, or every liquid holding when
  // none are named. Physical assets are never counted — a goal is something you fund.
  function currentValue(state, goal, period) {
    var linked = (goal.linkedHoldingIds || []).filter(Boolean);
    var total = 0;
    nw.contributingHoldings(state).forEach(function (h) {
      if (linked.length) {
        if (linked.indexOf(h.id) === -1) return;
      } else {
        var acct = ent.byId(state.accounts, h.accountId);
        if (!acct || !acct.liquid) return;
      }
      var pos = nw.positionFor(state, h.id, period);
      if (pos) total += pos.balance;
    });
    return round(total);
  }

  // The monthly contribution needed to reach the target by its date, allowing for growth
  // on what is already there.
  //
  //   target = current(1+i)^n + M((1+i)^n − 1)/i
  //
  // Returns 0 when growth alone already gets there — a goal that funds itself needs no
  // instruction to save.
  function requiredMonthly(current, target, annualPct, months) {
    if (!months || months <= 0) return null;
    var i = monthlyRate(annualPct);
    var factor = Math.pow(1 + i, months);
    var shortfall = target - current * factor;
    if (shortfall <= 0) return 0;
    if (i === 0) return round(shortfall / months);
    return round(shortfall * i / (factor - 1));
  }

  // How many months until the target is reached at a given contribution. Null when it
  // never gets there — better than returning a large number that implies it eventually
  // does.
  function monthsToTarget(current, target, annualPct, monthly, cap) {
    var limit = cap || 1200;
    if (current >= target) return 0;
    var i = monthlyRate(annualPct);
    var balance = current;
    for (var m = 1; m <= limit; m++) {
      balance = balance * (1 + i) + monthly;
      if (balance >= target) return m;
    }
    return null;
  }

  // Recent contribution rate into this goal's holdings, used to judge whether the owner
  // is actually on track rather than only theoretically able to be.
  function recentMonthlyContribution(state, goal, period, lookback) {
    var months = lookback || 6;
    var linked = (goal.linkedHoldingIds || []).filter(Boolean);
    var ids = {};
    nw.contributingHoldings(state).forEach(function (h) {
      if (linked.length) {
        if (linked.indexOf(h.id) !== -1) ids[h.id] = true;
      } else {
        var acct = ent.byId(state.accounts, h.accountId);
        if (acct && acct.liquid) ids[h.id] = true;
      }
    });

    var earliest = period;
    for (var k = 0; k < months - 1; k++) earliest = val.prevPeriod(earliest);

    var total = 0, seen = 0;
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || !ids[v.holdingId]) return;
      if (v.period < earliest || v.period > period) return;
      if (v.contribution === null || v.contribution === undefined) return;
      total += v.contribution;
      seen++;
    });
    return { monthly: seen ? round(total / months) : null, monthsSeen: seen, total: round(total) };
  }

  // The full picture for one goal.
  function progress(state, goal, opts) {
    opts = opts || {};
    var period = opts.period || val.currentPeriod();
    var growthPct = opts.growthPct === undefined ? 4 : opts.growthPct;

    var target = Number(goal.targetAmount) || 0;
    var current = currentValue(state, goal, period);
    var targetPeriod = goal.targetDate ? String(goal.targetDate).slice(0, 7) : null;
    var months = targetPeriod ? monthsUntil(period, targetPeriod) : null;

    var actual = recentMonthlyContribution(state, goal, period);
    var required = months !== null && months > 0
      ? requiredMonthly(current, target, growthPct, months) : null;

    var reachedAt = actual.monthly !== null
      ? monthsToTarget(current, target, growthPct, actual.monthly) : null;

    var status;
    if (target <= 0) status = "no-target";
    else if (current >= target) status = "reached";
    else if (months !== null && months <= 0) status = "overdue";
    else if (required === null) status = "no-date";
    else if (actual.monthly === null) status = "unknown";
    else status = actual.monthly + 0.005 >= required ? "on-track" : "behind";

    return {
      goalId: goal.id,
      name: goal.name,
      target: target,
      current: current,
      shortfall: round(Math.max(0, target - current)),
      pctComplete: target > 0 ? Math.min(100, round(current / target * 100)) : 0,
      targetPeriod: targetPeriod,
      monthsRemaining: months,
      requiredMonthly: required,
      actualMonthly: actual.monthly,
      contributionMonthsSeen: actual.monthsSeen,
      // At the current rate — the honest answer to "when", which may be never.
      monthsAtCurrentRate: reachedAt,
      status: status,
      growthPct: growthPct
    };
  }

  function progressAll(state, opts) {
    return ent.live(state.goals).map(function (g) { return progress(state, g, opts); });
  }

  return {
    monthsUntil: monthsUntil,
    currentValue: currentValue,
    requiredMonthly: requiredMonthly,
    monthsToTarget: monthsToTarget,
    recentMonthlyContribution: recentMonthlyContribution,
    progress: progress,
    progressAll: progressAll
  };
});
