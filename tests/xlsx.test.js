"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

// FR-10.1. The fixture is synthetic and lives in the repo; the owner's real workbook is
// never committed (SEC-8, and the repo is public). It mirrors the shape that matters:
// a label column, a blank spacer column, months across, bold totals, a leaf that starts
// late, a typed zero, an unlabelled row carrying data, and a name containing an entity.

var FIXTURE = path.join(__dirname, "fixtures", "balance-sheet.xlsx");

function load() {
  var l = helpers.loadLib(helpers.freshWindow());
  var bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  return l.xlsx.readWorkbook(bytes);
}

function cell(grid, r, c) {
  return grid.rows[r] && grid.rows[r][c] ? grid.rows[r][c] : null;
}

test("a workbook is read without any library", async function () {
  var grid = await load();
  assert.equal(grid.name, "Balance");
  assert.deepEqual(grid.sheetNames, ["Balance"]);
  assert.equal(grid.maxRow, 13);
});

test("the header row keeps its label, its blank column, and its months", async function () {
  var grid = await load();
  assert.equal(cell(grid, 2, 1).value, "BALANCE SHEET");
  assert.equal(cell(grid, 2, 2), null, "the spacer column stays empty");
  assert.equal(cell(grid, 2, 3).value, "Jan , 2024");
  assert.equal(cell(grid, 2, 5).value, "Mar , 2024");
});

test("REGRESSION: an empty cell does not swallow the next cell's value", async function () {
  var grid = await load();
  // An empty cell is written <c r="B2" s="2"/> immediately before the next cell. A
  // scanner whose attribute run can eat the self-closing slash matches the wrong branch,
  // consumes the neighbour's body, and shifts every value one column left. That put
  // "Jan , 2024" in column 2 and the January figures under February.
  assert.equal(cell(grid, 5, 3).value, 400, "January sits in column 3, not column 2");
  assert.equal(cell(grid, 5, 2), null);
  assert.equal(cell(grid, 3, 3).value, 1100);
  assert.equal(cell(grid, 3, 5).value, 1400);
});

test("bold marks the totals and leaves the line items alone", async function () {
  var grid = await load();
  [3, 4, 8, 10, 13].forEach(function (r) {
    assert.equal(cell(grid, r, 1).bold, true, "row " + r + " is a total");
  });
  [5, 6, 7, 9, 11].forEach(function (r) {
    assert.equal(cell(grid, r, 1).bold, false, "row " + r + " is a line item");
  });
});

test("a blank cell and a typed zero stay distinguishable", async function () {
  var grid = await load();
  // "Opened later" has no figure until March; reading that as RM 0 would invent two
  // months of balance for an account that did not exist.
  assert.equal(cell(grid, 7, 3), null);
  assert.equal(cell(grid, 7, 4), null);
  assert.equal(cell(grid, 7, 5).value, 400);

  // "Closed account" really did reach zero, and that is a recorded fact.
  assert.equal(cell(grid, 6, 5).value, 0);
  assert.equal(typeof cell(grid, 6, 5).value, "number");
});

test("an unlabelled row keeps its values so it can be reported, not dropped", async function () {
  var grid = await load();
  assert.equal(cell(grid, 12, 1), null, "no label");
  assert.equal(cell(grid, 12, 3).value, 0, "but it carries data");
});

test("XML entities in a name are decoded", async function () {
  var grid = await load();
  assert.equal(cell(grid, 5, 1).value, "Ampersand & Co");
});

test("a file that is not a workbook is refused with a readable reason", async function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  await assert.rejects(function () { return l.xlsx.readWorkbook(junk); },
    /not a \.xlsx file/i);
});

test("a named sheet that does not exist is refused by name", async function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  await assert.rejects(function () { return l.xlsx.readWorkbook(bytes, "Nope"); },
    /No sheet named "Nope"/);
});

// --- the pieces, exercised directly ----------------------------------------

test("a cell reference converts to a one-based row and column", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  assert.deepEqual(l.xlsx.refToPos("A1"), { col: 1, row: 1 });
  assert.deepEqual(l.xlsx.refToPos("C12"), { col: 3, row: 12 });
  assert.deepEqual(l.xlsx.refToPos("AA5"), { col: 27, row: 5 });
  assert.deepEqual(l.xlsx.refToPos("AM2"), { col: 39, row: 2 });
  assert.equal(l.xlsx.refToPos("junk"), null);
});

test("a shared string split across runs is joined, not truncated", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var xml = "<sst><si><t>plain</t></si>" +
    "<si><r><t>Bold</t></r><r><t> and rest</t></r></si></sst>";
  assert.deepEqual(l.xlsx.parseSharedStrings(xml), ["plain", "Bold and rest"]);
});

test("entity decoding covers named and numeric references", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  assert.equal(l.xlsx.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot;"), 'a & b <c> "d"');
  assert.equal(l.xlsx.decodeEntities("&#82;&#x4D;"), "RM");
});

test("bold is read through the cellXfs indirection, not guessed", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var xml = "<styleSheet><fonts count=\"2\"><font><sz val=\"11\"/></font>" +
    "<font><b/><sz val=\"11\"/></font></fonts>" +
    "<cellXfs count=\"3\"><xf fontId=\"0\"/><xf fontId=\"1\"/><xf fontId=\"0\"/></cellXfs></styleSheet>";
  assert.deepEqual(l.xlsx.parseBoldStyles(xml), [false, true, false]);
});

test("bold is recognised however the writer spells it", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  // Google Sheets writes a bare <b/>; openpyxl writes <b val="1"/>; an explicit
  // <b val="0"/> means not bold, and reading the tag's mere presence would promote
  // every ordinary line item into a total.
  var xml = "<styleSheet><fonts>" +
    "<font><sz val=\"11\"/></font>" +
    "<font><b/></font>" +
    "<font><b val=\"1\" /></font>" +
    "<font><b val=\"0\"/></font>" +
    "</fonts><cellXfs>" +
    "<xf fontId=\"0\"/><xf fontId=\"1\"/><xf fontId=\"2\"/><xf fontId=\"3\"/>" +
    "</cellXfs></styleSheet>";
  assert.deepEqual(l.xlsx.parseBoldStyles(xml), [false, true, true, false]);
});
