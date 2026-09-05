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
  h.name = "Deposit fund";
  s.holdings.push(h);

  // A sustained contribution history, so the average reflects a habit.
  var p = period;
  for (var i = 0; i < 6; i++) {
    l.valuations.upsertValuation(s, {
      holdingId: h.id, period: p,
      balance: opts.balance === undefined ? 40000 : opts.balance,
      contribution: opts.contribution === undefined ? 500 : opts.contribution
    }, "dev-1");
    p = l.valuations.prevPeriod(p);
  }

  return { l: l, state: s, h: h, period: period };
}

function forecastTab(doc) { doc.querySelector('.tab[data-v="forecast"]').click(); }
function saved(app) {
  var raw = app.window.localStorage.getItem("wealthmaster.state");
  return raw ? JSON.parse(raw) : { goals: [] };
}

function addGoal(doc, name, target, date) {
  doc.getElementById("addGoalBtn").click();
  doc.getElementById("g_name").value = name;
  doc.getElementById("g_target").value = target;
  if (date !== undefined) doc.getElementById("g_date").value = date;
  doc.getElementById("goalSave").click();
}

test("adding a goal stores it and shows progress against the target", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  addGoal(doc, "House deposit", "RM 100,000", f.l.loans.addMonths(f.period, 36));

  var s = saved(app);
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].targetAmount, 100000);

  var text = doc.getElementById("goalList").textContent;
  assert.match(text, /House deposit/);
  assert.match(text, /RM 40,000\.00 of RM 100,000\.00/);
  assert.match(text, /40%/);
  assert.deepEqual(app.consoleErrors, []);
});

test("saving too little is called behind, with both figures and a real arrival date", function () {
  var f = seeded({ contribution: 100 });
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 12));

  var text = doc.getElementById("goalList").textContent;
  assert.match(text, /Behind/);
  assert.match(text, /Putting aside RM 100\.00 a month against RM/);
  assert.match(text, /at this rate/);
});

test("saving enough is called on track", function () {
  var f = seeded({ contribution: 6000 });
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  // Dated relative to today: RM 60,000 short at RM 6,000 a month needs about ten
  // months, so a fixed future date would drift into "behind" as time passes.
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 24));
  assert.match(doc.getElementById("goalList").textContent, /On track/);
});

test("a goal already met reports reached rather than demanding more", function () {
  var f = seeded({ balance: 120000 });
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  addGoal(doc, "Emergency fund", "100000", f.l.loans.addMonths(f.period, 36));
  var text = doc.getElementById("goalList").textContent;
  assert.match(text, /Reached/);
  assert.match(text, /100%/);
});

test("a goal with no contributions recorded is unknown, not behind", function () {
  var f = seeded({ contribution: null });
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 36));
  var text = doc.getElementById("goalList").textContent;
  assert.match(text, /No contributions recorded/);
  assert.match(text, /Record contributions on the Month tab/);
});

test("a goal without a date asks for one instead of guessing", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  addGoal(doc, "Someday fund", "100000", "");
  assert.match(doc.getElementById("goalList").textContent, /No target date/);
});

test("only liquid holdings are offered as funding, and illiquid ones excluded", function () {
  var f = seeded();
  var locked = f.l.schema.newAccount("dev-1");
  locked.institutionId = f.state.institutions[0].id;
  locked.name = "EPF";
  locked.liquid = false;
  f.state.accounts.push(locked);
  var hl = f.l.schema.newHolding("dev-1");
  hl.accountId = locked.id;
  hl.name = "Akaun 1";
  f.state.holdings.push(hl);
  f.l.valuations.upsertValuation(f.state, {
    holdingId: hl.id, period: f.period, balance: 300000
  }, "dev-1");

  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 36));

  // EPF must not count toward a deposit — it cannot pay for one.
  assert.match(doc.getElementById("goalList").textContent, /RM 40,000\.00 of RM 100,000\.00/);
});

test("editing a goal updates it in place", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 36));

  var id = saved(app).goals[0].id;
  doc.querySelector('[data-edit-goal="' + id + '"]').click();
  doc.getElementById("g_target").value = "150000";
  doc.getElementById("goalSave").click();

  var s = saved(app);
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].targetAmount, 150000);
});

test("a goal without a name is refused", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  doc.getElementById("addGoalBtn").click();
  doc.getElementById("g_name").value = "  ";
  doc.getElementById("g_target").value = "1000";
  doc.getElementById("goalSave").click();

  assert.match(doc.getElementById("goalErr").textContent, /Name is required/);
  assert.equal(saved(app).goals.length, 0);
});

test("a non-numeric target is refused", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  doc.getElementById("addGoalBtn").click();
  doc.getElementById("g_name").value = "House";
  doc.getElementById("g_target").value = "1OO000";
  doc.getElementById("goalSave").click();

  assert.match(doc.getElementById("goalErr").textContent, /Target amount must be a number/);
  assert.equal(saved(app).goals.length, 0);
});

test("deleting a goal tombstones it and drops it from the list", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);
  addGoal(doc, "House deposit", "100000", f.l.loans.addMonths(f.period, 36));

  var id = saved(app).goals[0].id;
  doc.querySelector('[data-edit-goal="' + id + '"]').click();
  doc.getElementById("goalDelete").click();

  var s = saved(app);
  assert.equal(s.goals.length, 1, "tombstone, not removal");
  assert.equal(s.goals[0].deleted, true);
  assert.match(doc.getElementById("goalList").textContent, /No goals/);
});

test("SEC-7: a goal name containing HTML is escaped", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);
  addGoal(doc, "<img src=x onerror=\"window.__pwned=1\">", "100000", f.l.loans.addMonths(f.period, 36));

  assert.equal(app.window.__pwned, undefined);
  assert.equal(doc.querySelectorAll("#goalList img").length, 0);
});
