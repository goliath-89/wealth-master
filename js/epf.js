"use strict";
// Wealth Master — EPF three-account model and annual dividend crediting (FR-9.1, P4.5)
//
// EPF is not one balance. Since the 2024 restructure a member holds three accounts —
// Akaun Persaraan, Akaun Sejahtera and Akaun Fleksibel — with different withdrawal rules,
// and a statement shows all three. Modelling it as a single figure would hide the only
// thing that actually distinguishes them: what you can reach and when.
//
// Each account is an ordinary holding tagged with `epfAccount`, so it flows through
// valuations, net worth, allocation and relief tagging unchanged. This module adds the
// three things that are specific to EPF: how a contribution divides, what the annual
// dividend works out at, and how the derived figures compare with the statement.
//
// THE SPLIT PERCENTAGES ARE POLICY, NOT ARITHMETIC. 75/15/10 is what EPF applies to new
// contributions today; before May 2024 it was a two-account 70/30, and the restructure
// itself is proof the numbers move. They are therefore editable defaults labelled as
// needing confirmation, exactly as tax relief limits and scenario growth rates are — the
// app must never present a policy setting as a fact it has verified.
//
// THE DIVIDEND RATE HAS NO DEFAULT AT ALL. EPF declares it once a year; inventing a
// plausible number would be fabricating the owner's returns. Unset stays null, and every
// figure derived from it is withheld rather than computed at zero — blank is not zero.
//
// THE ESTIMATE IS MEASURED AGAINST THE STATEMENT, NEVER TUNED TO IT. `yearSummary`
// reports the computed dividend beside the income actually credited and states the
// difference. It does not adjust the method to close the gap, for the same reason
// `reconcile()` does not touch a loan schedule: a formula bent to fit one year is
// silently wrong for every other one.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"), require("./networth.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val, nw) {

  // Order matters: it is the order shown, and the order the sen-rounding remainder is
  // handed out in. Persaraan first means a stray sen lands in the account you cannot
  // touch until 55, which is the conservative place for it.
  var ACCOUNTS = [
    {
      key: "persaraan",
      label: "Akaun Persaraan",
      defaultSharePct: 75,
      note: "Locked until 55. The share moved here in the 2024 restructure — confirm against KWSP."
    },
    {
      key: "sejahtera",
      label: "Akaun Sejahtera",
      defaultSharePct: 15,
      note: "Housing, health, education withdrawals. Confirm the current share against KWSP."
    },
    {
      key: "fleksibel",
      label: "Akaun Fleksibel",
      defaultSharePct: 10,
      note: "Withdrawable any time. Introduced in the 2024 restructure; the share may change."
    }
  ];

  var KEYS = ACCOUNTS.map(function (a) { return a.key; });

  function round(n) { return Math.round(n * 100) / 100; }

  function accountFor(key) {
    for (var i = 0; i < ACCOUNTS.length; i++) {
      if (ACCOUNTS[i].key === key) return ACCOUNTS[i];
    }
    return null;
  }

  function isAccountKey(key) {
    return KEYS.indexOf(key) !== -1;
  }

  // The percentages in force: whatever the owner has saved, else the defaults. A saved
  // value of 0 is honoured — a member may genuinely direct nothing to an account — so
  // the check is for null/undefined, not falsiness.
  function splitFor(state) {
    var custom = state && state.settings && state.settings.epfSplit;
    return ACCOUNTS.map(function (a) {
      var saved = custom && custom[a.key] !== undefined && custom[a.key] !== null
        ? Number(custom[a.key]) : null;
      var usable = saved !== null && !isNaN(saved);
      return {
        key: a.key,
        label: a.label,
        note: a.note,
        sharePct: usable ? saved : a.defaultSharePct,
        defaultSharePct: a.defaultSharePct,
        // Drives the "needs confirmation" labelling: a default is a starting point the
        // owner has not yet checked, an edited value is one they have.
        isDefault: !usable
      };
    });
  }

  function splitTotal(state) {
    return round(splitFor(state).reduce(function (n, s) { return n + s.sharePct; }, 0));
  }

  // Divides a contribution across the three accounts in sen, so the parts add back to
  // exactly what went in. Percentages are applied against their own total rather than
  // against 100, because a split that does not sum to 100 must still not lose or invent
  // ringgit; `sumsTo100` is returned so the UI can say the settings look wrong instead of
  // the arithmetic silently absorbing it.
  //
  // Whole sen, largest remainder first: floating point over three shares of an odd amount
  // drifts a sen, and a split that does not reconcile is the same class of defect as a
  // schedule that does not.
  function splitContribution(amount, state) {
    if (amount === null || amount === undefined || amount === "") return null;
    var value = Number(amount);
    if (isNaN(value)) return null;

    var shares = splitFor(state);
    var total = shares.reduce(function (n, s) { return n + s.sharePct; }, 0);
    var sumsTo100 = Math.abs(total - 100) < 0.0001;

    var sen = Math.round(value * 100);
    var parts;

    if (total <= 0) {
      // Nothing to apportion against. Report it rather than dividing by zero or
      // quietly falling back to the defaults the owner has overridden.
      parts = shares.map(function (s) {
        return { key: s.key, label: s.label, sharePct: s.sharePct, amount: 0 };
      });
      return {
        total: round(value), parts: parts, sumsTo100: false, sharePctTotal: round(total),
        allocatable: false
      };
    }

    var floors = shares.map(function (s) {
      var exact = sen * s.sharePct / total;
      return { key: s.key, label: s.label, sharePct: s.sharePct, sen: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    var allocated = floors.reduce(function (n, f) { return n + f.sen; }, 0);
    var leftover = sen - allocated;

    // Rank by remainder, ties broken by the declared account order (Persaraan first).
    var order = floors.map(function (f, i) { return { i: i, rem: f.rem }; })
      .sort(function (a, b) { return b.rem - a.rem || a.i - b.i; });
    for (var k = 0; k < leftover; k++) {
      floors[order[k % order.length].i].sen += 1;
    }

    parts = floors.map(function (f) {
      return { key: f.key, label: f.label, sharePct: f.sharePct, amount: f.sen / 100 };
    });

    return {
      total: round(value),
      parts: parts,
      sumsTo100: sumsTo100,
      sharePctTotal: round(total),
      allocatable: true
    };
  }

  // The holding tagged for each EPF account, or null. Archived accounts are excluded the
  // same way net worth excludes them — the history stays, the current position does not.
  function holdingsByAccount(state) {
    var out = {};
    KEYS.forEach(function (k) { out[k] = null; });
    ent.live(state.holdings).forEach(function (h) {
      if (!isAccountKey(h.epfAccount)) return;
      var acct = ent.byId(state.accounts, h.accountId);
      if (!acct || acct.deleted || acct.archived) return;
      // First tagged holding wins; a duplicate tag is reported by `issues` rather than
      // silently summed, because two holdings claiming one EPF account is a data error
      // the owner should see, not a total to add up.
      if (!out[h.epfAccount]) out[h.epfAccount] = h;
    });
    return out;
  }

  function taggedCount(state, key) {
    return ent.live(state.holdings).filter(function (h) {
      if (h.epfAccount !== key) return false;
      var acct = ent.byId(state.accounts, h.accountId);
      return acct && !acct.deleted && !acct.archived;
    }).length;
  }

  // Position across the three accounts at a period. Each line carries its own staleness,
  // taken from the same carry-forward rule net worth uses, so a balance last recorded in
  // March is never presented as September's.
  function balances(state, period) {
    var byAccount = holdingsByAccount(state);
    var lines = ACCOUNTS.map(function (a) {
      var h = byAccount[a.key];
      var pos = h ? nw.positionFor(state, h.id, period) : null;
      return {
        key: a.key,
        label: a.label,
        note: a.note,
        holdingId: h ? h.id : null,
        holdingName: h ? h.name : null,
        balance: pos ? pos.balance : null,
        stale: pos ? pos.stale : false,
        sourcePeriod: pos ? pos.sourcePeriod : null,
        monthsStale: pos ? pos.monthsStale : null,
        duplicateTags: taggedCount(state, a.key)
      };
    });

    // Only recorded accounts count towards the total. An untagged or never-valued account
    // contributes null, not zero — its balance is unknown, and folding it in as nothing
    // would understate the total and every share derived from it.
    var recorded = lines.filter(function (l) { return l.balance !== null && l.balance !== undefined; });
    var total = recorded.length
      ? round(recorded.reduce(function (n, l) { return n + l.balance; }, 0))
      : null;

    lines.forEach(function (l) {
      l.sharePct = (total && total > 0 && l.balance !== null && l.balance !== undefined)
        ? round(l.balance / total * 100) : null;
    });

    return {
      period: period,
      lines: lines,
      total: total,
      recordedCount: recorded.length,
      // True only when all three are recorded — the shares below mean something different
      // otherwise, and the UI says so rather than showing a percentage of a partial total.
      complete: recorded.length === ACCOUNTS.length,
      missing: lines.filter(function (l) { return l.balance === null || l.balance === undefined; })
        .map(function (l) { return l.key; })
    };
  }

  // The declared dividend rate for a year, or null. No default: EPF declares this, and a
  // guessed rate would put invented returns in front of the owner.
  function dividendRateFor(state, year) {
    var rates = state && state.settings && state.settings.epfDividendRates;
    if (!rates) return null;
    var raw = rates[String(year)];
    if (raw === undefined || raw === null || raw === "") return null;
    var n = Number(raw);
    return isNaN(n) ? null : n;
  }

  // Contribution and withdrawal movements for one holding in one calendar year, by month.
  function movementsIn(state, holdingId, year) {
    var rows = [];
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || v.holdingId !== holdingId) return;
      if (typeof v.period !== "string" || v.period.slice(0, 4) !== String(year)) return;
      rows.push({
        period: v.period,
        month: parseInt(v.period.slice(5, 7), 10),
        contribution: v.contribution || 0,
        withdrawal: v.withdrawal || 0,
        income: v.income || 0
      });
    });
    return rows.sort(function (a, b) { return a.month - b.month; });
  }

  // EPF's monthly-balance convention: the opening balance earns a full year of dividend,
  // and money moving during month m earns for the months remaining after it, i.e.
  // (12 − m)/12. A January contribution therefore earns eleven twelfths, a December one
  // nothing.
  //
  // This is an approximation of EPF's own crediting and is labelled as one everywhere it
  // surfaces. EPF has changed its basis before and the declared credit is authoritative;
  // the point of computing it here is to have something to check the statement against,
  // not to predict it to the sen.
  function weightFor(month) {
    return (12 - month) / 12;
  }

  // Estimated dividend for one account for one calendar year. Returns null when the rate
  // is unset or the opening position is unknown — an estimate built on a blank is a
  // guess wearing a number's clothes.
  function dividendEstimate(state, holdingId, year, ratePct) {
    if (ratePct === null || ratePct === undefined || isNaN(Number(ratePct))) return null;
    var opening = nw.positionFor(state, holdingId, String(year - 1) + "-12");
    if (!opening) return null;

    var moves = movementsIn(state, holdingId, year);
    var weighted = 0, contributed = 0, withdrawn = 0;
    moves.forEach(function (m) {
      var w = weightFor(m.month);
      contributed += m.contribution;
      withdrawn += m.withdrawal;
      weighted += (m.contribution - m.withdrawal) * w;
    });

    var base = opening.balance + weighted;
    var dividend = base * Number(ratePct) / 100;

    return {
      year: String(year),
      ratePct: Number(ratePct),
      openingBalance: round(opening.balance),
      openingStale: opening.stale,
      openingPeriod: opening.sourcePeriod,
      contributed: round(contributed),
      withdrawn: round(withdrawn),
      weightedMovement: round(weighted),
      dividendBase: round(base),
      dividend: round(dividend),
      method: "monthly-balance",
      // Never presented as the credited figure. It is what the convention above produces
      // from the balances on file, for comparison with what EPF actually paid.
      illustrative: true
    };
  }

  // Estimate beside what was actually credited, per account and in total. The difference
  // is reported and nothing is adjusted: a method bent to match one year's statement
  // would be quietly wrong for every other year, which is the failure the loan engines
  // are already guarded against.
  function yearSummary(state, year, ratePct) {
    var rate = ratePct === undefined ? dividendRateFor(state, year) : ratePct;
    var byAccount = holdingsByAccount(state);

    var lines = ACCOUNTS.map(function (a) {
      var h = byAccount[a.key];
      if (!h) {
        return {
          key: a.key, label: a.label, holdingId: null, holdingName: null,
          estimate: null, recorded: null, difference: null, contributed: 0, withdrawn: 0
        };
      }
      var moves = movementsIn(state, h.id, year);
      var recordedIncome = moves.reduce(function (n, m) { return n + m.income; }, 0);
      var est = dividendEstimate(state, h.id, year, rate);
      return {
        key: a.key,
        label: a.label,
        holdingId: h.id,
        holdingName: h.name,
        estimate: est,
        // Zero recorded income is a real answer once there are entries for the year;
        // with no entries at all nothing is known, so it stays null.
        recorded: moves.length ? round(recordedIncome) : null,
        difference: (est && moves.length) ? round(recordedIncome - est.dividend) : null,
        contributed: round(moves.reduce(function (n, m) { return n + m.contribution; }, 0)),
        withdrawn: round(moves.reduce(function (n, m) { return n + m.withdrawal; }, 0))
      };
    });

    function sum(pick) {
      var any = false, total = 0;
      lines.forEach(function (l) {
        var v = pick(l);
        if (v === null || v === undefined) return;
        any = true;
        total += v;
      });
      return any ? round(total) : null;
    }

    var estimated = sum(function (l) { return l.estimate ? l.estimate.dividend : null; });
    var recorded = sum(function (l) { return l.recorded; });

    return {
      year: String(year),
      ratePct: rate === null || rate === undefined ? null : Number(rate),
      // No rate means no estimate anywhere — the UI asks for one rather than showing zeros.
      hasRate: rate !== null && rate !== undefined && !isNaN(Number(rate)),
      lines: lines,
      totalEstimated: estimated,
      totalRecorded: recorded,
      totalDifference: (estimated !== null && recorded !== null) ? round(recorded - estimated) : null,
      method: "monthly-balance",
      illustrative: true
    };
  }

  // Years that have any EPF entry, newest first, so the UI offers real years rather than
  // an arbitrary range.
  function yearsWithEntries(state) {
    var byAccount = holdingsByAccount(state);
    var ids = {};
    KEYS.forEach(function (k) { if (byAccount[k]) ids[byAccount[k].id] = true; });
    var years = {};
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || !ids[v.holdingId]) return;
      if (typeof v.period === "string" && v.period.length >= 4) years[v.period.slice(0, 4)] = true;
    });
    return Object.keys(years).sort().reverse();
  }

  // Everything wrong with the current EPF setup, in the owner's words. Returned as data
  // so the UI cannot forget to mention one.
  function issues(state) {
    var out = [];
    var t = splitTotal(state);
    if (Math.abs(t - 100) >= 0.0001) {
      out.push("The account shares total " + t + "%, not 100%. Contributions are divided in " +
        "proportion, so nothing is lost, but check the percentages.");
    }
    ACCOUNTS.forEach(function (a) {
      var n = taggedCount(state, a.key);
      if (n > 1) out.push(n + " holdings are tagged " + a.label + ". Only the first is used.");
    });
    return out;
  }

  return {
    ACCOUNTS: ACCOUNTS,
    accountFor: accountFor,
    isAccountKey: isAccountKey,
    splitFor: splitFor,
    splitTotal: splitTotal,
    splitContribution: splitContribution,
    holdingsByAccount: holdingsByAccount,
    balances: balances,
    dividendRateFor: dividendRateFor,
    movementsIn: movementsIn,
    dividendEstimate: dividendEstimate,
    yearSummary: yearSummary,
    yearsWithEntries: yearsWithEntries,
    epfIssues: issues
  };
});
