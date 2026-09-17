"use strict";
// Wealth Master — balance-sheet import: read, reconcile, propose (FR-10.1, FR-10.2,
// FR-10.3, FR-10.6)
//
// Turns a wide balance sheet — line items down, months across — into a set of proposed
// records, and works out how each one lands against what is already stored. It writes
// nothing. Applying the proposal is a separate, confirmed step, because extraction
// proposes and the owner confirms (FR-10.2).
//
// THE SHEET CHECKS ITSELF. A balance sheet carries its own totals, and in a healthy one
// every total equals the sum of its leaves. That makes the file its own test: parse the
// leaves, re-add them, and compare against the totals the owner's own spreadsheet
// computed. A mis-parse — a shifted column, a total read as a line item — breaks that
// equality and is reported before anything is written. Nothing here is ever adjusted to
// make the sums agree; a disagreement is surfaced, exactly as a loan schedule is measured
// against a statement rather than tuned to it.
//
// BLANK IS NOT ZERO, all the way through. A leaf with no figure for a month is not a
// month at zero — it is a month with nothing recorded, and usually an account that did
// not exist yet. Those cells produce no valuation at all.
//
// NOTHING IS SILENTLY DROPPED (FR-10.6). A row with no label, a month header that cannot
// be read, a balance cell holding text rather than a figure — each is reported
// individually with a reason, and the text of a note is kept rather than discarded.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val) {

  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"];

  // A sheet's totals and its leaves are added independently and compared in whole sen,
  // because comparing the floats directly fails on the source's own rounding: a real
  // balance sheet summed 1,634,328.48 against a stated 1,634,328.47, and the difference
  // came out as 0.010000000093, which is "greater than 0.01". One sen of slack absorbs
  // the spreadsheet's own arithmetic; two sen is a genuine disagreement worth reporting.
  var RECONCILE_SEN = 1;

  function round(n) { return Math.round(n * 100) / 100; }
  function sen(n) { return Math.round(n * 100); }
  function agrees(a, b) { return Math.abs(sen(a) - sen(b)) <= RECONCILE_SEN; }

  // Reads the month headings a person actually writes. The owner's own sheet says
  // "Jul , 2023" — a stray space before the comma — so this is deliberately forgiving
  // about punctuation and case while staying strict about what it will accept: a month
  // it cannot read is reported rather than guessed at.
  function parsePeriod(raw) {
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      var mm = raw.getMonth() + 1;
      return raw.getFullYear() + "-" + (mm < 10 ? "0" + mm : String(mm));
    }
    var s = String(raw).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}$/.test(s)) return s;

    var m = s.match(/^([A-Za-z]{3,})\s*,?\s*(\d{4})$/);
    if (m) {
      var idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (idx === -1) return null;
      var n = idx + 1;
      return m[2] + "-" + (n < 10 ? "0" + n : String(n));
    }
    m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      var mo = parseInt(m[1], 10);
      if (mo < 1 || mo > 12) return null;
      return m[2] + "-" + (mo < 10 ? "0" + mo : String(mo));
    }
    return null;
  }

  // Finds the header row and the month columns. The header is the row with the most
  // readable month headings — more reliable than assuming row 1, since a balance sheet
  // usually opens with a title row or a blank one.
  function detectLayout(grid) {
    var best = null;
    var rows = grid.rows || [];
    for (var r = 1; r < rows.length; r++) {
      if (!rows[r]) continue;
      var cols = [], bad = [];
      for (var c = 1; c <= grid.maxCol; c++) {
        var cell = rows[r][c];
        if (!cell) continue;
        var period = parsePeriod(cell.value);
        if (period) cols.push({ col: c, period: period, label: String(cell.value).trim() });
        else if (c > 1) bad.push({ col: c, value: String(cell.value).trim() });
      }
      // One month is a legitimate sheet — a single month-end export is exactly what a
      // recurring import looks like. parsePeriod is strict enough that a stray label will
      // not be mistaken for a month, so there is no need to demand two.
      if (cols.length >= 1 && (!best || cols.length > best.monthCols.length)) {
        best = { headerRow: r, monthCols: cols, unreadableHeaders: bad };
      }
    }
    if (!best) return null;

    // The label column is the leftmost column holding text on non-header rows — usually
    // column 1, but not worth assuming.
    var labelCol = 1;
    for (var col = 1; col <= grid.maxCol; col++) {
      var hits = 0;
      for (var rr = best.headerRow + 1; rr < rows.length; rr++) {
        var x = rows[rr] && rows[rr][col];
        if (x && typeof x.value === "string") hits++;
      }
      if (hits > 0) { labelCol = col; break; }
    }
    best.labelCol = labelCol;
    // Duplicate month columns would double-count a month; the later one wins and the
    // earlier is reported.
    var seen = {};
    best.duplicatePeriods = [];
    best.monthCols = best.monthCols.filter(function (mc) {
      if (seen[mc.period]) { best.duplicatePeriods.push(mc.period); return false; }
      seen[mc.period] = true;
      return true;
    });
    return best;
  }

  // Splits the sheet into totals, leaves and problems.
  //
  // Bold is the primary signal for a total, because that is how a balance sheet is
  // written and it survives into .xlsx. When no row is bold — a CSV, where formatting is
  // lost — totals are inferred arithmetically instead: a row whose figures equal the sum
  // of the rows beneath it, up to the next such row, is a total.
  function classifyRows(grid, layout) {
    var rows = grid.rows || [];
    var problems = [];
    var entries = [];

    for (var r = layout.headerRow + 1; r < rows.length; r++) {
      if (!rows[r]) continue;
      var labelCell = rows[r][layout.labelCol];
      var label = labelCell && typeof labelCell.value === "string"
        ? labelCell.value.trim() : null;

      var values = {}, notes = {}, count = 0;
      layout.monthCols.forEach(function (mc) {
        var cell = rows[r][mc.col];
        if (!cell) return;
        if (typeof cell.value === "number") {
          values[mc.period] = cell.value;
          count++;
        } else {
          // Text where a figure belongs. The owner typed it, so it is kept as a note for
          // that month and reported; importing it as a balance is impossible and dropping
          // it would lose something they wrote on purpose.
          var text = String(cell.value).trim();
          if (text) {
            notes[mc.period] = text;
            problems.push({
              kind: "text-in-figure",
              row: r, period: mc.period, label: label, value: text,
              reason: 'Row "' + (label || "(unlabelled)") + '", ' + mc.period +
                ' holds text rather than a figure: "' + text + '". It can be kept as a note.'
            });
          }
        }
      });

      if (!label) {
        if (count || Object.keys(notes).length) {
          problems.push({
            kind: "unlabelled",
            row: r, count: count,
            reason: "Row " + r + " has " + count + " figure" + (count === 1 ? "" : "s") +
              " but no name, so there is nothing to import it as."
          });
        }
        continue;
      }
      if (!count && !Object.keys(notes).length) continue;

      entries.push({
        row: r,
        label: label,
        bold: !!(labelCell && labelCell.bold),
        values: values,
        notes: notes,
        count: count
      });
    }

    var anyBold = entries.some(function (e) { return e.bold; });
    if (anyBold) {
      entries.forEach(function (e) { e.isTotal = e.bold || looksLikeTotal(e.label); });
    } else {
      inferTotals(entries, layout);
    }

    // Category is the nearest total above a leaf; section is the nearest top-level one.
    // "LIABILITIES" above a row is what makes it a debt rather than a holding.
    var category = null, section = null;
    entries.forEach(function (e) {
      if (e.isTotal) {
        if (/^(assets?|liabilit(y|ies)|net\s*worth)$/i.test(e.label)) {
          section = e.label;
          category = e.label;
        } else {
          category = e.label;
        }
        e.section = section;
        return;
      }
      e.category = category;
      e.section = section;
    });

    return { entries: entries, problems: problems };
  }

  // Some labels are totals whatever the arithmetic says. "ASSETS" sums the category
  // totals rather than the rows directly beneath it, and "NET WORTH" has nothing beneath
  // it at all, so neither is caught by the scan below — and in a CSV, where no row is
  // bold, both would be proposed as line items. Importing ASSETS as a holding
  // double-counts the whole portfolio in one click.
  var TOTAL_LABEL = /^\s*(grand\s+)?(total|sub-?total|assets?|liabilit(y|ies)|net\s*worth|net\s*assets?)\b/i;

  function looksLikeTotal(label) {
    return TOTAL_LABEL.test(label || "");
  }

  // Used when formatting is unavailable. A row is a total when, for every month both it
  // and its followers populate, it equals their sum.
  function inferTotals(entries, layout) {
    entries.forEach(function (e) { e.isTotal = looksLikeTotal(e.label); });
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isTotal) continue;
      for (var k = i + 1; k <= entries.length; k++) {
        if (k === entries.length || entries[k].isTotal) break;
        var matched = matchesSum(entries[i], entries.slice(i + 1, k + 1), layout);
        if (matched) { entries[i].isTotal = true; break; }
      }
    }
  }

  function matchesSum(candidate, members, layout) {
    if (!members.length) return false;
    var compared = 0;
    for (var i = 0; i < layout.monthCols.length; i++) {
      var p = layout.monthCols[i].period;
      if (candidate.values[p] === undefined) continue;
      var sum = 0, any = false;
      members.forEach(function (m) {
        if (m.values[p] !== undefined) { sum += m.values[p]; any = true; }
      });
      if (!any) continue;
      if (!agrees(sum, candidate.values[p])) return false;
      compared++;
    }
    return compared > 0;
  }

  // Re-adds the leaves under each total and compares against what the sheet itself says.
  // This is the import's own check that it read the file correctly.
  function reconcile(classified, layout) {
    var entries = classified.entries;
    var checks = [];

    entries.forEach(function (e, i) {
      if (!e.isTotal) return;
      // Members are the rows beneath, up to the next total at the same or higher level.
      // A top-level total (ASSETS) sums the category totals; a category total sums its
      // own leaves.
      var topLevel = /^(assets?|liabilit(y|ies)|net\s*worth)$/i.test(e.label);
      var members = [];
      for (var j = i + 1; j < entries.length; j++) {
        var other = entries[j];
        var otherTop = /^(assets?|liabilit(y|ies)|net\s*worth)$/i.test(other.label);
        if (otherTop) break;
        if (topLevel) { if (other.isTotal) members.push(other); }
        else {
          if (other.isTotal) break;
          members.push(other);
        }
      }
      if (!members.length) return;

      var periods = [], mismatches = [];
      layout.monthCols.forEach(function (mc) {
        var stated = e.values[mc.period];
        if (stated === undefined) return;
        var sum = 0, any = false;
        members.forEach(function (m) {
          if (m.values[mc.period] !== undefined) { sum += m.values[mc.period]; any = true; }
        });
        if (!any) return;
        periods.push(mc.period);
        if (!agrees(sum, stated)) {
          mismatches.push({ period: mc.period, stated: round(stated), summed: round(sum),
            difference: round(sum - stated) });
        }
      });

      checks.push({
        label: e.label,
        row: e.row,
        memberCount: members.length,
        periodsChecked: periods.length,
        mismatches: mismatches,
        ok: mismatches.length === 0
      });
    });

    var bad = checks.filter(function (c) { return !c.ok; });
    return {
      checks: checks,
      ok: bad.length === 0,
      // Totals are never imported as line items — they are the yardstick, and importing
      // one alongside its leaves double-counts the whole sheet.
      failed: bad
    };
  }

  // ---- proposing targets ---------------------------------------------------

  function classFor(category, section) {
    var c = (category || "").toLowerCase();
    if (/liabilit/.test((section || "").toLowerCase())) return null;
    if (/cash|saving|deposit|current/.test(c)) return "cash";
    if (/retire|epf|kwsp|pension/.test(c)) return "retirement";
    if (/invest|fund|portfolio|equit/.test(c)) return "investment";
    return "other";
  }

  // Order matters, and so do word boundaries. An unanchored /car/ tested before the
  // credit-card rule matches "Credit Cards" and types a revolving card as a flat-rate
  // hire purchase — which would put it through the wrong loan engine entirely, the
  // highest-consequence mistake this app can make. Most specific first.
  function liabilityTypeFor(label) {
    var s = (label || "").toLowerCase();
    if (/\bcredit\s*cards?\b/.test(s)) return "credit card";
    if (/\bptptn\b/.test(s)) return "PTPTN";
    if (/\basb\b/.test(s)) return "ASB financing";
    if (/\b(mortgage|house|home|property)\b/.test(s)) return "mortgage";
    if (/\b(car|vehicle|hire\s*purchase|auto)\b/.test(s)) return "hire purchase";
    if (/\bpersonal\b/.test(s)) return "personal loan";
    return "other";
  }

  function assetClassFor(label) {
    var s = (label || "").toLowerCase();
    if (/\b(condo|house|home|apartment|land|property)\b/.test(s)) return "property";
    if (/\b(car|honda|toyota|perodua|proton|vehicle|bike|motor|myvi|axia)\b/.test(s)) return "vehicle";
    if (/\b(gold|jewel\w*|watch|art)\b/.test(s)) return "valuable";
    return "other";
  }

  // A physical asset is a thing owned outright rather than a balance at an institution,
  // so it belongs in assets, not holdings. The category naming it is the signal.
  function isPhysicalCategory(category) {
    return /use\s*asset|physical|property|vehicle/i.test(category || "");
  }

  // One proposal per leaf. Every field here is a default the owner can change before
  // anything is written — the point of the review step is that these guesses are visible
  // and correctable, not that they are right.
  function proposeTargets(classified) {
    return classified.entries.filter(function (e) { return !e.isTotal; }).map(function (e) {
      var isLiability = /liabilit/i.test(e.section || "");
      var kind = isLiability ? "liability" : (isPhysicalCategory(e.category) ? "asset" : "holding");
      return {
        row: e.row,
        label: e.label,
        category: e.category,
        section: e.section,
        kind: kind,
        // Defaults, all editable in the review table.
        name: e.label,
        institutionName: isLiability || kind === "asset" ? null : e.label,
        accountName: isLiability || kind === "asset" ? null : e.label,
        accountClass: kind === "holding" ? classFor(e.category, e.section) : null,
        liabilityType: kind === "liability" ? liabilityTypeFor(e.label) : null,
        assetClass: kind === "asset" ? assetClassFor(e.label) : null,
        values: e.values,
        notes: e.notes,
        count: e.count,
        // Skipped rows are still listed, so leaving one out is a visible decision rather
        // than something the importer did quietly.
        include: true
      };
    });
  }

  // ---- diffing against what is already stored ------------------------------

  function norm(s) { return String(s || "").trim().toLowerCase(); }

  // Matches a proposal to an existing record by name, so re-importing a refreshed sheet
  // updates rather than duplicating (FR-10.3).
  function findExisting(state, proposal) {
    if (proposal.kind === "liability") {
      return ent.live(state.liabilities).filter(function (l) {
        return norm(l.name) === norm(proposal.name);
      })[0] || null;
    }
    if (proposal.kind === "asset") {
      return ent.live(state.assets).filter(function (a) {
        return norm(a.name) === norm(proposal.name);
      })[0] || null;
    }
    return ent.live(state.holdings).filter(function (h) {
      return norm(h.name) === norm(proposal.name);
    })[0] || null;
  }

  // What each month's figure would do: create a valuation, change one, or leave it alone.
  // An unchanged row is still shown, so the owner can see the import is not about to
  // rewrite history it agrees with.
  function diffProposal(state, proposal) {
    var existing = findExisting(state, proposal);
    var subjectId = existing ? existing.id : null;
    var periods = Object.keys(proposal.values).sort();
    var added = 0, updated = 0, unchanged = 0;
    var changes = [];

    periods.forEach(function (p) {
      var incoming = proposal.values[p];
      var current = subjectId ? val.valuationFor(state, subjectId, p) : null;
      var has = current && current.balance !== null && current.balance !== undefined;
      var status;
      if (!has) { status = "new"; added++; }
      else if (!agrees(current.balance, incoming)) {
        status = "update"; updated++;
      } else { status = "unchanged"; unchanged++; }
      changes.push({
        period: p, incoming: incoming,
        current: has ? current.balance : null,
        status: status,
        note: proposal.notes[p] || null
      });
    });

    return {
      existing: existing,
      recordStatus: existing ? "existing" : "new",
      added: added,
      updated: updated,
      unchanged: unchanged,
      changes: changes
    };
  }

  // The whole reading of a workbook: layout, rows, reconciliation, proposals and what
  // each would do. Pure — it touches neither the grid nor the store.
  function analyse(grid, state) {
    var layout = detectLayout(grid);
    if (!layout) {
      return {
        ok: false,
        reason: "No month columns found. The first row should name the months across the " +
          "top, like \"Jan 2024\" or \"2024-01\".",
        problems: [], proposals: [], layout: null
      };
    }

    var classified = classifyRows(grid, layout);
    var recon = reconcile(classified, layout);
    var proposals = proposeTargets(classified);

    var problems = classified.problems.slice();
    layout.unreadableHeaders.forEach(function (h) {
      problems.push({
        kind: "unreadable-month",
        col: h.col,
        reason: 'Column heading "' + h.value + '" is not a month this can read, so that ' +
          "column is left out."
      });
    });
    layout.duplicatePeriods.forEach(function (p) {
      problems.push({
        kind: "duplicate-month",
        reason: "The month " + p + " appears in more than one column; only the first is used."
      });
    });

    if (state) {
      proposals.forEach(function (p) { p.diff = diffProposal(state, p); });
    }

    return {
      ok: true,
      layout: layout,
      periods: layout.monthCols.map(function (m) { return m.period; }),
      totals: classified.entries.filter(function (e) { return e.isTotal; })
        .map(function (e) { return { label: e.label, row: e.row }; }),
      proposals: proposals,
      reconciliation: recon,
      problems: problems,
      valuationCount: proposals.reduce(function (n, p) { return n + p.count; }, 0)
    };
  }

  // ---- CSV --------------------------------------------------------------

  // A CSV of the same shape, turned into the grid the reader produces. Formatting is
  // lost, so no cell is bold and totals fall through to the arithmetic inference above —
  // which is why that path exists.
  function parseCsvGrid(text) {
    var rows = [], row = [], field = "", quoted = false, col = 1, maxCol = 0;
    var i = 0;

    function endField() {
      var t = field.trim();
      if (t !== "") {
        // A figure may arrive as "RM 1,234.56" or "(1,234.56)" for a negative.
        var cleaned = t.replace(/^RM\s*/i, "").replace(/,/g, "");
        var negated = /^\(.*\)$/.test(cleaned);
        if (negated) cleaned = cleaned.slice(1, -1);
        var n = cleaned === "" ? NaN : Number(cleaned);
        row[col] = { value: isNaN(n) ? t : (negated ? -n : n), bold: false };
        if (col > maxCol) maxCol = col;
      }
      field = "";
      col++;
    }
    function endRow() {
      endField();
      rows.push(row);
      row = []; col = 1;
    }

    text = String(text).replace(/^\uFEFF/, "");
    while (i < text.length) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ",") { endField(); i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { endRow(); i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || col > 1) endRow();

    // The grid is one-based, so index 0 stays unused.
    var out = [];
    rows.forEach(function (r, idx) { out[idx + 1] = r; });
    return { rows: out, maxRow: rows.length, maxCol: maxCol, name: "CSV" };
  }

  // ---- applying a confirmed proposal ---------------------------------------

  function findByName(list, name) {
    var target = norm(name);
    return ent.live(list).filter(function (r) { return norm(r.name) === target; })[0] || null;
  }

  // Retirement money is not reachable, so it is not liquid. Everything else defaults to
  // liquid and the owner can correct it — guessing illiquid would understate the
  // emergency runway, which is the more dangerous direction to be wrong in.
  function liquidFor(accountClass) {
    return accountClass !== "retirement";
  }

  // Writes a confirmed proposal into the store. Callers snapshot first: this is a single
  // undoable action (FR-10.4), and the undo is the caller's snapshot, not a reversal
  // computed here.
  //
  // Records are matched by name before being created, so importing a refreshed sheet
  // updates what is already there rather than growing a second copy of the portfolio.
  function applyImport(state, proposals, deviceId, opts) {
    opts = opts || {};
    var keepNotes = opts.keepNotes !== false;
    var made = {
      institutions: 0, accounts: 0, holdings: 0, assets: 0, liabilities: 0,
      valuationsAdded: 0, valuationsUpdated: 0, valuationsUnchanged: 0, notes: 0,
      rows: 0
    };

    proposals.filter(function (p) { return p.include; }).forEach(function (p) {
      var subjectId = null;
      made.rows++;

      if (p.kind === "liability") {
        var liab = findByName(state.liabilities, p.name);
        if (!liab) {
          liab = ent.upsert(state, "liabilities", {
            name: p.name, type: p.liabilityType || "other",
            principal: 0, ratePct: 0, rateBasis: "reducing", tenureMonths: 0,
            startDate: null, instalment: 0, linkedAssetId: null
          }, deviceId);
          made.liabilities++;
        }
        subjectId = liab.id;

      } else if (p.kind === "asset") {
        var asset = findByName(state.assets, p.name);
        if (!asset) {
          asset = ent.upsert(state, "assets", {
            name: p.name, class: p.assetClass || "other", acquiredOn: null, cost: null,
            depreciationModel: null, linkedLiabilityId: null, liquid: false
          }, deviceId);
          made.assets++;
        }
        subjectId = asset.id;

      } else {
        var holding = findByName(state.holdings, p.name);
        if (!holding) {
          var instName = (p.institutionName || p.name).trim();
          var inst = findByName(state.institutions, instName);
          if (!inst) {
            inst = ent.upsert(state, "institutions",
              { name: instName, type: "", pidmMember: false }, deviceId);
            made.institutions++;
          }
          var acctName = (p.accountName || p.name).trim();
          var acct = ent.live(state.accounts).filter(function (a) {
            return a.institutionId === inst.id && norm(a.name) === norm(acctName);
          })[0];
          if (!acct) {
            acct = ent.upsert(state, "accounts", {
              institutionId: inst.id, name: acctName,
              class: p.accountClass || "other", currency: "MYR",
              shariah: false, liquid: liquidFor(p.accountClass),
              // PIDM cover is never assumed. It protects deposits, not investments, and
              // claiming it for an account that does not have it would misreport the one
              // figure that exists to warn about uninsured money.
              pidmProtected: false, archived: false
            }, deviceId);
            made.accounts++;
          }
          holding = ent.upsert(state, "holdings", {
            accountId: acct.id, name: p.name, instrumentType: "",
            rate: 0, feePct: 0, salesPct: 0, unitBased: false,
            fixedPrice: null, reliefCategory: null, epfAccount: null
          }, deviceId);
          made.holdings++;
        }
        subjectId = holding.id;
      }

      var field = p.kind === "liability" ? "liabilityId"
        : (p.kind === "asset" ? "assetId" : "holdingId");

      Object.keys(p.values).sort().forEach(function (period) {
        var entry = { period: period, balance: p.values[period] };
        entry[field] = subjectId;
        var before = val.valuationFor(state, subjectId, period);
        var had = before && before.balance !== null && before.balance !== undefined;
        if (had && agrees(before.balance, p.values[period])) {
          made.valuationsUnchanged++;
        } else if (had) {
          made.valuationsUpdated++;
        } else {
          made.valuationsAdded++;
        }
        if (keepNotes && p.notes[period]) entry.note = p.notes[period];
        val.upsertValuation(state, entry, deviceId);
      });

      // A note on a month with no figure still belongs to that month. It is written with
      // a blank balance, which net worth skips, so keeping it cannot alter a total.
      if (keepNotes) {
        Object.keys(p.notes).forEach(function (period) {
          if (p.values[period] !== undefined) return;
          var e = { period: period, note: p.notes[period], balance: null };
          e[field] = subjectId;
          val.upsertValuation(state, e, deviceId);
          made.notes++;
        });
      }
    });

    return made;
  }

  return {
    RECONCILE_SEN: RECONCILE_SEN,
    parsePeriod: parsePeriod,
    detectLayout: detectLayout,
    classifyRows: classifyRows,
    // Exported under a qualified name: every module is flattened onto one WM namespace,
    // and loans.js already owns "reconcile" for measuring a schedule against a statement.
    // Shadowing it silently replaced that function and broke five loan tests.
    reconcileSheet: reconcile,
    proposeTargets: proposeTargets,
    findExisting: findExisting,
    parseCsvGrid: parseCsvGrid,
    looksLikeTotal: looksLikeTotal,
    applyImport: applyImport,
    diffProposal: diffProposal,
    analyseSheet: analyse
  };
});
