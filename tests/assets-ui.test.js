"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// Returns a blank-shaped object when nothing has been written yet, so a test asserting
// "nothing was saved" reads naturally instead of tripping over a null.
function saved(app) {
  var raw = app.window.localStorage.getItem("wealthmaster.state");
  return raw ? JSON.parse(raw) : { assets: [], liabilities: [], valuations: [] };
}

function openAssetsTab(doc) {
  doc.querySelector('.tab[data-v="accounts"]').click();
}

test("adding an asset records its purchase cost at the acquisition month", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_class").value = "property";
  doc.getElementById("s_acquired").value = "2026-01";
  doc.getElementById("s_cost").value = "RM 500,000";
  doc.getElementById("assetSave").click();

  var s = saved(app);
  assert.equal(s.assets.length, 1);
  assert.equal(s.assets[0].cost, 500000, "a formatted cost parses");
  assert.equal(s.assets[0].liquid, false, "property defaults to illiquid");

  var v = s.valuations.filter(function (x) { return x.assetId === s.assets[0].id; });
  assert.equal(v.length, 1, "cost is seeded as a dated valuation");
  assert.equal(v[0].period, "2026-01");
  assert.equal(v[0].balance, 500000);
  assert.deepEqual(app.consoleErrors, []);
});

test("a current value is recorded against this month, not the acquisition month", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_acquired").value = "2026-01";
  doc.getElementById("s_cost").value = "500000";
  doc.getElementById("s_value").value = "560000";
  doc.getElementById("assetSave").click();

  var s = saved(app);
  var vals = s.valuations.filter(function (x) { return x.assetId === s.assets[0].id; });
  var byPeriod = {};
  vals.forEach(function (v) { byPeriod[v.period] = v.balance; });
  assert.equal(byPeriod["2026-01"], 500000, "history keeps the purchase cost");
  var current = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  assert.equal(byPeriod[current], 560000, "the new estimate lands on the current month");
});

test("an asset appears in the net worth breakdown and total", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_acquired").value =
    helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  doc.getElementById("s_cost").value = "500000";
  doc.getElementById("assetSave").click();

  doc.querySelector('.tab[data-v="worth"]').click();
  assert.match(doc.getElementById("worthLines").textContent, /Family home/);
  assert.match(doc.getElementById("worthKpis").textContent, /RM 500,000/);
});

test("equity is shown against a financed asset, naming the loan", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  openAssetsTab(doc);

  doc.getElementById("addLiabBtn").click();
  doc.getElementById("l_name").value = "Mortgage";
  doc.getElementById("l_type").value = "mortgage";
  doc.getElementById("liabSave").click();
  var loanId = saved(app).liabilities[0].id;

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_acquired").value = period;
  doc.getElementById("s_cost").value = "500000";
  doc.getElementById("s_liab").value = loanId;
  doc.getElementById("assetSave").click();

  // Record what is owed via the month screen.
  doc.querySelector('.tab[data-v="month"]').click();
  doc.getElementById("periodPick").value = period;
  doc.getElementById("periodPick").onchange();
  doc.getElementById("m_" + loanId + "_balance").value = "380000";
  doc.getElementById("saveMonthBtn").click();

  openAssetsTab(doc);
  var text = doc.getElementById("assetList").textContent;
  assert.match(text, /Equity RM 120,000/);
  assert.match(text, /Mortgage/);
});

test("net worth counts the asset and loan once, not the equity as well", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  var period = helpers.loadLib(helpers.freshWindow()).valuations.currentPeriod();
  openAssetsTab(doc);

  doc.getElementById("addLiabBtn").click();
  doc.getElementById("l_name").value = "Mortgage";
  doc.getElementById("liabSave").click();
  var loanId = saved(app).liabilities[0].id;

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_acquired").value = period;
  doc.getElementById("s_cost").value = "500000";
  doc.getElementById("s_liab").value = loanId;
  doc.getElementById("assetSave").click();

  doc.querySelector('.tab[data-v="month"]').click();
  doc.getElementById("periodPick").value = period;
  doc.getElementById("periodPick").onchange();
  doc.getElementById("m_" + loanId + "_balance").value = "380000";
  doc.getElementById("saveMonthBtn").click();

  doc.querySelector('.tab[data-v="worth"]').click();
  var kpis = doc.getElementById("worthKpis").textContent;
  assert.match(kpis, /RM 120,000/, "net worth is 500,000 less 380,000");
  assert.equal(/RM 240,000/.test(kpis), false, "equity must not be added a second time");
});

test("saving without a name is refused and writes nothing", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "";
  doc.getElementById("assetSave").click();

  assert.ok(doc.getElementById("assetErr").classList.contains("on"));
  assert.match(doc.getElementById("assetErr").textContent, /Name is required/);
  assert.equal((saved(app).assets || []).length, 0);
});

test("a non-numeric cost is rejected with a reason", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Home";
  doc.getElementById("s_cost").value = "5O0,000";
  doc.getElementById("assetSave").click();

  assert.match(doc.getElementById("assetErr").textContent, /Purchase cost must be a number/);
  assert.equal((saved(app).assets || []).length, 0);
});

test("an asset with recorded values cannot be deleted outright", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = "Family home";
  doc.getElementById("s_acquired").value = "2026-01";
  doc.getElementById("s_cost").value = "500000";
  doc.getElementById("assetSave").click();

  var assetId = saved(app).assets[0].id;
  doc.querySelector('[data-edit-asset="' + assetId + '"]').click();
  doc.getElementById("assetDelete").click();

  assert.ok(doc.getElementById("assetErr").classList.contains("on"));
  assert.match(doc.getElementById("assetErr").textContent, /1 valuation still belongs/);
  assert.equal(saved(app).assets[0].deleted, false);
});

test("SEC-7: an asset name containing HTML is escaped in the list", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  openAssetsTab(doc);

  doc.getElementById("addAssetBtn").click();
  doc.getElementById("s_name").value = '<img src=x onerror="window.__pwned=1">';
  doc.getElementById("s_acquired").value = "2026-01";
  doc.getElementById("s_cost").value = "1000";
  doc.getElementById("assetSave").click();

  assert.equal(app.window.__pwned, undefined);
  assert.equal(doc.querySelectorAll("#assetList img").length, 0);
});
