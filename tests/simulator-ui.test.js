"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(basis) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var loan = l.schema.newLiability("dev-1");
  loan.name = basis === "flat" ? "Car loan" : "Home loan";
  loan.rateBasis = basis;
  loan.principal = basis === "flat" ? 90000 : 350000;
  loan.ratePct = basis === "flat" ? 3.4 : 4.35;
  loan.tenureMonths = basis === "flat" ? 84 : 360;
  loan.startDate = basis === "flat" ? "2024-03" : "2024-01";
  s.liabilities.push(loan);
  return { l: l, state: s, loan: loan };
}

function loansTab(doc) { doc.querySelector('.tab[data-v="loans"]').click(); }

test("a reducing loan offers a monthly payment simulator", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simpay]");
  assert.ok(field, "expected a payment input");
  assert.match(doc.getElementById("v-loans").textContent, /Interest saving scenario/);
  assert.equal(field.value, "RM 1,742.34", "defaults to the contractual instalment");
  assert.deepEqual(app.consoleErrors, []);
});

test("typing a higher payment reports interest and time saved", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simpay]");
  field.value = "2242.34"; // RM 500 more
  field.onchange();

  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /Interest saved/);
  assert.match(text, /Time saved/);
  assert.match(text, /New payoff/);
  assert.match(text, /clears the loan in \d+ months rather than 360/);
});

test("the simulated saving matches the engine's own comparison", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simpay]");
  field.value = "2242.34";
  field.onchange();

  var expected = f.l.loans.simulatePayment(f.loan, 2242.34).comparison;
  var shown = doc.getElementById("loanList").textContent;
  // The headline figure on screen must be the one the engine computed.
  var pretty = "RM " + expected.interestSaved.toLocaleString("en-MY",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(shown.indexOf(pretty) !== -1, "expected " + pretty + " in the rendered output");
  assert.ok(expected.monthsSaved > 0);
});

test("entering the contractual instalment reports no saving rather than a fake one", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simpay]");
  field.value = "1742.34";
  field.onchange();
  assert.match(doc.getElementById("loanList").textContent, /nothing saved yet/);
});

test("a payment below the monthly interest is refused in the simulator", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simpay]");
  field.value = "100";
  field.onchange();
  assert.match(doc.getElementById("loanList").textContent, /never reduces/);
});

test("simulating never writes to the store — it is a what-if", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  var before = app.window.localStorage.getItem("wealthmaster.state");
  var field = doc.querySelector("[data-simpay]");
  field.value = "3000";
  field.onchange();
  assert.equal(app.window.localStorage.getItem("wealthmaster.state"), before,
    "a simulation is not a decision and must not be persisted");
});

// --- flat rate: the honest version --------------------------------------------

test("a flat-rate loan offers early settlement, not a monthly overpayment box", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  assert.equal(doc.querySelector("[data-simpay]"), null,
    "offering monthly overpayment here would imply a saving that does not exist");
  assert.ok(doc.querySelector("[data-simsettle]"));
  assert.match(doc.getElementById("v-loans").textContent, /Early settlement/);
});

test("the flat-rate panel states plainly that overpaying does not cut interest", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /does not cut the interest/);
  assert.match(text, /Hire Purchase Act/);
});

test("changing the settlement point recalculates the statutory rebate", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simsettle]");
  field.value = "60";
  field.onchange();

  // 21,420 × (24×25)/(84×85) = RM 1,800.00, settlement 24 × 1,326.43 − 1,800.
  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /RM 1,800\.00/, "the rebate");
  assert.match(text, /RM 30,034\.32/, "the settlement figure");
});

test("the flat panel warns that the rebate is less than the outstanding interest", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  var field = doc.querySelector("[data-simsettle]");
  field.value = "60";
  field.onchange();
  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /RM 6,120\.00/, "interest still nominally outstanding");
  assert.match(text, /front-loads/);
});
