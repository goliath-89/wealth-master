"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = "2026-01";

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Bank";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = opts.class || "investment";
  acct.liquid = opts.liquid === undefined ? true : opts.liquid;
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "Fund";
  s.holdings.push(h);
  l.valuations.upsertValuation(s, { holdingId: h.id, period: period, balance: opts.balance || 100000 }, "dev-1");

  s.scenarios = l.forecast.defaultScenarios("dev-1");
  return { l: l, f: l.forecast, state: s, acct: acct, h: h, period: period };
}

function scenario(s, name) {
  return s.state.scenarios.filter(function (x) { return x.name === name; })[0];
}

// --- growth -----------------------------------------------------------------

test("twelve months of monthly growth compounds to the annual rate", function () {
  var s = setup();
  // Using annual/12 instead of the twelfth root would overshoot; this asserts it does not.
  var f = s.f.monthlyFactor(6);
  assert.ok(Math.abs(Math.pow(f, 12) - 1.06) < 1e-9);
});

test("a projection starts from the current position and grows from there", function () {
  var s = setup({ balance: 100000 });
  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 12, s.period);

  assert.equal(p.points[0].net, 100000, "month zero is today, unchanged");
  assert.equal(p.points[0].projected, false, "and is not a projection");
  // Base grows investments at 6%.
  assert.ok(Math.abs(p.points[12].net - 106000) < 1, "expected about RM 106,000, got " + p.points[12].net);
  assert.equal(p.points[12].projected, true);
});

test("growth is applied per asset class, not one rate for everything", function () {
  var s = setup({ class: "cash", balance: 100000 });
  var cash = s.f.projectScenario(s.state, scenario(s, "Base"), 12, s.period);

  var s2 = setup({ class: "investment", balance: 100000 });
  var inv = s2.f.projectScenario(s2.state, scenario(s2, "Base"), 12, s2.period);

  // Base assumes 2.5% on cash and 6% on investments — a single blended rate would
  // flatter the cash position.
  assert.ok(inv.points[12].net > cash.points[12].net);
  assert.ok(Math.abs(cash.points[12].net - 102500) < 1);
});

test("monthly contributions are added to liquid holdings", function () {
  var s = setup({ balance: 100000 });
  var base = scenario(s, "Base");
  var without = s.f.projectScenario(s.state, base, 12, s.period);

  base.monthlyContribution = 1000;
  var with_ = s.f.projectScenario(s.state, base, 12, s.period);

  assert.ok(with_.points[12].net > without.points[12].net + 11000,
    "twelve months of RM 1,000 plus growth on it");
});

test("contributions do not inflate an illiquid asset", function () {
  var s = setup({ balance: 100000, liquid: false });
  var base = scenario(s, "Base");
  base.monthlyContribution = 1000;
  var p = s.f.projectScenario(s.state, base, 12, s.period);
  // Growth only — the RM 12,000 has nowhere liquid to go, so it must not silently
  // enlarge a property or a locked retirement account.
  assert.ok(Math.abs(p.points[12].net - 106000) < 1);
});

// --- liabilities amortise (FR-5.3) ------------------------------------------

test("liabilities amortise using the loan engine, not a guess", function () {
  var s = setup({ balance: 100000 });
  var loan = s.l.schema.newLiability("dev-1");
  loan.name = "Car loan";
  loan.rateBasis = "flat";
  loan.principal = 90000;
  loan.ratePct = 3.4;
  loan.tenureMonths = 84;
  loan.startDate = "2026-01";
  s.state.liabilities.push(loan);
  s.l.valuations.upsertValuation(s.state, {
    liabilityId: loan.id, period: "2026-01", balance: 90000
  }, "dev-1");

  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 12, s.period);
  var sched = s.l.loans.scheduleFor(loan);
  var row = sched.rows.filter(function (r) { return r.period === "2027-01"; })[0];

  // The projection and the loan schedule must never disagree.
  assert.equal(p.points[12].liabilities, row.balance);
  assert.ok(p.points[12].liabilities < 90000, "debt must fall over the year");
});

test("a loan that finishes inside the horizon drops to zero, not to its last balance", function () {
  var s = setup({ balance: 100000 });
  var loan = s.l.schema.newLiability("dev-1");
  loan.name = "Short loan";
  loan.rateBasis = "flat";
  loan.principal = 12000;
  loan.ratePct = 3;
  loan.tenureMonths = 12;
  loan.startDate = "2026-01";
  s.state.liabilities.push(loan);

  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 24, s.period);
  assert.equal(p.points[24].liabilities, 0, "a repaid loan is gone, not frozen");
});

test("a liability with no usable terms holds flat rather than disappearing", function () {
  var s = setup({ balance: 100000 });
  var loan = s.l.schema.newLiability("dev-1");
  loan.name = "Credit card";
  loan.principal = 0;
  loan.tenureMonths = 0;
  s.state.liabilities.push(loan);
  s.l.valuations.upsertValuation(s.state, {
    liabilityId: loan.id, period: "2026-01", balance: 5000
  }, "dev-1");

  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 12, s.period);
  assert.equal(p.points[12].liabilities, 5000,
    "dropping an unmodelled debt would overstate net worth");
});

// --- R3: never a single confident number ------------------------------------

test("projections are produced as a set of scenarios", function () {
  var s = setup();
  var all = s.f.projectAll(s.state, 12, s.period);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map(function (p) { return p.scenarioName; }),
    ["Conservative", "Base", "Optimistic"]);
});

test("every projection carries its assumptions and an illustrative flag", function () {
  var s = setup();
  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 12, s.period);
  assert.equal(p.illustrative, true);
  assert.equal(p.assumptions.growth.investment, 6);
  assert.equal(p.assumptions.inflationPct, 2.5);
  assert.ok(Object.prototype.hasOwnProperty.call(p.assumptions, "monthlyContribution"));
});

test("the scenarios spread apart over time, and the range is reportable", function () {
  var s = setup({ balance: 100000 });
  var all = s.f.projectAll(s.state, 120, s.period);
  var near = s.f.rangeAt(all, 12);
  var far = s.f.rangeAt(all, 120);

  assert.ok(far.spread > near.spread, "uncertainty must widen with the horizon");
  assert.ok(far.high > far.low);
});

test("projected points are flagged so they can never be shown as actuals", function () {
  var s = setup();
  var p = s.f.projectScenario(s.state, scenario(s, "Base"), 6, s.period);
  assert.equal(p.points.filter(function (x) { return !x.projected; }).length, 1,
    "only the opening point is real");
});

test("an empty store projects nothing rather than a confident zero", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  s.scenarios = l.forecast.defaultScenarios("dev-1");
  var all = l.forecast.projectAll(s, 12, "2026-01");
  assert.equal(all[0].points[12].net, 0);
  assert.equal(all[0].openingNet, 0);
});

test("with no scenarios defined nothing is projected", function () {
  var s = setup();
  s.state.scenarios = [];
  assert.deepEqual(s.f.projectAll(s.state, 12, s.period), []);
});

// --- inflation --------------------------------------------------------------

test("real terms discounts a future figure back to today's money", function () {
  var s = setup();
  // RM 106,000 in a year at 2.5% inflation is about RM 103,415 today.
  var real = s.f.inRealTerms(106000, 2.5, 12);
  assert.ok(Math.abs(real - 103414.63) < 1, "got " + real);
  assert.equal(s.f.inRealTerms(100000, 0, 120), 100000, "no inflation, no discount");
});
