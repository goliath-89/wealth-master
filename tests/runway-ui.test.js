"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Bank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  acct.class = "cash";
  acct.liquid = true;
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "Savings";
  s.holdings.push(h);

  var p = period;
  for (var i = 0; i < 12; i++) {
    l.valuations.upsertValuation(s, {
      holdingId: h.id, period: p,
      balance: opts.balance === undefined ? 30000 : opts.balance,
      contribution: opts.contribution === undefined ? 2000 : opts.contribution
    }, "dev-1");
    p = l.valuations.prevPeriod(p);
  }

  if (opts.expenses !== undefined) s.settings.monthlyExpenses = opts.expenses;
  if (opts.income !== undefined) s.settings.monthlyIncome = opts.income;

  return { l: l, state: s, period: period };
}

function saved(app) {
  return JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
}

test("runway and savings rate show once the monthly figures are set", function () {
  var f = seeded({ expenses: 5000, income: 10000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  var text = doc.getElementById("resilience").textContent;
  assert.match(text, /Emergency runway/);
  assert.match(text, /6 months/);
  assert.match(text, /Savings rate/);
  assert.match(text, /20%/);
  assert.deepEqual(app.consoleErrors, []);
});

test("without the figures each prompts for what is missing, rather than showing zero", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  var text = doc.getElementById("resilience").textContent;
  assert.match(text, /Add your monthly spending/);
  assert.match(text, /Add your take-home/);
  assert.equal(/0 months/.test(text), false, "an unset figure must not read as no runway");
});

test("a short runway is toned as a warning, a healthy one is not", function () {
  var thin = helpers.loadApp(seeded({ expenses: 20000 }).state).window.document;
  assert.ok(thin.querySelector("#resilience .dn"), "1.5 months should read as thin");

  var healthy = helpers.loadApp(seeded({ expenses: 3000 }).state).window.document;
  assert.ok(healthy.querySelector("#resilience .up"), "10 months should read as comfortable");
});

test("the monthly figures save from the Data tab and take effect", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="data"]').click();
  assert.match(doc.getElementById("settingsNote").textContent, /Neither is set yet/);

  doc.getElementById("set_income").value = "RM 10,000";
  doc.getElementById("set_expenses").value = "5000";
  doc.getElementById("saveSettingsBtn").click();

  var s = saved(app);
  assert.equal(s.settings.monthlyIncome, 10000);
  assert.equal(s.settings.monthlyExpenses, 5000);
  assert.match(doc.getElementById("resilience").textContent, /6 months/);
});

test("the saved figures are shown back formatted as currency", function () {
  var f = seeded({ expenses: 5000, income: 10000 });
  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector('.tab[data-v="data"]').click();
  assert.equal(doc.getElementById("set_income").value, "RM 10,000");
  assert.equal(doc.getElementById("set_expenses").value, "RM 5,000");
});

test("a non-numeric figure is refused and nothing is stored", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="data"]').click();
  doc.getElementById("set_income").value = "1O000";
  doc.getElementById("saveSettingsBtn").click();

  var s = saved(app);
  assert.ok(!s.settings.monthlyIncome, "a rejected value must not be stored");
});

test("clearing a figure removes it and the metric goes back to prompting", function () {
  var f = seeded({ expenses: 5000, income: 10000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="data"]').click();
  doc.getElementById("set_expenses").value = "";
  doc.getElementById("saveSettingsBtn").click();

  assert.equal(saved(app).settings.monthlyExpenses, null);
  assert.match(doc.getElementById("resilience").textContent, /Add your monthly spending/);
});
