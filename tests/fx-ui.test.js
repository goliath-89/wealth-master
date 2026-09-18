"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-9.6 against the real DOM. The engine is covered in fx.test.js; these check that a
// rate can actually be entered, and that a holding left out of the total says so on the
// screen the total appears on.

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Wise";
  s.institutions.push(inst);

  var foreign = l.schema.newAccount("dev-1");
  foreign.institutionId = inst.id;
  foreign.name = "Multi-currency";
  foreign.class = "cash";
  foreign.currency = opts.currency || "USD";
  s.accounts.push(foreign);

  var local = l.schema.newAccount("dev-1");
  local.institutionId = inst.id;
  local.name = "Savings";
  local.class = "cash";
  local.currency = "MYR";
  s.accounts.push(local);

  var fh = l.schema.newHolding("dev-1");
  fh.accountId = foreign.id;
  fh.name = "USD cash";
  s.holdings.push(fh);

  var lh = l.schema.newHolding("dev-1");
  lh.accountId = local.id;
  lh.name = "Maybank";
  s.holdings.push(lh);

  (opts.entries || []).forEach(function (e) {
    l.valuations.upsertValuation(s, {
      holdingId: e.holding === "local" ? lh.id : fh.id,
      period: e.period || period,
      balance: e.balance,
      fxRate: e.fxRate
    }, "dev-1");
  });

  return { l: l, state: s, foreignHolding: fh, localHolding: lh, period: period };
}

function saved(app) { return JSON.parse(app.window.localStorage.getItem("wealthmaster.state")); }
function monthTab(doc) { doc.querySelector('.tab[data-v="month"]').click(); }

// --- entering a rate --------------------------------------------------------

test("a foreign holding gets a rate box; a ringgit one does not", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  monthTab(doc);

  assert.notEqual(doc.getElementById("m_" + f.foreignHolding.id + "_fxRate"), null);
  assert.equal(doc.getElementById("m_" + f.localHolding.id + "_fxRate"), null,
    "ringgit needs no conversion");
  assert.match(doc.getElementById("mrow_" + f.foreignHolding.id).textContent, /USD/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a rate typed into the month grid is saved with the balance", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  monthTab(doc);
  doc.getElementById("periodPick").value = f.period;

  doc.getElementById("m_" + f.foreignHolding.id + "_balance").value = "10000";
  doc.getElementById("m_" + f.foreignHolding.id + "_fxRate").value = "4.2";
  doc.getElementById("saveMonthBtn").click();

  var v = saved(app).valuations.filter(function (x) {
    return x.holdingId === f.foreignHolding.id;
  })[0];
  assert.equal(v.balance, 10000);
  assert.equal(v.fxRate, 4.2, "the rate must survive the save — units once did not");
});

test("saving a month does not blank a rate the row did not carry", function () {
  var f = seeded({ entries: [{ balance: 10000, fxRate: 4.2 }] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  monthTab(doc);
  doc.getElementById("periodPick").value = f.period;

  // Change only the balance, leaving the rate box as rendered.
  doc.getElementById("m_" + f.foreignHolding.id + "_balance").value = "11000";
  doc.getElementById("saveMonthBtn").click();

  var v = saved(app).valuations.filter(function (x) {
    return x.holdingId === f.foreignHolding.id;
  })[0];
  assert.equal(v.balance, 11000);
  assert.equal(v.fxRate, 4.2);
});

test("a rate that is not a number is refused and nothing is written", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  monthTab(doc);
  doc.getElementById("periodPick").value = f.period;

  doc.getElementById("m_" + f.foreignHolding.id + "_balance").value = "10000";
  doc.getElementById("m_" + f.foreignHolding.id + "_fxRate").value = "four";
  doc.getElementById("saveMonthBtn").click();

  var mine = saved(app).valuations.filter(function (x) {
    return x.holdingId === f.foreignHolding.id;
  });
  assert.equal(mine.length, 0, "a bad rate must not half-save the row");
});

test("the row shows what the balance converts to", function () {
  var f = seeded({ entries: [{ balance: 10000, fxRate: 4.2 }] });
  var doc = helpers.loadApp(f.state).window.document;
  monthTab(doc);
  var row = doc.getElementById("mrow_" + f.foreignHolding.id).textContent;
  assert.match(row, /Held in USD/);
  assert.match(row, /RM 42,000\.00/);
});

test("a row with no rate says the balance will be left out, not counted as ringgit", function () {
  var f = seeded({ entries: [{ balance: 10000 }] });
  var doc = helpers.loadApp(f.state).window.document;
  monthTab(doc);
  assert.match(doc.getElementById("mrow_" + f.foreignHolding.id).textContent,
    /left out of net worth rather than counted as ringgit/);
});

// --- the net worth screen ---------------------------------------------------

test("net worth converts the foreign holding rather than adding it at face value", function () {
  var f = seeded({ entries: [
    { balance: 10000, fxRate: 4.2 },
    { holding: "local", balance: 5000 }
  ] });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  // RM 5,000 plus USD 10,000 at 4.2 is RM 47,000 — not the RM 15,000 it used to report.
  assert.match(doc.getElementById("worthKpis").textContent, /RM 47,000\.00/);
  assert.equal(doc.getElementById("fxWrap").style.display, "none", "nothing to warn about");
  assert.deepEqual(app.consoleErrors, []);
});

test("a holding with no rate is named as left out, on the screen it is missing from", function () {
  var f = seeded({ entries: [
    { balance: 10000 },
    { holding: "local", balance: 5000 }
  ] });
  var doc = helpers.loadApp(f.state).window.document;

  assert.equal(doc.getElementById("fxWrap").style.display, "");
  var note = doc.getElementById("fxNote").textContent;
  assert.match(note, /not counted above/);
  assert.match(note, /USD cash/);
  assert.match(note, /USD 10,000\.00/);
  // The total is the ringgit holding alone, and says so rather than quietly including it.
  assert.match(doc.getElementById("worthKpis").textContent, /RM 5,000\.00/);
});

test("a carried-forward rate is disclosed with where it came from", function () {
  var l = helpers.loadLib(helpers.freshWindow());
  var period = l.valuations.currentPeriod();
  var earlier = l.valuations.prevPeriod(period);
  var f = seeded({ entries: [
    { balance: 10000, fxRate: 4.2, period: earlier },
    { balance: 10000, period: period }
  ] });
  var doc = helpers.loadApp(f.state).window.document;

  assert.equal(doc.getElementById("fxWrap").style.display, "");
  var note = doc.getElementById("fxNote").textContent;
  assert.match(note, /carried from an earlier month/);
  assert.match(note, new RegExp("USD at 4.2 from " + earlier));
  assert.match(note, /approximate/);
});

test("two rates for one currency are flagged as a contradiction", function () {
  var f = seeded({ entries: [{ balance: 10000, fxRate: 4.2 }] });
  // A second USD holding on the same account, at a different rate.
  var other = f.l.schema.newHolding("dev-1");
  other.accountId = f.foreignHolding.accountId;
  other.name = "USD savings";
  f.state.holdings.push(other);
  f.l.valuations.upsertValuation(f.state,
    { holdingId: other.id, period: f.period, balance: 500, fxRate: 4.9 }, "dev-1");

  var doc = helpers.loadApp(f.state).window.document;
  var note = doc.getElementById("fxNote").textContent;
  assert.match(note, /more than one rate this month/);
  assert.match(note, /4\.2 to 4\.9/);
  assert.match(note, /cannot both be right/);
});

test("SEC-7: a holding named like a script cannot execute from the FX warning", function () {
  var f = seeded({ entries: [{ balance: 10000 }] });
  f.state.holdings[0].name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  assert.equal(doc.querySelector("#fxNote img"), null);
  assert.equal(app.window.__pwned, undefined);
  assert.match(doc.getElementById("fxNote").textContent, /onerror/);
});

test("REGRESSION: the rate box is not formatted as currency on blur", function () {
  var f = seeded();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  monthTab(doc);
  doc.getElementById("periodPick").value = f.period;

  var rate = doc.getElementById("m_" + f.foreignHolding.id + "_fxRate");
  var balance = doc.getElementById("m_" + f.foreignHolding.id + "_balance");

  // The rate shares the .mgrid with the amount boxes, which format themselves as ringgit
  // on blur. Applied to a rate that turned 3.3 into "RM 3.30", which then failed to parse
  // and rejected the whole row. Setting .value in a test fires no blur, so this drives
  // real focus and blur events — the browser is where it showed up.
  balance.value = "10000";
  rate.value = "4.2";
  rate.dispatchEvent(new app.window.FocusEvent("focus"));
  rate.dispatchEvent(new app.window.FocusEvent("blur"));
  assert.equal(rate.value, "4.2", "a rate is a multiplier, not an amount of money");

  doc.getElementById("saveMonthBtn").click();
  var v = saved(app).valuations.filter(function (x) {
    return x.holdingId === f.foreignHolding.id;
  })[0];
  assert.ok(v, "the row saves rather than being refused");
  assert.equal(v.fxRate, 4.2);

  // Ringgit amount boxes still format, which is what they are for. The foreign holding's
  // own boxes deliberately do not — its figures are in USD, not RM.
  var localBalance = doc.getElementById("m_" + f.localHolding.id + "_balance");
  localBalance.value = "5000";
  localBalance.dispatchEvent(new app.window.FocusEvent("focus"));
  localBalance.dispatchEvent(new app.window.FocusEvent("blur"));
  assert.match(localBalance.value, /^RM /);

  balance.dispatchEvent(new app.window.FocusEvent("focus"));
  balance.dispatchEvent(new app.window.FocusEvent("blur"));
  assert.equal(/RM/.test(balance.value), false, "a USD balance is never dressed as ringgit");
});

test("a foreign holding's figures are labelled and shown in its own currency", function () {
  var f = seeded({ entries: [{ balance: 10000, fxRate: 4.2 }, { holding: "local", balance: 5000 }] });
  var doc = helpers.loadApp(f.state).window.document;
  monthTab(doc);

  // Showing USD 10,000 in a box reading "RM 10,000" is the confusion this whole feature
  // exists to remove — and it would be the owner's own screen telling them the wrong thing.
  var foreignBox = doc.getElementById("m_" + f.foreignHolding.id + "_balance");
  assert.equal(foreignBox.value, "10000");
  assert.equal(/RM/.test(foreignBox.value), false);
  assert.match(doc.getElementById("mrow_" + f.foreignHolding.id).textContent,
    /Closing balance \(USD\)/);

  // A ringgit holding is unchanged.
  var localBox = doc.getElementById("m_" + f.localHolding.id + "_balance");
  assert.match(localBox.value, /^RM /);
  assert.equal(/Closing balance \(/.test(doc.getElementById("mrow_" + f.localHolding.id).textContent), false);
});
