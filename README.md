# Wealth Master

A single place to see net worth, forecast savings growth, and model loan payoff — across
laptop, phone, and tablet. Static, offline-first, no backend server, zero recurring cost.

Full specification: [docs/requirements.md](docs/requirements.md) ·
Roadmap: [docs/feature-plan.md](docs/feature-plan.md) ·
Architecture: [docs/architecture.svg](docs/architecture.svg)

## Status

**Phase P0 (Foundation) — in progress.** Data model, localStorage store with versioned
migrations, and the Fund Desk v1 → Wealth Master migration path are built and tested. No
net worth charts, forecasting, or Google Sheets sync yet — those are P0 sessions 2–3 and
phase P1. See [docs/feature-plan.md](docs/feature-plan.md) for the full phase breakdown.

Until Sheets sync (P0.5–P0.9) ships, this browser's localStorage is the only copy of your
data. Export regularly from the Data section.

## Running locally

Open `index.html` directly in a browser — no build step, no server required.

```bash
npm install
npm test
```

Tests run under Node's built-in test runner against jsdom, driving the real DOM rather
than re-implementing app logic — see `tests/`.

## No financial data in this repository

This repo is **public** by design (see docs/requirements.md, SEC-8). It holds code and
specifications only. All financial data lives in the browser's localStorage and, once
sync ships, the owner's own Google Sheet — never in git. `.gitignore` backstops common
data-export filenames; CI additionally scans every push for likely financial-data
patterns before it can land on `main`.

## Google OAuth consent screen

Once Sheets sync ships (P0.5), sign-in uses Google Identity Services under the owner's
own Google account, requesting only the `drive.file` scope (access limited to the
spreadsheet the app itself created — not the whole Drive). Because this is a personal-use
app that hasn't gone through Google's verification review, the consent screen will show
an "unverified app" warning on first login. This is expected for a single-user tool and
is not a sign of misconfiguration.

## Migrating from Fund Desk v1

1. In Fund Desk v1, go to Data → Export JSON.
2. In Wealth Master, go to Migrate from Fund Desk v1 → Import Fund Desk v1 export, and
   pick the file.

Funds become Holdings (grouped under one Account per provider); monthly entries become
Valuations. Nothing is overwritten — re-running the import is safe to try, though it will
create duplicate holdings if the same export is imported twice.
