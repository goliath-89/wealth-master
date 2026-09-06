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
  inst.name = "ASNB";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = "investment";
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = opts.name || "Equity fund";
  h.unitBased = opts.unitBased === undefined ? true : opts.unitBased;
  h.fixedPrice = opts.fixedPrice === undefined ? null : opts.fixedPrice;
  s.holdings.push(h);

  if (opts.entries) {
    opts.entries.forEach(function (e) {
      l.valuations.upsertValuation(s, Object.assign({ holdingId: h.id }, e), "dev-1");
    });
  }

  return { l: l, state: s, h: h, acct: acct, period: period };
}

function accountsTab(doc) { doc.querySelector('.tab[data-v="accounts"]').click(); }
function saved(app) {
  return JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
}

test("a unit-based holding shows its units and price", function () {
  var f = seeded({
    entries: [{ period: helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod(),
                balance: 12500, units: 10000, unitPrice: 1.25, contribution: 10000 }]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  var text = doc.getElementById("tree").textContent;
  assert.match(text, /10,000 units @ RM 1\.25/);
  assert.deepEqual(app.consoleErrors, []);
});

test("unrealised gain is shown against cost basis", function () {
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  var f = seeded({
    entries: [{ period: period, balance: 12500, units: 10000, unitPrice: 1.25, contribution: 10000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("tree").textContent;
  assert.match(text, /RM 2,500\.00 \(25\.0%\) unrealised/);
  assert.ok(doc.querySelector("#tree .yield.up"));
});

test("a loss is shown as a loss", function () {
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  var f = seeded({
    entries: [{ period: period, balance: 8500, units: 10000, unitPrice: 0.85, contribution: 10000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);
  assert.match(doc.getElementById("tree").textContent, /RM 1,500\.00 \(-15\.0%\) unrealised/);
  assert.ok(doc.querySelector("#tree .yield.dn"));
});

test("a fixed-price fund shows units at the pinned price and no unrealised gain", function () {
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  var f = seeded({
    name: "ASB", fixedPrice: 1.00,
    entries: [{ period: period, balance: 52875, contribution: 50000, income: 2875 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("tree").textContent;
  assert.match(text, /52,875 units @ RM 1 fixed/);
  // The price cannot move, so reporting an unrealised gain would be meaningless.
  assert.equal(/unrealised/.test(text), false);
});

test("a holding that is not unit-based shows no unit line", function () {
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  var f = seeded({
    unitBased: false,
    entries: [{ period: period, balance: 10000, contribution: 10000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);
  assert.equal(/units @/.test(doc.getElementById("tree").textContent), false);
});

test("a fixed price is saved from the holding form", function () {
  var f = seeded({ unitBased: false });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.querySelector('[data-edit-hold="' + f.h.id + '"]').click();
  doc.getElementById("h_units").checked = true;
  doc.getElementById("h_fixed").value = "1.00";
  doc.getElementById("holdSave").click();

  var h = saved(app).holdings[0];
  assert.equal(h.fixedPrice, 1);
  assert.equal(h.unitBased, true);
});

test("a non-numeric fixed price is refused", function () {
  var f = seeded({ unitBased: false });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.querySelector('[data-edit-hold="' + f.h.id + '"]').click();
  doc.getElementById("h_fixed").value = "1.O0";
  doc.getElementById("holdSave").click();

  assert.match(doc.getElementById("holdErr").textContent, /Fixed unit price must be a number/);
  assert.equal(saved(app).holdings[0].fixedPrice, null);
});

test("the fixed price round-trips back into the form", function () {
  var f = seeded({ fixedPrice: 1.00 });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);
  doc.querySelector('[data-edit-hold="' + f.h.id + '"]').click();
  assert.equal(doc.getElementById("h_fixed").value, "1");
});

test("REGRESSION: units and price survive a save through the month grid", function () {
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  var f = seeded({
    entries: [{ period: period, balance: 12500, units: 10000, unitPrice: 1.25, contribution: 10000 }]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  // upsertValuation used to drop units and unitPrice entirely, which made unit-based
  // holdings unrecordable; saving a month must not wipe what a statement supplied.
  doc.querySelector('.tab[data-v="month"]').click();
  doc.getElementById("periodPick").value = period;
  doc.getElementById("periodPick").onchange();
  doc.getElementById("m_" + f.h.id + "_balance").value = "13000";
  doc.getElementById("saveMonthBtn").click();

  var v = saved(app).valuations.filter(function (x) { return x.holdingId === f.h.id; })[0];
  assert.equal(v.balance, 13000, "the new balance is saved");
  assert.equal(v.units, 10000, "and the units are not wiped");
  assert.equal(v.unitPrice, 1.25);
});
