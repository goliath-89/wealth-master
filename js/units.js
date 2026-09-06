"use strict";
// Wealth Master — unit-based holdings and cost basis (FR-1.7, FR-9.2)
//
// For a unit trust or ETF, the balance is units × price, and what you actually made is
// the balance less what you put in. Cost basis is derived from recorded contributions
// and withdrawals rather than stored separately, so it cannot drift from the entries it
// is supposed to summarise.
//
// ASNB FIXED-PRICE FUNDS are the Malaysian special case (FR-9.2). A unit is always
// RM 1.00, so units and ringgit are the same number and the price never moves. All the
// return arrives as extra units credited from the dividend, which means an unrealised
// gain on a fixed-price fund is always nil — anything earned has already been paid out
// and reinvested. Treating one like a variable-price fund would report a permanent zero
// return on something that pays perfectly well.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val) {

  function round(n) { return Math.round(n * 100) / 100; }
  function roundUnits(n) { return Math.round(n * 10000) / 10000; }

  function isFixedPrice(holding) {
    return holding && holding.fixedPrice !== null && holding.fixedPrice !== undefined &&
      Number(holding.fixedPrice) > 0;
  }

  // Every non-deleted valuation for a holding, oldest first.
  function history(state, holdingId) {
    return (state.valuations || [])
      .filter(function (v) { return !v.deleted && v.holdingId === holdingId; })
      .sort(function (a, b) { return a.period < b.period ? -1 : 1; });
  }

  // Money in less money out, up to and including a period. This is what the holding
  // cost you — the yardstick a gain is measured against.
  function costBasis(state, holdingId, period) {
    var contributed = 0, withdrawn = 0;
    history(state, holdingId).forEach(function (v) {
      if (period && v.period > period) return;
      if (v.contribution) contributed += v.contribution;
      if (v.withdrawal) withdrawn += v.withdrawal;
    });
    return {
      contributed: round(contributed),
      withdrawn: round(withdrawn),
      net: round(contributed - withdrawn)
    };
  }

  // The position at a period: units, price, value, and what it is worth against cost.
  // Returns null when the holding has never been valued.
  function position(state, holding, period) {
    var rows = history(state, holding.id).filter(function (v) {
      return !period || v.period <= period;
    });
    if (!rows.length) return null;

    var latest = null;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i].balance !== null && rows[i].balance !== undefined) { latest = rows[i]; break; }
    }
    if (!latest) return null;

    var fixed = isFixedPrice(holding);
    var price = fixed ? Number(holding.fixedPrice)
      : (latest.unitPrice !== null && latest.unitPrice !== undefined ? latest.unitPrice : null);

    var units = latest.units !== null && latest.units !== undefined ? latest.units
      : (price ? roundUnits(latest.balance / price) : null);

    var basis = costBasis(state, holding.id, period);
    var income = rows.reduce(function (n, v) { return n + (v.income || 0); }, 0);

    // On a fixed-price fund the price cannot move, so there is no unrealised gain to
    // report — the return has already been credited as units and counted as income.
    var unrealised = fixed ? 0 : round(latest.balance - basis.net);

    return {
      period: latest.period,
      balance: latest.balance,
      units: units,
      unitPrice: price,
      fixedPrice: fixed,
      costBasis: basis.net,
      contributed: basis.contributed,
      withdrawn: basis.withdrawn,
      incomeToDate: round(income),
      unrealisedGain: unrealised,
      unrealisedPct: !fixed && basis.net > 0 ? round(unrealised / basis.net * 100) : null,
      // What the holding has returned in total: income already taken plus any gain still
      // on paper. For a fixed-price fund this is simply the income.
      totalReturn: round(income + unrealised),
      averageCostPerUnit: !fixed && units ? roundUnits(basis.net / units) : (fixed ? Number(holding.fixedPrice) : null)
    };
  }

  // Units bought by a contribution at a given price — the arithmetic behind a fixed-price
  // fund's "RM 1,000 buys 1,000 units".
  function unitsFor(amount, price) {
    if (!price || price <= 0) return null;
    return roundUnits(amount / price);
  }

  // Checks a recorded valuation against itself: units × price should equal the balance.
  // Reports the discrepancy rather than silently correcting it — the owner typed both,
  // and which one is wrong is theirs to decide.
  function checkConsistency(valuation, holding) {
    if (!valuation) return null;
    var price = isFixedPrice(holding) ? Number(holding.fixedPrice) : valuation.unitPrice;
    if (!price || valuation.units === null || valuation.units === undefined) return null;
    if (valuation.balance === null || valuation.balance === undefined) return null;

    var implied = round(valuation.units * price);
    var diff = round(valuation.balance - implied);
    return {
      impliedBalance: implied,
      recordedBalance: valuation.balance,
      difference: diff,
      // A sen either way is rounding; more than that is a typo worth surfacing.
      consistent: Math.abs(diff) <= 0.01
    };
  }

  return {
    isFixedPrice: isFixedPrice,
    costBasis: costBasis,
    position: position,
    unitsFor: unitsFor,
    checkConsistency: checkConsistency
  };
});
