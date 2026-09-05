"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Bank";
  s.institutions.push(inst);

  var liquid = l.schema.newAccount("dev-1");
  liquid.institutionId = inst.id;
  liquid.name = "Savings";
  liquid.class = "cash";
  liquid.liquid = true;
  s.accounts.push(liquid);

  var locked = l.schema.newAccount("dev-1");
  locked.institutionId = inst.id;
  locked.name = "EPF";
  locked.class = "retirement";
  locked.liquid = false;
  s.accounts.push(locked);

  var h = l.schema.newHolding("dev-1");
  h.accountId = liquid.id;
  h.name = "Savings";
  s.holdings.push(h);

  var hLocked = l.schema.newHolding("dev-1");
  hLocked.accountId = locked.id;
  hLocked.name = "Akaun 1";
  s.holdings.push(hLocked);

  if (opts.expenses !== undefined) s.settings.monthlyExpenses = opts.expenses;
  if (opts.income !== undefined) s.settings.monthlyIncome = opts.income;

  return { l: l, a: l.analytics, v: l.valuations, state: s, h: h, hLocked: hLocked };
}

function rec(s, holdingId, period, balance, contribution) {
  s.v.upsertValuation(s.state, {
    holdingId: holdingId, period: period, balance: balance, contribution: contribution
  }, "dev-1");
}

// --- emergency runway (FR-4.5) ----------------------------------------------

test("runway is liquid money divided by monthly expenses", function () {
  var s = setup({ expenses: 5000 });
  rec(s, s.h.id, "2026-01", 30000, null);
  var r = s.a.emergencyRunway(s.state, "2026-01");
  assert.equal(r.months, 6);
  assert.equal(r.liquid, 30000);
});

test("illiquid money is excluded from the runway", function () {
  var s = setup({ expenses: 5000 });
  rec(s, s.h.id, "2026-01", 30000, null);
  rec(s, s.hLocked.id, "2026-01", 500000, null);
  // EPF is not an emergency fund — the figure is about what you can reach this week.
  assert.equal(s.a.emergencyRunway(s.state, "2026-01").months, 6);
});

test("without a monthly expense figure the runway is null, not a guess", function () {
  var s = setup();
  rec(s, s.h.id, "2026-01", 30000, null);
  var r = s.a.emergencyRunway(s.state, "2026-01");
  assert.equal(r.months, null);
  assert.equal(r.reason, "no-expenses");
  assert.equal(r.liquid, 30000, "the liquid total is still reported");
});

test("runway reports a fraction of a month rather than rounding to nothing", function () {
  var s = setup({ expenses: 4000 });
  rec(s, s.h.id, "2026-01", 10000, null);
  assert.equal(s.a.emergencyRunway(s.state, "2026-01").months, 2.5);
});

// --- savings rate (FR-4.6) --------------------------------------------------

test("savings rate is contributions over income across the window", function () {
  var s = setup({ income: 10000 });
  // RM 2,000 a month for twelve months against RM 10,000 income is 20%.
  var p = "2026-12";
  for (var i = 0; i < 12; i++) {
    rec(s, s.h.id, p, 50000, 2000);
    p = s.v.prevPeriod(p);
  }
  var r = s.a.savingsRate(s.state, "2026-12", 12);
  assert.equal(r.pct, 20);
  assert.equal(r.contributed, 24000);
  assert.equal(r.monthlyAverage, 2000);
});

test("a month with no contribution counts as a month at zero", function () {
  var s = setup({ income: 10000 });
  // Six months of RM 2,000 across a twelve-month window is 10%, not 20% — excluding the
  // months you did not save in would flatter the rate.
  var p = "2026-12";
  for (var i = 0; i < 6; i++) {
    rec(s, s.h.id, p, 50000, 2000);
    p = s.v.prevPeriod(p);
  }
  assert.equal(s.a.savingsRate(s.state, "2026-12", 12).pct, 10);
});

test("without an income figure the rate is null, not zero", function () {
  var s = setup();
  rec(s, s.h.id, "2026-01", 50000, 2000);
  var r = s.a.savingsRate(s.state, "2026-01", 12);
  assert.equal(r.pct, null);
  assert.equal(r.reason, "no-income");
  assert.equal(r.contributed, 2000, "what was contributed is still reported");
});

test("contributions outside the window are excluded", function () {
  var s = setup({ income: 10000 });
  rec(s, s.h.id, "2026-12", 50000, 1000);
  rec(s, s.h.id, "2024-01", 50000, 99000);
  assert.equal(s.a.savingsRate(s.state, "2026-12", 12).contributed, 1000);
});

test("liability entries never count as savings", function () {
  var s = setup({ income: 10000 });
  var loan = s.l.schema.newLiability("dev-1");
  loan.name = "Car loan";
  s.state.liabilities.push(loan);
  s.v.upsertValuation(s.state, {
    liabilityId: loan.id, period: "2026-12", balance: 30000, contribution: 5000
  }, "dev-1");
  assert.equal(s.a.savingsRate(s.state, "2026-12", 12).contributed, 0);
});

test("a tombstoned valuation is excluded from the rate", function () {
  var s = setup({ income: 10000 });
  rec(s, s.h.id, "2026-12", 50000, 2000);
  s.state.valuations[0].deleted = true;
  assert.equal(s.a.savingsRate(s.state, "2026-12", 12).contributed, 0);
});
