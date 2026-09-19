"use strict";
// P8: what is still to record this month, in the order to ask for it.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function fixture() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var now = l.valuations.currentPeriod(), prev = l.valuations.prevPeriod(now);
  var inst = l.schema.newInstitution("d"); inst.name = "Maybank"; s.institutions.push(inst);
  var f = { l: l, state: s, now: now, prev: prev, ids: {} };

  function holding(key, name, cls, o) {
    o = o || {};
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls;
    if (o.currency) a.currency = o.currency;
    if (o.archived) a.archived = true;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name;
    if (o.unitBased) h.unitBased = true;
    s.holdings.push(h); f.ids[key] = h.id;
    (o.history || []).forEach(function (p) {
      l.valuations.upsertValuation(s, { holdingId: h.id, period: p[0], balance: p[1], income: p[2] === undefined ? null : p[2] }, "d");
    });
    return h;
  }
  holding("savings", "Savings", "cash", { history: [[prev, 5000]] });
  holding("done", "Already done", "cash", { history: [[prev, 900], [now, 1000]] });
  holding("epf", "EPF", "retirement", { history: [[prev, 11000]] });
  holding("fresh", "Brand new", "cash", {});
  holding("usd", "USD account", "cash", { currency: "USD", history: [[prev, 2000]] });
  holding("units", "Unit trust", "investment", { unitBased: true, history: [[prev, 7000]] });
  holding("old", "Archived", "cash", { archived: true, history: [[prev, 300]] });

  var loan = l.schema.newLiability("d");
  loan.name = "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4; loan.tenureMonths = 60; loan.instalment = 1104.99;
  s.liabilities.push(loan); f.ids.loan = loan.id;
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: prev, balance: 20000 }, "d");

  var house = l.schema.newAsset("d"); house.name = "House"; s.assets.push(house); f.ids.house = house.id;
  l.valuations.upsertValuation(s, { assetId: house.id, period: prev, balance: 300000 }, "d");
  return f;
}

function queue(f, period) { return f.l.monthend.monthQueue(f.state, period || f.now); }
function names(q) { return q.items.map(function (i) { return i.name; }); }

test("figures with an earlier entry come first, then ones never recorded", function () {
  var q = queue(fixture());
  var order = names(q);
  assert.equal(order[order.length - 1], "Brand new", "a new subject is asked for last");
  ["Savings", "EPF", "USD account", "Car loan", "House"].forEach(function (n) {
    assert.ok(order.indexOf(n) >= 0 && order.indexOf(n) < order.indexOf("Brand new"), n + " before the new one");
  });
  var fresh = q.items.filter(function (i) { return i.status === "fresh"; });
  assert.deepEqual(fresh.map(function (i) { return i.name; }), ["Brand new"]);
});

test("what is already recorded is counted, not asked", function () {
  var q = queue(fixture());
  assert.equal(names(q).indexOf("Already done"), -1);
  assert.equal(q.recorded, 1);
  assert.equal(q.total, q.items.length + 1);
});

test("assets and liabilities are asked for as well as holdings", function () {
  var q = queue(fixture());
  var byName = {};
  q.items.forEach(function (i) { byName[i.name] = i; });
  assert.equal(byName["Car loan"].kind, "liability");
  assert.equal(byName["House"].kind, "asset");
  assert.equal(byName["Savings"].kind, "holding");
});

test("a holding priced by units is listed apart, not asked for a ringgit balance", function () {
  var q = queue(fixture());
  assert.equal(names(q).indexOf("Unit trust"), -1);
  assert.deepEqual(q.pricedByUnits.map(function (s) { return s.name; }), ["Unit trust"]);
});

test("an archived account is not asked for anything", function () {
  var q = queue(fixture());
  assert.equal(names(q).indexOf("Archived"), -1);
});

test("each item carries the figure it would be carried from", function () {
  var f = fixture();
  var byName = {};
  queue(f).items.forEach(function (i) { byName[i.name] = i; });
  assert.equal(byName["Savings"].prior.balance, 5000);
  assert.equal(byName["Savings"].prior.period, f.prev);
  assert.equal(byName["Brand new"].prior, null);
});

test("a foreign holding says it needs a rate, and in what currency", function () {
  var byName = {};
  queue(fixture()).items.forEach(function (i) { byName[i.name] = i; });
  assert.equal(byName["USD account"].needsRate, true);
  assert.equal(byName["USD account"].currency, "USD");
  assert.equal(byName["Savings"].needsRate, false);
});

test("the due ones are exactly the lines net worth is carrying forward", function () {
  var f = fixture();
  var due = f.l.uiShell.dueThisMonth(f.state, f.now).names.slice().sort();
  var queued = queue(f).items.filter(function (i) { return i.status === "due"; })
    .map(function (i) { return i.name; }).concat(queue(f).pricedByUnits.map(function (s) { return s.name; })).sort();
  assert.deepEqual(queued, due, "the badge and the checklist cannot disagree");
});

test("an entry with an income but no balance is still asked for the balance, and keeps the income", function () {
  var f = fixture();
  f.l.valuations.upsertValuation(f.state, { holdingId: f.ids.savings, period: f.now, balance: null, income: 42 }, "d");
  var item = queue(f).items.filter(function (i) { return i.name === "Savings"; })[0];
  assert.ok(item, "no balance means still to do");
  assert.equal(item.existing.income, 42);
});

test("recording a figure removes it from the queue", function () {
  var f = fixture();
  f.l.valuations.upsertValuation(f.state, { holdingId: f.ids.savings, period: f.now, balance: 5100 }, "d");
  var q = queue(f);
  assert.equal(names(q).indexOf("Savings"), -1);
  assert.equal(q.recorded, 2);
});

test("an empty state has nothing to ask", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var q = l.monthend.monthQueue(l.schema.blank(), l.valuations.currentPeriod());
  assert.equal(q.total, 0);
  assert.deepEqual(q.items, []);
});
