"use strict";
// P5.5: the explanations, the empty screen, print and motion.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

var css = fs.readFileSync(path.join(__dirname, "..", "css", "app.css"), "utf8");

test("a long explanation collapses, but the sentence that warns stays on screen", function () {
  var doc = helpers.loadApp().window.document;
  var boxes = doc.querySelectorAll("details.warnbox");
  assert.ok(boxes.length >= 4, "the standing explanations are collapsible");
  Array.prototype.forEach.call(boxes, function (d) {
    var summary = d.querySelector("summary");
    assert.ok(summary, "every collapsible note has a summary");
    assert.ok(summary.textContent.trim().length > 20,
      "the summary carries the point, not just 'More'");
    assert.equal(d.open, false, "and it starts closed");
  });
});

// R3 and FR-5.8: a projection must say on screen that it is illustrative. Putting that
// behind a disclosure triangle would be hiding exactly the sentence that has to be read.
test("the forecast still declares itself illustrative without being opened", function () {
  var doc = helpers.loadApp().window.document;
  var summary = doc.querySelector("#v-forecast details.warnbox summary");
  assert.ok(summary);
  assert.match(summary.textContent, /Illustrative only/);
  assert.match(summary.textContent, /not predictions/);
});

test("the blank-is-not-zero rule is stated where figures are typed", function () {
  var doc = helpers.loadApp().window.document;
  var summary = doc.querySelector("#v-month details.warnbox summary");
  assert.match(summary.textContent, /Blank means/);
  assert.match(summary.textContent, /not the same as zero/);
});

test("the full explanation is still in the page for print and for search", function () {
  var doc = helpers.loadApp().window.document;
  assert.match(doc.getElementById("v-loans").textContent, /docs\/loan-validation\.md/);
  assert.match(doc.getElementById("v-month").textContent, /contributions and income/);
});

test("an app with no data invites a first entry on every screen that needs one", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.match(doc.getElementById("worthLines").textContent, /No figures yet/);
  assert.match(doc.getElementById("tree").textContent, /No institutions yet/);
  assert.ok(doc.getElementById("firstInstBtn"), "and offers the first step");
  assert.match(doc.getElementById("assetList").textContent, /No physical assets/);
  assert.match(doc.getElementById("liabList").textContent, /No liabilities/);
  assert.deepEqual(app.consoleErrors, []);
});

test("the stale claim that phase P1 is in progress is gone from the Data screen", function () {
  var doc = helpers.loadApp().window.document;
  assert.equal(/Phase P1 in progress/.test(doc.getElementById("v-data").textContent), false);
});

test("motion is dropped for anyone who asks for less of it (NFR-9)", function () {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  var block = css.split("@media(prefers-reduced-motion:reduce)")[1];
  assert.match(block, /transition-duration:\.01ms!important/);
  assert.match(block, /animation-duration:\.01ms!important/);
});

test("printing drops the chrome and prints dark on white, whatever the theme", function () {
  assert.match(css, /@media print\{/);
  var block = css.split("@media print{")[1];
  assert.match(block, /--bg:#fff/);
  assert.match(block, /--tx:#000/);
  assert.match(block, /\.side[^}]*display:none!important/, "the navigation is not printed");
  assert.match(block, /break-inside:avoid/, "and a card is not split across pages");
});

test("every collapsed explanation is opened for the print and closed again after", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  var box = doc.querySelector("details.warnbox");
  assert.equal(box.open, false);

  app.window.dispatchEvent(new app.window.Event("beforeprint"));
  assert.equal(box.open, true, "paper has no disclosure triangle");

  app.window.dispatchEvent(new app.window.Event("afterprint"));
  assert.equal(box.open, false, "and the screen goes back to how it was");
});

test("one that was already open is left open after printing", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  var box = doc.querySelector("details.warnbox");
  box.open = true;

  app.window.dispatchEvent(new app.window.Event("beforeprint"));
  app.window.dispatchEvent(new app.window.Event("afterprint"));
  assert.equal(box.open, true);
});

test("every control shows where the keyboard is", function () {
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /\.iconbtn:focus-visible/);
  assert.match(css, /summary:focus-visible/);
  assert.match(css, /\.tab:focus-visible/);
});

test("the type stack does not fall back to the usual web-app faces", function () {
  var body = css.match(/body\{[^}]*\}/)[0];
  assert.match(body, /font-family:system-ui/);
  assert.equal(/Roboto|Arial/.test(body), false);
});

// Browsers cache js/ and css/ independently of index.html, so a return visitor could run
// last week's app.js against today's markup — which is exactly how a close button came to
// render and do nothing. Every asset URL carries a marker the deploy replaces with the
// commit being deployed, so the pair can never be mismatched.
test("every local script and stylesheet is versioned", function () {
  var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  var unversioned = [];
  var re = /(?:<script src|<link rel="stylesheet" href)="((?:js|css)\/[^"]+)"/g, m;
  while ((m = re.exec(html))) {
    if (m[1].indexOf("?v=") === -1) unversioned.push(m[1]);
  }
  assert.deepEqual(unversioned, [], "these would be served from a stale cache");
});

test("the deploy replaces the marker rather than shipping the local one", function () {
  var workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /sed -i "s\/\?v=dev\//, "the deploy stamps the URLs");
  assert.match(workflow, /GITHUB_SHA/, "with the commit it is deploying");
  assert.match(workflow, /an asset URL was left unstamped/, "and fails if one is missed");
});
