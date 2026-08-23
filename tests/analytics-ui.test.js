"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var period = l.valuations.currentPeriod();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Kenanga";
  inst.pidmMember = true;
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = opts.class || "investment";
  acct.pidmProtected = !!opts.pidm;
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "KDI Save";
  h.rate = opts.rate === undefined ? 4.5 : opts.rate;
  h.feePct = opts.fee === undefined ? 0 : opts.fee;
  s.holdings.push(h);

  (opts.months || []).forEach(function (m, i) {
    l.valuations.upsertValuation(s, {
      holdingId: h.id,
      period: l.loans.addMonths(period, -(opts.months.length - 1 - i)),
      balance: m.balance, income: m.income
    }, "dev-1");
  });

  return { l: l, state: s, inst: inst, acct: acct, h: h, period: period };
}

test("realised yield is shown against the advertised rate on each holding", function () {
  var f = seeded({
    rate: 4.5,
    months: [{ balance: 50000, income: 166.67 }, { balance: 50000, income: 166.67 }]
  });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.querySelector('.tab[data-v="accounts"]').click();

  var text = doc.getElementById("tree").textContent;
  assert.match(text, /4\.5% advertised/);
  assert.match(text, /4\.00% realised/, "what it actually paid");
  assert.match(text, /2 months/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a holding that underperformed its advertised rate is marked down", function () {
  var f = seeded({
    rate: 4.5,
    months: [{ balance: 50000, income: 166.67 }, { balance: 50000, income: 166.67 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector('.tab[data-v="accounts"]').click();
  assert.ok(doc.querySelector("#tree .yield.dn"), "4.00% realised against 4.5% advertised is a shortfall");
});

test("net of fees is shown when the holding charges any", function () {
  var f = seeded({
    rate: 4.5, fee: 0.5,
    months: [{ balance: 50000, income: 166.67 }, { balance: 50000, income: 166.67 }]
  });
  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector('.tab[data-v="accounts"]').click();
  assert.match(doc.getElementById("tree").textContent, /3\.50% net/);
});

test("a holding with no income recorded shows no yield rather than zero", function () {
  var f = seeded({ months: [{ balance: 50000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector('.tab[data-v="accounts"]').click();
  assert.equal(doc.querySelector("#tree .yield"), null);
});

test("the allocation donut renders as inline SVG with a legend", function () {
  var f = seeded({ months: [{ balance: 75000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;

  var svg = doc.querySelector("#allocChart svg");
  assert.ok(svg, "must be hand-rolled SVG, not a charting library");
  assert.equal(svg.getAttribute("role"), "img");
  // Legend carries label and figure, so colour is never the only signal (NFR-9).
  assert.match(doc.getElementById("allocLegend").textContent, /investment/);
  assert.match(doc.getElementById("allocLegend").textContent, /100\.0%/);
});

test("the allocation dimension can be switched", function () {
  var f = seeded({ months: [{ balance: 75000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;

  var sel = doc.getElementById("allocDim");
  assert.ok(sel.options.length >= 5, "every declared dimension must be offered");
  sel.value = "institution";
  sel.onchange();
  assert.match(doc.getElementById("allocLegend").textContent, /Kenanga/);
});

test("a single holding draws a full ring rather than a degenerate arc", function () {
  var f = seeded({ months: [{ balance: 75000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;
  assert.ok(doc.querySelector("#allocChart circle"), "one slice must render as a circle");
  assert.equal(doc.querySelector("#allocChart path"), null);
});

test("with nothing recorded the donut says so instead of drawing an empty ring", function () {
  var doc = helpers.loadApp().window.document;
  assert.match(doc.getElementById("allocChart").textContent, /Nothing recorded to allocate/);
});

test("deposits over the PIDM limit raise a warning naming the bank and the excess", function () {
  var f = seeded({ class: "cash", pidm: true, months: [{ balance: 300000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;

  assert.notEqual(doc.getElementById("pidmWrap").style.display, "none");
  var text = doc.getElementById("pidmNote").textContent;
  assert.match(text, /Kenanga/);
  assert.match(text, /RM 50,000\.00 above/);
  assert.match(text, /per depositor per member bank/);
});

test("no PIDM warning appears when cover is not exceeded", function () {
  var f = seeded({ class: "cash", pidm: true, months: [{ balance: 100000, income: null }] });
  var doc = helpers.loadApp(f.state).window.document;
  assert.equal(doc.getElementById("pidmWrap").style.display, "none");
});

test("SEC-7: an institution name containing HTML is escaped in the legend", function () {
  var f = seeded({ months: [{ balance: 75000, income: null }] });
  f.inst.name = '<img src=x onerror="window.__pwned=1">';
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  doc.getElementById("allocDim").value = "institution";
  doc.getElementById("allocDim").onchange();

  assert.equal(app.window.__pwned, undefined);
  assert.equal(doc.querySelectorAll("#allocLegend img").length, 0);
});
