"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "ASNB";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Investment";
  acct.class = "investment";
  s.accounts.push(acct);
  return { l: l, u: l.units, v: l.valuations, state: s, acct: acct };
}

function addHolding(s, name, opts) {
  opts = opts || {};
  var h = s.l.schema.newHolding("dev-1");
  h.accountId = s.acct.id;
  h.name = name;
  h.unitBased = !!opts.unitBased;
  h.fixedPrice = opts.fixedPrice === undefined ? null : opts.fixedPrice;
  s.state.holdings.push(h);
  return h;
}

function rec(s, holdingId, period, fields) {
  s.v.upsertValuation(s.state, Object.assign({ holdingId: holdingId, period: period }, fields), "dev-1");
}

// --- cost basis -------------------------------------------------------------

test("cost basis is money in less money out", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, contribution: 10000 });
  rec(s, h.id, "2026-02", { balance: 11000, contribution: 1000 });
  rec(s, h.id, "2026-03", { balance: 9000, withdrawal: 3000 });

  var basis = s.u.costBasis(s.state, h.id);
  assert.equal(basis.contributed, 11000);
  assert.equal(basis.withdrawn, 3000);
  assert.equal(basis.net, 8000);
});

test("cost basis is taken as at a period, ignoring later entries", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, contribution: 10000 });
  rec(s, h.id, "2026-06", { balance: 20000, contribution: 9000 });
  assert.equal(s.u.costBasis(s.state, h.id, "2026-03").net, 10000);
});

// --- variable price ---------------------------------------------------------

test("units are derived from balance and price when not recorded", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10500, unitPrice: 1.05, contribution: 10000 });

  var p = s.u.position(s.state, h, "2026-01");
  assert.equal(p.unitPrice, 1.05);
  assert.equal(p.units, 10000);
  assert.equal(p.balance, 10500);
});

test("unrealised gain is value less cost, with a percentage", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, unitPrice: 1.00, contribution: 10000 });
  rec(s, h.id, "2026-06", { balance: 12500, unitPrice: 1.25 });

  var p = s.u.position(s.state, h, "2026-06");
  assert.equal(p.costBasis, 10000);
  assert.equal(p.unrealisedGain, 2500);
  assert.equal(p.unrealisedPct, 25);
});

test("a loss reports as a negative gain rather than being hidden", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, unitPrice: 1.00, contribution: 10000 });
  rec(s, h.id, "2026-06", { balance: 8500, unitPrice: 0.85 });

  var p = s.u.position(s.state, h, "2026-06");
  assert.equal(p.unrealisedGain, -1500);
  assert.equal(p.unrealisedPct, -15);
});

test("average cost per unit reflects what was paid, not the current price", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, units: 10000, unitPrice: 1.00, contribution: 10000 });
  rec(s, h.id, "2026-06", { balance: 15000, units: 12000, unitPrice: 1.25, contribution: 2000 });

  var p = s.u.position(s.state, h, "2026-06");
  assert.equal(p.costBasis, 12000);
  assert.equal(p.averageCostPerUnit, 1, "RM 12,000 spent over 12,000 units");
  assert.equal(p.unitPrice, 1.25, "which is not the same as the market price");
});

test("total return counts income taken as well as gain on paper", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, unitPrice: 1.00, contribution: 10000 });
  rec(s, h.id, "2026-06", { balance: 11000, unitPrice: 1.10, income: 300 });

  var p = s.u.position(s.state, h, "2026-06");
  assert.equal(p.incomeToDate, 300);
  assert.equal(p.unrealisedGain, 1000);
  assert.equal(p.totalReturn, 1300);
});

// --- ASNB fixed price (FR-9.2) ----------------------------------------------

test("a fixed-price fund holds its price and equates units to ringgit", function () {
  var s = setup();
  var h = addHolding(s, "ASB", { unitBased: true, fixedPrice: 1.00 });
  rec(s, h.id, "2026-01", { balance: 50000, contribution: 50000 });

  var p = s.u.position(s.state, h, "2026-01");
  assert.equal(p.fixedPrice, true);
  assert.equal(p.unitPrice, 1);
  assert.equal(p.units, 50000, "a unit is a ringgit");
});

test("a fixed-price fund never shows an unrealised gain", function () {
  var s = setup();
  var h = addHolding(s, "ASB", { unitBased: true, fixedPrice: 1.00 });
  rec(s, h.id, "2026-01", { balance: 50000, contribution: 50000 });
  rec(s, h.id, "2026-12", { balance: 52875, income: 2875 });

  var p = s.u.position(s.state, h, "2026-12");
  // The price cannot move, so there is nothing unrealised — the return was credited as
  // units and is already counted as income.
  assert.equal(p.unrealisedGain, 0);
  assert.equal(p.unrealisedPct, null);
  assert.equal(p.incomeToDate, 2875);
  assert.equal(p.totalReturn, 2875, "the dividend IS the return");
});

test("a fixed-price fund's average cost per unit is the pinned price", function () {
  var s = setup();
  var h = addHolding(s, "ASB", { unitBased: true, fixedPrice: 1.00 });
  rec(s, h.id, "2026-01", { balance: 50000, contribution: 50000 });
  assert.equal(s.u.position(s.state, h, "2026-01").averageCostPerUnit, 1);
});

test("units bought by a contribution follow the price", function () {
  var s = setup();
  assert.equal(s.u.unitsFor(1000, 1), 1000, "RM 1,000 buys 1,000 units at RM 1.00");
  assert.equal(s.u.unitsFor(1000, 1.25), 800);
  assert.equal(s.u.unitsFor(1000, 0), null, "no price, no answer");
});

test("isFixedPrice only accepts a real positive price", function () {
  var s = setup();
  assert.equal(s.u.isFixedPrice({ fixedPrice: 1 }), true);
  assert.equal(s.u.isFixedPrice({ fixedPrice: 0 }), false);
  assert.equal(s.u.isFixedPrice({ fixedPrice: null }), false);
  assert.equal(s.u.isFixedPrice({}), false);
});

// --- consistency ------------------------------------------------------------

test("units times price is checked against the recorded balance", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  var good = { units: 10000, unitPrice: 1.05, balance: 10500 };
  assert.equal(s.u.checkConsistency(good, h).consistent, true);

  var typo = { units: 10000, unitPrice: 1.05, balance: 1050 };
  var res = s.u.checkConsistency(typo, h);
  assert.equal(res.consistent, false);
  assert.equal(res.impliedBalance, 10500);
  assert.equal(res.difference, -9450);
});

test("a sen of rounding is tolerated, more is flagged", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  assert.equal(s.u.checkConsistency({ units: 3333, unitPrice: 1.03, balance: 3432.99 }, h).consistent, true);
  assert.equal(s.u.checkConsistency({ units: 3333, unitPrice: 1.03, balance: 3435 }, h).consistent, false);
});

test("consistency cannot be judged without both figures", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  assert.equal(s.u.checkConsistency({ balance: 1000 }, h), null);
  assert.equal(s.u.checkConsistency(null, h), null);
});

// --- degenerate -------------------------------------------------------------

test("a holding never valued has no position", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  assert.equal(s.u.position(s.state, h, "2026-01"), null);
});

test("a note-only month falls back to the last real balance", function () {
  var s = setup();
  var h = addHolding(s, "Equity fund", { unitBased: true });
  rec(s, h.id, "2026-01", { balance: 10000, unitPrice: 1, contribution: 10000 });
  rec(s, h.id, "2026-02", { note: "statement late" });
  assert.equal(s.u.position(s.state, h, "2026-02").balance, 10000);
});

test("v8 -> v9 migration gives holdings an explicit null fixed price", function () {
  var s = setup();
  var out = s.l.store.migrate({
    schemaVersion: 8,
    holdings: [{ id: "h1", name: "Fund", unitBased: true }]
  });
  assert.equal(out.schemaVersion, s.l.schema.SCHEMA_VERSION);
  assert.equal(out.holdings[0].fixedPrice, null);
  assert.equal(out.holdings[0].unitBased, true);
});
