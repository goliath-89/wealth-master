"use strict";
// Wealth Master — monthly valuations (FR-1.2, FR-1.3, FR-1.8)
//
// The governing rule here: **blank is not zero**. A skipped account has an unknown
// balance, not a balance of RM 0. Storing null for "not recorded" keeps a forgotten
// account visibly missing instead of silently dragging net worth down — the exact class
// of confidently-wrong output this project exists to avoid.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  var AMOUNT_FIELDS = ["balance", "contribution", "withdrawal", "income"];

  // "" -> null (not recorded). "0" -> 0. Thousands separators and a leading RM are
  // tolerated because that is how the figures appear on a statement.
  // Returns { value, error }.
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return { value: null, error: null };
    if (typeof raw === "number") return isNaN(raw) ? { value: null, error: "not a number" } : { value: raw, error: null };
    var s = String(raw).trim();
    if (s === "") return { value: null, error: null };
    s = s.replace(/^RM\s*/i, "").replace(/,/g, "");
    if (!/^-?\d*\.?\d+$/.test(s)) return { value: null, error: "not a number" };
    var n = parseFloat(s);
    return isNaN(n) ? { value: null, error: "not a number" } : { value: n, error: null };
  }

  function isPeriod(p) {
    return typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
  }

  function prevPeriod(period) {
    if (!isPeriod(period)) return null;
    var y = parseInt(period.slice(0, 4), 10);
    var m = parseInt(period.slice(5, 7), 10) - 1;
    if (m === 0) { y -= 1; m = 12; }
    return y + "-" + String(m).padStart(2, "0");
  }

  function currentPeriod(now) {
    var d = now || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function valuationFor(state, holdingId, period) {
    var list = state.valuations || [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].deleted && list[i].holdingId === holdingId && list[i].period === period) return list[i];
    }
    return null;
  }

  // Most recent non-deleted valuation strictly before `period`, for showing last known
  // balance as context while entering the new one.
  function lastRecordedBefore(state, holdingId, period) {
    var best = null;
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || v.holdingId !== holdingId) return;
      if (v.period >= period) return;
      if (v.balance === null || v.balance === undefined) return;
      if (!best || v.period > best.period) best = v;
    });
    return best;
  }

  function periodsInState(state) {
    var seen = {};
    (state.valuations || []).forEach(function (v) {
      if (!v.deleted && isPeriod(v.period)) seen[v.period] = true;
    });
    return Object.keys(seen).sort();
  }

  function isEmptyEntry(entry) {
    var noAmounts = AMOUNT_FIELDS.every(function (f) {
      return entry[f] === null || entry[f] === undefined;
    });
    return noAmounts && !(entry.note && String(entry.note).trim());
  }

  // Creates, updates, or tombstones one holding's entry for one period.
  // Clearing every field on an existing entry removes it — otherwise the store would
  // accumulate rows that assert nothing. Returns { action, record }.
  function upsertValuation(state, entry, deviceId) {
    var existing = valuationFor(state, entry.holdingId, entry.period);
    var empty = isEmptyEntry(entry);

    if (empty) {
      if (!existing) return { action: "none", record: null };
      existing.deleted = true;
      existing.updatedAt = schema.nowIso();
      existing.deviceId = deviceId;
      return { action: "deleted", record: existing };
    }

    var target = existing;
    if (!target) {
      target = schema.newValuation(deviceId);
      target.holdingId = entry.holdingId;
      target.period = entry.period;
      state.valuations.push(target);
    }
    AMOUNT_FIELDS.forEach(function (f) {
      target[f] = entry[f] === undefined ? null : entry[f];
    });
    target.note = entry.note || "";
    target.deleted = false;
    target.updatedAt = schema.nowIso();
    target.deviceId = deviceId;
    return { action: existing ? "updated" : "created", record: target };
  }

  // Applies a whole month at once (FR-1.8). Rows with unparseable amounts are reported
  // and skipped; the rest still save, so one typo cannot cost the whole session.
  function applyMonth(state, period, rows, deviceId) {
    var result = { created: 0, updated: 0, deleted: 0, errors: [] };
    if (!isPeriod(period)) {
      result.errors.push({ holdingId: null, message: "Pick a valid month" });
      return result;
    }

    rows.forEach(function (row) {
      var entry = { holdingId: row.holdingId, period: period, note: row.note };
      var bad = null;
      AMOUNT_FIELDS.forEach(function (f) {
        var parsed = parseAmount(row[f]);
        if (parsed.error) bad = bad || f;
        entry[f] = parsed.value;
      });
      if (bad) {
        result.errors.push({ holdingId: row.holdingId, field: bad, message: "Not a number" });
        return;
      }
      var res = upsertValuation(state, entry, deviceId);
      if (res.action === "created") result.created++;
      else if (res.action === "updated") result.updated++;
      else if (res.action === "deleted") result.deleted++;
    });
    return result;
  }

  return {
    AMOUNT_FIELDS: AMOUNT_FIELDS,
    parseAmount: parseAmount,
    isPeriod: isPeriod,
    prevPeriod: prevPeriod,
    currentPeriod: currentPeriod,
    valuationFor: valuationFor,
    lastRecordedBefore: lastRecordedBefore,
    periodsInState: periodsInState,
    isEmptyEntry: isEmptyEntry,
    upsertValuation: upsertValuation,
    applyMonth: applyMonth
  };
});
