"use strict";
// Wealth Master — CSV import per entity (FR-7.7, the other half of the round trip)
//
// csv.js writes one file per entity; this reads one back. Together they are the
// hand-editable bulk path that ADR 001 removed along with the Google Sheet: export
// accounts.csv, fix thirty names in Excel, import it back.
//
// It is NOT the balance-sheet import. sheet-import.js reads a wide statement where every
// column is a month and figures have to be inferred; this reads a file the app itself
// wrote, with known columns and an id on every row. Different problems, so different code.
//
// The rules that make it safe to hand someone a spreadsheet and take it back:
//
//   A MISSING ROW IS NOT A DELETE. Importing a file with five rows changes those five and
//   leaves everything else alone. Deleting rows in Excel and re-importing would otherwise
//   destroy whatever the owner had filtered out of view — the most likely spreadsheet
//   accident there is. A row is removed only by setting its `deleted` cell to true.
//
//   BLANK IS NOT ZERO. An empty cell clears a figure back to "not recorded"; it never
//   records a nought. This is the same invariant the month grid holds, and a spreadsheet
//   is exactly where it would be lost — Excel shows null and 0 identically.
//
//   NOTHING IS WRITTEN UNTIL THE OWNER HAS SEEN IT. analyse() reports; apply() writes.
//
//   A ROW THAT CANNOT BE READ IS REPORTED, NEVER DROPPED. A file where four of two
//   hundred rows are wrong imports the other hundred and ninety-six and names the four.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"), require("./entities.js"),
      require("./csv.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema, ent, csv, val) {

  // ---- reading the file ----------------------------------------------------

  // A faithful CSV reader: every field stays a string, an empty field stays an empty
  // string, and a row's length is its own. sheet-import's parser coerces figures and
  // drops empty cells, which is right for a statement and wrong here — the difference
  // between "" and "0" is the whole blank-is-not-zero rule.
  function parseRows(text) {
    var rows = [], row = [], field = "", quoted = false, sawAny = false, i = 0;

    function endField() { row.push(field); field = ""; sawAny = true; }
    function endRow() { endField(); rows.push(row); row = []; sawAny = false; }

    text = String(text === null || text === undefined ? "" : text).replace(/^﻿/, "");
    while (i < text.length) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; sawAny = true; i++; continue; }
      if (ch === ",") { endField(); i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { endRow(); i++; continue; }
      field += ch; sawAny = true; i++;
    }
    if (field !== "" || row.length || sawAny) endRow();

    // A trailing newline leaves one empty row; so does a blank line mid-file. Neither is
    // a record. A row of nothing but commas is a blank line Excel has been through.
    return rows.filter(function (r) {
      return r.some(function (f) { return String(f).trim() !== ""; });
    });
  }

  // csv.js prefixes a leading = + - @ with an apostrophe so Excel cannot read the cell as
  // a formula. Taking it off again is what makes the round trip lossless: without this a
  // holding named "-Cash" comes back as "'-Cash", and every import would add another.
  function unguard(s) {
    return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
  }

  // ---- what each column holds ----------------------------------------------

  // Only the columns that are not plain text. Everything absent from here is a string,
  // which is the safe default: a mis-typed number becomes a visible problem, never a
  // silent zero.
  var FIELD_TYPES = {
    pidmMember: "bool", shariah: "bool", liquid: "bool", pidmProtected: "bool",
    archived: "bool", unitBased: "bool", deleted: "bool",
    rate: "num", feePct: "num", salesPct: "num", fixedPrice: "num",
    balance: "num", units: "num", unitPrice: "num", contribution: "num",
    withdrawal: "num", income: "num", fxRate: "num", cost: "num",
    principal: "num", ratePct: "num", tenureMonths: "num", instalment: "num",
    scheduled: "num", actual: "num", extra: "num", inflationPct: "num",
    targetAmount: "num", statementInterest: "num", statementBalance: "num",
    statementInstalment: "num",
    period: "period"
  };

  // Which column points at which list, so a row naming a parent that is not there is
  // refused rather than creating an orphan the tree cannot draw.
  var REFERENCES = {
    institutionId: "institutions", accountId: "accounts", holdingId: "holdings",
    liabilityId: "liabilities", assetId: "assets", linkedLiabilityId: "liabilities",
    linkedAssetId: "assets"
  };

  // Exactly one of these is set on a valuation — it is what the figure is about.
  var SUBJECT_FIELDS = ["holdingId", "liabilityId", "assetId"];

  var TRUE_WORDS = ["true", "yes", "y", "1"];
  var FALSE_WORDS = ["false", "no", "n", "0"];

  function coerce(key, raw) {
    var s = unguard(String(raw === null || raw === undefined ? "" : raw).trim());
    var type = FIELD_TYPES[key];

    if (type === "bool") {
      // A flag is a yes or a no; there is no third state to preserve, so a blank cell is
      // the no. That is not the blank-is-not-zero rule bending — a missing tick is a
      // fact, a missing figure is an absence.
      var low = s.toLowerCase();
      if (s === "" || FALSE_WORDS.indexOf(low) !== -1) return { value: false };
      if (TRUE_WORDS.indexOf(low) !== -1) return { value: true };
      return { error: key + ': "' + s + '" is not true or false' };
    }

    if (type === "num") {
      if (s === "") return { value: null };          // not recorded, not nought
      var cleaned = s.replace(/^RM\s*/i, "").replace(/,/g, "");
      var negated = /^\(.*\)$/.test(cleaned);
      if (negated) cleaned = cleaned.slice(1, -1);
      var n = Number(cleaned);
      if (cleaned === "" || isNaN(n)) return { error: key + ': "' + s + '" is not a number' };
      return { value: negated ? -n : n };
    }

    if (type === "period") {
      if (s === "") return { value: "" };
      // Excel is fond of turning 2026-03 into a date. Both forms are accepted; the month
      // is what is stored.
      var m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(s);
      if (!m) return { error: key + ': "' + s + '" is not a month like 2026-03' };
      if (!val.isPeriod(m[1] + "-" + m[2])) return { error: key + ': "' + s + '" is not a real month' };
      return { value: m[1] + "-" + m[2] };
    }

    return { value: s === "" ? null : s };
  }

  // ---- reading one file ----------------------------------------------------

  function sameValue(a, b) {
    if (a === null || a === undefined) return b === null || b === undefined || b === "";
    if (b === null || b === undefined) return a === "";
    return String(a) === String(b);
  }

  // What this row would change about the record already held, field by field, so the
  // review table can say "balance 4,000 → 4,250" rather than only "update".
  function changesAgainst(existing, incoming, columns) {
    var out = [];
    columns.forEach(function (key) {
      if (key === "id" || key === "updatedAt" || key === "deviceId") return;
      if (!(key in incoming)) return;
      if (!sameValue(existing[key], incoming[key])) {
        out.push({ field: key, from: existing[key], to: incoming[key] });
      }
    });
    return out;
  }

  function referenceProblems(state, entity, rec) {
    var problems = [];
    Object.keys(REFERENCES).forEach(function (key) {
      if (!(key in rec)) return;
      var id = rec[key];
      if (id === null || id === undefined || id === "") return;
      if (!ent.byId(state[REFERENCES[key]], id)) {
        problems.push(key + " " + id + " is not in your data");
      }
    });

    if (entity === "valuations") {
      var set = SUBJECT_FIELDS.filter(function (k) { return rec[k]; });
      if (!set.length) problems.push("No holdingId, liabilityId or assetId — nothing this figure is about");
      else if (set.length > 1) problems.push("More than one of holdingId, liabilityId and assetId is filled");
      if (!rec.period) problems.push("period is required");
    }
    return problems;
  }

  // The entity-level rules already used by the dialogs, applied to the record as it would
  // stand after the import rather than to the row on its own — so clearing one cell of an
  // otherwise valid account is judged on the account it leaves behind.
  function entityProblems(state, entity, merged) {
    if (entity === "institutions" || entity === "accounts" || entity === "holdings") {
      return ent.validate(entity, merged, state);
    }
    if ((entity === "assets" || entity === "liabilities" || entity === "goals" ||
         entity === "scenarios") && !String(merged.name || "").trim()) {
      return ["Name is required"];
    }
    return [];
  }

  function analyse(state, entity, text) {
    var columns = csv.COLUMNS[entity];
    if (!columns) {
      return { ok: false, entity: entity, fatal: "There is no " + entity + " export to match this against." };
    }

    var grid = parseRows(text);
    if (!grid.length) {
      return { ok: false, entity: entity, fatal: "That file has no rows in it." };
    }

    var header = grid[0].map(function (h) { return unguard(String(h).trim()); });
    var known = header.filter(function (h) { return columns.indexOf(h) !== -1; });
    if (known.indexOf("id") === -1) {
      // Without ids there is no way to tell an edit from a new record, and guessing by
      // name would silently merge two accounts that happen to share one.
      return {
        ok: false, entity: entity,
        fatal: "That file has no id column, so there is no way to tell which records it is about. Export " +
          entity + " again and edit that file."
      };
    }
    if (known.length < 2) {
      return { ok: false, entity: entity,
        fatal: "None of that file's columns match a " + entity + " export." };
    }

    var unknown = header.filter(function (h) { return h !== "" && columns.indexOf(h) === -1; });
    var rows = [];
    var seenIds = {};

    grid.slice(1).forEach(function (cells, n) {
      var line = n + 2;                      // 1-based, and the header is line 1
      var problems = [];
      var incoming = {};

      header.forEach(function (key, idx) {
        if (columns.indexOf(key) === -1) return;
        var got = coerce(key, cells[idx]);
        if (got.error) problems.push(got.error);
        else incoming[key] = got.value;
      });

      var id = incoming.id ? String(incoming.id) : "";
      if (id && seenIds[id]) {
        problems.push("id " + id + " appears twice in this file (line " + seenIds[id] + ")");
      } else if (id) {
        seenIds[id] = line;
      }

      var existing = id ? ent.byId(state[entity], id) : null;
      // A column the file leaves out keeps whatever is already stored. Editing three
      // columns of an export must not blank the rest.
      var merged = {};
      if (existing) for (var k in existing) merged[k] = existing[k];
      for (var j in incoming) merged[j] = incoming[j];

      problems = problems
        .concat(referenceProblems(state, entity, merged))
        .concat(entityProblems(state, entity, merged));

      var changes = existing ? changesAgainst(existing, incoming, columns) : [];
      var action;
      if (!existing) action = "new";
      else if (!changes.length) action = "unchanged";
      else if (incoming.deleted === true && !existing.deleted) action = "delete";
      else action = "update";

      rows.push({
        line: line,
        id: id,
        name: merged.name || merged.period || id || "",
        action: action,
        record: merged,
        incoming: incoming,
        changes: changes,
        problems: problems,
        // An unreadable row is never importable; a readable one starts included, and an
        // unchanged one starts excluded because importing it would only restamp it.
        include: !problems.length && action !== "unchanged"
      });
    });

    var counts = { new: 0, update: 0, delete: 0, unchanged: 0, problems: 0 };
    rows.forEach(function (r) {
      if (r.problems.length) counts.problems++;
      else counts[r.action]++;
    });

    return {
      ok: true,
      entity: entity,
      columns: known,
      unknownColumns: unknown,
      rows: rows,
      counts: counts,
      // Named so the UI can say it out loud rather than the owner discovering it.
      missingAreKept: true
    };
  }

  // ---- which file is this? -------------------------------------------------

  // The owner picks a file, not an entity. Every export carries the entity in its name
  // and, more reliably, in its columns — asking them to say again what the file already
  // says is a chance to pick wrong and overwrite the wrong list.
  function detectEntity(header, fileName) {
    var names = header.map(function (h) { return unguard(String(h).trim()); });
    var scored = Object.keys(csv.COLUMNS).map(function (entity) {
      var cols = csv.COLUMNS[entity];
      var matched = cols.filter(function (c) { return names.indexOf(c) !== -1; }).length;
      // Columns this entity does not have count against it, so accounts.csv cannot pass
      // as holdings.csv on the handful of columns every entity shares.
      var foreign = names.filter(function (n) {
        return n !== "" && cols.indexOf(n) === -1;
      }).length;
      return { entity: entity, score: matched - foreign, matched: matched };
    }).sort(function (a, b) { return b.score - a.score; });

    var best = scored[0];
    var tied = scored.filter(function (x) { return x.score === best.score; });

    // Checked before the tie, or a file that matches nothing at all ties everywhere and
    // gets offered as "could be any of these eleven" — a shopping list is not an export.
    if (best.matched < 2) return { ambiguous: [] };

    if (tied.length > 1) {
      // wealth-master-holdings-2026-09.csv — the name breaks a tie the columns cannot.
      var hinted = tied.filter(function (x) {
        return fileName && new RegExp("(^|[^a-z])" + x.entity + "([^a-z]|$)", "i").test(String(fileName));
      });
      if (hinted.length === 1) return { entity: hinted[0].entity, byName: true };
      return { ambiguous: tied.map(function (x) { return x.entity; }) };
    }
    return { entity: best.entity, byName: false };
  }

  // What the file picker calls: work out what it is, then read it.
  function analyseFile(state, text, fileName) {
    var grid = parseRows(text);
    if (!grid.length) {
      return { ok: false, fatal: "That file has no rows in it." };
    }
    var found = detectEntity(grid[0], fileName);
    if (!found.entity) {
      return {
        ok: false,
        fatal: found.ambiguous && found.ambiguous.length
          ? "That file's columns could be " + found.ambiguous.join(" or ") +
            ". Export one of them again and edit that file, so the columns say which it is."
          : "That file's columns do not match any Wealth Master export."
      };
    }
    var out = analyse(state, found.entity, text);
    out.fileName = fileName || "";
    out.detectedByName = !!found.byName;
    return out;
  }

  // ---- writing ------------------------------------------------------------

  // Applies the included rows. Everything else in state is untouched — including rows the
  // file left out, which is the whole safety story above.
  function apply(state, analysis, deviceId) {
    var made = { new: 0, updated: 0, deleted: 0, skipped: 0, entity: analysis.entity };

    analysis.rows.forEach(function (row) {
      if (!row.include || row.problems.length) { made.skipped++; return; }

      var rec = {};
      for (var k in row.record) rec[k] = row.record[k];
      // updatedAt and deviceId describe this write, not the one the file remembers. A
      // hand edit made today must not carry the timestamp of the export.
      delete rec.updatedAt;
      delete rec.deviceId;

      var existed = rec.id && ent.byId(state[analysis.entity], rec.id);
      // upsert mints an id when there is none and pushes; an id that is in the file but
      // not in state is kept, so a file exported before a wipe restores as itself.
      ent.upsert(state, analysis.entity, rec, deviceId);

      if (row.action === "delete") made.deleted++;
      else if (existed) made.updated++;
      else made.new++;
    });

    return made;
  }

  return {
    parseCsvRows: parseRows,
    unguardCell: unguard,
    coerceCell: coerce,
    analyseCsvEntity: analyse,
    analyseCsvFile: analyseFile,
    detectCsvEntity: detectEntity,
    applyCsvEntity: apply,
    CSV_FIELD_TYPES: FIELD_TYPES,
    CSV_REFERENCES: REFERENCES
  };
});
