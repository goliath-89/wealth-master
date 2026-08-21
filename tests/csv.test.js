"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() {
  return helpers.loadLib(helpers.freshWindow());
}

test("toCsv writes a header row followed by one row per record, in column order", function () {
  var csv = lib().csv.toCsv([{ b: 2, a: 1 }], ["a", "b"]);
  assert.equal(csv, "a,b\r\n1,2");
});

test("fields containing commas, quotes or newlines are quoted and escaped", function () {
  var csv = lib().csv.toCsv([
    { v: "Maybank, Berhad" },
    { v: 'He said "hi"' },
    { v: "line1\nline2" }
  ], ["v"]);
  var rows = csv.split("\r\n");
  assert.equal(rows[1], '"Maybank, Berhad"');
  assert.equal(rows[2], '"He said ""hi"""');
  assert.equal(rows[3], '"line1\nline2"');
});

test("formula-leading values are neutralised so Excel cannot execute them", function () {
  // CSV injection: these files are opened in Excel by design, so a value starting with
  // = + - @ would otherwise run as a formula on open.
  var csv = lib().csv.toCsv([
    { v: "=HYPERLINK(\"http://evil\",\"click\")" },
    { v: "+1234" },
    { v: "-SUM(A1)" },
    { v: "@cmd" }
  ], ["v"]);
  var rows = csv.split("\r\n");
  assert.ok(rows[1].indexOf("'=") === 0 || rows[1].indexOf("\"'=") === 0, "= must be prefixed");
  assert.equal(rows[2], "'+1234");
  assert.equal(rows[3], "'-SUM(A1)");
  assert.equal(rows[4], "'@cmd");
});

test("null and undefined become empty cells rather than the strings 'null'/'undefined'", function () {
  var csv = lib().csv.toCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"]);
  assert.equal(csv.split("\r\n")[1], ",,0");
});

test("entityToCsv uses the declared column order, not the record's key order", function () {
  var l = lib();
  var state = l.schema.blank();
  var h = l.schema.newHolding("dev-1");
  h.name = "ASB";
  state.holdings.push(h);
  var csv = l.csv.entityToCsv(state, "holdings");
  assert.equal(csv.split("\r\n")[0], l.csv.COLUMNS.holdings.join(","));
});

test("tombstones are included by default so a backup round-trips without loss", function () {
  var l = lib();
  var state = l.schema.blank();
  var h = l.schema.newHolding("dev-1");
  h.deleted = true;
  state.holdings.push(h);
  assert.equal(l.csv.entityToCsv(state, "holdings").split("\r\n").length, 2);
  assert.equal(l.csv.entityToCsv(state, "holdings", { excludeDeleted: true }).split("\r\n").length, 1);
});

test("an unknown entity returns null rather than throwing", function () {
  assert.equal(lib().csv.entityToCsv(lib().schema.blank(), "nonsense"), null);
});

test("every entity list in the schema has a CSV column definition", function () {
  var l = lib();
  l.schema.ENTITY_LISTS.forEach(function (entity) {
    assert.ok(l.csv.COLUMNS[entity], entity + " is missing from csv COLUMNS");
  });
});
