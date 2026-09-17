# Parallel work — UI/UX refresh and functional build

**Date** 17 September 2026
**Applies to** every Claude Code session working on this repository while P5 (UI redesign)
and P4 (functional build) run at the same time.

**Read this before starting work.** Both streams edit `app.js` and `index.html`, and every
push to `main` deploys to GitHub Pages with no staging step.

---

## 1. Two streams, two working trees

| Stream | Scope | Working tree | Branches |
|---|---|---|---|
| **Functional** | P4.x features and Could-tier items (`feature-plan.md`) | `…/OneDrive/Documents/Claude/Wealth Master/wealth-master` | `main`, or `feat/p4.x-*` |
| **UI/UX** | P5 redesign (`ui-redesign-plan.md`) | `C:/dev/wm-ui` (git worktree) | `ui/p5.x` |

Never run both sessions in the same folder. A worktree shares the repository but not the
checked-out files, so uncommitted edits in one cannot clobber the other.

---

## 2. File ownership

| Area | Owner | Other stream may… |
|---|---|---|
| Calculation engines — `js/schema.js` `store.js` `entities.js` `valuations.js` `networth.js` `loans.js` `strategy.js` `decisions.js` `forecast.js` `goals.js` `analytics.js` `units.js` `relief.js` `csv.js` `filestore.js` `import-guard.js` `migrate-funddesk.js` | Functional | Read only. UI needs a new figure → new file (`js/categories.js`), not an edit here. |
| Engine tests and fixtures | Functional | Read only |
| `css/app.css` (created in P5.0), page shell, sidebar, top bar | UI | Not edit. Use existing classes (§3). |
| New UI files — `js/ui-shell.js`, `js/categories.js`, `tests/dom-contract.test.js` | UI | Not edit, except adding own hooks to the contract list (§4) |
| `app.js` | **Shared** | Edit only the functions for your own feature. No file-wide reformatting, reordering or renaming. |
| `index.html` | **Shared** | Functional adds sections inside an existing `.view`; UI owns `<header>`, `<nav>`, layout wrappers and `<link>`/`<script>` order. |
| `tests/helpers.js` | **Shared** | Append-only: register new modules at the end of both `loadLib` and `loadApp`. |
| `docs/` | Shared | Each stream updates its own plan; handoffs name which stream wrote them. |

---

## 3. Rules for the functional stream (so new screens inherit the redesign)

1. Build new UI from the existing classes: `.sec`, `.sec-h`, `.sec-t`, `.card`, `.kpis`, `.kpi`, `.note`, `.warnbox`, `.btn`, `.fgrid`, `.fitem`, `.tag`, `.wline`. The redesign restyles these classes, so anything using them picks up the new look with no rework.
2. No inline colours or one-off CSS. If a new style is genuinely needed, add a class and note it in the PR so the UI stream can theme it.
3. Keep the modal pattern (`.modal-bg` + `.modal`) for new forms — P5.4 reuses modals.
4. P4.5 (EPF three-account model) and P4.3 (FX) change the Accounts screen. Merge them before the UI stream starts P5.4, and tell the UI session when they land.

## 4. Rules for the UI stream

1. Never remove or rename an ID, data attribute or class the tests use. Add aliases if needed.
2. Never edit an engine file. New figures go in new pure-function files with worked-example tests.
3. P5.4 (Assets/Debts sheets) waits until P4.5 and P4.3 are merged to `main`.
4. Restyle through classes and tokens, not by rewriting render functions the functional stream is actively changing — check `git log main -- js/app.js` before touching a render function.

## 5. Shared DOM contract

`tests/dom-contract.test.js` (added in P5.0) lists every hook the UI depends on. **Whichever
stream adds a new ID that a test drives, adds it to that list in the same commit.** The test
then protects both streams from each other.

---

## 6. Merge protocol

1. **One push to `main` at a time.** Pages deploys on every push.
2. **Functional** merges small, feature-sized commits, each with `npm test` green.
3. **UI** merges whole phases only: rebase `ui/p5.x` onto the latest `main`, run `npm test`, check in a real browser at 390 / 768 / 1440px, then merge.
4. **Before starting a session**, both streams run `git fetch` and rebase onto `origin/main`.
5. **Conflict in `app.js`:** keep both sides' functions; never resolve by taking one side wholesale. Re-run the full suite after resolving.
6. **Rollback:** `git revert` the merge commit; never force-push `main`.

---

## 7. Start-of-session checklist

- [ ] In the correct working tree for your stream (§1)
- [ ] `git fetch && git rebase origin/main` on your branch
- [ ] `npm test` green before changing anything
- [ ] Read the other stream's latest commits touching `app.js` / `index.html`
- [ ] Know which files you own for this session (§2)
