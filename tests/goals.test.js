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
  h.name = "Deposit fund";
  s.holdings.push(h);

  var hLocked = l.schema.newHolding("dev-1");
  hLocked.accountId = locked.id;
  hLocked.name = "Akaun 1";
  s.holdings.push(hLocked);

  var goal = l.schema.stamp({
    id: "goal-1", name: "House deposit",
    targetAmount: opts.target === undefined ? 100000 : opts.target,
    targetDate: opts.targetDate === undefined ? "2029-01" : opts.targetDate,
    linkedHoldingIds: opts.linked || []
  }, "dev-1");
  s.goals.push(goal);

  return { l: l, g: l.goals, v: l.valuations, state: s, h: h, hLocked: hLocked, goal: goal };
}

function rec(s, holdingId, period, balance, contribution) {
  s.v.upsertValuation(s.state, {
    holdingId: holdingId, period: period, balance: balance, contribution: contribution
  }, "dev-1");
}

// --- what counts toward a goal ----------------------------------------------

test("an unlinked goal counts liquid holdings only", function () {
  var s = setup();
  rec(s, s.h.id, "2026-01", 40000, null);
  rec(s, s.hLocked.id, "2026-01", 300000, null);
  // Counting EPF toward a house deposit would report being on track for something the
  // money cannot actually buy.
  assert.equal(s.g.currentValue(s.state, s.goal, "2026-01"), 40000);
});

test("a linked goal counts only the holdings named", function () {
  var s = setup({ linked: ["nope"] });
  rec(s, s.h.id, "2026-01", 40000, null);
  assert.equal(s.g.currentValue(s.state, s.goal, "2026-01"), 0);

  s.goal.linkedHoldingIds = [s.h.id];
  assert.equal(s.g.currentValue(s.state, s.goal, "2026-01"), 40000);
});

// --- required contribution --------------------------------------------------

test("required monthly allows for growth on what is already saved", function () {
  var s = setup();
  // Saving from zero at 0% growth is simply the target divided by the months.
  assert.equal(s.g.requiredMonthly(0, 12000, 0, 12), 1000);
  // With a starting balance the requirement falls.
  assert.ok(s.g.requiredMonthly(5000, 12000, 0, 12) < 1000);
});

test("a goal that growth alone will reach requires nothing", function () {
  var s = setup();
  assert.equal(s.g.requiredMonthly(100000, 105000, 10, 12), 0,
    "10% on RM 100,000 already clears RM 105,000");
});

test("months to target is null when the target is never reached", function () {
  var s = setup();
  assert.equal(s.g.monthsToTarget(1000, 1000000, 0, 0), null,
    "saving nothing at no growth never arrives");
  assert.equal(s.g.monthsToTarget(1000, 1000, 0, 0), 0, "already there");
  assert.equal(s.g.monthsToTarget(0, 12000, 0, 1000), 12);
});

// --- status -----------------------------------------------------------------

test("contributing more than required reads as on track", function () {
  var s = setup({ target: 100000, targetDate: "2027-01" });
  // A sustained habit, not one good month — the average is taken over the whole window.
  ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"].forEach(function (p) {
    rec(s, s.h.id, p, 40000, 6000);
  });
  var p = s.g.progress(s.state, s.goal, { period: "2026-01", growthPct: 4 });
  assert.equal(p.status, "on-track");
  assert.ok(p.actualMonthly >= p.requiredMonthly);
});

test("contributing less than required reads as behind, with both figures given", function () {
  var s = setup({ target: 100000, targetDate: "2027-01" });
  rec(s, s.h.id, "2026-01", 40000, 100);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01", growthPct: 4 });
  assert.equal(p.status, "behind");
  assert.ok(p.requiredMonthly > p.actualMonthly);
  assert.equal(p.shortfall, 60000);
});

test("a reached goal says so rather than demanding more", function () {
  var s = setup({ target: 30000 });
  rec(s, s.h.id, "2026-01", 40000, 0);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01" });
  assert.equal(p.status, "reached");
  assert.equal(p.pctComplete, 100);
  assert.equal(p.shortfall, 0);
});

test("a target date in the past is overdue, not silently negative", function () {
  var s = setup({ target: 100000, targetDate: "2025-01" });
  rec(s, s.h.id, "2026-01", 40000, 500);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01" });
  assert.equal(p.status, "overdue");
  assert.ok(p.monthsRemaining < 0);
});

test("with no contributions recorded the status is unknown, not behind", function () {
  var s = setup({ target: 100000, targetDate: "2029-01" });
  rec(s, s.h.id, "2026-01", 40000, null);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01" });
  assert.equal(p.status, "unknown");
  assert.equal(p.actualMonthly, null, "an absent figure must not be read as zero saving");
});

test("progress reports when the goal arrives at the current rate", function () {
  var s = setup({ target: 100000, targetDate: "2029-01" });
  rec(s, s.h.id, "2026-01", 40000, 1200);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01", growthPct: 0 });
  // RM 60,000 short at RM 200/month averaged over six months of lookback.
  assert.ok(p.monthsAtCurrentRate > 0);
  assert.equal(p.pctComplete, 40);
});

test("the average contribution is over the lookback window, not just months recorded", function () {
  var s = setup();
  // One month of RM 600 inside a six-month window is RM 100/month, not RM 600 — a
  // single good month must not read as a habit.
  rec(s, s.h.id, "2026-01", 40000, 600);
  var c = s.g.recentMonthlyContribution(s.state, s.goal, "2026-01", 6);
  assert.equal(c.monthly, 100);
  assert.equal(c.monthsSeen, 1);
});

test("a goal with no target amount is flagged rather than divided by zero", function () {
  var s = setup({ target: 0 });
  rec(s, s.h.id, "2026-01", 40000, 500);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01" });
  assert.equal(p.status, "no-target");
  assert.equal(p.pctComplete, 0);
});

test("a goal with no date reports progress but no required contribution", function () {
  var s = setup({ targetDate: null });
  rec(s, s.h.id, "2026-01", 40000, 500);
  var p = s.g.progress(s.state, s.goal, { period: "2026-01" });
  assert.equal(p.status, "no-date");
  assert.equal(p.requiredMonthly, null);
  assert.equal(p.pctComplete, 40);
});

test("progressAll covers every live goal and skips tombstones", function () {
  var s = setup();
  rec(s, s.h.id, "2026-01", 40000, 500);
  var second = s.l.schema.stamp({
    id: "goal-2", name: "Car", targetAmount: 50000, targetDate: "2028-01", linkedHoldingIds: []
  }, "dev-1");
  s.state.goals.push(second);
  assert.equal(s.g.progressAll(s.state, { period: "2026-01" }).length, 2);

  second.deleted = true;
  assert.equal(s.g.progressAll(s.state, { period: "2026-01" }).length, 1);
});
