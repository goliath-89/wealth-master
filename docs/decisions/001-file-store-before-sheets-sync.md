# ADR 001 — File store first; Google Sheets sync deferred

**Date** 11 August 2026
**Status** Accepted
**Supersedes** the P0.5–P0.8 sequencing in `feature-plan.md`, not the requirements themselves

---

## Context

The original architecture made a Google Sheet the system of record, with the browser as a
read-write client, an offline mutation queue, and last-write-wins conflict resolution. The
handoff called sync "the hard part of the build" and allocated roughly two of the three P0
sessions to it.

Setting that up requires a Google Cloud project, an OAuth client, a consent screen, and a
test-user list before a single line of storage code runs. The owner pushed back on that
complexity and asked for a re-evaluation against simple file upload/export/import.

Two facts reframed the decision.

**Only one of six usage scenarios uses the phone, and it reads.** S1, S3, S4, S5 and S6 are
all laptop. S2 — the weekly "what am I worth" check — is the sole phone scenario. Almost the
entire cost of bidirectional sync exists to let a second device *write*.

**Valuations are monthly (assumption A1).** A data file refreshed monthly is not stale; it is
exactly as current as the underlying data.

On questioning, the owner confirmed they do want to enter data from the phone occasionally —
so a strictly read-only phone was ruled out. The question became whether occasional writes
justify a full sync engine.

## Decision

Build a **file-based store** as the system of record, and defer Google Sheets sync until
manual handoff is demonstrated to be painful in real use.

The store is a JSON file in the owner's existing OneDrive folder. On Chrome and Edge the app
holds a persistent file handle, so saves are automatic and OneDrive provides both replication
and version history. Safari and Firefox fall back to manual export.

Multi-device safety uses a **single-writer model** rather than a merge engine. Every save
stamps `deviceId` and `updatedAt`, which the schema already carries. Importing a file older
than local state raises a blocking warning naming the device, the age difference, and the
number of local changes that would be discarded.

Occasional phone entry is supported by exporting from the phone and importing on the laptop,
preferably via the Web Share API rather than a download.

## Consequences

Dropped from P0: **P0.5** (OAuth), **P0.6** (Sheets adapter), **P0.7** (offline mutation
queue), **P0.8** (conflict resolution). **P0.9** becomes a data-file status indicator rather
than a sync indicator. **P0.10** (export/import) becomes central.

Remaining P0 effort falls from roughly two sessions to about half of one, and P1 — the net
worth view, which is the actual point of the tool — moves forward by around two weeks.

Risks **R1** (sync corruption) and **R5** (OAuth verification friction) fall away, as do
constraints **C3** (Sheets quota) and **C4** (token expiry). **R4** — Malaysian flat-rate
loan maths implemented as reducing balance — becomes the highest-consequence risk in the
programme, which is where attention belongs.

Security requirements **SEC-3**, **SEC-4** and **SEC-5** become moot while there is no OAuth.
They stay in the spec against sync being revisited.

Accepted losses: concurrent edits on two devices between syncs force a conscious choice and
lose one side, rather than merging per record. **FR-7.6**'s hand-editable Sheet is replaced by
per-entity CSV export and import for bulk editing in Excel. **FR-8.1**'s scheduled reference
pipeline has no Sheet to write into and needs rethinking when P4 arrives.

`updatedAt`, `deviceId` and tombstones stay in the schema. They cost nothing now and mean
Sheets sync can later be added as a second storage adapter without a schema migration.

## Revisit if

Phone entry becomes routine rather than occasional; two devices are regularly edited between
syncs; or the file handoff proves more irritating than a weekly OAuth re-consent. Any of these
makes the sync engine worth its two sessions — and by then there will be real usage data on
how often conflicts actually occur, rather than a guess.
