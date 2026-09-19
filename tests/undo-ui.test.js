"use strict";
// P8: a figure that was typed over can be taken back — exactly, and only in the order it
// was made.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var now = l.valuations.currentPeriod(), prev = l.valuations.prevPeriod(now);
  var inst = l.schema.newInstitution("d"); inst.name = "Maybank"; s.institutions.push(inst);
  var ids = {};
  function holding(key, name, cls, rows) {
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name;
    s.holdings.push(h); ids[key] = h.id;
    rows.forEach(function (r) {
      l.valuations.upsertValuation(s, { holdingId: h.id, period: r[0], balance: r[1], contribution: r[2] === undefined ? null : r[2], income: r[3] === undefined ? null : r[3] }, "d");
    });
  }
  // Savings has a full entry this month: a balance, a contribution and an income.
  holding("savings", "Savings", "cash", [[prev, 5000], [now, 6000, 100, 25]]);
  holding("epf", "EPF", "retirement", [[prev, 11000], [now, 12000]]);
  holding("open", "Nothing yet", "cash", [[prev, 800]]);
  return { l: l, state: s, ids: ids, now: now, prev: prev };
}

function load() {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  return { f: f, app: app, win: app.window, doc: app.window.document, WM: app.window.WM };
}

function stored(c) { return JSON.parse(c.win.localStorage.getItem("wealthmaster.state")); }
function entry(c, id, period) { return c.WM.valuationFor(stored(c), id, period || c.f.now); }
function edit(c, id, value) {
  var cell = c.doc.getElementById("cell_" + id);
  cell.value = value;
  cell.dispatchEvent(new c.win.FocusEvent("blur"));
}
function ctrlZ(c, target) {
  var e = new c.win.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
  (target || c.doc.body).dispatchEvent(e);
  return e;
}
function undoButton(c) { return c.doc.getElementById("snackAction"); }
function net(c) { return c.doc.getElementById("navNet").textContent; }

test("saving a figure says so and offers Undo", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  assert.match(c.doc.getElementById("snackMsg").textContent, /Saved Savings/);
  assert.equal(undoButton(c).hidden, false);
  assert.match(undoButton(c).textContent, /Undo/);
});

test("Undo puts the figure back exactly, including the rest of the month's entry", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  assert.equal(entry(c, c.f.ids.savings).balance, 6500);
  undoButton(c).click();
  var v = entry(c, c.f.ids.savings);
  assert.equal(v.balance, 6000);
  assert.equal(v.contribution, 100, "the contribution recorded with it");
  assert.equal(v.income, 25, "and the income");
  assert.match(c.doc.getElementById("snackMsg").textContent, /Undone/);
  assert.match(c.doc.getElementById("cell_" + c.f.ids.savings).value, /6,000/, "and the sheet shows it");
});

test("the headline follows the undo", function () {
  var c = load();
  var before = net(c);
  edit(c, c.f.ids.savings, "9000");
  assert.notEqual(net(c), before);
  undoButton(c).click();
  assert.equal(net(c), before);
});

test("undoing the first figure ever recorded for a month clears it — blank, not zero", function () {
  var c = load();
  assert.equal(entry(c, c.f.ids.open), null);
  edit(c, c.f.ids.open, "900");
  assert.equal(entry(c, c.f.ids.open).balance, 900);
  undoButton(c).click();
  assert.equal(entry(c, c.f.ids.open), null, "not a RM 0 entry");
  assert.equal(c.doc.getElementById("cell_" + c.f.ids.open).value, "");
});

test("undoing a cleared figure brings it back", function () {
  var c = load();
  edit(c, c.f.ids.epf, "");
  assert.equal(entry(c, c.f.ids.epf), null);
  undoButton(c).click();
  assert.equal(entry(c, c.f.ids.epf).balance, 12000);
});

test("steps come off last first, and there is a point where there is nothing left", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6100");
  edit(c, c.f.ids.savings, "6200");
  edit(c, c.f.ids.epf, "12500");
  ctrlZ(c);
  assert.equal(entry(c, c.f.ids.epf).balance, 12000);
  assert.equal(entry(c, c.f.ids.savings).balance, 6200);
  ctrlZ(c);
  assert.equal(entry(c, c.f.ids.savings).balance, 6100);
  ctrlZ(c);
  assert.equal(entry(c, c.f.ids.savings).balance, 6000);
  var e = ctrlZ(c);
  assert.equal(e.defaultPrevented, false, "nothing to undo, so the keystroke is left alone");
});

test("Ctrl+Z takes back the last save when nothing is being typed", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  var e = ctrlZ(c);
  assert.equal(e.defaultPrevented, true);
  assert.equal(entry(c, c.f.ids.savings).balance, 6000);
});

test("in a box with text typed into it, Ctrl+Z is the browser's own", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  var cell = c.doc.getElementById("cell_" + c.f.ids.epf);
  cell.value = "12345"; // typed, not yet saved
  var e = ctrlZ(c, cell);
  assert.equal(e.defaultPrevented, false);
  assert.equal(entry(c, c.f.ids.savings).balance, 6500, "the save was not touched");
});

test("in a box that holds what was saved, Ctrl+Z takes back the save", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  var cell = c.doc.getElementById("cell_" + c.f.ids.savings);
  var e = ctrlZ(c, cell);
  assert.equal(e.defaultPrevented, true);
  assert.equal(entry(c, c.f.ids.savings).balance, 6000);
});

test("an edit that changes nothing leaves nothing to undo", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6,000.00");
  assert.equal(ctrlZ(c).defaultPrevented, false);
});

test("a whole month saved from the grid is undone as one step", function () {
  var c = load();
  var pick = c.doc.getElementById("periodPick");
  var f = c.f;
  function field(id, name) { return c.doc.getElementById("m_" + id + "_" + name); }
  field(f.ids.savings, "balance").value = "7000";
  field(f.ids.epf, "balance").value = "13000";
  field(f.ids.open, "balance").value = "850";
  c.doc.getElementById("saveMonthBtn").click();
  assert.equal(entry(c, f.ids.epf).balance, 13000);
  assert.equal(entry(c, f.ids.open).balance, 850);
  assert.equal(undoButton(c).hidden, false);
  undoButton(c).click();
  assert.equal(entry(c, f.ids.savings).balance, 6000);
  assert.equal(entry(c, f.ids.epf).balance, 12000);
  assert.equal(entry(c, f.ids.open), null);
  assert.equal(pick.value, c.f.now);
});

test("a balance changed in the holding dialog can be undone too", function () {
  var c = load();
  c.doc.querySelector('[data-edit-hold="' + c.f.ids.savings + '"]').click();
  var box = c.doc.getElementById("h_balance");
  box.value = "6800";
  c.doc.getElementById("holdSave").click();
  assert.equal(entry(c, c.f.ids.savings).balance, 6800);
  assert.match(c.doc.getElementById("snackMsg").textContent, /Holding updated/);
  assert.equal(undoButton(c).hidden, false);
  undoButton(c).click();
  assert.equal(entry(c, c.f.ids.savings).balance, 6000);
});

test("a dialog save that touches no figure offers no Undo", function () {
  var c = load();
  c.doc.querySelector('[data-edit-hold="' + c.f.ids.savings + '"]').click();
  c.doc.getElementById("h_name").value = "Savings renamed";
  c.doc.getElementById("holdSave").click();
  assert.match(c.doc.getElementById("snackMsg").textContent, /Holding updated/);
  assert.equal(undoButton(c).hidden, true);
});

test("an ordinary message carries no Undo button", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  edit(c, c.f.ids.savings, "abc");
  assert.match(c.doc.getElementById("snackMsg").textContent, /not a number/);
  assert.equal(undoButton(c).hidden, true);
});

test("the figures of other months are never touched by an undo", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  undoButton(c).click();
  assert.equal(entry(c, c.f.ids.savings, c.f.prev).balance, 5000);
});

test("erasing everything clears the history: nothing can be written back into empty data", function () {
  var c = load();
  edit(c, c.f.ids.savings, "6500");
  c.win.confirm = function () { return true; };
  c.doc.getElementById("wipeBtn").click();
  var e = ctrlZ(c);
  assert.equal(e.defaultPrevented, false);
  assert.equal(stored(c).valuations.filter(function (v) { return !v.deleted; }).length, 0);
});

test("the history is capped, so a long session cannot grow without limit", function () {
  var c = load();
  for (var i = 0; i < 60; i++) edit(c, c.f.ids.savings, String(7000 + i));
  var steps = 0;
  while (ctrlZ(c).defaultPrevented) { steps++; if (steps > 100) break; }
  assert.equal(steps, 50);
});

test("undo works from the drill-down list as well", function () {
  var c = load();
  c.doc.querySelector('[data-detail="assets"]').dispatchEvent(new c.win.MouseEvent("click", { bubbles: true, cancelable: true }));
  var cell = c.doc.getElementById("dcell_" + c.f.ids.savings);
  cell.value = "6600";
  cell.dispatchEvent(new c.win.FocusEvent("blur"));
  assert.equal(entry(c, c.f.ids.savings).balance, 6600);
  undoButton(c).click();
  assert.equal(entry(c, c.f.ids.savings).balance, 6000);
  assert.deepEqual(c.app.consoleErrors, []);
});
