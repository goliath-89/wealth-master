"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// Every test drives the real index.html and asserts on rendered DOM, so a change that
// computes correctly but never reaches the screen still fails.

var LABELS = {
  persaraan: "Akaun Persaraan",
  sejahtera: "Akaun Sejahtera",
  fleksibel: "Akaun Fleksibel"
};

function lib() { return helpers.loadLib(helpers.freshWindow()); }

// Builds a store with an EPF account and whichever of the three sub-accounts are asked
// for. Periods are anchored to the current month so carry-forward behaves as it will in
// use rather than against a date that has drifted past.
function seeded(opts) {
  opts = opts || {};
  var l = lib();
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();
  var year = period.slice(0, 4);

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "KWSP";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "EPF";
  acct.class = "retirement";
  acct.liquid = false;
  s.accounts.push(acct);

  var holdings = {};
  (opts.accounts || []).forEach(function (key) {
    var h = l.schema.newHolding("dev-1");
    h.accountId = acct.id;
    h.name = LABELS[key];
    h.epfAccount = key;
    s.holdings.push(h);
    holdings[key] = h;
  });

  // A plain holding so the "no EPF tagged" path can be tested with real data present.
  if (opts.plainHolding) {
    var plain = l.schema.newHolding("dev-1");
    plain.accountId = acct.id;
    plain.name = "Savings";
    s.holdings.push(plain);
    holdings.plain = plain;
  }

  (opts.entries || []).forEach(function (e) {
    l.valuations.upsertValuation(s, {
      holdingId: holdings[e.account].id,
      period: e.period || period,
      balance: e.balance,
      contribution: e.contribution,
      withdrawal: e.withdrawal,
      income: e.income
    }, "dev-1");
  });

  if (opts.settings) {
    Object.keys(opts.settings).forEach(function (k) { s.settings[k] = opts.settings[k]; });
  }

  return { l: l, state: s, holdings: holdings, acct: acct, period: period, year: year };
}

function accountsTab(doc) { doc.querySelector('.tab[data-v="accounts"]').click(); }
function saved(app) { return JSON.parse(app.window.localStorage.getItem("wealthmaster.state")); }

// --- the three-account breakdown -------------------------------------------

test("with nothing tagged the section explains what to add", function () {
  var f = seeded({ plainHolding: true });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfBalances").textContent;
  assert.match(text, /No EPF accounts tagged/);
  assert.match(text, /Akaun Persaraan/);
  assert.deepEqual(app.consoleErrors, []);
});

test("all three balances render with their shares and a total", function () {
  var f = seeded({
    accounts: ["persaraan", "sejahtera", "fleksibel"],
    entries: [
      { account: "persaraan", balance: 150000 },
      { account: "sejahtera", balance: 30000 },
      { account: "fleksibel", balance: 20000 }
    ]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfBalances").textContent;
  assert.match(text, /Akaun Persaraan/);
  assert.match(text, /RM 150,000\.00/);
  assert.match(text, /75\.0% of EPF/);
  assert.match(text, /10\.0% of EPF/);
  assert.match(text, /EPF total/);
  assert.match(text, /RM 200,000\.00/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a partial position says the total covers only what is recorded", function () {
  var f = seeded({
    accounts: ["persaraan"],
    entries: [{ account: "persaraan", balance: 150000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfBalances").textContent;
  assert.match(text, /Only 1 of the three accounts has a balance/);
  assert.match(text, /Not tagged, or never valued/);
});

test("a carried-forward balance is marked and names the month it came from", function () {
  var l = lib();
  var period = l.valuations.currentPeriod();
  var earlier = l.valuations.prevPeriod(l.valuations.prevPeriod(period));
  var f = seeded({
    accounts: ["persaraan"],
    entries: [{ account: "persaraan", period: earlier, balance: 150000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfBalances").textContent;
  assert.match(text, new RegExp("carried from " + earlier));
  assert.ok(doc.querySelector("#epfBalances .stale-mark"), "the figure itself must be marked");
});

// --- the split is presented as policy, not fact ----------------------------

test("the default shares render at 75/15/10 and are flagged for confirmation", function () {
  var f = seeded({ accounts: ["persaraan"] });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  assert.equal(doc.getElementById("epf_persaraan").value, "75");
  assert.equal(doc.getElementById("epf_sejahtera").value, "15");
  assert.equal(doc.getElementById("epf_fleksibel").value, "10");
  assert.equal(doc.querySelectorAll("#epfSplitFields .tag").length, 3,
    "every unconfirmed share carries the confirm tag");
  assert.match(doc.getElementById("epfSec").textContent, /Policy, not fact/);
  assert.match(doc.getElementById("epfSec").textContent, /confirm them against KWSP/);
});

test("edited shares save, drop the confirm tag, and change the split", function () {
  var f = seeded({ accounts: ["persaraan"] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.getElementById("epf_persaraan").value = "70";
  doc.getElementById("epf_sejahtera").value = "20";
  doc.getElementById("epf_fleksibel").value = "10";
  doc.getElementById("saveEpfSplitBtn").click();

  assert.deepEqual(saved(app).settings.epfSplit, { persaraan: 70, sejahtera: 20, fleksibel: 10 });
  assert.equal(doc.querySelectorAll("#epfSplitFields .tag").length, 0);
  assert.deepEqual(app.consoleErrors, []);
});

test("a non-numeric share is refused and nothing is saved", function () {
  var f = seeded({ accounts: ["persaraan"] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.getElementById("epf_persaraan").value = "";
  doc.getElementById("saveEpfSplitBtn").click();

  assert.match(doc.getElementById("snackMsg").textContent, /must be a number/);
  assert.equal(saved(app).settings.epfSplit, undefined);
});

test("resetting returns to the defaults", function () {
  var f = seeded({
    accounts: ["persaraan"],
    settings: { epfSplit: { persaraan: 70, sejahtera: 30, fleksibel: 0 } }
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);
  assert.equal(doc.getElementById("epf_persaraan").value, "70");

  doc.getElementById("resetEpfSplitBtn").click();
  assert.equal(doc.getElementById("epf_persaraan").value, "75");
  assert.equal(saved(app).settings.epfSplit, undefined);
});

// --- dividing a contribution ------------------------------------------------

test("typing a contribution shows the three amounts and their total", function () {
  var f = seeded({ accounts: ["persaraan"] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.getElementById("epfContrib").value = "1,000";
  doc.getElementById("epfContrib").oninput();

  var text = doc.getElementById("epfSplitResult").textContent;
  assert.match(text, /RM 750\.00/);
  assert.match(text, /RM 150\.00/);
  assert.match(text, /RM 100\.00/);
  assert.match(text, /Divided/);
  assert.match(text, /What EPF actually credits is on your statement/);
});

test("dividing a contribution writes nothing to the store", function () {
  var f = seeded({ accounts: ["persaraan"] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);
  var before = app.window.localStorage.getItem("wealthmaster.state");

  doc.getElementById("epfContrib").value = "1234.56";
  doc.getElementById("epfContrib").oninput();

  assert.match(doc.getElementById("epfSplitResult").textContent, /RM 925\.92/);
  assert.equal(app.window.localStorage.getItem("wealthmaster.state"), before,
    "the splitter is a calculator, not an entry form");
});

test("shares that do not total 100 warn on the divided amount", function () {
  var f = seeded({
    accounts: ["persaraan"],
    settings: { epfSplit: { persaraan: 70, sejahtera: 15, fleksibel: 10 } }
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  doc.getElementById("epfContrib").value = "1000";
  doc.getElementById("epfContrib").oninput();

  assert.match(doc.getElementById("epfSplitResult").textContent, /total 95%, not 100%/);
  assert.match(doc.getElementById("epfBalances").textContent, /shares total 95%/);
});

// --- the annual dividend ----------------------------------------------------

test("with no declared rate nothing is estimated", function () {
  var f = seeded({
    accounts: ["persaraan"],
    entries: [{ account: "persaraan", balance: 100000 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfDividend").textContent;
  assert.match(text, /No rate entered/);
  assert.equal(/RM 0\.00/.test(text), false, "a missing rate must not render as zero");
});

test("a declared rate saves and estimates each account's dividend", function () {
  var l = lib();
  var period = l.valuations.currentPeriod();
  var year = Number(period.slice(0, 4));
  var f = seeded({
    accounts: ["persaraan", "sejahtera"],
    entries: [
      { account: "persaraan", period: (year - 1) + "-12", balance: 100000 },
      { account: "sejahtera", period: (year - 1) + "-12", balance: 20000 }
    ]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.getElementById("epfRate").value = "6";
  doc.getElementById("saveEpfRateBtn").click();

  assert.equal(saved(app).settings.epfDividendRates[String(year)], 6);
  var text = doc.getElementById("epfDividend").textContent;
  assert.match(text, /RM 6,000\.00/);
  assert.match(text, /RM 1,200\.00/);
  assert.match(text, /Estimated for/);
  assert.match(text, /Illustrative/);
  assert.deepEqual(app.consoleErrors, []);
});

test("for a finished year, a credited figure that differs from the estimate is reported and the statement wins", function () {
  var l = lib();
  var year = Number(l.valuations.currentPeriod().slice(0, 4)) - 1;
  var f = seeded({
    accounts: ["persaraan"],
    entries: [
      { account: "persaraan", period: (year - 1) + "-12", balance: 100000 },
      { account: "persaraan", period: year + "-12", balance: 106400, income: 6400 }
    ],
    settings: { epfDividendRates: {} }
  });
  f.state.settings.epfDividendRates[String(year)] = 6;
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);
  doc.getElementById("epfYear").value = String(year);
  doc.getElementById("epfYear").onchange();

  var text = doc.getElementById("epfDividend").textContent;
  assert.match(text, /RM 6,400\.00 credited/);
  assert.match(text, /Statement differs by RM 400\.00 more/);
  assert.match(text, /The statement is the figure that counts/);
  // The estimate is reported, never reconciled away.
  assert.match(text, /RM 6,000\.00/);
});

test("a year still running is not compared against a full year's estimate", function () {
  var l = lib();
  var period = l.valuations.currentPeriod();
  var year = Number(period.slice(0, 4));
  var f = seeded({
    accounts: ["persaraan"],
    entries: [
      { account: "persaraan", period: (year - 1) + "-12", balance: 100000 },
      { account: "persaraan", period: year + "-01", balance: 100500, income: 500 }
    ],
    settings: { epfDividendRates: {} }
  });
  f.state.settings.epfDividendRates[String(year)] = 6;
  var doc = helpers.loadApp(f.state).window.document;
  accountsTab(doc);

  var text = doc.getElementById("epfDividend").textContent;
  // Twelve months of estimate against one month of entries is the calendar, not a discrepancy.
  assert.equal(/Statement differs by/.test(text), false);
  assert.match(text, /income so far/);
  assert.match(text, new RegExp(year + " is still running"));
});

test("clearing the rate removes it rather than storing zero", function () {
  var l = lib();
  var year = Number(l.valuations.currentPeriod().slice(0, 4));
  var f = seeded({
    accounts: ["persaraan"],
    entries: [{ account: "persaraan", balance: 100000 }],
    settings: { epfDividendRates: {} }
  });
  f.state.settings.epfDividendRates[String(year)] = 6;
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.getElementById("epfRate").value = "";
  doc.getElementById("saveEpfRateBtn").click();

  assert.equal(saved(app).settings.epfDividendRates[String(year)], undefined);
  assert.match(doc.getElementById("epfDividend").textContent, /No rate entered/);
});

// --- tagging a holding ------------------------------------------------------

test("the EPF account is chosen and saved from the holding form", function () {
  var f = seeded({ plainHolding: true });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.querySelector('[data-edit-hold="' + f.holdings.plain.id + '"]').click();
  doc.getElementById("h_epf").value = "fleksibel";
  doc.getElementById("holdSave").click();

  assert.equal(saved(app).holdings[0].epfAccount, "fleksibel");
  assert.match(doc.getElementById("epfBalances").textContent, /Akaun Fleksibel/);
});

test("the EPF tag round-trips back into the form and can be cleared", function () {
  var f = seeded({ accounts: ["sejahtera"] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  doc.querySelector('[data-edit-hold="' + f.holdings.sejahtera.id + '"]').click();
  assert.equal(doc.getElementById("h_epf").value, "sejahtera");

  doc.getElementById("h_epf").value = "";
  doc.getElementById("holdSave").click();
  assert.equal(saved(app).holdings[0].epfAccount, null);
});

test("SEC-7: a script-like holding name cannot execute from the EPF section", function () {
  var f = seeded({
    accounts: ["persaraan"],
    entries: [{ account: "persaraan", balance: 1000 }]
  });
  f.state.holdings[0].name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  accountsTab(doc);

  assert.equal(doc.querySelector("#epfBalances img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("epfBalances").textContent, /onerror/);
});
