"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function lib() {
  return helpers.loadLib(helpers.freshWindow()).loans;
}

// Sums a column to the sen, avoiding float drift in the assertion itself.
function sum(rows, key) {
  return Math.round(rows.reduce(function (n, r) { return n + r[key] * 100; }, 0)) / 100;
}

// ============================================================================
// REDUCING BALANCE (FR-3.2)
// ============================================================================

test("worked example: RM 100,000 at 6% over 12 months", function () {
  // By hand: i = 0.005, (1.005)^12 = 1.06167781...
  // M = 100000 × 0.005 × 1.06167781 / 0.06167781 = RM 8,606.64
  var s = lib().reducingSchedule({ principal: 100000, ratePct: 6, tenureMonths: 12 });
  assert.equal(s.basis, "reducing");
  assert.equal(s.instalment, 8606.64);
  assert.equal(s.months, 12);

  // First month: interest = 100,000 × 0.005 = RM 500.00 exactly.
  assert.equal(s.rows[0].interest, 500);
  assert.equal(s.rows[0].principal, 8106.64);
  assert.equal(s.rows[0].balance, 91893.36);
});

test("a reducing schedule clears to exactly zero", function () {
  var s = lib().reducingSchedule({ principal: 100000, ratePct: 6, tenureMonths: 12 });
  assert.equal(s.rows[s.rows.length - 1].balance, 0, "the final balance must be exactly nil");
});

test("reducing: principal repaid sums to the original principal, to the sen", function () {
  var s = lib().reducingSchedule({ principal: 350000, ratePct: 4.35, tenureMonths: 360 });
  assert.equal(sum(s.rows, "principal"), 350000, "30 years of rounding must not drift");
});

test("reducing: interest column sums to the reported total interest", function () {
  var s = lib().reducingSchedule({ principal: 350000, ratePct: 4.35, tenureMonths: 360 });
  assert.equal(sum(s.rows, "interest"), s.totalInterest);
  assert.equal(Math.round((s.principal + s.totalInterest) * 100) / 100, s.totalPaid);
});

test("reducing: the interest share falls every month as the balance does", function () {
  var s = lib().reducingSchedule({ principal: 100000, ratePct: 6, tenureMonths: 12 });
  for (var i = 1; i < s.rows.length; i++) {
    assert.ok(s.rows[i].interest < s.rows[i - 1].interest,
      "month " + (i + 1) + " interest should be below month " + i);
    assert.ok(s.rows[i].principal > s.rows[i - 1].principal);
  }
});

test("reducing: a zero-rate loan repays principal evenly with no interest", function () {
  var s = lib().reducingSchedule({ principal: 12000, ratePct: 0, tenureMonths: 12 });
  assert.equal(s.instalment, 1000);
  assert.equal(s.totalInterest, 0);
  assert.equal(sum(s.rows, "principal"), 12000);
});

test("reducing: an instalment below the monthly interest is refused, not looped", function () {
  // 100,000 at 6% accrues RM 500 a month; paying RM 400 never amortises.
  var s = lib().reducingSchedule({
    principal: 100000, ratePct: 6, tenureMonths: 120, instalment: 400
  });
  assert.match(s.error, /never reduces/);
  assert.equal(s.rows.length, 0);
});

test("reducing: a larger voluntary instalment clears the loan early", function () {
  var lo = lib().reducingSchedule({ principal: 100000, ratePct: 6, tenureMonths: 120 });
  var hi = lib().reducingSchedule({
    principal: 100000, ratePct: 6, tenureMonths: 120, instalment: lo.instalment + 200
  });
  assert.ok(hi.months < lo.months, "paying more must finish sooner");
  assert.ok(hi.totalInterest < lo.totalInterest, "and cost less interest");
  assert.equal(hi.rows[hi.rows.length - 1].balance, 0);
});

// ============================================================================
// FLAT RATE — MALAYSIAN HIRE PURCHASE (FR-3.3)
// ============================================================================

test("worked example: RM 90,000 at 3.4% flat over 84 months", function () {
  // By hand, the way a Malaysian HP agreement computes it:
  //   total interest = 90,000 × 3.4% × 7 years = RM 21,420.00
  //   total payable  = 90,000 + 21,420        = RM 111,420.00
  //   instalment     = 111,420 / 84           = RM 1,326.43
  //   interest/month = 21,420 / 84            = RM 255.00  (identical every month)
  //   principal/month= 90,000 / 84            = RM 1,071.43
  var s = lib().flatSchedule({ principal: 90000, ratePct: 3.4, tenureMonths: 84 });
  assert.equal(s.basis, "flat");
  assert.equal(s.totalInterest, 21420);
  assert.equal(s.totalPaid, 111420);
  assert.equal(s.instalment, 1326.43);
  assert.equal(s.rows[0].interest, 255);
  assert.equal(s.rows[0].principal, 1071.43);
});

test("flat: the interest portion is identical every month — this is the whole difference", function () {
  var s = lib().flatSchedule({ principal: 90000, ratePct: 3.4, tenureMonths: 84 });
  // The defining property of flat rate. If this ever varies, the flat engine has been
  // quietly replaced by reducing-balance behaviour (risk R4).
  var first = s.rows[0].interest;
  s.rows.slice(0, -1).forEach(function (r, i) {
    assert.equal(r.interest, first, "month " + (i + 1) + " must charge the same interest");
  });
});

test("flat and reducing produce genuinely different schedules for identical terms", function () {
  var terms = { principal: 90000, ratePct: 3.4, tenureMonths: 84 };
  var flat = lib().flatSchedule(terms);
  var red = lib().reducingSchedule(terms);
  assert.notEqual(flat.totalInterest, red.totalInterest);
  assert.ok(flat.totalInterest > red.totalInterest,
    "flat charges interest on the original sum throughout, so it must cost more");
  assert.ok(flat.instalment > red.instalment);
});

test("flat: columns reconcile exactly to principal and total interest", function () {
  var s = lib().flatSchedule({ principal: 90000, ratePct: 3.4, tenureMonths: 84 });
  assert.equal(sum(s.rows, "principal"), 90000);
  assert.equal(sum(s.rows, "interest"), 21420);
  assert.equal(sum(s.rows, "payment"), 111420, "every sen paid must be accounted for");
});

test("flat: the balance falls in equal steps and lands on zero", function () {
  var s = lib().flatSchedule({ principal: 60000, ratePct: 3, tenureMonths: 60 });
  assert.equal(s.rows[s.rows.length - 1].balance, 0);
  var step1 = s.rows[0].principal;
  assert.equal(s.rows[1].principal, step1, "principal repayment is level under flat rate");
});

test("flat: an awkward division still reconciles, with the last instalment absorbing it", function () {
  // 77,777 over 37 months at 4.13% divides badly on purpose.
  var s = lib().flatSchedule({ principal: 77777, ratePct: 4.13, tenureMonths: 37 });
  assert.equal(sum(s.rows, "principal"), 77777);
  assert.equal(sum(s.rows, "interest"), s.totalInterest);
  assert.equal(s.rows[s.rows.length - 1].balance, 0);
});

// ============================================================================
// EFFECTIVE RATE (FR-3.5)
// ============================================================================

test("the true cost of a flat-rate loan is roughly double its quoted rate", function () {
  var s = lib().flatSchedule({ principal: 90000, ratePct: 3.4, tenureMonths: 84 });
  // A flat 3.4% over 7 years costs about 6.2-6.4% on a reducing basis. This is the
  // number a dealer never volunteers.
  assert.ok(s.effectiveRatePct > 6.0 && s.effectiveRatePct < 6.6,
    "expected roughly 6.3%, got " + s.effectiveRatePct);
  assert.ok(s.effectiveRatePct / 3.4 > 1.75, "flat rates understate cost by nearly half");
});

test("for a reducing loan the effective rate matches the quoted rate", function () {
  var s = lib().reducingSchedule({ principal: 100000, ratePct: 6, tenureMonths: 120 });
  assert.ok(Math.abs(s.effectiveRatePct - 6) < 0.05,
    "expected about 6%, got " + s.effectiveRatePct);
});

// ============================================================================
// SCHEDULE DATES AND POSITION (FR-3.5)
// ============================================================================

test("periods run from the start month and give the payoff date", function () {
  var s = lib().flatSchedule({
    principal: 90000, ratePct: 3.4, tenureMonths: 84, startPeriod: "2024-03"
  });
  assert.equal(s.rows[0].period, "2024-03");
  assert.equal(s.rows[11].period, "2025-02", "must roll across the year boundary");
  assert.equal(s.payoffPeriod, "2031-02", "84 months from Mar 2024");
});

test("position in the schedule reports what is paid and what remains", function () {
  var l = lib();
  var s = l.flatSchedule({
    principal: 90000, ratePct: 3.4, tenureMonths: 84, startPeriod: "2024-03"
  });
  var pos = l.positionInSchedule(s, "2025-02"); // twelve instalments in
  assert.equal(pos.instalmentsPaid, 12);
  assert.equal(pos.instalmentsRemaining, 72);
  assert.equal(pos.interestToDate, 3060, "12 × RM 255");
  assert.equal(pos.scheduledBalance, Math.round((90000 - 12 * 1071.43) * 100) / 100);
});

test("scheduleFor dispatches on the liability's own basis", function () {
  var l = lib();
  var flat = l.scheduleFor({
    name: "Car", principal: 90000, ratePct: 3.4, tenureMonths: 84, rateBasis: "flat"
  });
  var red = l.scheduleFor({
    name: "Home", principal: 90000, ratePct: 3.4, tenureMonths: 84, rateBasis: "reducing"
  });
  assert.equal(flat.basis, "flat");
  assert.equal(red.basis, "reducing");
  assert.notEqual(flat.totalInterest, red.totalInterest);
});

// ============================================================================
// DEGENERATE INPUT
// ============================================================================

test("incomplete terms yield an empty schedule rather than nonsense", function () {
  var l = lib();
  [
    { principal: 0, ratePct: 3, tenureMonths: 12 },
    { principal: 1000, ratePct: 3, tenureMonths: 0 },
    { principal: null, ratePct: 3, tenureMonths: 12 }
  ].forEach(function (terms) {
    assert.equal(l.flatSchedule(terms).rows.length, 0);
    assert.equal(l.reducingSchedule(terms).rows.length, 0);
    assert.equal(l.flatSchedule(terms).totalInterest, null);
  });
});

test("addMonths rolls years correctly in both directions", function () {
  var l = lib();
  assert.equal(l.addMonths("2026-01", 1), "2026-02");
  assert.equal(l.addMonths("2026-12", 1), "2027-01");
  assert.equal(l.addMonths("2026-01", -1), "2025-12");
  assert.equal(l.addMonths("2024-03", 83), "2031-02");
});
