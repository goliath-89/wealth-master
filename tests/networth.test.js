"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Kenanga";
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.liquid = true;
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "KDI Save";
  s.holdings.push(h);

  return { l: l, n: l.networth, v: l.valuations, state: s, inst: inst, acct: acct, h: h };
}

function record(s, subject, period, balance) {
  var entry = { period: period, balance: balance };
  if (subject.kind === "liability") entry.liabilityId = subject.id;
  else entry.holdingId = subject.id;
  s.v.upsertValuation(s.state, entry, "dev-1");
}

function addLiability(s, name, balance, period) {
  var l = s.l.schema.newLiability("dev-1");
  l.name = name;
  s.state.liabilities.push(l);
  if (balance !== undefined) record(s, { kind: "liability", id: l.id }, period, balance);
  return l;
}

// --- carry forward ----------------------------------------------------------

test("a recorded month uses its own figure and is not stale", function () {
  var s = setup();
  record(s, s.h, "2026-08", 50000);
  var pos = s.n.positionFor(s.state, s.h.id, "2026-08");
  assert.equal(pos.balance, 50000);
  assert.equal(pos.stale, false);
  assert.equal(pos.monthsStale, 0);
});

test("a skipped month carries the last balance forward and marks it stale", function () {
  var s = setup();
  record(s, s.h, "2026-06", 50000);
  var pos = s.n.positionFor(s.state, s.h.id, "2026-09");
  assert.equal(pos.balance, 50000, "the figure carries rather than vanishing");
  assert.equal(pos.stale, true);
  assert.equal(pos.sourcePeriod, "2026-06", "must say where the number came from");
  assert.equal(pos.monthsStale, 3);
});

test("a subject with nothing ever recorded is absent, not zero", function () {
  var s = setup();
  assert.equal(s.n.positionFor(s.state, s.h.id, "2026-08"), null,
    "an account opened later must not appear in earlier months");
});

test("a balance recorded as zero is used, not treated as missing", function () {
  var s = setup();
  record(s, s.h, "2026-07", 50000);
  record(s, s.h, "2026-08", 0);
  var pos = s.n.positionFor(s.state, s.h.id, "2026-08");
  assert.equal(pos.balance, 0, "an emptied account must not carry its old balance");
  assert.equal(pos.stale, false);
});

test("a note-only month has no balance, so the prior figure carries", function () {
  var s = setup();
  record(s, s.h, "2026-07", 50000);
  s.v.upsertValuation(s.state, { holdingId: s.h.id, period: "2026-08", note: "statement late" }, "dev-1");
  var pos = s.n.positionFor(s.state, s.h.id, "2026-08");
  assert.equal(pos.balance, 50000);
  assert.equal(pos.stale, true);
  assert.equal(pos.sourcePeriod, "2026-07");
});

// --- totals -----------------------------------------------------------------

test("net worth is assets minus liabilities", function () {
  var s = setup();
  record(s, s.h, "2026-08", 50000);
  addLiability(s, "Car loan", 30000, "2026-08");

  var pos = s.n.positionAt(s.state, "2026-08");
  assert.equal(pos.assets, 50000);
  assert.equal(pos.liabilities, 30000);
  assert.equal(pos.net, 20000);
});

test("net worth can be negative without special-casing", function () {
  var s = setup();
  record(s, s.h, "2026-08", 5000);
  addLiability(s, "Mortgage", 400000, "2026-08");
  assert.equal(s.n.positionAt(s.state, "2026-08").net, -395000);
});

test("the total reconciles exactly to the sum of its lines (AC-1)", function () {
  var s = setup();
  var h2 = s.l.schema.newHolding("dev-1");
  h2.accountId = s.acct.id;
  h2.name = "ASN Sukuk";
  s.state.holdings.push(h2);

  record(s, s.h, "2026-08", 1234.56);
  record(s, h2, "2026-08", 8765.44);
  addLiability(s, "Loan", 2000.5, "2026-08");

  var pos = s.n.positionAt(s.state, "2026-08");
  var assetLines = pos.lines.filter(function (l) { return l.kind === "holding"; })
    .reduce(function (n, l) { return n + l.balance; }, 0);
  var liabLines = pos.lines.filter(function (l) { return l.kind === "liability"; })
    .reduce(function (n, l) { return n + l.balance; }, 0);
  assert.equal(assetLines, pos.assets);
  assert.equal(liabLines, pos.liabilities);
  assert.equal(pos.net, pos.assets - pos.liabilities);
});

test("liquid and illiquid split by the account's flag and sum to total assets", function () {
  var s = setup();
  var frozen = s.l.schema.newAccount("dev-1");
  frozen.institutionId = s.inst.id;
  frozen.name = "EPF";
  frozen.liquid = false;
  s.state.accounts.push(frozen);

  var h2 = s.l.schema.newHolding("dev-1");
  h2.accountId = frozen.id;
  h2.name = "Akaun 1";
  s.state.holdings.push(h2);

  record(s, s.h, "2026-08", 20000);
  record(s, h2, "2026-08", 80000);

  var pos = s.n.positionAt(s.state, "2026-08");
  assert.equal(pos.liquid, 20000);
  assert.equal(pos.illiquid, 80000);
  assert.equal(pos.liquid + pos.illiquid, pos.assets);
});

test("holdings in an archived account leave current totals but keep their history", function () {
  var s = setup();
  record(s, s.h, "2026-08", 50000);
  assert.equal(s.n.positionAt(s.state, "2026-08").assets, 50000);

  s.acct.archived = true;
  assert.equal(s.n.positionAt(s.state, "2026-08").assets, 0);
  assert.equal(s.v.valuationFor(s.state, s.h.id, "2026-08").balance, 50000, "history intact");
});

test("a tombstoned liability drops out of the total", function () {
  var s = setup();
  record(s, s.h, "2026-08", 50000);
  var loan = addLiability(s, "Car loan", 30000, "2026-08");
  loan.deleted = true;
  assert.equal(s.n.positionAt(s.state, "2026-08").net, 50000);
});

// --- staleness reporting ----------------------------------------------------

test("a position is flagged partial when any line is carried forward", function () {
  var s = setup();
  var h2 = s.l.schema.newHolding("dev-1");
  h2.accountId = s.acct.id;
  h2.name = "Stale one";
  s.state.holdings.push(h2);

  record(s, s.h, "2026-08", 10000);
  record(s, h2, "2026-05", 5000);

  var pos = s.n.positionAt(s.state, "2026-08");
  assert.equal(pos.assets, 15000, "the carried figure still counts");
  assert.equal(pos.staleCount, 1);
  assert.equal(pos.partial, true);

  var staleLine = pos.lines.filter(function (l) { return l.stale; })[0];
  assert.equal(staleLine.name, "Stale one");
  assert.equal(staleLine.monthsStale, 3);
});

test("a fully up-to-date month is not partial", function () {
  var s = setup();
  record(s, s.h, "2026-08", 10000);
  var pos = s.n.positionAt(s.state, "2026-08");
  assert.equal(pos.staleCount, 0);
  assert.equal(pos.partial, false);
});

// --- series -----------------------------------------------------------------

test("the series covers every month between first and last entry, filling gaps", function () {
  var s = setup();
  record(s, s.h, "2026-06", 1000);
  record(s, s.h, "2026-09", 4000);

  var out = s.n.series(s.state);
  assert.deepEqual(out.map(function (p) { return p.period; }),
    ["2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.equal(out[1].net, 1000, "July carries June forward");
  assert.equal(out[1].partial, true);
  assert.equal(out[3].net, 4000);
  assert.equal(out[3].partial, false);
});

test("the series spans a year boundary correctly", function () {
  var s = setup();
  record(s, s.h, "2025-11", 100);
  record(s, s.h, "2026-01", 300);
  assert.deepEqual(s.n.series(s.state).map(function (p) { return p.period; }),
    ["2025-11", "2025-12", "2026-01"]);
});

test("an empty store yields an empty series rather than throwing", function () {
  var s = setup();
  assert.deepEqual(s.n.series(s.state), []);
});

test("the series can be extended to a later month than the last entry", function () {
  var s = setup();
  record(s, s.h, "2026-06", 1000);
  var out = s.n.series(s.state, "2026-08");
  assert.equal(out.length, 3);
  assert.equal(out[2].period, "2026-08");
  assert.equal(out[2].net, 1000, "carried forward");
  assert.equal(out[2].partial, true);
});

test("changeBetween reports the movement and its percentage", function () {
  var s = setup();
  record(s, s.h, "2026-07", 10000);
  record(s, s.h, "2026-08", 11000);
  var out = s.n.series(s.state);
  var ch = s.n.changeBetween(out[0], out[1]);
  assert.equal(ch.delta, 1000);
  assert.equal(Math.round(ch.pct), 10);
});

test("percentage change is null rather than Infinity when starting from zero", function () {
  var s = setup();
  record(s, s.h, "2026-07", 0);
  record(s, s.h, "2026-08", 500);
  var out = s.n.series(s.state);
  var ch = s.n.changeBetween(out[0], out[1]);
  assert.equal(ch.delta, 500);
  assert.equal(ch.pct, null);
});

test("monthsBetween handles year boundaries and rejects nonsense", function () {
  var n = setup().n;
  assert.equal(n.monthsBetween("2025-11", "2026-02"), 3);
  assert.equal(n.monthsBetween("2026-02", "2026-02"), 0);
  assert.equal(n.monthsBetween("bad", "2026-02"), null);
});
