"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  return { l: l, n: l.networth, v: l.valuations, e: l.entities, state: l.schema.blank() };
}

function addAsset(s, name, opts) {
  opts = opts || {};
  var a = s.l.schema.newAsset("dev-1");
  a.name = name;
  a.class = opts.class || "property";
  a.acquiredOn = opts.acquiredOn || null;
  a.cost = opts.cost === undefined ? null : opts.cost;
  a.liquid = !!opts.liquid;
  a.linkedLiabilityId = opts.linkedLiabilityId || null;
  s.state.assets.push(a);
  if (opts.acquiredOn && opts.cost !== undefined) {
    s.v.upsertValuation(s.state, { assetId: a.id, period: opts.acquiredOn, balance: opts.cost }, "dev-1");
  }
  return a;
}

function addLiability(s, name, period, balance) {
  var l = s.l.schema.newLiability("dev-1");
  l.name = name;
  s.state.liabilities.push(l);
  if (period) s.v.upsertValuation(s.state, { liabilityId: l.id, period: period, balance: balance }, "dev-1");
  return l;
}

// --- assets in net worth ----------------------------------------------------

test("a physical asset counts toward assets and net worth", function () {
  var s = setup();
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000 });
  var pos = s.n.positionAt(s.state, "2026-01");
  assert.equal(pos.assets, 500000);
  assert.equal(pos.net, 500000);
});

test("an asset is absent before it was acquired, not valued at today's figure", function () {
  var s = setup();
  addAsset(s, "Family home", { acquiredOn: "2026-03", cost: 500000 });
  // This is the whole reason assets carry valuations rather than one currentValue:
  // a static field would put today's estimate into every past month.
  assert.equal(s.n.positionAt(s.state, "2026-01").assets, 0);
  assert.equal(s.n.positionAt(s.state, "2026-03").assets, 500000);
});

test("a revaluation applies from its own month onward, leaving history intact", function () {
  var s = setup();
  var a = addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000 });
  s.v.upsertValuation(s.state, { assetId: a.id, period: "2026-06", balance: 560000 }, "dev-1");

  assert.equal(s.n.positionAt(s.state, "2026-01").assets, 500000, "past month keeps its own value");
  assert.equal(s.n.positionAt(s.state, "2026-05").assets, 500000);
  assert.equal(s.n.positionAt(s.state, "2026-06").assets, 560000);
  assert.equal(s.n.positionAt(s.state, "2026-09").assets, 560000, "carried forward after");
});

test("a carried asset value is marked stale like any other figure", function () {
  var s = setup();
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000 });
  var pos = s.n.positionAt(s.state, "2026-04");
  assert.equal(pos.partial, true);
  var line = pos.lines.filter(function (l) { return l.kind === "asset"; })[0];
  assert.equal(line.stale, true);
  assert.equal(line.sourcePeriod, "2026-01");
  assert.equal(line.monthsStale, 3);
});

test("assets default to illiquid and can be flagged liquid (FR-2.4)", function () {
  var s = setup();
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000 });
  var pos = s.n.positionAt(s.state, "2026-01");
  assert.equal(pos.illiquid, 500000);
  assert.equal(pos.liquid, 0);

  var s2 = setup();
  addAsset(s2, "Gold", { acquiredOn: "2026-01", cost: 20000, liquid: true });
  assert.equal(s2.n.positionAt(s2.state, "2026-01").liquid, 20000);
});

test("a tombstoned asset drops out of the total", function () {
  var s = setup();
  var a = addAsset(s, "Old car", { acquiredOn: "2026-01", cost: 30000 });
  a.deleted = true;
  assert.equal(s.n.positionAt(s.state, "2026-01").assets, 0);
});

// --- equity (FR-2.3) --------------------------------------------------------

test("equity is asset value less the balance owed on its linked liability", function () {
  var s = setup();
  var loan = addLiability(s, "Mortgage", "2026-01", 380000);
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000, linkedLiabilityId: loan.id });

  var assetId = s.state.assets[0].id;
  var eq = s.n.equityFor(s.state, assetId, "2026-01");
  assert.equal(eq.value, 500000);
  assert.equal(eq.owed, 380000);
  assert.equal(eq.equity, 120000);
  assert.equal(eq.liabilityName, "Mortgage");
});

test("equity is not added to net worth again — the two sides already net out", function () {
  var s = setup();
  var loan = addLiability(s, "Mortgage", "2026-01", 380000);
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000, linkedLiabilityId: loan.id });

  var pos = s.n.positionAt(s.state, "2026-01");
  assert.equal(pos.assets, 500000);
  assert.equal(pos.liabilities, 380000);
  assert.equal(pos.net, 120000, "counting equity as well would double it to 240,000");
});

test("an unfinanced asset has equity equal to its full value", function () {
  var s = setup();
  addAsset(s, "Gold", { acquiredOn: "2026-01", cost: 20000 });
  var eq = s.n.equityFor(s.state, s.state.assets[0].id, "2026-01");
  assert.equal(eq.owed, 0);
  assert.equal(eq.equity, 20000);
  assert.equal(eq.liabilityName, null);
});

test("equity survives the linked liability being deleted", function () {
  var s = setup();
  var loan = addLiability(s, "Mortgage", "2026-01", 380000);
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000, linkedLiabilityId: loan.id });
  loan.deleted = true;

  var eq = s.n.equityFor(s.state, s.state.assets[0].id, "2026-01");
  assert.equal(eq.owed, 0, "a deleted loan owes nothing");
  assert.equal(eq.equity, 500000);
  assert.equal(eq.liabilityName, null);
});

test("equity tracks the loan down as it is paid off", function () {
  var s = setup();
  var loan = addLiability(s, "Mortgage", "2026-01", 380000);
  addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000, linkedLiabilityId: loan.id });
  s.v.upsertValuation(s.state, { liabilityId: loan.id, period: "2026-02", balance: 377000 }, "dev-1");

  var eq = s.n.equityFor(s.state, s.state.assets[0].id, "2026-02");
  assert.equal(eq.equity, 123000);
});

test("equityFor returns null for an asset with no value recorded yet", function () {
  var s = setup();
  var a = s.l.schema.newAsset("dev-1");
  a.name = "Unvalued";
  s.state.assets.push(a);
  assert.equal(s.n.equityFor(s.state, a.id, "2026-01"), null);
});

// --- schema and integrity ---------------------------------------------------

test("v5 -> v6 converts an existing currentValue into a dated valuation", function () {
  var s = setup();
  var out = s.l.store.migrate({
    schemaVersion: 5,
    assets: [{ id: "a1", name: "Home", acquiredOn: "2026-01", cost: 400000, currentValue: 480000 }],
    valuations: []
  });
  assert.equal(out.schemaVersion, s.l.schema.SCHEMA_VERSION);
  assert.equal(out.assets[0].currentValue, undefined, "the denormalised copy is gone");
  var v = out.valuations.filter(function (x) { return x.assetId === "a1"; })[0];
  assert.ok(v, "the figure must survive as a valuation, not be dropped");
  assert.equal(v.balance, 480000);
  assert.equal(v.period, "2026-01");
});

test("v5 -> v6 gives existing valuations an explicit assetId of null", function () {
  var s = setup();
  var out = s.l.store.migrate({
    schemaVersion: 5,
    valuations: [{ id: "v1", holdingId: "h1", liabilityId: null, period: "2026-01", balance: 5 }]
  });
  assert.equal(out.valuations[0].assetId, null);
  assert.equal(out.valuations[0].holdingId, "h1");
});

test("an asset with recorded values cannot be deleted outright", function () {
  var s = setup();
  var a = addAsset(s, "Family home", { acquiredOn: "2026-01", cost: 500000 });
  var res = s.e.canDelete(s.state, "assets", a.id);
  assert.equal(res.ok, false);
  assert.equal(res.dependents.valuations, 1);
});
