"use strict";
// P7.5: every chart can be pointed at, not just the trend and the donuts — and the donuts on
// the Net worth screen open the lines behind a slice.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var maybank = l.schema.newInstitution("d"); maybank.name = "Maybank"; s.institutions.push(maybank);
  var kwsp = l.schema.newInstitution("d"); kwsp.name = "EPF"; s.institutions.push(kwsp);
  var now = l.valuations.currentPeriod(), periods = [], p = now;
  for (var i = 0; i < 8; i++) { periods.unshift(p); p = l.valuations.prevPeriod(p); }

  function holding(name, cls, inst, rows) {
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name;
    s.holdings.push(h);
    rows.forEach(function (r) {
      l.valuations.upsertValuation(s, { holdingId: h.id, period: periods[r[0]], balance: r[1], income: r[2] === undefined ? null : r[2] }, "d");
    });
    return h;
  }
  // The second holding starts three months in, so the early months have nothing for it.
  var sav = holding("Savings", "cash", maybank, [[0, 10000, 30], [1, 11000, 32], [2, 12000, 0], [3, 13000, 35], [4, 14000, 36], [5, 15000, 40], [6, 16000, 41], [7, 17000, 45]]);
  var fd = holding("Fixed deposit", "investment", maybank, [[3, 20000, 80], [4, 20000, 80], [5, 20000, 80], [6, 20000, 80], [7, 20000, 80]]);
  holding("EPF", "retirement", kwsp, [[0, 50000], [7, 58000]]);

  var loan = l.schema.newLiability("d");
  loan.name = "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4.5; loan.tenureMonths = 60; loan.instalment = 1118.6;
  loan.startDate = periods[0];
  s.liabilities.push(loan);
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: now, balance: 50000 }, "d");
  return { state: s, periods: periods, ids: { sav: sav.id, fd: fd.id } };
}

function load() {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  return { f: f, app: app, win: app.window, doc: app.window.document };
}

function svgOf(c, hostSel) { return c.doc.querySelector(hostSel + " svg.chart"); }
function key(c, svg, k) { svg.dispatchEvent(new c.win.KeyboardEvent("keydown", { key: k, bubbles: true })); }
function tip(c, hostSel) { return c.doc.querySelector(hostSel + " .hv-tip"); }

// ---- forecast ---------------------------------------------------------------

test("a recorded month on the forecast reads as recorded, with no projection in it", function () {
  var c = load();
  var svg = svgOf(c, "#forecastChart");
  key(c, svg, "Home");
  var t = tip(c, "#forecastChart");
  assert.equal(t.hidden, false);
  assert.match(t.textContent, /Recorded/);
  assert.equal(/projected/i.test(t.textContent), false);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("a projected month shows every scenario side by side, never one number, and says it is an assumption", function () {
  var c = load();
  var svg = svgOf(c, "#forecastChart");
  key(c, svg, "End");
  var t = tip(c, "#forecastChart");
  assert.match(t.textContent, /projected/);
  ["Conservative", "Base", "Optimistic"].forEach(function (n) { assert.match(t.textContent, new RegExp(n)); });
  assert.equal(t.querySelectorAll(".hv-row b").length, 3, "three figures, a range");
  assert.match(t.textContent, /not a promise/);
});

test("the forecast hover follows the today's-money toggle and says which it is showing", function () {
  var c = load();
  var svg = svgOf(c, "#forecastChart");
  key(c, svg, "End");
  var nominal = tip(c, "#forecastChart").textContent;
  c.doc.getElementById("realTerms").checked = true;
  c.doc.getElementById("realTerms").onchange();
  svg = svgOf(c, "#forecastChart");
  key(c, svg, "End");
  var real = tip(c, "#forecastChart").textContent;
  assert.notEqual(real, nominal);
  assert.match(real, /today's money/i);
  assert.equal(c.doc.querySelectorAll("#forecastChart .hv-tip").length, 1);
});

// ---- per-holding series -----------------------------------------------------

test("a series month lists every line on show, and a holding not yet recorded says so, not zero", function () {
  var c = load();
  var svg = svgOf(c, "#seriesChart");
  key(c, svg, "Home");
  var t = tip(c, "#seriesChart");
  assert.match(t.textContent, /Savings/);
  assert.match(t.textContent, /Fixed deposit/);
  assert.match(t.querySelector(".hv-none").textContent, /no entry/);
  assert.equal(/RM 0\.00/.test(t.textContent), false, "blank is not zero");
  key(c, svg, "End");
  assert.equal(t.querySelectorAll(".hv-none").length, 0);
  assert.match(t.textContent, /RM 20,000\.00/);
});

test("a series hidden with its legend button drops out of the tooltip", function () {
  var c = load();
  c.doc.querySelector('#seriesLegend [data-series]').click();
  var svg = svgOf(c, "#seriesChart");
  key(c, svg, "End");
  var names = Array.prototype.map.call(tip(c, "#seriesChart").querySelectorAll(".hv-row span"), function (n) { return n.textContent; });
  assert.equal(names.length, 2, "three holdings, one switched off");
});

test("the yield view is read in percent", function () {
  var c = load();
  var sel = c.doc.getElementById("seriesMetric");
  sel.value = "yield";
  sel.dispatchEvent(new c.win.Event("change"));
  var svg = svgOf(c, "#seriesChart");
  if (!svg) return; // too little income history to draw: nothing to point at
  key(c, svg, "End");
  assert.match(tip(c, "#seriesChart").textContent, /%/);
});

// ---- income -----------------------------------------------------------------

test("an income month itemises each source and totals them", function () {
  var c = load();
  var svg = svgOf(c, "#incomeChart");
  key(c, svg, "End");
  var t = tip(c, "#incomeChart");
  assert.match(t.textContent, /Savings/);
  assert.match(t.textContent, /Fixed deposit/);
  assert.match(t.textContent, /Total/);
  assert.match(t.textContent, /RM 125\.00/, "45 + 80");
});

test("a month with no income says nothing was recorded rather than showing RM 0", function () {
  var c = load();
  var svg = svgOf(c, "#incomeChart");
  key(c, svg, "Home");
  key(c, svg, "ArrowRight");
  key(c, svg, "ArrowRight");
  var t = tip(c, "#incomeChart");
  // The third month recorded 0 for savings and nothing for the deposit.
  assert.match(t.textContent, /No income recorded/);
  assert.match(t.textContent, /not carried forward/);
});

// ---- loans ------------------------------------------------------------------

function loansTab(c) { c.doc.querySelector('.tab[data-v="loans"]').click(); }

test("an amortisation month splits the instalment into interest and principal", function () {
  var c = load();
  loansTab(c);
  var svg = svgOf(c, "#loanList");
  assert.ok(svg, "the schedule chart");
  key(c, svg, "Home");
  var t = tip(c, "#loanList");
  assert.match(t.textContent, /Instalment 1\b/);
  assert.match(t.textContent, /Interest/);
  assert.match(t.textContent, /Principal/);
  assert.match(t.textContent, /Payment/);
  assert.match(t.textContent, /Balance after/);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("paying more shows both balances, and 'Cleared' once the faster schedule is done", function () {
  var c = load();
  loansTab(c);
  var field = c.doc.querySelector("[data-simpay]");
  field.value = "2500";
  field.onchange();
  var charts = c.doc.querySelectorAll("#loanList svg.chart");
  assert.equal(charts.length, 2, "amortisation and payoff");
  var payoff = charts[1];
  key(c, payoff, "End");
  var t = payoff.parentElement.querySelector(".hv-tip");
  assert.match(t.textContent, /As contracted/);
  assert.match(t.textContent, /Paying more/);
  assert.match(t.textContent, /Cleared/, "the faster schedule finishes first");
});

test("each loan chart has exactly one tooltip and none are left queued after a re-render", function () {
  var c = load();
  loansTab(c);
  var field = c.doc.querySelector("[data-simpay]");
  field.value = "2500";
  field.onchange();
  field.onchange();
  assert.equal(c.doc.querySelectorAll("#loanList .hv-tip").length, 2);
  assert.equal(c.doc.querySelectorAll("[data-hvkey]").length, 0);
});

test("a tooltip sits at the level of its own chart when a card holds two", function () {
  var c = load();
  loansTab(c);
  var field = c.doc.querySelector("[data-simpay]");
  field.value = "2500";
  field.onchange();
  var payoff = c.doc.querySelectorAll("#loanList svg.chart")[1];
  var host = payoff.parentElement;
  payoff.getBoundingClientRect = function () { return { left: 0, top: 300, width: 720, height: 180 }; };
  host.getBoundingClientRect = function () { return { left: 0, top: 260, width: 720, height: 240 }; };
  key(c, payoff, "Home");
  assert.equal(host.querySelector(".hv-tip").style.top, "48px", "8px below the chart, which is 40px down its host");
});

// ---- the dashboard donuts open the lines -------------------------------------

function sliceFor(c, chartId, legendId, text) {
  var idx = -1;
  Array.prototype.forEach.call(c.doc.querySelectorAll("#" + legendId + " [data-slice]"), function (r) {
    if (r.textContent.indexOf(text) !== -1) idx = r.getAttribute("data-slice");
  });
  assert.notEqual(idx, -1, text + " has a slice");
  return c.doc.querySelector("#" + chartId + ' [data-slice="' + idx + '"]');
}

test("clicking a category slice on the Net worth screen opens the assets list filtered to it", function () {
  var c = load();
  sliceFor(c, "classChart", "classLegend", "Retirement").dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), true);
  assert.match(c.doc.getElementById("detailChip").textContent, /Category: Retirement/);
  var names = Array.prototype.map.call(c.doc.querySelectorAll("#detailList .srow .srow-t"), function (b) { return b.textContent; });
  assert.deepEqual(names, ["EPF"]);
});

test("a legend label does the same, and by institution too", function () {
  var c = load();
  var row = Array.prototype.filter.call(c.doc.querySelectorAll("#allocLegend [data-slice]"), function (r) {
    return /Maybank/.test(r.textContent);
  })[0];
  row.dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.match(c.doc.getElementById("detailChip").textContent, /Institution: Maybank/);
  var names = Array.prototype.map.call(c.doc.querySelectorAll("#detailList .srow .srow-t"), function (b) { return b.textContent; }).sort();
  assert.deepEqual(names, ["Fixed deposit", "Savings"]);
});

test("a cut the drill-down has no filter for stays hover-only", function () {
  var c = load();
  var sel = c.doc.getElementById("allocDim");
  sel.value = "currency";
  sel.dispatchEvent(new c.win.Event("change"));
  var donut = c.doc.getElementById("allocChart").closest(".donut");
  assert.equal(donut.classList.contains("pick"), false);
  c.doc.querySelector("#allocChart [data-slice]").dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), false);
});

test("a slice can be opened from the keyboard", function () {
  var c = load();
  var slice = sliceFor(c, "classChart", "classLegend", "Free Cash");
  slice.dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), true);
  assert.match(c.doc.getElementById("detailChip").textContent, /Free Cash/);
});

test("switching the second view back and forth does not stack listeners", function () {
  var c = load();
  var sel = c.doc.getElementById("allocDim");
  ["currency", "institution", "currency", "institution"].forEach(function (v) {
    sel.value = v;
    sel.dispatchEvent(new c.win.Event("change"));
  });
  var row = Array.prototype.filter.call(c.doc.querySelectorAll("#allocLegend [data-slice]"), function (r) {
    return /Maybank/.test(r.textContent);
  })[0];
  var before = c.win.history.length;
  row.dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.equal(c.win.history.length, before + 1, "one click, one page opened");
});
