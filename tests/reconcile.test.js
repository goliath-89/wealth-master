"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() { return helpers.loadLib(helpers.freshWindow()); }

// The reference hire purchase: RM 90,000 at 3.4% flat over 84 months from Mar 2024.
// Every instalment is RM 1,326.43, of which RM 255.00 is interest.
function hpSchedule(l) {
  return l.loans.flatSchedule({
    principal: 90000, ratePct: 3.4, tenureMonths: 84, startPeriod: "2024-03"
  });
}

test("a statement matching the engine reports an exact match", function () {
  var l = lib();
  var s = hpSchedule(l);
  var res = l.loans.reconcile(s, {
    period: "2024-03", statementInterest: 255, statementInstalment: 1326.43
  });
  assert.equal(res.found, true);
  assert.equal(res.verdict, "exact");
  assert.equal(res.interest.diff, 0);
  assert.equal(res.instalment.diff, 0);
});

test("a small difference is reported as close, with the gap stated", function () {
  var l = lib();
  var res = l.loans.reconcile(hpSchedule(l), {
    period: "2024-03", statementInterest: 257.4
  });
  assert.equal(res.verdict, "close");
  assert.equal(res.interest.diff, 2.4);
  assert.equal(res.interest.expected, 255);
  assert.equal(res.interest.actual, 257.4);
});

test("a large difference is reported as off", function () {
  var l = lib();
  var res = l.loans.reconcile(hpSchedule(l), {
    period: "2024-03", statementInterest: 480
  });
  assert.equal(res.verdict, "off");
  assert.equal(res.interest.diff, 225);
});

test("flat rate is flagged as requiring an exact match, mortgages are not", function () {
  var l = lib();
  var flat = l.loans.reconcile(hpSchedule(l), { period: "2024-03", statementInterest: 255 });
  assert.equal(flat.mustBeExact, true, "the Hire Purchase Act fixes the arithmetic");

  var red = l.loans.reconcile(
    l.loans.reducingSchedule({ principal: 350000, ratePct: 4.35, tenureMonths: 360, startPeriod: "2024-01" }),
    { period: "2024-01", statementInterest: 1268.75 }
  );
  assert.equal(red.mustBeExact, false, "daily rest makes a small gap legitimate here");
  assert.equal(red.verdict, "exact");
});

test("the worst of several comparisons decides the overall verdict", function () {
  var l = lib();
  var res = l.loans.reconcile(hpSchedule(l), {
    period: "2024-03",
    statementInterest: 255,        // exact
    statementInstalment: 1326.43,  // exact
    statementBalance: 200000       // wildly wrong
  });
  assert.equal(res.verdict, "off", "one bad figure must not be hidden by two good ones");
});

test("fields left blank are simply not compared", function () {
  var l = lib();
  var res = l.loans.reconcile(hpSchedule(l), { period: "2024-03", statementInterest: 255 });
  assert.equal(res.balance, null);
  assert.equal(res.instalment, null);
  assert.equal(res.verdict, "exact");
});

test("a month outside the schedule is explained rather than compared", function () {
  var l = lib();
  var res = l.loans.reconcile(hpSchedule(l), { period: "2019-01", statementInterest: 255 });
  assert.equal(res.found, false);
  assert.match(res.message, /outside this loan's schedule/);
});

test("reconciling needs a schedule and a valid period", function () {
  var l = lib();
  assert.equal(l.loans.reconcile(null, { period: "2024-03" }), null);
  assert.equal(l.loans.reconcile(hpSchedule(l), { period: "nonsense" }), null);
  assert.equal(l.loans.reconcile(hpSchedule(l), null), null);
});

test("a later month in the schedule is compared against that month's own row", function () {
  var l = lib();
  var s = hpSchedule(l);
  // Flat rate charges the same interest every month, so month 24 must also be 255.00.
  var res = l.loans.reconcile(s, { period: "2026-02", statementInterest: 255 });
  assert.equal(res.found, true);
  assert.equal(res.verdict, "exact");
});

test("reconciling never mutates the schedule it measures", function () {
  var l = lib();
  var s = hpSchedule(l);
  var before = JSON.stringify(s);
  l.loans.reconcile(s, { period: "2024-03", statementInterest: 999 });
  assert.equal(JSON.stringify(s), before,
    "measuring the engine must never tune it toward one statement");
});

test("v6 -> v7 migration adds the loanChecks list without touching anything else", function () {
  var l = lib();
  var out = l.store.migrate({
    schemaVersion: 6,
    liabilities: [{ id: "l1", name: "Car loan" }]
  });
  assert.equal(out.schemaVersion, l.schema.SCHEMA_VERSION);
  assert.deepEqual(out.loanChecks, []);
  assert.equal(out.liabilities[0].name, "Car loan");
});

test("loanChecks has a CSV column definition like every other entity", function () {
  var l = lib();
  assert.ok(l.csv.COLUMNS.loanChecks);
  l.schema.ENTITY_LISTS.forEach(function (e) {
    assert.ok(l.csv.COLUMNS[e], e + " must be exportable");
  });
});
