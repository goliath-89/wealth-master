"use strict";
// Entering a figure from the dialog that defines the thing, not only from the sheet.
//
// The asset dialog always had a value field; holdings and liabilities did not, so the
// only way in was the sheet or the Month-end screen — which made the dialog look like
// the place to do it and then refuse. One rule now, wherever a balance is typed.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  acct.class = "cash";
  s.accounts.push(acct);
  function holding(name, opts) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    if (opts && opts.unitBased) { h.unitBased = true; }
    s.holdings.push(h);
    return h;
  }
  function liability(name) {
    var x = l.schema.newLiability("dev-1");
    x.name = name;
    x.type = "hire purchase";
    s.liabilities.push(x);
    return x;
  }
  return { l: l, state: s, holding: holding, liability: liability };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}
function stored(app, subjectId, p) {
  var state = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  return state.valuations.filter(function (v) {
    return !v.deleted && v.period === p &&
      (v.holdingId === subjectId || v.assetId === subjectId || v.liabilityId === subjectId);
  })[0];
}

test("the holding dialog offers a balance, named for the month it will record", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var doc = helpers.loadApp(f.state).window.document;
  doc.getElementById("open_" + h.id).click();
  doc.querySelector("[data-edit-hold]").click();

  assert.equal(doc.getElementById("h_balance").value, "RM 40,000", "the month's figure is there to edit");
  assert.match(doc.getElementById("h_balanceMonth").textContent, /^for [A-Z][a-z]{2} \d{4}$/);
});

test("changing it records the figure for that month", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-hold]").click();
  doc.getElementById("h_balance").value = "43,250";
  doc.getElementById("holdSave").click();

  assert.equal(stored(app, h.id, period(f, 0)).balance, 43250);
  assert.match(doc.getElementById("cell_" + h.id).value, /RM 43,250/, "and the sheet agrees");
});

test("a brand new holding can be given its first figure in the same breath", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector("[data-add-hold]").click();
  doc.getElementById("h_name").value = "ASB";
  doc.getElementById("h_balance").value = "25000";
  doc.getElementById("holdSave").click();

  var state = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  var created = state.holdings.filter(function (h) { return h.name === "ASB"; })[0];
  assert.ok(created);
  assert.equal(stored(app, created.id, period(f, 0)).balance, 25000);
  assert.deepEqual(app.consoleErrors, []);
});

test("clearing the field withdraws the figure — blank is not zero", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-hold]").click();
  doc.getElementById("h_balance").value = "";
  doc.getElementById("holdSave").click();

  assert.equal(stored(app, h.id, period(f, 0)), undefined);
});

test("a field left untouched records nothing, whatever else the dialog changes", function () {
  var f = seeded();
  var h = f.holding("EPF");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 90000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-hold]").click();
  // The figure on screen is carried from last month, so the field is empty with a hint.
  assert.equal(doc.getElementById("h_balance").value, "");
  assert.match(doc.getElementById("h_balance").placeholder, /carried/);

  doc.getElementById("h_name").value = "EPF savings";
  doc.getElementById("holdSave").click();

  assert.equal(stored(app, h.id, period(f, 0)), undefined, "nothing recorded for this month");
  assert.equal(stored(app, h.id, period(f, 1)).balance, 90000, "and last month is untouched");
});

test("the rest of the month's entry survives a balance edit from the dialog", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000, contribution: 1000, income: 95 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-hold]").click();
  doc.getElementById("h_balance").value = "41000";
  doc.getElementById("holdSave").click();

  var v = stored(app, h.id, period(f, 0));
  assert.equal(v.balance, 41000);
  assert.equal(v.contribution, 1000);
  assert.equal(v.income, 95);
});

test("an unparseable balance is refused and the dialog stays open to fix it", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-hold]").click();
  doc.getElementById("h_balance").value = "forty-one thousand";
  doc.getElementById("holdSave").click();

  assert.ok(doc.getElementById("holdModal").classList.contains("on"), "still open");
  assert.match(doc.getElementById("holdErr").textContent, /Balance must be a number/);
  assert.equal(stored(app, h.id, period(f, 0)).balance, 40000, "and nothing was written");
});

test("a unit-based holding has no ringgit field to mislead", function () {
  var f = seeded();
  var h = f.holding("Public Islamic", { unitBased: true });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 10000, units: 10000, unitPrice: 1 });

  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector("[data-edit-hold]").click();
  assert.equal(doc.getElementById("h_balance").disabled, true,
    "its balance is units times price, recorded on the Month-end screen");
});

test("a liability takes its outstanding balance in its own dialog", function () {
  var f = seeded();
  var car = f.liability("Car loan");
  record(f, { liabilityId: car.id, period: period(f, 0), balance: 60000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-liab]").click();
  assert.equal(doc.getElementById("l_balance").value, "RM 60,000");

  doc.getElementById("l_balance").value = "58500";
  doc.getElementById("liabSave").click();
  assert.equal(stored(app, car.id, period(f, 0)).balance, 58500);
});

test("the asset dialog names the month it writes to, and still writes it", function () {
  var f = seeded();
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  f.state.assets.push(home);
  record(f, { assetId: home.id, period: period(f, 0), balance: 500000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector("[data-edit-asset]").click();
  assert.equal(doc.getElementById("s_value").value, "RM 500,000");
  assert.match(doc.getElementById("s_valueMonth").textContent, /^for /);

  doc.getElementById("s_value").value = "520000";
  doc.getElementById("assetSave").click();
  assert.equal(stored(app, home.id, period(f, 0)).balance, 520000);
});

test("the dialog writes to the month the sheet is showing, not always this one", function () {
  var f = seeded();
  var h = f.holding("KDI Save");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 38000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var picker = doc.getElementById("sheetPeriod");
  picker.value = period(f, 1);
  picker.dispatchEvent(new app.window.Event("change"));

  doc.querySelector("[data-edit-hold]").click();
  assert.equal(doc.getElementById("h_balance").value, "RM 38,000", "last month's figure");
  doc.getElementById("h_balance").value = "39000";
  doc.getElementById("holdSave").click();

  assert.equal(stored(app, h.id, period(f, 1)).balance, 39000);
  assert.equal(stored(app, h.id, period(f, 0)).balance, 40000, "this month is left alone");
});
