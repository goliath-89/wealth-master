"use strict";
// P5.4b: typing a figure straight into a sheet row.
//
// The sheet is the screen the owner will use every month, so the rules that protect the
// data matter most here: blank is not zero, a carried figure is never recorded by
// accident, and editing a balance must not disturb the rest of that month's entry.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function account(name, cls) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls || "cash";
    s.accounts.push(a);
    return a;
  }
  function holding(acct, name, opts) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    if (opts && opts.unitBased) { h.unitBased = true; h.fixedUnitPrice = 1; }
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, account: account, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}
function cell(doc, id) { return doc.getElementById("cell_" + id); }
// jsdom reports no focus, so blur() fires nothing — dispatch the event the app listens for.
function leave(win, el) { el.dispatchEvent(new win.FocusEvent("blur")); }
function enter(win, el) {
  el.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}
function stored(app, subjectId, p) {
  var state = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  return state.valuations.filter(function (v) {
    return !v.deleted && v.period === p &&
      (v.holdingId === subjectId || v.assetId === subjectId || v.liabilityId === subjectId);
  })[0];
}

test("typing a figure into a row records it for the month being edited", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var el = cell(doc, h.id);
  assert.ok(el, "the row has an editable cell");
  el.value = "42,500";
  leave(app.window, el);

  var saved = stored(app, h.id, period(f, 0));
  assert.ok(saved, "a valuation is written for this month");
  assert.equal(saved.balance, 42500);
  // The screen reflects it without a reload: the row redraws from state.
  assert.equal(cell(doc, h.id).value, "RM 42,500");
  assert.deepEqual(app.consoleErrors, []);
});

test("RM and commas are accepted, as they are everywhere else in the app", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "RM 1,234.56";
  leave(app.window, el);
  assert.equal(stored(app, h.id, period(f, 0)).balance, 1234.56);
});

test("Enter saves and moves to the next row, so a month can be entered without the mouse", function () {
  var f = seeded();
  var acct = f.account("Investment", "investment");
  var a = f.holding(acct, "Fund A");
  var b = f.holding(acct, "Fund B");

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var first = cell(doc, a.id);
  first.value = "12000";
  enter(app.window, first);

  assert.equal(stored(app, a.id, period(f, 0)).balance, 12000);
  assert.equal(doc.activeElement.id, "cell_" + b.id, "focus lands on the next row");
});

test("clearing a cell records nothing for that month — blank is not zero", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "";
  leave(app.window, el);

  assert.equal(stored(app, h.id, period(f, 0)), undefined, "the entry is withdrawn, not set to 0");
  var state = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(state.valuations.filter(function (v) { return v.deleted; }).length, 1,
    "and it is tombstoned rather than removed (FR-7.5)");
});

test("a typed zero is a real zero, and survives as one", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "0";
  leave(app.window, el);
  assert.equal(stored(app, h.id, period(f, 0)).balance, 0);
});

test("a carried-forward cell offers last month's figure as a hint, never as an entry", function () {
  var f = seeded();
  var h = f.holding(f.account("EPF", "retirement"), "EPF");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 90000 });

  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  assert.equal(el.value, "", "nothing is recorded for this month");
  assert.match(el.getAttribute("placeholder"), /carried/);

  // Tabbing through without typing must not turn the hint into an entry.
  leave(app.window, el);
  assert.equal(stored(app, h.id, period(f, 0)), undefined);
});

test("editing a balance leaves the rest of that month's entry alone", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000, contribution: 1500, income: 120 });

  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "41000";
  leave(app.window, el);

  var saved = stored(app, h.id, period(f, 0));
  assert.equal(saved.balance, 41000);
  assert.equal(saved.contribution, 1500, "a contribution is not collateral damage");
  assert.equal(saved.income, 120);
});

test("an unparseable figure is refused and marked, and nothing is written", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "about forty thousand";
  leave(app.window, el);

  assert.ok(el.classList.contains("badfield"), "the cell says which figure is wrong");
  assert.equal(stored(app, h.id, period(f, 0)).balance, 40000, "the stored figure is untouched");
  assert.equal(el.value, "about forty thousand", "and what was typed is still there to correct");
});

test("Escape puts the cell back the way it was", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var el = cell(app.window.document, h.id);
  el.value = "999";
  el.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el.value, "RM 40,000");
  assert.equal(stored(app, h.id, period(f, 0)).balance, 40000);
});

test("the month picker decides which month the sheet reads and writes", function () {
  var f = seeded();
  var h = f.holding(f.account("Savings"), "Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 38000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.equal(cell(doc, h.id).value, "RM 40,000", "opens on the current month");

  var picker = doc.getElementById("sheetPeriod");
  picker.value = period(f, 1);
  picker.dispatchEvent(new app.window.Event("change"));
  assert.equal(cell(doc, h.id).value, "RM 38,000", "and follows the picker");

  var el = cell(doc, h.id);
  el.value = "39000";
  leave(app.window, el);
  assert.equal(stored(app, h.id, period(f, 1)).balance, 39000, "the edit lands in the chosen month");
  assert.equal(stored(app, h.id, period(f, 0)).balance, 40000, "and not in this one");
});

test("a unit-based holding is not edited in ringgit here", function () {
  var f = seeded();
  var h = f.holding(f.account("ASNB", "investment"), "ASB", { unitBased: true });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 10000, units: 10000, unitPrice: 1 });

  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(cell(doc, h.id), null, "its balance is units times price, so the cell is read-only");
});

// Saving redraws the sheet, so the element a click was travelling to is replaced before
// it lands. Losing focus on every cell-to-cell click makes the sheet unusable as a sheet.
test("clicking straight into the next cell keeps the caret there", function () {
  var f = seeded();
  var acct = f.account("Investment", "investment");
  var a = f.holding(acct, "Fund A");
  var b = f.holding(acct, "Fund B");

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var first = cell(doc, a.id);
  first.value = "5000";
  // A real click lands mousedown on the next cell before the first one blurs.
  cell(doc, b.id).dispatchEvent(new app.window.MouseEvent("mousedown", { bubbles: true }));
  leave(app.window, first);

  assert.equal(stored(app, a.id, period(f, 0)).balance, 5000);
  assert.equal(doc.activeElement.id, "cell_" + b.id);
});
