"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Kenanga";
  inst.pidmMember = true;
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = opts.class || "investment";
  acct.liquid = opts.liquid === undefined ? true : opts.liquid;
  acct.shariah = !!opts.shariah;
  acct.pidmProtected = !!opts.pidm;
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "KDI Save";
  h.rate = opts.rate === undefined ? 4 : opts.rate;
  h.feePct = opts.fee === undefined ? 0 : opts.fee;
  s.holdings.push(h);

  return { l: l, a: l.analytics, v: l.valuations, state: s, inst: inst, acct: acct, h: h };
}

function rec(s, holdingId, period, balance, income) {
  s.v.upsertValuation(s.state, {
    holdingId: holdingId, period: period, balance: balance, income: income
  }, "dev-1");
}

// --- realised yield (FR-1.4) ------------------------------------------------

test("realised yield annualises mean income over mean balance", function () {
  var s = setup();
  // RM 50,000 earning RM 166.67 a month is 4.0% a year.
  rec(s, s.h.id, "2026-06", 50000, 166.67);
  rec(s, s.h.id, "2026-07", 50000, 166.67);
  rec(s, s.h.id, "2026-08", 50000, 166.67);

  var y = s.a.realisedYield(s.state, s.h.id);
  assert.equal(y.months, 3);
  assert.ok(Math.abs(y.pct - 4) < 0.01, "expected about 4%, got " + y.pct);
  assert.equal(y.averageBalance, 50000);
});

test("a month with no income recorded is excluded, not counted as zero", function () {
  var s = setup();
  rec(s, s.h.id, "2026-06", 50000, 166.67);
  rec(s, s.h.id, "2026-07", 50000, null); // statement not in yet
  rec(s, s.h.id, "2026-08", 50000, 166.67);

  var y = s.a.realisedYield(s.state, s.h.id);
  assert.equal(y.months, 2, "an unknown month must not drag the average down");
  assert.ok(Math.abs(y.pct - 4) < 0.01);
});

test("a recorded income of zero does count — that is a real result", function () {
  var s = setup();
  rec(s, s.h.id, "2026-07", 50000, 166.67);
  rec(s, s.h.id, "2026-08", 50000, 0);
  var y = s.a.realisedYield(s.state, s.h.id);
  assert.equal(y.months, 2);
  assert.ok(y.pct < 4, "a month that paid nothing must pull the yield down");
});

test("realised yield is null when nothing has been recorded", function () {
  var s = setup();
  assert.equal(s.a.realisedYield(s.state, s.h.id), null);
});

test("net of fees subtracts the fee and compares against the advertised rate", function () {
  var s = setup({ rate: 4.5, fee: 0.5 });
  rec(s, s.h.id, "2026-07", 50000, 166.67);
  rec(s, s.h.id, "2026-08", 50000, 166.67);

  var n = s.a.netOfFees(s.state, s.h);
  assert.ok(Math.abs(n.realisedPct - 4) < 0.01);
  assert.equal(n.feePct, 0.5);
  assert.ok(Math.abs(n.netPct - 3.5) < 0.01);
  assert.equal(n.advertisedPct, 4.5);
  // The Fund Desk point: it advertised 4.5% and actually paid about 4%.
  assert.ok(n.versusAdvertised < 0);
});

test("fee drag reports annual fees in ringgit", function () {
  var s = setup({ fee: 0.48 });
  rec(s, s.h.id, "2026-08", 50000, 166.67);
  var drag = s.a.feeDrag(s.state, "2026-08");
  assert.equal(drag.totalAnnualFee, 240, "0.48% of RM 50,000");
  assert.equal(drag.lines[0].name, "KDI Save");
});

test("a zero-fee holding contributes nothing to fee drag", function () {
  var s = setup({ fee: 0 });
  rec(s, s.h.id, "2026-08", 50000, 100);
  assert.equal(s.a.feeDrag(s.state, "2026-08").totalAnnualFee, 0);
  assert.equal(s.a.feeDrag(s.state, "2026-08").lines.length, 0);
});

// --- allocation (FR-4.3) ----------------------------------------------------

test("allocation splits by class and the shares sum to 100", function () {
  var s = setup({ class: "investment" });
  var cash = s.l.schema.newAccount("dev-1");
  cash.institutionId = s.inst.id;
  cash.name = "Savings";
  cash.class = "cash";
  s.state.accounts.push(cash);
  var h2 = s.l.schema.newHolding("dev-1");
  h2.accountId = cash.id;
  h2.name = "Current";
  s.state.holdings.push(h2);

  rec(s, s.h.id, "2026-08", 75000, null);
  rec(s, h2.id, "2026-08", 25000, null);

  var alloc = s.a.allocation(s.state, "2026-08", "class");
  assert.equal(alloc.total, 100000);
  assert.equal(alloc.slices[0].label, "investment");
  assert.equal(alloc.slices[0].share, 75);
  assert.equal(alloc.slices[1].share, 25);
  assert.equal(Math.round(alloc.slices.reduce(function (n, x) { return n + x.share; }, 0)), 100);
});

test("allocation is available across every declared dimension", function () {
  var s = setup({ shariah: true, pidm: true, liquid: false });
  rec(s, s.h.id, "2026-08", 50000, null);
  Object.keys(s.a.DIMENSIONS).forEach(function (dim) {
    var alloc = s.a.allocation(s.state, "2026-08", dim);
    assert.equal(alloc.total, 50000, dim + " must still total correctly");
    assert.ok(alloc.slices.length >= 1, dim + " must produce a slice");
  });
});

test("allocation counts physical assets but never liabilities", function () {
  var s = setup();
  rec(s, s.h.id, "2026-08", 50000, null);

  var home = s.l.schema.newAsset("dev-1");
  home.name = "Family home";
  home.class = "property";
  s.state.assets.push(home);
  s.v.upsertValuation(s.state, { assetId: home.id, period: "2026-08", balance: 500000 }, "dev-1");

  var loan = s.l.schema.newLiability("dev-1");
  loan.name = "Mortgage";
  s.state.liabilities.push(loan);
  s.v.upsertValuation(s.state, { liabilityId: loan.id, period: "2026-08", balance: 380000 }, "dev-1");

  var alloc = s.a.allocation(s.state, "2026-08", "class");
  assert.equal(alloc.total, 550000, "debt must not appear in a share-of-assets chart");
  assert.ok(alloc.slices.some(function (x) { return x.label === "property"; }));
});

test("a carried-forward balance still counts toward allocation", function () {
  var s = setup();
  rec(s, s.h.id, "2026-05", 50000, null);
  assert.equal(s.a.allocation(s.state, "2026-08", "class").total, 50000);
});

test("allocation of an empty store is empty rather than an error", function () {
  var s = setup();
  var alloc = s.a.allocation(s.state, "2026-08", "class");
  assert.equal(alloc.total, 0);
  assert.deepEqual(alloc.slices, []);
});

// --- PIDM exposure (FR-4.4) -------------------------------------------------

test("deposits over RM 250,000 at one member bank are flagged", function () {
  var s = setup({ class: "cash", pidm: true });
  rec(s, s.h.id, "2026-08", 300000, null);

  var exp = s.a.pidmExposure(s.state, "2026-08");
  assert.equal(exp.length, 1);
  assert.equal(exp[0].institution, "Kenanga");
  assert.equal(exp[0].overLimit, true);
  assert.equal(exp[0].excess, 50000);
});

test("cover is aggregated across accounts at the same institution", function () {
  var s = setup({ class: "cash", pidm: true });
  var second = s.l.schema.newAccount("dev-1");
  second.institutionId = s.inst.id;
  second.name = "FD";
  second.pidmProtected = true;
  s.state.accounts.push(second);
  var h2 = s.l.schema.newHolding("dev-1");
  h2.accountId = second.id;
  s.state.holdings.push(h2);

  rec(s, s.h.id, "2026-08", 200000, null);
  rec(s, h2.id, "2026-08", 100000, null);

  var exp = s.a.pidmExposure(s.state, "2026-08");
  assert.equal(exp.length, 1, "the limit is per bank, not per account");
  assert.equal(exp[0].protectedTotal, 300000);
  assert.equal(exp[0].excess, 50000);
});

test("unprotected accounts are excluded from the exposure calculation", function () {
  var s = setup({ class: "investment", pidm: false });
  rec(s, s.h.id, "2026-08", 900000, null);
  assert.deepEqual(s.a.pidmExposure(s.state, "2026-08"), [],
    "a unit trust is not a protected deposit however large");
});

test("a protected balance under the limit is reported without a flag", function () {
  var s = setup({ class: "cash", pidm: true });
  rec(s, s.h.id, "2026-08", 100000, null);
  var exp = s.a.pidmExposure(s.state, "2026-08");
  assert.equal(exp[0].overLimit, false);
  assert.equal(exp[0].excess, 0);
});
