# Wealth Master — Requirements Specification

**Version** 1.0 (draft for review)
**Date** 6 August 2026
**Owner** Pradheep
**Programme** Rich Life Project
**Supersedes** Fund Desk v1 (single-file fund tracker, Aug 2026)

---

## 1. Context and problem statement

Financial visibility is currently fragmented across at least six surfaces: a fund tracker
(Fund Desk v1, browser-local only), the Warrant Desk sheet, the Receipts Tracker sheet,
individual bank and broker apps, ASNB/EPF portals, and loan statements arriving by post or
email. No single view answers the three questions that actually drive decisions:

1. **What am I worth right now, and is it going up?**
2. **If I keep doing what I'm doing, where do I land in 5 / 10 / 20 years?**
3. **What is my debt actually costing me, and what happens if I pay it down faster?**

Answering any of these today requires manually reconciling numbers across apps into a
spreadsheet — which happens rarely, and is stale by the time it's done.

Fund Desk v1 proved the interaction model (log a monthly balance, derive realised yield
rather than trusting advertised rates) but has three disqualifying limits: it only covers
funds, it only holds data on one device, and it cannot forecast.

### Problem quantified

| Pain | Current cost |
|---|---|
| Manual net-worth reconciliation | ~90 min, done quarterly at best |
| No forecast capability | Retirement/goal decisions made on intuition |
| No loan payoff modelling | Cannot evaluate extra-payment or refinance decisions |
| Device-locked data | Cannot check or update anything from phone |
| Advertised vs realised return gap | Unknown; fees invisible until reconciled by hand |

---

## 2. Goals and non-goals

### Goals

- **G1** — Single authoritative view of net worth: assets minus liabilities, tracked monthly.
- **G2** — Cross-device access (laptop, phone, tablet) with the same data everywhere.
- **G3** — Forecast investment and savings growth under stated assumptions and scenarios.
- **G4** — Model every liability accurately, including Malaysian flat-rate hire purchase, and
  quantify the effect of extra payments.
- **G5** — Preserve the Fund Desk principle: report **realised** performance net of fees,
  not marketing rates.
- **G6** — Zero recurring cost, no backend server, no third party holding financial data.

### Non-goals

- **NG1** — Not a budgeting or expense-categorisation app. Day-to-day spending stays with the
  Receipts Tracker; Wealth Master consumes summary totals from it, not individual receipts.
- **NG2** — No bank account aggregation / screen scraping / open banking. Entry is manual or
  file-import. (Malaysian open banking is not practically available to individuals.)
- **NG3** — Not a trade execution tool. Warrant Desk owns trading decisions; Wealth Master
  only records the resulting position value.
- **NG4** — Not multi-user. Single owner, optional read-only share.
- **NG5** — Not tax filing software. It surfaces relief-eligible totals; it does not file.

---

## 3. Users and usage scenarios

**Primary and only user:** the owner. Financially literate, comfortable with spreadsheets and
JSON, values validated output over polish-for-its-own-sake, will not tolerate silent data loss.

| # | Scenario | Frequency | Device | Success condition |
|---|---|---|---|---|
| S1 | Month-end update: enter closing balances across all accounts | Monthly | Laptop | Under 10 minutes for ~15 accounts |
| S2 | Quick check: "what's my net worth / cash position" | Weekly | Phone | Under 5 seconds to answer |
| S3 | Decision support: "should I overpay the car loan or add to ASB?" | Ad hoc | Laptop | Side-by-side numeric comparison |
| S4 | Annual review: full-year performance, fee drag, allocation drift | Yearly | Laptop | Exportable summary |
| S5 | Goal planning: "when can I afford X / retire" | Quarterly | Laptop | Forecast with scenario range |
| S6 | Tax prep: total relief-eligible contributions (PRS, EPF, SSPN, insurance) | Yearly | Laptop | Figures reconcile to LHDN categories |

---

## 4. Scope

### In scope

Six domains, each with holdings tracked over time:

1. **Cash** — savings, current, FD, e-wallets, digital banks
2. **Investments** — unit trusts, ETFs, direct equities, warrants, bonds/sukuk, crypto
3. **Retirement** — EPF (Akaun Persaraan / Sejahtera / Fleksibel), PRS, private pension
4. **Physical assets** — property, vehicles, valuables
5. **Liabilities** — mortgage, hire purchase, personal loan, credit cards, PTPTN, ASB financing
6. **Derived analytics** — net worth, allocation, forecast, amortisation, payoff strategy

### Out of scope for v1

Business/company accounts, dependants' portfolios, insurance policy cash values, estate
planning, and any form of automated broker connection.

---

## 5. Functional requirements

### FR-1 Accounts and holdings

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Create, edit, archive accounts with type, institution, currency, and Shariah/PIDM flags | Must |
| FR-1.2 | Record a dated valuation (closing balance) per account per period | Must |
| FR-1.3 | Record contributions and withdrawals separately from income/growth | Must |
| FR-1.4 | Derive realised yield per holding from income ÷ average balance, annualised | Must |
| FR-1.5 | Archive rather than delete; archived accounts retain history and drop out of current totals | Must |
| FR-1.6 | Support multiple holdings within one account (e.g. broker holding three funds) | Should |
| FR-1.7 | Unit-based holdings: units × price, with cost basis and unrealised gain | Should |
| FR-1.8 | Bulk entry: paste or import a month's balances in one action | Should |
| FR-1.9 | Reminder when an account has no valuation for the current period | Could |

### FR-2 Assets

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Record physical assets with purchase date, cost, and current estimated value | Must |
| FR-2.2 | Apply a depreciation or appreciation curve (straight-line, declining balance, or manual) | Should |
| FR-2.3 | Link an asset to the liability financing it, so equity is derived (property value − mortgage) | Must |
| FR-2.4 | Flag illiquid assets so they can be excluded from liquid net worth | Must |

### FR-3 Liabilities and loans

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Record loans with principal, rate, tenure, start date, and payment amount | Must |
| FR-3.2 | Support **reducing balance** interest (mortgage, personal loan) | Must |
| FR-3.3 | Support **flat rate** interest (Malaysian hire purchase / car loan) — distinct maths, not an approximation of reducing balance | Must |
| FR-3.4 | Generate a full amortisation schedule: per-period principal, interest, closing balance | Must |
| FR-3.5 | Compute payoff date, total interest payable, and effective interest rate | Must |
| FR-3.6 | Model extra payments (one-off and recurring) and report months saved plus interest saved | Must |
| FR-3.7 | Rule of 78 early-settlement estimate for flat-rate facilities | Should |
| FR-3.8 | Multi-debt payoff strategy comparison: avalanche (highest rate first) vs snowball (smallest balance first) vs current | Should |
| FR-3.9 | Credit card handling: revolving balance, minimum payment trap illustration | Should |
| FR-3.10 | Refinance comparison: current vs proposed terms, break-even month | Could |

### FR-4 Net worth and analytics

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Net worth = total assets − total liabilities, as a monthly time series | Must |
| FR-4.2 | Split net worth into liquid vs illiquid | Must |
| FR-4.3 | Allocation breakdown by asset class, institution, currency, Shariah status, and PIDM coverage | Must |
| FR-4.4 | Flag deposits exceeding RM250,000 at any single PIDM member bank | Should |
| FR-4.5 | Emergency fund runway: liquid cash ÷ monthly expenses, in months | Should |
| FR-4.6 | Savings rate: contributions ÷ income over a period | Should |
| FR-4.7 | Fee drag: total annual fees paid in ringgit across the portfolio | Should |
| FR-4.8 | Concentration warning when any single holding exceeds a configurable share of the portfolio | Could |

### FR-5 Forecasting

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Project each holding forward using a stated growth rate and contribution schedule | Must |
| FR-5.2 | Three named scenarios (conservative / base / optimistic) with editable assumptions | Must |
| FR-5.3 | Portfolio-level projection combining all holdings, net of liabilities amortising down | Must |
| FR-5.4 | Goal tracking: target amount and date, showing required monthly contribution and on/off-track status | Should |
| FR-5.5 | Inflation-adjusted (real) values toggle | Should |
| FR-5.6 | Monte Carlo simulation with volatility assumptions, showing outcome percentile bands | Could |
| FR-5.7 | FIRE / retirement number: target corpus from expenses and withdrawal rate | Could |
| FR-5.8 | Every projection displays its assumptions on screen and marks output as illustrative | Must |

### FR-6 Visualisation

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | Net worth trend line, with assets and liabilities as separate bands | Must |
| FR-6.2 | Allocation donut, switchable across the FR-4.3 dimensions | Must |
| FR-6.3 | Balance-over-time multi-line per holding, with series toggling | Must |
| FR-6.4 | Monthly income stacked bar by source | Must |
| FR-6.5 | Forecast fan chart: historical actuals continuing into projected scenario range | Must |
| FR-6.6 | Amortisation stacked area: principal vs interest over loan life | Must |
| FR-6.7 | Payoff comparison chart: baseline vs accelerated schedules | Should |
| FR-6.8 | Rolling realised yield line per holding (carried from Fund Desk v1) | Should |
| FR-6.9 | All charts render from local state with no network dependency | Must |

### FR-7 Sync, storage and portability

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | Google Sheets acts as the system of record; the app reads and writes it | Must |
| FR-7.2 | localStorage acts as an offline cache; the app is fully usable with no connection | Must |
| FR-7.3 | Mutations made offline queue locally and flush automatically on reconnect | Must |
| FR-7.4 | Conflict resolution: last-write-wins per record using `updatedAt`, with the losing version retained in a conflict log rather than discarded | Must |
| FR-7.5 | Deletes are tombstones, never hard row removal | Must |
| FR-7.6 | The Sheet remains human-readable and hand-editable; the app reconciles manual edits on next sync | Must |
| FR-7.7 | Full JSON export and import, plus CSV export per entity | Must |
| FR-7.8 | Versioned schema with explicit forward migrations; never silently drop fields | Must |
| FR-7.9 | Sync status is always visible: synced / pending / offline / error, with last-sync timestamp | Must |

### FR-8 Reference data pipeline

| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | Scheduled job refreshes fund rates, FX, and benchmark rates into a Reference tab | Should |
| FR-8.2 | Each source fails visibly — an error row is written to the tab, the run does not abort | Must (if FR-8.1 built) |
| FR-8.3 | Reference data is advisory only; it never overwrites a user-entered valuation | Must |
| FR-8.4 | Data older than a configured staleness threshold is marked stale in the UI | Should |
| FR-8.5 | Optional pull of position values from the Warrant Desk and Receipts Tracker sheets | Could |

### FR-9 Malaysia-specific

| ID | Requirement | Priority |
|---|---|---|
| FR-9.1 | EPF modelled with its three accounts and annual dividend crediting | Should |
| FR-9.2 | ASNB fixed-price fund handling: unit price pinned at RM1, annual dividend, unit scarcity note | Should |
| FR-9.3 | ASB financing modelled as a paired asset and liability | Could |
| FR-9.4 | LHDN relief-eligible contribution totals (PRS, SSPN, life insurance, EPF voluntary) surfaced annually | Should |
| FR-9.5 | PIDM coverage status per deposit account | Must |
| FR-9.6 | MYR as base currency, with foreign holdings converted at a recorded rate | Should |

---

## 6. Data model (logical)

```
Institution   id, name, type, pidmMember
Account       id, institutionId, name, class, currency, shariah, liquid, archived,
              pidmProtected
Holding       id, accountId, name, instrumentType, rate, feePct, salesPct, unitBased
Valuation     id, holdingId, period, balance, units, unitPrice, contribution,
              withdrawal, income, note, updatedAt, deviceId, deleted
Asset         id, name, class, acquiredOn, cost, currentValue, depreciationModel,
              linkedLiabilityId, liquid
Liability     id, name, type, principal, ratePct, rateBasis(reducing|flat),
              tenureMonths, startDate, instalment, linkedAssetId
LoanPayment   id, liabilityId, period, scheduled, actual, extra, updatedAt
Scenario      id, name, growthAssumptions{}, inflationPct, contributionSchedule[]
Goal          id, name, targetAmount, targetDate, linkedHoldingIds[]
Reference     source, key, value, asOf, status
```

Every mutable record carries `updatedAt`, `deviceId`, and `deleted` to support FR-7.4/7.5.

PIDM is modelled at two levels because they are distinct facts. `Institution.pidmMember`
records whether the bank is a PIDM member at all — needed by FR-4.4 to aggregate balances
across every account at one bank against the RM250,000 limit. `Account.pidmProtected`
records whether that specific account is actually covered, satisfying FR-9.5. The two
diverge routinely: a unit trust distributed by a PIDM member bank is not protected, while
a savings account at the same bank is.

---

## 7. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Cold load to interactive, cached | < 1.5 s |
| NFR-2 | Chart re-render on filter change | < 100 ms at 10 years × 30 holdings |
| NFR-3 | Offline capability | Full read and write with zero network |
| NFR-4 | Recurring cost | RM 0 |
| NFR-5 | Backend servers to operate | None |
| NFR-6 | Mobile usability | Usable one-handed; touch targets ≥ 44 px |
| NFR-7 | Data durability | No silent loss; every destructive action undoable or tombstoned |
| NFR-8 | Browser support | Current Chrome, Safari, Firefox, Edge — desktop and mobile |
| NFR-9 | Accessibility | Keyboard navigable; colour never the sole signal; `prefers-reduced-motion` respected |
| NFR-10 | Test coverage | Calculation engine ≥ 90% branch; every financial formula has a worked-example test |

---

## 8. Security and privacy

| ID | Requirement |
|---|---|
| SEC-1 | No financial data is committed to the repository, ever. Repo holds code only. |
| SEC-2 | Data resides in the owner's own Google Drive and the owner's own browsers. No third-party service holds it. |
| SEC-3 | Authentication via Google OAuth (Google Identity Services) using the owner's account. No service-account key ships to the browser. |
| SEC-4 | OAuth scope limited to `drive.file` — the app can only access the spreadsheet it created, not the whole Drive. |
| SEC-5 | Access tokens held in memory only, never persisted to localStorage. |
| SEC-6 | Optional app-level PIN with encryption-at-rest of the localStorage cache (Web Crypto, key derived from PIN). |
| SEC-7 | All user-supplied strings escaped before DOM insertion — carried forward from the Fund Desk v1 injection test. |
| SEC-8 | Publishing the app source publicly is acceptable and does not expose data; this must remain true by design. |
| SEC-9 | Content Security Policy restricting connections to Google APIs only. |

---

## 9. Constraints and assumptions

**Constraints**

- C1 — Static hosting only (GitHub Pages). No server-side code at runtime.
- C2 — GitHub Pages on a free plan serves from a public repository; the code will be public.
- C3 — Google Sheets API quota: 300 read + 300 write requests per minute per project. Sync must batch.
- C4 — OAuth access tokens expire hourly; silent re-auth required.
- C5 — iOS Safari evicts localStorage after ~7 days of no use; Sheet sync is the durability guarantee, not the cache.

**Assumptions**

- A1 — Valuations are entered monthly, not daily. Period granularity is `YYYY-MM`.
- A2 — Manual entry is acceptable; automation of institution data is a convenience, never a dependency.
- A3 — The owner already operates Google Sheets and GitHub Actions (proven by Warrant Desk).
- A4 — Historical data before the first entry is not backfilled unless imported.

---

## 10. Risks

| ID | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | Sync conflict corrupts records across devices | High | Medium | Tombstones, `updatedAt` LWW, conflict log retains losing version, Sheet revision history as final backstop |
| R2 | Safari cache eviction loses unsynced offline edits | High | Medium | Flush queue aggressively; warn prominently while pending edits exist |
| R3 | Forecast output mistaken for a promise | Medium | High | Assumptions always on screen; scenario ranges never a single number; explicit illustrative labelling (FR-5.8) |
| R4 | Flat-rate loan maths implemented as reducing balance | High | Medium | Separate code paths, worked-example tests against real Malaysian HP statements |
| R5 | Google OAuth verification friction for an unverified app | Medium | Medium | Personal-use app under own account stays within the unverified-app allowance; document the consent warning |
| R6 | Scope creep into full budgeting | Medium | High | NG1 enforced; Receipts Tracker keeps expense ownership |
| R7 | Sheets API quota exceeded on large history | Low | Low | Batch reads, delta writes, compact old periods |
| R8 | Public repo accidentally receives a data file | High | Low | `.gitignore` for data patterns plus a CI secret/data scan gate |

---

## 11. Acceptance criteria

The v1 release is accepted when all of the following hold:

1. Net worth for a given month reconciles exactly to the sum of its component records.
2. An amortisation schedule for a known reducing-balance mortgage matches a bank statement to the sen.
3. A flat-rate hire purchase schedule matches a real HP statement to the sen.
4. Extra-payment modelling reports months and interest saved, verified against manual calculation.
5. Editing on device A appears on device B after sync, with no data loss in either direction.
6. Full offline session — create, edit, delete — flushes correctly on reconnect.
7. Export → wipe → import restores state byte-identically.
8. Schema migration from Fund Desk v1 data preserves every fund and valuation.
9. Zero console errors on load and on every primary interaction.
10. No financial data present anywhere in the git history.

---

## 12. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Public repo with private data, or paid GitHub plan for a private Pages site? | Before Phase 1 |
| Q2 | Is EPF entered manually once a year, or is a statement PDF import worth building? | Phase 3 |
| Q3 | Should the Warrant Desk position value flow in automatically, or be entered as a single monthly line? | Phase 3 |
| Q4 | Property valuation source — manual estimate, or periodic market reference? | Phase 2 |
| Q5 | Is a PIN lock wanted from day one, given the phone is already device-locked? | Phase 1 |
