# Wealth Master — Feature Plan and Roadmap

**Version** 1.0
**Date** 6 August 2026
**Companion to** Wealth Master Requirements Specification v1.0

---

## 1. Prioritisation method

Each feature is scored on three axes, then placed in a phase.

- **Value** — does it answer one of the three driving questions (net worth now / where am I heading / what is debt costing me)?
- **Effort** — S (< 0.5 day), M (0.5–2 days), L (2–5 days), XL (> 5 days)
- **Dependency** — what must exist first

The sequencing rule: **nothing that produces a number ships before the thing that stores the
number reliably.** Sync and the calculation engine come before breadth of asset types, because
a beautiful liability chart built on a lossy store is worse than useless — it is
confidently wrong.

---

## 2. Phase overview

| Phase | Theme | Ships | Exit criterion |
|---|---|---|---|
| **P0** | Foundation | Data model, sync, migration from Fund Desk v1 | Edit on laptop, see it on phone, no loss |
| **P1** | Net worth | All six domains recorded, net worth trend, allocation | One screen answers "what am I worth" |
| **P2** | Debt intelligence | Amortisation, flat-rate, payoff strategies | Matches a real bank statement to the sen |
| **P3** | Forward view | Forecasting, scenarios, goals | Answers "when can I afford X" |
| **P4** | Automation and depth | Reference pipeline, Malaysia specifics, Monte Carlo | Runs itself; month-end under 10 minutes |

Phases are sequential for P0→P2. P3 and P4 can interleave.

---

## 3. P0 — Foundation

**Goal:** a trustworthy multi-device store. No new analytics. This phase is deliberately
unglamorous and is the highest-risk work in the programme.

| # | Feature | Req | Effort | Notes |
|---|---|---|---|---|
| P0.1 | Repo scaffold, GitHub Pages deploy, CI test gate | — | S | Mirrors Warrant Desk layout |
| P0.2 | Schema v3 data model with `updatedAt` / `deviceId` / `deleted` on every record | FR-7.5, FR-7.8 | M | Supersedes Fund Desk v2 schema |
| P0.3 | localStorage store with versioned migrations | FR-7.2, FR-7.8 | S | Port from Fund Desk v1 |
| P0.4 | **Migration: Fund Desk v1 → Wealth Master** | AC-8 | S | Funds become Holdings, entries become Valuations |
| P0.5 | Google OAuth via Identity Services, `drive.file` scope | SEC-3, SEC-4 | M | Token in memory only |
| P0.6 | Sheets read/write adapter, one tab per entity | FR-7.1, FR-7.6 | L | Batched; human-readable layout |
| P0.7 | Offline mutation queue with automatic flush | FR-7.3 | M | The piece most likely to bite |
| P0.8 | Conflict resolution: LWW + conflict log | FR-7.4 | M | Losing version retained, never dropped |
| P0.9 | Sync status indicator (synced / pending / offline / error) | FR-7.9 | S | Always visible in header |
| P0.10 | JSON export/import, CSV per entity | FR-7.7 | S | Port from Fund Desk v1 |
| P0.11 | Test harness: jsdom suite, calc-engine unit tests, CI gate | NFR-10 | M | Pattern proven in Fund Desk v1 |

**Effort:** ~2 weeks part-time.
**Do not proceed to P1 until:** a full offline edit session on the phone flushes to the Sheet
and reappears on the laptop, with a deliberate conflict resolved and logged.

---

## 4. P1 — Net worth

**Goal:** every domain recorded, one screen answers "what am I worth".

| # | Feature | Req | Effort | Priority |
|---|---|---|---|---|
| P1.1 | Institutions and accounts CRUD with class, currency, flags | FR-1.1 | M | Must |
| P1.2 | Holdings within accounts | FR-1.6 | M | Must |
| P1.3 | Monthly valuation entry: balance, contribution, withdrawal, income | FR-1.2, FR-1.3 | M | Must |
| P1.4 | Bulk month entry — all accounts on one screen | FR-1.8 | M | Must — this is what makes S1 take 10 minutes not 40 |
| P1.5 | Realised yield derivation | FR-1.4 | S | Must — carried from Fund Desk v1 |
| P1.6 | Physical assets with liability linkage and derived equity | FR-2.1, FR-2.3 | M | Must |
| P1.7 | Liability records (data only, no schedule yet) | FR-3.1 | S | Must |
| P1.8 | **Net worth time series: assets − liabilities** | FR-4.1 | M | Must |
| P1.9 | Liquid vs illiquid split | FR-4.2 | S | Must |
| P1.10 | Allocation donut across five dimensions | FR-4.3 | M | Must |
| P1.11 | Net worth trend chart with asset/liability bands | FR-6.1 | M | Must |
| P1.12 | Balance-over-time multi-line, income stacked bar | FR-6.3, FR-6.4 | S | Port from Fund Desk v1 |
| P1.13 | PIDM RM250k exposure flag | FR-4.4, FR-9.5 | S | Should |
| P1.14 | Emergency fund runway | FR-4.5 | S | Should |
| P1.15 | Unit-based holdings with cost basis | FR-1.7 | M | Should |
| P1.16 | Depreciation curves for vehicles | FR-2.2 | S | Should |
| P1.17 | Fee drag in ringgit | FR-4.7 | S | Should |
| P1.18 | Archive rather than delete | FR-1.5 | S | Must |

**Effort:** ~2–3 weeks part-time.
**Milestone:** Wealth Master replaces Fund Desk v1 in daily use.

---

## 5. P2 — Debt intelligence

**Goal:** the module with the highest decision value per hour of build, because it produces
answers no bank app gives you.

| # | Feature | Req | Effort | Priority |
|---|---|---|---|---|
| P2.1 | Reducing-balance amortisation engine | FR-3.2, FR-3.4 | M | Must |
| P2.2 | **Flat-rate (hire purchase) engine — separate code path** | FR-3.3 | M | Must |
| P2.3 | Payoff date, total interest, effective rate | FR-3.5 | S | Must |
| P2.4 | Amortisation table view with principal/interest split | FR-3.4 | S | Must |
| P2.5 | Amortisation stacked area chart | FR-6.6 | M | Must |
| P2.6 | **Extra-payment modelling: months and interest saved** | FR-3.6 | M | Must — the headline feature of this phase |
| P2.7 | Payoff comparison chart, baseline vs accelerated | FR-6.7 | M | Should |
| P2.8 | Multi-debt strategy: avalanche vs snowball vs current | FR-3.8 | L | Should |
| P2.9 | Rule of 78 early settlement estimate | FR-3.7 | M | Should |
| P2.10 | Credit card revolving + minimum-payment illustration | FR-3.9 | M | Should |
| P2.11 | Actual vs scheduled payment tracking | FR-3.4 | S | Should |
| P2.12 | Refinance break-even comparison | FR-3.10 | M | Could |

**Effort:** ~2 weeks part-time.
**Validation gate:** P2.1 and P2.2 must each reconcile to a real statement to the sen before
any chart is built on them. This is non-negotiable — R4 is the highest-consequence risk in the
programme, and Malaysian flat-rate HP is not a variant of reducing balance, it is different maths.

---

## 6. P3 — Forward view

**Goal:** answer "where does this land".

| # | Feature | Req | Effort | Priority |
|---|---|---|---|---|
| P3.1 | Deterministic projection engine: growth rate + contribution schedule | FR-5.1 | M | Must |
| P3.2 | Three named scenarios with editable assumptions | FR-5.2 | M | Must |
| P3.3 | Portfolio projection net of amortising liabilities | FR-5.3 | M | Must |
| P3.4 | Forecast fan chart, actuals continuing into projection | FR-6.5 | L | Must |
| P3.5 | Assumptions panel always visible with illustrative labelling | FR-5.8 | S | Must |
| P3.6 | Goal tracking: target, required contribution, on/off track | FR-5.4 | M | Should |
| P3.7 | Inflation-adjusted toggle | FR-5.5 | S | Should |
| P3.8 | **Compare: overpay loan vs invest the same ringgit** | S3 | M | Should — directly serves scenario S3 |
| P3.9 | Savings rate tracking | FR-4.6 | S | Should |
| P3.10 | Monte Carlo with percentile bands | FR-5.6 | L | Could |
| P3.11 | FIRE / retirement corpus calculator | FR-5.7 | M | Could |

**Effort:** ~2 weeks part-time.

---

## 7. P4 — Automation and depth

**Goal:** reduce month-end effort and add Malaysian domain fidelity.

| # | Feature | Req | Effort | Priority |
|---|---|---|---|---|
| P4.1 | GitHub Actions reference pipeline → Reference tab | FR-8.1 | M | Should |
| P4.2 | Fail-visibly error rows per source | FR-8.2 | S | Must if P4.1 |
| P4.3 | FX rates for foreign holdings | FR-9.6 | S | Should |
| P4.4 | Staleness marking in UI | FR-8.4 | S | Should |
| P4.5 | EPF three-account model with dividend crediting | FR-9.1 | M | Should |
| P4.6 | ASNB fixed-price handling | FR-9.2 | S | Should |
| P4.7 | LHDN relief-eligible totals | FR-9.4 | M | Should |
| P4.8 | Warrant Desk position value pull | FR-8.5 | M | Could |
| P4.9 | Receipts Tracker expense summary pull (feeds FR-4.5) | FR-8.5 | M | Could |
| P4.10 | ASB financing paired asset/liability | FR-9.3 | M | Could |
| P4.11 | Concentration warnings | FR-4.8 | S | Could |
| P4.12 | PIN lock with encrypted cache | SEC-6 | M | Could |

**Effort:** ~2 weeks part-time.

---

## 8. Explicitly not building

Naming these prevents them reappearing as "quick additions".

| Not building | Why |
|---|---|
| Bank/broker account aggregation | No practical open banking for Malaysian individuals; scraping is fragile and a credentials risk |
| Expense categorisation | Receipts Tracker owns it (NG1) |
| Trade execution or signals | Warrant Desk owns it (NG3) |
| Multi-user / shared households | Single-owner design assumption throughout (NG4) |
| Native mobile apps | Responsive web meets S2; native doubles maintenance |
| Tax filing | Surfacing relief totals is useful; filing is regulated and out of scope (NG5) |
| Real-time price streaming | Monthly granularity is the design assumption (A1) |

---

## 9. Recommended build order — first three work sessions

Concrete starting point, not a phase abstraction:

1. **Session 1** — P0.1, P0.2, P0.3, P0.4, P0.11. Outcome: repo live on Pages, Fund Desk v1 data
   migrated in, tests green. Still single-device.
2. **Session 2** — P0.5, P0.6, P0.9. Outcome: data round-trips to a Google Sheet from two devices.
3. **Session 3** — P0.7, P0.8, P0.10. Outcome: offline queue and conflict handling proven, P0 closed.

Only then start P1. The temptation will be to build the net worth chart first because it is the
visible prize — resist it. Every hour spent on P0 is repaid when the store holds a decade of records.

---

## 10. Priority summary

| Priority | Count | Phases |
|---|---|---|
| Must | 34 | P0 (all), P1 core, P2 engines, P3 core |
| Should | 24 | P1 analytics, P2 strategies, P3 goals, P4 pipeline |
| Could | 12 | Monte Carlo, FIRE, integrations, PIN lock |

**Total estimated effort to P3 complete:** 8–9 weeks part-time.
**Minimum useful release (P0 + P1):** 4–5 weeks — at which point it fully replaces Fund Desk v1
and answers the net worth question from any device.
