"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "KWSP";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "EPF";
  acct.class = "retirement";
  acct.liquid = false;
  s.accounts.push(acct);
  return { l: l, e: l.epf, v: l.valuations, state: s, acct: acct };
}

function addAccount(s, key, name) {
  var h = s.l.schema.newHolding("dev-1");
  h.accountId = s.acct.id;
  h.name = name || key;
  h.epfAccount = key;
  s.state.holdings.push(h);
  return h;
}

function rec(s, holdingId, period, fields) {
  s.v.upsertValuation(s.state, Object.assign({ holdingId: holdingId, period: period }, fields), "dev-1");
}

// --- the split is a default, not a fact ------------------------------------

test("the split defaults to 75/15/10 and says it is unconfirmed", function () {
  var s = setup();
  var split = s.e.splitFor(s.state);
  assert.deepEqual(split.map(function (x) { return x.key; }),
    ["persaraan", "sejahtera", "fleksibel"]);
  assert.deepEqual(split.map(function (x) { return x.sharePct; }), [75, 15, 10]);
  assert.ok(split.every(function (x) { return x.isDefault; }),
    "an untouched share is a default the owner has not confirmed");
  assert.equal(s.e.splitTotal(s.state), 100);
});

test("saved shares override the defaults and stop reading as unconfirmed", function () {
  var s = setup();
  s.state.settings.epfSplit = { persaraan: 70, sejahtera: 30, fleksibel: 0 };
  var split = s.e.splitFor(s.state);
  assert.deepEqual(split.map(function (x) { return x.sharePct; }), [70, 30, 0]);
  assert.ok(split.every(function (x) { return !x.isDefault; }));
});

test("a saved share of zero is honoured, not treated as unset", function () {
  var s = setup();
  s.state.settings.epfSplit = { persaraan: 100, sejahtera: 0, fleksibel: 0 };
  var split = s.e.splitFor(s.state);
  assert.equal(split[1].sharePct, 0);
  assert.equal(split[1].isDefault, false);
});

// --- contributions divide to the sen ---------------------------------------

test("a contribution divides in the declared proportions", function () {
  var s = setup();
  var split = s.e.splitContribution(1000, s.state);
  assert.deepEqual(split.parts.map(function (p) { return p.amount; }), [750, 150, 100]);
  assert.equal(split.sumsTo100, true);
});

test("the parts add back to exactly what went in, whatever the amount", function () {
  var s = setup();
  [0.01, 1, 33.33, 1234.56, 987.65, 100000.07].forEach(function (amount) {
    var split = s.e.splitContribution(amount, s.state);
    var sen = split.parts.reduce(function (n, p) { return n + Math.round(p.amount * 100); }, 0);
    assert.equal(sen, Math.round(amount * 100), amount + " must divide without losing a sen");
  });
});

test("a stray sen goes to the account that cannot be withdrawn", function () {
  var s = setup();
  // 0.01 in sen is 1: floors are all zero, so the single leftover sen is handed out by
  // remainder — Persaraan holds the largest share, so it takes it.
  var split = s.e.splitContribution(0.01, s.state);
  assert.equal(split.parts[0].amount, 0.01);
  assert.equal(split.parts[1].amount, 0);
  assert.equal(split.parts[2].amount, 0);
});

test("shares that do not total 100 still divide the whole amount, and say so", function () {
  var s = setup();
  s.state.settings.epfSplit = { persaraan: 70, sejahtera: 15, fleksibel: 10 };
  var split = s.e.splitContribution(950, s.state);
  assert.equal(split.sumsTo100, false);
  assert.equal(split.sharePctTotal, 95);
  var total = split.parts.reduce(function (n, p) { return n + p.amount; }, 0);
  assert.equal(Math.round(total * 100), 95000, "no ringgit may vanish into a bad setting");
});

test("shares totalling zero report that they cannot allocate rather than dividing by zero", function () {
  var s = setup();
  s.state.settings.epfSplit = { persaraan: 0, sejahtera: 0, fleksibel: 0 };
  var split = s.e.splitContribution(500, s.state);
  assert.equal(split.allocatable, false);
  assert.ok(split.parts.every(function (p) { return p.amount === 0; }));
});

test("a blank contribution divides into nothing at all, not into three zeros", function () {
  var s = setup();
  assert.equal(s.e.splitContribution(null, s.state), null);
  assert.equal(s.e.splitContribution("", s.state), null);
  assert.equal(s.e.splitContribution("abc", s.state), null);
});

// --- balances across the three accounts ------------------------------------

test("balances report each account, its share, and the total", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  var j = addAccount(s, "sejahtera", "Akaun Sejahtera");
  var f = addAccount(s, "fleksibel", "Akaun Fleksibel");
  rec(s, p.id, "2026-06", { balance: 150000 });
  rec(s, j.id, "2026-06", { balance: 30000 });
  rec(s, f.id, "2026-06", { balance: 20000 });

  var b = s.e.balances(s.state, "2026-06");
  assert.equal(b.total, 200000);
  assert.equal(b.complete, true);
  assert.equal(b.lines[0].sharePct, 75);
  assert.equal(b.lines[1].sharePct, 15);
  assert.equal(b.lines[2].sharePct, 10);
});

test("an untagged account contributes null, not zero, and the total says it is partial", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2026-06", { balance: 150000 });

  var b = s.e.balances(s.state, "2026-06");
  assert.equal(b.total, 150000);
  assert.equal(b.complete, false);
  assert.deepEqual(b.missing, ["sejahtera", "fleksibel"]);
  assert.equal(b.lines[1].balance, null, "unknown is not zero");
});

test("a balance carried from an earlier month is marked stale with its source", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2026-03", { balance: 150000 });

  var b = s.e.balances(s.state, "2026-06");
  assert.equal(b.lines[0].balance, 150000);
  assert.equal(b.lines[0].stale, true);
  assert.equal(b.lines[0].sourcePeriod, "2026-03");
  assert.equal(b.lines[0].monthsStale, 3);
});

test("a holding on an archived account drops out of the EPF position", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2026-06", { balance: 150000 });
  s.acct.archived = true;

  var b = s.e.balances(s.state, "2026-06");
  assert.equal(b.recordedCount, 0);
  assert.equal(b.total, null);
});

test("two holdings tagged the same account is reported, not silently summed", function () {
  var s = setup();
  var a = addAccount(s, "persaraan", "Akaun Persaraan");
  var dupe = addAccount(s, "persaraan", "Old EPF export");
  rec(s, a.id, "2026-06", { balance: 150000 });
  rec(s, dupe.id, "2026-06", { balance: 99999 });

  var b = s.e.balances(s.state, "2026-06");
  assert.equal(b.total, 150000, "the duplicate must not inflate the total");
  var problems = s.e.epfIssues(s.state);
  assert.ok(problems.some(function (m) { return /2 holdings are tagged/.test(m); }));
});

test("shares that do not total 100 are reported as an issue", function () {
  var s = setup();
  s.state.settings.epfSplit = { persaraan: 70, sejahtera: 15, fleksibel: 10 };
  var problems = s.e.epfIssues(s.state);
  assert.ok(problems.some(function (m) { return /95%/.test(m); }));
});

// --- annual dividend --------------------------------------------------------

test("no declared rate means no estimate, not an estimate of zero", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2025-12", { balance: 100000 });

  assert.equal(s.e.dividendRateFor(s.state, 2026), null);
  assert.equal(s.e.dividendEstimate(s.state, p.id, 2026, null), null);
  var sum = s.e.yearSummary(s.state, 2026);
  assert.equal(sum.hasRate, false);
  assert.equal(sum.totalEstimated, null);
});

test("a declared rate is read back for its own year only", function () {
  var s = setup();
  s.state.settings.epfDividendRates = { "2025": 6.3 };
  assert.equal(s.e.dividendRateFor(s.state, 2025), 6.3);
  assert.equal(s.e.dividendRateFor(s.state, 2026), null);
});

test("an opening balance with no movements earns a full year of dividend", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2025-12", { balance: 100000 });

  var est = s.e.dividendEstimate(s.state, p.id, 2026, 6);
  assert.equal(est.openingBalance, 100000);
  assert.equal(est.dividendBase, 100000);
  assert.equal(est.dividend, 6000);
  assert.equal(est.illustrative, true);
});

test("money paid in during the year earns only the months left after it", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2025-12", { balance: 0 });
  // A single January contribution earns 11/12 of a year; a December one earns nothing.
  rec(s, p.id, "2026-01", { balance: 1200, contribution: 1200 });
  var jan = s.e.dividendEstimate(s.state, p.id, 2026, 12);
  assert.equal(jan.dividendBase, 1100);
  assert.equal(jan.dividend, 132);

  var s2 = setup();
  var q = addAccount(s2, "persaraan", "Akaun Persaraan");
  rec(s2, q.id, "2025-12", { balance: 0 });
  rec(s2, q.id, "2026-12", { balance: 1200, contribution: 1200 });
  var dec = s2.e.dividendEstimate(s2.state, q.id, 2026, 12);
  assert.equal(dec.dividendBase, 0);
  assert.equal(dec.dividend, 0);
});

test("a withdrawal reduces the base by the same weighting a contribution adds", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2025-12", { balance: 12000 });
  rec(s, p.id, "2026-06", { balance: 6000, withdrawal: 6000 });

  var est = s.e.dividendEstimate(s.state, p.id, 2026, 10);
  assert.equal(est.weightedMovement, -3000);
  assert.equal(est.dividendBase, 9000);
  assert.equal(est.dividend, 900);
});

test("with no opening balance on file there is nothing to estimate from", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2026-06", { balance: 50000 });

  assert.equal(s.e.dividendEstimate(s.state, p.id, 2026, 6), null);
});

test("the year summary reports the estimate beside what was credited, and changes neither", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2025-12", { balance: 100000 });
  rec(s, p.id, "2026-12", { balance: 106400, income: 6400 });
  var before = JSON.stringify(s.state);

  var sum = s.e.yearSummary(s.state, 2026, 6);
  var line = sum.lines[0];
  assert.equal(line.estimate.dividend, 6000);
  assert.equal(line.recorded, 6400);
  assert.equal(line.difference, 400, "the statement is 400 higher and stays 400 higher");
  assert.equal(sum.totalDifference, 400);
  assert.equal(JSON.stringify(s.state), before, "reporting a difference must not rewrite state");
});

test("years offered are the ones with EPF entries, newest first", function () {
  var s = setup();
  var p = addAccount(s, "persaraan", "Akaun Persaraan");
  rec(s, p.id, "2024-12", { balance: 80000 });
  rec(s, p.id, "2026-06", { balance: 100000 });

  assert.deepEqual(s.e.yearsWithEntries(s.state), ["2026", "2024"]);
});

// --- schema and store -------------------------------------------------------

test("migrating from v9 gives every holding an explicit null EPF tag", function () {
  var s = setup();
  var old = {
    schemaVersion: 9,
    holdings: [{ id: "h1", name: "EPF", accountId: "a1", fixedPrice: null, reliefCategory: "epf" }]
  };
  var migrated = s.l.store.migrate(old);
  assert.equal(migrated.schemaVersion, 10);
  assert.equal(migrated.holdings[0].epfAccount, null);
  assert.ok("epfAccount" in migrated.holdings[0], "the field must exist for CSV export");
});

test("the EPF tag survives a CSV round trip as its own column", function () {
  var s = setup();
  addAccount(s, "sejahtera", "Akaun Sejahtera");
  var out = s.l.csv.entityToCsv(s.state, "holdings");
  assert.ok(out.split("\r\n")[0].indexOf("epfAccount") !== -1);
  assert.ok(out.indexOf("sejahtera") !== -1);
});
