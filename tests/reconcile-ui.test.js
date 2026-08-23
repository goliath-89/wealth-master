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

function saved(app) {
  var raw = app.window.localStorage.getItem("wealthmaster.state");
  return raw ? JSON.parse(raw) : { loanChecks: [] };
}

function enterCheck(doc, loanId, fields) {
  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-liab="' + loanId + '"]').click();
  doc.getElementById("c_period").value = fields.period || "";
  doc.getElementById("c_interest").value = fields.interest || "";
  doc.getElementById("c_balance").value = fields.balance || "";
  doc.getElementById("c_instalment").value = fields.instalment || "";
  doc.getElementById("liabSave").click();
}

test("a matching statement is stored and reported as an exact match", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "255.00", instalment: "RM 1,326.43" });

  var s = saved(app);
  assert.equal(s.loanChecks.length, 1, "the statement figures are stored as the owner's data");
  assert.equal(s.loanChecks[0].statementInterest, 255);
  assert.equal(s.loanChecks[0].liabilityId, f.loan.id);

  // Reopening shows the verdict.
  doc.querySelector('[data-edit-liab="' + f.loan.id + '"]').click();
  assert.match(doc.getElementById("c_result").textContent, /Matches to the sen/);
  assert.deepEqual(app.consoleErrors, []);
});

test("the terms themselves are untouched by entering a statement", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  enterCheck(app.window.document, f.loan.id, { period: "2024-03", interest: "999" });

  var l = saved(app).liabilities[0];
  assert.equal(l.principal, 90000, "the engine is measured, never tuned");
  assert.equal(l.ratePct, 3.4);
  assert.equal(l.tenureMonths, 84);
});

test("a disagreeing flat-rate statement is called a failure, not a rounding difference", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "480" });
  doc.querySelector('[data-edit-liab="' + f.loan.id + '"]').click();

  var text = doc.getElementById("c_result").textContent;
  assert.match(text, /Does not match/);
  assert.match(text, /Hire Purchase Act/);
  assert.match(text, /RM 225\.00 higher/, "must state the size of the gap");
});

test("a small mortgage difference is explained as the daily-rest signature", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  // Engine computes RM 1,268.75 for Jan 2024 on monthly rest.
  enterCheck(doc, f.loan.id, { period: "2024-01", interest: "1271.10" });
  doc.querySelector('[data-edit-liab="' + f.loan.id + '"]').click();

  var text = doc.getElementById("c_result").textContent;
  assert.match(text, /Close, not exact/);
  assert.match(text, /daily rest/);
});

test("the Loans tab shows whether each loan has been verified", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="loans"]').click();
  assert.match(doc.getElementById("loanList").textContent, /Unverified/);

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "255" });
  doc.querySelector('.tab[data-v="loans"]').click();
  assert.match(doc.getElementById("loanList").textContent, /Matches statement/);
});

test("figures without a month are refused rather than stored loose", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { interest: "255" });
  assert.match(doc.getElementById("liabErr").textContent, /Give the statement month/);
  assert.equal(saved(app).loanChecks.length, 0);
});

test("a non-numeric statement figure is refused", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "2S5" });
  assert.match(doc.getElementById("liabErr").textContent, /Statement figures must be numbers/);
  assert.equal(saved(app).loanChecks.length, 0);
});

test("clearing the figures removes the check as a tombstone", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "255" });
  assert.equal(saved(app).loanChecks.filter(function (c) { return !c.deleted; }).length, 1);

  enterCheck(doc, f.loan.id, { period: "2024-03" });
  var checks = saved(app).loanChecks;
  assert.equal(checks.length, 1, "tombstone, not removal");
  assert.equal(checks[0].deleted, true);
});

test("an editable statement check round-trips its stored values back into the form", function () {
  var f = seeded("flat");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  enterCheck(doc, f.loan.id, { period: "2024-03", interest: "255", balance: "88928.57" });
  doc.querySelector('[data-edit-liab="' + f.loan.id + '"]').click();

  assert.equal(doc.getElementById("c_period").value, "2024-03");
  assert.equal(doc.getElementById("c_interest").value, "RM 255");
  assert.equal(doc.getElementById("c_balance").value, "RM 88,928.57");
});
