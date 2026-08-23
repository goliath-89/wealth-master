"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(basis) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var loan = l.schema.newLiability("dev-1");
  loan.name = basis === "flat" ? "Car loan" : "Home loan";
  loan.type = basis === "flat" ? "hire purchase" : "mortgage";
  loan.rateBasis = basis;
  loan.principal = basis === "flat" ? 90000 : 100000;
  loan.ratePct = basis === "flat" ? 3.4 : 6;
  loan.tenureMonths = basis === "flat" ? 84 : 12;
  loan.startDate = "2024-03";
  s.liabilities.push(loan);
  return { l: l, state: s, loan: loan };
}

function loansTab(doc) {
  doc.querySelector('.tab[data-v="loans"]').click();
}

test("a flat-rate loan shows the figures from the worked example", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  loansTab(doc);

  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /Flat rate/);
  assert.match(text, /RM 1,326\.43/, "instalment");
  assert.match(text, /RM 21,420\.00/, "total interest");
  assert.match(text, /RM 111,420\.00/, "total payable");
  assert.deepEqual(app.consoleErrors, []);
});

test("a reducing loan shows its own worked-example figures", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  var text = doc.getElementById("loanList").textContent;
  assert.match(text, /Reducing balance/);
  assert.match(text, /RM 8,606\.64/);
});

test("the effective rate of a flat quote is surfaced, roughly double the quoted rate", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  var text = doc.getElementById("loanList").textContent;
  // The number a dealer never volunteers: 3.4% flat really costs about 6.3%.
  assert.match(text, /6\.\d\d%/);
  assert.match(text, /really costs about/);
});

test("the schedule is hidden until asked for, then lists every instalment", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);

  assert.equal(doc.querySelector("#loanList table"), null, "84 rows must not render unbidden");
  var toggle = doc.querySelector("[data-sched]");
  assert.match(toggle.textContent, /Show schedule \(84 rows\)/);

  toggle.click();
  var rows = doc.querySelectorAll("#loanList tbody tr");
  assert.equal(rows.length, 84);
  assert.match(doc.querySelector("[data-sched]").textContent, /Hide schedule/);
});

test("the schedule's first row matches the engine to the sen", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.querySelector("[data-sched]").click();

  var cells = doc.querySelectorAll("#loanList tbody tr:first-child td");
  assert.equal(cells[0].textContent, "1");
  assert.equal(cells[1].textContent, "Mar 2024");
  assert.equal(cells[2].textContent, "RM 1,326.43");
  assert.equal(cells[3].textContent, "RM 255.00");
  assert.equal(cells[4].textContent, "RM 1,071.43");
});

test("the final row of a schedule closes the balance at zero", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.querySelector("[data-sched]").click();

  var last = doc.querySelectorAll("#loanList tbody tr")[83];
  assert.equal(last.querySelectorAll("td")[5].textContent, "RM 0.00");
});

test("a loan with incomplete terms asks for them instead of showing a broken schedule", function () {
  var f = seeded("flat");
  f.loan.tenureMonths = 0;
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  assert.match(doc.getElementById("loanList").textContent, /Enter principal, rate and tenure/);
  assert.equal(doc.querySelector("[data-sched]"), null);
});

test("an instalment too small to cover interest is reported, not silently looped", function () {
  var f = seeded("reducing");
  f.loan.principal = 100000;
  f.loan.ratePct = 6;
  f.loan.tenureMonths = 120;
  f.loan.instalment = 400; // interest alone is RM 500 a month
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  assert.match(doc.getElementById("loanList").textContent, /never reduces/);
});

test("the Loans tab warns that the engines are not yet reconciled to a real statement", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  // Until AC-2 and AC-3 are met this must stay on screen (R4).
  var view = doc.getElementById("v-loans").textContent;
  assert.match(view, /Not yet reconciled/);
  assert.match(view, /illustrative/);
});

test("no amortisation chart is drawn before the engines are reconciled", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  loansTab(doc);
  doc.querySelector("[data-sched]").click();
  assert.equal(doc.querySelector("#v-loans svg"), null,
    "the plan gates charts behind statement reconciliation");
});

test("with no liabilities the tab explains where to add one", function () {
  var doc = helpers.loadApp().window.document;
  loansTab(doc);
  assert.match(doc.getElementById("loanList").textContent, /No loans/);
});

test("SEC-7: a loan name containing HTML is escaped", function () {
  var f = seeded("flat");
  f.loan.name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  loansTab(app.window.document);
  assert.equal(app.window.__pwned, undefined);
  assert.equal(app.window.document.querySelectorAll("#loanList img").length, 0);
});
