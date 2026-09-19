"use strict";
// P7.4: the lines behind a card. The engine must agree, to the sen, with the cards that
// open it — a list that disagrees with its own headline is worse than no list.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function fixture(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var now = l.valuations.currentPeriod();
  var prev = l.valuations.prevPeriod(now);
  var older = l.valuations.prevPeriod(prev);
  var maybank = l.schema.newInstitution("d"); maybank.name = "Maybank"; s.institutions.push(maybank);
  var kwsp = l.schema.newInstitution("d"); kwsp.name = "EPF"; s.institutions.push(kwsp);
  var f = { l: l, state: s, now: now, prev: prev, older: older, ids: {} };

  function holding(key, name, cls, inst, o) {
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls; a.liquid = o.liquid !== false;
    if (o.currency) a.currency = o.currency;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name; h.instrumentType = o.type || "";
    s.holdings.push(h);
    f.ids[key] = h.id;
    (o.history || []).forEach(function (pair) {
      l.valuations.upsertValuation(s, { holdingId: h.id, period: pair[0], balance: pair[1] }, "d");
    });
    return h;
  }
  holding("savings", "Savings", "cash", maybank, { type: "savings", history: [[older, 4000], [prev, 5000], [now, 6000]] });
  holding("fd", "Fixed deposit", "cash", maybank, { type: "fixed deposit", liquid: false, history: [[prev, 2000], [now, 2000]] });
  holding("epf", "EPF i-Akaun", "retirement", kwsp, { type: "EPF", history: [[prev, 11000], [now, opts.epfCarried ? null : 12000]].filter(function (p) { return p[1] !== null; }) });
  holding("asb", "ASB", "investment", maybank, { type: "unit trust", history: [[prev, 8500], [now, 9000]] });
  if (opts.newAccount) holding("fresh", "Opened this month", "cash", maybank, { history: [[now, 1500]] });
  if (opts.foreign) holding("usd", "USD account", "cash", maybank, { currency: "USD", history: [[now, 1000]] });

  var loan = l.schema.newLiability("d");
  loan.name = "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4; loan.tenureMonths = 60; loan.instalment = 1104.99;
  s.liabilities.push(loan); f.ids.loan = loan.id;
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: prev, balance: 19000 }, "d");
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: now, balance: 18000 }, "d");

  var house = l.schema.newAsset("d");
  house.name = "House"; house.class = "property"; house.liquid = false;
  s.assets.push(house); f.ids.house = house.id;
  l.valuations.upsertValuation(s, { assetId: house.id, period: now, balance: 300000 }, "d");
  return f;
}

function rows(f, period) { return f.l.drill.drillRows(f.state, period || f.now); }

test("each line says what it is: category, institution, type and side", function () {
  var f = fixture();
  var byName = {};
  rows(f).forEach(function (r) { byName[r.name] = r; });
  assert.equal(byName["Savings"].categoryLabel, "Free Cash");
  assert.equal(byName["Savings"].institution, "Maybank");
  assert.equal(byName["Savings"].type, "savings");
  assert.equal(byName["Fixed deposit"].categoryLabel, "Investments", "an illiquid cash account is not free cash");
  assert.equal(byName["EPF i-Akaun"].categoryLabel, "Retirement");
  assert.equal(byName["House"].categoryLabel, "Use assets");
  assert.equal(byName["House"].institution, "Directly held");
  assert.equal(byName["Car loan"].side, "liability");
  assert.equal(byName["Car loan"].categoryLabel, "Liabilities");
});

test("every scope adds up to the figure its card shows", function () {
  var f = fixture();
  var all = rows(f), pos = f.l.networth.positionAt(f.state, f.now);
  var d = f.l.drill;
  function total(k) { return d.drillTotal(d.drillScope(all, k), k).value; }
  assert.equal(total("assets"), pos.assets);
  assert.equal(total("liabilities"), pos.liabilities);
  assert.equal(total("net"), pos.net);
  assert.equal(total("liquid"), pos.liquid);
});

test("each category scope matches the category strip, and together they are the assets", function () {
  var f = fixture();
  var all = rows(f), d = f.l.drill;
  var strip = f.l.categories.categoryTotals(f.state, f.now);
  var sum = 0;
  strip.categories.forEach(function (c) {
    var t = d.drillTotal(d.drillScope(all, c.key), c.key).value;
    assert.ok(Math.abs(t - c.total) < 0.005, c.label + " " + t + " vs " + c.total);
    sum += t;
  });
  assert.ok(Math.abs(sum - strip.assets) < 0.005);
  var investable = d.drillTotal(d.drillScope(all, "investable"), "investable").value;
  var want = strip.categories.filter(function (c) { return c.key === "freeCash" || c.key === "investments"; })
    .reduce(function (a, c) { return a + c.total; }, 0);
  assert.ok(Math.abs(investable - want) < 0.005);
});

test("an unknown scope is null, not an empty list", function () {
  var f = fixture();
  assert.equal(f.l.drill.drillScope(rows(f), "bogus"), null);
  assert.equal(f.l.drill.drillScopeInfo("bogus"), null);
});

test("change is against last month, and a carried-forward line has none", function () {
  var f = fixture({ epfCarried: true });
  var byName = {};
  rows(f).forEach(function (r) { byName[r.name] = r; });
  assert.equal(byName["Savings"].change, 1000);
  assert.equal(byName["Car loan"].change, -1000);
  assert.equal(byName["EPF i-Akaun"].stale, true);
  assert.equal(byName["EPF i-Akaun"].change, null, "nothing recorded is not the same as nothing happening");
});

test("a line opened this month is not reported as growth", function () {
  var f = fixture({ newAccount: true });
  var d = f.l.drill, all = rows(f);
  var fresh = all.filter(function (r) { return r.name === "Opened this month"; })[0];
  assert.equal(fresh.change, null);
  var chg = d.drillChange(d.drillScope(all, "freeCash"), "freeCash");
  assert.equal(chg.delta, 1000, "only the savings account existed in both months");
});

test("a foreign holding with no rate is listed without a ringgit value and never counted", function () {
  var f = fixture({ foreign: true });
  var all = rows(f), d = f.l.drill;
  var usd = all.filter(function (r) { return r.name === "USD account"; })[0];
  assert.equal(usd.value, null);
  assert.equal(usd.convertible, false);
  var pos = f.l.networth.positionAt(f.state, f.now);
  assert.equal(d.drillTotal(d.drillScope(all, "assets"), "assets").value, pos.assets);
});

test("a stale line marks its scope as partial", function () {
  var f = fixture({ epfCarried: true });
  var d = f.l.drill, all = rows(f);
  assert.equal(d.drillTotal(d.drillScope(all, "retirement"), "retirement").partial, true);
  assert.equal(d.drillTotal(d.drillScope(all, "freeCash"), "freeCash").partial, false);
});

test("groups are assets only, positive, and their shares add to 100", function () {
  var f = fixture();
  var d = f.l.drill;
  var g = d.drillGroups(d.drillScope(rows(f), "net").filter(function (r) { return r.side === "asset"; }), "institution");
  assert.equal(g.total, 6000 + 2000 + 12000 + 9000 + 300000);
  var share = g.slices.reduce(function (a, s) { return a + s.share; }, 0);
  assert.ok(Math.abs(share - 100) < 1e-9);
  assert.equal(g.slices[0].label, "Directly held", "largest first");
  var maybank = g.slices.filter(function (s) { return s.label === "Maybank"; })[0];
  assert.equal(maybank.count, 3);
});

test("the trend has no point for a month in which the scope held nothing", function () {
  var f = fixture();
  var d = f.l.drill;
  var savings = d.drillTrend(f.state, "freeCash");
  assert.equal(savings.length, 3, "older, last month and this month");
  assert.equal(savings[0].period, f.older);
  var retirement = d.drillTrend(f.state, "retirement");
  assert.equal(retirement.length, 2, "EPF was not recorded in the older month, so there is no zero there");
  assert.equal(retirement[0].value, 11000);
});

test("the net trend subtracts what is owed", function () {
  var f = fixture();
  var t = f.l.drill.drillTrend(f.state, "net");
  var last = t[t.length - 1];
  assert.equal(last.value, f.l.networth.positionAt(f.state, f.now).net);
});

test("dimensions offered depend on the scope", function () {
  var d = helpers.loadLib(helpers.freshWindow()).drill;
  assert.deepEqual(d.drillDimensionsFor("liabilities"), ["type", "rate"]);
  assert.ok(d.drillDimensionsFor("assets").indexOf("category") >= 0);
  assert.equal(d.drillDimensionsFor("retirement").indexOf("category"), -1,
    "a single category gains nothing from being cut by category");
});
