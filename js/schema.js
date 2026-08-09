"use strict";
// Wealth Master — schema v3 data model (FR-7.5, FR-7.8, requirements.md section 6)
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    var exported = factory();
    root.WM = root.WM || {};
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function () {

  var SCHEMA_VERSION = 3;

  var ENTITY_LISTS = [
    "institutions", "accounts", "holdings", "valuations",
    "assets", "liabilities", "loanPayments", "scenarios", "goals", "reference"
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getDeviceId() {
    var KEY = "wealthmaster.deviceId";
    try {
      var id = localStorage.getItem(KEY);
      if (!id) {
        id = "dev-" + uid();
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (e) {
      // localStorage unavailable (e.g. private mode) — per-session fallback only
      return "dev-" + uid();
    }
  }

  // Stamps a record with the fields every mutable record must carry (FR-7.4, FR-7.5).
  // Mutates and returns the record so call sites can chain: stamp(obj, deviceId)
  function stamp(record, deviceId) {
    record.updatedAt = nowIso();
    record.deviceId = deviceId;
    if (record.deleted === undefined) record.deleted = false;
    return record;
  }

  function blank() {
    return {
      schemaVersion: SCHEMA_VERSION,
      institutions: [],
      accounts: [],
      holdings: [],
      valuations: [],
      assets: [],
      liabilities: [],
      loanPayments: [],
      scenarios: [],
      goals: [],
      reference: [],
      conflictLog: [],
      settings: { theme: "dark" },
      sync: { status: "offline", lastSyncAt: null, pendingCount: 0 }
    };
  }

  // Factory helpers — id + tombstone fields only; callers set the domain fields.
  function newInstitution(deviceId) {
    return stamp({ id: uid(), name: "", type: "", pidmMember: false }, deviceId);
  }
  function newAccount(deviceId) {
    return stamp({
      id: uid(), institutionId: null, name: "", class: "cash",
      currency: "MYR", shariah: false, liquid: true, archived: false
    }, deviceId);
  }
  function newHolding(deviceId) {
    return stamp({
      id: uid(), accountId: null, name: "", instrumentType: "",
      rate: 0, feePct: 0, salesPct: 0, unitBased: false
    }, deviceId);
  }
  function newValuation(deviceId) {
    return stamp({
      id: uid(), holdingId: null, period: "", balance: 0, units: null,
      unitPrice: null, contribution: 0, withdrawal: 0, income: 0, note: ""
    }, deviceId);
  }
  function newAsset(deviceId) {
    return stamp({
      id: uid(), name: "", class: "", acquiredOn: null, cost: 0,
      currentValue: 0, depreciationModel: null, linkedLiabilityId: null, liquid: false
    }, deviceId);
  }
  function newLiability(deviceId) {
    return stamp({
      id: uid(), name: "", type: "", principal: 0, ratePct: 0,
      rateBasis: "reducing", tenureMonths: 0, startDate: null,
      instalment: 0, linkedAssetId: null
    }, deviceId);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    ENTITY_LISTS: ENTITY_LISTS,
    uid: uid,
    nowIso: nowIso,
    getDeviceId: getDeviceId,
    stamp: stamp,
    blank: blank,
    newInstitution: newInstitution,
    newAccount: newAccount,
    newHolding: newHolding,
    newValuation: newValuation,
    newAsset: newAsset,
    newLiability: newLiability
  };
});
