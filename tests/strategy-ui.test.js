"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(defs) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  defs.forEach(function (def) {
    var liab = l.schema.newLiability("dev-1");
    liab.name = def.name;
    liab.rateBasis = def.basis || "reducing";
    liab.principal = def.principal;
    liab.ratePct = def.ratePct;
    liab.tenureMonths = def.tenureMonths;
    liab.startDate = "2026-01";
    s.liabilities.push(liab);
  });
  return { l: l, state: s };
}

var TWO = [
  { name: "Personal loan", principal: 20000, ratePct: 8, tenureMonths: 60 },
  { name: "Renovation loan", principal: 40000, ratePct: 4, tenureMonths: 60 }
];

function loansTab(doc) { doc.querySelector('.tab[data-v="loans"]').click(); }

test("the strategy panel appears with two or more debts", function () {
  var f = seeded(TWO);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  assert.notEqual(doc.getElementById("strategyWrap").style.display, "none");
  var text = doc.getElementById("strategyResult").textContent;
  assert.match(text, /Best order/);
  assert.match(text, /Debt-free in/);
  assert.match(text, /Interest saved/);
  assert.deepEqual(app.consoleErrors, []);
});

test("with a single debt the question is not asked", function () {
  var f = seeded([TWO[0]]);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  assert.equal(doc.getElementById("strategyWrap").style.display, "none");
});

test("the clearing order is listed with the month each debt goes", function () {
  var f = seeded(TWO);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  var text = doc.getElementById("strategyResult").textContent;
  assert.match(text, /Order to clear them in/);
  assert.match(text, /Personal loan — cleared month \d+/);
  assert.match(text, /Renovation loan — cleared month \d+/);
});

test("changing the spare amount changes the answer", function () {
  var f = seeded(TWO);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  var before = doc.getElementById("strategyResult").textContent;

  doc.getElementById("strat_extra").value = "2000";
  doc.getElementById("strat_extra").onchange();
  assert.notEqual(doc.getElementById("strategyResult").textContent, before);
});

test("a non-numeric amount is refused", function () {
  var f = seeded(TWO);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.getElementById("strat_extra").value = "5O0";
  doc.getElementById("strat_extra").onchange();
  assert.match(doc.getElementById("strategyResult").textContent, /must be a number/);
});

test("a flat-rate loan's real cost is called out when it outranks its quote", function () {
  var f = seeded([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 },
    { name: "Personal loan", principal: 30000, ratePct: 5, tenureMonths: 36 }
  ]);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  var text = doc.getElementById("strategyResult").textContent;
  assert.match(text, /Ranked by real cost/);
  assert.match(text, /Car loan quotes 3\.40% flat but actually costs/);
  assert.match(text, /would pay it off last when it should be first/);
  assert.match(text, /accumulated until the facility can be settled/);
});

test("no flat-rate warning appears when every debt is reducing balance", function () {
  var f = seeded(TWO);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  assert.equal(/Ranked by real cost/.test(doc.getElementById("strategyResult").textContent), false);
});

test("a flat loan targeted with extra money is cleared by settlement", function () {
  var f = seeded([
    { name: "Car loan", basis: "flat", principal: 30000, ratePct: 3.4, tenureMonths: 36 },
    { name: "Personal loan", principal: 30000, ratePct: 5, tenureMonths: 36 }
  ]);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.getElementById("strat_extra").value = "2000";
  doc.getElementById("strat_extra").onchange();
  assert.match(doc.getElementById("strategyResult").textContent, /Car loan — cleared month \d+ \(settled early\)/);
});

test("when the two orders differ the difference is quantified and snowball defended", function () {
  var f = seeded([
    { name: "Big cheap loan", principal: 50000, ratePct: 4, tenureMonths: 60 },
    { name: "Small dear loan", principal: 8000, ratePct: 12, tenureMonths: 60 }
  ]);
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.getElementById("strat_extra").value = "800";
  doc.getElementById("strat_extra").onchange();

  var text = doc.getElementById("strategyResult").textContent;
  assert.match(text, /Paying the dearest first saves RM|Both orders cost the same/);
  if (/Paying the dearest first saves/.test(text)) {
    assert.match(text, /reasonable trade/, "the motivational case for snowball must be acknowledged");
  }
});

test("simulating writes nothing to the store", function () {
  var f = seeded(TWO);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);
  var before = app.window.localStorage.getItem("wealthmaster.state");
  doc.getElementById("strat_extra").value = "3000";
  doc.getElementById("strat_extra").onchange();
  assert.equal(app.window.localStorage.getItem("wealthmaster.state"), before);
});

test("SEC-7: a loan name containing HTML is escaped in the strategy panel", function () {
  var f = seeded([
    { name: '<img src=x onerror="window.__pwned=1">', principal: 20000, ratePct: 8, tenureMonths: 60 },
    { name: "Renovation loan", principal: 40000, ratePct: 4, tenureMonths: 60 }
  ]);
  var app = helpers.loadApp(f.state);
  loansTab(app.window.document);
  assert.equal(app.window.__pwned, undefined);
  assert.equal(app.window.document.querySelectorAll("#strategyResult img").length, 0);
});
