# DOM hooks the functional stream depends on

**Date** 18 September 2026
**Written by** the functional stream (P4)
**For** the UI stream (P5), and for `tests/dom-contract.test.js` when P5.0 creates it
**Companion to** `parallel-work.md` §5

`parallel-work.md` §5 says whichever stream adds an ID a test drives lists it for the
other. P5.0 has not landed yet, so the list lives here until `tests/dom-contract.test.js`
exists — at which point these should be folded into it and this file deleted.

Renaming or removing anything below breaks the functional suite. Aliases are fine; silent
removal is not.

---

## 1. Added since `parallel-work.md` was written

These arrived with P4.5 (EPF), FR-4.7 (fee drag), FR-6.3/6.4/6.8 (charts) and FR-10
(document import). They are the ones the UI stream has not seen yet.

### IDs

| Screen | IDs |
|---|---|
| Net worth — fee drag | `feesWrap` `feesList` |
| Net worth — income chart | `incomeWrap` `incomeChart` `incomeLegend` |
| Accounts — balance / yield chart | `seriesWrap` `seriesMetric` `seriesNote` `seriesChart` `seriesLegend` |
| Accounts — EPF | `epfSec` `epfYear` `epfBalances` `epfSplitFields` `epf_persaraan` `epf_sejahtera` `epf_fleksibel` `saveEpfSplitBtn` `resetEpfSplitBtn` `epfContrib` `epfSplitResult` `epfRate` `epfRateYear` `saveEpfRateBtn` `epfDividend` |
| Holding modal | `h_epf` |
| Data — sheet import | `sheetPickBtn` `sheetFileIn` `sheetStatus` `undoImportBtn` |
| Data — import review | `reviewSec` `reviewSummary` `reviewProblems` `reviewRows` `reviewAllBtn` `reviewNoneBtn` `reviewKeepNotes` `reviewConfirmBtn` `reviewCancelBtn` `reviewCancelBtn2` |
| Data — data file | `fileNote` (now carries the refusal message, not just the standing note) |

### Structural selectors tests assert on

```
#seriesChart path              one path per visible series
#seriesLegend .lgt             the series toggles, with aria-pressed
#incomeChart rect              one rect per stacked band
#incomeLegend .lg              one per paying holding
#feesList .wline               one per fee-charging holding
#reviewRows .irow              one per proposed line item
#reviewRows .ibadge.new        new-record badges
#epfSplitFields .tag           the "confirm" tags on unedited EPF shares
```

Also driven by attribute: `#reviewRows [data-imp="include"|"name"|"kind"|"institutionName"|"accountClass"|"liabilityType"|"assetClass"]`, each with `data-i="<row index>"`, and `#seriesLegend [data-series="<holding id>"]`.

---

## 2. New classes for P5 to theme

`parallel-work.md` §3.2 asks that new styles be flagged. These eight were added rather than
reusing an existing class, because nothing existing fitted. All are defined in `index.html`
today and should move to `css/app.css` in P5.0.

| Class | What it is | Note for theming |
|---|---|---|
| `.lgt` | A legend entry that toggles its chart series — a real `<button>` with `aria-pressed` | Needs a visible pressed/unpressed distinction that is **not** colour alone (NFR-9). Currently opacity plus a greyed swatch. Min-height 44px. |
| `.irow` | One proposed line item in the import review | `.off` modifier dims an excluded row |
| `.irow .ihead` | Its checkbox-and-name header row | The tick is 44px on purpose — it decides whether a line imports at all |
| `.irow .iname` / `.isub` | Name and its category/month sub-line | |
| `.irow .ifields` | The editable fields grid under each row | `auto-fit, minmax(150px, 1fr)` |
| `.ibadge` | new / updates / matches status chip | `.new` `.upd` `.same` modifiers. Semantic, not accent — keep separate from the brand hue |
| `.dangertext` | The data-file refusal message | Only red text on the Data tab; a box would be heavier than warranted |

---

## 3. Inline styles safe to move to CSS — and one kind that is not

The UI stream is welcome to lift these into classes. Two categories:

**Cosmetic, move freely.** `style="margin-top:12px"`, `margin-bottom:10px|12px|14px`,
`margin-top:10px`, and `style="width:auto;min-width:150px"` on the `epfYear` /
`seriesMetric` / `taxYear` selects.

**Functional, do not move.** `style="display:none"` on `feesWrap` `incomeWrap`
`seriesWrap` `reviewSec` `undoImportBtn` — and, from before this stream,
`staleWrap` `pidmWrap` `strategyWrap` and the six modal delete buttons. These are toggled
from JS by setting `style.display` directly, and tests assert on
`el.style.display === "none"`. Replacing them with a class would pass rendering but fail
the suite. If P5 wants them class-driven, change the JS and the tests in the same commit.

`epfSec` is deliberately *not* in that list: it is always rendered, and shows an empty
state rather than hiding, so it can be styled freely.

---

## 4. Where P4 and P5 actually collide

Per `parallel-work.md` §3.4: **P4.5 (EPF) is merged** — it landed on `main` in `33d8517`
and added a section to the Accounts screen between the accounts tree and Physical assets.

**P4.3 (FX) has not started, and is blocked on an owner decision**, not on code: whether
any holding is actually in a foreign currency. Until that is answered, P5.4
(Assets/Debts sheets) has an open dependency it cannot close by waiting. Worth raising
with the owner rather than holding the phase.

Beyond those, the functional stream has now touched three screens the redesign will
rework — Net worth (two new sections), Accounts (two new sections) and Data (two new
sections). Everything added uses `.sec` / `.sec-h` / `.sec-t` / `.card` / `.kpis` / `.kpi`
/ `.note` / `.warnbox` / `.btn` / `.wline` / `.subtot` / `.legend` as §3.1 requires, so it
should inherit the restyle without rework — apart from the eight classes in §2.
