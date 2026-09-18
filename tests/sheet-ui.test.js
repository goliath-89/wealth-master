"use strict";
// P5.4a: holdings, assets and liabilities as sheet rows — what it is, what it is worth,
// and what it did last month.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);

  function account(name, opts) {
    opts = opts || {};
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = opts.class || "cash";
    a.liquid = opts.liquid !== false;
    if (opts.currency) a.currency = opts.currency;
    s.accounts.push(a);
    return a;
  }
  function holding(acct, name) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, inst: inst, account: account, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}
function cellValue(row) {
  var input = row.querySelector(".srow-v .cellin");
  return input ? input.value : row.querySelector(".srow-v").textContent;
}

function rowFor(doc, name) {
  return Array.prototype.filter.call(doc.querySelectorAll("#tree .srow, #assetList .srow, #liabList .srow"),
    function (r) {
      var t = r.querySelector(".srow-t");
      return t && t.textContent === name;
    })[0];
}

test("every holding row carries its value and what it did last month", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 40000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 42500 });

  var doc = helpers.loadApp(f.state).window.document;
  var row = rowFor(doc, "Savings");
  assert.ok(row, "the holding has a row");
  assert.equal(cellValue(row), "RM 42,500");
  assert.match(row.querySelector(".srow-c").textContent, /▲ \+RM 2,500\.00 \(6\.3%\)/);
  assert.ok(row.querySelector(".srow-c .yield.up"));
});

test("a fall reads as a fall, by arrow and sign as well as colour", function () {
  var f = seeded();
  var h = f.holding(f.account("Unit trusts", { class: "investment" }), "ASB");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 18000 });

  var row = rowFor(helpers.loadApp(f.state).window.document, "ASB");
  assert.match(row.querySelector(".srow-c").textContent, /▼ −RM 2,000\.00 \(10\.0%\)/);
  assert.ok(row.querySelector(".srow-c .yield.dn"));
});

test("a month with no entry says 'not updated', never a RM 0 change", function () {
  var f = seeded();
  var h = f.holding(f.account("EPF", { class: "retirement", liquid: false }), "EPF");
  record(f, { holdingId: h.id, period: period(f, 2), balance: 90000 });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 92000 });
  // Nothing for this month: the balance is carried, so the row must not claim it held still.
  var doc = helpers.loadApp(f.state).window.document;
  var row = rowFor(doc, "EPF");
  assert.match(row.querySelector(".srow-c").textContent, /not updated/);
  assert.equal(/RM 0\.00/.test(row.querySelector(".srow-c").textContent), false);
  assert.ok(row.querySelector(".srow-v .stale-mark"), "and the value is marked as carried");
});

test("a genuinely unchanged balance says so, and is not confused with a missing one", function () {
  var f = seeded();
  var h = f.holding(f.account("Current"), "Current");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 5000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 5000 });

  var row = rowFor(helpers.loadApp(f.state).window.document, "Current");
  assert.match(row.querySelector(".srow-c").textContent, /no change/);
  assert.equal(row.querySelector(".srow-v .stale-mark"), null);
});

test("a holding with no rate to convert shows its own currency, not a ringgit guess", function () {
  var f = seeded();
  var h = f.holding(f.account("US broker", { class: "investment", currency: "USD" }), "VWRA");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 5000 });

  var row = rowFor(helpers.loadApp(f.state).window.document, "VWRA");
  assert.match(row.querySelector(".srow-v").textContent, /USD/);
  assert.equal(row.querySelector(".srow-v .cellin"), null, "and it is not offered for ringgit editing");
  assert.match(row.querySelector(".srow-c").textContent, /no rate/);
});

test("an account subtotal is the sum of its rows, and the section totals the accounts", function () {
  var f = seeded();
  var acct = f.account("Investment");
  var a = f.holding(acct, "Fund A");
  var b = f.holding(acct, "Fund B");
  var p = period(f, 0);
  record(f, { holdingId: a.id, period: p, balance: 12000 });
  record(f, { holdingId: b.id, period: p, balance: 8000 });

  var doc = helpers.loadApp(f.state).window.document;
  var subtotal = doc.querySelector("#tree .srow.sub-total .srow-v").textContent;
  assert.equal(subtotal, "RM 20,000.00");
  assert.equal(doc.querySelector("#tree .sheet-total").textContent, "RM 20,000.00");
});

test("physical assets and liabilities are rows in the same shape", function () {
  var f = seeded();
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  home.liquid = false;
  f.state.assets.push(home);
  var loan = f.l.schema.newLiability("dev-1");
  loan.name = "Car loan";
  loan.type = "hire purchase";
  f.state.liabilities.push(loan);
  record(f, { assetId: home.id, period: period(f, 1), balance: 500000 });
  record(f, { assetId: home.id, period: period(f, 0), balance: 520000 });
  record(f, { liabilityId: loan.id, period: period(f, 1), balance: 60000 });
  record(f, { liabilityId: loan.id, period: period(f, 0), balance: 58500 });

  var doc = helpers.loadApp(f.state).window.document;
  var asset = rowFor(doc, "Family home");
  assert.equal(cellValue(asset), "RM 520,000");
  assert.match(asset.querySelector(".srow-c").textContent, /▲ \+RM 20,000\.00/);
  assert.ok(asset.querySelector("[data-edit-asset]"), "editing still opens the dialog");

  var debt = rowFor(doc, "Car loan");
  assert.equal(cellValue(debt), "RM 58,500");
  assert.match(debt.querySelector(".srow-c").textContent, /▼ −RM 1,500\.00/);
  assert.ok(debt.querySelector("[data-edit-liab]"));
});

test("the sheet has a column header and keeps its structural controls", function () {
  var f = seeded();
  f.holding(f.account("Savings"), "Savings");
  var doc = helpers.loadApp(f.state).window.document;
  var cols = doc.querySelector("#tree .sheet-cols").textContent;
  assert.match(cols, /Holding/);
  assert.match(cols, /1 month/);
  assert.match(cols, /Value/);
  assert.ok(doc.querySelector("#tree [data-add-acct]"), "+ Account");
  assert.ok(doc.querySelector("#tree [data-add-hold]"), "+ Holding");
  assert.ok(doc.querySelector("#tree [data-edit-inst]"), "Edit institution");
});

test("a name typed into a holding cannot inject markup through a row (SEC-7)", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "<img src=x onerror=alert(1)>");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 100 });

  var app = helpers.loadApp(f.state);
  assert.equal(app.window.document.querySelectorAll("#tree img").length, 0);
  assert.deepEqual(app.consoleErrors, []);
});
