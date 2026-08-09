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
  window.localStorage.setItem("wealthmaster.v3", "{not valid json");
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
