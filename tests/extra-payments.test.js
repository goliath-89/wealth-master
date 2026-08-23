"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() { return helpers.loadLib(helpers.freshWindow()).loans; }

var MORTGAGE = { principal: 350000, ratePct: 4.35, tenureMonths: 360, startPeriod: "2024-01" };
var HP = { principal: 90000, ratePct: 3.4, tenureMonths: 84, startPeriod: "2024-03" };

// ============================================================================
// REDUCING BALANCE — extra payments genuinely save interest
// ============================================================================

test("a recurring extra payment shortens the loan and cuts total interest", function () {
  var l = lib();
  var base = l.reducingSchedule(MORTGAGE);
  var accel = l.reducingSchedule(Object.assign({}, MORTGAGE, { extraMonthly: 500 }));

  assert.ok(accel.months < base.months, "paying more must finish sooner");
  assert.ok(accel.totalInterest < base.totalInterest);
  assert.equal(accel.rows[accel.rows.length - 1].balance, 0, "and still clear exactly");

  var cmp = l.compareSchedules(base, accel);
  assert.equal(cmp.monthsSaved, base.months - accel.months);
  assert.equal(
    Math.round((cmp.baselineInterest - cmp.acceleratedInterest) * 100) / 100,
    cmp.interestSaved
  );
});

test("a one-off extra in a single month still saves interest and time", function () {
  var l = lib();
  var base = l.reducingSchedule(MORTGAGE);
  // The bonus case: RM 1,000 extra in one month only.
  var accel = l.reducingSchedule(Object.assign({}, MORTGAGE, {
    oneOffs: { "2024-06": 1000 }
  }));

  assert.ok(accel.totalInterest < base.totalInterest, "one payment still helps");
  assert.ok(accel.months <= base.months);
  assert.equal(accel.rows[accel.rows.length - 1].balance, 0);

  // It lands in the month it was made, and nowhere else.
  var june = accel.rows.filter(function (r) { return r.period === "2024-06"; })[0];
  var july = accel.rows.filter(function (r) { return r.period === "2024-07"; })[0];
  assert.equal(june.extra, 1000);
  assert.equal(july.extra, 0);
  assert.equal(
    Math.round((june.payment - base.rows[5].payment) * 100) / 100, 1000,
    "that month's payment is exactly RM 1,000 higher"
  );
});

test("the extra reduces the balance, so the next month accrues less interest", function () {
  var l = lib();
  var base = l.reducingSchedule(MORTGAGE);
  var accel = l.reducingSchedule(Object.assign({}, MORTGAGE, { oneOffs: { "2024-06": 1000 } }));
  // This is the mechanism — not a rebate, but a smaller balance to charge interest on.
  assert.ok(accel.rows[5].balance < base.rows[5].balance);
  assert.ok(accel.rows[6].interest < base.rows[6].interest);
});

test("principal still reconciles to the original amount when extras are applied", function () {
  var l = lib();
  var accel = l.reducingSchedule(Object.assign({}, MORTGAGE, {
    extraMonthly: 250, oneOffs: { "2025-01": 5000 }
  }));
  var paid = Math.round(accel.rows.reduce(function (n, r) { return n + r.principal * 100; }, 0));
  assert.equal(paid, 35000000, "every sen of principal must still be accounted for");
});

test("simulatePayment reports what a higher monthly figure buys", function () {
  var l = lib();
  var loan = {
    principal: 350000, ratePct: 4.35, tenureMonths: 360,
    startDate: "2024-01", rateBasis: "reducing"
  };
  var base = l.reducingSchedule(MORTGAGE);
  var sim = l.simulatePayment(loan, base.instalment + 500);

  assert.equal(sim.baseline.months, 360);
  assert.ok(sim.comparison.monthsSaved > 0);
  assert.ok(sim.comparison.interestSaved > 0);
  assert.equal(sim.comparison.acceleratedPayoff < sim.comparison.baselinePayoff, true);
});

test("simulating the contractual instalment shows no saving, not a spurious one", function () {
  var l = lib();
  var loan = {
    principal: 350000, ratePct: 4.35, tenureMonths: 360,
    startDate: "2024-01", rateBasis: "reducing"
  };
  var base = l.reducingSchedule(MORTGAGE);
  var sim = l.simulatePayment(loan, base.instalment);
  assert.equal(sim.comparison.monthsSaved, 0);
  assert.equal(sim.comparison.interestSaved, 0);
});

test("simulating a payment below the interest is refused with a reason", function () {
  var l = lib();
  var loan = {
    principal: 350000, ratePct: 4.35, tenureMonths: 360,
    startDate: "2024-01", rateBasis: "reducing"
  };
  var sim = l.simulatePayment(loan, 100);
  assert.match(sim.error, /never reduces/);
});

// ============================================================================
// FLAT RATE — the trap. Overpaying does NOT work the same way.
// ============================================================================

test("Rule of 78 rebate follows the statutory formula", function () {
  var l = lib();
  var s = l.flatSchedule(HP);
  // n = 84, total term charges = RM 21,420. Settling with r = 24 left:
  //   rebate = 21,420 × (24 × 25) / (84 × 85) = 21,420 × 600 / 7,140 = RM 1,800.00
  var set = l.ruleOf78Settlement(s, 60);
  assert.equal(set.instalmentsRemaining, 24);
  assert.equal(set.rebate, 1800);
});

test("the settlement figure is the outstanding instalments less the rebate", function () {
  var l = lib();
  var s = l.flatSchedule(HP);
  var set = l.ruleOf78Settlement(s, 60);
  // 24 × RM 1,326.43 = RM 31,834.32, less RM 1,800.00 rebate.
  assert.equal(set.outstandingInstalments, 31834.32);
  assert.equal(set.settlementAmount, 30034.32);
});

test("Rule of 78 rebates less than the interest still nominally outstanding", function () {
  var l = lib();
  var s = l.flatSchedule(HP);
  var set = l.ruleOf78Settlement(s, 60);
  // Straight-line, 24 of 84 months of interest would be 21,420 × 24/84 = RM 6,120.
  // The statutory rebate is only RM 1,800 — Rule of 78 front-loads the charges, which
  // is exactly why treating an HP like a mortgage overstates the saving.
  assert.equal(set.interestIfContinued, 6120);
  assert.ok(set.rebate < set.interestIfContinued);
  assert.ok(set.rebate / set.interestIfContinued < 0.35);
});

test("settling at the very start rebates nearly all the charges", function () {
  var l = lib();
  var s = l.flatSchedule(HP);
  var set = l.ruleOf78Settlement(s, 0);
  assert.equal(set.instalmentsRemaining, 84);
  assert.equal(set.rebate, s.totalInterest, "nothing has been earned yet");
});

test("settling after the final instalment yields nothing to settle", function () {
  var l = lib();
  var s = l.flatSchedule(HP);
  assert.equal(l.ruleOf78Settlement(s, 84), null);
});

test("Rule of 78 refuses to operate on a reducing-balance loan", function () {
  var l = lib();
  var red = l.reducingSchedule(MORTGAGE);
  assert.equal(l.ruleOf78Settlement(red, 60), null,
    "a mortgage settles at its outstanding balance, not by statutory rebate");
});

test("the flat engine ignores extra payments — they change no schedule row", function () {
  var l = lib();
  var plain = l.flatSchedule(HP);
  var withExtra = l.flatSchedule(Object.assign({}, HP, { extraMonthly: 500, oneOffs: { "2024-06": 1000 } }));
  // Term charges were fixed on day one. Paying more monthly does not reduce them, and
  // pretending otherwise would overstate the saving by several thousand ringgit.
  assert.equal(withExtra.totalInterest, plain.totalInterest);
  assert.equal(withExtra.months, plain.months);
  assert.deepEqual(withExtra.rows[10], plain.rows[10]);
});

test("the same overpayment saves far more on a mortgage than on a hire purchase", function () {
  var l = lib();
  // Identical terms, different basis — the comparison that matters.
  var terms = { principal: 90000, ratePct: 3.4, tenureMonths: 84, startPeriod: "2024-03" };
  var redBase = l.reducingSchedule(terms);
  var redAccel = l.reducingSchedule(Object.assign({}, terms, { extraMonthly: 500 }));
  var redSaving = l.compareSchedules(redBase, redAccel).interestSaved;

  var flat = l.flatSchedule(terms);
  var flatSaving = l.ruleOf78Settlement(flat, 12).rebate -
    l.ruleOf78Settlement(flat, 0).rebate; // settling later rebates less
  assert.ok(redSaving > 0);
  assert.ok(flatSaving < 0, "on flat rate, waiting costs you rebate rather than saving interest");
});
