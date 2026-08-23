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

    var rows = [];
    var balanceSen = principalSen;
    var totalInterestSen = 0;
    var period = val.isPeriod(opts.startPeriod) ? opts.startPeriod : null;

    for (var n = 1; n <= months && balanceSen > 0; n++) {
      var interestSen = Math.round(balanceSen * i);
      var paymentSen = instalmentSen;
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

      rows.push({
        n: n,
        period: period,
        payment: toRM(paymentSen),
        interest: toRM(interestSen),
        principal: toRM(principalPaidSen),
        balance: toRM(balanceSen)
      });
      if (period) period = addMonths(period, 1);
    }

    return finish("reducing", principalSen, instalmentSen, rows, totalInterestSen);
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

  return {
    toSen: toSen,
    addMonths: addMonths,
    reducingInstalmentSen: reducingInstalmentSen,
    reducingSchedule: reducingSchedule,
    flatSchedule: flatSchedule,
    effectiveRatePct: effectiveRatePct,
    scheduleFor: scheduleFor,
    positionInSchedule: positionInSchedule
  };
});
