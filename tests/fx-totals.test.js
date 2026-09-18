"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-9.6, second half. fx.test.js covers the conversion itself and fx-ui.test.js the
// net worth screen. This file covers every OTHER total that sums across holdings.
//
// The defect these were written for: net worth converted, and nothing else did. A USD
// 10,000 holding with no rate was left out of net worth and simultaneously counted as
// RM 10,000 in the allocation donut directly beneath it — two figures on one screen,
// disagreeing, with no way for the owner to tell which was the lie.

function setup(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Wise";
  inst.pidmMember = true;
  s.institutions.push(inst);

  function account(name, currency) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = "cash";
    a.liquid = true;
    a.currency = currency;
    a.pidmProtected = !!opts.pidm;
    s.accounts.push(a);
    return a;
  }
  function holding(acct, name, feePct) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    h.feePct = feePct || 0;
    s.holdings.push(h);
    return h;
  }

  var usdAcct = account("Multi-currency", "USD");
  var myrAcct = account("Savings", "MYR");
  var usd = holding(usdAcct, "USD cash", opts.fee);
  var myr = holding(myrAcct, "Maybank", opts.fee);

  return { l: l, state: s, period: period, usd: usd, myr: myr, inst: inst };
}

function rec(f, holding, fields) {
  fields.holdingId = holding.id;
  if (!fields.period) fields.period = f.period;
  f.l.valuations.upsertValuation(f.state, fields, "dev-1");
}

// --- allocation (FR-4.3) ----------------------------------------------------

test("allocation converts a foreign holding rather than counting it as ringgit", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000, fxRate: 4.2 });
  rec(f, f.myr, { balance: 5000 });

  var alloc = f.l.analytics.allocation(f.state, f.period, "class");
  // RM 42,000 plus RM 5,000 — not the RM 15,000 face-value sum.
  assert.equal(alloc.total, 47000);
});

test("allocation leaves out a holding no rate can convert", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000 });
  rec(f, f.myr, { balance: 5000 });

  var alloc = f.l.analytics.allocation(f.state, f.period, "class");
  // The same figure net worth reports. Two screens, one answer.
  assert.equal(alloc.total, 5000);
  assert.equal(f.l.networth.positionAt(f.state, f.period).assets, 5000);
});

test("the currency dimension groups by currency but values in ringgit", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000, fxRate: 4.2 });
  rec(f, f.myr, { balance: 5000 });

  var alloc = f.l.analytics.allocation(f.state, f.period, "currency");
  var usd = alloc.slices.filter(function (x) { return x.label === "USD"; })[0];
  assert.equal(usd.value, 42000, "the slice says how much ringgit sits in USD");
  assert.equal(Math.round(usd.share), 89);
});

// --- fee drag (FR-4.7) ------------------------------------------------------

test("fee drag charges a foreign balance in ringgit", function () {
  var f = setup({ fee: 1.5 });
  rec(f, f.usd, { balance: 10000, fxRate: 4.2 });

  var drag = f.l.analytics.feeDrag(f.state, f.period);
  // 1.5% of RM 42,000, not of RM 10,000.
  assert.equal(drag.totalAnnualFee, 630);
});

test("fee drag omits a holding it cannot convert", function () {
  var f = setup({ fee: 1.5 });
  rec(f, f.usd, { balance: 10000 });

  var drag = f.l.analytics.feeDrag(f.state, f.period);
  assert.equal(drag.totalAnnualFee, 0);
  assert.equal(drag.lines.length, 0, "a fee on an unknown ringgit balance is unknown");
});

// --- PIDM (FR-4.4) ----------------------------------------------------------

test("PIDM exposure compares a converted balance against the ringgit limit", function () {
  var f = setup({ pidm: true });
  // USD 60,000 is RM 252,000 — over the limit, though the raw figure is nowhere near it.
  rec(f, f.usd, { balance: 60000, fxRate: 4.2 });

  var rows = f.l.analytics.pidmExposure(f.state, f.period);
  assert.equal(rows[0].protectedTotal, 252000);
  assert.equal(rows[0].overLimit, true);
  assert.equal(rows[0].excess, 2000);
});

test("PIDM exposure leaves out a deposit it cannot convert", function () {
  var f = setup({ pidm: true });
  rec(f, f.usd, { balance: 60000 });
  rec(f, f.myr, { balance: 1000 });

  var rows = f.l.analytics.pidmExposure(f.state, f.period);
  assert.equal(rows[0].protectedTotal, 1000);
  assert.equal(rows[0].overLimit, false);
});

// --- charts (FR-6.3, FR-6.4) ------------------------------------------------

test("the balance series plots ringgit, and breaks where no rate converts", function () {
  var f = setup();
  var earlier = f.l.valuations.prevPeriod(f.period);
  rec(f, f.usd, { period: earlier, balance: 10000, fxRate: 4.2 });
  // This month's balance is recorded, but the rate is not carried by the valuation —
  // fx carries the earlier rate forward, so the point still plots, marked stale.
  rec(f, f.usd, { period: f.period, balance: 11000 });

  var series = f.l.series.balanceSeries(f.state, f.period);
  var line = series.series.filter(function (s) { return s.id === f.usd.id; })[0];
  var pts = line.points;
  assert.equal(pts[pts.length - 2].value, 42000);
  assert.equal(pts[pts.length - 1].value, 46200, "carried at 4.2, not plotted as 11,000");
});

test("a holding that never had a rate has no line rather than a ringgit-shaped one", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000 });
  rec(f, f.myr, { balance: 5000 });

  var series = f.l.series.balanceSeries(f.state, f.period);
  // Every point is null, so the series has no data and is dropped rather than drawn —
  // a USD figure must never be plotted against a ringgit axis.
  assert.equal(series.series.filter(function (s) { return s.id === f.usd.id; }).length, 0);
  assert.equal(series.series.length, 1);
  assert.equal(series.max, 5000);
});

test("foreign income is stacked in ringgit, and omitted when no rate exists", function () {
  var f = setup();
  var earlier = f.l.valuations.prevPeriod(f.period);
  rec(f, f.usd, { period: earlier, balance: 10000, income: 100 });
  rec(f, f.usd, { period: f.period, balance: 10000, income: 100, fxRate: 4.2 });
  rec(f, f.myr, { period: f.period, balance: 5000, income: 50 });

  var inc = f.l.series.incomeByMonth(f.state, f.period);
  var last = inc.rows[inc.rows.length - 1];
  // USD 100 at 4.20 is RM 420, plus RM 50.
  assert.equal(last.total, 470);
  // The earlier month had no rate anywhere, so its USD income is left out entirely.
  var first = inc.rows.filter(function (r) { return r.period === earlier; })[0];
  assert.equal(first.total, 0);
});

// --- goals and forecast -----------------------------------------------------

test("goal progress counts a foreign holding at its ringgit value", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000, fxRate: 4.2 });
  var goal = { id: "g1", name: "Runway", targetAmount: 50000, targetDate: null,
    linkedHoldingIds: [f.usd.id], deleted: false };

  assert.equal(f.l.goals.currentValue(f.state, goal, f.period), 42000);
});

test("goal progress leaves out a holding it cannot convert", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000 });
  var goal = { id: "g1", name: "Runway", targetAmount: 50000, targetDate: null,
    linkedHoldingIds: [f.usd.id], deleted: false };

  // Zero, not RM 10,000 — a goal reported 20% complete on a rate nobody supplied is a
  // worse answer than one reported at nothing yet.
  assert.equal(f.l.goals.currentValue(f.state, goal, f.period), 0);
});

test("a forecast starts from the same figure net worth showed", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000 });
  rec(f, f.myr, { balance: 5000 });
  f.state.scenarios = f.l.forecast.defaultScenarios("dev-1");
  var base = f.state.scenarios.filter(function (x) { return x.name === "Base"; })[0];

  var p = f.l.forecast.projectScenario(f.state, base, 12, f.period);
  // A forecast that seeds from a figure the total excluded would diverge from month one.
  assert.equal(p.openingNet, f.l.networth.positionAt(f.state, f.period).net);
  assert.equal(p.openingNet, 5000);
});

test("a forecast converts a foreign holding it can convert", function () {
  var f = setup();
  rec(f, f.usd, { balance: 10000, fxRate: 4.2 });
  f.state.scenarios = f.l.forecast.defaultScenarios("dev-1");
  var base = f.state.scenarios.filter(function (x) { return x.name === "Base"; })[0];

  assert.equal(f.l.forecast.projectScenario(f.state, base, 12, f.period).openingNet, 42000);
});
