"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Provider";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Retirement";
  acct.class = "retirement";
  s.accounts.push(acct);

  return { l: l, r: l.relief, v: l.valuations, state: s, acct: acct };
}

function addHolding(s, name, reliefCategory) {
  var h = s.l.schema.newHolding("dev-1");
  h.accountId = s.acct.id;
  h.name = name;
  h.reliefCategory = reliefCategory || null;
  s.state.holdings.push(h);
  return h;
}

function rec(s, holdingId, period, contribution, withdrawal) {
  s.v.upsertValuation(s.state, {
    holdingId: holdingId, period: period, balance: 10000,
    contribution: contribution, withdrawal: withdrawal
  }, "dev-1");
}

test("only tagged holdings count toward relief", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  var plain = addHolding(s, "Unit trust", null);
  rec(s, prs.id, "2026-03", 3000);
  rec(s, plain.id, "2026-03", 9000);

  var t = s.r.totalsFor(s.state, 2026);
  assert.equal(t.lines.length, 1);
  assert.equal(t.lines[0].key, "prs");
  assert.equal(t.lines[0].contributed, 3000);
});

test("contributions are summed across the calendar year", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-01", 500);
  rec(s, prs.id, "2026-06", 500);
  rec(s, prs.id, "2026-12", 500);
  assert.equal(s.r.totalsFor(s.state, 2026).lines[0].contributed, 1500);
});

test("another year's contributions are excluded", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2025-12", 3000);
  rec(s, prs.id, "2026-01", 1000);
  assert.equal(s.r.totalsFor(s.state, 2026).lines[0].contributed, 1000);
});

test("withdrawals in the same year are netted off", function () {
  var s = setup();
  var sspn = addHolding(s, "SSPN", "sspn");
  rec(s, sspn.id, "2026-03", 8000, 0);
  rec(s, sspn.id, "2026-09", 0, 3000);
  var line = s.r.totalsFor(s.state, 2026).lines[0];
  // SSPN relief is assessed net of withdrawals; reporting the gross would overstate it.
  assert.equal(line.contributed, 8000);
  assert.equal(line.withdrawn, 3000);
  assert.equal(line.net, 5000);
  assert.equal(line.claimable, 5000);
});

test("a contribution above the limit is capped, and flagged", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 5000);
  var line = s.r.totalsFor(s.state, 2026).lines[0];
  assert.equal(line.net, 5000);
  assert.equal(line.claimable, 3000, "capped at the limit");
  assert.equal(line.overLimit, true);
  assert.equal(line.headroom, 0);
});

test("headroom reports what could still be contributed", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 1200);
  var line = s.r.totalsFor(s.state, 2026).lines[0];
  assert.equal(line.headroom, 1800);
  assert.equal(line.overLimit, false);
});

test("limits can be overridden, because they change between assessment years", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 5000);
  assert.equal(s.r.limitFor(s.state, "prs"), 3000, "the default");

  s.state.settings.reliefLimits = { prs: 6000 };
  assert.equal(s.r.limitFor(s.state, "prs"), 6000);
  var line = s.r.totalsFor(s.state, 2026).lines[0];
  assert.equal(line.claimable, 5000, "now under the raised limit");
  assert.equal(line.overLimit, false);
});

test("a category with no limit set claims the whole net amount", function () {
  var s = setup();
  var other = addHolding(s, "Something else", "other");
  rec(s, other.id, "2026-03", 2500);
  var line = s.r.totalsFor(s.state, 2026).lines[0];
  assert.equal(line.limit, 0);
  assert.equal(line.claimable, 2500);
  assert.equal(line.headroom, null, "no limit means no headroom to report");
});

test("several categories total together, each capped on its own", function () {
  var s = setup();
  var epf = addHolding(s, "EPF voluntary", "epf");
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, epf.id, "2026-03", 9000);   // above the RM 4,000 default
  rec(s, prs.id, "2026-03", 2000);   // within RM 3,000

  var t = s.r.totalsFor(s.state, 2026);
  assert.equal(t.lines.length, 2);
  assert.equal(t.totalClaimable, 6000, "4,000 capped plus 2,000");
  assert.equal(t.totalContributed, 11000, "what was actually paid in");
});

test("a category with nothing contributed is omitted rather than shown as zero", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  addHolding(s, "SSPN", "sspn");
  rec(s, prs.id, "2026-03", 1000);
  var t = s.r.totalsFor(s.state, 2026);
  assert.equal(t.lines.length, 1);
});

test("years with contributions are listed newest first", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2024-03", 1000);
  rec(s, prs.id, "2026-03", 1000);
  rec(s, prs.id, "2025-03", 1000);
  assert.deepEqual(s.r.yearsWithContributions(s.state), ["2026", "2025", "2024"]);
});

test("a year with no tagged contributions yields nothing to report", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 1000);
  var t = s.r.totalsFor(s.state, 2020);
  assert.deepEqual(t.lines, []);
  assert.equal(t.totalClaimable, 0);
});

test("tombstoned holdings and valuations are excluded", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 1000);
  s.state.valuations[0].deleted = true;
  assert.deepEqual(s.r.totalsFor(s.state, 2026).lines, []);

  s.state.valuations[0].deleted = false;
  prs.deleted = true;
  assert.deepEqual(s.r.totalsFor(s.state, 2026).lines, []);
});

test("totals are marked illustrative — this reports contributions, not tax", function () {
  var s = setup();
  var prs = addHolding(s, "PRS fund", "prs");
  rec(s, prs.id, "2026-03", 1000);
  assert.equal(s.r.totalsFor(s.state, 2026).illustrative, true);
});

test("v7 -> v8 migration gives existing holdings an explicit null relief category", function () {
  var s = setup();
  var out = s.l.store.migrate({
    schemaVersion: 7,
    holdings: [{ id: "h1", name: "Fund", accountId: "a1" }]
  });
  assert.equal(out.schemaVersion, s.l.schema.SCHEMA_VERSION);
  assert.equal(out.holdings[0].reliefCategory, null);
  assert.equal(out.holdings[0].name, "Fund");
});
