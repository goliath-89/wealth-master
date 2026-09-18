"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-7.7 against the real DOM. The engine is covered in csv-import.test.js; these check
// that a file can actually be picked, reviewed and imported — and undone.

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.id = "i1"; inst.name = "Maybank"; inst.type = "Bank";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.id = "a1"; acct.institutionId = "i1"; acct.name = "Savings";
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.id = "h1"; h.accountId = "a1"; h.name = "KDI Save"; h.rate = 4;
  s.holdings.push(h);

  return { l: l, state: s };
}

// A File whose text() the app reads through FileReader. jsdom has no real file picker, so
// the input's files list is replaced and change fired, which is exactly what the browser
// does once the owner has chosen.
function pick(app, name, text) {
  var win = app.window;
  var doc = win.document;
  var input = doc.getElementById("csvFileIn");
  var file = { name: name, type: "text/csv", __text: text };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// FileReader in jsdom cannot read the stub above, so it is replaced with one that returns
// the text the test supplied. Everything downstream is the app's own code.
function stubReader(win) {
  win.FileReader = function () {
    this.readAsText = function (file) {
      this.result = file.__text;
      var self = this;
      setTimeout(function () { if (self.onload) self.onload(); }, 0);
    };
  };
}

function load(f) { return helpers.loadApp(f.state, stubReader); }
function saved(app) { return JSON.parse(app.window.localStorage.getItem("wealthmaster.state")); }
function dataTab(doc) { doc.querySelector('.tab[data-v="data"]').click(); }

test("a picked file is identified and summarised before anything is written", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);

  await pick(app, "wealth-master-holdings-2026-09.csv", "id,name,rate\r\nh1,KDI Save,4.25");

  assert.equal(doc.getElementById("csvReviewSec").style.display, "");
  var summary = doc.getElementById("csvReviewSummary").textContent;
  assert.match(summary, /holdings/);
  assert.match(summary, /1 changed/);
  assert.match(summary, /Rows not in this file are left exactly as they are/);
  // Nothing written yet.
  assert.equal(saved(app).holdings[0].rate, 4);
  assert.deepEqual(app.consoleErrors, []);
});

test("the review names the field and both figures, not just \"update\"", async function () {
  var f = seeded();
  var app = load(f);
  dataTab(app.window.document);
  await pick(app, "holdings.csv", "id,name,rate\r\nh1,KDI Save,4.25");

  assert.match(app.window.document.getElementById("csvReviewRows").textContent,
    /rate 4 → 4\.25/);
});

test("confirming writes, and the toast says what happened", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", "id,name,rate\r\nh1,Renamed,4.25");

  doc.getElementById("csvConfirmBtn").click();

  var h = saved(app).holdings[0];
  assert.equal(h.name, "Renamed");
  assert.equal(h.rate, 4.25);
  assert.equal(doc.getElementById("csvReviewSec").style.display, "none");
  assert.match(doc.getElementById("snackMsg").textContent, /Imported holdings/);
});

test("an import is one undoable action", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", "id,name\r\nh1,Renamed");
  doc.getElementById("csvConfirmBtn").click();
  assert.equal(saved(app).holdings[0].name, "Renamed");

  var undo = doc.getElementById("undoImportBtn");
  assert.equal(undo.style.display, "");
  undo.click();

  assert.equal(saved(app).holdings[0].name, "KDI Save");
  assert.equal(doc.getElementById("undoImportBtn").style.display, "none");
});

test("cancelling writes nothing", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", "id,name\r\nh1,Renamed");
  doc.getElementById("csvCancelBtn").click();

  assert.equal(doc.getElementById("csvReviewSec").style.display, "none");
  assert.equal(saved(app).holdings[0].name, "KDI Save");
  assert.match(doc.getElementById("snackMsg").textContent, /nothing was changed/);
});

test("unticking a row leaves that record alone", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "institutions.csv",
    "id,name,type\r\ni1,Renamed bank,Bank\r\n,Public Bank,Bank");

  var boxes = doc.querySelectorAll("[data-csvrow]");
  assert.equal(boxes.length, 2);
  boxes[0].checked = false;
  boxes[0].dispatchEvent(new app.window.Event("change", { bubbles: true }));
  doc.getElementById("csvConfirmBtn").click();

  var st = saved(app);
  assert.equal(st.institutions[0].name, "Maybank", "the unticked row was not imported");
  assert.equal(st.institutions.length, 2);
  assert.equal(st.institutions[1].name, "Public Bank");
});

test("rows the file leaves out survive the import", async function () {
  var f = seeded();
  var h2 = f.l.schema.newHolding("dev-1");
  h2.id = "h2"; h2.accountId = "a1"; h2.name = "FD";
  f.state.holdings.push(h2);

  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", "id,name\r\nh1,Renamed");
  doc.getElementById("csvConfirmBtn").click();

  var st = saved(app);
  assert.equal(st.holdings.length, 2);
  assert.equal(st.holdings[1].name, "FD");
  assert.equal(st.holdings[1].deleted, false);
});

test("a row that cannot be read is named on screen and the rest still import", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv",
    "id,accountId,name\r\n,a-nope,Orphan\r\n,a1,Good one");

  var problems = doc.getElementById("csvReviewProblems").textContent;
  assert.match(problems, /1 row cannot be imported/);
  assert.match(problems, /Line 2/);
  assert.match(problems, /a-nope is not in your data/);

  doc.getElementById("csvConfirmBtn").click();
  var names = saved(app).holdings.map(function (h) { return h.name; });
  assert.deepEqual(names, ["KDI Save", "Good one"]);
});

test("a file that is not an export is refused with a reason, and no review opens", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "shopping.csv", "fruit,qty\r\napples,3");

  assert.equal(doc.getElementById("csvReviewSec").style.display, "none");
  assert.match(doc.getElementById("csvStatus").textContent, /do not match any Wealth Master export/);
});

test("a file with no id column is refused rather than guessed at", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", "name,rate,accountId,feePct\r\nKDI Save,4,a1,0.5");

  assert.equal(doc.getElementById("csvReviewSec").style.display, "none");
  assert.match(doc.getElementById("csvStatus").textContent, /no id column/);
});

test("re-importing an untouched export says there is nothing to do", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv", f.l.csv.entityToCsv(f.state, "holdings"));

  assert.match(doc.getElementById("csvReviewSummary").textContent, /1 already right/);
  assert.match(doc.getElementById("csvReviewRows").textContent, /Nothing in this file would change anything/);
});

test("SEC-7: a name from a file cannot execute in the review", async function () {
  var f = seeded();
  var app = load(f);
  var doc = app.window.document;
  dataTab(doc);
  await pick(app, "holdings.csv",
    'id,name\r\nh1,"<img src=x onerror=""window.__pwned=1"">"');

  assert.equal(doc.querySelector("#csvReviewRows img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("csvReviewRows").textContent, /onerror/);
});

test("the screen states the two rules a spreadsheet would otherwise lose", function () {
  var app = load(seeded());
  var doc = app.window.document;
  dataTab(doc);
  var text = doc.getElementById("v-data").textContent;
  assert.match(text, /A row you delete in Excel is not deleted here/);
  assert.match(text, /never records RM/);
});
