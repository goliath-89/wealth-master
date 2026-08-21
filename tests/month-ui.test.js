"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// One institution, one account, two holdings — enough to test bulk entry.
function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Kenanga";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  s.accounts.push(acct);

  var h1 = l.schema.newHolding("dev-1");
  h1.accountId = acct.id;
  h1.name = "KDI Save";
  var h2 = l.schema.newHolding("dev-1");
  h2.accountId = acct.id;
  h2.name = "ASN Sukuk";
  s.holdings.push(h1, h2);

  return { l: l, state: s, inst: inst, acct: acct, h1: h1, h2: h2 };
}

function setField(doc, holdingId, field, value) {
  doc.getElementById("m_" + holdingId + "_" + field).value = value;
}

function savedState(app) {
  return JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
}

test("the month screen lists a row per holding with its account for context", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.ok(doc.getElementById("mrow_" + f.h1.id));
  assert.ok(doc.getElementById("mrow_" + f.h2.id));
  assert.match(doc.getElementById("monthRows").textContent, /Kenanga · Investment/);
  assert.deepEqual(app.consoleErrors, []);
});

test("the period defaults to the current month", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var expected = f.l.valuations.currentPeriod();
  assert.equal(app.window.document.getElementById("periodPick").value, expected);
});

test("entering balances for several holdings saves them in one action", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "50000");
  setField(doc, f.h2.id, "balance", "1,234.56");
  setField(doc, f.h2.id, "income", "12.30");
  doc.getElementById("saveMonthBtn").click();

  var s = savedState(app);
  assert.equal(s.valuations.length, 2);
  var v2 = s.valuations.filter(function (v) { return v.holdingId === f.h2.id; })[0];
  assert.equal(v2.balance, 1234.56, "thousands separators are accepted");
  assert.equal(v2.income, 12.3);
});

test("a blank field is stored as null, never as zero", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "50000");
  // contribution, withdrawal and income left blank
  doc.getElementById("saveMonthBtn").click();

  var v = savedState(app).valuations[0];
  assert.equal(v.balance, 50000);
  assert.equal(v.contribution, null, "blank must not become 0");
  assert.equal(v.income, null);
});

test("a typed zero is stored as zero, distinctly from blank", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "0");
  doc.getElementById("saveMonthBtn").click();

  var v = savedState(app).valuations[0];
  assert.equal(v.balance, 0);
  assert.notEqual(v.balance, null);
});

test("a holding left entirely blank creates no record", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "100");
  doc.getElementById("saveMonthBtn").click();

  var s = savedState(app);
  assert.equal(s.valuations.length, 1, "only the filled holding is recorded");
});

test("a bad number is flagged on the offending field while the rest still save", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "fifty thousand");
  setField(doc, f.h2.id, "balance", "2000");
  doc.getElementById("saveMonthBtn").click();

  assert.ok(doc.getElementById("monthErr").classList.contains("on"));
  assert.match(doc.getElementById("monthErr").textContent, /KDI Save/);
  assert.ok(doc.getElementById("mrow_" + f.h1.id).classList.contains("bad"), "row is marked");
  assert.ok(doc.getElementById("m_" + f.h1.id + "_balance").classList.contains("badfield"),
    "the specific field is marked, not just the row");

  var s = savedState(app);
  assert.equal(s.valuations.length, 1, "the good row still saved");
  assert.equal(s.valuations[0].holdingId, f.h2.id);

  // The rejected text must survive the re-render, or it has to be retyped from memory.
  assert.equal(doc.getElementById("m_" + f.h1.id + "_balance").value, "fifty thousand");
});

test("re-opening a saved month shows the stored figures for editing", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();
  setField(doc, f.h1.id, "balance", "50000");
  doc.getElementById("saveMonthBtn").click();

  // Move away and back.
  doc.getElementById("periodPick").value = "2026-09";
  doc.getElementById("periodPick").onchange();
  assert.equal(doc.getElementById("m_" + f.h1.id + "_balance").value, "");

  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();
  assert.equal(doc.getElementById("m_" + f.h1.id + "_balance").value, "RM 50,000",
    "at rest the figure reads as currency");
});

test("a field shows plain digits while being edited and reformats on leaving it", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  var field = doc.getElementById("m_" + f.h1.id + "_balance");
  field.value = "5000";
  field.onblur();
  assert.equal(field.value, "RM 5,000", "typing 5000 leaves the field formatted");

  field.onfocus();
  assert.equal(field.value, "5000", "editing gets plain digits back, not separators");

  field.value = "166.67";
  field.onblur();
  assert.equal(field.value, "RM 166.67", "cents are kept");
});

test("an unparseable entry is left exactly as typed on blur, not blanked", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  var field = doc.getElementById("m_" + f.h1.id + "_balance");
  field.value = "5O,000"; // letter O
  field.onblur();
  assert.equal(field.value, "5O,000", "the mistake must stay visible to be corrected");
});

test("a formatted field still saves correctly, and an unblurred one does too", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  var a = doc.getElementById("m_" + f.h1.id + "_balance");
  a.value = "5000";
  a.onblur(); // formatted to "RM 5,000"
  // Second field left mid-edit, as if Save were clicked without tabbing away.
  doc.getElementById("m_" + f.h2.id + "_balance").value = "2000";
  doc.getElementById("saveMonthBtn").click();

  var s = savedState(app);
  var v1 = s.valuations.filter(function (v) { return v.holdingId === f.h1.id; })[0];
  var v2 = s.valuations.filter(function (v) { return v.holdingId === f.h2.id; })[0];
  assert.equal(v1.balance, 5000, "the formatted value round-trips");
  assert.equal(v2.balance, 2000, "an unblurred raw value saves too");
});

test("blank stays blank through focus and blur, and records nothing", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  var field = doc.getElementById("m_" + f.h1.id + "_contribution");
  field.onfocus();
  field.onblur();
  assert.equal(field.value, "", "an untouched blank must not become RM 0");

  doc.getElementById("m_" + f.h1.id + "_balance").value = "100";
  doc.getElementById("saveMonthBtn").click();
  assert.equal(savedState(app).valuations[0].contribution, null);
});

test("editing a saved month updates in place rather than duplicating", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "50000");
  doc.getElementById("saveMonthBtn").click();
  setField(doc, f.h1.id, "balance", "51000");
  doc.getElementById("saveMonthBtn").click();

  var s = savedState(app);
  var live = s.valuations.filter(function (v) { return !v.deleted; });
  assert.equal(live.length, 1);
  assert.equal(live[0].balance, 51000);
});

test("clearing a saved figure removes the record as a tombstone", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();

  setField(doc, f.h1.id, "balance", "50000");
  doc.getElementById("saveMonthBtn").click();
  setField(doc, f.h1.id, "balance", "");
  doc.getElementById("saveMonthBtn").click();

  var s = savedState(app);
  assert.equal(s.valuations.length, 1, "row stays as a tombstone");
  assert.equal(s.valuations[0].deleted, true);
});

test("the previous balance is shown as context when entering a later month", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-07";
  doc.getElementById("periodPick").onchange();
  setField(doc, f.h1.id, "balance", "40000");
  doc.getElementById("saveMonthBtn").click();

  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();
  var row = doc.getElementById("mrow_" + f.h1.id).textContent;
  assert.match(row, /Last recorded: RM 40,000\.00 in Jul 2026/);
});

test("holdings in an archived account drop out of entry but keep their history", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();
  setField(doc, f.h1.id, "balance", "50000");
  doc.getElementById("saveMonthBtn").click();

  // Archive the account through the accounts form.
  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-acct="' + f.acct.id + '"]').click();
  doc.getElementById("a_arch").checked = true;
  doc.getElementById("acctSave").click();

  assert.equal(doc.getElementById("mrow_" + f.h1.id), null, "no longer offered for entry");
  var s = savedState(app);
  assert.equal(s.valuations.filter(function (v) { return !v.deleted; }).length, 1, "history survives");
});

test("the summary reports how many holdings are recorded for the month", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("periodPick").value = "2026-08";
  doc.getElementById("periodPick").onchange();
  assert.match(doc.getElementById("monthSummary").textContent, /0 of 2 recorded for Aug 2026/);

  setField(doc, f.h1.id, "balance", "1");
  doc.getElementById("saveMonthBtn").click();
  assert.match(doc.getElementById("monthSummary").textContent, /1 of 2 recorded/);
});

test("with no holdings the screen explains what to do instead of showing an empty form", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.match(doc.getElementById("monthRows").textContent, /Nothing to record yet/);
  assert.equal(doc.getElementById("monthActions").style.display, "none");
});
