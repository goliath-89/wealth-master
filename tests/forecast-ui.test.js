"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(balance) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Bank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = "investment";
  acct.liquid = true;
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "Fund";
  s.holdings.push(h);
  l.valuations.upsertValuation(s, {
    holdingId: h.id, period: period, balance: balance === undefined ? 100000 : balance
  }, "dev-1");

  return { l: l, state: s, period: period };
}

function forecastTab(doc) { doc.querySelector('.tab[data-v="forecast"]').click(); }
function saved(app) {
  var raw = app.window.localStorage.getItem("wealthmaster.state");
  return raw ? JSON.parse(raw) : { scenarios: [] };
}

test("the forecast opens with three scenarios and no setup required", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  var text = doc.getElementById("assumptions").textContent;
  assert.match(text, /Conservative/);
  assert.match(text, /Base/);
  assert.match(text, /Optimistic/);
  assert.deepEqual(app.consoleErrors, []);
});

test("REGRESSION: default scenarios are not written to the store by rendering", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  forecastTab(app.window.document);

  // Seeding on render stamped three records the owner never created, which the import
  // guard then reported as local changes an incoming file would discard — a false alarm
  // on every cross-device import.
  assert.equal(saved(app).scenarios.length, 0,
    "rendering must not create records");
});

test("editing an assumption is what turns the defaults into stored data", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  doc.querySelector("[data-edit-scenario]").click();
  doc.getElementById("sc_inv").value = "7.5";
  doc.getElementById("scenarioSave").click();

  var s = saved(app);
  assert.equal(s.scenarios.length, 3, "the whole set is persisted together");
  var edited = s.scenarios.filter(function (x) { return x.growthAssumptions.investment === 7.5; });
  assert.equal(edited.length, 1);
});

test("the headline is a range between scenarios, never a single figure", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);

  var kpis = doc.getElementById("forecastKpis").textContent;
  // R3: one confident number reads as a prediction however it is labelled.
  assert.match(kpis, /In 10 years, between/);
  assert.match(kpis, /and RM/);
  assert.match(kpis, /Spread/);
});

test("the tab states plainly that projections are illustrative", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  var view = doc.getElementById("v-forecast").textContent;
  assert.match(view, /Illustrative only/);
  assert.match(view, /not predictions/);
});

test("assumptions are on screen beside every projected figure", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);
  // FR-5.8: a projected number must never appear without its basis.
  var text = doc.getElementById("assumptions").textContent;
  assert.match(text, /Cash 2\.5% · Investments 6% · Retirement 5\.5% · Inflation 2\.5%/);
});

test("the chart shows recorded history continuing into projections", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);

  var svg = doc.querySelector("#forecastChart svg");
  assert.ok(svg);
  assert.match(svg.getAttribute("aria-label"), /recorded to date, continuing into three projected/);
  // Projected lines are dashed so they cannot be read as recorded fact.
  var dashed = Array.prototype.filter.call(svg.querySelectorAll("path"), function (p) {
    return p.getAttribute("stroke-dasharray");
  });
  assert.equal(dashed.length, 3, "one dashed line per scenario");
  assert.match(doc.getElementById("forecastLegend").textContent, /Recorded/);
});

test("changing the horizon rewidens the range", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);

  doc.getElementById("horizon").value = "60";
  doc.getElementById("horizon").onchange();
  assert.match(doc.getElementById("forecastKpis").textContent, /In 5 years/);

  doc.getElementById("horizon").value = "240";
  doc.getElementById("horizon").onchange();
  assert.match(doc.getElementById("forecastKpis").textContent, /In 20 years/);
});

test("today's money toggle restates the figures and says so", function () {
  var f = seeded();
  var doc = helpers.loadApp(f.state).window.document;
  forecastTab(doc);

  var nominal = doc.getElementById("forecastKpis").textContent;
  doc.getElementById("realTerms").checked = true;
  doc.getElementById("realTerms").onchange();
  var real = doc.getElementById("forecastKpis").textContent;

  assert.notEqual(nominal, real);
  assert.match(real, /Today's money/);
});

test("with nothing recorded the forecast asks for a starting point", function () {
  var doc = helpers.loadApp().window.document;
  forecastTab(doc);
  assert.match(doc.getElementById("forecastChart").textContent, /needs somewhere to start from/);
  assert.equal(doc.getElementById("forecastKpis").innerHTML, "");
});

test("a non-numeric contribution is refused", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  forecastTab(doc);

  doc.querySelector("[data-edit-scenario]").click();
  doc.getElementById("sc_contrib").value = "1O00";
  doc.getElementById("scenarioSave").click();
  assert.match(doc.getElementById("scenarioErr").textContent, /must be a number/);
  assert.equal(saved(app).scenarios.length, 0, "nothing persisted on a rejected edit");
});
