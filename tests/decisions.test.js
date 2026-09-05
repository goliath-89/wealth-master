"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() { return helpers.loadLib(helpers.freshWindow()).decisions; }

var MORTGAGE = {
  name: "Home loan", rateBasis: "reducing",
  principal: 350000, ratePct: 4.35, tenureMonths: 360, startDate: "2024-01"
};
var HP = {
  name: "Car loan", rateBasis: "flat",
  principal: 90000, ratePct: 3.4, tenureMonths: 84, startDate: "2024-03"
};

// --- the arithmetic ---------------------------------------------------------

test("future value of a contribution stream compounds monthly to the annual rate", function () {
  var d = lib();
  // RM 1,000 a month for 12 months at 0% is exactly RM 12,000.
  assert.equal(Math.round(d.futureValue(1000, 0, 12)), 12000);
  // With growth it must exceed the plain sum, but not wildly.
  var fv = d.futureValue(1000, 6, 12);
  assert.ok(fv > 12000 && fv < 12400, "got " + fv);
});

test("growing a lump for twelve months lands on the annual rate", function () {
  var d = lib();
  assert.ok(Math.abs(d.grow(10000, 6, 12) - 10600) < 0.01);
});

// --- the comparison ---------------------------------------------------------

test("a high loan rate against a low assumed return favours overpaying", function () {
  var d = lib();
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 1000, growthPct: 2, horizonMonths: 240 });
  assert.equal(res.verdict, "overpay");
  assert.ok(res.overpay.netAtHorizon > res.invest.netAtHorizon);
  assert.match(res.reason, /loan costs more/);
});

test("a low loan rate against a high assumed return favours investing", function () {
  var d = lib();
  var res = d.overpayVsInvest(
    Object.assign({}, MORTGAGE, { ratePct: 2.5 }),
    { monthlyAmount: 1000, growthPct: 10, horizonMonths: 240 }
  );
  assert.equal(res.verdict, "invest");
  assert.match(res.reason, /not a guarantee/);
});

test("the freed instalment is invested after the loan clears", function () {
  var d = lib();
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 2000, growthPct: 5, horizonMonths: 300 });
  // This is the term naive comparisons omit. Without it, overpaying looks far worse
  // than it is: the loan is gone but its instalment is treated as if still spent.
  assert.ok(res.overpay.clearedAfterMonths < 300);
  assert.ok(res.overpay.investedAfterClearing > 0,
    "the freed instalment plus the spare amount must be put to work");
  assert.equal(res.overpay.debtRemaining, 0);
});

test("overpaying reports the months and interest it saves", function () {
  var d = lib();
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 1000, growthPct: 5, horizonMonths: 240 });
  assert.ok(res.overpay.monthsSaved > 0);
  assert.ok(res.overpay.interestSaved > 0);
});

test("investing is not penalised when the loan ends inside the horizon", function () {
  var d = lib();
  // 360-month loan, 400-month horizon: the instalment frees up on both sides and the
  // comparison must credit that to the invest option too.
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 500, growthPct: 6, horizonMonths: 400 });
  assert.equal(res.invest.debtRemaining, 0);
  assert.ok(res.invest.invested > 0);
});

test("both options are valued at the same horizon", function () {
  var d = lib();
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 800, growthPct: 5, horizonMonths: 180 });
  assert.equal(res.horizonMonths, 180);
  assert.equal(res.difference,
    Math.round(Math.abs(res.overpay.netAtHorizon - res.invest.netAtHorizon) * 100) / 100);
});

test("a near-tie is reported as similar rather than a false winner", function () {
  var d = lib();
  var be = d.breakEvenGrowth(MORTGAGE, { monthlyAmount: 1000, horizonMonths: 240 });
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 1000, growthPct: be, horizonMonths: 240 });
  assert.equal(res.verdict, "similar");
  assert.match(res.reason, /margin of error/);
});

test("break-even growth is near the loan rate, as intuition expects", function () {
  var d = lib();
  var be = d.breakEvenGrowth(MORTGAGE, { monthlyAmount: 1000, horizonMonths: 240 });
  // Overpaying a 4.35% loan is worth roughly what a 4.35% investment returns; timing
  // and the freed instalment move it a little, so allow a band.
  assert.ok(be > 2.5 && be < 6.5, "expected roughly 4.35%, got " + be);
});

// --- flat rate is a different question --------------------------------------

test("a flat-rate facility has no overpay branch at all", function () {
  var d = lib();
  var res = d.overpayVsInvest(HP, { monthlyAmount: 1000, growthPct: 5, horizonMonths: 84 });
  assert.equal(res.flatRate, true);
  assert.equal(res.verdict, "invest");
  assert.equal(res.overpay, undefined,
    "computing an overpay saving here would invent one that does not exist");
  assert.match(res.reason, /does not reduce the term charges/);
});

test("the flat-rate answer points at early settlement instead", function () {
  var d = lib();
  var res = d.overpayVsInvest(HP, { monthlyAmount: 1000, growthPct: 5, horizonMonths: 84, instalmentsPaid: 24 });
  assert.ok(res.settlement, "the real lever must be offered");
  assert.equal(res.settlement.instalmentsRemaining, 60);
  assert.ok(res.investOnly > 0);
});

test("break-even is undefined for a flat facility rather than a misleading number", function () {
  var d = lib();
  assert.equal(d.breakEvenGrowth(HP, { monthlyAmount: 1000, horizonMonths: 84 }), null);
});

// --- degenerate input -------------------------------------------------------

test("a loan with no usable terms yields no comparison", function () {
  var d = lib();
  assert.equal(d.overpayVsInvest({ rateBasis: "reducing", principal: 0, tenureMonths: 0 },
    { monthlyAmount: 500, growthPct: 5 }), null);
});

test("a spare amount of zero still compares cleanly", function () {
  var d = lib();
  var res = d.overpayVsInvest(MORTGAGE, { monthlyAmount: 0, growthPct: 5, horizonMonths: 120 });
  assert.equal(res.overpay.monthsSaved, 0);
  assert.equal(res.invest.invested, 0);
  assert.equal(res.verdict, "similar");
});
