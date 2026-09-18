"use strict";
// P5.6: the row detail panel — what a row is worth, what it returned, and what was
// recorded month by month, without leaving the sheet.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, opts) {
    opts = opts || {};
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = opts.account || name;
    a.class = opts.class || "cash";
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    h.instrumentType = opts.instrument || "Bank deposit";
    if (opts.rate) h.rate = opts.rate;
    if (opts.unitBased) { h.unitBased = true; h.fixedUnitPrice = opts.fixedUnitPrice || null; }
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
function open(doc, id) { doc.getElementById("open_" + id).click(); }
function panel(doc) { return doc.getElementById("rowPanel"); }

test("the panel stays out of the way until a row is opened", function () {
  var doc = helpers.loadApp().window.document;
  assert.equal(panel(doc).hidden, true);
});

test("opening a holding shows what it is, what it is worth and what it returned", function () {
  var f = seeded();
  var h = f.holding("KDI Save", { account: "Savings", rate: 4.5, instrument: "Money market" });
  for (var i = 12; i >= 0; i--) {
    record(f, { holdingId: h.id, period: period(f, i), balance: 50000 + (12 - i) * 500, income: 180 });
  }

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);

  assert.equal(panel(doc).hidden, false);
  assert.equal(doc.getElementById("rowPanelTitle").textContent, "KDI Save");
  var body = doc.getElementById("rowPanelBody").textContent;
  assert.match(body, /Maybank · Savings · Money market/);
  assert.match(body, /RM 56,000/, "the value at the month being read");
  assert.match(body, /Realised yield/);
  assert.match(body, /advertised 4\.5%/, "realised beside advertised, the Fund Desk principle");
  assert.deepEqual(app.consoleErrors, []);
});

test("the months are listed as recorded, with what went in and what it earned", function () {
  var f = seeded();
  var h = f.holding("ASB", { class: "investment" });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 20000, contribution: 1000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 21500, income: 500 });

  var doc = helpers.loadApp(f.state).window.document;
  open(doc, h.id);
  var rows = doc.querySelectorAll("#rowPanelBody .ph");
  assert.ok(rows.length >= 2);
  var text = doc.getElementById("rowPanelBody").textContent;
  assert.match(text, /in RM 1,000/);
  assert.match(text, /earned RM 500/);
});

test("a carried-forward figure says so in the panel too", function () {
  var f = seeded();
  var h = f.holding("EPF", { class: "retirement" });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 90000 });

  var doc = helpers.loadApp(f.state).window.document;
  open(doc, h.id);
  assert.match(doc.getElementById("rowPanelBody").textContent, /Carried forward/);
  assert.ok(doc.querySelector("#rowPanelBody .stale-mark"));
});

test("units and unrealised gain appear for a unit-based holding", function () {
  var f = seeded();
  var h = f.holding("Public Islamic", { class: "investment", unitBased: true });
  record(f, { holdingId: h.id, period: period(f, 1), balance: 10000, units: 10000, unitPrice: 1, contribution: 10000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 11000, units: 10000, unitPrice: 1.1 });

  var doc = helpers.loadApp(f.state).window.document;
  open(doc, h.id);
  var body = doc.getElementById("rowPanelBody").textContent;
  assert.match(body, /Units/);
  assert.match(body, /10,000/);
  assert.match(body, /Unrealised/);
});

test("a financed asset shows its equity, which no total is allowed to add", function () {
  var f = seeded();
  var loan = f.l.schema.newLiability("dev-1");
  loan.name = "Mortgage";
  loan.type = "mortgage";
  f.state.liabilities.push(loan);
  var home = f.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  home.linkedLiabilityId = loan.id;
  f.state.assets.push(home);
  record(f, { assetId: home.id, period: period(f, 0), balance: 500000 });
  record(f, { liabilityId: loan.id, period: period(f, 0), balance: 320000 });

  var doc = helpers.loadApp(f.state).window.document;
  open(doc, home.id);
  var body = doc.getElementById("rowPanelBody").textContent;
  assert.match(body, /Equity/);
  assert.match(body, /RM 180,000/);
  assert.match(body, /RM 320,000.00 owed on Mortgage/);
});

test("a loan shows its terms and offers its schedule", function () {
  var f = seeded();
  var car = f.l.schema.newLiability("dev-1");
  car.name = "Car loan";
  car.type = "hire purchase";
  car.rateBasis = "flat";
  car.ratePct = 3.4;
  car.instalment = 1250;
  car.tenureMonths = 84;
  f.state.liabilities.push(car);
  record(f, { liabilityId: car.id, period: period(f, 0), balance: 60000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, car.id);
  var body = doc.getElementById("rowPanelBody").textContent;
  assert.match(body, /Flat rate/);
  assert.match(body, /3\.4%/);
  assert.match(body, /RM 1,250/);
  assert.match(body, /84 months/);

  doc.getElementById("panelSchedule").click();
  assert.ok(doc.getElementById("v-loans").classList.contains("on"), "the schedule is one click away");
});

test("the panel follows an edit made in the sheet behind it", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);
  assert.match(doc.getElementById("rowPanelBody").textContent, /RM 40,000/);

  var cell = doc.getElementById("cell_" + h.id);
  cell.value = "44000";
  cell.dispatchEvent(new app.window.FocusEvent("blur"));

  assert.match(doc.getElementById("rowPanelBody").textContent, /RM 44,000/, "a view, not a snapshot");
});

test("Escape closes the panel and gives the keyboard its place back", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);
  assert.equal(doc.activeElement.id, "rowPanelTitle");

  doc.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(panel(doc).hidden, true);
  assert.equal(doc.activeElement.id, "open_" + h.id);
});

test("the close button closes it too", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });
  var doc = helpers.loadApp(f.state).window.document;
  open(doc, h.id);
  doc.getElementById("rowPanelClose").click();
  assert.equal(panel(doc).hidden, true);
});

test("clicking a row's value cell edits it rather than opening the panel", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("cell_" + h.id).dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  assert.equal(panel(doc).hidden, true);
});

test("a deleted holding cannot leave a panel open over nothing", function () {
  var f = seeded();
  // No figures recorded against it, so it can actually be deleted: a holding with
  // valuations is refused by referential integrity, which is a different test.
  var h = f.holding("Savings");

  // Deleting asks for confirmation, so the test answers it.
  var app = helpers.loadApp(f.state, function (win) { win.confirm = function () { return true; }; });
  var doc = app.window.document;
  open(doc, h.id);
  doc.querySelector("[data-edit-hold]").click();
  doc.getElementById("holdDelete").click();

  assert.equal(panel(doc).hidden, true);
  assert.deepEqual(app.consoleErrors, []);
});

test("a name typed into a holding cannot inject markup through the panel (SEC-7)", function () {
  var f = seeded();
  var h = f.holding("<img src=x onerror=alert(1)>");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 100 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);
  assert.equal(doc.querySelectorAll("#rowPanel img").length, 0);
  assert.equal(doc.getElementById("rowPanelTitle").textContent, "<img src=x onerror=alert(1)>");
  assert.deepEqual(app.consoleErrors, []);
});

// The close button was reported dead in a browser holding a stale copy of app.js against
// fresh markup. Binding it directly meant one missed wiring left the panel with no way
// out; delegation keeps it working however the panel is drawn, and a click outside is a
// second way out.
test("closing is delegated, so it works even after the panel is redrawn", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);

  // Redraw the panel the way a save does, then close it.
  var cell = doc.getElementById("cell_" + h.id);
  cell.value = "41000";
  cell.dispatchEvent(new app.window.FocusEvent("blur"));
  assert.equal(panel(doc).hidden, false);

  doc.getElementById("rowPanelClose").dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  assert.equal(panel(doc).hidden, true);
});

test("a click outside the panel closes it, a click inside does not", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 40000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, h.id);

  doc.getElementById("rowPanelBody").dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  assert.equal(panel(doc).hidden, false, "reading the panel does not dismiss it");

  doc.getElementById("worthKpis").dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  assert.equal(panel(doc).hidden, true);
});

test("opening one row straight from another swaps the panel rather than closing it", function () {
  var f = seeded();
  var a = f.holding("Savings");
  var b = f.holding("ASB", { class: "investment" });
  record(f, { holdingId: a.id, period: period(f, 0), balance: 40000 });
  record(f, { holdingId: b.id, period: period(f, 0), balance: 20000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  open(doc, a.id);
  doc.getElementById("open_" + b.id).dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

  assert.equal(panel(doc).hidden, false);
  assert.equal(doc.getElementById("rowPanelTitle").textContent, "ASB");
});
