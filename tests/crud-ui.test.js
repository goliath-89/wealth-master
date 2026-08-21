"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// Builds a state with one institution / account / holding already present.
function seeded(names) {
  names = names || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = names.inst || "Maybank";
  inst.type = "bank";
  inst.pidmMember = true;
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = names.acct || "Savings";
  acct.pidmProtected = true;
  s.accounts.push(acct);

  var hold = l.schema.newHolding("dev-1");
  hold.accountId = acct.id;
  hold.name = names.hold || "MMF";
  hold.instrumentType = "Money market";
  s.holdings.push(hold);

  return { state: s, inst: inst, acct: acct, hold: hold };
}

test("the tree renders institutions, their accounts and their holdings", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var tree = app.window.document.getElementById("tree").textContent;
  assert.match(tree, /Maybank/);
  assert.match(tree, /Savings/);
  assert.match(tree, /MMF/);
  assert.deepEqual(app.consoleErrors, []);
});

test("an empty store invites the first institution rather than showing a blank page", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.match(doc.getElementById("tree").textContent, /No institutions yet/);
  assert.ok(doc.getElementById("firstInstBtn"));
});

test("SEC-7: names containing HTML are escaped, not executed", function () {
  var evil = '<img src=x onerror="window.__pwned=1">';
  var f = seeded({ inst: evil, acct: evil + " acct", hold: evil + " hold" });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(app.window.__pwned, undefined, "injected handler must never run");
  assert.equal(doc.querySelectorAll("#tree img").length, 0, "no element may be created from a name");
  // The text is still shown faithfully — escaped, not stripped.
  assert.match(doc.getElementById("tree").textContent, /<img src=x/);
});

test("SEC-7: a quote in a name cannot break out of an id attribute", function () {
  var f = seeded();
  f.inst.id = 'x" onclick="window.__pwned=1';
  f.acct.institutionId = f.inst.id;
  var app = helpers.loadApp(f.state);
  var buttons = app.window.document.querySelectorAll("#tree [data-edit-inst]");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute("onclick"), null, "no attribute may be injected");
});

test("adding an institution through the form persists it and re-renders the tree", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;

  doc.getElementById("addInstBtn").click();
  doc.getElementById("i_name").value = "CIMB";
  doc.getElementById("i_type").value = "bank";
  doc.getElementById("instSave").click();

  assert.match(doc.getElementById("tree").textContent, /CIMB/);
  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.institutions.length, 1);
  assert.equal(saved.institutions[0].name, "CIMB");
  assert.equal(saved.institutions[0].deleted, false);
  assert.ok(saved.institutions[0].updatedAt, "must be stamped for the import guard");
});

test("saving without a name shows an error and writes nothing", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;

  doc.getElementById("addInstBtn").click();
  doc.getElementById("i_name").value = "   ";
  doc.getElementById("instSave").click();

  assert.ok(doc.getElementById("instErr").classList.contains("on"));
  assert.match(doc.getElementById("instErr").textContent, /Name is required/);
  assert.ok(doc.getElementById("instModal").classList.contains("on"), "modal stays open");
  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state") || "{}");
  assert.equal((saved.institutions || []).length, 0);
});

test("editing an account updates in place rather than creating a second one", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('[data-edit-acct="' + f.acct.id + '"]').click();
  doc.getElementById("a_name").value = "Savings Plus";
  doc.getElementById("acctSave").click();

  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.accounts.length, 1);
  assert.equal(saved.accounts[0].name, "Savings Plus");
});

test("deleting an institution that still has accounts is refused with a reason", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('[data-edit-inst="' + f.inst.id + '"]').click();
  doc.getElementById("instDelete").click();

  var err = doc.getElementById("instErr");
  assert.ok(err.classList.contains("on"));
  assert.match(err.textContent, /1 account still belongs/, "verb must agree with the count");
  assert.match(err.textContent, /archive instead/);
  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.institutions[0].deleted, false, "nothing may be tombstoned");
});

test("deleting a childless holding tombstones it rather than removing the row", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('[data-edit-hold="' + f.hold.id + '"]').click();
  doc.getElementById("holdDelete").click();

  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.holdings.length, 1, "row stays — tombstone, not removal");
  assert.equal(saved.holdings[0].deleted, true);
  assert.equal(doc.getElementById("tree").textContent.indexOf("MMF"), -1, "and drops out of the tree");
});

test("archived accounts are hidden until the toggle is ticked", function () {
  var f = seeded();
  f.acct.archived = true;
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(doc.getElementById("tree").textContent.indexOf("Savings"), -1);
  doc.getElementById("showArchived").checked = true;
  doc.getElementById("showArchived").onchange();
  assert.match(doc.getElementById("tree").textContent, /Savings/);
  assert.match(doc.getElementById("tree").textContent, /Archived/);
});

test("PIDM cover is shown per account, independently of the institution", function () {
  var f = seeded();
  f.acct.pidmProtected = false; // member bank, uncovered product
  var app = helpers.loadApp(f.state);
  var tree = app.window.document.getElementById("tree").textContent;
  assert.match(tree, /PIDM member/, "institution is still a member");
  assert.equal(tree.indexOf("PIDM</span>"), -1);
});

test("switching tabs shows exactly one view at a time, opening on Month", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;

  function onViews() {
    return Array.prototype.filter.call(doc.querySelectorAll(".view"), function (v) {
      return v.classList.contains("on");
    }).map(function (v) { return v.id; });
  }

  assert.deepEqual(onViews(), ["v-month"], "month-end entry is the screen used most");

  doc.querySelector('.tab[data-v="accounts"]').click();
  assert.deepEqual(onViews(), ["v-accounts"]);

  doc.querySelector('.tab[data-v="data"]').click();
  assert.deepEqual(onViews(), ["v-data"]);
});
