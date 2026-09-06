"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-6.3, FR-6.4 and FR-6.8. All three were recorded as shipped under P1.12 and were
// never written, which a green analytics suite could not have caught — so every
// assertion here is on rendered DOM.

function lib() { return helpers.loadLib(helpers.freshWindow()); }

// Periods run backwards from the current month so carry-forward and the rolling window
// behave as they will in use.
function backFrom(l, count) {
  var p = l.valuations.currentPeriod();
  var out = [p];
  for (var i = 1; i < count; i++) {
    p = l.valuations.prevPeriod(p);
    out.unshift(p);
  }
  return out;
}

function seeded(spec) {
  var l = lib();
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Principal";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Unit trust";
  acct.class = "investment";
  s.accounts.push(acct);

  var holdings = {};
  Object.keys(spec.holdings || {}).forEach(function (name) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = name;
    s.holdings.push(h);
    holdings[name] = h;
  });

  (spec.entries || []).forEach(function (e) {
    l.valuations.upsertValuation(s, {
      holdingId: holdings[e.holding].id,
      period: e.period,
      balance: e.balance,
      income: e.income
    }, "dev-1");
  });

  return { l: l, state: s, holdings: holdings, acct: acct };
}

function accountsTab(doc) { doc.querySelector('.tab[data-v="accounts"]').click(); }

// --- balance over time, FR-6.3 ----------------------------------------------

test("a line is drawn per holding, with a legend entry each", function () {
  var l = lib();
  var ps = backFrom(l, 4);
  var f = seeded({
    holdings: { "Equity fund": 1, "Sukuk fund": 1 },
    entries: ps.map(function (p, i) { return { holding: "Equity fund", period: p, balance: 10000 + i * 500 }; })
      .concat(ps.map(function (p, i) { return { holding: "Sukuk fund", period: p, balance: 4000 + i * 100 }; }))
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  assert.equal(doc.getElementById("seriesWrap").style.display, "");
  assert.equal(doc.querySelectorAll("#seriesChart path").length, 2, "one path per holding");
  assert.equal(doc.querySelectorAll("#seriesLegend .lgt").length, 2);
  assert.match(doc.getElementById("seriesLegend").textContent, /Equity fund/);
  assert.match(doc.getElementById("seriesLegend").textContent, /Sukuk fund/);
  assert.deepEqual(app.consoleErrors, []);
});

test("clicking a legend entry switches its series off and back on", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "Equity fund": 1, "Sukuk fund": 1 },
    entries: ps.map(function (p) { return { holding: "Equity fund", period: p, balance: 10000 }; })
      .concat(ps.map(function (p) { return { holding: "Sukuk fund", period: p, balance: 4000 }; }))
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var first = doc.querySelector("#seriesLegend .lgt");
  assert.equal(first.getAttribute("aria-pressed"), "true");
  first.click();

  assert.equal(doc.querySelector("#seriesLegend .lgt").getAttribute("aria-pressed"), "false");
  assert.equal(doc.querySelectorAll("#seriesChart path").length, 1, "the hidden line is gone");
  // Still listed, so the reader can see what is available to bring back.
  assert.equal(doc.querySelectorAll("#seriesLegend .lgt").length, 2);

  doc.querySelector("#seriesLegend .lgt").click();
  assert.equal(doc.querySelectorAll("#seriesChart path").length, 2);
});

test("switching every series off says so instead of drawing an empty grid", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "Equity fund": 1 },
    entries: ps.map(function (p) { return { holding: "Equity fund", period: p, balance: 10000 }; })
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  doc.querySelector("#seriesLegend .lgt").click();
  assert.match(doc.getElementById("seriesChart").textContent, /Every series is switched off/);
});

test("toggling a series writes nothing to the store", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "Equity fund": 1 },
    entries: ps.map(function (p) { return { holding: "Equity fund", period: p, balance: 10000 }; })
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);
  var before = app.window.localStorage.getItem("wealthmaster.state");

  doc.querySelector("#seriesLegend .lgt").click();

  // Which lines are showing is a view decision, not a fact about the portfolio — it must
  // not reach the store, the export, or another device.
  assert.equal(app.window.localStorage.getItem("wealthmaster.state"), before);
});

test("a carried-forward month is marked hollow on the line", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "Equity fund": 1, "Sukuk fund": 1 },
    entries: [
      { holding: "Equity fund", period: ps[0], balance: 10000 },
      { holding: "Sukuk fund", period: ps[1], balance: 4000 },
      { holding: "Sukuk fund", period: ps[2], balance: 4200 }
    ]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var hollow = doc.querySelectorAll('#seriesChart circle[stroke="var(--warn)"]');
  assert.ok(hollow.length >= 1, "months carried forward are drawn as estimates, not entries");
});

test("the section hides itself when nothing has been recorded", function () {
  var f = seeded({ holdings: { "Equity fund": 1 } });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);
  assert.equal(doc.getElementById("seriesWrap").style.display, "none");
});

// --- rolling realised yield, FR-6.8 -----------------------------------------

test("the metric switch redraws the same chart as rolling yield", function () {
  var l = lib();
  var ps = backFrom(l, 4);
  var f = seeded({
    holdings: { "Income fund": 1 },
    entries: ps.map(function (p) { return { holding: "Income fund", period: p, balance: 12000, income: 40 }; })
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);
  assert.match(doc.getElementById("seriesNote").textContent, /Closing balance per holding/);

  doc.getElementById("seriesMetric").value = "yield";
  doc.getElementById("seriesMetric").onchange();

  assert.match(doc.getElementById("seriesNote").textContent, /annualised/);
  // RM 40 a month on RM 12,000 is 4.00% a year.
  assert.match(doc.getElementById("seriesLegend").textContent, /4\.00%/);
  assert.match(doc.getElementById("seriesChart").innerHTML, /%<\/text>/,
    "the axis is labelled in percent, not ringgit");
  assert.deepEqual(app.consoleErrors, []);
});

test("a holding without enough months of income stays out of the yield chart", function () {
  var l = lib();
  var ps = backFrom(l, 4);
  var f = seeded({
    holdings: { "Income fund": 1, "Growth fund": 1 },
    entries: ps.map(function (p) { return { holding: "Income fund", period: p, balance: 12000, income: 40 }; })
      .concat(ps.map(function (p) { return { holding: "Growth fund", period: p, balance: 8000 }; }))
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);
  doc.getElementById("seriesMetric").value = "yield";
  doc.getElementById("seriesMetric").onchange();

  var text = doc.getElementById("seriesLegend").textContent;
  assert.match(text, /Income fund/);
  assert.equal(/Growth fund/.test(text), false,
    "a yield from too few months is a wrong claim, not a smaller one");
});

// --- income by source, FR-6.4 -----------------------------------------------

test("income stacks one band per paying holding, with monthly bars", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "Equity fund": 1, "Sukuk fund": 1 },
    entries: [
      { holding: "Equity fund", period: ps[0], balance: 10000, income: 300 },
      { holding: "Sukuk fund", period: ps[0], balance: 5000, income: 100 },
      { holding: "Equity fund", period: ps[1], balance: 10200, income: 250 },
      { holding: "Equity fund", period: ps[2], balance: 10400, income: 275 }
    ]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(doc.getElementById("incomeWrap").style.display, "");
  // Four bands drawn in total: two in the first month, one in each of the others.
  assert.equal(doc.querySelectorAll("#incomeChart rect").length, 4);
  assert.equal(doc.querySelectorAll("#incomeLegend .lg").length, 2);
  assert.match(doc.getElementById("incomeLegend").textContent, /Equity fund/);
  assert.match(doc.getElementById("incomeLegend").textContent, /RM 825\.00/);
  assert.match(doc.getElementById("incomeLegend").textContent, /RM 100\.00/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a holding that never paid income gets no band and no legend entry", function () {
  var l = lib();
  var ps = backFrom(l, 2);
  var f = seeded({
    holdings: { "Equity fund": 1, "Growth fund": 1 },
    entries: [
      { holding: "Equity fund", period: ps[0], balance: 10000, income: 300 },
      { holding: "Growth fund", period: ps[0], balance: 8000 }
    ]
  });
  var doc = helpers.loadApp(f.state).window.document;

  assert.equal(doc.querySelectorAll("#incomeLegend .lg").length, 1);
  assert.equal(/Growth fund/.test(doc.getElementById("incomeLegend").textContent), false);
});

test("a portfolio that has never paid income hides the chart entirely", function () {
  var l = lib();
  var ps = backFrom(l, 2);
  var f = seeded({
    holdings: { "Growth fund": 1 },
    entries: ps.map(function (p) { return { holding: "Growth fund", period: p, balance: 8000 }; })
  });
  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("incomeWrap").style.display, "none");
});

test("SEC-7: a script-like holding name cannot execute from either chart's legend", function () {
  var l = lib();
  var ps = backFrom(l, 3);
  var f = seeded({
    holdings: { "x": 1 },
    entries: ps.map(function (p) { return { holding: "x", period: p, balance: 10000, income: 100 }; })
  });
  f.state.holdings[0].name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  assert.equal(doc.querySelector("#seriesLegend img"), null);
  assert.equal(doc.querySelector("#incomeLegend img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("seriesLegend").textContent, /onerror/);
});
