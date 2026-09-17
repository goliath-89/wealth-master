# Working notes for Claude

Read `docs/handoff-20260906.md` first — it carries the state of the build, the decisions
that look reversible and are not, and the browser-verification caveats. This file only
records working practice that would otherwise be lost between sessions.

## Every change updates the PRD status page

There is a published tracker of every requirement in `docs/requirements.md` against what
the code actually does:

**https://claude.ai/code/artifact/dc9d22f7-0f1e-4edd-927a-a826eee114cc**

**Shipping anything means updating that page in the same session.** Not at the end of a
batch, not "next time" — the same session the work lands. It is the owner's map of the
programme, and a tracker that lags the code is worse than none, because it is believed.

Per change, that means:

- move the affected FR rows to their new status, and refresh the block tally beside the
  heading (`7 of 8`, `complete`, and so on)
- recount the four figures in the count strip **from the rows themselves**, never by
  adjusting the previous numbers by hand — an earlier version of the page drifted out of
  step with its own rows exactly that way
- update the standing-findings section when a finding is closed or a new one is found
- reorder "What I would do next" if the change alters what is worth doing next
- republish to the **same URL** (re-publish the same file path; do not create a second
  artifact)

The page's own counts are checked with:

```
grep -o '<div class="row"[^>]*' prd-status.html | grep -o 'data-st="[a-z]*"' | sort | uniq -c
```

Statuses are `done`, `todo`, `hold` (needs an owner decision), `part`, `sup` (superseded
by ADR 001) and `wont`. Rows whose Must priority is still outstanding carry
`data-must="y"`, which is what the "Musts outstanding" filter and count key off.

## Verification bar

`npm test` is necessary and not sufficient. jsdom does no layout and does not enforce CSP,
so it cannot tell you a control is too small, a chart is squashed, or an axis grew a label
for a value nothing reaches. Serve the repo and drive it in a real browser before calling
anything done:

```
python3 -m http.server 8765
```

Both themes. The app treats 44px as the minimum for anything tappable.

A unit-tested engine with no call site passes CI and ships nothing — FR-4.7 sat that way
for a whole phase. UI tests assert on rendered DOM from the real `index.html` for that
reason; keep them that way.

## Deploys

`main` publishes to https://goliath-89.github.io/wealth-master/ on push, gated by the test
job. There is no staging step, so `main` is production.
