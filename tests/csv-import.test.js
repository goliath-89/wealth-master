"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

// FR-7.7, the half that was missing: reading back a file csv.js wrote.

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();

  var inst = l.schema.newInstitution("dev-1");
  inst.id = "i1"; inst.name = "Maybank"; inst.type = "Bank"; inst.pidmMember = true;
  s.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.id = "a1"; acct.institutionId = "i1"; acct.name = "Savings";
  acct.class = "cash"; acct.currency = "MYR";
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.id = "h1"; h.accountId = "a1"; h.name = "KDI Save"; h.rate = 4; h.feePct = 0.5;
  s.holdings.push(h);

  return { l: l, ci: l.csvImport, state: s, inst: inst, acct: acct, h: h };
}

function analyse(f, entity, text) { return f.ci.analyseCsvEntity(f.state, entity, text); }
function apply(f, a) { return f.ci.applyCsvEntity(f.state, a, "dev-2"); }

// --- the round trip ---------------------------------------------------------

test("a file exported and imported unchanged proposes nothing", function () {
  var f = setup();
  var a = analyse(f, "holdings", f.l.csv.entityToCsv(f.state, "holdings"));

  assert.equal(a.ok, true);
  assert.equal(a.counts.unchanged, 1);
  assert.equal(a.counts.update, 0);
  assert.equal(a.rows[0].include, false, "re-importing an untouched export must be a no-op");
});

test("a name Excel would read as a formula survives the round trip intact", function () {
  var f = setup();
  f.state.holdings[0].name = "-Cash reserve";
  var text = f.l.csv.entityToCsv(f.state, "holdings");
  assert.match(text, /'-Cash reserve/, "the export guards it");

  var a = analyse(f, "holdings", text);
  assert.equal(a.rows[0].record.name, "-Cash reserve",
    "the apostrophe is the guard, not part of the name");
  assert.equal(a.counts.unchanged, 1, "a guarded name must not read as an edit");
});

test("every entity's own export reads back as unchanged", function () {
  var f = setup();
  f.l.valuations.upsertValuation(f.state,
    { holdingId: "h1", period: "2026-03", balance: 1000, income: 12.5 }, "dev-1");
  var asset = f.l.schema.newAsset("dev-1");
  asset.id = "as1"; asset.name = "Car"; asset.cost = 90000;
  f.state.assets.push(asset);

  ["institutions", "accounts", "holdings", "valuations", "assets"].forEach(function (e) {
    var a = analyse(f, e, f.l.csv.entityToCsv(f.state, e));
    assert.equal(a.ok, true, e + " must read back");
    assert.equal(a.counts.problems, 0, e + " round trip reported: " +
      JSON.stringify(a.rows.map(function (r) { return r.problems; })));
    assert.equal(a.counts.update + a.counts.new, 0, e + " round trip proposed a change");
  });
});

// --- a missing row is not a delete ------------------------------------------

test("a file holding one row of three changes that row and leaves the others", function () {
  var f = setup();
  var h2 = f.l.schema.newHolding("dev-1");
  h2.id = "h2"; h2.accountId = "a1"; h2.name = "FD";
  f.state.holdings.push(h2);
  var h3 = f.l.schema.newHolding("dev-1");
  h3.id = "h3"; h3.accountId = "a1"; h3.name = "ASB";
  f.state.holdings.push(h3);

  var a = analyse(f, "holdings",
    "id,accountId,name\r\nh2,a1,Fixed deposit");
  assert.equal(a.rows.length, 1);
  apply(f, a);

  // The two the file did not mention are untouched — not tombstoned, not altered. This
  // is the accident the whole design is built to prevent.
  assert.equal(f.l.entities.byId(f.state.holdings, "h2").name, "Fixed deposit");
  assert.equal(f.l.entities.byId(f.state.holdings, "h1").deleted, false);
  assert.equal(f.l.entities.byId(f.state.holdings, "h3").deleted, false);
  assert.equal(f.state.holdings.length, 3);
});

test("a row is removed only by saying so in the deleted column", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name,deleted\r\nh1,KDI Save,true");
  assert.equal(a.rows[0].action, "delete");
  apply(f, a);
  assert.equal(f.l.entities.byId(f.state.holdings, "h1").deleted, true);
});

// --- blank is not zero ------------------------------------------------------

test("an emptied figure clears the entry rather than recording a nought", function () {
  var f = setup();
  f.l.valuations.upsertValuation(f.state,
    { holdingId: "h1", period: "2026-03", balance: 1000, income: 40 }, "dev-1");
  var v = f.state.valuations[0];

  var a = analyse(f, "valuations",
    "id,holdingId,period,balance,income\r\n" + v.id + ",h1,2026-03,1000,");
  apply(f, a);

  assert.equal(f.state.valuations[0].balance, 1000);
  assert.equal(f.state.valuations[0].income, null, "blank means not recorded, never RM 0");
});

test("a typed zero is a real zero", function () {
  var f = setup();
  f.l.valuations.upsertValuation(f.state,
    { holdingId: "h1", period: "2026-03", balance: 1000 }, "dev-1");
  var v = f.state.valuations[0];

  var a = analyse(f, "valuations",
    "id,holdingId,period,balance,income\r\n" + v.id + ",h1,2026-03,1000,0");
  apply(f, a);
  assert.equal(f.state.valuations[0].income, 0);
});

test("a column the file leaves out keeps what is stored", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name\r\nh1,Renamed");
  apply(f, a);

  var h = f.l.entities.byId(f.state.holdings, "h1");
  assert.equal(h.name, "Renamed");
  assert.equal(h.rate, 4, "a column not in the file is not a blank cell");
  assert.equal(h.feePct, 0.5);
  assert.equal(h.accountId, "a1");
});

// --- figures as spreadsheets write them -------------------------------------

test("a figure formatted by Excel is read, not refused", function () {
  var f = setup();
  var a = analyse(f, "valuations",
    'id,holdingId,period,balance\r\n,h1,2026-03,"RM 1,234.56"');
  assert.deepEqual(a.rows[0].problems, []);
  assert.equal(a.rows[0].record.balance, 1234.56);
});

test("a figure in brackets is negative, as a spreadsheet means it", function () {
  var f = setup();
  var a = analyse(f, "valuations",
    'id,holdingId,period,balance\r\n,h1,2026-03,"(500.00)"');
  assert.equal(a.rows[0].record.balance, -500);
});

test("a month Excel turned into a date is still that month", function () {
  var f = setup();
  var a = analyse(f, "valuations", "id,holdingId,period,balance\r\n,h1,2026-03-01,900");
  assert.deepEqual(a.rows[0].problems, []);
  assert.equal(a.rows[0].record.period, "2026-03");
});

test("true and false are accepted however the sheet spells them", function () {
  var f = setup();
  ["TRUE", "true", "Yes", "1"].forEach(function (yes) {
    var a = analyse(f, "accounts", "id,name,institutionId,currency,shariah\r\na1,Savings,i1,MYR," + yes);
    assert.equal(a.rows[0].record.shariah, true, yes);
  });
  ["FALSE", "no", "0", ""].forEach(function (no) {
    var a = analyse(f, "accounts", "id,name,institutionId,currency,shariah\r\na1,Savings,i1,MYR," + no);
    assert.equal(a.rows[0].record.shariah, false, JSON.stringify(no));
  });
});

// --- what is refused --------------------------------------------------------

test("a file with no id column is refused outright", function () {
  var f = setup();
  var a = analyse(f, "holdings", "name,rate\r\nKDI Save,4");
  assert.equal(a.ok, false);
  assert.match(a.fatal, /no id column/);
});

test("a row naming a parent that is not there is a problem, not an orphan", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,accountId,name\r\n,a-nope,New fund");
  assert.equal(a.rows[0].include, false);
  assert.match(a.rows[0].problems.join(" "), /accountId a-nope is not in your data/);

  apply(f, a);
  assert.equal(f.state.holdings.length, 1, "an orphan must not be written");
});

test("text where a figure belongs is named, and the rest of the file still imports", function () {
  var f = setup();
  var a = analyse(f, "valuations",
    "id,holdingId,period,balance\r\n,h1,2026-03,about four thousand\r\n,h1,2026-04,4200");

  assert.equal(a.counts.problems, 1);
  assert.match(a.rows[0].problems[0], /balance: "about four thousand" is not a number/);
  assert.equal(a.rows[0].line, 2, "the line number is the one Excel shows");
  assert.equal(a.rows[1].include, true);

  var made = apply(f, a);
  assert.equal(made.new, 1);
  assert.equal(made.skipped, 1);
  assert.equal(f.state.valuations.length, 1);
});

test("the same id twice in one file is caught before either is written", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name\r\nh1,First\r\nh1,Second");
  assert.equal(a.rows[1].include, false);
  assert.match(a.rows[1].problems.join(" "), /appears twice in this file \(line 2\)/);
});

test("a valuation about nothing, or about two things, is refused", function () {
  var f = setup();
  var none = analyse(f, "valuations", "id,period,balance\r\n,2026-03,100");
  assert.match(none.rows[0].problems.join(" "), /nothing this figure is about/);

  f.state.assets.push(Object.assign(f.l.schema.newAsset("dev-1"), { id: "as1", name: "Car" }));
  var both = analyse(f, "valuations",
    "id,holdingId,assetId,period,balance\r\n,h1,as1,2026-03,100");
  assert.match(both.rows[0].problems.join(" "), /More than one of/);
});

test("an account left without a name is refused, using the rules the dialog uses", function () {
  var f = setup();
  var a = analyse(f, "accounts", "id,name\r\na1,");
  assert.match(a.rows[0].problems.join(" "), /Name is required/);
});

test("a currency that is not a three-letter code is refused", function () {
  var f = setup();
  var a = analyse(f, "accounts", "id,currency\r\na1,Ringgit");
  assert.match(a.rows[0].problems.join(" "), /3-letter code/);
});

// --- what the review table needs --------------------------------------------

test("each row says what it would change, field by field", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name,rate\r\nh1,KDI Save,4.25");

  assert.equal(a.rows[0].action, "update");
  assert.deepEqual(a.rows[0].changes, [{ field: "rate", from: 4, to: 4.25 }]);
});

test("a column the app does not know is reported rather than silently ignored", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name,my notes\r\nh1,KDI Save,check this");
  assert.deepEqual(a.unknownColumns, ["my notes"]);
  assert.equal(a.ok, true, "an extra column is a remark, not a refusal");
});

test("an empty file is refused with a reason", function () {
  var f = setup();
  assert.match(analyse(f, "holdings", "").fatal, /no rows/);
  assert.match(analyse(f, "holdings", "\r\n\r\n").fatal, /no rows/);
});

test("blank lines between rows are skipped, not read as records", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name\r\nh1,KDI\r\n\r\n,,\r\n,New one\r\n");
  assert.equal(a.rows.length, 2);
});

// --- writing ----------------------------------------------------------------

test("an import is stamped with this device and this moment, not the file's", function () {
  var f = setup();
  var before = f.state.holdings[0].updatedAt;
  var a = analyse(f, "holdings",
    "id,name,updatedAt,deviceId\r\nh1,Renamed,2001-01-01T00:00:00Z,old-device");
  apply(f, a);

  var h = f.l.entities.byId(f.state.holdings, "h1");
  assert.equal(h.deviceId, "dev-2", "the import wrote it, so the import owns the stamp");
  assert.notEqual(h.updatedAt, "2001-01-01T00:00:00Z");
  assert.ok(h.updatedAt >= before);
});

test("a row excluded by the owner is not written", function () {
  var f = setup();
  var a = analyse(f, "holdings", "id,name\r\nh1,Renamed");
  a.rows[0].include = false;
  var made = apply(f, a);

  assert.equal(made.skipped, 1);
  assert.equal(f.l.entities.byId(f.state.holdings, "h1").name, "KDI Save");
});

test("an id in the file but not in the data is kept, so a wiped file restores as itself", function () {
  var f = setup();
  var a = analyse(f, "institutions", "id,name,type\r\ni-gone,Public Bank,Bank");
  apply(f, a);

  assert.ok(f.l.entities.byId(f.state.institutions, "i-gone"), "the id is the record's identity");
  assert.equal(f.l.entities.byId(f.state.institutions, "i-gone").name, "Public Bank");
});

test("a new row with no id gets one", function () {
  var f = setup();
  var a = analyse(f, "institutions", "id,name,type\r\n,Public Bank,Bank");
  apply(f, a);

  var made = f.state.institutions.filter(function (i) { return i.name === "Public Bank"; })[0];
  assert.ok(made.id, "a record without an id cannot be edited again");
  assert.equal(f.state.institutions.length, 2);
});
