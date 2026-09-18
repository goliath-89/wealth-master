"use strict";
// Two small things the engines already knew but no screen was saying: when the debt
// clears, and what has no figure yet this month (FR-1.9).
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, cls) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls || "cash";
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  function loan(name, opts) {
    var x = l.schema.newLiability("dev-1");
    x.name = name;
    x.type = opts.type || "personal loan";
    x.rateBasis = opts.basis || "reducing";
    x.principal = opts.principal;
    x.ratePct = opts.rate;
    x.tenureMonths = opts.tenure;
    x.instalment = opts.instalment;
    s.liabilities.push(x);
    return x;
  }
  return { l: l, state: s, holding: holding, loan: loan };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}

// ---- debt-free card --------------------------------------------------------

test("the dashboard says when the last debt clears", function () {
  var f = seeded();
  var car = f.loan("Car loan", { principal: 60000, rate: 4, tenure: 60, instalment: 1104.99 });
  record(f, { liabilityId: car.id, period: period(f, 0), balance: 24000 });

  var app = helpers.loadApp(f.state);
  var text = app.window.document.getElementById("resilience").textContent;
  assert.match(text, /Debt-free/);
  assert.match(text, /[A-Z][a-z]{2} \d{4}/, "a month, not a count of months");
  assert.deepEqual(app.consoleErrors, []);
});

test("it counts from paying the minimums, which is what happens if nothing changes", function () {
  var f = seeded();
  var car = f.loan("Car loan", { principal: 60000, rate: 4, tenure: 60, instalment: 1104.99 });
  record(f, { liabilityId: car.id, period: period(f, 0), balance: 24000 });

  var doc = helpers.loadApp(f.state).window.document;
  var lib = helpers.loadLib(helpers.freshWindow());
  var base = lib.strategy.run(JSON.parse(JSON.stringify(f.state)), "minimums", 0);
  var when = lib.valuations.currentPeriod();
  for (var i = 0; i < base.monthsToDebtFree; i++) when = lib.networth.nextPeriod(when);

  var label = when.slice(0, 4);
  assert.match(doc.getElementById("resilience").textContent, new RegExp(label),
    "the year the schedule actually ends");
});

test("paying extra is shown as months saved, from the figure on the Loans screen", function () {
  var f = seeded();
  var car = f.loan("Car loan", { principal: 60000, rate: 4, tenure: 60, instalment: 1104.99 });
  record(f, { liabilityId: car.id, period: period(f, 0), balance: 24000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  var text = doc.getElementById("resilience").textContent;
  assert.match(text, /sooner with RM 500/, "the screen's own extra, not an invented one");

  // Change the extra and the card follows it.
  var extra = doc.getElementById("strat_extra");
  extra.value = "RM 2,000";
  extra.dispatchEvent(new app.window.Event("change"));
  assert.match(doc.getElementById("resilience").textContent, /sooner with RM 2,000/);
});

test("with no debt there is no card, rather than a card saying none", function () {
  var f = seeded();
  var h = f.holding("Savings");
  record(f, { holdingId: h.id, period: period(f, 0), balance: 5000 });

  var text = helpers.loadApp(f.state).window.document.getElementById("resilience").textContent;
  assert.equal(/Debt-free/.test(text), false);
});

// ---- what is due this month ------------------------------------------------

test("a figure with no entry for the month is counted as due", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  var epf = f.holding("EPF", "retirement");
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });

  var lib = helpers.loadLib(helpers.freshWindow());
  var due = lib.uiShell.dueThisMonth(f.state, lib.valuations.currentPeriod());
  assert.equal(due.count, 1);
  assert.deepEqual(due.names, ["EPF"]);
});

test("something never recorded at all is not due — it is not yet in use", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  f.holding("Opened but empty", "investment");
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 20000 });

  var lib = helpers.loadLib(helpers.freshWindow());
  assert.equal(lib.uiShell.dueThisMonth(f.state, lib.valuations.currentPeriod()).count, 0);
});

test("the count sits on the Month-end item, which is where it gets fixed", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  var epf = f.holding("EPF", "retirement");
  var car = f.loan("Car loan", { principal: 60000, rate: 4, tenure: 60, instalment: 1104.99 });
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });
  record(f, { liabilityId: car.id, period: period(f, 1), balance: 24000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });

  var doc = helpers.loadApp(f.state).window.document;
  var badge = doc.getElementById("navDue");
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "2 due");
  assert.match(badge.getAttribute("title"), /no entry for/);
  assert.ok(doc.querySelector('.tab[data-v="month"] #navDue'), "on the Month-end item");
});

test("nothing outstanding shows no badge at all", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });

  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("navDue").hidden, true);
  assert.equal(doc.getElementById("navDue").textContent, "");
});

test("recording the missing figure clears the badge without a reload", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  var epf = f.holding("EPF", "retirement");
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  assert.equal(doc.getElementById("navDue").textContent, "1 due");

  var cell = doc.getElementById("cell_" + epf.id);
  cell.value = "91000";
  cell.dispatchEvent(new app.window.FocusEvent("blur"));

  assert.equal(doc.getElementById("navDue").hidden, true);
});

test("the badge agrees with the asterisks the same figures carry elsewhere", function () {
  var f = seeded();
  var cash = f.holding("Savings");
  var epf = f.holding("EPF", "retirement");
  record(f, { holdingId: cash.id, period: period(f, 1), balance: 20000 });
  record(f, { holdingId: epf.id, period: period(f, 1), balance: 90000 });
  record(f, { holdingId: cash.id, period: period(f, 0), balance: 21000 });

  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("navDue").textContent, "1 due");
  assert.ok(doc.querySelector("#worthHero .stale-mark"), "the headline is marked too");
  assert.equal(doc.querySelectorAll("#tree .srow .stale-mark").length, 1,
    "and exactly the one row that is carried");
});
