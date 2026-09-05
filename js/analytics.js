"use strict";
// Wealth Master — realised yield and allocation (FR-1.4, FR-4.3)
//
// The Fund Desk principle, carried forward (G5): report what a holding ACTUALLY paid,
// derived from recorded income against the balance that earned it — never the advertised
// rate. The two diverge by fees, by timing, and by rates being cut without announcement.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./valuations.js"), require("./entities.js"), require("./networth.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (val, ent, nw) {

  // Realised yield: mean monthly income over mean balance, annualised.
  //
  // Only months that recorded BOTH a balance and an income count. A month where income
  // was left blank is unknown, not zero — averaging it in as zero would understate the
  // yield and make a good fund look mediocre.
  function realisedYield(state, holdingId) {
    var rows = (state.valuations || []).filter(function (v) {
      return !v.deleted && v.holdingId === holdingId &&
        v.income !== null && v.income !== undefined &&
        v.balance !== null && v.balance !== undefined && v.balance > 0;
    });
    if (!rows.length) return null;

    var totalIncome = 0, totalBalance = 0;
    rows.forEach(function (v) {
      totalIncome += v.income;
      totalBalance += v.balance;
    });
    var avgBalance = totalBalance / rows.length;
    if (avgBalance === 0) return null;

    return {
      pct: (totalIncome / rows.length) * 12 / avgBalance * 100,
      months: rows.length,
      totalIncome: Math.round(totalIncome * 100) / 100,
      averageBalance: Math.round(avgBalance * 100) / 100
    };
  }

  // Realised yield less the holding's stated annual fees — what actually reaches you.
  function netOfFees(state, holding) {
    var y = realisedYield(state, holding.id);
    if (!y) return null;
    var fee = Number(holding.feePct) || 0;
    return {
      realisedPct: y.pct,
      feePct: fee,
      netPct: y.pct - fee,
      months: y.months,
      totalIncome: y.totalIncome,
      // The gap against what was advertised. Positive means it beat the headline rate.
      advertisedPct: Number(holding.rate) || 0,
      versusAdvertised: y.pct - (Number(holding.rate) || 0)
    };
  }

  // Total fees paid in ringgit across the portfolio (FR-4.7), from each holding's fee
  // rate applied to the balance it was charged on.
  function feeDrag(state, period) {
    var total = 0;
    var lines = [];
    nw.contributingHoldings(state).forEach(function (h) {
      var fee = Number(h.feePct) || 0;
      if (!fee) return;
      var pos = nw.positionFor(state, h.id, period);
      if (!pos) return;
      var annual = pos.balance * fee / 100;
      total += annual;
      lines.push({ id: h.id, name: h.name, feePct: fee, balance: pos.balance, annualFee: annual });
    });
    return { totalAnnualFee: Math.round(total * 100) / 100, lines: lines };
  }

  var DIMENSIONS = {
    class: { label: "Asset class", of: function (ctx) { return ctx.account ? ctx.account.class : "other"; } },
    institution: { label: "Institution", of: function (ctx) { return ctx.institution ? ctx.institution.name : "Unknown"; } },
    currency: { label: "Currency", of: function (ctx) { return ctx.account ? ctx.account.currency : "MYR"; } },
    shariah: { label: "Shariah", of: function (ctx) { return ctx.account && ctx.account.shariah ? "Shariah-compliant" : "Conventional"; } },
    pidm: { label: "PIDM cover", of: function (ctx) { return ctx.account && ctx.account.pidmProtected ? "PIDM protected" : "Not protected"; } },
    liquidity: { label: "Liquidity", of: function (ctx) { return ctx.liquid ? "Liquid" : "Illiquid"; } }
  };

  // Allocation of assets at a period, grouped on one dimension (FR-4.3).
  // Assets only — mixing liabilities into a share-of-portfolio chart makes the slices
  // meaningless. Physical assets are included, since they are part of what is owned.
  function allocation(state, period, dimension) {
    var dim = DIMENSIONS[dimension] || DIMENSIONS.class;
    var buckets = {};
    var total = 0;

    nw.contributingHoldings(state).forEach(function (h) {
      var pos = nw.positionFor(state, h.id, period);
      if (!pos || pos.balance <= 0) return;
      var account = ent.byId(state.accounts, h.accountId);
      var institution = account ? ent.byId(state.institutions, account.institutionId) : null;
      var key = dim.of({ account: account, institution: institution, liquid: account && account.liquid });
      buckets[key] = (buckets[key] || 0) + pos.balance;
      total += pos.balance;
    });

    ent.live(state.assets).forEach(function (a) {
      var pos = nw.positionFor(state, a.id, period);
      if (!pos || pos.balance <= 0) return;
      var key = dimension === "class" ? (a.class || "other")
        : dimension === "liquidity" ? (a.liquid ? "Liquid" : "Illiquid")
        : dimension === "institution" ? "Directly held"
        : dimension === "currency" ? "MYR"
        : dimension === "shariah" ? "Conventional"
        : "Not protected";
      buckets[key] = (buckets[key] || 0) + pos.balance;
      total += pos.balance;
    });

    var slices = Object.keys(buckets).map(function (k) {
      return { label: k, value: buckets[k], share: total ? buckets[k] / total * 100 : 0 };
    }).sort(function (a, b) { return b.value - a.value; });

    return { dimension: dimension, label: dim.label, total: total, slices: slices };
  }

  // Deposits above the PIDM limit at any one member institution (FR-4.4).
  // The limit applies per depositor per member bank, aggregated across their accounts.
  var PIDM_LIMIT = 250000;

  function pidmExposure(state, period) {
    var byInstitution = {};
    nw.contributingHoldings(state).forEach(function (h) {
      var account = ent.byId(state.accounts, h.accountId);
      if (!account || !account.pidmProtected) return;
      var pos = nw.positionFor(state, h.id, period);
      if (!pos) return;
      var inst = ent.byId(state.institutions, account.institutionId);
      var name = inst ? inst.name : "Unknown";
      byInstitution[name] = (byInstitution[name] || 0) + pos.balance;
    });

    return Object.keys(byInstitution).map(function (name) {
      var total = byInstitution[name];
      return {
        institution: name,
        protectedTotal: total,
        limit: PIDM_LIMIT,
        excess: Math.max(0, Math.round((total - PIDM_LIMIT) * 100) / 100),
        overLimit: total > PIDM_LIMIT
      };
    }).sort(function (a, b) { return b.protectedTotal - a.protectedTotal; });
  }

  // Emergency fund runway: how many months the liquid money covers (FR-4.5).
  //
  // Liquid holdings only. A house is not an emergency fund, and neither is EPF — the
  // point of the figure is what you can reach the week you need it.
  //
  // Returns null when monthly expenses have not been recorded, rather than a runway
  // computed against a guess.
  function emergencyRunway(state, period) {
    var expenses = Number(state.settings && state.settings.monthlyExpenses) || 0;
    var liquid = nw.positionAt(state, period).liquid;
    if (!expenses) {
      return { liquid: liquid, monthlyExpenses: null, months: null, reason: "no-expenses" };
    }
    return {
      liquid: liquid,
      monthlyExpenses: expenses,
      months: Math.round((liquid / expenses) * 10) / 10,
      reason: null
    };
  }

  // Savings rate: what share of income is actually being put away (FR-4.6).
  //
  // Counts recorded contributions across every holding over the window. Months with no
  // contribution recorded are counted as months at zero here — unlike realised yield,
  // where a blank means unknown. The difference is deliberate: a month you did not save
  // in is still a month, and excluding it would flatter the rate.
  function savingsRate(state, period, months) {
    var window = months || 12;
    var income = Number(state.settings && state.settings.monthlyIncome) || 0;

    var earliest = period;
    for (var k = 0; k < window - 1; k++) earliest = val.prevPeriod(earliest);

    var contributed = 0;
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || !v.holdingId) return;
      if (v.period < earliest || v.period > period) return;
      if (v.contribution === null || v.contribution === undefined) return;
      contributed += v.contribution;
    });
    contributed = Math.round(contributed * 100) / 100;

    if (!income) {
      return { contributed: contributed, months: window, income: null, pct: null, reason: "no-income" };
    }
    var totalIncome = income * window;
    return {
      contributed: contributed,
      months: window,
      income: income,
      totalIncome: totalIncome,
      monthlyAverage: Math.round((contributed / window) * 100) / 100,
      pct: Math.round((contributed / totalIncome) * 1000) / 10,
      reason: null
    };
  }

  return {
    realisedYield: realisedYield,
    netOfFees: netOfFees,
    feeDrag: feeDrag,
    emergencyRunway: emergencyRunway,
    savingsRate: savingsRate,
    allocation: allocation,
    pidmExposure: pidmExposure,
    DIMENSIONS: DIMENSIONS,
    PIDM_LIMIT: PIDM_LIMIT
  };
});
