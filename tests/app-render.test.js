"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

test("app boots against an empty store with zero console errors", function () {
  var app = helpers.loadApp();
  assert.deepEqual(app.consoleErrors, []);
  var kpiValues = Array.prototype.map.call(
    app.window.document.querySelectorAll("#kpis .v"),
    function (el) { return el.textContent; }
  );
  assert.deepEqual(kpiValues, ["0", "0", "0", "0", "0", "0"]);
});

test("rendered KPI counts reflect seeded state and exclude tombstoned records", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var state = lib.schema.blank();
  var h1 = lib.schema.newHolding("dev-1");
  var h2 = lib.schema.newHolding("dev-1");
  h2.deleted = true; // tombstoned — must not count toward the live total
  state.holdings.push(h1, h2);

  var app = helpers.loadApp(state);
  assert.deepEqual(app.consoleErrors, []);
  var holdingsCount = app.window.document.querySelectorAll("#kpis .v")[2].textContent;
  assert.equal(holdingsCount, "1");
});

test("a browser without the File System Access API falls back to manual export", function () {
  // jsdom has no showSaveFilePicker, so this exercises the Safari/Firefox path.
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.equal(doc.getElementById("fileLabel").textContent, "Manual export");
  assert.ok(doc.getElementById("exportNowBtn"), "must offer a manual export button");
  // The warning has to be explicit that the cache is not a safe home for the only copy.
  assert.match(doc.getElementById("fileNote").textContent, /cache, not a safe place/);
});

test("theme toggle flips data-theme and persists it to the store", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  doc.getElementById("themeBtn").click();
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.settings.theme, "light");
});

test("every tappable control declares a touch target of at least 44px (NFR-6)", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  // jsdom does no layout, so getBoundingClientRect is always 0 — assert on the
  // declared CSS instead, which is what actually drives the rendered size.
  var css = doc.querySelector("style").textContent;

  function declaredPx(selector, prop) {
    var rule = css.split(selector + "{")[1];
    assert.ok(rule, "expected a CSS rule for " + selector);
    var match = rule.split("}")[0].match(new RegExp(prop + ":\\s*(\\d+(?:\\.\\d+)?)px"));
    assert.ok(match, "expected " + prop + " on " + selector);
    return parseFloat(match[1]);
  }

  assert.ok(declaredPx(".btn", "min-height") >= 44, ".btn must be >= 44px tall");
  assert.ok(declaredPx(".iconbtn", "height") >= 44, ".iconbtn must be >= 44px tall");
  assert.ok(declaredPx(".iconbtn", "width") >= 44, ".iconbtn must be >= 44px wide");
});

test("every text-entry input type is covered by the 44px sizing rule (NFR-6)", function () {
  var app = helpers.loadApp();
  var css = app.window.document.querySelector("style").textContent;

  var block = css.match(/input\[type=text\][^{]*\{[^}]*\}/);
  assert.ok(block, "expected a shared sizing rule for text-entry inputs");

  // month and date render at roughly 24px and are not matched by [type=text], so a date
  // field silently fails the touch minimum unless it is named in the selector.
  var selectors = block[0].split("{")[0];
  ["text", "number", "month", "date"].forEach(function (t) {
    assert.match(selectors, new RegExp("input\\[type=" + t + "\\]"),
      "input[type=" + t + "] must be in the sizing rule");
  });
  assert.match(block[0], /min-height:\s*(4[4-9]|[5-9]\d)px/);
});

// Drives the app's own file-input handler with a stubbed FileReader, exercising the
// real import path rather than calling the guard directly.
function importIntoApp(app, inputId, text) {
  var doc = app.window.document;
  var input = doc.getElementById(inputId);
  var original = app.window.FileReader;
  app.window.FileReader = function () {
    this.readAsText = function () { this.result = text; this.onload(); };
  };
  Object.defineProperty(input, "files", { value: [{}], configurable: true });
  input.onchange();
  app.window.FileReader = original;
}

test("importing a stale file is blocked behind a warning naming what would be lost", function () {
  var window = helpers.freshWindow();
  var l = helpers.loadLib(window);

  var local = l.schema.blank();
  local.holdings.push({ id: "h1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "dev-laptop", deleted: false });
  local.valuations.push({ id: "v1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "dev-laptop", deleted: false });

  var incoming = l.schema.blank();
  incoming.holdings.push({ id: "h1", updatedAt: "2026-08-07T10:00:00.000Z", deviceId: "dev-phone", deleted: false });

  var app = helpers.loadApp(local);
  var doc = app.window.document;
  importIntoApp(app, "fileIn", JSON.stringify(incoming));

  assert.ok(doc.getElementById("importModal").classList.contains("on"), "warning modal must open");
  var body = doc.getElementById("importModalBody").textContent;
  assert.match(body, /dev-phone/, "must name the source device");
  assert.match(body, /3 days older/, "must state how stale the file is");
  assert.match(body, /discards 2 changes/, "must state the number of local changes at risk");
  // Counts of one must read as English, not "1 holdings".
  assert.match(body, /1 holding(?!s)/);
  assert.match(body, /1 valuation(?!s)/);

  // Nothing may be written until the owner confirms.
  var stillLocal = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(stillLocal.valuations.length, 1, "local data must survive an unconfirmed import");
});

test("cancelling a stale import leaves local data untouched", function () {
  var window = helpers.freshWindow();
  var l = helpers.loadLib(window);
  var local = l.schema.blank();
  local.holdings.push({ id: "h1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "dev-laptop", deleted: false });

  var app = helpers.loadApp(local);
  var doc = app.window.document;
  importIntoApp(app, "fileIn", JSON.stringify(l.schema.blank()));

  doc.getElementById("importCancel").click();
  assert.equal(doc.getElementById("importModal").classList.contains("on"), false);
  var after = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(after.holdings.length, 1);
});

test("confirming a stale import replaces state, as the owner explicitly chose", function () {
  var window = helpers.freshWindow();
  var l = helpers.loadLib(window);
  var local = l.schema.blank();
  local.holdings.push({ id: "h1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "dev-laptop", deleted: false });

  var app = helpers.loadApp(local);
  var doc = app.window.document;
  importIntoApp(app, "fileIn", JSON.stringify(l.schema.blank()));
  doc.getElementById("importConfirm").click();

  var after = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(after.holdings.length, 0);
  assert.equal(doc.querySelectorAll("#kpis .v")[2].textContent, "0");
});

test("a safe import applies immediately with no warning", function () {
  var window = helpers.freshWindow();
  var l = helpers.loadLib(window);
  var incoming = l.schema.blank();
  incoming.holdings.push({ id: "h9", updatedAt: "2026-08-11T10:00:00.000Z", deviceId: "dev-phone", deleted: false });

  var app = helpers.loadApp(); // empty local store
  var doc = app.window.document;
  importIntoApp(app, "fileIn", JSON.stringify(incoming));

  assert.equal(doc.getElementById("importModal").classList.contains("on"), false);
  assert.equal(doc.querySelectorAll("#kpis .v")[2].textContent, "1");
});

test("importing a Fund Desk v1 export via the migrate button updates the rendered counts", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  var fixture = require("fs").readFileSync(
    require("path").join(__dirname, "fixtures", "fund-desk-export.json"), "utf8"
  );

  // jsdom doesn't implement real file pickers; call the app's own onchange handler
  // directly with a stub FileReader-shaped result, exercising the same import path.
  var fileInput = doc.getElementById("migrateFile");
  var originalFileReader = app.window.FileReader;
  app.window.FileReader = function () {
    this.readAsText = function () {
      this.result = fixture;
      this.onload();
    };
  };
  Object.defineProperty(fileInput, "files", { value: [{}], configurable: true });
  fileInput.onchange();
  app.window.FileReader = originalFileReader;

  var holdingsCount = doc.querySelectorAll("#kpis .v")[2].textContent;
  assert.equal(holdingsCount, "6");
  var valuationsCount = doc.querySelectorAll("#kpis .v")[3].textContent;
  assert.equal(valuationsCount, "6"); // 7 entries in the fixture minus 1 orphaned
});
