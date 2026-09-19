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
      // Ringgit, not the account's own currency: a 1.5% fee on USD 10,000 is RM 630 at
      // 4.20, not RM 150. A holding with no rate for the month is left out rather than
      // charged as though its balance were ringgit.
      var pos = nw.basePositionFor(state, h.id, period);
      if (!pos || !pos.convertible) return;
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
    var buckets = {}, counts = {}, carried = {};
    var total = 0;
    function tally(key, amount, stale) {
      buckets[key] = (buckets[key] || 0) + amount;
      counts[key] = (counts[key] || 0) + 1;
      if (stale) carried[key] = true;
      total += amount;
    }

    nw.contributingHoldings(state).forEach(function (h) {
      // Converted, so a slice is comparable with the others and with net worth. Counting
      // a foreign balance at face value made the donut disagree with the total above it.
      var pos = nw.basePositionFor(state, h.id, period);
      if (!pos || !pos.convertible || pos.balance <= 0) return;
      var account = ent.byId(state.accounts, h.accountId);
      var institution = account ? ent.byId(state.institutions, account.institutionId) : null;
      var key = dim.of({ account: account, institution: institution, liquid: account && account.liquid });
      tally(key, pos.balance, pos.stale);
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
      tally(key, pos.balance, pos.stale);
    });

    var slices = Object.keys(buckets).map(function (k) {
      return {
        label: k, value: buckets[k], share: total ? buckets[k] / total * 100 : 0,
        count: counts[k], partial: !!carried[k]
      };
    }).sort(function (a, b) { return b.value - a.value; });

    return { dimension: dimension, label: dim.label, total: total, slices: slices };
  }

  // Concentration: any single holding above a share of the portfolio (FR-4.8).
  //
  // The denominator is total assets, the same figure the net worth tile and the allocation
  // donut report — so a share here can be read straight off the donut rather than being a
  // third number that means something slightly different.
  //
  // The threshold is the owner's. Unset is not zero: a zero threshold would flag every
  // holding, so a blank setting falls back to the default below and the UI says which one
  // is in force. A holding no rate converts is not in the total and so is not in any
  // share either — the count travels with the result rather than being silently absorbed.
  var DEFAULT_CONCENTRATION_PCT = 20;

  function concentrationThreshold(state) {
    var raw = state.settings ? state.settings.concentrationPct : null;
    var n = Number(raw);
    if (raw === null || raw === undefined || raw === "" || isNaN(n) || n <= 0 || n > 100) {
      return { pct: DEFAULT_CONCENTRATION_PCT, isDefault: true };
    }
    return { pct: n, isDefault: false };
  }

  function concentration(state, period) {
    var t = concentrationThreshold(state);
    var pos = nw.positionAt(state, period);
    var total = pos.assets;

    var lines = pos.lines.filter(function (l) {
      return l.kind === "holding" && l.convertible !== false && l.balance > 0;
    }).map(function (l) {
      var share = total > 0 ? l.balance / total * 100 : 0;
      return {
        id: l.id,
        name: l.name,
        accountName: l.accountName,
        balance: l.balance,
        sharePct: Math.round(share * 10) / 10,
        over: share > t.pct
      };
    }).sort(function (a, b) { return b.sharePct - a.sharePct; });

    return {
      thresholdPct: t.pct,
      isDefault: t.isDefault,
      total: total,
      lines: lines,
      over: lines.filter(function (l) { return l.over; }),
      // Shares are of what could be counted. Anything left out makes every share above
      // larger than it would be if the missing figure were in the denominator.
      excludedCount: (pos.unconverted || []).length
    };
  }

  // Deposits above the PIDM limit at any one member institution (FR-4.4).
  // The limit applies per depositor per member bank, aggregated across their accounts.
  var PIDM_LIMIT = 250000;

  function pidmExposure(state, period) {
    var byInstitution = {};
    nw.contributingHoldings(state).forEach(function (h) {
      var account = ent.byId(state.accounts, h.accountId);
      if (!account || !account.pidmProtected) return;
      // The PIDM limit is RM 250,000, so the balance compared against it must be in
      // ringgit. A foreign deposit with no rate is left out — reporting it as protected
      // or over the limit would both be guesses.
      var pos = nw.basePositionFor(state, h.id, period);
      if (!pos || !pos.convertible) return;
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
    concentration: concentration,
    concentrationThreshold: concentrationThreshold,
    DEFAULT_CONCENTRATION_PCT: DEFAULT_CONCENTRATION_PCT,
    DIMENSIONS: DIMENSIONS,
    PIDM_LIMIT: PIDM_LIMIT
  };
});
