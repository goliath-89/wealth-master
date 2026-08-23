# Loan engine validation

**Status: NOT RECONCILED.** The engines pass worked examples. They have not yet been
checked against a real Malaysian statement, so acceptance criteria **AC-2** and **AC-3**
remain open and the Loans tab carries a warning saying so.

Risk **R4** — flat rate implemented as reducing balance — is the highest-consequence risk
in this programme, because it is quietly wrong rather than visibly broken. Charts on top of
these numbers wait until this page says RECONCILED.

---

## Why the engines are separate

They are different arithmetic, not one calculation with a switch.

**Reducing balance** (mortgage, personal loan): interest is charged each month on the
balance that still remains. As the balance falls, the interest portion falls and the
principal portion grows. The split changes every month.

**Flat rate** (Malaysian hire purchase, governed by the Hire Purchase Act 1967): interest
is calculated once, on the **original** principal, for the **whole** tenure, then divided
equally across every instalment. It does not fall as you repay. The split is identical in
month 1 and month 84.

The consequence, from the worked example below: a car loan quoted at **3.4% flat** actually
costs about **6.3% a year**. Anyone applying reducing-balance maths to a flat-rate quote
understates the true cost by nearly half.

---

## Worked examples the engines already satisfy

These are verifiable by hand and are asserted in `tests/loans.test.js`.

### Reducing balance — RM 100,000 at 6.00% p.a. over 12 months

```
i = 6 / 100 / 12                     = 0.005
(1.005)^12                           = 1.06167781...
instalment = 100000 × 0.005 × 1.06167781 / 0.06167781
                                     = RM 8,606.64
month 1 interest = 100,000 × 0.005   = RM 500.00
month 1 principal = 8,606.64 − 500   = RM 8,106.64
closing balance                      = RM 91,893.36
```

### Flat rate — RM 90,000 at 3.40% flat over 84 months

```
total interest = 90,000 × 3.40% × 7 years   = RM 21,420.00
total payable  = 90,000 + 21,420            = RM 111,420.00
instalment     = 111,420 / 84               = RM 1,326.43
interest each month = 21,420 / 84           = RM 255.00   ← identical every month
principal each month = 90,000 / 84          = RM 1,071.43
effective rate                              ≈ 6.3% p.a.
```

Both schedules reconcile to the sen: the principal column sums to the original principal,
the interest column sums to the reported total, and the closing balance is exactly nil.
Money is handled internally in sen as integers, because rounding a float 360 times drifts
enough to be visible.

---

## What is still needed — the gate

Two real statements, checked **in the app**, not here.

Open a liability on the Accounts tab and fill in **Check against a statement**: the
statement month, the interest charged that month, the closing balance, and the instalment
paid. The app compares its own schedule against those figures and reports the difference
to the sen. The Loans tab then labels the loan *Matches statement*, *Close to statement*
or *Disagrees with statement*.

Only the month plus one figure is needed to get a verdict; interest is the most telling,
because it is what proves the engine is applying the right arithmetic rather than
coincidentally landing on a similar instalment.

**Nothing goes in this repository** (SEC-1). The figures are the owner's own data, stored
in their data file alongside everything else, and can be edited or cleared at any time.

**The engine is measured, never tuned.** Entering a statement changes no calculation. If a
real loan disagrees, the maths is wrong and gets fixed for every loan — adjusting figures
to satisfy one statement would be hardcoding by another name, and would break every other
loan silently.

### How a verdict is read

| Verdict | Meaning |
|---|---|
| **exact** | 0 sen apart. What flat-rate hire purchase must achieve — the Hire Purchase Act fixes the arithmetic, so any difference is a real defect. |
| **close** | Within RM 5. Legitimate on a Malaysian mortgage, where daily rest makes interest depend on the exact day each payment lands. Not acceptable for flat rate. |
| **off** | More than RM 5 apart. Wrong basis, wrong rate, wrong start month, or a fee the schedule does not model. |

### The known open question on mortgages

The reducing engine currently computes **monthly rest**: interest is `balance × annual /
12`, charged once a month. Most Malaysian housing loans are now **daily rest**, where
interest accrues per day and therefore depends on the exact date each payment is credited.

A monthly-rest schedule sits close to a daily-rest one but will not match to the sen. The
statement is what settles it: if the interest figure is out by a small amount that moves
with the length of the month, the loan is on daily rest and the engine needs a daily
accrual path. That is a known follow-up, not a surprise.

Flat-rate hire purchase has no such ambiguity — the Act fixes the arithmetic.

---

## Recording a reconciliation

When a statement has been checked, add a row here, change the status at the top, and
remove the warning from the Loans tab. Never paste the statement itself.

| Date | Facility type | Basis | Matched to the sen? | Notes |
|---|---|---|---|---|
| — | — | — | not yet run | |
