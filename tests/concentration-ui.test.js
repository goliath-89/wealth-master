"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-4.8 against the real DOM. An engine with no call site passes CI and ships nothing.

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  acct.class = "cash";
  acct.currency = opts.currency || "MYR";
  s.accounts.push(acct);

  (opts.holdings || []).forEach(function (h) {
    var e = l.schema.newHolding("dev-1");
    e.accountId = acct.id;
    e.name = h.name;
    s.holdings.push(e);
    l.valuations.upsertValuation(s, {
      holdingId: e.id, period: period, balance: h.balance, fxRate: h.fxRate
    }, "dev-1");
  });

  if (opts.threshold !== undefined) s.settings.concentrationPct = opts.threshold;
  return { l: l, state: s, period: period };
}

function saved(app) { return JSON.parse(app.window.localStorage.getItem("wealthmaster.state")); }
function dataTab(doc) { doc.querySelector('.tab[data-v="data"]').click(); }

var LOPSIDED = [{ name: "ASB", balance: 80000 }, { name: "FD", balance: 20000 }];
// Six ways, ~16.7% each — comfortably under the 20% default.
var EVEN = [{ name: "A", balance: 25000 }, { name: "B", balance: 25000 },
  { name: "C", balance: 25000 }, { name: "D", balance: 25000 },
  { name: "E", balance: 25000 }, { name: "F", balance: 25000 }];

test("a lopsided portfolio says so on the net worth screen", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED }).state);
  var doc = app.window.document;

  assert.equal(doc.getElementById("concWrap").style.display, "");
  var note = doc.getElementById("concNote").textContent;
  assert.match(note, /80% of the portfolio/);
  assert.match(note, /ASB/);
  assert.match(note, /RM 80,000\.00/);
  assert.deepEqual(app.consoleErrors, []);
});

test("an evenly spread portfolio is not warned about", function () {
  var doc = helpers.loadApp(seeded({ holdings: EVEN }).state).window.document;
  assert.equal(doc.getElementById("concWrap").style.display, "none");
});

test("the note says which threshold is in force, and where to change it", function () {
  var doc = helpers.loadApp(seeded({ holdings: LOPSIDED }).state).window.document;
  assert.match(doc.getElementById("concNote").textContent,
    /default of 20%, which you can change on the Data tab/);
});

test("the owner's own threshold is named as theirs", function () {
  var doc = helpers.loadApp(seeded({ holdings: LOPSIDED, threshold: 50 }).state).window.document;
  var note = doc.getElementById("concNote").textContent;
  assert.match(note, /your 50% setting/);
  assert.equal(/default of/.test(note), false);
});

test("raising the threshold past the largest holding silences the warning", function () {
  var doc = helpers.loadApp(seeded({ holdings: LOPSIDED, threshold: 90 }).state).window.document;
  assert.equal(doc.getElementById("concWrap").style.display, "none");
});

test("the warning is words, not colour alone (NFR-9)", function () {
  var doc = helpers.loadApp(seeded({ holdings: LOPSIDED }).state).window.document;
  var note = doc.getElementById("concNote").textContent;
  // Read aloud with no styling, it still states the holding, the share and the threshold.
  assert.match(note, /ASB/);
  assert.match(note, /80%/);
  assert.match(note, /20%/);
  assert.match(note, /not a mistake — it is a position/);
});

test("a holding left out for want of a rate is disclosed, since it inflates every share", function () {
  var f = seeded({ currency: "USD", holdings: [
    { name: "USD cash", balance: 10000 }, { name: "Also USD", balance: 500, fxRate: 4.2 }
  ] });
  var note = helpers.loadApp(f.state).window.document.getElementById("concNote").textContent;
  assert.match(note, /1 holding is left out of the total for want of an exchange rate/);
  assert.match(note, /shares are of what could be counted/);
});

test("SEC-7: a holding named like a script cannot execute from the warning", function () {
  var f = seeded({ holdings: [
    { name: '<img src=x onerror="window.__pwned=1">', balance: 80000 },
    { name: "FD", balance: 20000 }
  ] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(doc.querySelector("#concNote img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("concNote").textContent, /onerror/);
});

// --- the setting ------------------------------------------------------------

test("the threshold box is blank when unset, showing the default as a hint only", function () {
  var doc = helpers.loadApp(seeded({ holdings: EVEN }).state).window.document;
  dataTab(doc);
  var box = doc.getElementById("set_concentration");
  assert.equal(box.value, "", "a blank setting must not claim the owner chose 20");
  assert.equal(box.getAttribute("placeholder"), "20%");
});

test("a threshold typed on the Data tab is saved and takes effect", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED, threshold: 90 }).state);
  var doc = app.window.document;
  dataTab(doc);

  assert.equal(doc.getElementById("concWrap").style.display, "none");
  doc.getElementById("set_concentration").value = "30";
  doc.getElementById("saveSettingsBtn").click();

  assert.equal(saved(app).settings.concentrationPct, 30);
  assert.equal(doc.getElementById("concWrap").style.display, "");
  assert.match(doc.getElementById("concNote").textContent, /your 30% setting/);
});

test("a threshold typed with a percent sign is accepted", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED }).state);
  var doc = app.window.document;
  dataTab(doc);
  doc.getElementById("set_concentration").value = "35%";
  doc.getElementById("saveSettingsBtn").click();
  assert.equal(saved(app).settings.concentrationPct, 35);
});

test("clearing the box returns to the default rather than storing zero", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED, threshold: 50 }).state);
  var doc = app.window.document;
  dataTab(doc);
  doc.getElementById("set_concentration").value = "";
  doc.getElementById("saveSettingsBtn").click();

  assert.equal(saved(app).settings.concentrationPct, null);
  assert.match(doc.getElementById("concNote").textContent, /default of 20%/);
});

test("an out-of-range threshold is refused and nothing else on the form is saved", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED }).state);
  var doc = app.window.document;
  dataTab(doc);

  doc.getElementById("set_income").value = "8000";
  doc.getElementById("set_concentration").value = "150";
  doc.getElementById("saveSettingsBtn").click();

  var st = saved(app).settings;
  assert.equal(st.concentrationPct === 150, false);
  assert.equal(st.monthlyIncome, undefined,
    "a refused form must not half-save — the income box was in the same submit");
  assert.match(doc.getElementById("snackMsg").textContent, /between 1 and 100/);
});

test("saving the monthly figures does not wipe a threshold already set", function () {
  var app = helpers.loadApp(seeded({ holdings: LOPSIDED, threshold: 40 }).state);
  var doc = app.window.document;
  dataTab(doc);

  doc.getElementById("set_income").value = "8000";
  doc.getElementById("saveSettingsBtn").click();

  assert.equal(saved(app).settings.concentrationPct, 40, "the units bug, one more time");
});
