"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Principal";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Unit trust";
  acct.class = "investment";
  s.accounts.push(acct);
  return { l: l, se: l.series, v: l.valuations, state: s, acct: acct, inst: inst };
}

function addHolding(s, name) {
  var h = s.l.schema.newHolding("dev-1");
  h.accountId = s.acct.id;
  h.name = name;
  s.state.holdings.push(h);
  return h;
}

function rec(s, holdingId, period, fields) {
  s.v.upsertValuation(s.state, Object.assign({ holdingId: holdingId, period: period }, fields), "dev-1");
}

function valuesOf(series) {
  return series.points.map(function (p) { return p.value; });
}

// --- balance series (FR-6.3) ------------------------------------------------

test("a balance series covers every period in the store, oldest first", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund");
  rec(s, h.id, "2026-01", { balance: 10000 });
  rec(s, h.id, "2026-03", { balance: 12000 });

  var out = s.se.balanceSeries(s.state);
  assert.deepEqual(out.periods, ["2026-01", "2026-03"]);
  assert.equal(out.series.length, 1);
  assert.deepEqual(valuesOf(out.series[0]), [10000, 12000]);
});

test("a holding is blank before its first recorded month, never zero", function () {
  var s = setup();
  var early = addHolding(s, "Old fund");
  var late = addHolding(s, "New fund");
  rec(s, early.id, "2026-01", { balance: 10000 });
  rec(s, late.id, "2026-02", { balance: 5000 });

  var out = s.se.balanceSeries(s.state);
  var lateSeries = out.series.filter(function (x) { return x.id === late.id; })[0];
  // An account opened in February must not appear at RM 0 in January — that would be
  // six months of invented history on a longer series.
  assert.equal(lateSeries.points[0].value, null);
  assert.equal(lateSeries.points[1].value, 5000);
});

test("an unrecorded month carries forward and is marked stale", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund");
  var other = addHolding(s, "Bond fund");
  rec(s, h.id, "2026-01", { balance: 10000 });
  rec(s, other.id, "2026-02", { balance: 500 });

  var out = s.se.balanceSeries(s.state);
  var eq = out.series.filter(function (x) { return x.id === h.id; })[0];
  assert.equal(eq.points[1].value, 10000, "the balance is carried, not dropped");
  assert.equal(eq.points[1].stale, true);
  assert.equal(eq.points[1].sourcePeriod, "2026-01");
  assert.equal(eq.points[0].stale, false);
});

test("a holding with nothing recorded is left out rather than drawn flat", function () {
  var s = setup();
  var h = addHolding(s, "Funded");
  addHolding(s, "Never valued");
  rec(s, h.id, "2026-01", { balance: 10000 });

  var out = s.se.balanceSeries(s.state);
  assert.equal(out.series.length, 1);
  assert.equal(out.series[0].name, "Funded");
});

test("the series range spans every recorded value", function () {
  var s = setup();
  var a = addHolding(s, "A fund");
  var b = addHolding(s, "B fund");
  rec(s, a.id, "2026-01", { balance: 90000 });
  rec(s, b.id, "2026-01", { balance: 1500 });

  var out = s.se.balanceSeries(s.state);
  assert.equal(out.min, 1500);
  assert.equal(out.max, 90000);
});

test("a holding on an archived account drops out of the series", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund");
  rec(s, h.id, "2026-01", { balance: 10000 });
  s.acct.archived = true;

  assert.equal(s.se.balanceSeries(s.state).series.length, 0);
});

test("series order is stable, so a line keeps its colour between renders", function () {
  var s = setup();
  addHolding(s, "Zebra fund");
  var a = addHolding(s, "Alpha fund");
  var z = s.state.holdings[0];
  rec(s, z.id, "2026-01", { balance: 100 });
  rec(s, a.id, "2026-01", { balance: 200 });

  var names = s.se.balanceSeries(s.state).series.map(function (x) { return x.name; });
  assert.deepEqual(names, ["Alpha fund", "Zebra fund"]);
});

// --- income by month (FR-6.4) -----------------------------------------------

test("income is split by the holding that paid it", function () {
  var s = setup();
  var a = addHolding(s, "Equity fund");
  var b = addHolding(s, "Sukuk fund");
  rec(s, a.id, "2026-01", { balance: 10000, income: 300 });
  rec(s, b.id, "2026-01", { balance: 5000, income: 100 });
  rec(s, a.id, "2026-02", { balance: 10200, income: 250 });

  var out = s.se.incomeByMonth(s.state);
  assert.equal(out.sources.length, 2);
  assert.equal(out.sources[0].name, "Equity fund", "biggest payer first");
  assert.equal(out.sources[0].total, 550);
  assert.equal(out.rows[0].total, 400);
  assert.equal(out.rows[1].total, 250);
  assert.equal(out.grandTotal, 650);
});

test("a month with no income recorded is a real zero, not a gap", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund");
  rec(s, h.id, "2026-01", { balance: 10000, income: 300 });
  rec(s, h.id, "2026-02", { balance: 10000 });

  var out = s.se.incomeByMonth(s.state);
  // Income is a flow, not a stock: it does not carry forward, and a month that paid
  // nothing genuinely paid nothing.
  assert.equal(out.rows[1].total, 0);
  assert.equal(out.rows[1].parts[0].value, 0);
});

test("a holding that never paid income gets no band", function () {
  var s = setup();
  var a = addHolding(s, "Equity fund");
  var b = addHolding(s, "Growth fund");
  rec(s, a.id, "2026-01", { balance: 10000, income: 300 });
  rec(s, b.id, "2026-01", { balance: 8000 });

  var out = s.se.incomeByMonth(s.state);
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].name, "Equity fund");
});

test("every row carries a part per source, so bands stack in one order", function () {
  var s = setup();
  var a = addHolding(s, "Equity fund");
  var b = addHolding(s, "Sukuk fund");
  rec(s, a.id, "2026-01", { balance: 10000, income: 300 });
  rec(s, b.id, "2026-02", { balance: 5000, income: 100 });

  var out = s.se.incomeByMonth(s.state);
  out.rows.forEach(function (r) {
    assert.equal(r.parts.length, out.sources.length);
    assert.deepEqual(r.parts.map(function (p) { return p.id; }),
      out.sources.map(function (x) { return x.id; }));
  });
});

// --- rolling yield (FR-6.8) -------------------------------------------------

test("a rolling yield needs enough months before it reports anything", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  rec(s, h.id, "2026-01", { balance: 12000, income: 40 });
  assert.equal(s.se.rollingYield(s.state, h.id, "2026-01"), null, "one month is not a rate");
  rec(s, h.id, "2026-02", { balance: 12000, income: 40 });
  assert.equal(s.se.rollingYield(s.state, h.id, "2026-02"), null);
  rec(s, h.id, "2026-03", { balance: 12000, income: 40 });
  assert.ok(s.se.rollingYield(s.state, h.id, "2026-03"), "three months is the floor");
});

test("the rolling yield annualises the months inside the window", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 40 });
  });
  // RM 40 a month on RM 12,000 is RM 480 a year, which is 4%.
  assert.equal(s.se.rollingYield(s.state, h.id, "2026-03").pct, 4);
});

test("the window moves: months older than it drop out", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  // A fat year, then a thin one.
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 80 });
  });
  ["2026-04", "2026-05", "2026-06"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 20 });
  });

  var wide = s.se.rollingYield(s.state, h.id, "2026-06", 12);
  var narrow = s.se.rollingYield(s.state, h.id, "2026-06", 3);
  assert.equal(wide.months, 6);
  assert.equal(narrow.months, 3, "only the last three months are inside a 3-month window");
  assert.equal(narrow.pct, 2, "RM 20 a month on RM 12,000 is 2%");
  assert.ok(wide.pct > narrow.pct, "the fat months still count in the wider window");
});

test("months with no income recorded are not counted as zero-income months", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 40 });
  });
  rec(s, h.id, "2026-04", { balance: 12000 });

  // Blank is not zero: an unrecorded month must not dilute the average and drag the
  // reported yield down.
  var y = s.se.rollingYield(s.state, h.id, "2026-04");
  assert.equal(y.months, 3);
  assert.equal(y.pct, 4);
});

test("a yield series reports null until the window fills, then a figure", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 40 });
  });

  var out = s.se.yieldSeries(s.state);
  assert.deepEqual(valuesOf(out.series[0]), [null, null, 4]);
  assert.equal(out.unit, "percent");
  assert.equal(out.windowMonths, 12);
});

test("a holding that never has enough months is left out of the yield chart", function () {
  var s = setup();
  var h = addHolding(s, "Income fund");
  var q = addHolding(s, "Quiet fund");
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 12000, income: 40 });
    rec(s, q.id, p, { balance: 5000 });
  });

  var out = s.se.yieldSeries(s.state);
  assert.equal(out.series.length, 1);
  assert.equal(out.series[0].name, "Income fund");
});

test("a zero balance cannot produce a yield", function () {
  var s = setup();
  var h = addHolding(s, "Closed fund");
  ["2026-01", "2026-02", "2026-03"].forEach(function (p) {
    rec(s, h.id, p, { balance: 0, income: 0 });
  });
  assert.equal(s.se.rollingYield(s.state, h.id, "2026-03"), null);
});

test("series building never mutates the store", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund");
  rec(s, h.id, "2026-01", { balance: 10000, income: 300 });
  rec(s, h.id, "2026-02", { balance: 10500, income: 300 });
  rec(s, h.id, "2026-03", { balance: 11000, income: 300 });
  var before = JSON.stringify(s.state);

  s.se.balanceSeries(s.state);
  s.se.incomeByMonth(s.state);
  s.se.yieldSeries(s.state);

  assert.equal(JSON.stringify(s.state), before);
});
