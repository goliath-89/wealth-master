"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-4.8. The engine. concentration-ui.test.js covers what reaches the screen.

function setup(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  acct.class = "cash";
  acct.currency = opts.currency || "MYR";
  s.accounts.push(acct);

  var held = {};
  (opts.holdings || []).forEach(function (h) {
    var e = l.schema.newHolding("dev-1");
    e.accountId = acct.id;
    e.name = h.name;
    s.holdings.push(e);
    held[h.name] = e;
    if (h.balance !== undefined) {
      l.valuations.upsertValuation(s, {
        holdingId: e.id, period: period, balance: h.balance, fxRate: h.fxRate
      }, "dev-1");
    }
  });

  return { l: l, state: s, period: period, held: held, acct: acct };
}

test("a holding over the default share is reported with its share and its worth", function () {
  var f = setup({ holdings: [{ name: "ASB", balance: 80000 }, { name: "FD", balance: 20000 }] });
  var c = f.l.analytics.concentration(f.state, f.period);

  assert.equal(c.thresholdPct, 20);
  assert.equal(c.isDefault, true);
  assert.equal(c.over.length, 1);
  assert.equal(c.over[0].name, "ASB");
  assert.equal(c.over[0].sharePct, 80);
  assert.equal(c.over[0].balance, 80000);
});

test("a holding exactly at the threshold is not over it", function () {
  var f = setup({ holdings: [
    { name: "A", balance: 20000 }, { name: "B", balance: 20000 },
    { name: "C", balance: 20000 }, { name: "D", balance: 20000 },
    { name: "E", balance: 20000 }
  ] });
  var c = f.l.analytics.concentration(f.state, f.period);
  // Five holdings at exactly 20% each. "Exceeds" means exceeds — a threshold that fires
  // on equality would warn about a portfolio split evenly five ways.
  assert.equal(c.over.length, 0);
  assert.equal(c.lines[0].sharePct, 20);
});

test("the owner's threshold replaces the default", function () {
  var f = setup({ holdings: [{ name: "ASB", balance: 60000 }, { name: "FD", balance: 40000 }] });
  f.state.settings.concentrationPct = 50;
  var c = f.l.analytics.concentration(f.state, f.period);

  assert.equal(c.thresholdPct, 50);
  assert.equal(c.isDefault, false);
  assert.equal(c.over.length, 1);
  assert.equal(c.over[0].name, "ASB");
});

test("a blank threshold is the default, not zero", function () {
  var f = setup({ holdings: [{ name: "A", balance: 5000 }, { name: "B", balance: 5000 },
    { name: "C", balance: 5000 }, { name: "D", balance: 5000 }, { name: "E", balance: 5000 },
    { name: "F", balance: 5000 }] });
  [null, undefined, ""].forEach(function (blank) {
    f.state.settings.concentrationPct = blank;
    var c = f.l.analytics.concentration(f.state, f.period);
    // Six holdings at 16.7% each. A zero threshold would flag all six.
    assert.equal(c.thresholdPct, 20);
    assert.equal(c.isDefault, true);
    assert.equal(c.over.length, 0);
  });
});

test("a nonsense threshold falls back to the default rather than being obeyed", function () {
  var f = setup({ holdings: [{ name: "A", balance: 100000 }] });
  [0, -5, 101, "abc", NaN].forEach(function (bad) {
    f.state.settings.concentrationPct = bad;
    var c = f.l.analytics.concentration(f.state, f.period);
    assert.equal(c.thresholdPct, 20, String(bad) + " must not become the threshold");
    assert.equal(c.isDefault, true);
  });
});

test("the denominator is total assets, so a physical asset dilutes every share", function () {
  var f = setup({ holdings: [{ name: "ASB", balance: 100000 }] });
  var a = f.l.schema.newAsset("dev-1");
  a.name = "House";
  a.class = "property";
  a.liquid = false;
  f.state.assets.push(a);
  f.l.valuations.upsertValuation(f.state,
    { assetId: a.id, period: f.period, balance: 400000 }, "dev-1");

  var c = f.l.analytics.concentration(f.state, f.period);
  // RM 100,000 of RM 500,000 is 20%, not the 100% it would be among holdings alone. The
  // share must match the allocation donut, which counts the house.
  assert.equal(c.total, 500000);
  assert.equal(c.lines[0].sharePct, 20);
  assert.equal(c.over.length, 0);
});

test("a foreign holding is measured on its converted value", function () {
  var f = setup({ currency: "USD", holdings: [
    { name: "USD cash", balance: 10000, fxRate: 4.2 }
  ] });
  var c = f.l.analytics.concentration(f.state, f.period);
  assert.equal(c.lines[0].balance, 42000);
  assert.equal(c.lines[0].sharePct, 100);
});

test("a holding no rate converts is counted nowhere, and the omission is reported", function () {
  var f = setup({ currency: "USD", holdings: [
    { name: "USD cash", balance: 10000 }, { name: "Also USD", balance: 500, fxRate: 4.2 }
  ] });
  var c = f.l.analytics.concentration(f.state, f.period);

  assert.equal(c.excludedCount, 1);
  assert.equal(c.lines.length, 1, "an unconvertible holding has no share to report");
  assert.equal(c.lines[0].name, "Also USD");
});

test("an empty portfolio warns about nothing rather than dividing by zero", function () {
  var f = setup({ holdings: [] });
  var c = f.l.analytics.concentration(f.state, f.period);
  assert.equal(c.total, 0);
  assert.deepEqual(c.lines, []);
  assert.deepEqual(c.over, []);
});

test("lines come back largest share first", function () {
  var f = setup({ holdings: [
    { name: "Small", balance: 1000 }, { name: "Big", balance: 9000 },
    { name: "Middle", balance: 5000 }
  ] });
  var c = f.l.analytics.concentration(f.state, f.period);
  assert.deepEqual(c.lines.map(function (l) { return l.name; }), ["Big", "Middle", "Small"]);
});
