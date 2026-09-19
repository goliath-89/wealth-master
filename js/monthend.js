"use strict";
// Wealth Master — the month-end queue (P8, docs/ui-redesign-plan.md)
//
// A month-end is a checklist before it is a form: which figures still need a number for
// this month? This module answers that, in the order they should be asked, so the screen
// can walk down the list one figure at a time instead of presenting every field at once.
//
// It agrees with the "N due" badge by construction: a figure that is due here is a line
// net worth is carrying forward from an earlier month. A subject that has never been
// recorded is listed too — after the due ones, marked as new — because that is exactly
// what somebody setting the app up needs to be asked, even though it is not "overdue".
//
// Rules carried over: blank is not zero (a figure with no entry is unrecorded, never RM 0),
// and a holding priced by units is not asked for a ringgit balance, which the unit maths
// would overwrite. Reads state and returns data; it never mutates.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"), require("./fx.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val, fx) {

  function recordedFor(state, id, period) {
    var v = val.valuationFor(state, id, period);
    return !!(v && v.balance !== null && v.balance !== undefined);
  }

  // Everything that can be asked for a figure this month, before any filtering.
  function subjects(state) {
    var out = [];
    ent.live(state.holdings).forEach(function (h) {
      var acct = ent.byId(state.accounts, h.accountId);
      if (!acct || acct.deleted || acct.archived) return;
      var inst = ent.byId(state.institutions, acct.institutionId);
      out.push({
        kind: "holding", id: h.id, name: h.name,
        context: (inst ? inst.name + " · " : "") + acct.name,
        unitBased: !!h.unitBased,
        needsRate: fx.needsConversion(acct),
        currency: fx.normCurrency(acct.currency)
      });
    });
    ent.live(state.assets).forEach(function (a) {
      out.push({ kind: "asset", id: a.id, name: a.name, context: a.class || "asset",
        unitBased: false, needsRate: false, currency: "MYR" });
    });
    ent.live(state.liabilities).forEach(function (l) {
      out.push({ kind: "liability", id: l.id, name: l.name, context: l.type || "liability",
        unitBased: false, needsRate: false, currency: "MYR" });
    });
    return out;
  }

  // What is left to record for `period`.
  //   items         due first (there is an earlier figure being carried), then new ones
  //   recorded      how many already have a figure for this month
  //   pricedByUnits holdings the queue cannot ask, because their balance is units x price
  function monthQueue(state, period) {
    var due = [], fresh = [], priced = [], recorded = 0;
    subjects(state).forEach(function (s) {
      if (recordedFor(state, s.id, period)) { recorded++; return; }
      if (s.unitBased) { priced.push(s); return; }
      var prior = val.lastRecordedBefore(state, s.id, period);
      var item = {
        kind: s.kind, id: s.id, name: s.name, context: s.context,
        needsRate: s.needsRate, currency: s.currency,
        status: prior ? "due" : "fresh",
        prior: prior ? { balance: prior.balance, period: prior.period } : null,
        // What is already in this month's entry under the balance, so saving a balance
        // cannot wipe an income or contribution entered earlier (applyMonth blanks any
        // amount it is not given).
        existing: val.valuationFor(state, s.id, period)
      };
      (prior ? due : fresh).push(item);
    });
    var items = due.concat(fresh);
    return {
      period: period, items: items, recorded: recorded, pricedByUnits: priced,
      total: items.length + recorded
    };
  }

  return { monthQueue: monthQueue };
});
