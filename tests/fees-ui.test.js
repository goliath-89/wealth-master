"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-4.7. The engine and its unit tests already existed; what was missing was any call
// site, so fee drag reached no screen. These tests assert on rendered DOM specifically
// so that gap cannot reopen — a passing analytics.test.js said nothing about it.

function lib() { return helpers.loadLib(helpers.freshWindow()); }

function seeded(holdings) {
  var l = lib();
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Principal";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Unit trust";
  acct.class = "investment";
  s.accounts.push(acct);

  var made = [];
  (holdings || []).forEach(function (h) {
    var rec = l.schema.newHolding("dev-1");
    rec.accountId = acct.id;
    rec.name = h.name;
    rec.feePct = h.feePct;
    s.holdings.push(rec);
    made.push(rec);
    if (h.balance !== undefined) {
      l.valuations.upsertValuation(s, { holdingId: rec.id, period: period, balance: h.balance }, "dev-1");
    }
  });

  return { l: l, state: s, holdings: made, acct: acct, period: period };
}

function tiles(doc) { return doc.getElementById("resilience").textContent; }

test("the fee tile reports the yearly cost and the rate it averages", function () {
  var f = seeded([
    { name: "Equity fund", feePct: 1.5, balance: 100000 },
    { name: "Bond fund", feePct: 0.5, balance: 100000 }
  ]);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  var text = tiles(doc);
  assert.match(text, /Fees/);
  assert.match(text, /RM 2,000\.00/);
  // 2,000 on 200,000 charged is 1.00% — the weighted average, not the sum of the rates.
  assert.match(text, /1\.00% a year on RM 200,000\.00/);
  assert.deepEqual(app.consoleErrors, []);
});

test("the breakdown lists each fee-charging holding, dearest first", function () {
  var f = seeded([
    { name: "Cheap tracker", feePct: 0.2, balance: 50000 },
    { name: "Expensive fund", feePct: 1.8, balance: 80000 }
  ]);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  var rows = doc.querySelectorAll("#feesList .wline");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Expensive fund/, "the dearest fee names the lever, so it leads");
  assert.match(rows[0].textContent, /RM 1,440\.00/);
  assert.match(rows[1].textContent, /Cheap tracker/);
  assert.match(rows[1].textContent, /RM 100\.00/);
  assert.match(doc.getElementById("feesList").textContent, /A year in fees/);
  assert.match(doc.getElementById("feesList").textContent, /RM 1,540\.00/);
});

test("a portfolio with no fee rates set shows a dash, not a confident zero", function () {
  var f = seeded([{ name: "Savings", feePct: 0, balance: 40000 }]);
  var doc = helpers.loadApp(f.state).window.document;

  assert.match(tiles(doc), /No holding has a fee rate set/);
  assert.equal(/RM 0\.00 a year/.test(tiles(doc)), false);
  assert.equal(doc.getElementById("feesWrap").style.display, "none",
    "an empty breakdown card is worse than none");
});

test("a fee-charging holding with no balance recorded is not counted at zero", function () {
  var f = seeded([{ name: "New fund", feePct: 1.5 }]);
  var doc = helpers.loadApp(f.state).window.document;

  // Blank is not zero: an unvalued holding has an unknown balance, so it has an unknown
  // fee, and inventing RM 0.00 for it would understate the drag.
  assert.match(tiles(doc), /No holding has a fee rate set/);
  assert.equal(doc.querySelectorAll("#feesList .wline").length, 0);
});

test("a holding on an archived account drops out of the fee drag", function () {
  var f = seeded([{ name: "Old fund", feePct: 2, balance: 30000 }]);
  f.state.accounts[0].archived = true;
  var doc = helpers.loadApp(f.state).window.document;

  assert.match(tiles(doc), /No holding has a fee rate set/);
  assert.equal(doc.getElementById("feesWrap").style.display, "none");
});

test("the fee figures update after a rate is edited", function () {
  var f = seeded([{ name: "Equity fund", feePct: 1, balance: 100000 }]);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.match(tiles(doc), /RM 1,000\.00/);

  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-hold="' + f.holdings[0].id + '"]').click();
  doc.getElementById("h_fee").value = "2";
  doc.getElementById("holdSave").click();

  assert.match(tiles(doc), /RM 2,000\.00/);
  assert.match(doc.getElementById("feesList").textContent, /RM 2,000\.00/);
});

test("SEC-7: a script-like holding name cannot execute from the fee breakdown", function () {
  var f = seeded([{ name: '<img src=x onerror="window.__pwned=1">', feePct: 1, balance: 10000 }]);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(doc.querySelector("#feesList img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("feesList").textContent, /onerror/);
});
