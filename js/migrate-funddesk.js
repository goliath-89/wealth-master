"use strict";
// Wealth Master — Fund Desk v1 -> schema v3 migration (P0.4, AC-8)
//
// Fund Desk v1 has no Institution/Account concept — it's a flat list of funds.
// Mapping: one Institution per distinct provider (deduped by name, case-insensitive),
// one Account per fund (so the fund's `shariah` flag has a home — Account carries
// shariah in schema v3, Holding does not), one Holding per fund, one Valuation per entry.
//
// Two fields don't survive: fund.col (chart colour — P0 ships no charts to colour)
// and per-fund `pidm` precision (schema v3 only tracks pidmMember on Institution, not
// Account, despite FR-9.5 describing it as per-account; this migration ORs every
// fund's pidm flag onto its institution as a best-effort approximation).
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  var newInstitution = schema.newInstitution;
  var newAccount = schema.newAccount;
  var newHolding = schema.newHolding;
  var newValuation = schema.newValuation;

  // fdExport: parsed JSON from Fund Desk v1's "Export JSON" button, shape
  // { schemaVersion, funds: [...], entries: [...], settings }.
  // existingInstitutions: state.institutions already present, so a repeat run
  // (or migrating into a non-empty store) reuses institutions instead of duplicating.
  // Returns { institutions, accounts, holdings, valuations, warnings }.
  function migrateFromFundDesk(fdExport, deviceId, existingInstitutions) {
    var warnings = [];
    var institutions = [];
    var accounts = [];
    var holdings = [];
    var valuations = [];

    if (!fdExport || !Array.isArray(fdExport.funds)) {
      warnings.push("Input is not a Fund Desk v1 export (missing `funds` array).");
      return { institutions: institutions, accounts: accounts, holdings: holdings, valuations: valuations, warnings: warnings };
    }

    var institutionByName = {};
    (existingInstitutions || []).forEach(function (inst) {
      institutionByName[String(inst.name).trim().toLowerCase()] = inst;
    });

    var holdingIdByFundId = {};

    (fdExport.funds || []).forEach(function (f) {
      var provName = (f.provider || "Unknown").trim();
      var key = provName.toLowerCase();
      var inst = institutionByName[key];
      if (!inst) {
        inst = newInstitution(deviceId);
        inst.name = provName;
        inst.type = "fund provider";
        inst.pidmMember = !!f.pidm;
        institutionByName[key] = inst;
        institutions.push(inst);
      } else if (f.pidm) {
        inst.pidmMember = true;
      }

      var acct = newAccount(deviceId);
      acct.institutionId = inst.id;
      acct.name = f.name;
      acct.class = "investment";
      acct.currency = "MYR";
      acct.shariah = !!f.shariah;
      acct.liquid = true;
      accounts.push(acct);

      var hold = newHolding(deviceId);
      hold.accountId = acct.id;
      hold.name = f.name;
      hold.instrumentType = f.cat || "";
      hold.rate = typeof f.rate === "number" ? f.rate : 0;
      hold.feePct = typeof f.fee === "number" ? f.fee : 0;
      hold.salesPct = typeof f.sales === "number" ? f.sales : 0;
      hold.unitBased = false;
      holdings.push(hold);

      holdingIdByFundId[f.id] = hold.id;
    });

    (fdExport.entries || []).forEach(function (e) {
      var holdingId = holdingIdByFundId[e.fundId];
      if (!holdingId) {
        warnings.push("Entry " + e.id + " references unknown fund " + e.fundId + " — skipped.");
        return;
      }
      var val = newValuation(deviceId);
      val.holdingId = holdingId;
      val.period = e.month;
      val.balance = typeof e.balance === "number" ? e.balance : 0;
      val.contribution = typeof e.contribution === "number" ? e.contribution : 0;
      val.withdrawal = 0;
      val.income = typeof e.income === "number" ? e.income : 0;
      val.note = e.note || "";
      valuations.push(val);
    });

    return { institutions: institutions, accounts: accounts, holdings: holdings, valuations: valuations, warnings: warnings };
  }

  return { migrateFromFundDesk: migrateFromFundDesk };
});
