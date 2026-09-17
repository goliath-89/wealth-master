"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

// Every module flattens its exports onto one WM namespace, so two modules exporting the
// same name means the later script tag silently replaces the earlier function. That is
// invisible at load time and shows up as unrelated tests failing somewhere else.
//
// sheet-import.js exported reconcile(), which loans.js already owned for measuring a
// schedule against a real statement. Loading it replaced the loan engine's function and
// broke five loan tests with no hint at the cause. This is the guard.

var ROOT = path.join(__dirname, "..");

// Load order matters — it is the order index.html loads them, so a later module is the
// one that would win a clash.
function moduleFiles() {
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var out = [];
  var re = /<script src="(js\/[^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) {
    if (m[1] !== "js/app.js" && m[1] !== "js/filestore.js") out.push(m[1]);
  }
  return out;
}

test("no two modules export the same name onto the WM namespace", function () {
  helpers.loadLib(helpers.freshWindow());   // sets up the localStorage schema.js needs
  var owner = {};
  var clashes = [];

  moduleFiles().forEach(function (rel) {
    var full = path.join(ROOT, rel);
    delete require.cache[require.resolve(full)];
    var exported = require(full);
    Object.keys(exported).forEach(function (name) {
      if (owner[name] && owner[name] !== rel) {
        clashes.push(name + ": " + owner[name] + " then " + rel);
      } else {
        owner[name] = rel;
      }
    });
  });

  assert.deepEqual(clashes, [],
    "these names are exported by more than one module, so the later one wins silently");
});

test("every module in index.html is registered in the test harness", function () {
  var helpersSrc = fs.readFileSync(path.join(__dirname, "helpers.js"), "utf8");
  var missing = moduleFiles().filter(function (rel) {
    return helpersSrc.indexOf('"../' + rel + '"') === -1;
  });
  // Miss this and every UI test fails confusingly, because the app loads a module the
  // library loader does not.
  assert.deepEqual(missing, [], "modules loaded by the app but absent from loadLib");
});

test("every module in index.html is loaded by loadApp, in the app's own order", function () {
  var helpersSrc = fs.readFileSync(path.join(__dirname, "helpers.js"), "utf8");
  var listed = helpersSrc.match(/\["js\/schema\.js"[\s\S]*?"js\/app\.js"\]/);
  assert.ok(listed, "loadApp's script list should be findable");
  var inHelper = listed[0].match(/js\/[a-z-]+\.js/g);
  var inHtml = moduleFiles().concat(["js/app.js"]);
  inHtml.forEach(function (rel) {
    assert.ok(inHelper.indexOf(rel) !== -1, rel + " is loaded by the app but not by loadApp");
  });
});
