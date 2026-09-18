"use strict";
// P5.2 headline figures: change over a window, and the category strip.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function fixture() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);

  function account(name, cls, liquid, currency) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls;
    a.liquid = liquid;
    if (currency) a.currency = currency;
    s.accounts.push(a);
    return a;
  }
  function holding(acct, name) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, account: account, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}

// ---- deltaOver -------------------------------------------------------------

test("a change over a window is the difference between its two ends", function () {
  var f = fixture();
  var h = f.holding(f.account("Savings", "cash", true), "Savings");
  for (var i = 12; i >= 0; i--) record(f, { holdingId: h.id, period: period(f, i), balance: 100000 + (12 - i) * 1000 });

  var pts = f.l.networth.series(f.state, period(f, 0));
  var month = f.l.categories.deltaOver(pts, 1);
  assert.equal(month.delta, 1000);
  assert.equal(month.pct.toFixed(2), "0.90");   // 1,000 on 111,000

  var year = f.l.categories.deltaOver(pts, 12);
  assert.equal(year.delta, 12000);
  assert.equal(year.pct.toFixed(1), "12.0");
  assert.equal(year.from, period(f, 12));
  assert.equal(year.to, period(f, 0));
});

test("too little history answers null, never a fabricated zero", function () {
  var f = fixture();
  var h = f.holding(f.account("Savings", "cash", true), "Savings");
  for (var i = 5; i >= 0; i--) record(f, { holdingId: h.id, period: period(f, i), balance: 50000 });

  var pts = f.l.networth.series(f.state, period(f, 0));
  assert.equal(f.l.categories.deltaOver(pts, 12), null, "no year of history");
  assert.notEqual(f.l.categories.deltaOver(pts, 1), null, "but a month is there");
  assert.equal(f.l.categories.deltaOver([], 1), null);
});

test("a change resting on a carried-forward figure is flagged", function () {
  var f = fixture();
  var h = f.holding(f.account("Savings", "cash", true), "Savings");
  record(f, { holdingId: h.id, period: period(f, 2), balance: 50000 });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 51000 });
  // Nothing recorded for this month, so the latest point carries 51,000 forward.
  var pts = f.l.networth.series(f.state, period(f, 0));
  assert.equal(f.l.categories.deltaOver(pts, 1).partial, true);
});

// ---- categoryTotals --------------------------------------------------------

test("holdings land in the agreed categories", function () {
  var f = fixture();
  var cash = f.holding(f.account("Savings", "cash", true), "Savings");
  var fd = f.holding(f.account("Fixed deposit", "cash", false), "12-month FD");
  var unit = f.holding(f.account("Unit trusts", "investment", true), "ASB");
  var epf = f.holding(f.account("EPF", "retirement", false), "EPF");
  var p = period(f, 0);
  record(f, { holdingId: cash.id, period: p, balance: 20000 });
  record(f, { holdingId: fd.id, period: p, balance: 30000 });
  record(f, { holdingId: unit.id, period: p, balance: 60000 });
  record(f, { holdingId: epf.id, period: p, balance: 90000 });

  var t = f.l.categories.categoryTotals(f.state, p);
  var byKey = {};
  t.categories.forEach(function (c) { byKey[c.key] = c.total; });
  assert.equal(byKey.freeCash, 20000);
  assert.equal(byKey.investments, 90000, "an illiquid FD sits with investments, not free cash");
  assert.equal(byKey.retirement, 90000);
  assert.equal(byKey.useAssets, 0);
  assert.equal(byKey.other, undefined, "Other stays hidden while it holds nothing");
});

test("the strip reconciles to net worth to the sen", function () {
  var f = fixture();
  var cash = f.holding(f.account("Savings", "cash", true), "Savings");
  var unit = f.holding(f.account("Unit trusts", "investment", true), "ASB");
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  home.liquid = false;
  f.state.assets.push(home);
  var loan = f.l.schema.newLiability("dev-1");
  loan.name = "Mortgage";
  loan.type = "mortgage";
  f.state.liabilities.push(loan);

  var p = period(f, 0);
  record(f, { holdingId: cash.id, period: p, balance: 12345.67 });
  record(f, { holdingId: unit.id, period: p, balance: 89012.34 });
  record(f, { assetId: home.id, period: p, balance: 450000 });
  record(f, { liabilityId: loan.id, period: p, balance: 321098.76 });

  var t = f.l.categories.categoryTotals(f.state, p);
  var pos = f.l.networth.positionAt(f.state, p);
  assert.equal(t.reconciles, true);
  assert.equal(t.assets.toFixed(2), pos.assets.toFixed(2));
  assert.equal(t.net.toFixed(2), pos.net.toFixed(2));
  assert.equal(t.liabilities.toFixed(2), pos.liabilities.toFixed(2), "liabilities reported positive");

  var useAssets = t.categories.filter(function (c) { return c.key === "useAssets"; })[0];
  assert.equal(useAssets.total, 450000,
    "a financed asset counts at full value; equity would count the loan twice");
});

test("a category resting on a carried-forward figure is marked, and only that one", function () {
  var f = fixture();
  var cash = f.holding(f.account("Savings", "cash", true), "Savings");
  var epf = f.holding(f.account("EPF", "retirement", false), "EPF");
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });

  var t = f.l.categories.categoryTotals(f.state, period(f, 0));
  var byKey = {};
  t.categories.forEach(function (c) { byKey[c.key] = c; });
  assert.equal(byKey.freeCash.partial, false);
  assert.equal(byKey.retirement.partial, true);
  assert.equal(byKey.retirement.total, 90000, "carried forward, not dropped");
});

test("a holding no rate can convert is left out of the strip, as it is out of net worth", function () {
  var f = fixture();
  var myr = f.holding(f.account("Savings", "cash", true), "Savings");
  var usd = f.holding(f.account("US broker", "investment", true, "USD"), "VWRA");
  var p = period(f, 0);
  record(f, { holdingId: myr.id, period: p, balance: 20000 });
  record(f, { holdingId: usd.id, period: p, balance: 5000 });   // no fxRate recorded

  var t = f.l.categories.categoryTotals(f.state, p);
  var byKey = {};
  t.categories.forEach(function (c) { byKey[c.key] = c.total; });
  assert.equal(byKey.freeCash, 20000);
  assert.equal(byKey.investments, 0, "counted at face value it would be wrong by the whole rate");
  assert.equal(t.reconciles, true);
  assert.equal(t.unconverted.length, 1, "and it is named rather than silently missing");
});

test("liabilities are reported positive so the strip can subtract them", function () {
  var f = fixture();
  var cash = f.holding(f.account("Savings", "cash", true), "Savings");
  var car = f.l.schema.newLiability("dev-1");
  car.name = "Car loan";
  car.type = "hire purchase";
  f.state.liabilities.push(car);
  var p = period(f, 0);
  record(f, { holdingId: cash.id, period: p, balance: 50000 });
  record(f, { liabilityId: car.id, period: p, balance: 30000 });

  var t = f.l.categories.categoryTotals(f.state, p);
  assert.equal(t.liabilities, 30000);
  assert.equal(t.net, 20000);
});
