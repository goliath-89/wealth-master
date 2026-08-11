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

test("sync status pill reads Offline in P0 (no sync engine built yet)", function () {
  var app = helpers.loadApp();
  var label = app.window.document.getElementById("syncLabel").textContent;
  assert.equal(label, "Offline");
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
