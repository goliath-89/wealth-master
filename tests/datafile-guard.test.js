"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// The data file is the app's own store, written as JSON and overwritten on every change.
// Connecting anything else to it is not merely a failed import — it makes that file the
// save target. Somebody reaching for this control meaning to import a spreadsheet would
// lose the spreadsheet on their next edit. These tests guard that.
//
// jsdom implements no File System Access API, so the pickers are stubbed through
// loadApp's beforeApp hook, which runs after the modules load and before app.js reads
// isSupported() at startup.

function withFile(name, contents) {
  var writes = [];
  var handle = { name: name };
  var app = helpers.loadApp(helpers.loadLib(helpers.freshWindow()).schema.blank(),
    function (win) {
      win.WM.isSupported = function () { return true; };
      win.WM.restore = function () { return Promise.resolve(null); };
      win.WM.connectNew = function () { return Promise.resolve(handle); };
      win.WM.connectExisting = function () { return Promise.resolve(handle); };
      win.WM.checkPermission = function () { return Promise.resolve("granted"); };
      win.WM.requestPermission = function () { return Promise.resolve("granted"); };
      win.WM.read = function () { return Promise.resolve(contents || ""); };
      win.WM.write = function (h) { writes.push(h.name); return Promise.resolve(); };
      win.WM.disconnect = function () { return Promise.resolve(); };
    });
  return { app: app, doc: app.window.document, writes: writes };
}

function settle() { return new Promise(function (r) { setTimeout(r, 40); }); }

function dataTab(doc) { doc.querySelector('.tab[data-v="data"]').click(); }

test("a spreadsheet picked as the data file is refused, and never written to", async function () {
  var f = withFile("My portfolio and networth data_Claude.xlsx");
  dataTab(f.doc);

  // "Connect a new file" uses a save picker: keeping this handle and saving would write
  // JSON straight over the spreadsheet.
  f.doc.getElementById("connectNewBtn").click();
  await settle();

  assert.deepEqual(f.writes, [], "the spreadsheet must not be written to");
  var note = f.doc.getElementById("fileNote").textContent;
  assert.match(note, /was not connected/);
  assert.match(note, /Import a balance sheet/, "and it points at the right control");
  assert.match(note, /overwritten on every change/, "and says why this one was wrong");
});

test("the refusal names the file, so it is clear which was rejected", async function () {
  var f = withFile("budget.csv");
  dataTab(f.doc);
  f.doc.getElementById("connectExistingBtn").click();
  await settle();

  assert.match(f.doc.getElementById("fileNote").textContent, /budget\.csv/);
  assert.deepEqual(f.writes, []);
});

test("a refused file leaves no connection behind to save into later", async function () {
  var f = withFile("holdings.xlsx");
  dataTab(f.doc);
  f.doc.getElementById("connectExistingBtn").click();
  await settle();

  // The original defect was not the failed read — it was that the handle survived it.
  // Any later change would then have written the store over the spreadsheet.
  assert.notEqual(f.doc.getElementById("connectNewBtn"), null,
    "the card is back to offering a connection, so nothing is held");
  f.doc.getElementById("set_income").value = "10000";
  f.doc.getElementById("saveSettingsBtn").click();
  await settle();
  assert.deepEqual(f.writes, [], "a later edit still does not touch the refused file");
});

test("a .json file that cannot be read as our data is let go, not kept", async function () {
  var f = withFile("not-ours.json", "this is not json at all");
  dataTab(f.doc);
  f.doc.getElementById("connectExistingBtn").click();
  await settle();

  assert.match(f.doc.getElementById("fileNote").textContent, /could not be read/);
  assert.deepEqual(f.writes, [], "and it is not written back to");
});

test("a real data file connects and is adopted", async function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var seed = l.schema.blank();
  var f = withFile("wealth-master.json", JSON.stringify(seed));
  dataTab(f.doc);
  f.doc.getElementById("connectExistingBtn").click();
  await settle();

  var note = f.doc.getElementById("fileNote").textContent;
  assert.equal(/was not connected/.test(note), false, "the ordinary path still works");
  assert.match(f.doc.getElementById("fileRow").textContent, /wealth-master\.json/);
});

test("connecting a new data file saves the store into it", async function () {
  var f = withFile("wealth-master.json");
  dataTab(f.doc);
  f.doc.getElementById("connectNewBtn").click();
  await settle();
  assert.deepEqual(f.writes, ["wealth-master.json"]);
});

test("the extension check is the module's, and is case-insensitive", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var fsx = require("../js/filestore.js");
  assert.equal(fsx.isDataFileName("wealth-master.json"), true);
  assert.equal(fsx.isDataFileName("WEALTH-MASTER.JSON"), true);
  assert.equal(fsx.isDataFileName("portfolio.xlsx"), false);
  assert.equal(fsx.isDataFileName("budget.csv"), false);
  assert.equal(fsx.isDataFileName("json"), false, "an extension, not a substring");
  assert.equal(fsx.isDataFileName(""), false);
  assert.equal(fsx.isDataFileName(null), false);
});
