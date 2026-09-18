"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-9.6. MYR is the base currency; a foreign balance means nothing until a recorded rate
// converts it. Before this existed, a USD 10,000 balance was summed into net worth as
// RM 10,000 — the single most expensive silent error the app could make.

function setup(currency) {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Wise";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Foreign";
  acct.class = "cash";
  acct.currency = currency || "USD";
  s.accounts.push(acct);
  return { l: l, fx: l.fx, nw: l.networth, v: l.valuations, state: s, acct: acct };
}

function addHolding(s, name, acct) {
  var h = s.l.schema.newHolding("dev-1");
  h.accountId = (acct || s.acct).id;
  h.name = name;
  s.state.holdings.push(h);
  return h;
}

function myrAccount(s, name) {
  var a = s.l.schema.newAccount("dev-1");
  a.institutionId = s.acct.institutionId;
  a.name = name || "Local";
  a.class = "cash";
  a.currency = "MYR";
  s.state.accounts.push(a);
  return a;
}

function rec(s, holdingId, period, fields) {
  s.v.upsertValuation(s.state, Object.assign({ holdingId: holdingId, period: period }, fields), "dev-1");
}

// --- what needs converting --------------------------------------------------

test("only an account outside the base currency needs converting", function () {
  var s = setup("USD");
  assert.equal(s.fx.BASE, "MYR");
  assert.equal(s.fx.needsConversion(s.acct), true);
  assert.equal(s.fx.needsConversion(myrAccount(s)), false);
  // A missing or oddly-cased code is the base currency, not a foreign one.
  assert.equal(s.fx.needsConversion({ currency: "myr" }), false);
  assert.equal(s.fx.needsConversion({ currency: "  MYR " }), false);
  assert.equal(s.fx.needsConversion({}), false);
});

// --- the rate itself --------------------------------------------------------

test("a rate recorded for the month is the one used", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 1000, fxRate: 4.2 });
  var found = s.fx.rateAt(s.state, h.id, "2026-06");
  assert.equal(found.rate, 4.2);
  assert.equal(found.stale, false);
});

test("a month with no rate carries the last one forward, marked stale", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-04", { balance: 1000, fxRate: 4.2 });
  rec(s, h.id, "2026-06", { balance: 1000 });

  var found = s.fx.rateAt(s.state, h.id, "2026-06");
  assert.equal(found.rate, 4.2);
  assert.equal(found.stale, true, "rates move daily; last month's is an approximation");
  assert.equal(found.sourcePeriod, "2026-04");
});

test("a rate recorded only later is never used to value an earlier month", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 1000, fxRate: 4.2 });
  // Valuing March at June's rate is the same error as valuing it at today's — it is not
  // what the money was worth then.
  assert.equal(s.fx.rateAt(s.state, h.id, "2026-03"), null);
});

test("a zero or negative rate is not a rate", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 1000, fxRate: 0 });
  assert.equal(s.fx.rateAt(s.state, h.id, "2026-06"), null);
  assert.equal(s.fx.convertAmount(1000, 0), null);
  assert.equal(s.fx.convertAmount(1000, -4), null);
});

test("converting is a multiplication, rounded to the sen", function () {
  var s = setup();
  assert.equal(s.fx.convertAmount(1000, 4.2), 4200);
  assert.equal(s.fx.convertAmount(1234.56, 4.2137), 5202.07);
  assert.equal(s.fx.convertAmount(null, 4.2), null, "blank stays blank");
});

// --- net worth --------------------------------------------------------------

test("a foreign holding enters net worth converted, not at face value", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 10000, fxRate: 4.2 });

  var pos = s.nw.positionAt(s.state, "2026-06");
  assert.equal(pos.assets, 42000, "USD 10,000 at 4.2 is RM 42,000, not RM 10,000");
  assert.equal(pos.net, 42000);

  var line = pos.lines[0];
  assert.equal(line.balance, 42000, "the line carries the converted figure");
  assert.equal(line.nativeBalance, 10000, "and what was actually recorded");
  assert.equal(line.currency, "USD");
  assert.equal(line.fxRate, 4.2);
});

test("a base-currency holding is untouched and needs no rate", function () {
  var s = setup("USD");
  var local = myrAccount(s, "Savings");
  var h = addHolding(s, "Maybank", local);
  rec(s, h.id, "2026-06", { balance: 5000 });

  var pos = s.nw.positionAt(s.state, "2026-06");
  assert.equal(pos.assets, 5000);
  assert.equal(pos.lines[0].currency, "MYR");
  assert.equal(pos.lines[0].fxRate, 1);
  assert.equal(pos.unconverted.length, 0);
});

test("a foreign holding with no rate is left out of the total and named", function () {
  var s = setup("USD");
  var local = myrAccount(s, "Savings");
  var mine = addHolding(s, "Maybank", local);
  var theirs = addHolding(s, "USD cash");
  rec(s, mine.id, "2026-06", { balance: 5000 });
  rec(s, theirs.id, "2026-06", { balance: 10000 });   // no rate

  var pos = s.nw.positionAt(s.state, "2026-06");
  // Adding it at face value would report RM 15,000 for what is really RM 47,000. Leaving
  // it out understates, but says so; the other silently invents an exchange rate of 1.
  assert.equal(pos.assets, 5000);
  assert.equal(pos.unconverted.length, 1);
  assert.equal(pos.unconverted[0].name, "USD cash");
  assert.equal(pos.unconverted[0].currency, "USD");
  assert.equal(pos.unconverted[0].native, 10000);

  var line = pos.lines.filter(function (l) { return l.name === "USD cash"; })[0];
  assert.equal(line.convertible, false);
  assert.equal(line.balance, null, "no ringgit figure is invented for it");
  assert.equal(line.nativeBalance, 10000, "but the recorded figure is still shown");
});

test("a carried-forward rate converts, and the total says it did", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-04", { balance: 10000, fxRate: 4.2 });
  rec(s, h.id, "2026-06", { balance: 11000 });

  var pos = s.nw.positionAt(s.state, "2026-06");
  assert.equal(pos.assets, 46200, "11,000 at April's 4.2");
  assert.equal(pos.fxStaleCount, 1);
  assert.equal(pos.lines[0].fxStale, true);
  assert.equal(pos.lines[0].fxSourcePeriod, "2026-04");
});

test("liquid and illiquid are split on the converted figure", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 1000, fxRate: 4.2 });

  var pos = s.nw.positionAt(s.state, "2026-06");
  assert.equal(pos.liquid, 4200, "an FX account's liquidity is its ringgit value");
  assert.equal(pos.illiquid, 0);
});

test("the rate changing moves net worth even when the balance does not", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-05", { balance: 10000, fxRate: 4.2 });
  rec(s, h.id, "2026-06", { balance: 10000, fxRate: 4.5 });

  assert.equal(s.nw.positionAt(s.state, "2026-05").assets, 42000);
  assert.equal(s.nw.positionAt(s.state, "2026-06").assets, 45000);
});

test("history is valued at the rate of its own month, not the latest", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-05", { balance: 10000, fxRate: 4.2 });
  rec(s, h.id, "2026-06", { balance: 10000, fxRate: 4.5 });

  // Revaluing May at June's rate would rewrite what the portfolio was worth in May.
  var series = s.nw.series(s.state, "2026-06");
  assert.equal(series[0].assets, 42000);
  assert.equal(series[series.length - 1].assets, 45000);
});

// --- reporting --------------------------------------------------------------

test("holdings needing a rate are listed so the owner can supply one", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 10000 });

  var missing = s.fx.unconvertible(s.state, "2026-06");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, "USD cash");

  rec(s, h.id, "2026-06", { balance: 10000, fxRate: 4.2 });
  assert.equal(s.fx.unconvertible(s.state, "2026-06").length, 0);
});

test("a holding with no balance at all is not chased for a rate", function () {
  var s = setup("USD");
  addHolding(s, "USD cash");
  assert.equal(s.fx.unconvertible(s.state, "2026-06").length, 0,
    "nothing recorded means nothing to convert");
});

test("the rates in force are reported per currency", function () {
  var s = setup("USD");
  var usd = addHolding(s, "USD cash");
  var sgdAcct = s.l.schema.newAccount("dev-1");
  sgdAcct.institutionId = s.acct.institutionId;
  sgdAcct.name = "SGD";
  sgdAcct.currency = "SGD";
  s.state.accounts.push(sgdAcct);
  var sgd = addHolding(s, "SGD cash", sgdAcct);

  rec(s, usd.id, "2026-06", { balance: 1000, fxRate: 4.2 });
  rec(s, sgd.id, "2026-06", { balance: 1000, fxRate: 3.3 });

  var rates = s.fx.ratesInForce(s.state, "2026-06");
  assert.deepEqual(rates.map(function (r) { return r.currency; }), ["SGD", "USD"]);
  assert.equal(rates[1].rate, 4.2);
  assert.equal(rates[1].stale, false);
  assert.equal(rates[1].disagrees, false);
});

test("two rates for one currency in one month are reported, not averaged", function () {
  var s = setup("USD");
  var a = addHolding(s, "USD one");
  var b = addHolding(s, "USD two");
  rec(s, a.id, "2026-06", { balance: 1000, fxRate: 4.2 });
  rec(s, b.id, "2026-06", { balance: 1000, fxRate: 4.9 });

  var usd = s.fx.ratesInForce(s.state, "2026-06")[0];
  // They cannot both be right. Averaging would hide a typo behind a plausible number.
  assert.equal(usd.disagrees, true);
  assert.equal(usd.low, 4.2);
  assert.equal(usd.high, 4.9);
});

test("an archived account drops out of both the total and the chasing", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 10000 });
  s.acct.archived = true;

  assert.equal(s.nw.positionAt(s.state, "2026-06").unconverted.length, 0);
  assert.equal(s.fx.unconvertible(s.state, "2026-06").length, 0);
});

// --- schema -----------------------------------------------------------------

test("migrating from v10 gives every valuation an explicit null rate", function () {
  var s = setup();
  var migrated = s.l.store.migrate({
    schemaVersion: 10,
    valuations: [{ id: "v1", holdingId: "h1", period: "2026-01", balance: 100 }]
  });
  assert.equal(migrated.schemaVersion, s.l.schema.SCHEMA_VERSION);
  assert.equal(migrated.valuations[0].fxRate, null);
  assert.ok("fxRate" in migrated.valuations[0], "the field must exist for CSV export");
});

test("the rate survives a save and is exported", function () {
  var s = setup("USD");
  var h = addHolding(s, "USD cash");
  rec(s, h.id, "2026-06", { balance: 1000, fxRate: 4.2 });

  var stored = s.v.valuationFor(s.state, h.id, "2026-06");
  assert.equal(stored.fxRate, 4.2);
  var out = s.l.csv.entityToCsv(s.state, "valuations");
  assert.ok(out.split("\r\n")[0].indexOf("fxRate") !== -1);
  assert.ok(out.indexOf("4.2") !== -1);
});
