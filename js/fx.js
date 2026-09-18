"use strict";
// Wealth Master — foreign holdings converted at a recorded rate (FR-9.6, P4.3)
//
// MYR is the base currency. An account in another currency holds a balance in that
// currency, and until it is converted it cannot be added to anything — which is what the
// app did before this module existed: a USD 10,000 balance was summed into net worth as
// though it were RM 10,000. Wrong by a factor of four, and silent.
//
// THE RATE IS RECORDED, NEVER FETCHED. It lives on the valuation, beside the balance it
// converts, for three reasons. The app is offline-first and has no network budget to
// spend on a rate provider. A historical net worth series needs the rate that applied in
// that month, not today's — revaluing 2023 at today's rate rewrites history. And a rate
// the owner entered from their own statement is their data, checked the same way a loan
// statement is, rather than a number a third party asserted.
//
// A MISSING RATE IS NOT A RATE OF 1. A foreign holding with no rate ever recorded is
// left out of the total and named, exactly as a holding with no balance is. Converting
// at 1 would quietly add a US dollar to a ringgit; it is the same mistake as treating
// blank as zero, in a more expensive currency.
//
// A rate carries forward like a balance does, and is marked stale the same way. Rates
// move daily and valuations are monthly (assumption A1), so last month's rate is an
// approximation — one the UI marks rather than hides.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val) {

  var BASE = "MYR";

  function round(n) { return Math.round(n * 100) / 100; }

  function normCurrency(code) {
    return String(code || BASE).trim().toUpperCase() || BASE;
  }

  function isBase(code) {
    return normCurrency(code) === BASE;
  }

  // Does this account's money need converting before it can be added up?
  function needsConversion(account) {
    return !!account && !isBase(account.currency);
  }

  // Every account not in the base currency, so the UI can ask for the rates it needs.
  function foreignAccounts(state) {
    return ent.live(state.accounts).filter(needsConversion);
  }

  // Months where a rate was recorded for this subject, newest first.
  function ratesFor(state, subjectId) {
    return (state.valuations || [])
      .filter(function (v) {
        return !v.deleted && v.holdingId === subjectId &&
          v.fxRate !== null && v.fxRate !== undefined && Number(v.fxRate) > 0;
      })
      .sort(function (a, b) { return a.period < b.period ? 1 : -1; });
  }

  // The rate to use for a subject at a period: the one recorded that month, else the most
  // recent one before it, marked stale. Returns null when none has ever been recorded —
  // which the caller must treat as "cannot convert", not as 1.
  function rateAt(state, subjectId, period) {
    var rows = ratesFor(state, subjectId);
    if (!rows.length) return null;

    var exact = null, prior = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].period === period) { exact = rows[i]; break; }
      if (rows[i].period < period && !prior) prior = rows[i];
    }
    if (exact) {
      return { rate: Number(exact.fxRate), stale: false, sourcePeriod: period };
    }
    if (prior) {
      return { rate: Number(prior.fxRate), stale: true, sourcePeriod: prior.period };
    }
    // Every recorded rate is later than the period asked for. Using a future rate to value
    // a past month is the same error as using today's — it is not what the money was worth
    // then, so nothing is returned.
    return null;
  }

  function convert(amount, rate) {
    if (amount === null || amount === undefined) return null;
    if (rate === null || rate === undefined || !(Number(rate) > 0)) return null;
    return round(Number(amount) * Number(rate));
  }

  // Converts one holding's position into the base currency, or explains why it cannot.
  // `account` is the holding's account, which carries the currency.
  //
  // Returns the shape net worth needs:
  //   { amount, currency, native, rate, fxStale, fxSourcePeriod, convertible }
  // where `amount` is in MYR and is null when the rate is unknown.
  function toBase(state, holding, account, period, nativeAmount) {
    var currency = normCurrency(account && account.currency);
    if (isBase(currency) || nativeAmount === null || nativeAmount === undefined) {
      return {
        amount: nativeAmount, currency: BASE, native: nativeAmount,
        rate: 1, fxStale: false, fxSourcePeriod: null, convertible: true
      };
    }
    var found = rateAt(state, holding.id, period);
    if (!found) {
      return {
        amount: null, currency: currency, native: nativeAmount,
        rate: null, fxStale: false, fxSourcePeriod: null, convertible: false
      };
    }
    return {
      amount: convert(nativeAmount, found.rate),
      currency: currency,
      native: nativeAmount,
      rate: found.rate,
      fxStale: found.stale,
      fxSourcePeriod: found.sourcePeriod,
      convertible: true
    };
  }

  // Foreign holdings with a balance at this period but no rate to convert it with. These
  // are the ones left out of the total, and the UI names every one — a total quietly
  // missing a holding is worse than one that says what it is missing.
  function unconvertible(state, period) {
    var out = [];
    ent.live(state.holdings).forEach(function (h) {
      var acct = ent.byId(state.accounts, h.accountId);
      if (!acct || acct.deleted || acct.archived || !needsConversion(acct)) return;
      var v = val.valuationFor(state, h.id, period) || val.lastRecordedBefore(state, h.id, period);
      if (!v || v.balance === null || v.balance === undefined) return;
      if (rateAt(state, h.id, period)) return;
      out.push({
        holdingId: h.id, name: h.name, currency: normCurrency(acct.currency),
        native: v.balance, period: period
      });
    });
    return out;
  }

  // Rates in force across the portfolio at a period, one per currency, so the UI can show
  // what it is converting at. Where two accounts in the same currency carry different
  // rates the spread is reported rather than averaged — they cannot both be right, and
  // picking one silently would hide a typo.
  function ratesInForce(state, period) {
    var byCurrency = {};
    ent.live(state.holdings).forEach(function (h) {
      var acct = ent.byId(state.accounts, h.accountId);
      if (!acct || acct.deleted || acct.archived || !needsConversion(acct)) return;
      var found = rateAt(state, h.id, period);
      if (!found) return;
      var code = normCurrency(acct.currency);
      if (!byCurrency[code]) {
        byCurrency[code] = { currency: code, rates: [], stale: true, sourcePeriod: null };
      }
      byCurrency[code].rates.push(found.rate);
      // The freshest rate for a currency decides whether it reads as stale.
      if (!found.stale) {
        byCurrency[code].stale = false;
        byCurrency[code].sourcePeriod = period;
      } else if (!byCurrency[code].sourcePeriod ||
                 found.sourcePeriod > byCurrency[code].sourcePeriod) {
        byCurrency[code].sourcePeriod = found.sourcePeriod;
      }
    });

    return Object.keys(byCurrency).sort().map(function (code) {
      var entry = byCurrency[code];
      var lo = Math.min.apply(null, entry.rates);
      var hi = Math.max.apply(null, entry.rates);
      return {
        currency: code,
        rate: entry.rates[0],
        low: lo,
        high: hi,
        // More than one rate for one currency in one month is a disagreement, not an
        // average to take.
        disagrees: Math.abs(hi - lo) > 0.000001,
        stale: entry.stale,
        sourcePeriod: entry.sourcePeriod,
        holdings: entry.rates.length
      };
    });
  }

  return {
    BASE: BASE,
    normCurrency: normCurrency,
    isBaseCurrency: isBase,
    needsConversion: needsConversion,
    foreignAccounts: foreignAccounts,
    rateAt: rateAt,
    convertAmount: convert,
    toBase: toBase,
    unconvertible: unconvertible,
    ratesInForce: ratesInForce
  };
});
