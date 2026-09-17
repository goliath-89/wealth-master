"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-10.2, 10.3, 10.4, 10.6 against the real DOM, driven through the real file picker:
// a File goes into the input, the change handler reads it, and the review table that
// appears is what gets asserted on. Reaching into the app's internals was not an option
// anyway — app.js's top-level vars are not reachable from a later window.eval — and
// going through the picker tests the path the owner actually uses.

function lib() { return helpers.loadLib(helpers.freshWindow()); }

// A CSV is built rather than a workbook, so the test drives the real file input and the
// real read path end to end. CSV also loses formatting, which exercises the harder
// total-detection route — the one where nothing is bold.
function csvFor(rows, headers) {
  var head = ["BALANCE SHEET", ""].concat(headers || ["Jan , 2024", "Feb , 2024"]);
  var lines = [head.map(quote).join(",")];
  rows.forEach(function (r) {
    var cells = [r[0] === null ? "" : r[0], ""].concat(r.slice(2).map(function (v) {
      return v === null || v === undefined ? "" : v;
    }));
    lines.push(cells.map(quote).join(","));
  });
  return lines.join("\r\n");
}
function quote(v) {
  var s = String(v === null || v === undefined ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

var HEALTHY = [
  ["ASSETS",      true,  900, 1000],
  ["Cash",        true,  600,  700],
  ["Maybank",     false, 400,  400],
  ["GX Bank",     false, 200,  300],
  ["Use Assets",  true,  300,  300],
  ["Prima Condo", false, 300,  300],
  ["LIABILITIES", true,  100,   90],
  ["Car loan",    false, 100,   90],
  ["NET WORTH",   true,  800,  910]
];

// Opens the app on the Data tab and puts a real file through the real picker, then waits
// for the review table the async read produces.
async function staged(rows, seedState) {
  var app = helpers.loadApp(seedState || helpers.loadLib(helpers.freshWindow()).schema.blank());
  var win = app.window;
  var doc = win.document;
  doc.querySelector('.tab[data-v="data"]').click();

  var file = new win.File([csvFor(rows || HEALTHY)], "balance.csv", { type: "text/csv" });
  var input = doc.getElementById("sheetFileIn");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new win.Event("change", { bubbles: true }));

  for (var i = 0; i < 60 && doc.getElementById("reviewSec").style.display === "none"; i++) {
    await new Promise(function (r) { setTimeout(r, 5); });
  }
  return { app: app, win: win, doc: doc };
}

function saved(app) {
  return JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
}

// --- the review table -------------------------------------------------------

test("a staged sheet lists one editable row per line item, totals excluded", async function () {
  var f = await staged();
  var rows = f.doc.querySelectorAll("#reviewRows .irow");
  assert.equal(rows.length, 4, "four leaves; ASSETS, Cash, Use Assets, LIABILITIES and NET WORTH are totals");
  var text = f.doc.getElementById("reviewRows").textContent;
  assert.match(text, /Maybank/);
  assert.match(text, /Prima Condo/);
  assert.equal(/NET WORTH/.test(text), false, "a total is never offered as a line item");
  assert.deepEqual(f.app.consoleErrors, []);
});

test("the verdict leads with whether the sheet adds up", async function () {
  var f = await staged();
  assert.match(f.doc.getElementById("reviewSummary").textContent, /Adds up/);
  assert.equal(f.doc.getElementById("reviewProblems").textContent.trim(), "");
});

test("a sheet that does not add up says so and names the disagreement", async function () {
  var broken = HEALTHY.map(function (r) { return r.slice(); });
  broken[1][3] = 650;               // Cash total for February, against leaves of 700
  var f = await staged(broken);

  assert.match(f.doc.getElementById("reviewSummary").textContent, /Does not add up/);
  var warn = f.doc.getElementById("reviewProblems").textContent;
  assert.match(warn, /This file does not add up/);
  // Which row it lands on depends on the source. With no formatting to go on, a subtotal
  // that no longer adds up no longer looks like a subtotal either, so the disagreement
  // surfaces on the parent that still claims it. What matters is that a sheet whose
  // figures contradict each other cannot be imported without the owner being told.
  assert.match(warn, /months differ, first at 2024-01/);
  assert.match(warn, /the sheet says RM /);
});

test("things that could not be read are listed, not dropped", async function () {
  var rows = HEALTHY.map(function (r) { return r.slice(); });
  rows[2][3] = "JPY Trip & HSI tank";     // text where February's figure belongs
  var f = await staged(rows);
  var warn = f.doc.getElementById("reviewProblems").textContent;
  assert.match(warn, /Nothing is dropped/);
  assert.match(warn, /holds text rather than a figure/);
  // SEC-7: the sheet's own text is escaped, not executed.
  assert.equal(f.doc.querySelector("#reviewProblems img"), null);
});

test("each line says whether it is new, an update, or already right", async function () {
  var l = lib();
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1"); inst.name = "Maybank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1"); acct.institutionId = inst.id; acct.name = "Savings";
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1"); h.accountId = acct.id; h.name = "Maybank";
  s.holdings.push(h);
  l.valuations.upsertValuation(s, { holdingId: h.id, period: "2024-01", balance: 400 }, "dev-1");

  var f = await staged(HEALTHY, s);
  var text = f.doc.getElementById("reviewRows").textContent;
  assert.match(text, /already right/, "January already matches and says so");
  assert.equal(f.doc.querySelectorAll("#reviewRows .ibadge.new").length, 3);
});

// --- nothing is written until confirmed -------------------------------------

test("staging a sheet writes nothing", async function () {
  var f = await staged();
  var after = saved(f.app);
  assert.equal(after.holdings.length, 0);
  assert.equal(after.valuations.length, 0);
});

test("cancelling writes nothing and says so", async function () {
  var f = await staged();
  f.doc.getElementById("reviewCancelBtn").click();
  assert.equal(f.doc.getElementById("reviewSec").style.display, "none");
  assert.match(f.doc.getElementById("sheetStatus").textContent, /Nothing was changed/);
  assert.equal(saved(f.app).valuations.length, 0);
});

test("confirming creates the records and their months", async function () {
  var f = await staged();
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  assert.equal(out.holdings.length, 2, "Maybank and GX Bank");
  assert.equal(out.assets.length, 1, "Prima Condo is owned, not held");
  assert.equal(out.liabilities.length, 1, "the car loan is a debt");
  assert.equal(out.valuations.length, 8, "four lines over two months");
  assert.equal(f.doc.getElementById("reviewSec").style.display, "none");
  assert.deepEqual(f.app.consoleErrors, []);
});

test("an excluded line is not imported", async function () {
  var f = await staged();
  var box = f.doc.querySelector('#reviewRows input[data-imp="include"][data-i="0"]');
  box.checked = false;
  box.dispatchEvent(new f.win.Event("change", { bubbles: true }));
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  assert.equal(out.holdings.length, 1);
  assert.equal(out.holdings[0].name, "GX Bank");
});

test("a corrected name is what gets created", async function () {
  var f = await staged();
  var input = f.doc.querySelector('#reviewRows input[data-imp="name"][data-i="0"]');
  input.value = "Maybank Savings 1234";
  input.dispatchEvent(new f.win.Event("change", { bubbles: true }));
  f.doc.getElementById("reviewConfirmBtn").click();

  var names = saved(f.app).holdings.map(function (h) { return h.name; });
  assert.ok(names.indexOf("Maybank Savings 1234") !== -1);
});

test("two lines can be put under one institution, as the owner would for one bank", async function () {
  var f = await staged();
  ["0", "1"].forEach(function (i) {
    var inst = f.doc.querySelector('#reviewRows input[data-imp="institutionName"][data-i="' + i + '"]');
    inst.value = "Maybank";
    inst.dispatchEvent(new f.win.Event("change", { bubbles: true }));
  });
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  assert.equal(out.institutions.length, 1, "both holdings sit under one bank");
  assert.equal(out.institutions[0].name, "Maybank");
  assert.equal(out.holdings.length, 2);
});

test("changing what a line is imported as changes what gets created", async function () {
  var f = await staged();
  var sel = f.doc.querySelector('#reviewRows select[data-imp="kind"][data-i="0"]');
  sel.value = "liability";
  sel.dispatchEvent(new f.win.Event("change", { bubbles: true }));
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  assert.equal(out.liabilities.length, 2, "the car loan, plus the line just reclassified");
  assert.equal(out.holdings.length, 1);
});

test("blank months create no valuation", async function () {
  var rows = [
    ["Cash",        true,  400, 700],
    ["Maybank",     false, 400, 400],
    ["Opened late", false, null, 300]
  ];
  var f = await staged(rows);
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  var late = out.holdings.filter(function (h) { return h.name === "Opened late"; })[0];
  var mine = out.valuations.filter(function (v) { return v.holdingId === late.id; });
  assert.equal(mine.length, 1, "an account that did not exist yet has one month, not two");
  assert.equal(mine[0].period, "2024-02");
});

test("text in a figure cell is kept as that month's note", async function () {
  var rows = HEALTHY.map(function (r) { return r.slice(); });
  rows[2][3] = "JPY Trip & HSI tank";
  var f = await staged(rows);
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  var h = out.holdings.filter(function (x) { return x.name === "Maybank"; })[0];
  var feb = out.valuations.filter(function (v) {
    return v.holdingId === h.id && v.period === "2024-02";
  })[0];
  assert.ok(feb, "the month is kept for the note's sake");
  assert.equal(feb.note, "JPY Trip & HSI tank");
  assert.equal(feb.balance, null, "and it is not mistaken for a balance");
});

test("notes can be declined", async function () {
  var rows = HEALTHY.map(function (r) { return r.slice(); });
  rows[2][3] = "a note";
  var f = await staged(rows);
  f.doc.getElementById("reviewKeepNotes").checked = false;
  f.doc.getElementById("reviewConfirmBtn").click();

  var out = saved(f.app);
  var h = out.holdings.filter(function (x) { return x.name === "Maybank"; })[0];
  var feb = out.valuations.filter(function (v) {
    return v.holdingId === h.id && v.period === "2024-02";
  })[0];
  assert.equal(feb, undefined);
});

// --- undo -------------------------------------------------------------------

test("an import is undone in one step, restoring exactly what was there", async function () {
  var f = await staged();
  var before = f.app.window.localStorage.getItem("wealthmaster.state");

  f.doc.getElementById("reviewConfirmBtn").click();
  assert.equal(saved(f.app).valuations.length, 8);

  var undo = f.doc.getElementById("undoImportBtn");
  assert.notEqual(undo.style.display, "none", "the undo offers itself after an import");
  assert.match(undo.textContent, /Undo import of 4 lines/);
  undo.click();

  assert.equal(f.app.window.localStorage.getItem("wealthmaster.state"), before,
    "the store is byte-for-byte what it was before the import");
  assert.equal(f.doc.getElementById("undoImportBtn").style.display, "none",
    "and the undo is spent");
});

test("undo is not offered before an import has happened", async function () {
  var f = await staged();
  assert.equal(f.doc.getElementById("undoImportBtn").style.display, "none");
});

test("re-importing the same sheet updates rather than duplicating", async function () {
  var f = await staged();
  f.doc.getElementById("reviewConfirmBtn").click();
  var first = saved(f.app);
  assert.equal(first.holdings.length, 2);

  var again = new f.win.File([csvFor(HEALTHY)], "balance.csv", { type: "text/csv" });
  var input = f.doc.getElementById("sheetFileIn");
  Object.defineProperty(input, "files", { value: [again], configurable: true });
  input.dispatchEvent(new f.win.Event("change", { bubbles: true }));
  for (var i = 0; i < 60 && f.doc.getElementById("reviewSec").style.display === "none"; i++) {
    await new Promise(function (r) { setTimeout(r, 5); });
  }
  assert.match(f.doc.getElementById("reviewRows").textContent, /already right/);
  f.doc.getElementById("reviewConfirmBtn").click();

  var second = saved(f.app);
  assert.equal(second.holdings.length, 2, "a second import must not clone the portfolio");
  assert.equal(second.valuations.length, 8);
});

test("confirming with nothing ticked refuses rather than importing an empty set", async function () {
  var f = await staged();
  f.doc.getElementById("reviewNoneBtn").click();
  f.doc.getElementById("reviewConfirmBtn").click();
  assert.match(f.doc.getElementById("snackMsg").textContent, /Nothing is ticked/);
  assert.equal(saved(f.app).valuations.length, 0);
});

test("SEC-7: a line item named like a script cannot execute in the review table", async function () {
  var rows = HEALTHY.map(function (r) { return r.slice(); });
  rows[2][0] = '<img src=x onerror="window.__pwned=1">';
  var f = await staged(rows);

  assert.equal(f.doc.querySelector("#reviewRows img"), null);
  assert.equal(f.win.__pwned, undefined);
  assert.match(f.doc.getElementById("reviewRows").textContent, /onerror/);
});
