"use strict";
// P5.1 app shell: sidebar totals, top bar, navigation and palette.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Kenanga";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.liquid = true;
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "KDI Save";
  s.holdings.push(h);
  var liab = l.schema.newLiability("dev-1");
  liab.name = "Car loan";
  liab.type = "hire purchase";
  s.liabilities.push(liab);
  return { l: l, state: s, h: h, liab: liab };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function thisMonth(f) { return f.l.valuations.currentPeriod(); }

test("compact sidebar amounts keep a month's movement visible", function () {
  var shell = helpers.loadLib(helpers.freshWindow()).uiShell;
  assert.equal(shell.navAmount(1419500), "RM 1.42m");
  assert.equal(shell.navAmount(540100), "RM 540k");
  assert.equal(shell.navAmount(9500), "RM 9.5k");
  assert.equal(shell.navAmount(950), "RM 950");
  assert.equal(shell.navAmount(-25000), "−RM 25k");
});

test("with nothing recorded the sidebar shows no figures, not RM 0", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  ["navNet", "navAssets", "navDebts", "topPeriod"].forEach(function (id) {
    assert.equal(doc.getElementById(id).textContent, "", id + " should be blank");
  });
  assert.deepEqual(app.consoleErrors, []);
});

test("sidebar totals read the same series as the Net worth screen", function () {
  var f = seeded();
  record(f, { holdingId: f.h.id, period: thisMonth(f), balance: 50000 });
  record(f, { liabilityId: f.liab.id, period: thisMonth(f), balance: 30000 });
  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("navNet").textContent, "RM 20k");
  assert.equal(doc.getElementById("navAssets").textContent, "RM 50k");
  assert.equal(doc.getElementById("navDebts").textContent, "RM 30k");
  assert.match(doc.getElementById("topPeriod").textContent, /^As of [A-Z][a-z]{2} \d{4}$/);
  assert.match(doc.getElementById("worthKpis").textContent, /RM 20,000/,
    "the screen and the sidebar agree");
});

test("a total resting on a carried-forward figure keeps its asterisk in the sidebar", function () {
  var f = seeded();
  var last = f.l.valuations.prevPeriod(thisMonth(f));
  record(f, { holdingId: f.h.id, period: thisMonth(f), balance: 50000 });
  record(f, { liabilityId: f.liab.id, period: last, balance: 30000 });
  var doc = helpers.loadApp(f.state).window.document;
  var net = doc.getElementById("navNet");
  assert.match(net.textContent, /\*$/);
  assert.match(net.getAttribute("title"), /carried forward/);
  assert.match(doc.getElementById("topPeriod").textContent, /\*$/);
});

test("sidebar items still switch views through the unchanged tab wiring", function () {
  var doc = helpers.loadApp().window.document;
  doc.querySelector('.tab[data-v="loans"]').click();
  assert.ok(doc.getElementById("v-loans").classList.contains("on"));
  assert.ok(!doc.getElementById("v-worth").classList.contains("on"));
  assert.ok(doc.querySelector('.tab[data-v="loans"]').classList.contains("on"));
});

test("every navigation item has a text label and a decorative icon", function () {
  var doc = helpers.loadApp().window.document;
  Array.prototype.forEach.call(doc.querySelectorAll(".tab"), function (t) {
    assert.ok(t.querySelector(".tab-l").textContent.trim(), "tab needs a visible label");
    assert.equal(t.querySelector("svg").getAttribute("aria-hidden"), "true");
  });
  assert.ok(doc.querySelector('.tab[data-v="worth"] #navNet'));
  assert.ok(doc.querySelector('.tab[data-v="accounts"] #navAssets'));
  assert.ok(doc.querySelector('.tab[data-v="loans"] #navDebts'));
});

test("navigation items declare a 44px touch target in both layouts (NFR-6)", function () {
  var css = fs.readFileSync(path.join(__dirname, "..", "css", "app.css"), "utf8");
  var rules = css.match(/\.tab\{[^}]*\}/g);
  assert.ok(rules && rules.length >= 2, "expected phone and desktop .tab rules");
  rules.forEach(function (r) {
    var m = r.match(/min-height:(\d+)px/);
    assert.ok(m && +m[1] >= 44, "tab rule under 44px: " + r.slice(0, 60));
  });
});

// Decision D5: green, grey and white, no violet or blue. Guard the stylesheet and the chart
// palettes so a stray hex cannot quietly bring it back.
test("no blue or violet colour is defined anywhere the app paints from", function () {
  var root = path.join(__dirname, "..");
  var src = fs.readFileSync(path.join(root, "css", "app.css"), "utf8") +
    fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  var offenders = (src.match(/#[0-9a-fA-F]{6}\b/g) || []).filter(function (hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255,
      b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.12) return false;   // greys
    var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return h >= 195 && h <= 300;
  });
  assert.deepEqual(offenders, []);
});
