"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var jsdom = require("jsdom");
var JSDOM = jsdom.JSDOM;

// jsdom implements no layout, so scrollTo and friends report themselves as
// "not implemented" on its virtual console. That is a gap in the test environment, not a
// fault in the app, so it is filtered here rather than worked around in app code. Real
// page errors still surface: only jsdom's own not-implemented notices are dropped.
function quietConsole() {
  var vc = new jsdom.VirtualConsole();
  vc.sendTo(console, { omitJSDOMErrors: true });
  vc.on("jsdomError", function (err) {
    if (err && /Not implemented/.test(err.message)) return;
    console.error(err);
  });
  return vc;
}

var ROOT = path.join(__dirname, "..");

// Fresh jsdom window per call — jsdom's localStorage is per-window, so tests don't leak state.
function freshWindow(seedState) {
  var dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  if (seedState !== undefined) {
    dom.window.localStorage.setItem("wealthmaster.state", JSON.stringify(seedState));
  }
  return dom.window;
}

// Loads schema.js + store.js + migrate-funddesk.js as plain Node modules against
// a caller-supplied `localStorage` (so schema.js's getDeviceId / store.js's load/save
// resolve to that window's storage rather than Node's real globals). schema.js and
// store.js reference `localStorage` as a free variable resolved at CALL time, not at
// require time, so global.localStorage must stay set to `window.localStorage` for as
// long as the caller keeps using the returned lib — it is deliberately not restored.
function loadLib(window) {
  global.localStorage = window.localStorage;
  delete require.cache[require.resolve("../js/schema.js")];
  delete require.cache[require.resolve("../js/store.js")];
  delete require.cache[require.resolve("../js/migrate-funddesk.js")];
  delete require.cache[require.resolve("../js/import-guard.js")];
  delete require.cache[require.resolve("../js/csv.js")];
  delete require.cache[require.resolve("../js/entities.js")];
  delete require.cache[require.resolve("../js/valuations.js")];
  var schema = require("../js/schema.js");
  var store = require("../js/store.js");
  var migrateFundDesk = require("../js/migrate-funddesk.js");
  var importGuard = require("../js/import-guard.js");
  var csv = require("../js/csv.js");
  var entities = require("../js/entities.js");
  var valuations = require("../js/valuations.js");
  return {
    schema: schema, store: store, migrateFundDesk: migrateFundDesk,
    importGuard: importGuard, csv: csv, entities: entities, valuations: valuations
  };
}

// Loads the real index.html into jsdom and evals the app's own <script src> files
// in the window's context, exactly as a browser would — for asserting on rendered
// DOM output rather than re-implementing the app's logic in the test.
function loadApp(seedState) {
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  // Strip <script src="..."> tags — jsdom won't fetch local files without a
  // ResourceLoader, so scripts are eval'd manually below in document order instead.
  var htmlNoScripts = html.replace(/<script src="[^"]+"><\/script>\s*/g, "");
  var dom = new JSDOM(htmlNoScripts, {
    url: "http://localhost/",
    runScripts: "dangerously",
    virtualConsole: quietConsole()
  });
  var window = dom.window;

  if (seedState !== undefined) {
    window.localStorage.setItem("wealthmaster.state", JSON.stringify(seedState));
  }

  var consoleErrors = [];
  window.console.error = function () {
    consoleErrors.push(Array.prototype.slice.call(arguments).join(" "));
  };

  ["js/schema.js", "js/store.js", "js/migrate-funddesk.js", "js/import-guard.js",
   "js/csv.js", "js/filestore.js", "js/entities.js", "js/valuations.js", "js/app.js"].forEach(function (rel) {
    var code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    window.eval(code);
  });

  return { dom: dom, window: window, consoleErrors: consoleErrors };
}

module.exports = { freshWindow: freshWindow, loadLib: loadLib, loadApp: loadApp };
