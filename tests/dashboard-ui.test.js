"use strict";
// P5.3: the Net worth dashboard — cards, the trend with its bands, and two donuts.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, cls, liquid) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls;
    a.liquid = liquid !== false;
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}

// A portfolio with something in every category, and a debt.
function portfolio(months) {
  var f = seeded();
  var cash = f.holding("Savings", "cash");
  var asb = f.holding("ASB", "investment");
  var epf = f.holding("EPF", "retirement", false);
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  home.liquid = false;
  f.state.assets.push(home);
  var car = f.l.schema.newLiability("dev-1");
  car.name = "Car loan";
  car.type = "hire purchase";
  f.state.liabilities.push(car);

  for (var i = (months || 3) - 1; i >= 0; i--) {
    var p = period(f, i);
    record(f, { holdingId: cash.id, period: p, balance: 20000 });
    record(f, { holdingId: asb.id, period: p, balance: 60000 });
    record(f, { holdingId: epf.id, period: p, balance: 90000 });
    record(f, { assetId: home.id, period: p, balance: 400000 });
    record(f, { liabilityId: car.id, period: p, balance: 30000 - i * 1000 });
  }
  return f;
}

test("the leading card carries net worth and investable assets", function () {
  var doc = helpers.loadApp(portfolio().state).window.document;
  var primary = doc.querySelector("#worthKpis .kpi.primary");
  assert.ok(primary, "the total leads the grid");
  assert.match(primary.textContent, /Net worth/);
  assert.match(primary.textContent, /RM 540,000/, "570,000 assets less 30,000 owed");
  assert.match(primary.textContent, /Investable assets/);
  // Free cash 20,000 + investments 60,000. The house and EPF are not investable.
  assert.match(primary.textContent, /RM 80,000/);
  assert.equal(/RM 490,000/.test(primary.textContent), false, "the house is not investable");
});

test("the cards still report assets, liabilities and the liquid split", function () {
  var kpis = helpers.loadApp(portfolio().state).window.document.getElementById("worthKpis").textContent;
  assert.match(kpis, /Assets/);
  assert.match(kpis, /RM 570,000/);
  assert.match(kpis, /Liabilities/);
  assert.match(kpis, /RM 30,000/);
  assert.match(kpis, /Liquid/);
});

test("the trend draws assets and liabilities as bands around the net worth line", function () {
  var doc = helpers.loadApp(portfolio(4).state).window.document;
  var paths = doc.querySelectorAll("#worthChart svg path");
  assert.ok(paths.length >= 3, "two bands and the line");
  var fills = Array.prototype.map.call(paths, function (p) { return p.getAttribute("fill"); });
  assert.ok(fills.indexOf("var(--accent-tint)") > -1, "assets band");
  assert.ok(fills.indexOf("var(--bad-tint)") > -1, "liabilities band");

  var legend = doc.querySelector("#worthChart .legend").textContent;
  ["Net worth", "Assets", "Liabilities"].forEach(function (label) {
    assert.match(legend, new RegExp(label), label + " is named, not just coloured");
  });
});

test("the carried-forward key appears only when a month rests on old figures", function () {
  var fresh = helpers.loadApp(portfolio(4).state).window.document;
  assert.equal(/Carried forward/.test(fresh.querySelector("#worthChart .legend").textContent), false);

  var f = seeded();
  var h = f.holding("Savings", "cash");
  record(f, { holdingId: h.id, period: period(f, 3), balance: 10000 });
  record(f, { holdingId: h.id, period: period(f, 2), balance: 11000 });
  // Nothing since, so the last months are carried.
  var stale = helpers.loadApp(f.state).window.document;
  assert.match(stale.querySelector("#worthChart .legend").textContent, /Carried forward/);
});

test("two donuts: the categories, and the dimension chosen beside them", function () {
  var app = helpers.loadApp(portfolio().state);
  var doc = app.window.document;

  var byCategory = doc.getElementById("classLegend").textContent;
  ["Free Cash", "Investments", "Retirement", "Use assets"].forEach(function (label) {
    assert.match(byCategory, new RegExp(label));
  });
  // 400,000 of 570,000 assets.
  assert.match(byCategory, /70\.2%/);
  assert.ok(doc.querySelector("#classChart svg"), "it is drawn, not only listed");

  assert.ok(doc.querySelector("#allocChart svg"), "the second donut still renders");
  assert.match(doc.getElementById("allocTitle").textContent, /^By /);
  assert.deepEqual(app.consoleErrors, []);
});

test("the second donut follows the dimension picker", function () {
  var app = helpers.loadApp(portfolio().state);
  var doc = app.window.document;
  var sel = doc.getElementById("allocDim");
  sel.value = "institution";
  sel.dispatchEvent(new app.window.Event("change"));

  assert.match(doc.getElementById("allocTitle").textContent.toLowerCase(), /institution/);
  assert.match(doc.getElementById("allocLegend").textContent, /Maybank/);
  // The category donut is fixed, so it does not follow the picker.
  assert.match(doc.getElementById("classLegend").textContent, /Free Cash/);
});

test("with nothing recorded both donuts say so rather than drawing an empty ring", function () {
  var doc = helpers.loadApp().window.document;
  assert.match(doc.getElementById("classChart").textContent, /Nothing recorded to allocate/);
  assert.match(doc.getElementById("allocChart").textContent, /Nothing recorded to allocate/);
});

test("the category donut agrees with the strip above it", function () {
  var app = helpers.loadApp(portfolio().state);
  var doc = app.window.document;
  var strip = doc.getElementById("catStrip").textContent;
  var donut = doc.getElementById("classLegend").textContent;
  ["RM 20,000", "RM 60,000", "RM 90,000", "RM 400,000"].forEach(function (figure) {
    assert.match(strip, new RegExp(figure.replace(/,/g, ",")), figure + " in the strip");
    assert.match(donut, new RegExp(figure.replace(/,/g, ",")), figure + " in the donut");
  });
});
