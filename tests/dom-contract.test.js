"use strict";
// The DOM contract (docs/ui-redesign-plan.md §5). The UI tests drive the real index.html
// through IDs, data attributes and a handful of classes — never through layout — so a
// redesign is safe exactly as long as those hooks survive. This file writes them down.
//
// When it fails, it names the missing hook, which is far easier to act on than the dozen
// unrelated UI tests that would otherwise fail with "cannot read properties of null".
//
// Rules (docs/parallel-work.md §5): a hook may gain an alias but is never removed or
// renamed. Whichever stream adds an ID that a test drives registers it here in the same
// commit — the last test below fails until it does.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

var ROOT = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

// Present in index.html itself, before any script runs.
var STATIC_IDS = [
  "a_arch", "a_name", "acctSave", "addAssetBtn", "addGoalBtn", "addInstBtn", "addLiabBtn",
  "allocChart", "allocDim", "allocLegend", "assetDelete", "assetErr", "assetList", "assetSave",
  "assumptions", "c_balance", "c_instalment", "c_interest", "allocTitle", "c_period", "c_result", "catStrip", "classChart", "classLegend",
  "dec_amount", "dec_growth", "decisionResult", "epfBalances", "epfContrib", "epfDividend",
  "epfRate", "epfSec", "epfSplitFields", "epfSplitResult", "epfYear", "feesList", "feesWrap",
  "fileLabel", "fileNote", "fileRow", "forecastChart", "forecastKpis", "forecastLegend",
  "fxNote", "fxWrap",
  "g_date", "g_name", "g_target", "goalDelete", "goalErr", "goalList", "goalSave", "h_epf",
  "h_fee", "h_fixed", "h_relief", "h_units", "holdDelete", "holdErr", "holdSave", "horizon",
  "i_name", "i_type", "importCancel", "importConfirm", "importModal", "importModalBody",
  "incomeChart", "incomeLegend", "incomeWrap", "instDelete", "instErr", "instModal", "instSave",
  "kpis", "l_basis", "l_name", "l_principal", "l_rate", "l_tenure", "l_type", "liabDelete",
  "liabErr", "liabList", "liabSave", "loanList", "migrateFile", "monthActions", "monthErr", "monthRows",
  "monthSummary", "navAssets", "navDebts", "navNet", "periodPick", "pidmNote", "pidmWrap", "realTerms", "reliefList",
  "resetEpfSplitBtn", "resilience", "reviewCancelBtn", "reviewConfirmBtn", "reviewKeepNotes",
  "reviewNoneBtn", "reviewProblems", "reviewRows", "reviewSec", "reviewSummary", "s_acquired",
  "s_class", "s_cost", "s_liab", "s_name", "s_value", "saveEpfRateBtn", "saveEpfSplitBtn",
  "saveLimitsBtn", "saveMonthBtn", "saveSettingsBtn", "sc_contrib", "sc_inv", "scenarioErr",
  "scenarioSave", "seriesChart", "seriesLegend", "seriesMetric", "seriesNote", "seriesWrap",
  "set_expenses", "set_income", "settingsNote", "sheetFileIn", "sheetPeriod", "sheetStatus", "showArchived",
  "snackMsg", "staleNote", "staleWrap", "strat_extra", "strategyResult", "strategyWrap",
  "taxYear", "themeBtn", "topPeriod", "tree", "undoImportBtn", "v-data", "v-forecast", "v-loans", "v-month", "v-tax", "v-worth",
  "worthChart", "worthHero", "worthKpis", "worthLines"
];

// Built by app.js at render time. Each entry is the literal the render code must still
// emit: a whole id, or the prefix of a family of ids (m_<holding>_<field>, lim_<key>).
var RENDERED_IDS = {
  exportNowBtn: 'id="exportNowBtn"',
  connectNewBtn: 'id="connectNewBtn"',
  connectExistingBtn: 'id="connectExistingBtn"',
  firstInstBtn: 'id="firstInstBtn"',
  "epf_": 'id="epf_',
  "lim_": 'id="lim_',
  "mrow_": 'id="mrow_',
  "m_": 'id="m_',
  // One per editable sheet cell (P5.4b).
  "cell_": 'id="cell_'
};

// Data attributes and classes that tests select by. Each must still be produced by
// index.html or app.js.
var ATTRIBUTE_HOOKS = [
  "data-v", "data-sched", "data-simpay", "data-simsettle", "data-edit-inst", "data-edit-acct",
  "data-edit-hold", "data-edit-asset", "data-edit-liab", "data-edit-goal", "data-edit-scenario",
  "data-imp"
];
var CLASS_HOOKS = [
  "tab", "view", "stale-mark", "yield", "up", "dn", "wline", "irow", "ibadge", "lg", "lgt", "tag"
];

// Hidden in index.html with an inline style="display:none" and revealed from app.js by
// setting el.style.display. Tests assert on el.style.display, so replacing the inline
// style with a class would render correctly and fail the suite. If a redesign wants these
// class-driven, it changes the JS and the tests in the same commit. (Folded in from
// docs/ui-hooks-from-functional.md §3, which this file replaces.)
var TOGGLED_BY_DISPLAY = [
  "acctDelete", "assetDelete", "feesWrap", "fxWrap", "goalDelete", "holdDelete",
  "incomeWrap", "instDelete", "liabDelete", "pidmWrap", "reviewSec", "seriesWrap",
  "staleWrap", "strategyWrap", "undoImportBtn"
];

test("every statically declared hook is present in index.html", function () {
  var ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), function (m) { return m[1]; }));
  var missing = STATIC_IDS.filter(function (id) { return !ids.has(id); });
  assert.deepEqual(missing, [], "removed or renamed in index.html: " + missing.join(", "));
});

test("every rendered hook is still emitted by app.js", function () {
  var missing = Object.keys(RENDERED_IDS).filter(function (k) {
    return appJs.indexOf(RENDERED_IDS[k]) === -1 && appJs.indexOf(RENDERED_IDS[k].replace(/"/g, "'")) === -1;
  });
  assert.deepEqual(missing, [], "no longer rendered by app.js: " + missing.join(", "));
});

test("every data-attribute and class hook is still produced", function () {
  var source = html + appJs;
  var missingAttrs = ATTRIBUTE_HOOKS.filter(function (a) { return source.indexOf(a + "=") === -1; });
  assert.deepEqual(missingAttrs, [], "attribute hooks gone: " + missingAttrs.join(", "));
  var missingClasses = CLASS_HOOKS.filter(function (c) {
    return !new RegExp("class=\\\\?[\"'][^\"']*\\b" + c + "\\b").test(source) &&
      !new RegExp("[\"' ]" + c + "[\"' ]").test(source);
  });
  assert.deepEqual(missingClasses, [], "class hooks gone: " + missingClasses.join(", "));
});

test("every navigation tab still opens a view of the same name", function () {
  var doc = helpers.loadApp().window.document;
  var tabs = Array.prototype.slice.call(doc.querySelectorAll(".tab[data-v]"));
  assert.ok(tabs.length >= 7, "expected the seven navigation tabs");
  tabs.forEach(function (t) {
    var v = t.getAttribute("data-v");
    assert.ok(doc.getElementById("v-" + v), "tab '" + v + "' has no #v-" + v + " view");
  });
});

test("the app renders the contract with no console errors", function () {
  var app = helpers.loadApp();
  assert.deepEqual(app.consoleErrors, []);
  var doc = app.window.document;
  STATIC_IDS.forEach(function (id) {
    assert.ok(doc.getElementById(id), "#" + id + " missing after render");
  });
});

test("every id a test drives is registered in this contract", function () {
  var known = new Set(STATIC_IDS);
  var prefixes = Object.keys(RENDERED_IDS);
  var unregistered = new Set();
  fs.readdirSync(__dirname).filter(function (f) {
    return /\.test\.js$/.test(f) && f !== path.basename(__filename);
  }).forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, f), "utf8");
    var found = Array.from(src.matchAll(/getElementById\(\s*["']([^"']+)["']/g), function (m) { return m[1]; })
      .concat(Array.from(src.matchAll(/querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)/g), function (m) { return m[1]; }));
    found.forEach(function (id) {
      if (known.has(id)) return;
      if (prefixes.some(function (p) { return id === p || id.indexOf(p) === 0; })) return;
      unregistered.add(id + " (" + f + ")");
    });
  });
  assert.deepEqual(Array.from(unregistered), [],
    "tests drive these ids but tests/dom-contract.test.js does not list them");
});

test("elements the app shows and hides still carry an inline display style", function () {
  TOGGLED_BY_DISPLAY.forEach(function (id) {
    var re = new RegExp('id="' + id + '"[^>]*style="display:none"');
    assert.match(html, re, "#" + id + " must stay inline-hidden, not class-hidden");
  });
});
