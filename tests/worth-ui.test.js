"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
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

  var liab = null;
  if (opts.withLiability) {
    liab = l.schema.newLiability("dev-1");
    liab.name = "Car loan";
    liab.type = "hire purchase";
    s.liabilities.push(liab);
  }
  return { l: l, state: s, inst: inst, acct: acct, h: h, liab: liab };
}

function record(f, subjectId, period, balance, isLiability) {
  var entry = { period: period, balance: balance };
  if (isLiability) entry.liabilityId = subjectId; else entry.holdingId = subjectId;
  f.l.valuations.upsertValuation(f.state, entry, "dev-1");
}

// Anchor to the current month, since the view reports through today.
function thisMonth(f) { return f.l.valuations.currentPeriod(); }
function monthsAgo(f, n) {
  var p = thisMonth(f);
  for (var i = 0; i < n; i++) p = f.l.valuations.prevPeriod(p);
  return p;
}

test("with no figures the view invites a first entry instead of showing RM 0", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  assert.match(doc.getElementById("worthLines").textContent, /No figures yet/);
  assert.equal(doc.getElementById("worthKpis").innerHTML, "");
  assert.deepEqual(app.consoleErrors, []);
});

test("net worth shows assets minus liabilities with the liquid split", function () {
  var f = seeded({ withLiability: true });
  record(f, f.h.id, thisMonth(f), 50000);
  record(f, f.liab.id, thisMonth(f), 30000, true);

  var app = helpers.loadApp(f.state);
  var kpis = app.window.document.getElementById("worthKpis").textContent;
  assert.match(kpis, /RM 20,000/, "net worth");
  assert.match(kpis, /RM 50,000/, "assets");
  assert.match(kpis, /RM 30,000/, "liabilities");
});

test("a carried-forward figure is marked with an asterisk and explained in words", function () {
  var f = seeded();
  record(f, f.h.id, monthsAgo(f, 2), 50000);

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.match(doc.getElementById("worthKpis").innerHTML, /stale-mark/,
    "the headline figure carries the marker");
  assert.notEqual(doc.getElementById("staleWrap").style.display, "none");

  var note = doc.getElementById("staleNote").textContent;
  assert.match(note, /Carried forward/);
  assert.match(note, /KDI Save/, "must name what is stale");
  // NFR-9: colour is never the sole signal — the state is stated in words too.
  assert.match(note, /1 of 1 figures have not been updated/);
});

test("a fully up-to-date month shows no staleness warning", function () {
  var f = seeded();
  record(f, f.h.id, thisMonth(f), 50000);
  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("staleWrap").style.display, "none");
  assert.equal(/stale-mark/.test(doc.getElementById("worthKpis").innerHTML), false);
});

test("the breakdown lists each line and its subtotals reconcile to the net figure", function () {
  var f = seeded({ withLiability: true });
  record(f, f.h.id, thisMonth(f), 50000);
  record(f, f.liab.id, thisMonth(f), 30000, true);

  var text = helpers.loadApp(f.state).window.document.getElementById("worthLines").textContent;
  assert.match(text, /KDI Save/);
  assert.match(text, /Car loan/);
  assert.match(text, /Assets.*RM 50,000/);
  assert.match(text, /Liabilities.*−RM 30,000/);
  assert.match(text, /Net worth.*RM 20,000/);
});

test("a stale line says which month its figure came from", function () {
  var f = seeded();
  record(f, f.h.id, monthsAgo(f, 3), 50000);
  var text = helpers.loadApp(f.state).window.document.getElementById("worthLines").textContent;
  assert.match(text, /carried from/);
});

test("the trend needs two months before it draws", function () {
  var f = seeded();
  record(f, f.h.id, thisMonth(f), 50000);
  var doc = helpers.loadApp(f.state).window.document;
  assert.match(doc.getElementById("worthChart").textContent, /at least two months/);
});

test("the trend renders as inline SVG with a point per month", function () {
  var f = seeded();
  record(f, f.h.id, monthsAgo(f, 2), 40000);
  record(f, f.h.id, monthsAgo(f, 1), 45000);
  record(f, f.h.id, thisMonth(f), 50000);

  var doc = helpers.loadApp(f.state).window.document;
  var svg = doc.querySelector("#worthChart svg");
  assert.ok(svg, "chart must be inline SVG, not a library canvas");
  assert.equal(svg.getAttribute("role"), "img");
  assert.ok(doc.querySelectorAll("#worthChart circle").length >= 3);
});

test("a carried-forward month is drawn hollow so estimates are visible on the chart", function () {
  var f = seeded();
  record(f, f.h.id, monthsAgo(f, 2), 40000);
  record(f, f.h.id, thisMonth(f), 50000);

  var doc = helpers.loadApp(f.state).window.document;
  var hollow = Array.prototype.filter.call(doc.querySelectorAll("#worthChart circle"), function (c) {
    return c.getAttribute("stroke") === "var(--warn)";
  });
  assert.ok(hollow.length >= 1, "the interpolated month must look different from a recorded one");
});

test("month-on-month change is reported with direction", function () {
  var f = seeded();
  record(f, f.h.id, monthsAgo(f, 1), 10000);
  record(f, f.h.id, thisMonth(f), 11000);
  var kpis = helpers.loadApp(f.state).window.document.getElementById("worthKpis").textContent;
  assert.match(kpis, /▲/);
  assert.match(kpis, /RM 1,000/);
});

test("liabilities appear on the month screen with an outstanding balance field only", function () {
  var f = seeded({ withLiability: true });
  var doc = helpers.loadApp(f.state).window.document;

  assert.ok(doc.getElementById("m_" + f.liab.id + "_balance"), "liability takes a balance");
  assert.equal(doc.getElementById("m_" + f.liab.id + "_income"), null,
    "income makes no sense for a debt");
  assert.ok(doc.getElementById("m_" + f.h.id + "_income"), "holdings still take all four");
});

test("saving a liability balance from the month screen feeds net worth", function () {
  var f = seeded({ withLiability: true });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var period = f.l.valuations.currentPeriod();
  doc.getElementById("periodPick").value = period;
  doc.getElementById("periodPick").onchange();

  doc.getElementById("m_" + f.h.id + "_balance").value = "50000";
  doc.getElementById("m_" + f.liab.id + "_balance").value = "30000";
  doc.getElementById("saveMonthBtn").click();

  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  var liabVal = saved.valuations.filter(function (v) { return v.liabilityId === f.liab.id; })[0];
  assert.ok(liabVal, "the liability entry is stored against liabilityId");
  assert.equal(liabVal.holdingId, null);
  assert.equal(liabVal.balance, 30000);
  assert.match(doc.getElementById("worthKpis").textContent, /RM 20,000/);
});

test("adding a liability through the form persists its terms for P2", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.getElementById("addLiabBtn").click();
  doc.getElementById("l_name").value = "Car loan";
  doc.getElementById("l_type").value = "hire purchase";
  doc.getElementById("l_basis").value = "flat";
  doc.getElementById("l_principal").value = "RM 90,000";
  doc.getElementById("l_rate").value = "3.4";
  doc.getElementById("l_tenure").value = "84";
  doc.getElementById("liabSave").click();

  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.liabilities.length, 1);
  var l = saved.liabilities[0];
  assert.equal(l.name, "Car loan");
  assert.equal(l.rateBasis, "flat", "flat rate must be preserved distinctly from reducing");
  assert.equal(l.principal, 90000, "a formatted principal parses");
  assert.equal(l.tenureMonths, 84);
});

test("a liability with recorded balances cannot be deleted outright", function () {
  var f = seeded({ withLiability: true });
  record(f, f.liab.id, thisMonth(f), 30000, true);
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-liab="' + f.liab.id + '"]').click();
  doc.getElementById("liabDelete").click();

  assert.ok(doc.getElementById("liabErr").classList.contains("on"));
  assert.match(doc.getElementById("liabErr").textContent, /1 valuation still belongs/);
  var saved = JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
  assert.equal(saved.liabilities[0].deleted, false);
});

test("SEC-7: a liability name containing HTML is escaped in the net worth breakdown", function () {
  var f = seeded({ withLiability: true });
  f.liab.name = '<img src=x onerror="window.__pwned=1">';
  record(f, f.liab.id, thisMonth(f), 1000, true);

  var app = helpers.loadApp(f.state);
  assert.equal(app.window.__pwned, undefined);
  assert.equal(app.window.document.querySelectorAll("#worthLines img").length, 0);
});
