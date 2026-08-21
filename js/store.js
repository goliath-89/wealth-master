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

  // Deliberately NOT versioned — the schema version lives inside the payload and is
  // handled by the migration ladder below. A version-suffixed key would orphan the
  // user's data on every bump, which is the exact failure migrations exist to prevent.
  var STORE_KEY = "wealthmaster.state";

  // Keys written by earlier builds, newest first. Read once on load if STORE_KEY is
  // empty, then migrated forward and rewritten under STORE_KEY.
  var LEGACY_KEYS = ["wealthmaster.v3"];

  // Each entry migrates state from (version i) -> (version i+1). Applied in order,
  // starting from state.schemaVersion, up to SCHEMA_VERSION. Never delete an entry:
  // old exports/devices must still be able to migrate forward.
  var MIGRATIONS = {
    // v3 -> v4: PIDM coverage moved from an institution-only flag to a per-account
    // one (FR-9.5). Backfill honestly rather than optimistically: PIDM protects
    // deposits, not investments, so only cash accounts at a member institution are
    // marked protected. Anything else stays false for the owner to confirm.
    3: function (o) {
      var memberIds = {};
      (o.institutions || []).forEach(function (inst) {
        if (inst && inst.pidmMember) memberIds[inst.id] = true;
      });
      (o.accounts || []).forEach(function (acct) {
        if (acct.pidmProtected === undefined) {
          acct.pidmProtected = !!memberIds[acct.institutionId] && acct.class === "cash";
        }
      });
      return o;
    },

    // v4 -> v5: valuations can now describe a liability as well as a holding, so a
    // liability carries a monthly outstanding balance rather than one static figure.
    // Existing rows are all holdings; the field is set explicitly rather than left
    // undefined so the shape is uniform for export and CSV.
    4: function (o) {
      (o.valuations || []).forEach(function (v) {
        if (v.liabilityId === undefined) v.liabilityId = null;
      });
      return o;
    },

    // v5 -> v6: physical assets gain a value over time rather than one currentValue
    // field. Any existing currentValue is converted into a valuation at the asset's
    // acquisition period before the field is dropped, so no figure is lost (FR-7.8).
    5: function (o) {
      (o.valuations || []).forEach(function (v) {
        if (v.assetId === undefined) v.assetId = null;
      });
      (o.assets || []).forEach(function (a) {
        if (a.currentValue === undefined || a.currentValue === null) {
          delete a.currentValue;
          return;
        }
        var period = a.acquiredOn ? String(a.acquiredOn).slice(0, 7) : null;
        if (period && /^\d{4}-\d{2}$/.test(period)) {
          o.valuations = o.valuations || [];
          o.valuations.push({
            id: "mig-" + a.id, holdingId: null, liabilityId: null, assetId: a.id,
            period: period, balance: a.currentValue, units: null, unitPrice: null,
            contribution: null, withdrawal: null, income: null,
            note: "migrated from currentValue",
            updatedAt: a.updatedAt || new Date().toISOString(),
            deviceId: a.deviceId || "migration", deleted: false
          });
        }
        delete a.currentValue;
      });
      return o;
    }
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
      if (!raw) {
        for (var i = 0; i < LEGACY_KEYS.length && !raw; i++) {
          raw = localStorage.getItem(LEGACY_KEYS[i]);
        }
      }
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
    LEGACY_KEYS: LEGACY_KEYS,
    MIGRATIONS: MIGRATIONS,
    migrate: migrate,
    load: load,
    save: save,
    softDelete: softDelete
  };
});
