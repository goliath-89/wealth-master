"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("./helpers.js");

// FR-10.1, 10.2, 10.3, 10.6. Grids are built by hand here rather than read from a file,
// so each rule can be exercised on its own; the fixture workbook covers the whole path.

function lib() { return helpers.loadLib(helpers.freshWindow()); }

// Builds the sparse one-based grid the reader produces.
// rows: [[label, bold, v1, v2, ...], ...] — a null value means an empty cell.
function grid(headerLabels, rows) {
  var out = [];
  out[1] = [];
  out[1][1] = { value: "BALANCE SHEET", bold: false };
  headerLabels.forEach(function (h, i) {
    out[1][3 + i] = { value: h, bold: false };
  });
  rows.forEach(function (r, ri) {
    var row = [];
    if (r[0] !== null) row[1] = { value: r[0], bold: !!r[1] };
    r.slice(2).forEach(function (v, i) {
      if (v !== null && v !== undefined) row[3 + i] = { value: v, bold: !!r[1] };
    });
    out[2 + ri] = row;
  });
  return { rows: out, maxRow: out.length - 1, maxCol: 2 + headerLabels.length, name: "S" };
}

var MONTHS3 = ["Jan , 2024", "Feb , 2024", "Mar , 2024"];

// A small, healthy balance sheet: totals reconcile, one leaf starts late, one hits zero.
function healthy() {
  return grid(MONTHS3, [
    ["ASSETS",      true,  1100, 1250, 1400],
    ["Cash",        true,   600,  700,  800],
    ["Maybank",     false,  400,  400,  400],
    ["Closed acct", false,  200,  300,    0],
    ["Opened late", false, null, null,  400],
    ["Investments", true,   500,  550,  600],
    ["Growth fund", false,  500,  550,  600],
    ["LIABILITIES", true,   300,  280,  260],
    ["Car loan",    false,  300,  280,  260],
    ["NET WORTH",   true,   800,  970, 1140]
  ]);
}

// --- reading the month headings --------------------------------------------

test("month headings are read in the shapes people actually write", function () {
  var p = lib().sheetImport.parsePeriod;
  assert.equal(p("Jul , 2023"), "2023-07", "the owner's own sheet writes it this way");
  assert.equal(p("Jul 2023"), "2023-07");
  assert.equal(p("July 2023"), "2023-07");
  assert.equal(p("DEC,2023"), "2023-12");
  assert.equal(p("2023-07"), "2023-07");
  assert.equal(p("7/2023"), "2023-07");
  assert.equal(p(new Date(2023, 6, 1)), "2023-07");
});

test("a heading that is not a month is refused rather than guessed at", function () {
  var p = lib().sheetImport.parsePeriod;
  [null, "", "Total", "Notes", "Smarch 2023", "13/2023", "2023"].forEach(function (bad) {
    assert.equal(p(bad), null, JSON.stringify(bad) + " must not parse");
  });
});

// --- layout -----------------------------------------------------------------

test("the header row and month columns are found", function () {
  var out = lib().sheetImport.detectLayout(healthy());
  assert.equal(out.headerRow, 1);
  assert.equal(out.labelCol, 1);
  assert.deepEqual(out.monthCols.map(function (m) { return m.period; }),
    ["2024-01", "2024-02", "2024-03"]);
});

test("a sheet with no month columns is refused with a reason, not a crash", function () {
  var l = lib();
  var g = grid(["Notes", "Comments"], [["Thing", false, 1, 2]]);
  var out = l.sheetImport.analyseSheet(g, null);
  assert.equal(out.ok, false);
  assert.match(out.reason, /No month columns found/);
});

test("a month appearing twice is used once and reported", function () {
  var l = lib();
  var g = grid(["Jan , 2024", "Jan , 2024", "Feb , 2024"], [
    ["Total", true, 10, 10, 20],
    ["Thing", false, 10, 10, 20]
  ]);
  var out = l.sheetImport.analyseSheet(g, null);
  assert.deepEqual(out.periods, ["2024-01", "2024-02"]);
  assert.ok(out.problems.some(function (p) { return p.kind === "duplicate-month"; }));
});

// --- totals -----------------------------------------------------------------

test("bold rows are read as totals and never proposed as line items", function () {
  var l = lib();
  var out = l.sheetImport.analyseSheet(healthy(), null);
  assert.deepEqual(out.totals.map(function (t) { return t.label; }),
    ["ASSETS", "Cash", "Investments", "LIABILITIES", "NET WORTH"]);
  var names = out.proposals.map(function (p) { return p.label; });
  // Importing a total alongside its leaves double-counts the entire sheet.
  assert.deepEqual(names, ["Maybank", "Closed acct", "Opened late", "Growth fund", "Car loan"]);
});

test("with no formatting at all, totals are inferred from the arithmetic", function () {
  var l = lib();
  // A CSV loses bold entirely, so the only thing left that distinguishes a total is that
  // it equals the sum of the rows beneath it.
  var g = grid(MONTHS3, [
    ["Cash",     false, 600, 700, 800],
    ["Maybank",  false, 400, 400, 400],
    ["Other",    false, 200, 300, 400],
    ["Loans",    false, 300, 280, 260],
    ["Car loan", false, 300, 280, 260]
  ]);
  var out = l.sheetImport.analyseSheet(g, null);
  assert.deepEqual(out.totals.map(function (t) { return t.label; }), ["Cash", "Loans"]);
  assert.deepEqual(out.proposals.map(function (p) { return p.label; }),
    ["Maybank", "Other", "Car loan"]);
});

// --- the sheet checking itself ---------------------------------------------

test("a sheet whose totals match its leaves reconciles", function () {
  var out = lib().sheetImport.analyseSheet(healthy(), null);
  assert.equal(out.reconciliation.ok, true);
  assert.equal(out.reconciliation.failed.length, 0);
  var cash = out.reconciliation.checks.filter(function (c) { return c.label === "Cash"; })[0];
  assert.equal(cash.memberCount, 3);
  assert.equal(cash.periodsChecked, 3);
});

test("a total that disagrees with its leaves is reported, never adjusted", function () {
  var l = lib();
  var g = healthy();
  // Break February's Cash total by RM 50 — the kind of gap a mis-parse would produce.
  g.rows[3][4] = { value: 650, bold: true };
  var out = l.sheetImport.analyseSheet(g, null);

  assert.equal(out.reconciliation.ok, false);
  // ASSETS sums the category totals, so breaking Cash's stated figure fails its parent
  // too. Both are real; the check is looked up by name rather than by position.
  var bad = out.reconciliation.failed.filter(function (c) { return c.label === "Cash"; })[0];
  assert.ok(bad, "the broken category total is reported");
  assert.ok(out.reconciliation.failed.some(function (c) { return c.label === "ASSETS"; }),
    "and so is the parent it rolls up into");
  assert.equal(bad.mismatches[0].period, "2024-02");
  assert.equal(bad.mismatches[0].stated, 650);
  assert.equal(bad.mismatches[0].summed, 700);
  assert.equal(bad.mismatches[0].difference, 50);
  // The leaves are still reported exactly as the sheet has them.
  var maybank = out.proposals.filter(function (p) { return p.label === "Maybank"; })[0];
  assert.equal(maybank.values["2024-02"], 400);
});

test("a sen of rounding in the source is tolerated; two sen is not", function () {
  var l = lib();
  // A real sheet stated 1,634,328.47 against leaves summing to 1,634,328.48. Comparing
  // the floats gives 0.010000000093, so a "> 0.01" test calls the owner's own rounding
  // a mismatch. The comparison is made in whole sen instead.
  var g = grid(["Jan , 2024"], [
    ["Total", true, 1634328.47],
    ["A", false, 1634328.24],
    ["B", false, 0.24]
  ]);
  assert.equal(l.sheetImport.analyseSheet(g, null).reconciliation.ok, true);

  var g2 = grid(["Jan , 2024"], [
    ["Total", true, 1634328.45],
    ["A", false, 1634328.24],
    ["B", false, 0.24]
  ]);
  assert.equal(l.sheetImport.analyseSheet(g2, null).reconciliation.ok, false);
});

// --- nothing dropped silently ----------------------------------------------

test("a row with figures but no name is reported, not imported", function () {
  var l = lib();
  var g = healthy();
  var orphan = [];
  orphan[3] = { value: 5, bold: false };   // column 3 is January; index 0 is unused
  g.rows.push(orphan);
  g.maxRow = g.rows.length - 1;
  var out = l.sheetImport.analyseSheet(g, null);
  var p = out.problems.filter(function (x) { return x.kind === "unlabelled"; })[0];
  assert.ok(p, "an unlabelled row carrying data must be surfaced");
  assert.match(p.reason, /no name/);
});

test("text typed into a balance cell is kept as a note and reported", function () {
  var l = lib();
  var g = healthy();
  g.rows[4][4] = { value: "JPY Trip & HSI tank", bold: false };
  var out = l.sheetImport.analyseSheet(g, null);

  var p = out.problems.filter(function (x) { return x.kind === "text-in-figure"; })[0];
  assert.ok(p);
  assert.match(p.reason, /holds text rather than a figure/);
  var maybank = out.proposals.filter(function (x) { return x.label === "Maybank"; })[0];
  assert.equal(maybank.notes["2024-02"], "JPY Trip & HSI tank");
  assert.equal(maybank.values["2024-02"], undefined, "it is not imported as a balance");
});

test("a column heading that cannot be read is left out and reported", function () {
  var l = lib();
  var g = grid(["Jan , 2024", "Feb , 2024", "Average"], [
    ["Total", true, 10, 20, 15],
    ["Thing", false, 10, 20, 15]
  ]);
  var out = l.sheetImport.analyseSheet(g, null);
  assert.deepEqual(out.periods, ["2024-01", "2024-02"]);
  assert.ok(out.problems.some(function (p) {
    return p.kind === "unreadable-month" && /Average/.test(p.reason);
  }));
});

// --- blank is not zero ------------------------------------------------------

test("a month with no figure produces no valuation at all", function () {
  var l = lib();
  var out = l.sheetImport.analyseSheet(healthy(), null);
  var late = out.proposals.filter(function (p) { return p.label === "Opened late"; })[0];
  assert.equal(late.count, 1, "only March was recorded");
  assert.equal(late.values["2024-01"], undefined);
  assert.equal(late.values["2024-03"], 400);

  // A typed zero is a recorded fact and survives.
  var closed = out.proposals.filter(function (p) { return p.label === "Closed acct"; })[0];
  assert.equal(closed.values["2024-03"], 0);
  assert.equal(closed.count, 3);
});

// --- proposed targets -------------------------------------------------------

test("each line item is proposed as a holding, an asset or a liability", function () {
  var l = lib();
  var g = grid(MONTHS3, [
    ["ASSETS",      true,  1000, 1000, 1000],
    ["Cash",        true,   400,  400,  400],
    ["Maybank",     false,  400,  400,  400],
    ["Retirement",  true,   200,  200,  200],
    ["EPF",         false,  200,  200,  200],
    ["Use Assets",  true,   400,  400,  400],
    ["Prima Condo", false,  400,  400,  400],
    ["LIABILITIES", true,   100,  100,  100],
    ["Credit Cards", false, 100,  100,  100]
  ]);
  var out = l.sheetImport.analyseSheet(g, null);
  var by = {};
  out.proposals.forEach(function (p) { by[p.label] = p; });

  assert.equal(by["Maybank"].kind, "holding");
  assert.equal(by["Maybank"].accountClass, "cash");
  assert.equal(by["EPF"].kind, "holding");
  assert.equal(by["EPF"].accountClass, "retirement");
  assert.equal(by["Prima Condo"].kind, "asset", "a use asset is owned, not held at a bank");
  assert.equal(by["Prima Condo"].assetClass, "property");
  assert.equal(by["Credit Cards"].kind, "liability");
});

test("REGRESSION: a credit card is not typed as a hire purchase", function () {
  var l = lib();
  var g = grid(["Jan , 2024"], [
    ["LIABILITIES", true, 300],
    ["Credit Cards", false, 100],
    ["Hong Leong Car loan", false, 100],
    ["Public Bank house loan", false, 100]
  ]);
  var by = {};
  l.sheetImport.analyseSheet(g, null).proposals.forEach(function (p) { by[p.label] = p; });

  // An unanchored /car/ tested before the credit-card rule matches "Credit Cards" and
  // types a revolving card as flat-rate hire purchase — routing it through the wrong loan
  // engine, which is R4, the highest-consequence error this app can make.
  assert.equal(by["Credit Cards"].liabilityType, "credit card");
  assert.equal(by["Hong Leong Car loan"].liabilityType, "hire purchase");
  assert.equal(by["Public Bank house loan"].liabilityType, "mortgage");
});

test("every proposal starts included, so leaving one out is a visible choice", function () {
  var out = lib().sheetImport.analyseSheet(healthy(), null);
  assert.ok(out.proposals.every(function (p) { return p.include === true; }));
});

// --- diffing against the store ----------------------------------------------

function seededState(l) {
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  s.accounts.push(acct);
  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "Maybank";
  s.holdings.push(h);
  l.valuations.upsertValuation(s, { holdingId: h.id, period: "2024-01", balance: 400 }, "dev-1");
  l.valuations.upsertValuation(s, { holdingId: h.id, period: "2024-02", balance: 999 }, "dev-1");
  return { state: s, holding: h };
}

test("each month is marked new, an update, or unchanged", function () {
  var l = lib();
  var seeded = seededState(l);
  var out = l.sheetImport.analyseSheet(healthy(), seeded.state);
  var maybank = out.proposals.filter(function (p) { return p.label === "Maybank"; })[0];

  assert.equal(maybank.diff.recordStatus, "existing");
  assert.equal(maybank.diff.unchanged, 1, "January already matches");
  assert.equal(maybank.diff.updated, 1, "February differs");
  assert.equal(maybank.diff.added, 1, "March is not recorded yet");

  var feb = maybank.diff.changes.filter(function (c) { return c.period === "2024-02"; })[0];
  assert.equal(feb.current, 999);
  assert.equal(feb.incoming, 400);
  assert.equal(feb.status, "update");
});

test("a line item with no match in the store is a new record", function () {
  var l = lib();
  var seeded = seededState(l);
  var out = l.sheetImport.analyseSheet(healthy(), seeded.state);
  var growth = out.proposals.filter(function (p) { return p.label === "Growth fund"; })[0];
  assert.equal(growth.diff.recordStatus, "new");
  assert.equal(growth.diff.added, 3);
  assert.equal(growth.diff.updated, 0);
});

test("matching a record by name ignores case and surrounding space", function () {
  var l = lib();
  var seeded = seededState(l);
  seeded.state.holdings[0].name = "  maybank  ";
  var out = l.sheetImport.analyseSheet(healthy(), seeded.state);
  var maybank = out.proposals.filter(function (p) { return p.label === "Maybank"; })[0];
  assert.equal(maybank.diff.recordStatus, "existing");
});

test("analysing writes nothing to the store", function () {
  var l = lib();
  var seeded = seededState(l);
  var before = JSON.stringify(seeded.state);
  l.sheetImport.analyseSheet(healthy(), seeded.state);
  assert.equal(JSON.stringify(seeded.state), before,
    "extraction proposes; it must not write");
});

// --- the whole path, from a real file ---------------------------------------

test("the fixture workbook reads, reconciles and proposes end to end", async function () {
  var l = lib();
  var bytes = new Uint8Array(fs.readFileSync(
    path.join(__dirname, "fixtures", "balance-sheet.xlsx")));
  var g = await l.xlsx.readWorkbook(bytes);
  var out = l.sheetImport.analyseSheet(g, l.schema.blank());

  assert.equal(out.ok, true);
  assert.deepEqual(out.periods, ["2024-01", "2024-02", "2024-03"]);
  assert.equal(out.reconciliation.ok, true, "the fixture's own totals check the parse");
  assert.deepEqual(out.proposals.map(function (p) { return p.label; }),
    ["Ampersand & Co", "Closed account", "Opened later", "Growth fund", "Car loan"]);
  assert.equal(out.valuationCount, 13);
  // The unlabelled row in the fixture is reported rather than imported.
  assert.ok(out.problems.some(function (p) { return p.kind === "unlabelled"; }));
});
