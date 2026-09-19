"use strict";
// P7.1: point at the trend chart and read the month.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(months, opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  var a = l.schema.newAccount("dev-1");
  a.institutionId = inst.id; a.name = "Savings"; a.class = "cash";
  s.accounts.push(a);
  var h = l.schema.newHolding("dev-1");
  h.accountId = a.id; h.name = "Savings";
  s.holdings.push(h);
  var loan = l.schema.newLiability("dev-1");
  loan.name = opts.loanName || "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4; loan.tenureMonths = 60; loan.instalment = 1104.99;
  s.liabilities.push(loan);

  var p = l.valuations.currentPeriod();
  var periods = [];
  for (var i = 0; i < months; i++) { periods.unshift(p); p = l.valuations.prevPeriod(p); }
  periods.forEach(function (period, i) {
    l.valuations.upsertValuation(s, { holdingId: h.id, period: period, balance: 10000 + i * 1000 }, "dev-1");
    if (!(opts.skipLoanLast && i === periods.length - 1)) {
      l.valuations.upsertValuation(s, { liabilityId: loan.id, period: period, balance: 24000 - i * 500 }, "dev-1");
    }
  });
  return s;
}

function chart(state) {
  var app = helpers.loadApp(state);
  var doc = app.window.document;
  return { app: app, doc: doc, host: doc.getElementById("worthChart"), svg: doc.querySelector("#worthChart svg.chart") };
}

function key(c, k) {
  c.svg.dispatchEvent(new c.app.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
}

test("the trend chart is hidden-tooltip until you point at it", function () {
  var c = chart(seeded(6));
  var tip = c.host.querySelector(".hv-tip");
  assert.ok(tip, "a tooltip element exists");
  assert.equal(tip.hidden, true);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("a month shows net worth, assets, liabilities and the move since last month", function () {
  var c = chart(seeded(6));
  key(c, "End");
  var tip = c.host.querySelector(".hv-tip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Net worth/);
  assert.match(tip.textContent, /Assets/);
  assert.match(tip.textContent, /Liabilities/);
  assert.match(tip.textContent, /Since last month/);
  assert.match(tip.textContent, /[A-Z][a-z]+ \d{4}/, "the month, spelled out");
  assert.match(tip.textContent, /RM 15,000\.00/, "the latest month's assets");
});

test("arrow keys walk month by month, and Escape closes it", function () {
  var c = chart(seeded(6));
  key(c, "Home");
  var first = c.host.querySelector(".hv-tip").textContent;
  assert.equal(/Since last month/.test(first), false, "the first month has nothing to compare with");
  key(c, "ArrowRight");
  assert.notEqual(c.host.querySelector(".hv-tip").textContent, first);
  key(c, "Escape");
  assert.equal(c.host.querySelector(".hv-tip").hidden, true);
  assert.equal(c.host.querySelector(".hv").style.display, "none");
});

test("pointing with the mouse snaps to the nearest month", function () {
  var c = chart(seeded(6));
  // jsdom has no layout: give the chart a width so the pointer maths has something to use.
  c.svg.getBoundingClientRect = function () { return { left: 0, top: 0, width: 720, height: 240 }; };
  var Ev = c.app.window.MouseEvent;
  var ev = new Ev("pointermove", { clientX: 700, bubbles: true });
  c.svg.dispatchEvent(ev);
  assert.match(c.host.querySelector(".hv-tip").textContent, /RM 15,000\.00/, "far right is the latest month");
  c.svg.dispatchEvent(new Ev("pointermove", { clientX: 60, bubbles: true }));
  assert.match(c.host.querySelector(".hv-tip").textContent, /RM 10,000\.00/, "far left is the earliest");
  c.svg.dispatchEvent(new Ev("pointerleave", { bubbles: true }));
  assert.equal(c.host.querySelector(".hv-tip").hidden, true);
});

test("a month resting on carried-forward figures says so in words, not just a mark", function () {
  var c = chart(seeded(4, { skipLoanLast: true }));
  key(c, "End");
  var tip = c.host.querySelector(".hv-tip");
  assert.ok(tip.querySelector(".stale-mark"), "the asterisk");
  assert.match(tip.textContent, /carried forward/i, "and the sentence");
});

test("the chart can be reached and read from the keyboard", function () {
  var c = chart(seeded(6));
  assert.equal(c.svg.getAttribute("tabindex"), "0");
  assert.match(c.svg.getAttribute("aria-label"), /arrow keys/i);
});

test("redrawing does not stack tooltips or leave listeners on stale charts", function () {
  var c = chart(seeded(6));
  c.doc.querySelector('.tab[data-v="month"]').click();
  c.doc.querySelector('.tab[data-v="worth"]').click();
  assert.equal(c.doc.querySelectorAll("#worthChart .hv-tip").length, 1);
});
