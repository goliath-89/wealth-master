"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

var FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "fund-desk-export.json"), "utf8")
);

function migrated() {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var res = lib.migrateFundDesk.migrateFromFundDesk(FIXTURE, "dev-test", []);
  return { lib: lib, res: res };
}

test("every fund becomes exactly one holding (AC-8)", function () {
  var res = migrated().res;
  assert.equal(res.holdings.length, FIXTURE.funds.length);
});

test("every valid entry becomes exactly one valuation; orphaned entries are skipped with a warning", function () {
  var res = migrated().res;
  var validEntries = FIXTURE.entries.filter(function (e) { return e.fundId !== "ghost-fund"; });
  assert.equal(res.valuations.length, validEntries.length);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /ghost-fund/);
});

test("providers are deduped into one institution each", function () {
  var res = migrated().res;
  // f1, f2, f6 all share provider "ASNB" -> one institution, three holdings under it
  var asnb = res.institutions.filter(function (i) { return i.name === "ASNB"; });
  assert.equal(asnb.length, 1);
  var holdingsUnderAsnb = res.accounts
    .filter(function (a) { return a.institutionId === asnb[0].id; })
    .map(function (a) { return a.id; });
  var holdingsForAsnbAccounts = res.holdings.filter(function (h) {
    return holdingsUnderAsnb.indexOf(h.accountId) !== -1;
  });
  assert.equal(holdingsForAsnbAccounts.length, 3);
});

test("a fund with no provider falls back to 'Unknown' rather than crashing", function () {
  var res = migrated().res;
  var unknown = res.institutions.filter(function (i) { return i.name === "Unknown"; });
  assert.equal(unknown.length, 1);
});

test("pidm flag ORs onto the institution across every fund sharing that provider", function () {
  var res = migrated().res;
  var rytBank = res.institutions.filter(function (i) { return i.name === "Ryt Bank"; })[0];
  assert.equal(rytBank.pidmMember, true); // f3 (Ryt Bank) has pidm: true
});

test("a fund with no entries produces a holding but no valuations", function () {
  var res = migrated().res;
  var emptyFundHolding = res.holdings.filter(function (h) { return h.name === "Empty Fund"; })[0];
  assert.ok(emptyFundHolding);
  var itsValuations = res.valuations.filter(function (v) { return v.holdingId === emptyFundHolding.id; });
  assert.equal(itsValuations.length, 0);
});

test("negative income and large (RM 9.5m) balances survive the transform unmangled", function () {
  var res = migrated().res;
  var asbHolding = res.holdings.filter(function (h) { return h.name === "ASB"; })[0];
  var val = res.valuations.filter(function (v) { return v.holdingId === asbHolding.id; })[0];
  assert.equal(val.balance, 9500000);
  assert.equal(val.income, -150);
});

test("HTML/special characters in names and notes are preserved verbatim, not stripped or escaped", function () {
  var res = migrated().res;
  var evilHolding = res.holdings.filter(function (h) { return h.name.indexOf("onerror") !== -1; })[0];
  assert.equal(evilHolding.name, "<img src=x onerror=alert(1)> Fund");
  var val = res.valuations.filter(function (v) { return v.holdingId === evilHolding.id; })[0];
  assert.equal(val.note, "\"quoted\" & <b>bold</b>");
  // Migration only transforms data; DOM-insertion safety (SEC-7) is the renderer's job once
  // a holdings view ships in P1 — there's nothing to escape at this layer.
});

test("every created record is stamped with deviceId, updatedAt, and deleted:false", function () {
  var res = migrated().res;
  res.institutions.concat(res.accounts, res.holdings, res.valuations).forEach(function (r) {
    assert.equal(r.deviceId, "dev-test");
    assert.ok(r.updatedAt);
    assert.equal(r.deleted, false);
  });
});

test("migrating into a store that already has the institution reuses it instead of duplicating", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var first = lib.migrateFundDesk.migrateFromFundDesk(FIXTURE, "dev-test", []);
  var second = lib.migrateFundDesk.migrateFromFundDesk(FIXTURE, "dev-test", first.institutions);
  assert.equal(second.institutions.length, 0, "no new institutions — all providers already existed");
});

test("a non-Fund-Desk JSON shape produces a warning instead of throwing", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var res;
  assert.doesNotThrow(function () {
    res = lib.migrateFundDesk.migrateFromFundDesk({ notAFundDeskExport: true }, "dev-test", []);
  });
  assert.equal(res.holdings.length, 0);
  assert.equal(res.warnings.length, 1);
});
