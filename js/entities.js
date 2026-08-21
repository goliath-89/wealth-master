"use strict";
// Wealth Master — entity operations (FR-1.1, FR-1.5, FR-1.6)
//
// Pure domain logic over a state object: lookup, validation, referential integrity and
// upsert. No DOM. The UI decides how to present a refusal; this module decides whether
// the operation is legal and why not.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  var nowIso = schema.nowIso;

  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // Everything not tombstoned. Archived records are still live — they keep their history
  // and simply drop out of current totals (FR-1.5).
  function live(list) {
    return (list || []).filter(function (r) { return !r.deleted; });
  }

  function active(list) {
    return (list || []).filter(function (r) { return !r.deleted && !r.archived; });
  }

  function accountsFor(state, institutionId) {
    return live(state.accounts).filter(function (a) { return a.institutionId === institutionId; });
  }

  function holdingsFor(state, accountId) {
    return live(state.holdings).filter(function (h) { return h.accountId === accountId; });
  }

  function valuationsFor(state, holdingId) {
    return live(state.valuations).filter(function (v) { return v.holdingId === holdingId; });
  }

  // What still points at this record. Used to refuse a delete that would orphan data
  // rather than cascading silently — a cascade here would tombstone years of valuations
  // from one tap.
  function dependents(state, entity, id) {
    if (entity === "institutions") {
      return { accounts: accountsFor(state, id).length };
    }
    if (entity === "accounts") {
      return { holdings: holdingsFor(state, id).length };
    }
    if (entity === "holdings") {
      return { valuations: valuationsFor(state, id).length };
    }
    return {};
  }

  // { ok, reason }. Refusing is deliberate: the owner archives instead, or removes the
  // children first, so no record is ever silently detached from its history.
  function canDelete(state, entity, id) {
    var deps = dependents(state, entity, id);
    var blocking = Object.keys(deps).filter(function (k) { return deps[k] > 0; });
    if (!blocking.length) return { ok: true, reason: null, dependents: deps };
    return { ok: false, reason: "has-dependents", dependents: deps };
  }

  function num(v) {
    if (v === "" || v === null || v === undefined) return 0;
    var n = typeof v === "number" ? v : parseFloat(v);
    return isNaN(n) ? NaN : n;
  }

  // Returns an array of human-readable problems; empty means valid.
  function validate(entity, rec, state) {
    var errors = [];
    var name = (rec.name || "").trim();
    if (!name) errors.push("Name is required");

    if (entity === "accounts") {
      if (!rec.institutionId || !byId(state.institutions, rec.institutionId)) {
        errors.push("Pick an institution");
      }
      var cur = (rec.currency || "").trim();
      if (!/^[A-Za-z]{3}$/.test(cur)) errors.push("Currency must be a 3-letter code, e.g. MYR");
    }

    if (entity === "holdings") {
      if (!rec.accountId || !byId(state.accounts, rec.accountId)) {
        errors.push("Pick an account");
      }
      ["rate", "feePct", "salesPct"].forEach(function (k) {
        var n = num(rec[k]);
        if (isNaN(n)) errors.push(labelFor(k) + " must be a number");
        else if (n < 0) errors.push(labelFor(k) + " cannot be negative");
      });
    }
    return errors;
  }

  function labelFor(key) {
    return { rate: "Rate", feePct: "Fee", salesPct: "Sales charge" }[key] || key;
  }

  // Creates or updates in place, stamping updatedAt/deviceId. Returns the stored record.
  // Callers validate first; this does not re-check.
  function upsert(state, entity, rec, deviceId) {
    var list = state[entity];
    var existing = rec.id ? byId(list, rec.id) : null;
    if (existing) {
      for (var k in rec) {
        if (k !== "id") existing[k] = rec[k];
      }
      existing.updatedAt = nowIso();
      existing.deviceId = deviceId;
      return existing;
    }
    rec.id = rec.id || schema.uid();
    rec.deleted = false;
    rec.updatedAt = nowIso();
    rec.deviceId = deviceId;
    list.push(rec);
    return rec;
  }

  function setArchived(state, entity, id, archived, deviceId) {
    var rec = byId(state[entity], id);
    if (!rec) return null;
    rec.archived = !!archived;
    rec.updatedAt = nowIso();
    rec.deviceId = deviceId;
    return rec;
  }

  return {
    byId: byId,
    live: live,
    active: active,
    accountsFor: accountsFor,
    holdingsFor: holdingsFor,
    valuationsFor: valuationsFor,
    dependents: dependents,
    canDelete: canDelete,
    validate: validate,
    upsert: upsert,
    setArchived: setArchived
  };
});
