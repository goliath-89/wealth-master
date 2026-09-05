"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup(defs) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  (defs || []).forEach(function (def) {
    var liab = l.schema.newLiability("dev-1");
    liab.name = def.name;
    liab.rateBasis = def.basis || "reducing";
    liab.principal = def.principal;
    liab.ratePct = def.ratePct;
    liab.tenureMonths = def.tenureMonths;
    liab.startDate = "2026-01";
    s.liabilities.push(liab);
  });
  return { l: l, st: l.strategy, state: s };
}

// A small, fast set: a cheap long loan and an expensive short one.
var TWO_LOANS = [
  { name: "Personal loan", principal: 20000, ratePct: 8, tenureMonths: 60 },
  { name: "Renovation loan", principal: 40000, ratePct: 4, tenureMonths: 60 }
];

test("paying only the minimums clears every debt at its own term", function () {
  var s = setup(TWO_LOANS);
  var res = s.st.run(s.state, "minimums", 0);
  assert.equal(res.monthsToDebtFree, 60);
  assert.equal(res.debts.filter(function (d) { return d.clearedInMonth; }).length, 2);
});

test("adding extra money clears the debts sooner and costs less interest", function () {
  var s = setup(TWO_LOANS);
  var base = s.st.run(s.state, "minimums", 0);
  var fast = s.st.run(s.state, "avalanche", 1000);
  assert.ok(fast.monthsToDebtFree < base.monthsToDebtFree);
  assert.ok(fast.totalInterest < base.totalInterest);
});

test("avalanche attacks the most expensive debt first", function () {
  var s = setup(TWO_LOANS);
  var res = s.st.run(s.state, "avalanche", 1000);
  assert.equal(res.order[0].name, "Personal loan", "8% must be cleared before 4%");
});

test("snowball attacks the smallest balance first", function () {
  var s = setup([
    { name: "Big cheap loan", principal: 50000, ratePct: 4, tenureMonths: 60 },
    { name: "Small dear loan", principal: 8000, ratePct: 9, tenureMonths: 60 }
  ]);
  var res = s.st.run(s.state, "snowball", 800);
  assert.equal(res.order[0].name, "Small dear loan");
});

test("a cleared debt's instalment rolls into the next one", function () {
  var s = setup(TWO_LOANS);
  var res = s.st.run(s.state, "avalanche", 1000);
  var first = res.order[0].month;
  var second = res.order[1].month;
  // Without the rollover the second debt would take far longer; both clear well inside
  // the 60-month term.
  assert.ok(second < 60);
  assert.ok(second > first);
});

test("avalanche costs no more interest than snowball", function () {
  var s = setup(TWO_LOANS);
  var cmp = s.st.compare(s.state, 1000);
  assert.ok(cmp.avalanche.totalInterest <= cmp.snowball.totalInterest);
  assert.equal(cmp.best, "avalanche");
  assert.ok(cmp.avalancheAdvantage >= 0);
});

test("the comparison reports what either strategy saves against minimums", function () {
  var s = setup(TWO_LOANS);
  var cmp = s.st.compare(s.state, 1000);
  assert.ok(cmp.interestSavedVsMinimums > 0);
  assert.ok(cmp.monthsSavedVsMinimums > 0);
});

// --- the flat-rate reordering, which is the point ----------------------------

test("a flat-rate loan is ranked by what it actually costs, not what it quotes", function () {
  var s = setup([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 },
    { name: "Personal loan", principal: 30000, ratePct: 5, tenureMonths: 36 }
  ]);
  var order = s.st.costOrder(s.state);
  // 3.4% flat is really about 6.4% — dearer than the 5% loan, though it quotes cheaper.
  assert.equal(order[0].name, "Car loan");
  assert.ok(order[0].effectiveRatePct > order[1].effectiveRatePct);
  assert.equal(order[0].understated, true, "the gap between quoted and real must be flagged");
});

test("avalanche follows the effective rate, so the flat loan is targeted first", function () {
  var s = setup([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 },
    { name: "Personal loan", principal: 30000, ratePct: 5, tenureMonths: 36 }
  ]);
  var res = s.st.run(s.state, "avalanche", 1500);
  // Ranking on the quoted 3.4% would pay this last, which is exactly backwards.
  assert.equal(res.order[0].name, "Car loan");
});

test("extra money aimed at a flat loan clears it by settlement, not by overpaying", function () {
  var s = setup([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 }
  ]);
  var res = s.st.run(s.state, "avalanche", 2000);
  var cleared = res.order[0];
  assert.equal(cleared.via, "settled early",
    "overpaying a hire purchase buys nothing; only settlement does");
  assert.ok(cleared.month < 36);
});

test("settling a flat loan early costs less interest than running it to term", function () {
  var s = setup([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 }
  ]);
  var toTerm = s.st.run(s.state, "minimums", 0);
  var settled = s.st.run(s.state, "avalanche", 2000);
  assert.ok(settled.totalInterest < toTerm.totalInterest);
  assert.ok(settled.monthsToDebtFree < toTerm.monthsToDebtFree);
});

test("a flat loan left on minimums runs its full term and pays every charge", function () {
  var s = setup([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 }
  ]);
  var res = s.st.run(s.state, "minimums", 0);
  assert.equal(res.monthsToDebtFree, 36);
  // 30,000 × 3.4% × 3 years = RM 3,060.
  assert.ok(Math.abs(res.totalInterest - 3060) < 1, "got " + res.totalInterest);
  assert.equal(res.order[0].via, "term");
});

// --- degenerate input -------------------------------------------------------

test("with no debts there is nothing to compare", function () {
  var s = setup([]);
  assert.equal(s.st.run(s.state, "avalanche", 500), null);
  assert.equal(s.st.compare(s.state, 500), null);
});

test("a debt with no usable terms is skipped rather than breaking the run", function () {
  var s = setup(TWO_LOANS);
  var broken = s.l.schema.newLiability("dev-1");
  broken.name = "Credit card";
  broken.principal = 0;
  broken.tenureMonths = 0;
  s.state.liabilities.push(broken);

  var res = s.st.run(s.state, "avalanche", 500);
  assert.equal(res.debts.length, 2);
});

test("simulating leaves the stored liabilities untouched", function () {
  var s = setup(TWO_LOANS);
  var before = JSON.stringify(s.state.liabilities);
  s.st.compare(s.state, 1500);
  assert.equal(JSON.stringify(s.state.liabilities), before);
});
