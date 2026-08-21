"use strict";
// Wealth Master — CSV export per entity (FR-7.7, and the bulk-edit path that replaces
// the hand-editable Sheet lost in ADR 001).
//
// Pure: takes rows, returns a string. No DOM, no download logic.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  // Excel and Sheets treat a leading = + - @ (or tab/CR) as the start of a formula, so a
  // holding innocently named "=SUM" — or maliciously named to pull data out via HYPERLINK
  // — would execute on open. Prefixing with an apostrophe forces it back to text. This
  // matters because these files are opened in Excel by design.
  var FORMULA_LEAD = /^[=+\-@\t\r]/;

  function cell(value) {
    if (value === null || value === undefined) return "";
    var s = String(value);
    if (FORMULA_LEAD.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // rows: array of objects. columns: array of key names, defining order.
  function toCsv(rows, columns) {
    var lines = [columns.map(cell).join(",")];
    (rows || []).forEach(function (row) {
      lines.push(columns.map(function (key) { return cell(row[key]); }).join(","));
    });
    return lines.join("\r\n");
  }

  // Column order per entity. Explicit rather than derived from the first row, so a record
  // missing an optional field cannot shift every subsequent column.
  var COLUMNS = {
    institutions: ["id", "name", "type", "pidmMember", "updatedAt", "deviceId", "deleted"],
    accounts: ["id", "institutionId", "name", "class", "currency", "shariah", "liquid",
               "pidmProtected", "archived", "updatedAt", "deviceId", "deleted"],
    holdings: ["id", "accountId", "name", "instrumentType", "rate", "feePct", "salesPct",
               "unitBased", "updatedAt", "deviceId", "deleted"],
    valuations: ["id", "holdingId", "liabilityId", "period", "balance", "units", "unitPrice",
                 "contribution", "withdrawal", "income", "note", "updatedAt", "deviceId", "deleted"],
    assets: ["id", "name", "class", "acquiredOn", "cost", "currentValue", "depreciationModel",
             "linkedLiabilityId", "liquid", "updatedAt", "deviceId", "deleted"],
    liabilities: ["id", "name", "type", "principal", "ratePct", "rateBasis", "tenureMonths",
                  "startDate", "instalment", "linkedAssetId", "updatedAt", "deviceId", "deleted"],
    loanPayments: ["id", "liabilityId", "period", "scheduled", "actual", "extra",
                   "updatedAt", "deviceId", "deleted"],
    scenarios: ["id", "name", "inflationPct", "updatedAt", "deviceId", "deleted"],
    goals: ["id", "name", "targetAmount", "targetDate", "updatedAt", "deviceId", "deleted"],
    reference: ["source", "key", "value", "asOf", "status"]
  };

  // Tombstones are included by default: an export is a backup, and dropping deleted rows
  // would make a round-trip lossy.
  function entityToCsv(state, entity, opts) {
    var columns = COLUMNS[entity];
    if (!columns) return null;
    var rows = Array.isArray(state[entity]) ? state[entity] : [];
    if (opts && opts.excludeDeleted) {
      rows = rows.filter(function (r) { return !r.deleted; });
    }
    return toCsv(rows, columns);
  }

  return { toCsv: toCsv, entityToCsv: entityToCsv, COLUMNS: COLUMNS };
});
