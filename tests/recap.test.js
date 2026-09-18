"use strict";
// Recap: what moved net worth between two months, and whether the parts add up.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function fixture() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, cls) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls || "cash";
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  function asset(name) {
    var x = l.schema.newAsset("dev-1");
    x.name = name;
    x.class = "property";
    s.assets.push(x);
    return x;
  }
  function liability(name) {
    var x = l.schema.newLiability("dev-1");
    x.name = name;
    x.type = "mortgage";
    s.liabilities.push(x);
    return x;
  }
  return { l: l, state: s, holding: holding, asset: asset, liability: liability };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}
function part(r, key) {
  return r.parts.filter(function (p) { return p.key === key; })[0];
}

test("a period needs two different months to compare", function () {
  var f = fixture();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 1000 });
  assert.equal(f.l.recap.recap(f.state, period(f, 0), period(f, 0)), null, "same month");
  assert.equal(f.l.recap.recap(f.state, period(f, 0), period(f, 3)), null, "backwards");
  assert.equal(f.l.recap.recap(f.state, "nonsense", period(f, 0)), null);
});

test("money you put in is reported apart from what the market did", function () {
  var f = fixture();
  var h = f.holding("ASB", "investment");
  record(f, { holdingId: h.id, period: period(f, 3), balance: 100000 });
  record(f, { holdingId: h.id, period: period(f, 2), balance: 103000, contribution: 2000 });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 106500, contribution: 2000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 110000, contribution: 2000 });

  var r = f.l.recap.recap(f.state, period(f, 3), period(f, 0));
  assert.equal(r.change, 10000);
  assert.equal(part(r, "contributions").value, 6000, "what you paid in");
  assert.equal(part(r, "market").value, 4000, "what the balances did beyond it");
  assert.equal(part(r, "market").residual, true, "and it is labelled a residual");
});

test("the parts add up to the change, to the sen", function () {
  var f = fixture();
  var cash = f.holding("Savings");
  var asb = f.holding("ASB", "investment");
  var home = f.asset("Family home");
  var loan = f.liability("Mortgage");

  record(f, { holdingId: cash.id, period: period(f, 2), balance: 12345.67 });
  record(f, { holdingId: asb.id, period: period(f, 2), balance: 88000.12 });
  record(f, { assetId: home.id, period: period(f, 2), balance: 500000 });
  record(f, { liabilityId: loan.id, period: period(f, 2), balance: 321098.76 });

  record(f, { holdingId: cash.id, period: period(f, 0), balance: 15000.01, contribution: 2500, withdrawal: 100 });
  record(f, { holdingId: asb.id, period: period(f, 0), balance: 91500.55, contribution: 1000, income: 420.33 });
  record(f, { assetId: home.id, period: period(f, 0), balance: 515000 });
  record(f, { liabilityId: loan.id, period: period(f, 0), balance: 317000.44 });

  var r = f.l.recap.recap(f.state, period(f, 2), period(f, 0));
  assert.equal(r.reconciles, true);
  var sum = r.parts.reduce(function (t, p) { return t + p.value; }, 0);
  assert.equal(sum.toFixed(2), r.change.toFixed(2));
  assert.equal(r.startNet.toFixed(2), (12345.67 + 88000.12 + 500000 - 321098.76).toFixed(2));
});

test("debt paid down reads as a gain, and debt taken on as a loss", function () {
  var f = fixture();
  var loan = f.liability("Mortgage");
  record(f, { liabilityId: loan.id, period: period(f, 2), balance: 300000 });
  record(f, { liabilityId: loan.id, period: period(f, 0), balance: 294000 });
  var down = f.l.recap.recap(f.state, period(f, 2), period(f, 0));
  assert.equal(part(down, "debtPaid").value, 6000);
  assert.equal(down.change, 6000, "paying a loan raises net worth by what was repaid");

  var g = fixture();
  var card = g.liability("Credit card");
  record(g, { liabilityId: card.id, period: period(g, 2), balance: 1000 });
  record(g, { liabilityId: card.id, period: period(g, 0), balance: 4000 });
  var up = g.l.recap.recap(g.state, period(g, 2), period(g, 0));
  assert.equal(part(up, "debtPaid").value, -3000);
});

test("a house is revalued, not contributed to", function () {
  var f = fixture();
  var home = f.asset("Family home");
  record(f, { assetId: home.id, period: period(f, 6), balance: 480000 });
  record(f, { assetId: home.id, period: period(f, 0), balance: 520000 });

  var r = f.l.recap.recap(f.state, period(f, 6), period(f, 0));
  assert.equal(part(r, "revaluation").value, 40000);
  assert.equal(part(r, "contributions").value, 0);
  assert.equal(part(r, "market").value, 0, "an estimate moving is not market movement");
  assert.equal(r.assets[0].change, 40000);
});

test("withdrawals reduce the change and are reported as their own part", function () {
  var f = fixture();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 2), balance: 50000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 44000, withdrawal: 6000 });

  var r = f.l.recap.recap(f.state, period(f, 2), period(f, 0));
  assert.equal(part(r, "withdrawals").value, -6000);
  assert.equal(part(r, "market").value, 0, "taking money out is not a loss");
  assert.equal(r.change, -6000);
});

test("the starting month's own flows belong to the period before", function () {
  var f = fixture();
  var h = f.holding("Savings");
  // A contribution recorded in the first month is what got the balance to its opening
  // figure; counting it again would make the period look better than it was.
  record(f, { holdingId: h.id, period: period(f, 2), balance: 50000, contribution: 50000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 51000, contribution: 500 });

  var r = f.l.recap.recap(f.state, period(f, 2), period(f, 0));
  assert.equal(part(r, "contributions").value, 500);
  assert.equal(r.change, 1000);
});

test("a holding opened during the period counts from nothing, not from a guess", function () {
  var f = fixture();
  var old = f.holding("Savings");
  var fresh = f.holding("New fund", "investment");
  record(f, { holdingId: old.id, period: period(f, 3), balance: 10000 });
  record(f, { holdingId: old.id, period: period(f, 0), balance: 10000 });
  record(f, { holdingId: fresh.id, period: period(f, 1), balance: 5000, contribution: 5000 });
  record(f, { holdingId: fresh.id, period: period(f, 0), balance: 5200 });

  var r = f.l.recap.recap(f.state, period(f, 3), period(f, 0));
  var row = r.holdings.filter(function (x) { return x.name === "New fund"; })[0];
  assert.equal(row.start, 0);
  assert.equal(row.end, 5200);
  assert.equal(row.contributions, 5000);
  assert.equal(row.market, 200);
  assert.equal(r.reconciles, true);
});

test("a period resting on carried-forward figures says so at both ends", function () {
  var f = fixture();
  var h = f.holding("EPF", "retirement");
  record(f, { holdingId: h.id, period: period(f, 4), balance: 90000 });
  // Nothing since, so both ends of a later window are carried.
  var r = f.l.recap.recap(f.state, period(f, 2), period(f, 0));
  assert.equal(r.partial, true);
  assert.equal(r.startPartial, true);
  assert.equal(r.endPartial, true);
  assert.equal(r.change, 0, "and a carried figure has not moved");
});

test("each line reports its own change, so a total can be traced", function () {
  var f = fixture();
  var a = f.holding("Savings");
  var b = f.holding("ASB", "investment");
  record(f, { holdingId: a.id, period: period(f, 1), balance: 10000 });
  record(f, { holdingId: b.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: a.id, period: period(f, 0), balance: 11000, contribution: 1000 });
  record(f, { holdingId: b.id, period: period(f, 0), balance: 19000 });

  var r = f.l.recap.recap(f.state, period(f, 1), period(f, 0));
  var byName = {};
  r.holdings.forEach(function (row) { byName[row.name] = row; });
  assert.equal(byName.Savings.change, 1000);
  assert.equal(byName.Savings.market, 0);
  assert.equal(byName.ASB.change, -1000);
  assert.equal(byName.ASB.market, -1000);
  assert.equal(r.change, 0, "they cancel out, which is the point of showing both");
});
