"use strict";
// P7.3: zoom and scroll the trend chart through time.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(months) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  var a = l.schema.newAccount("dev-1");
  a.institutionId = inst.id; a.name = "Savings"; a.class = "cash";
  s.accounts.push(a);
  var h = l.schema.newHolding("dev-1");
  h.accountId = a.id; h.name = "Savings";
  s.holdings.push(h);
  var p = l.valuations.currentPeriod(), periods = [];
  for (var i = 0; i < months; i++) { periods.unshift(p); p = l.valuations.prevPeriod(p); }
  periods.forEach(function (period, i) {
    l.valuations.upsertValuation(s, { holdingId: h.id, period: period, balance: 10000 + i * 1000 }, "dev-1");
  });
  return s;
}

function load(months, opts) {
  opts = opts || {};
  var app = helpers.loadApp(seeded(months), function (window) {
    // jsdom has no layout: give charts a width so the pointer maths has something to use.
    window.Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: opts.width || 720, height: 240, right: opts.width || 720, bottom: 240 };
    };
    if (opts.clientWidth) {
      Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: function () { return opts.clientWidth; } });
    }
  });
  var doc = app.window.document;
  return { app: app, win: app.window, doc: doc, host: doc.getElementById("worthChart") };
}

function chart(c) { return c.host.querySelector("svg.chart"); }
function points(c) { return c.host.querySelectorAll("svg.chart circle").length; }
function range(c) { return c.host.querySelector(".zrange").textContent; }
function press(c, z) { c.host.querySelector('[data-zoom="' + z + '"]').click(); }
function ptr(c, type, target, props) {
  var e = new c.win.Event(type, { bubbles: true });
  var all = Object.assign({ clientX: 0, clientY: 0, pointerId: 1, pointerType: "mouse", button: 0 }, props || {});
  Object.keys(all).forEach(function (k) { Object.defineProperty(e, k, { value: all[k] }); });
  target.dispatchEvent(e);
  return e;
}

test("the whole history is shown to begin with, with controls and an overview strip", function () {
  var c = load(30);
  assert.equal(points(c), 30);
  assert.ok(c.host.querySelector(".zoombar"));
  assert.ok(c.host.querySelector("svg.ov"), "the overview");
  assert.equal(c.host.querySelector('[data-zoom="all"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(c.app.consoleErrors, []);
});

test("the preset buttons show that many months, ending at the latest", function () {
  var c = load(30);
  press(c, 12);
  assert.equal(points(c), 13, "twelve months back, matching the 1-year figure on the headline");
  assert.equal(c.host.querySelector('[data-zoom="12"]').getAttribute("aria-pressed"), "true");
  var latest = c.doc.querySelector("#worthChart .zrange").textContent.split(" – ")[1];
  press(c, 6);
  assert.equal(points(c), 7);
  assert.equal(range(c).split(" – ")[1], latest);
  press(c, "all");
  assert.equal(points(c), 30);
});

test("a preset longer than the history is switched off rather than doing nothing", function () {
  var c = load(8);
  assert.equal(c.host.querySelector('[data-zoom="12"]').disabled, true);
  assert.equal(c.host.querySelector('[data-zoom="36"]').disabled, true);
  assert.equal(c.host.querySelector('[data-zoom="6"]').disabled, false);
});

test("zoom in and out step the window, and stop at sensible limits", function () {
  var c = load(30);
  assert.equal(c.host.querySelector('[data-zoom="out"]').disabled, true, "nothing wider than everything");
  var before = points(c);
  press(c, "in");
  assert.ok(points(c) < before);
  for (var i = 0; i < 20; i++) { if (!c.host.querySelector('[data-zoom="in"]').disabled) press(c, "in"); }
  assert.equal(points(c), 3, "never fewer than three months");
  assert.equal(c.host.querySelector('[data-zoom="in"]').disabled, true);
  press(c, "out");
  assert.ok(points(c) > 3);
});

test("the scale follows what is visible, not the whole history", function () {
  var c = load(30);
  var axis = function () {
    return Array.prototype.map.call(c.host.querySelectorAll("svg.chart text.axis-t"), function (t) { return t.textContent; }).join("|");
  };
  var all = axis();
  press(c, 6);
  assert.notEqual(axis(), all);
});

test("ctrl+wheel zooms around the pointer; plain wheel is left for the page to scroll", function () {
  var c = load(30);
  var plain = new c.win.WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
  chart(c).dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, "ordinary scrolling is not swallowed");
  assert.equal(points(c), 30);

  // Zoom in with the pointer at the far right: the latest month must stay in view.
  var latest = range(c).split(" – ")[1];
  var w = new c.win.WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 708, bubbles: true, cancelable: true });
  chart(c).dispatchEvent(w);
  assert.equal(w.defaultPrevented, true);
  assert.ok(points(c) < 30);
  assert.equal(range(c).split(" – ")[1], latest);
});

test("shift+wheel scrolls back and forward through time", function () {
  var c = load(30);
  press(c, 6);
  var end = range(c);
  chart(c).dispatchEvent(new c.win.WheelEvent("wheel", { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
  assert.notEqual(range(c), end);
  assert.equal(points(c), 7, "the window slides, it does not resize");
  chart(c).dispatchEvent(new c.win.WheelEvent("wheel", { deltaY: 100, shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(range(c), end);
});

test("dragging the chart scrolls through time, and the window cannot leave the data", function () {
  var c = load(30);
  press(c, 6);
  var end = range(c);
  ptr(c, "pointerdown", chart(c), { clientX: 300 });
  ptr(c, "pointermove", chart(c), { clientX: 400 });
  assert.notEqual(range(c), end, "dragging right reveals earlier months");
  assert.equal(points(c), 7);
  ptr(c, "pointermove", chart(c), { clientX: 400000 });
  ptr(c, "pointerup", chart(c), { clientX: 400000 });
  assert.match(range(c), /^[A-Z][a-z]{2} \d{4} – /);
  assert.equal(points(c), 7);
  // Drag the other way as far as it goes: back to the latest month, no further.
  ptr(c, "pointerdown", chart(c), { clientX: 400000 });
  ptr(c, "pointermove", chart(c), { clientX: -400000 });
  ptr(c, "pointerup", chart(c), { clientX: -400000 });
  assert.equal(range(c), end);
});

test("a two-finger pinch zooms", function () {
  var c = load(30);
  ptr(c, "pointerdown", chart(c), { clientX: 300, pointerId: 1, pointerType: "touch" });
  ptr(c, "pointerdown", chart(c), { clientX: 400, pointerId: 2, pointerType: "touch" });
  ptr(c, "pointermove", chart(c), { clientX: 200, pointerId: 1, pointerType: "touch" });
  ptr(c, "pointermove", chart(c), { clientX: 500, pointerId: 2, pointerType: "touch" });
  var apart = points(c);
  assert.ok(apart < 30, "fingers moving apart zoom in");
  ptr(c, "pointermove", chart(c), { clientX: 290, pointerId: 1, pointerType: "touch" });
  ptr(c, "pointermove", chart(c), { clientX: 310, pointerId: 2, pointerType: "touch" });
  assert.ok(points(c) > apart, "and moving together zooms back out");
  ptr(c, "pointerup", chart(c), { pointerId: 1, pointerType: "touch" });
  ptr(c, "pointerup", chart(c), { pointerId: 2, pointerType: "touch" });
});

test("the overview window is draggable, and a tap outside it jumps there", function () {
  var c = load(30);
  press(c, 6);
  var latest = range(c);
  var ov = c.host.querySelector("svg.ov");
  // A tap at the far left is well outside the window, which sits at the right.
  ptr(c, "pointerdown", ov, { clientX: 70 });
  ptr(c, "pointerup", ov, { clientX: 70 });
  assert.notEqual(range(c), latest);
  assert.equal(points(c), 7);
  assert.match(range(c), /^[A-Z][a-z]{2} \d{4} – /);

  // Drag the window back along the strip to the right-hand end.
  ov = c.host.querySelector("svg.ov");
  ptr(c, "pointerdown", ov, { clientX: 100 });
  ptr(c, "pointermove", ov, { clientX: 708 });
  ptr(c, "pointerup", ov, { clientX: 708 });
  assert.equal(range(c), latest);
});

test("double-clicking the chart, or pressing +/-, resets or steps the zoom", function () {
  var c = load(30);
  press(c, 6);
  chart(c).dispatchEvent(new c.win.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(points(c), 30);
  chart(c).dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "+", bubbles: true }));
  assert.ok(points(c) < 30);
  chart(c).dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "-", bubbles: true }));
  assert.equal(points(c), 30);
});

test("the chosen window survives a re-render", function () {
  var c = load(30);
  press(c, 12);
  var r = range(c);
  c.doc.querySelector('.tab[data-v="month"]').click();
  c.doc.querySelector('.tab[data-v="worth"]').click();
  assert.equal(range(c), r);
  assert.equal(c.doc.querySelectorAll("#worthChart .zoombar").length, 1, "no stacked controls");
});

test("pointing at a month still reads it on a zoomed chart", function () {
  var c = load(30);
  press(c, 6);
  chart(c).dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  var tip = c.host.querySelector(".hv-tip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Net worth/);
});

test("a phone gets a taller drawing so its text stays readable", function () {
  var wide = load(12);
  assert.equal(chart(wide).getAttribute("viewBox"), "0 0 720 240");
  var narrow = load(12, { clientWidth: 375 });
  assert.equal(chart(narrow).getAttribute("viewBox"), "0 0 360 300");
});

test("the controls are labelled for a screen reader", function () {
  var c = load(30);
  assert.match(c.host.querySelector('[data-zoom="in"]').getAttribute("aria-label"), /Zoom in/);
  assert.match(c.host.querySelector('[data-zoom="out"]').getAttribute("aria-label"), /Zoom out/);
  assert.match(c.host.querySelector("svg.ov").getAttribute("aria-label"), /Drag/);
});
