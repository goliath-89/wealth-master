"use strict";
// P7.2: point at a donut slice, or its legend row, and read what it is.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = opts.instName || "Maybank";
  s.institutions.push(inst);
  var inst2 = l.schema.newInstitution("dev-1");
  inst2.name = "EPF";
  s.institutions.push(inst2);
  var now = l.valuations.currentPeriod();
  var prev = l.valuations.prevPeriod(now);

  function holding(name, cls, institution, balance, carried) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = institution.id; a.name = name; a.class = cls;
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id; h.name = name;
    s.holdings.push(h);
    l.valuations.upsertValuation(s, { holdingId: h.id, period: carried ? prev : now, balance: balance }, "dev-1");
    return h;
  }
  holding("Savings", "cash", inst, 6000);
  holding("Fixed deposit", "cash", inst, 2000);
  holding("EPF i-Akaun", "retirement", inst2, 12000, opts.carried);
  // Something recorded this month, so last month's EPF really is carried forward.
  if (opts.carried) {
    var b = s.holdings[0];
    l.valuations.upsertValuation(s, { holdingId: b.id, period: prev, balance: 5000 }, "dev-1");
  }
  return s;
}

function load(state) {
  var app = helpers.loadApp(state);
  return { app: app, doc: app.window.document };
}

function slices(doc, id) { return Array.prototype.slice.call(doc.querySelectorAll("#" + id + " [data-slice]")); }
function tip(doc, id) { return doc.querySelector("#" + id + " .hv-tip"); }
function point(c, node) { node.dispatchEvent(new c.app.window.MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 })); }

test("both donuts have a slice per category and a hidden pop-out", function () {
  var c = load(seeded());
  assert.ok(slices(c.doc, "classChart").length >= 2);
  assert.ok(slices(c.doc, "allocChart").length >= 2);
  assert.equal(tip(c.doc, "classChart").hidden, true);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("pointing at a category slice names it, with its value, share and holdings", function () {
  var c = load(seeded());
  var slice = slices(c.doc, "classChart")[0];
  point(c, slice);
  var t = tip(c.doc, "classChart");
  assert.equal(t.hidden, false);
  assert.match(t.textContent, /Free Cash|Retirement/);
  assert.match(t.textContent, /RM [\d,]+\.\d\d/);
  assert.match(t.textContent, /Share of assets/);
  assert.match(t.textContent, /\d+ holdings?/);
});

test("the figures in the pop-out are the slice's own", function () {
  var c = load(seeded());
  var pos = slices(c.doc, "classChart").map(function (s) { point(c, s); return tip(c.doc, "classChart").textContent; });
  assert.ok(pos.some(function (t) { return /Free Cash/.test(t) && /RM 8,000\.00/.test(t) && /2 holdings/.test(t); }),
    "Savings 6,000 plus the fixed deposit 2,000");
  assert.ok(pos.some(function (t) { return /Retirement/.test(t) && /RM 12,000\.00/.test(t) && /1 holding\b/.test(t); }));
});

test("the by-institution donut shows the institution and what it holds", function () {
  var c = load(seeded());
  var sel = c.doc.getElementById("allocDim");
  assert.equal(sel.value, "institution");
  var texts = slices(c.doc, "allocChart").map(function (s) { point(c, s); return tip(c.doc, "allocChart").textContent; });
  assert.ok(texts.some(function (t) { return /Maybank/.test(t) && /RM 8,000\.00/.test(t) && /2 holdings/.test(t); }));
  assert.ok(texts.some(function (t) { return /EPF/.test(t) && /RM 12,000\.00/.test(t); }));
});

test("the hovered slice lifts and the others dim; leaving restores them", function () {
  var c = load(seeded());
  var all = slices(c.doc, "classChart");
  point(c, all[0]);
  assert.ok(all[0].classList.contains("hv-on"));
  assert.equal(all[1].classList.contains("hv-on"), false);
  assert.ok(c.doc.querySelector("#classChart svg").classList.contains("hv-dim"));
  all[0].dispatchEvent(new c.app.window.MouseEvent("pointerleave", { bubbles: true }));
  assert.equal(tip(c.doc, "classChart").hidden, true);
  assert.equal(c.doc.querySelector("#classChart svg").classList.contains("hv-dim"), false);
});

test("hovering a legend row highlights its slice and shows the same pop-out", function () {
  var c = load(seeded());
  var rows = Array.prototype.slice.call(c.doc.querySelectorAll("#classLegend [data-slice]"));
  assert.equal(rows.length, slices(c.doc, "classChart").length);
  rows[1].dispatchEvent(new c.app.window.MouseEvent("pointerenter", { bubbles: true }));
  assert.ok(slices(c.doc, "classChart")[1].classList.contains("hv-on"));
  assert.ok(rows[1].classList.contains("hv-on"));
  assert.equal(tip(c.doc, "classChart").hidden, false);
});

test("a slice is reachable by keyboard: focus reads it, arrows move on, Escape closes", function () {
  var c = load(seeded());
  var all = slices(c.doc, "classChart");
  assert.equal(all[0].getAttribute("tabindex"), "0");
  all[0].focus();
  assert.equal(tip(c.doc, "classChart").hidden, false);
  all[0].dispatchEvent(new c.app.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.ok(all[1].classList.contains("hv-on"), "moved to the next slice");
  all[1].dispatchEvent(new c.app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(tip(c.doc, "classChart").hidden, true);
  assert.match(all[0].getAttribute("aria-label"), /percent, RM/);
});

test("a slice resting on carried-forward figures says so in words as well as the mark", function () {
  var c = load(seeded({ carried: true }));
  var texts = slices(c.doc, "classChart").map(function (s) { point(c, s); var d = c.doc.createElement("div"); d.innerHTML = tip(c.doc, "classChart").innerHTML; return d; });
  var marked = texts.filter(function (t) { return t.querySelector(".stale-mark"); });
  assert.equal(marked.length, 1, "only the retirement slice is carried");
  assert.match(marked[0].textContent, /carried forward/i);
  assert.match(marked[0].textContent, /Retirement/);
});

test("an institution name cannot inject markup through the pop-out", function () {
  var c = load(seeded({ instName: '<img src=x onerror="window.__pwned=1">' }));
  slices(c.doc, "allocChart").forEach(function (s) { point(c, s); });
  assert.equal(c.doc.querySelector("#allocChart .hv-tip img"), null);
  assert.equal(c.doc.querySelector("#allocLegend img"), null);
  assert.equal(c.app.window.__pwned, undefined);
  var shown = slices(c.doc, "allocChart").map(function (s) { point(c, s); return tip(c.doc, "allocChart").textContent; });
  assert.ok(shown.some(function (t) { return t.indexOf("<img") !== -1; }), "shown as text, not parsed");
});

test("a single-slice donut is still pointable", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1"); inst.name = "Maybank"; s.institutions.push(inst);
  var a = l.schema.newAccount("dev-1"); a.institutionId = inst.id; a.name = "Savings"; a.class = "cash"; s.accounts.push(a);
  var h = l.schema.newHolding("dev-1"); h.accountId = a.id; h.name = "Savings"; s.holdings.push(h);
  l.valuations.upsertValuation(s, { holdingId: h.id, period: l.valuations.currentPeriod(), balance: 5000 }, "dev-1");
  var c = load(s);
  var only = slices(c.doc, "classChart");
  assert.equal(only.length, 1);
  point(c, only[0]);
  assert.match(tip(c.doc, "classChart").textContent, /Free Cash/);
});

test("redrawing does not stack pop-outs", function () {
  var c = load(seeded());
  var sel = c.doc.getElementById("allocDim");
  sel.value = "currency";
  sel.dispatchEvent(new c.app.window.Event("change"));
  assert.equal(c.doc.querySelectorAll("#allocChart .hv-tip").length, 1);
  assert.equal(c.doc.querySelectorAll("#classChart .hv-tip").length, 1);
});
