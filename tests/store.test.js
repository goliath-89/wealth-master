"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

test("load() returns a blank state when localStorage is empty", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var res = lib.store.load();
  assert.equal(res.error, null);
  assert.equal(res.state.schemaVersion, lib.schema.SCHEMA_VERSION);
  assert.deepEqual(res.state.holdings, []);
});

test("load() falls back to blank state on corrupt JSON, never throws", function () {
  var window = helpers.freshWindow();
  window.localStorage.setItem("wealthmaster.state", "{not valid json");
  var lib = helpers.loadLib(window);
  var res;
  assert.doesNotThrow(function () { res = lib.store.load(); });
  // load() returns the error rather than throwing it, so the app can surface a
  // "your saved data was unreadable" message instead of failing to boot.
  assert.ok(res.error instanceof Error);
  assert.equal(res.state.schemaVersion, lib.schema.SCHEMA_VERSION);
  assert.deepEqual(res.state.holdings, []);
});

test("save() then load() round-trips a populated state exactly", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var state = lib.schema.blank();
  var h = lib.schema.newHolding("dev-1");
  h.name = "Test holding";
  state.holdings.push(h);

  var saveRes = lib.store.save(state);
  assert.equal(saveRes.ok, true);

  var loadRes = lib.store.load();
  assert.equal(loadRes.state.holdings.length, 1);
  assert.equal(loadRes.state.holdings[0].name, "Test holding");
  assert.equal(loadRes.state.holdings[0].id, h.id);
});

test("migrate() backfills missing entity arrays and settings on a partial object", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var partial = { schemaVersion: 3, holdings: [{ id: "x" }] };
  var out = lib.store.migrate(partial);
  assert.equal(out.holdings.length, 1);
  lib.schema.ENTITY_LISTS.forEach(function (key) {
    assert.ok(Array.isArray(out[key]), key + " should be an array");
  });
  assert.ok(out.settings);
  assert.ok(out.sync);
  assert.deepEqual(out.conflictLog, []);
});

test("migrate() is idempotent — migrating an already-current state changes nothing structural", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var once = lib.store.migrate(lib.schema.blank());
  var twice = lib.store.migrate(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(once, twice);
});

test("save() reports failure without throwing when storage quota is exceeded", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var quotaErr = new Error("simulated quota exceeded");
  quotaErr.name = "QuotaExceededError";

  // jsdom's Storage is a Proxy: assigning `localStorage.setItem = fn` stores a key
  // named "setItem" rather than replacing the method. Swap in a plain stub object
  // instead — store.js resolves `localStorage` as a free variable at call time.
  var realStorage = global.localStorage;
  global.localStorage = {
    getItem: function () { return null; },
    setItem: function () { throw quotaErr; }
  };

  var res;
  assert.doesNotThrow(function () {
    res = lib.store.save(lib.schema.blank());
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.name, "QuotaExceededError");

  global.localStorage = realStorage;
});

test("v3 -> v4 migration marks cash accounts at a PIDM member institution as protected", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var v3 = {
    schemaVersion: 3,
    institutions: [
      { id: "i-member", name: "Ryt Bank", pidmMember: true },
      { id: "i-nonmember", name: "ASNB", pidmMember: false }
    ],
    accounts: [
      { id: "a-cash-member", institutionId: "i-member", class: "cash" },
      { id: "a-invest-member", institutionId: "i-member", class: "investment" },
      { id: "a-cash-nonmember", institutionId: "i-nonmember", class: "cash" }
    ]
  };

  var out = lib.store.migrate(v3);
  // Assert against the current version rather than a literal, so a later bump does not
  // break a test about PIDM backfill.
  assert.equal(out.schemaVersion, lib.schema.SCHEMA_VERSION);

  function acct(id) {
    return out.accounts.filter(function (a) { return a.id === id; })[0];
  }
  // A deposit at a member bank is covered...
  assert.equal(acct("a-cash-member").pidmProtected, true);
  // ...but an investment sold by that same bank is not, and neither is a deposit
  // at a non-member. Backfilling optimistically here would silently overstate cover.
  assert.equal(acct("a-invest-member").pidmProtected, false);
  assert.equal(acct("a-cash-nonmember").pidmProtected, false);
});

test("v3 -> v4 migration never overwrites a pidmProtected value already set", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var out = lib.store.migrate({
    schemaVersion: 3,
    institutions: [{ id: "i1", name: "Bank", pidmMember: false }],
    // Owner had already declared this covered; the backfill must respect it (FR-7.8).
    accounts: [{ id: "a1", institutionId: "i1", class: "investment", pidmProtected: true }]
  });
  assert.equal(out.accounts[0].pidmProtected, true);
});

test("load() recovers state written under the legacy storage key", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  window.localStorage.setItem("wealthmaster.v3", JSON.stringify({
    schemaVersion: 3,
    institutions: [{ id: "i1", name: "Ryt Bank", pidmMember: true }],
    accounts: [{ id: "a1", institutionId: "i1", class: "cash" }]
  }));

  var res = lib.store.load();
  assert.equal(res.error, null);
  assert.equal(res.state.schemaVersion, lib.schema.SCHEMA_VERSION,
    "legacy payload must be migrated all the way forward, not dropped");
  assert.equal(res.state.accounts.length, 1);
  assert.equal(res.state.accounts[0].pidmProtected, true);
});

test("v4 -> v5 migration gives existing valuations an explicit liabilityId of null", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var out = lib.store.migrate({
    schemaVersion: 4,
    valuations: [{ id: "v1", holdingId: "h1", period: "2026-08", balance: 100 }]
  });
  assert.equal(out.schemaVersion, lib.schema.SCHEMA_VERSION);
  assert.equal(out.valuations[0].liabilityId, null, "explicit null keeps the shape uniform for CSV");
  assert.equal(out.valuations[0].holdingId, "h1", "the existing link must survive");
  assert.equal(out.valuations[0].balance, 100);
});

test("migrating a v3 payload runs every step of the ladder in order", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var out = lib.store.migrate({
    schemaVersion: 3,
    institutions: [{ id: "i1", name: "Bank", pidmMember: true }],
    accounts: [{ id: "a1", institutionId: "i1", class: "cash" }],
    valuations: [{ id: "v1", holdingId: "h1", period: "2026-01", balance: 5 }]
  });
  assert.equal(out.accounts[0].pidmProtected, true, "v3->v4 ran");
  assert.equal(out.valuations[0].liabilityId, null, "v4->v5 ran");
});

test("newAccount defaults pidmProtected to false rather than assuming cover", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  assert.equal(lib.schema.newAccount("dev-1").pidmProtected, false);
});

test("softDelete tombstones a record instead of removing it", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var state = lib.schema.blank();
  var h = lib.schema.newHolding("dev-1");
  state.holdings.push(h);

  var ok = lib.store.softDelete(state.holdings, h.id, "dev-2");
  assert.equal(ok, true);
  assert.equal(state.holdings.length, 1, "record must stay in the array — tombstone, not removal");
  assert.equal(state.holdings[0].deleted, true);
  assert.equal(state.holdings[0].deviceId, "dev-2");
});

test("softDelete returns false for an unknown id and leaves the list untouched", function () {
  var window = helpers.freshWindow();
  var lib = helpers.loadLib(window);
  var state = lib.schema.blank();
  var ok = lib.store.softDelete(state.holdings, "does-not-exist", "dev-1");
  assert.equal(ok, false);
  assert.equal(state.holdings.length, 0);
});
