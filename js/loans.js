"use strict";
// Wealth Master — loan engines (FR-3.2, FR-3.3, FR-3.4, FR-3.5)
//
// TWO SEPARATE ENGINES. Malaysian flat-rate hire purchase is not a variant of reducing
// balance — it is different arithmetic, and a single parameterised path with a flag is
// the failure mode risk R4 describes: quietly wrong for years. They share nothing but
// the shape of their output.
//
//   reducingSchedule — interest each month on the balance that remains. The principal
//                      portion grows as the balance falls. Mortgages, personal loans.
//   flatSchedule     — interest computed once on the ORIGINAL principal for the whole
//                      tenure, then divided equally across every instalment. The split
//                      never changes. Malaysian hire purchase.
//
// All money is handled in sen as integers. Rounding a float 360 times accumulates a
// visible error, and a schedule that does not reconcile to the sen fails AC-2/AC-3.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./valuations.js"));
    } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (val) {

  function toSen(rm) {
    if (rm === null || rm === undefined || isNaN(rm)) return null;
    return Math.round(Number(rm) * 100);
  }
  function toRM(sen) {
    return sen === null || sen === undefined ? null : sen / 100;
  }

  function addMonths(period, n) {
    if (!val.isPeriod(period)) return null;
    var y = parseInt(period.slice(0, 4), 10);
    var m = parseInt(period.slice(5, 7), 10) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + String(m + 1).padStart(2, "0");
  }

  // The standard annuity instalment for a reducing-balance loan, in sen.
  // A zero rate degenerates to principal spread evenly, which the annuity formula
  // cannot express (it divides by zero).
  function reducingInstalmentSen(principalSen, annualRatePct, months) {
    if (!months || months <= 0) return 0;
    var i = annualRatePct / 100 / 12;
    if (i === 0) return Math.round(principalSen / months);
    var f = Math.pow(1 + i, months);
    return Math.round(principalSen * i * f / (f - 1));
  }

  // Reducing balance (FR-3.2). Interest accrues on the outstanding balance each month.
  //
  // NOTE ON MALAYSIAN MORTGAGES: this is monthly rest. Most Malaysian housing loans are
  // daily rest, where interest depends on the exact day each payment lands, so a real
  // statement will differ by small amounts. Reconciling against an actual statement is
  // what settles which basis a given bank uses — see docs/loan-validation.md.
  function reducingSchedule(opts) {
    var principalSen = toSen(opts.principal);
    var months = parseInt(opts.tenureMonths, 10) || 0;
    var ratePct = Number(opts.ratePct) || 0;
    if (!principalSen || principalSen <= 0 || months <= 0) {
      return emptySchedule("reducing");
    }

    var i = ratePct / 100 / 12;
    var instalmentSen = opts.instalment !== undefined && opts.instalment !== null
      ? toSen(opts.instalment)
      : reducingInstalmentSen(principalSen, ratePct, months);

    // Extra payments go straight against principal, so every later month accrues
    // interest on a smaller balance. This is why overpaying a mortgage works — and
    // why the same move does nothing for flat-rate hire purchase (see flatSchedule).
    var extraMonthlySen = toSen(opts.extraMonthly) || 0;
    var oneOffs = opts.oneOffs || {};

    var rows = [];
    var balanceSen = principalSen;
    var totalInterestSen = 0;
    var totalExtraSen = 0;
    var period = val.isPeriod(opts.startPeriod) ? opts.startPeriod : null;

    // Extras can clear the loan before the contractual tenure, so the loop is bounded
    // by the balance rather than by the term.
    for (var n = 1; n <= months && balanceSen > 0; n++) {
      var interestSen = Math.round(balanceSen * i);
      var extraThisMonthSen = extraMonthlySen +
        (period && oneOffs[period] ? toSen(oneOffs[period]) : 0);
      var paymentSen = instalmentSen + extraThisMonthSen;
      var principalPaidSen = paymentSen - interestSen;

      // Guard: an instalment too small to cover interest never amortises. Report it
      // rather than looping to the tenure and pretending the loan clears.
      if (principalPaidSen <= 0 && n === 1) {
        return {
          basis: "reducing", rows: [], months: 0,
          error: "The instalment does not cover the monthly interest, so this loan never reduces.",
          instalment: toRM(instalmentSen), principal: toRM(principalSen),
          totalInterest: null, totalPaid: null, payoffPeriod: null, effectiveRatePct: null
        };
      }

      // Final instalment absorbs the rounding residue so the balance lands exactly on
      // zero — this is what makes the schedule reconcile to the sen.
      if (principalPaidSen >= balanceSen || n === months) {
        principalPaidSen = balanceSen;
        paymentSen = principalPaidSen + interestSen;
      }

      balanceSen -= principalPaidSen;
      totalInterestSen += interestSen;
      totalExtraSen += Math.min(extraThisMonthSen, Math.max(0, paymentSen - interestSen));

      rows.push({
        n: n,
        period: period,
        payment: toRM(paymentSen),
        interest: toRM(interestSen),
        principal: toRM(principalPaidSen),
        extra: toRM(extraThisMonthSen),
        balance: toRM(balanceSen)
      });
      if (period) period = addMonths(period, 1);
    }

    var out = finish("reducing", principalSen, instalmentSen, rows, totalInterestSen);
    out.totalExtra = toRM(totalExtraSen);
    return out;
  }

  // Flat rate (FR-3.3). Interest is calculated ONCE on the original principal for the
  // whole tenure and split evenly — it does not fall as the balance falls. This is why
  // a flat 3.4% costs roughly what a reducing 6.3% costs.
  function flatSchedule(opts) {
    var principalSen = toSen(opts.principal);
    var months = parseInt(opts.tenureMonths, 10) || 0;
    var ratePct = Number(opts.ratePct) || 0;
    if (!principalSen || principalSen <= 0 || months <= 0) {
      return emptySchedule("flat");
    }

    var years = months / 12;
    var totalInterestSen = Math.round(principalSen * (ratePct / 100) * years);
    var totalPayableSen = principalSen + totalInterestSen;
    var instalmentSen = Math.round(totalPayableSen / months);

    var perInterestSen = Math.round(totalInterestSen / months);
    var perPrincipalSen = Math.round(principalSen / months);

    var rows = [];
    var balanceSen = principalSen;
    var interestRunningSen = 0;
    var period = val.isPeriod(opts.startPeriod) ? opts.startPeriod : null;

    for (var n = 1; n <= months; n++) {
      var interestSen = perInterestSen;
      var principalPaidSen = perPrincipalSen;

      // The last instalment absorbs every rounding residue on both columns, so the
      // totals reconcile exactly to principal and to total interest.
      if (n === months) {
        principalPaidSen = balanceSen;
        interestSen = totalInterestSen - interestRunningSen;
      }

      balanceSen -= principalPaidSen;
      interestRunningSen += interestSen;

      rows.push({
        n: n,
        period: period,
        payment: toRM(principalPaidSen + interestSen),
        interest: toRM(interestSen),
        principal: toRM(principalPaidSen),
        balance: toRM(balanceSen)
      });
      if (period) period = addMonths(period, 1);
    }

    return finish("flat", principalSen, instalmentSen, rows, totalInterestSen);
  }

  function emptySchedule(basis) {
    return {
      basis: basis, rows: [], months: 0, error: null,
      principal: null, instalment: null, totalInterest: null, totalPaid: null,
      payoffPeriod: null, effectiveRatePct: null
    };
  }

  function finish(basis, principalSen, instalmentSen, rows, totalInterestSen) {
    var totalPaidSen = principalSen + totalInterestSen;
    var last = rows[rows.length - 1];
    return {
      basis: basis,
      error: null,
      rows: rows,
      months: rows.length,
      principal: toRM(principalSen),
      instalment: toRM(instalmentSen),
      totalInterest: toRM(totalInterestSen),
      totalPaid: toRM(totalPaidSen),
      payoffPeriod: last ? last.period : null,
      // What the borrowing actually costs per year, whatever the quoted rate calls
      // itself. For a flat-rate facility this lands near double the quoted figure,
      // which is the single most useful number on the screen (FR-3.5).
      effectiveRatePct: effectiveRatePct(toRM(principalSen), toRM(instalmentSen), rows.length)
    };
  }

  // Solves the annuity equation for the monthly rate that equates the instalment stream
  // to the principal, then annualises. Bisection rather than Newton: slower, but it
  // cannot diverge, and this runs once per loan.
  function effectiveRatePct(principal, instalment, months) {
    if (!principal || !instalment || !months) return null;
    if (instalment * months <= principal) return 0;

    function pv(rate) {
      if (rate === 0) return instalment * months;
      return instalment * (1 - Math.pow(1 + rate, -months)) / rate;
    }

    var lo = 0, hi = 1; // 100% per month is far beyond any real facility
    for (var k = 0; k < 200; k++) {
      var mid = (lo + hi) / 2;
      if (pv(mid) > principal) lo = mid; else hi = mid;
    }
    return ((lo + hi) / 2) * 12 * 100;
  }

  // Dispatches on the liability's own basis. The two engines are never merged; this
  // only chooses between them.
  function scheduleFor(liability) {
    var opts = {
      principal: liability.principal,
      ratePct: liability.ratePct,
      tenureMonths: liability.tenureMonths,
      startPeriod: liability.startDate ? String(liability.startDate).slice(0, 7) : null,
      instalment: liability.rateBasis === "flat" ? undefined : liability.instalment || undefined
    };
    return liability.rateBasis === "flat" ? flatSchedule(opts) : reducingSchedule(opts);
  }

  // Where the loan stands at a given month: instalments paid, balance remaining, and
  // interest incurred so far.
  function positionInSchedule(schedule, period) {
    if (!schedule.rows.length || !val.isPeriod(period)) return null;
    var paid = 0, interestSoFar = 0, balance = schedule.principal;
    for (var i = 0; i < schedule.rows.length; i++) {
      var r = schedule.rows[i];
      if (!r.period || r.period > period) break;
      paid++;
      interestSoFar += r.interest;
      balance = r.balance;
    }
    return {
      instalmentsPaid: paid,
      instalmentsRemaining: schedule.rows.length - paid,
      scheduledBalance: balance,
      interestToDate: Math.round(interestSoFar * 100) / 100
    };
  }

  // Rule of 78 early settlement for a flat-rate facility (FR-3.7).
  //
  // THIS IS WHY FLAT RATE IS DIFFERENT. On a mortgage, paying extra reduces the balance
  // that interest is charged on, so it saves money immediately. On Malaysian hire
  // purchase the term charges were fixed on day one — paying more each month does not
  // reduce them. The only way to save interest is to formally settle early, and the
  // rebate is then set by statute, not by removing the remaining interest.
  //
  //   rebate = total term charges × r(r+1) / n(n+1)     [Hire Purchase Act 1967]
  //
  // where n is the full number of instalments and r the number still outstanding. The
  // rebate is deliberately smaller than the interest a reducing-balance loan would save,
  // because Rule of 78 front-loads the charges. Modelling this as a mortgage overpayment
  // would overstate the saving substantially — the R4 trap in its most tempting form.
  function ruleOf78Settlement(schedule, instalmentsPaid) {
    if (!schedule || schedule.basis !== "flat" || !schedule.rows.length) return null;
    var n = schedule.rows.length;
    var paid = Math.max(0, Math.min(parseInt(instalmentsPaid, 10) || 0, n));
    var r = n - paid;
    if (r <= 0) return null;

    var totalInterestSen = toSen(schedule.totalInterest);
    var instalmentSen = toSen(schedule.instalment);

    var rebateSen = Math.round(totalInterestSen * (r * (r + 1)) / (n * (n + 1)));
    var outstandingInstalmentsSen = instalmentSen * r;
    var settlementSen = outstandingInstalmentsSen - rebateSen;

    // What continuing to term would cost from here, against settling now.
    var interestIfContinuedSen = Math.round(totalInterestSen * (r / n));

    return {
      instalmentsPaid: paid,
      instalmentsRemaining: r,
      settlementPeriod: paid > 0 && schedule.rows[paid - 1] ? schedule.rows[paid - 1].period : schedule.rows[0].period,
      outstandingInstalments: toRM(outstandingInstalmentsSen),
      rebate: toRM(rebateSen),
      settlementAmount: toRM(settlementSen),
      interestSaved: toRM(rebateSen),
      interestIfContinued: toRM(interestIfContinuedSen)
    };
  }

  // Baseline against accelerated (FR-3.6). Reducing balance only — see ruleOf78Settlement
  // for why a flat facility cannot be modelled this way.
  function compareSchedules(baseline, accelerated) {
    if (!baseline || !accelerated || !baseline.rows.length || !accelerated.rows.length) return null;
    var interestSavedSen = toSen(baseline.totalInterest) - toSen(accelerated.totalInterest);
    return {
      monthsSaved: baseline.months - accelerated.months,
      interestSaved: toRM(interestSavedSen),
      baselineInterest: baseline.totalInterest,
      acceleratedInterest: accelerated.totalInterest,
      baselineMonths: baseline.months,
      acceleratedMonths: accelerated.months,
      baselinePayoff: baseline.payoffPeriod,
      acceleratedPayoff: accelerated.payoffPeriod,
      extraPaid: accelerated.totalExtra || 0
    };
  }

  // Simulates a different monthly payment on a reducing-balance loan and reports what it
  // buys. `newInstalment` is the whole monthly figure the owner would pay, which is how
  // they think about it — not the increment.
  function simulatePayment(liability, newInstalment, oneOffs) {
    var terms = {
      principal: liability.principal,
      ratePct: liability.ratePct,
      tenureMonths: liability.tenureMonths,
      startPeriod: liability.startDate ? String(liability.startDate).slice(0, 7) : null
    };
    var baseline = reducingSchedule(terms);
    if (!baseline.rows.length) return null;

    var accelerated = reducingSchedule({
      principal: terms.principal, ratePct: terms.ratePct, tenureMonths: terms.tenureMonths,
      startPeriod: terms.startPeriod,
      instalment: newInstalment !== null && newInstalment !== undefined ? newInstalment : baseline.instalment,
      oneOffs: oneOffs || {}
    });
    if (accelerated.error) return { error: accelerated.error, baseline: baseline };

    return {
      baseline: baseline,
      accelerated: accelerated,
      comparison: compareSchedules(baseline, accelerated)
    };
  }

  // Compares the engine's schedule against what a statement actually says (AC-2, AC-3).
  //
  // This measures the engine; it never adjusts it. If a real loan disagrees, the maths is
  // wrong and gets fixed for every loan — the alternative, nudging figures to match one
  // statement, would be indistinguishable from hardcoding and would break every other
  // loan silently.
  //
  // Verdicts:
  //   exact  — 0 sen apart. What flat-rate hire purchase must achieve; the Hire Purchase
  //            Act fixes the arithmetic, so any difference means a real defect.
  //   close  — within RM 5. Expected on a Malaysian mortgage, where daily rest makes
  //            interest depend on the exact day each payment lands.
  //   off    — beyond RM 5. Something is genuinely wrong: wrong basis, wrong rate, or a
  //            fee the schedule does not model.
  function reconcile(schedule, check) {
    if (!schedule || !schedule.rows.length || !check || !val.isPeriod(check.period)) return null;

    var row = null;
    for (var i = 0; i < schedule.rows.length; i++) {
      if (schedule.rows[i].period === check.period) { row = schedule.rows[i]; break; }
    }
    if (!row) {
      return {
        period: check.period, found: false,
        message: "That month is outside this loan's schedule — check the start month and tenure."
      };
    }

    function compare(expected, actual) {
      if (actual === null || actual === undefined) return null;
      var diffSen = toSen(actual) - toSen(expected);
      var diff = diffSen / 100;
      return {
        expected: expected,
        actual: actual,
        diff: diff,
        verdict: diffSen === 0 ? "exact" : Math.abs(diffSen) <= 500 ? "close" : "off"
      };
    }

    var interest = compare(row.interest, check.statementInterest);
    var balance = compare(row.balance, check.statementBalance);
    var instalment = compare(row.payment, check.statementInstalment);

    var parts = [interest, balance, instalment].filter(Boolean);
    var worst = parts.reduce(function (acc, p) {
      if (p.verdict === "off") return "off";
      if (p.verdict === "close" && acc !== "off") return "close";
      return acc;
    }, parts.length ? "exact" : null);

    return {
      period: check.period,
      found: true,
      basis: schedule.basis,
      interest: interest,
      balance: balance,
      instalment: instalment,
      verdict: worst,
      // Flat rate has no daily-rest ambiguity to hide behind, so "close" is not good
      // enough there — it is a failure with a small number attached.
      mustBeExact: schedule.basis === "flat"
    };
  }

  return {
    toSen: toSen,
    addMonths: addMonths,
    reconcile: reconcile,
    ruleOf78Settlement: ruleOf78Settlement,
    compareSchedules: compareSchedules,
    simulatePayment: simulatePayment,
    reducingInstalmentSen: reducingInstalmentSen,
    reducingSchedule: reducingSchedule,
    flatSchedule: flatSchedule,
    effectiveRatePct: effectiveRatePct,
    scheduleFor: scheduleFor,
    positionInSchedule: positionInSchedule
  };
});
