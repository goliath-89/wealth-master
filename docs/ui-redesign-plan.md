# Wealth Master — UI/UX Redesign Plan (P5)

**Version** 1.0
**Date** 17 September 2026
**Reference** Kubera (kubera.com) — layout and interaction patterns only, not its branding
**Design canvas** private artifact; mockups use sample figures and are not committed here
**Companion to** `requirements.md`, `feature-plan.md`, `parallel-work.md`

---

## 1. Goal

Make the first screen answer "what am I worth, and is it going up?" at a glance, the way
Kubera does, without changing a single calculation. P5 changes the **presentation layer
only**: markup, CSS and render functions. Engines, data model and the settled decisions in
`handoff-20260906.md` stay exactly as they are.

---

## 2. Evaluation — Kubera vs Wealth Master

### What makes Kubera work

1. **One number first.** The total is the largest thing on screen, with change over two horizons beside it.
2. **Totals in the navigation.** The sidebar shows Net Worth, Assets and Debts with values.
3. **Categories as a strip.** Category totals sit in one line under the headline and act as tabs.
4. **A spreadsheet, not a form.** Holdings are rows in sections with value, change arrow, notes and a row menu.
5. **Colour means change.** Neutral surfaces; colour is reserved for deltas and one chart hue.
6. **Time as navigation.** Recap looks back, Fast Forward looks ahead.

### Wealth Master today

| Keep | Holds it back |
|---|---|
| Blank ≠ zero; carried-forward figures marked three ways | Content capped at an 820px column |
| Two loan engines, Rule of 78, payoff strategy, statement check | Seven equal tabs, no running totals |
| Forecasts as scenario ranges with assumptions on screen | Net worth is one of four same-sized cards |
| PIDM, EPF, ASNB fixed price, LHDN relief | Month-on-month change only, no 1-year view |
| 44px targets, keyboard, colour never the sole signal | Accounts is a nested tree, every edit a modal |
| Offline, strict CSP, no third party holds data | Generic blue accent; warning boxes dominate screens |

### Feature and UI comparison

| Area | Kubera | Wealth Master today | Gap | Verdict |
|---|---|---|---|---|
| Navigation | Left sidebar with live totals | Seven horizontal tabs | Large | **Adopt** |
| Headline | Large net worth, 1-day and 1-year change | Four equal KPI cards, 1-month change | Large | **Adapt** — 1-month and 1-year (valuations are monthly, A1) |
| Category strip | Category totals under headline | Allocation donut only | Large | **Adopt** — Free Cash · Investments · Retirement · Use assets · Liabilities |
| Holdings list | Sheet sections, inline add, row menu | Institution tree, modals | Medium | **Adapt** — rows open existing modals first; inline edit later |
| Dashboard cards | Net worth + investable, benchmarks, assets/debts, cash, unfunded | Net worth, assets, liabilities, liquid, runway, savings rate | Medium | **Adapt** — runway replaces unfunded; benchmarks are owner-entered rates |
| Trend chart | Full-width area chart | Line with points | Small | **Adopt** — area with asset/liability bands (FR-6.1); stale points stay hollow |
| Allocation | Two donuts | One donut, six dimensions | Small | **Adapt** — by class plus one chosen dimension |
| Layout & look | Full width, light, monochrome | 820px, dark | Medium | **Adapt** — fluid to 1440px; dark first, light option (§4) |
| History | Recap | Series exists, no compare view | Medium | **Adopt** (P6) |
| Search | Global search | None | Small | **Adopt** |
| Future | Fast Forward | Three-scenario range, goals, overpay vs invest | None | **Keep WM** (R3) |
| Debts | Rows with values | Full amortisation and strategy engines | None | **Keep WM** |
| Malaysia | Generic | PIDM, EPF, ASNB, LHDN, flat-rate HP | None | **Keep WM** |
| Beneficiary | Dead-man switch | None | Medium | **Adapt** — offline legacy pack (P6) |
| Share & currency | Share view, currency switch | MYR only | Small | **Adapt** — read-only snapshot (NG4); currency after P4.3 |
| Live data | Aggregation, live prices, AI | Manual monthly, no network | — | **Skip** — NG2, G6, CSP |

---

## 3. How much changes

| Layer | Files | Treatment |
|---|---|---|
| Markup and CSS | `index.html` (CSS moves to `css/app.css` in P5.0) | Rewritten freely |
| Render functions | `app.js` — `renderWorth`, `drawWorthChart`, `renderAllocation`, `renderResilience`, `renderTree`, `renderAssets`, `renderLiabilities` | New HTML, **same target IDs** |
| Calculation engines | `schema`, `store`, `entities`, `valuations`, `networth`, `loans`, `strategy`, `decisions`, `forecast`, `goals`, `analytics`, `units`, `relief`, `csv`, `filestore`, `import-guard`, `migrate-funddesk` | **Untouched** |
| New pure functions | New file (e.g. `js/categories.js`): `deltaOver(points, months)`, `categoryTotals(state, period)` | Added with worked-example tests; no existing engine edited |

---

## 4. Agreed decisions (17 Sep 2026)

| # | Decision | Detail |
|---|---|---|
| D1 | **Free Cash** | Liquid cash-class accounts only. FDs marked illiquid fall under Investments. |
| D2 | **Use assets** | Full value in the strip, so the strip reconciles with Liabilities to net worth. Equity (value − linked loan) shown in the row drawer. |
| D3 | **Theme** | Dark first; light available as a toggle. |
| D4 | **Month screen** | Kept as "Month-end" through P5 (S1 depends on it). Revisit after inline sheet editing. |
| D5 | **Palette** | Green, grey and white. **No violet.** |

### Palette tokens (dark, default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F1211` | Page ground |
| `--sidebar` | `#131715` | Sidebar |
| `--surface` | `#181C1A` | Cards |
| `--surface2` | `#202522` | Hover, add-row bars |
| `--line` / `--line2` | `#262B28` / `#333A36` | Dividers, borders |
| `--tx` / `--tx2` / `--tx3` | `#F2F4F3` / `#B4BBB7` / `#8C938F` | Primary, secondary, caption text |
| `--accent` | `#34C77B` | Selected tab, primary button (text `#0B0F0D`) |
| `--accent-tint` | `#173A28` | Chart area fill, selected pill |
| `--good` | `#5CD394` | Gains (always with ▲ and +) |
| `--bad` | `#F2716B` | Losses (always with ▼ and −) |
| `--warn` / `--warn-bg` | `#E8B45A` / `#2E2515` | Carried-forward markers |
| Chart scale | `#1F8A55` `#34C77B` `#7FDDAA` `#BFEFD4` `#5F6763` | Donut slices, darkest to lightest, grey for Other |

Light theme values are derived in P5.5 with the same roles; contrast is checked to 4.5:1 for
text in both themes (NFR-9).

Typography: charts and figures use tabular numerals. Any new typeface is **self-hosted**
(`font-src 'self'` forbids Google Fonts), with the system stack as fallback.

---

## 5. Guarantees — the redesign must not break the app

1. **Engines are frozen.** No P5 change edits a calculation module. New figures are new pure functions with worked-example tests.
2. **The DOM contract is written down first.** `tests/dom-contract.test.js` asserts every ID and data attribute the UI tests use still exists. IDs may gain aliases; none are removed.
3. **Navigation keeps its wiring.** Sidebar items remain `button.tab[data-v]`; screens remain `.view#v-*`. The tab switcher in `app.js` is unchanged.
4. **Settled rules carry into the new look.** Blank ≠ zero. Carried-forward figures keep asterisk, hollow point and sentence — including headline, strip and sidebar totals. Forecasts stay ranges. Rendering never mutates state. Everything user-typed is escaped (SEC-7).
5. **CSP and offline are untouched.** No chart library, no CDN, charts stay hand-drawn SVG.
6. **Every phase ships separately.** Built on a `ui/p5.x` branch, merged only after `npm test` passes and a real-browser check at 390 / 768 / 1440px. Rollback is `git revert`.

### DOM contract — hooks that must survive

| Screen | Hooks |
|---|---|
| Net worth | `worthKpis` `staleWrap` `staleNote` `worthChart` `resilience` (`.up` `.dn`) `pidmWrap` `pidmNote` `allocDim` `allocChart` `allocLegend` `worthLines` |
| Month | `periodPick` `monthRows` `monthErr` `monthSummary` `monthActions` `saveMonthBtn` |
| Accounts → Assets / Debts | `tree` `showArchived` `addInstBtn` `addAssetBtn` `assetList` `addLiabBtn` `liabList`; all modal fields `i_*` `a_*` `h_*` `s_*` `l_*` `c_*`; `c_result` |
| Loans | `v-loans` `strategyWrap` `strat_extra` `strategyResult` `loanList` `[data-sched]` `[data-simpay]` `[data-simsettle]` |
| Forecast | `horizon` `forecastKpis` `forecastChart` `assumptions` `realTerms` `addGoalBtn` `goalList` `g_*` `goalSave` `goalErr` `dec_*` `decisionResult` `scenarioSave` |
| Tax | `taxYear` `reliefList` `reliefLimits` `lim_*` `saveLimitsBtn` |
| Data | `kpis` (`.v`) `set_income` `set_expenses` `saveSettingsBtn` `fileRow` `importModal` `csvRow` `wipeBtn` |

The P5.0 test derives the authoritative list from `tests/*.js`; this table is the summary.

---

## 6. Phases, in priority order

| Order | Phase | What changes | Files | Risk | Done when |
|---|---|---|---|---|---|
| 1 | **P5.0 Guardrails** | DOM contract test; baseline screenshots of all tabs at three widths; CSS extracted to `css/app.css` as tokens, no visual change | `tests/dom-contract.test.js`, `css/app.css`, `index.html` | Low | All tests pass; screenshots unchanged |
| 2 | **P5.1 App shell** | Sidebar ≥1024px with live Net worth / Assets / Debts totals; bottom tab bar on phones; top bar (month, search, hide figures, theme); fluid to 1440px; dark palette applied | `index.html`, `css/app.css`, `js/ui-shell.js` | Low | Tab switching unchanged; sidebar totals match `WM.series` and show stale marks |
| 3 | **P5.2 Headline + strip** | Large net worth with 1-month and 1-year change; category strip | `js/categories.js`, `app.js` (`renderWorth`) | Medium | Strip − liabilities = net worth to the sen (AC-1); under 13 months says "not enough history", never RM 0 |
| 4 | **P5.3 Dashboard** | Card grid (net worth + investable, assets, debts, cash on hand, runway); area chart with bands; two donuts | `app.js` render functions, `css/app.css` | Low | `#worthKpis`, `#resilience`, `#allocDim` tests pass unchanged; stale points hollow |
| 5 | **P5.5 Polish** | Light theme option; self-hosted typeface; empty states; reduced motion; print; warning boxes condensed | `css/app.css`, `/fonts` | Low | Zero console errors (AC-9); NFR-6 / NFR-9 pass |
| 6 | **P5.4 Asset & debt sheets** | Accounts splits into Assets and Debts sheets; sections, rows with value + 1-month change + row menu; "+ Add" opens existing modals; row detail drawer | `app.js` (`renderTree`, `renderAssets`, `renderLiabilities`), `index.html` | Medium | CRUD / units / assets UI tests and SEC-7 tests pass; `#tree` `#assetList` `#liabList` remain render targets |

P5.4 is last deliberately: it overlaps the Accounts screen that functional work P4.5 (EPF
three-account model) and P4.3 (FX) will change. It starts only after both are merged —
see `parallel-work.md`.

### Risks

| Risk | Closed by |
|---|---|
| Renamed ID silently breaks tests | Contract test runs first and names the missing hook |
| Big headline makes a stale total look fresh | Headline, strip and sidebar read `partial` from `WM.series` |
| 1-year change with under a year of data | "Not enough history", never a fabricated zero |
| Half-built UI deploys (Pages has no staging) | One branch per phase; whole phases merge |
| jsdom misses layout bugs | Real-browser check at three widths before merge |
| Sheet rows tempt inline editing too early | P5.4 reuses existing modals; inline editing is separate |

---

## 7. Enhancements (P6) — inspired by Kubera

Ranked by value to scenarios S1–S6. All offline, all in the owner's own file.

| Enhancement | Value | Effort | Notes |
|---|---|---|---|
| Recap — compare two months | High | M | Change split into contributions, growth, debt paid down (S4) |
| Row change and freshness markers | High | S | ▲▼ 1-month change and "not updated" chip per row; drives FR-1.9 reminders |
| Row detail drawer | High | M | Realised vs advertised yield, units, sparkline, notes, statement link (FR-10.7) |
| Owner-entered benchmarks | High | S | Realised yield vs EPF dividend, FD, ASB rates the owner types in |
| Debt-free date card | High | S | From the existing strategy engine |
| Privacy mode | Medium | S | Hide figures with one tap (S2) |
| Quick search (Ctrl K) | Medium | S | Jump to holdings, loans, goals, actions |
| Legacy pack | Medium | M | Printable "where everything is" + encrypted export; no server, so no dead-man switch |
| Life events on forecast | Medium | M | One-off events bend the fan chart; still a range (R3) |
| Read-only snapshot | Medium | S | Static export for a spouse or adviser (NG4) |
| Linked asset and loan rows | Medium | S | Value, loan, equity inline (FR-2.3) |
| Display currency switch | Lower | S | After P4.3 FX |

**Deliberately not copied:** bank/broker aggregation (NG2), live prices (CSP, A1), AI
assistant on financial data (G6, SEC-2), 1-day change (monthly data), unfunded commitments.
