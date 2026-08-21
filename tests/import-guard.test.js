"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() {
  var window = helpers.freshWindow();
  return helpers.loadLib(window);
}

// Builds a state with holdings stamped at given times. rec = [id, updatedAt, deviceId]
function stateWith(recs, entity) {
  var l = lib();
  var s = l.schema.blank();
  (recs || []).forEach(function (r) {
    s[entity || "holdings"].push({
      id: r[0], updatedAt: r[1], deviceId: r[2] || "dev-laptop", deleted: false, name: r[0]
    });
  });
  return s;
}

test("importing into an empty store is always safe", function () {
  var g = lib().importGuard;
  var incoming = stateWith([["h1", "2026-08-01T10:00:00.000Z"]]);
  var res = g.assessImport(incoming, lib().schema.blank());
  assert.equal(res.safe, true);
  assert.equal(res.verdict, "empty-local");
  assert.equal(res.losses.total, 0);
});

test("a strictly newer file is safe and reports no losses", function () {
  var g = lib().importGuard;
  var local = stateWith([["h1", "2026-08-01T10:00:00.000Z"]]);
  var incoming = stateWith([["h1", "2026-08-05T10:00:00.000Z"]]);
  var res = g.assessImport(incoming, local);
  assert.equal(res.safe, true);
  assert.equal(res.verdict, "newer");
});

test("an identical file is safe and reported as same, not newer", function () {
  var g = lib().importGuard;
  var recs = [["h1", "2026-08-01T10:00:00.000Z"]];
  var res = g.assessImport(stateWith(recs), stateWith(recs));
  assert.equal(res.safe, true);
  assert.equal(res.verdict, "same");
});

test("a stale file is flagged unsafe and counts exactly what would be lost", function () {
  var g = lib().importGuard;
  // Local has a newer edit to h1, plus h2 which the incoming file has never seen.
  var local = stateWith([
    ["h1", "2026-08-10T10:00:00.000Z"],
    ["h2", "2026-08-10T11:00:00.000Z"]
  ]);
  var incoming = stateWith([["h1", "2026-08-07T10:00:00.000Z"]]);

  var res = g.assessImport(incoming, local);
  assert.equal(res.safe, false);
  assert.equal(res.verdict, "stale");
  assert.equal(res.losses.total, 2, "both the newer edit and the unseen record count");
  assert.equal(res.losses.byEntity.holdings, 2);
  assert.equal(res.daysApart, 3);
});

test("losses are counted per entity so the warning can be specific", function () {
  var g = lib().importGuard;
  var l = lib();
  var local = l.schema.blank();
  local.holdings.push({ id: "h1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "d", deleted: false });
  local.valuations.push({ id: "v1", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "d", deleted: false });
  local.valuations.push({ id: "v2", updatedAt: "2026-08-10T10:00:00.000Z", deviceId: "d", deleted: false });

  var res = g.assessImport(l.schema.blank(), local);
  assert.equal(res.losses.total, 3);
  assert.equal(res.losses.byEntity.holdings, 1);
  assert.equal(res.losses.byEntity.valuations, 2);
});

test("a local tombstone counts as a change that would be lost", function () {
  var g = lib().importGuard;
  var local = stateWith([["h1", "2026-08-10T10:00:00.000Z"]]);
  local.holdings[0].deleted = true; // deleting is an edit, not an absence
  var incoming = stateWith([["h1", "2026-08-01T10:00:00.000Z"]]);
  var res = g.assessImport(incoming, local);
  assert.equal(res.safe, false);
  assert.equal(res.losses.total, 1);
});

test("the incoming file's devices are reported newest-first, to name the source", function () {
  var g = lib().importGuard;
  var incoming = stateWith([
    ["h1", "2026-08-01T10:00:00.000Z", "dev-laptop"],
    ["h2", "2026-08-09T10:00:00.000Z", "dev-phone"]
  ]);
  var res = g.assessImport(incoming, lib().schema.blank());
  assert.equal(res.incomingDevices[0].deviceId, "dev-phone");
  assert.equal(res.incomingDevices[1].deviceId, "dev-laptop");
});

test("an unstamped legacy record does not crash the guard", function () {
  var g = lib().importGuard;
  var l = lib();
  var local = l.schema.blank();
  local.holdings.push({ id: "h1" }); // no updatedAt, no deviceId
  var incoming = l.schema.blank();
  var res;
  assert.doesNotThrow(function () { res = g.assessImport(incoming, local); });
  // Present locally, absent from the file — still counts as a loss.
  assert.equal(res.losses.total, 1);
  assert.equal(res.verdict, "stale");
  // An unstamped record yields no timestamp, so the UI must cope with a null age
  // rather than rendering "NaN days older".
  assert.equal(res.localAt, null);
  assert.equal(res.daysApart, null);
});

test("latestChangeAt returns null for a state with no stamped records", function () {
  var g = lib().importGuard;
  assert.equal(g.latestChangeAt(lib().schema.blank()), null);
});
