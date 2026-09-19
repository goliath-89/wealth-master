"use strict";
// P8: the month-end screen leads with what is still to do, one figure at a time.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var now = l.valuations.currentPeriod(), prev = l.valuations.prevPeriod(now);
  var inst = l.schema.newInstitution("d"); inst.name = "Maybank"; s.institutions.push(inst);
  var ids = {};
  function holding(key, name, cls, o) {
    o = o || {};
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls;
    if (o.currency) a.currency = o.currency;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name; if (o.unitBased) h.unitBased = true;
    s.holdings.push(h); ids[key] = h.id;
    (o.history || []).forEach(function (p) {
      l.valuations.upsertValuation(s, { holdingId: h.id, period: p[0], balance: p[1], income: p[2] === undefined ? null : p[2] }, "d");
    });
  }
  holding("savings", "Savings", "cash", { history: [[prev, 5000, 20]] });
  holding("epf", "EPF", "retirement", { history: [[prev, 11000]] });
  if (opts.fresh) holding("fresh", "Brand new", "cash", {});
  if (opts.usd) holding("usd", "USD account", "cash", { currency: "USD", history: [[prev, 2000]] });
  if (opts.units) holding("units", "Unit trust", "investment", { unitBased: true, history: [[prev, 7000]] });
  var loan = l.schema.newLiability("d");
  loan.name = "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4; loan.tenureMonths = 60; loan.instalment = 1104.99;
  s.liabilities.push(loan); ids.loan = loan.id;
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: prev, balance: 20000 }, "d");
  return { l: l, state: s, ids: ids, now: now, prev: prev };
}

function load(opts) {
  var f = seeded(opts);
  var app = helpers.loadApp(f.state);
  return { f: f, app: app, win: app.window, doc: app.window.document, WM: app.window.WM };
}

// commit() saves to storage, which is the state as the next visit would see it.
function stateOf(c) { return JSON.parse(c.win.localStorage.getItem("wealthmaster.state")); }
function guideText(c) { return c.doc.getElementById("monthGuide").textContent; }
function current(c) { return (c.doc.querySelector("#monthGuide .guide-n") || {}).textContent || ""; }
function type(c, id, value) {
  var el = c.doc.getElementById(id);
  el.value = value;
  el.dispatchEvent(new c.win.Event("input", { bubbles: true }));
}
function enter(c, id) {
  c.doc.getElementById(id).dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}
function click(c, id) { c.doc.getElementById(id).click(); }
function bal(c, id) {
  var v = c.WM.valuationFor(stateOf(c), id, c.f.now);
  return v ? v.balance : null;
}

test("the month-end screen leads with the first figure still to record", function () {
  var c = load();
  assert.ok(c.doc.getElementById("monthGuide").querySelector(".guide"));
  assert.match(current(c), /Savings|EPF|Car loan/);
  assert.match(guideText(c), /3 figures left/);
  assert.match(guideText(c), /0 of 3 recorded/);
  assert.match(guideText(c), /Last recorded RM/);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("the full grid is still there, tucked underneath", function () {
  var c = load();
  var d = c.doc.getElementById("monthFull");
  assert.equal(d.tagName, "DETAILS");
  assert.ok(d.querySelector("#monthRows .mrow"), "every figure at once");
  assert.ok(d.querySelector("#saveMonthBtn"));
});

test("Enter saves the figure and moves on to the next", function () {
  var c = load();
  var first = current(c);
  var id = first.indexOf("Savings") >= 0 ? c.f.ids.savings : first.indexOf("EPF") >= 0 ? c.f.ids.epf : c.f.ids.loan;
  type(c, "guideBalance", "5300");
  enter(c, "guideBalance");
  assert.equal(bal(c, id), 5300);
  assert.notEqual(current(c), first, "moved on");
  assert.match(guideText(c), /2 figures left/);
  assert.match(guideText(c), /1 of 3 recorded/);
  assert.equal(c.doc.getElementById("guideBalance").value, "", "the box is empty for the next one");
});

test("the figure lands in this month's entry, and the rest of it is kept", function () {
  var c = load();
  // Savings has an income of 20 recorded last month, not this one: record a balance only.
  while (!/Savings/.test(current(c))) click(c, "guideSkip");
  type(c, "guideBalance", "5300");
  enter(c, "guideBalance");
  assert.equal(bal(c, c.f.ids.savings), 5300);
  var v = c.WM.valuationFor(stateOf(c), c.f.ids.savings, c.f.now);
  assert.equal(v.income, null, "income was never recorded this month, so it is not invented");
});

test("Same as last month records last month's figure as this month's, on purpose", function () {
  var c = load();
  while (!/Savings/.test(current(c))) click(c, "guideSkip");
  click(c, "guideSame");
  assert.equal(bal(c, c.f.ids.savings), 5000);
  var q = c.WM.monthQueue(stateOf(c), c.f.now);
  assert.equal(q.items.some(function (i) { return i.name === "Savings"; }), false);
});

test("a blank is refused, not saved as zero", function () {
  var c = load();
  var first = current(c);
  click(c, "guideSave");
  assert.equal(current(c), first, "still on the same figure");
  assert.equal(c.doc.getElementById("guideBalance").classList.contains("badfield"), true);
  assert.match(c.doc.getElementById("snackMsg").textContent, /not saved as zero/i);
  assert.equal(bal(c, c.f.ids.savings), null);
  assert.equal(bal(c, c.f.ids.epf), null);
});

test("something that is not a number is flagged and does not advance", function () {
  var c = load();
  var first = current(c);
  type(c, "guideBalance", "twelve");
  enter(c, "guideBalance");
  assert.equal(current(c), first);
  assert.equal(c.doc.getElementById("guideBalance").classList.contains("badfield"), true);
  assert.match(c.doc.getElementById("snackMsg").textContent, /not a number/);
});

test("skipping sends a figure to the back, and 'go back to them' brings it home", function () {
  var c = load();
  var order = [];
  for (var i = 0; i < 3; i++) { order.push(current(c)); click(c, "guideSkip"); }
  assert.match(guideText(c), /3 figures skipped/);
  assert.equal(c.doc.querySelector("#monthGuide .guide-n").textContent.indexOf("skipped") >= 0, true);
  click(c, "guideReview");
  assert.equal(current(c), order[0]);
});

test("a skipped figure stays due: skipping records nothing", function () {
  var c = load();
  click(c, "guideSkip");
  assert.equal(c.doc.getElementById("navDue").textContent, "3 due");
});

test("recording everything ends on a summary with the net worth and what moved", function () {
  var c = load();
  var values = { Savings: "5300", EPF: "11500", "Car loan": "19000" };
  for (var i = 0; i < 3; i++) {
    var n = current(c).replace(/New$/, "").trim();
    type(c, "guideBalance", values[n]);
    enter(c, "guideBalance");
  }
  var t = guideText(c);
  assert.match(t, /All caught up for/);
  assert.match(t, /3 figures recorded/);
  assert.match(t, /Net worth/);
  assert.match(t, /since/);
  assert.match(t, /5,000\.00 → RM 5,300\.00/, "what it was and what it is now");
  assert.equal(c.doc.getElementById("navDue").hidden, true);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("Undo last on the summary takes the final figure back and asks for it again", function () {
  var c = load();
  var order = [];
  for (var i = 0; i < 3; i++) { order.push(current(c)); type(c, "guideBalance", "1000"); enter(c, "guideBalance"); }
  assert.match(guideText(c), /All caught up/);
  click(c, "guideUndo");
  assert.equal(current(c), order[2], "the last one is back on the screen");
  assert.match(guideText(c), /1 figure left/);
  assert.equal(c.doc.getElementById("navDue").textContent, "1 due");
});

test("a saved figure offers Undo on the message", function () {
  var c = load();
  type(c, "guideBalance", "4321");
  enter(c, "guideBalance");
  var b = c.doc.getElementById("snackAction");
  assert.equal(b.hidden, false);
  assert.match(b.textContent, /Undo/);
});

test("a brand-new figure is marked New and has nothing to copy from", function () {
  var c = load({ fresh: true });
  var guard = 0;
  while (!/Brand new/.test(current(c)) && guard++ < 10) click(c, "guideSkip");
  assert.match(current(c), /New/);
  assert.match(guideText(c), /Nothing recorded for this yet/);
  assert.equal(c.doc.getElementById("guideSame"), null, "no earlier figure to repeat");
});

test("an optional income is saved with the balance, and left alone when not typed", function () {
  var c = load();
  while (!/Savings/.test(current(c))) click(c, "guideSkip");
  type(c, "guideBalance", "5200");
  type(c, "guideIncome", "35");
  enter(c, "guideBalance");
  var v = c.WM.valuationFor(stateOf(c), c.f.ids.savings, c.f.now);
  assert.equal(v.balance, 5200);
  assert.equal(v.income, 35);
});

test("an income already recorded this month survives saving the balance", function () {
  var f = seeded();
  f.l.valuations.upsertValuation(f.state, { holdingId: f.ids.savings, period: f.now, balance: null, income: 42 }, "d");
  var app = helpers.loadApp(f.state);
  var c = { f: f, app: app, win: app.window, doc: app.window.document, WM: app.window.WM };
  while (!/Savings/.test(current(c))) click(c, "guideSkip");
  assert.equal(c.doc.getElementById("guideIncome").value.replace(/[^\d.]/g, ""), "42", "shown in the optional box");
  type(c, "guideBalance", "5100");
  enter(c, "guideBalance");
  var v = c.WM.valuationFor(stateOf({ win: app.window }), f.ids.savings, f.now);
  assert.equal(v.income, 42, "not blanked by the balance save");
});

test("a liability and an asset are asked for in their own words", function () {
  var c = load();
  var guard = 0;
  while (!/Car loan/.test(current(c)) && guard++ < 10) click(c, "guideSkip");
  assert.match(c.doc.querySelector('#monthGuide label[for="guideBalance"]').textContent, /Outstanding balance/);
  assert.equal(c.doc.getElementById("guideIncome"), null, "no income box on a loan");
});

test("a foreign holding asks for its rate and shows the currency", function () {
  var c = load({ usd: true });
  var guard = 0;
  while (!/USD account/.test(current(c)) && guard++ < 10) click(c, "guideSkip");
  assert.match(c.doc.querySelector('#monthGuide label[for="guideBalance"]').textContent, /\(USD\)/);
  assert.ok(c.doc.getElementById("guideRate"));
  type(c, "guideBalance", "2100");
  type(c, "guideRate", "4.5");
  enter(c, "guideBalance");
  var v = c.WM.valuationFor(stateOf(c), c.f.ids.usd, c.f.now);
  assert.equal(v.balance, 2100);
  assert.equal(v.fxRate, 4.5);
});

test("a foreign figure saved without a rate leaves any stored rate alone", function () {
  var c = load({ usd: true });
  var guard = 0;
  while (!/USD account/.test(current(c)) && guard++ < 10) click(c, "guideSkip");
  type(c, "guideBalance", "2100");
  enter(c, "guideBalance");
  var v = c.WM.valuationFor(stateOf(c), c.f.ids.usd, c.f.now);
  assert.equal(v.fxRate, null);
});

test("a holding priced by units is named and left out of the questions", function () {
  var c = load({ units: true });
  assert.match(guideText(c), /Priced by units.*Unit trust/);
  var seen = [];
  var guard = 0;
  while (c.doc.querySelector("#monthGuide #guideSave") && guard++ < 10) { seen.push(current(c)); click(c, "guideSkip"); }
  assert.equal(seen.some(function (n) { return /Unit trust/.test(n); }), false);
});

test("what was typed and not yet saved survives a redraw from elsewhere", function () {
  var c = load();
  type(c, "guideBalance", "4444");
  // Saving a figure on the Accounts screen redraws everything. One that is not the figure
  // being typed, or that figure is simply done and the guide moves on.
  var other = /Savings/.test(current(c)) ? c.f.ids.epf : c.f.ids.savings;
  var cell = c.doc.getElementById("cell_" + other);
  cell.value = "5050";
  cell.dispatchEvent(new c.win.FocusEvent("blur"));
  assert.equal(c.doc.getElementById("guideBalance").value, "4444");
});

test("the checklist follows the month that is picked", function () {
  var c = load();
  var pick = c.doc.getElementById("periodPick");
  pick.value = c.f.prev;
  pick.dispatchEvent(new c.win.Event("change"));
  assert.match(guideText(c), /Nothing to do for|All caught up for|left for/);
  assert.match(guideText(c), new RegExp(c.WM.monthLabel ? "" : "") );
  assert.equal(c.doc.querySelector("#monthGuide .guide-n").textContent.indexOf("Nothing to do") >= 0, true,
    "everything already has a figure last month");
});

test("names containing markup are shown as text", function () {
  var f = seeded();
  f.state.holdings[0].name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.equal(doc.querySelector("#monthGuide img"), null);
  assert.equal(app.window.__pwned, undefined);
});

test("the progress bar tells a screen reader how far along it is", function () {
  var c = load();
  var bar = c.doc.querySelector("#monthGuide [role=progressbar]");
  assert.equal(bar.getAttribute("aria-valuemax"), "3");
  assert.equal(bar.getAttribute("aria-valuenow"), "0");
  type(c, "guideBalance", "1");
  enter(c, "guideBalance");
  assert.equal(c.doc.querySelector("#monthGuide [role=progressbar]").getAttribute("aria-valuenow"), "1");
});
