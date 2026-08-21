"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var state = l.schema.blank();
  var h = l.schema.newHolding("dev-1");
  h.name = "KDI Save";
  state.holdings.push(h);
  return { l: l, v: l.valuations, state: state, h: h };
}

// --- the central rule: blank is not zero ------------------------------------

test("a blank amount parses to null, not zero", function () {
  var v = setup().v;
  assert.equal(v.parseAmount("").value, null);
  assert.equal(v.parseAmount("   ").value, null);
  assert.equal(v.parseAmount(null).value, null);
});

test("a typed zero parses to zero, and is not confused with blank", function () {
  var v = setup().v;
  var zero = v.parseAmount("0");
  assert.equal(zero.value, 0);
  assert.equal(zero.error, null);
  assert.notEqual(zero.value, null, "0 and null must stay distinguishable");
});

test("thousands separators and a leading RM are accepted, as written on a statement", function () {
  var v = setup().v;
  assert.equal(v.parseAmount("1,234.56").value, 1234.56);
  assert.equal(v.parseAmount("RM 9,500,000").value, 9500000);
  assert.equal(v.parseAmount("-150").value, -150, "negative income must survive");
});

test("the minus is read whether it sits before or after the currency", function () {
  var v = setup().v;
  assert.equal(v.parseAmount("-RM 150").value, -150);
  assert.equal(v.parseAmount("RM -150").value, -150);
});

test("nonsense is an error rather than a silent zero", function () {
  var v = setup().v;
  var bad = v.parseAmount("abc");
  assert.equal(bad.error, "not a number");
  assert.equal(bad.value, null);
  assert.equal(v.parseAmount("12.3.4").error, "not a number");
});

// --- display formatting -----------------------------------------------------

test("amounts display as currency with thousands separators", function () {
  var v = setup().v;
  assert.equal(v.formatAmount(5000), "RM 5,000");
  assert.equal(v.formatAmount(50000), "RM 50,000");
  assert.equal(v.formatAmount(9500000), "RM 9,500,000");
});

test("cents show only when there are cents, so round figures stay clean", function () {
  var v = setup().v;
  assert.equal(v.formatAmount(166.67), "RM 166.67");
  assert.equal(v.formatAmount(1234.5), "RM 1,234.50");
  assert.equal(v.formatAmount(5000), "RM 5,000", "no .00 padding on a round balance");
});

test("a negative amount keeps the minus in front of the currency", function () {
  var v = setup().v;
  assert.equal(v.formatAmount(-150), "-RM 150");
});

test("zero formats as a real figure, and blank formats as empty", function () {
  var v = setup().v;
  assert.equal(v.formatAmount(0), "RM 0");
  assert.equal(v.formatAmount(null), "");
  assert.equal(v.formatAmount(undefined), "");
});

test("anything formatAmount produces can be parsed back to the same number", function () {
  var v = setup().v;
  // The round trip is what makes formatting safe: a field that displays a value it
  // cannot read back would silently stop saving.
  [0, 5000, 50000, 9500000, 166.67, 1234.5, -150, -9500000.25, 0.01].forEach(function (n) {
    var round = v.parseAmount(v.formatAmount(n));
    assert.equal(round.error, null, "formatted " + n + " must parse");
    assert.equal(round.value, n, "round trip must preserve " + n);
  });
});

test("rawAmount gives plain digits for editing, with no separators", function () {
  var v = setup().v;
  assert.equal(v.rawAmount(50000), "50000");
  assert.equal(v.rawAmount(166.67), "166.67");
  assert.equal(v.rawAmount(-150), "-150");
  assert.equal(v.rawAmount(null), "");
});

test("a lone minus sign or stray currency symbol is an error, not zero", function () {
  var v = setup().v;
  assert.equal(v.parseAmount("-").error, "not a number");
  assert.equal(v.parseAmount("RM").error, "not a number");
  assert.equal(v.parseAmount("5O,000").error, "not a number", "letter O among digits is a typo, not a value");
});

// --- periods ----------------------------------------------------------------

test("period validation accepts YYYY-MM only", function () {
  var v = setup().v;
  assert.equal(v.isPeriod("2026-08"), true);
  assert.equal(v.isPeriod("2026-13"), false);
  assert.equal(v.isPeriod("2026-00"), false);
  assert.equal(v.isPeriod("2026-8"), false);
  assert.equal(v.isPeriod("2026-08-01"), false);
});

test("prevPeriod rolls back across a year boundary", function () {
  var v = setup().v;
  assert.equal(v.prevPeriod("2026-08"), "2026-07");
  assert.equal(v.prevPeriod("2026-01"), "2025-12");
  assert.equal(v.prevPeriod("nonsense"), null);
});

test("currentPeriod zero-pads the month", function () {
  var v = setup().v;
  assert.equal(v.currentPeriod(new Date(2026, 2, 15)), "2026-03");
});

// --- upsert -----------------------------------------------------------------

test("a new entry is created and stamped", function () {
  var s = setup();
  var res = s.v.upsertValuation(s.state, {
    holdingId: s.h.id, period: "2026-08", balance: 50000, contribution: null,
    withdrawal: null, income: 200
  }, "dev-9");
  assert.equal(res.action, "created");
  assert.equal(s.state.valuations.length, 1);
  assert.equal(res.record.balance, 50000);
  assert.equal(res.record.contribution, null, "unrecorded stays null, not 0");
  assert.equal(res.record.deviceId, "dev-9");
});

test("saving the same holding and period again updates rather than duplicating", function () {
  var s = setup();
  var entry = { holdingId: s.h.id, period: "2026-08", balance: 100, contribution: null, withdrawal: null, income: null };
  s.v.upsertValuation(s.state, entry, "dev-1");
  entry.balance = 200;
  var res = s.v.upsertValuation(s.state, entry, "dev-1");
  assert.equal(res.action, "updated");
  assert.equal(s.state.valuations.length, 1);
  assert.equal(s.v.valuationFor(s.state, s.h.id, "2026-08").balance, 200);
});

test("clearing every field on an existing entry tombstones it", function () {
  var s = setup();
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-08", balance: 100 }, "dev-1");
  var res = s.v.upsertValuation(s.state, {
    holdingId: s.h.id, period: "2026-08", balance: null, contribution: null, withdrawal: null, income: null, note: ""
  }, "dev-1");
  assert.equal(res.action, "deleted");
  assert.equal(s.state.valuations.length, 1, "tombstone, not removal");
  assert.equal(s.state.valuations[0].deleted, true);
  assert.equal(s.v.valuationFor(s.state, s.h.id, "2026-08"), null);
});

test("an entirely empty entry for a holding with no record creates nothing", function () {
  var s = setup();
  var res = s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-08" }, "dev-1");
  assert.equal(res.action, "none");
  assert.equal(s.state.valuations.length, 0, "empty rows must not accumulate");
});

test("a note alone is enough to keep an entry alive", function () {
  var s = setup();
  var res = s.v.upsertValuation(s.state, {
    holdingId: s.h.id, period: "2026-08", note: "statement not issued yet"
  }, "dev-1");
  assert.equal(res.action, "created");
  assert.equal(res.record.balance, null);
});

test("a balance of zero is a real record, not an empty one", function () {
  var s = setup();
  var res = s.v.upsertValuation(s.state, {
    holdingId: s.h.id, period: "2026-08", balance: 0, contribution: null, withdrawal: null, income: null
  }, "dev-1");
  assert.equal(res.action, "created", "an account emptied to zero must be recordable");
  assert.equal(res.record.balance, 0);
});

// --- bulk month -------------------------------------------------------------

test("applyMonth saves every valid row and reports counts", function () {
  var s = setup();
  var h2 = s.l.schema.newHolding("dev-1");
  s.state.holdings.push(h2);

  var res = s.v.applyMonth(s.state, "2026-08", [
    { holdingId: s.h.id, balance: "1,000" },
    { holdingId: h2.id, balance: "2000", income: "5.50" }
  ], "dev-1");

  assert.equal(res.created, 2);
  assert.equal(res.errors.length, 0);
  assert.equal(s.v.valuationFor(s.state, s.h.id, "2026-08").balance, 1000);
  assert.equal(s.v.valuationFor(s.state, h2.id, "2026-08").income, 5.5);
});

test("one bad row is reported and skipped while the rest still save", function () {
  var s = setup();
  var h2 = s.l.schema.newHolding("dev-1");
  s.state.holdings.push(h2);

  var res = s.v.applyMonth(s.state, "2026-08", [
    { holdingId: s.h.id, balance: "oops" },
    { holdingId: h2.id, balance: "2000" }
  ], "dev-1");

  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].holdingId, s.h.id);
  assert.equal(res.errors[0].field, "balance");
  assert.equal(res.created, 1, "a typo in one row must not cost the whole month");
  assert.equal(s.v.valuationFor(s.state, h2.id, "2026-08").balance, 2000);
  assert.equal(s.v.valuationFor(s.state, s.h.id, "2026-08"), null);
});

test("applyMonth refuses an invalid period outright", function () {
  var s = setup();
  var res = s.v.applyMonth(s.state, "2026-99", [{ holdingId: s.h.id, balance: "1" }], "dev-1");
  assert.equal(res.errors.length, 1);
  assert.equal(res.created, 0);
  assert.equal(s.state.valuations.length, 0);
});

// --- context for entry ------------------------------------------------------

test("lastRecordedBefore finds the most recent earlier balance, skipping blanks", function () {
  var s = setup();
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-05", balance: 100 }, "dev-1");
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-06", note: "no statement" }, "dev-1");
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-09", balance: 999 }, "dev-1");

  var prior = s.v.lastRecordedBefore(s.state, s.h.id, "2026-08");
  assert.equal(prior.period, "2026-05", "a note-only month has no balance to carry");
});

test("lastRecordedBefore ignores tombstoned entries", function () {
  var s = setup();
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-05", balance: 100 }, "dev-1");
  s.state.valuations[0].deleted = true;
  assert.equal(s.v.lastRecordedBefore(s.state, s.h.id, "2026-08"), null);
});

test("periodsInState lists distinct periods in order, excluding tombstones", function () {
  var s = setup();
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-09", balance: 1 }, "dev-1");
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-07", balance: 1 }, "dev-1");
  assert.deepEqual(s.v.periodsInState(s.state), ["2026-07", "2026-09"]);
});
