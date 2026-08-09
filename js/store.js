"use strict";
// Wealth Master — localStorage store with versioned migrations (FR-7.2, FR-7.8, P0.3)
// Sheets sync (FR-7.1) lands in a later session; this is the offline cache and,
// until sync exists, the only copy — treat it as durable for now.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  var SCHEMA_VERSION = schema.SCHEMA_VERSION;
  var ENTITY_LISTS = schema.ENTITY_LISTS;
  var blank = schema.blank;
  var nowIso = schema.nowIso;

  var STORE_KEY = "wealthmaster.v3";

  // Each entry migrates state from (version i) -> (version i+1). Applied in order,
  // starting from state.schemaVersion, up to SCHEMA_VERSION. Never delete an entry:
  // old exports/devices must still be able to migrate forward.
  var MIGRATIONS = {
    // Placeholder for the first real migration once schema v4 exists, e.g.:
    // 3: function(o) { /* mutate o in place for the v3 -> v4 change */ return o; }
  };

  function migrate(raw) {
    if (!raw || typeof raw !== "object") return blank();
    var o = raw;
    var v = typeof o.schemaVersion === "number" ? o.schemaVersion : 1;
    while (v < SCHEMA_VERSION) {
      var step = MIGRATIONS[v];
      if (step) o = step(o);
      v++;
    }
    o.schemaVersion = SCHEMA_VERSION;
    ENTITY_LISTS.forEach(function (key) {
      if (!Array.isArray(o[key])) o[key] = [];
    });
    if (!Array.isArray(o.conflictLog)) o.conflictLog = [];
    if (!o.settings) o.settings = { theme: "dark" };
    if (!o.sync) o.sync = { status: "offline", lastSyncAt: null, pendingCount: 0 };
    return o;
  }

  // Returns { state, error } — never throws. A corrupt or missing value in
  // localStorage falls back to a blank state rather than crashing the app.
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { state: blank(), error: null };
      return { state: migrate(JSON.parse(raw)), error: null };
    } catch (e) {
      return { state: blank(), error: e };
    }
  }

  // Returns { ok, error }. Never throws — callers surface `error` to the UI
  // (e.g. quota exceeded) instead of losing the in-memory state.
  function save(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // Tombstone delete: never remove a record from its array, only flag it.
  function softDelete(list, id, deviceId) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].deleted = true;
        list[i].updatedAt = nowIso();
        list[i].deviceId = deviceId;
        return true;
      }
    }
    return false;
  }

  return {
    STORE_KEY: STORE_KEY,
    MIGRATIONS: MIGRATIONS,
    migrate: migrate,
    load: load,
    save: save,
    softDelete: softDelete
  };
});
