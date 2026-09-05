"use strict";
// Wealth Master — LHDN relief-eligible totals (FR-9.4, scenario S6)
//
// Sums what was actually contributed in a calendar year, per relief category, so the
// figures can be carried into a tax return.
//
// IMPORTANT: this reports contributions, it does not compute tax. Relief limits change
// from one assessment year to the next, and eligibility depends on circumstances this
// app knows nothing about. The limits below are editable defaults to compare against,
// not authority — every total is presented for the owner to check against LHDN for the
// year they are filing. NG5 stands: surfacing totals is in scope, filing is not.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent) {

  // Starting points only. Malaysian reliefs are revised in most budgets, and several
  // share a combined ceiling with items this app cannot see (life insurance premiums,
  // for instance). Treat every figure here as needing confirmation for the assessment
  // year being filed.
  var CATEGORIES = [
    { key: "epf", label: "EPF / provident fund", defaultLimit: 4000,
      note: "Often shares a combined ceiling with life insurance premiums." },
    { key: "prs", label: "PRS (private retirement)", defaultLimit: 3000,
      note: "Separate from EPF relief." },
    { key: "sspn", label: "SSPN education savings", defaultLimit: 8000,
      note: "Net of withdrawals in the same year." },
    { key: "insurance", label: "Life insurance / takaful", defaultLimit: 3000,
      note: "Premiums paid outside this app are not counted here." },
    { key: "other", label: "Other relief-eligible", defaultLimit: 0,
      note: "No default limit — set one if it applies." }
  ];

  function categoryFor(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) return CATEGORIES[i];
    }
    return null;
  }

  function limitFor(state, key) {
    var custom = state.settings && state.settings.reliefLimits;
    if (custom && custom[key] !== undefined && custom[key] !== null) return Number(custom[key]);
    var cat = categoryFor(key);
    return cat ? cat.defaultLimit : 0;
  }

  // Every calendar year that has a contribution against a tagged holding.
  function yearsWithContributions(state) {
    var tagged = {};
    ent.live(state.holdings).forEach(function (h) {
      if (h.reliefCategory) tagged[h.id] = h.reliefCategory;
    });
    var years = {};
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || !tagged[v.holdingId]) return;
      if (v.contribution === null || v.contribution === undefined || v.contribution === 0) return;
      if (typeof v.period === "string" && v.period.length >= 4) years[v.period.slice(0, 4)] = true;
    });
    return Object.keys(years).sort().reverse();
  }

  // Totals for one calendar year, per category.
  //
  // Withdrawals are netted off, because several reliefs (SSPN in particular) are assessed
  // net of what was taken out in the same year. Reporting the gross would overstate the
  // claim.
  function totalsFor(state, year) {
    var tagged = {};
    ent.live(state.holdings).forEach(function (h) {
      if (h.reliefCategory) tagged[h.id] = h.reliefCategory;
    });

    var byCategory = {};
    CATEGORIES.forEach(function (c) {
      byCategory[c.key] = { key: c.key, label: c.label, note: c.note, contributed: 0, withdrawn: 0, holdings: [] };
    });

    (state.valuations || []).forEach(function (v) {
      var key = tagged[v.holdingId];
      if (v.deleted || !key) return;
      if (typeof v.period !== "string" || v.period.slice(0, 4) !== String(year)) return;
      var bucket = byCategory[key];
      if (!bucket) return;
      if (v.contribution) bucket.contributed += v.contribution;
      if (v.withdrawal) bucket.withdrawn += v.withdrawal;
      if (bucket.holdings.indexOf(v.holdingId) === -1) bucket.holdings.push(v.holdingId);
    });

    var lines = CATEGORIES.map(function (c) {
      var b = byCategory[c.key];
      var net = Math.round((b.contributed - b.withdrawn) * 100) / 100;
      var limit = limitFor(state, c.key);
      return {
        key: c.key,
        label: c.label,
        note: c.note,
        contributed: Math.round(b.contributed * 100) / 100,
        withdrawn: Math.round(b.withdrawn * 100) / 100,
        net: net,
        limit: limit,
        claimable: limit > 0 ? Math.min(net, limit) : net,
        headroom: limit > 0 ? Math.round(Math.max(0, limit - net) * 100) / 100 : null,
        overLimit: limit > 0 && net > limit,
        holdingCount: b.holdings.length
      };
    }).filter(function (line) {
      return line.contributed > 0 || line.withdrawn > 0;
    });

    return {
      year: String(year),
      lines: lines,
      totalClaimable: Math.round(lines.reduce(function (n, l) { return n + l.claimable; }, 0) * 100) / 100,
      totalContributed: Math.round(lines.reduce(function (n, l) { return n + l.net; }, 0) * 100) / 100,
      // Never presented as a tax figure. It is a sum of what was paid in, for checking.
      illustrative: true
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    categoryFor: categoryFor,
    limitFor: limitFor,
    yearsWithContributions: yearsWithContributions,
    totalsFor: totalsFor
  };
});
