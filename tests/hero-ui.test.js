"use strict";
// P5.2 as rendered: the headline and the category strip on the Net worth screen.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, cls, liquid) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls;
    a.liquid = liquid;
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}

test("with nothing recorded the headline and strip stay empty", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.equal(doc.getElementById("worthHero").innerHTML, "");
  assert.equal(doc.getElementById("catStrip").innerHTML, "");
  assert.deepEqual(app.consoleErrors, []);
});

test("the headline is net worth with its 1-month and 1-year change", function () {
  var f = seeded();
  var h = f.holding("Savings", "cash", true);
  for (var i = 12; i >= 0; i--) record(f, { holdingId: h.id, period: period(f, i), balance: 100000 + (12 - i) * 1000 });

  var doc = helpers.loadApp(f.state).window.document;
  var hero = doc.getElementById("worthHero").textContent;
  assert.match(hero, /RM 112,000/, "the total");
  assert.match(hero, /1 month/);
  assert.match(hero, /▲ \+RM 1,000/);
  assert.match(hero, /1 year/);
  assert.match(hero, /▲ \+RM 12,000/);
  // Direction is never colour alone: the arrow and sign carry it too (NFR-9).
  assert.ok(doc.querySelector("#worthHero .hero-dv.up"));
});

test("without a year of history the headline says so instead of showing RM 0", function () {
  var f = seeded();
  var h = f.holding("Savings", "cash", true);
  record(f, { holdingId: h.id, period: period(f, 1), balance: 50000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 52000 });

  var hero = helpers.loadApp(f.state).window.document.getElementById("worthHero").textContent;
  assert.match(hero, /▲ \+RM 2,000/, "the month is known");
  assert.match(hero, /Not enough history yet/, "the year is not");
  assert.equal(/1 year.*RM 0/.test(hero), false);
});

test("a fall is shown falling, with its own arrow and sign", function () {
  var f = seeded();
  var h = f.holding("Savings", "cash", true);
  record(f, { holdingId: h.id, period: period(f, 1), balance: 50000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 47000 });

  var doc = helpers.loadApp(f.state).window.document;
  assert.match(doc.getElementById("worthHero").textContent, /▼ −RM 3,000/);
  assert.ok(doc.querySelector("#worthHero .hero-dv.dn"));
});

test("the strip carries the five categories and reconciles to the headline", function () {
  var f = seeded();
  var cash = f.holding("Savings", "cash", true);
  var asb = f.holding("ASB", "investment", true);
  var epf = f.holding("EPF", "retirement", false);
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  f.state.assets.push(home);
  var car = f.l.schema.newLiability("dev-1");
  car.name = "Car loan";
  car.type = "hire purchase";
  f.state.liabilities.push(car);

  var p = period(f, 0);
  record(f, { holdingId: cash.id, period: p, balance: 20000 });
  record(f, { holdingId: asb.id, period: p, balance: 60000 });
  record(f, { holdingId: epf.id, period: p, balance: 90000 });
  record(f, { assetId: home.id, period: p, balance: 400000 });
  record(f, { liabilityId: car.id, period: p, balance: 30000 });

  var doc = helpers.loadApp(f.state).window.document;
  var strip = doc.getElementById("catStrip").textContent;
  ["Free Cash", "Investments", "Retirement", "Use assets", "Liabilities"].forEach(function (label) {
    assert.match(strip, new RegExp(label), label + " missing from the strip");
  });
  assert.match(strip, /RM 20,000/);
  assert.match(strip, /RM 400,000/);
  assert.match(strip, /−RM 30,000/, "liabilities read as a subtraction");
  // 20,000 + 60,000 + 90,000 + 400,000 − 30,000
  assert.match(doc.getElementById("worthHero").textContent, /RM 540,000/);
});

test("carried-forward figures keep their asterisk in the headline and the strip", function () {
  var f = seeded();
  var cash = f.holding("Savings", "cash", true);
  var epf = f.holding("EPF", "retirement", false);
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });

  var doc = helpers.loadApp(f.state).window.document;
  assert.ok(doc.querySelector("#worthHero .stale-mark"), "the headline is marked");
  var marked = Array.prototype.filter.call(doc.querySelectorAll("#catStrip .strip-i"), function (el) {
    return el.querySelector(".stale-mark");
  }).map(function (el) { return el.querySelector(".strip-k").textContent; });
  assert.deepEqual(marked, ["Retirement"], "only the category that rests on old data");
});

// The strip is a decomposition of the headline. If it ever fails to add up, the screen
// must say so rather than show two totals that disagree.
test("a strip that does not reconcile is withheld and explained", function () {
  var f = seeded();
  var h = f.holding("Savings", "cash", true);
  record(f, { holdingId: h.id, period: period(f, 0), balance: 50000 });

  var doc = helpers.loadApp(f.state, function (win) {
    var real = win.WM.categoryTotals;
    win.WM.categoryTotals = function (state, period) {
      var t = real(state, period);
      t.reconciles = false;
      return t;
    };
  }).window.document;

  assert.match(doc.getElementById("catStrip").textContent, /do not add up/);
  assert.equal(doc.querySelectorAll("#catStrip .strip-i").length, 0);
  assert.match(doc.getElementById("worthHero").textContent, /RM 50,000/, "the headline still shows");
});

test("a name typed into a holding cannot inject markup through the strip (SEC-7)", function () {
  var f = seeded();
  var h = f.holding("<img src=x onerror=alert(1)>", "cash", true);
  record(f, { holdingId: h.id, period: period(f, 0), balance: 1000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.equal(doc.querySelectorAll("#catStrip img").length, 0);
  assert.equal(doc.querySelectorAll("#worthHero img").length, 0);
  assert.deepEqual(app.consoleErrors, []);
});
