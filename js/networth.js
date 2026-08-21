"use strict";
// Wealth Master — net worth (FR-4.1, FR-4.2)
//
// Net worth = holdings − liabilities, as a monthly series.
//
// Carry-forward rule: a subject with no entry for the period keeps its last recorded
// balance, and that carried figure is marked stale with the month it came from. Showing
// nothing would understate net worth; carrying silently would present month-old data as
// current. The staleness travels with the number so the UI can never lose it.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"), require("./valuations.js"), require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema, val, ent) {

  // Whole months between two YYYY-MM periods.
  function monthsBetween(from, to) {
    if (!val.isPeriod(from) || !val.isPeriod(to)) return null;
    var fy = parseInt(from.slice(0, 4), 10), fm = parseInt(from.slice(5, 7), 10);
    var ty = parseInt(to.slice(0, 4), 10), tm = parseInt(to.slice(5, 7), 10);
    return (ty - fy) * 12 + (tm - fm);
  }

  // One subject's position for one period.
  // Returns null when nothing has ever been recorded — an account opened later must not
  // appear in earlier months at a balance it never held.
  function positionFor(state, subjectId, period) {
    var exact = val.valuationFor(state, subjectId, period);
    if (exact && exact.balance !== null && exact.balance !== undefined) {
      return { balance: exact.balance, stale: false, sourcePeriod: period, monthsStale: 0 };
    }
    var prior = val.lastRecordedBefore(state, subjectId, period);
    if (!prior) return null;
    return {
      balance: prior.balance,
      stale: true,
      sourcePeriod: prior.period,
      monthsStale: monthsBetween(prior.period, period)
    };
  }

  // Holdings whose account is live and unarchived. Archived accounts keep their history
  // but drop out of current totals (FR-1.5).
  function contributingHoldings(state) {
    return ent.live(state.holdings).filter(function (h) {
      var a = ent.byId(state.accounts, h.accountId);
      return a && !a.deleted && !a.archived;
    });
  }

  // Everything held at one period, with each line carrying its own staleness.
  function positionAt(state, period) {
    var lines = [];
    var assets = 0, liabilities = 0, liquid = 0, illiquid = 0, staleCount = 0;

    contributingHoldings(state).forEach(function (h) {
      var pos = positionFor(state, h.id, period);
      if (!pos) return;
      var acct = ent.byId(state.accounts, h.accountId);
      assets += pos.balance;
      if (acct && acct.liquid) liquid += pos.balance; else illiquid += pos.balance;
      if (pos.stale) staleCount++;
      lines.push({
        kind: "holding", id: h.id, name: h.name,
        accountName: acct ? acct.name : "", liquid: !!(acct && acct.liquid),
        balance: pos.balance, stale: pos.stale,
        sourcePeriod: pos.sourcePeriod, monthsStale: pos.monthsStale
      });
    });

    ent.live(state.liabilities).forEach(function (l) {
      var pos = positionFor(state, l.id, period);
      if (!pos) return;
      liabilities += pos.balance;
      if (pos.stale) staleCount++;
      lines.push({
        kind: "liability", id: l.id, name: l.name,
        balance: pos.balance, stale: pos.stale,
        sourcePeriod: pos.sourcePeriod, monthsStale: pos.monthsStale
      });
    });

    return {
      period: period,
      assets: assets,
      liabilities: liabilities,
      net: assets - liabilities,
      liquid: liquid,
      illiquid: illiquid,
      staleCount: staleCount,
      // Partial means at least one figure is carried forward, so the total is real but
      // resting on older data. The UI must say so rather than presenting it as current.
      partial: staleCount > 0,
      lines: lines
    };
  }

  // The monthly series from the first recorded period to `through` (default: the latest
  // recorded period). Every month in between is produced, including months with no
  // entries at all, since a gap in entry is not a gap in what was owned.
  function series(state, through) {
    var periods = val.periodsInState(state);
    if (!periods.length) return [];
    var start = periods[0];
    var end = through && val.isPeriod(through) ? through : periods[periods.length - 1];
    if (monthsBetween(start, end) < 0) return [];

    var out = [];
    var p = start;
    // Guard against a runaway loop on absurd inputs; 1200 months is a century.
    for (var i = 0; i <= 1200 && monthsBetween(p, end) >= 0; i++) {
      out.push(positionAt(state, p));
      p = nextPeriod(p);
    }
    return out;
  }

  function nextPeriod(period) {
    var y = parseInt(period.slice(0, 4), 10);
    var m = parseInt(period.slice(5, 7), 10) + 1;
    if (m === 13) { y += 1; m = 1; }
    return y + "-" + String(m).padStart(2, "0");
  }

  // Change between two points in the series, for "up or down since last month".
  function changeBetween(earlier, later) {
    if (!earlier || !later) return null;
    var delta = later.net - earlier.net;
    return {
      delta: delta,
      pct: earlier.net === 0 ? null : (delta / Math.abs(earlier.net)) * 100
    };
  }

  return {
    monthsBetween: monthsBetween,
    nextPeriod: nextPeriod,
    positionFor: positionFor,
    contributingHoldings: contributingHoldings,
    positionAt: positionAt,
    series: series,
    changeBetween: changeBetween
  };
});
