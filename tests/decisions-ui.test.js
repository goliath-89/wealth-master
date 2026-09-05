"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(basis) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Bank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Portfolio";
  acct.class = "investment";
  acct.liquid = true;
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "Fund";
  s.holdings.push(h);
  l.valuations.upsertValuation(s, { holdingId: h.id, period: period, balance: 100000 }, "dev-1");

  var loan = l.schema.newLiability("dev-1");
  if (basis === "flat") {
    loan.name = "Car loan"; loan.rateBasis = "flat";
    loan.principal = 90000; loan.ratePct = 3.4; loan.tenureMonths = 84; loan.startDate = "2024-03";
  } else {
    loan.name = "Home loan"; loan.rateBasis = "reducing";
    loan.principal = 350000; loan.ratePct = 4.35; loan.tenureMonths = 360; loan.startDate = "2024-01";
  }
  s.liabilities.push(loan);

  return { l: l, state: s, loan: loan };
}

function forecastTab(doc) { doc.querySelector('.tab[data-v="forecast"]').click(); }

function setInputs(doc, amount, growth) {
  doc.getElementById("dec_amount").value = amount;
  doc.getElementById("dec_growth").value = growth;
  doc.getElementById("dec_growth").onchange();
}

test("the comparison shows both options and names a winner", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "2");

  var text = doc.getElementById("decisionResult").textContent;
  assert.match(text, /Overpay the loan/, "a 4.35% loan beats a 2% assumed return");
  assert.match(text, /Overpaying/);
  assert.match(text, /Investing/);
  assert.match(text, /Ahead by RM/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a high assumed return flips the recommendation", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "12");
  assert.match(doc.getElementById("decisionResult").textContent, /Invest the money/);
});

test("the answer states what is doing the work and that a return is not guaranteed", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "12");
  var text = doc.getElementById("decisionResult").textContent;
  assert.match(text, /assumption rather than a certainty/);
  assert.match(text, /Both spend RM 1,000\.00 a month and are valued at the same date/);
});

test("the break-even return is shown so the recommendation can be sanity-checked", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "6");
  assert.match(doc.getElementById("decisionResult").textContent,
    /Overpaying stops winning above roughly \d+\.\d\d%/);
});

test("overpaying reports the months and interest it saves", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "4");
  assert.match(doc.getElementById("decisionResult").textContent,
    /clears \d+ mths early, saves RM/);
});

test("a flat-rate loan is answered differently, with no invented overpay saving", function () {
  var f = seeded("flat");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "2");

  var text = doc.getElementById("decisionResult").textContent;
  // Even at a 2% assumed return — where overpaying would win on a mortgage — a flat
  // facility cannot be overpaid into submission.
  assert.match(text, /Invest it/);
  assert.match(text, /does not reduce the term charges/);
  assert.match(text, /Or settle now for/);
  assert.equal(/Overpay the loan/.test(text), false);
});

test("changing the horizon changes the comparison", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1000", "6");
  var atTen = doc.getElementById("decisionResult").textContent;

  doc.getElementById("horizon").value = "240";
  doc.getElementById("horizon").onchange();
  assert.notEqual(doc.getElementById("decisionResult").textContent, atTen);
});

test("a non-numeric amount is refused rather than silently treated as zero", function () {
  var f = seeded("reducing");
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  setInputs(doc, "1O00", "6");
  assert.match(doc.getElementById("decisionResult").textContent, /must be a number/);
});

test("with no loans the panel says where to add one", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var doc = helpers.loadApp(l.schema.blank()).window.document;
  forecastTab(doc);
  assert.match(doc.getElementById("decisionResult").textContent, /Add a loan/);
});

test("a loan without terms asks for them instead of comparing nothing", function () {
  var f = seeded("reducing");
  f.loan.tenureMonths = 0;
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  assert.match(doc.getElementById("decisionResult").textContent, /principal, rate and tenure/);
});

test("comparing never writes to the store", function () {
  var f = seeded("reducing");
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);
  var before = app.window.localStorage.getItem("wealthmaster.state");
  setInputs(doc, "2500", "9");
  assert.equal(app.window.localStorage.getItem("wealthmaster.state"), before);
});
