"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function setup() {
  var l = helpers.loadLib(helpers.freshWindow());
  var state = l.schema.blank();
  var e = l.entities;

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  inst.pidmMember = true;
  state.institutions.push(inst);

  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Savings";
  state.accounts.push(acct);

  var hold = l.schema.newHolding("dev-1");
  hold.accountId = acct.id;
  hold.name = "MMF";
  state.holdings.push(hold);

  return { l: l, e: e, state: state, inst: inst, acct: acct, hold: hold };
}

test("live() excludes tombstones but keeps archived records", function () {
  var s = setup();
  s.acct.archived = true;
  assert.equal(s.e.live(s.state.accounts).length, 1, "archived is still live");
  assert.equal(s.e.active(s.state.accounts).length, 0, "but not active");
  s.acct.deleted = true;
  assert.equal(s.e.live(s.state.accounts).length, 0);
});

test("deleting an institution that still has accounts is refused, not cascaded", function () {
  var s = setup();
  var res = s.e.canDelete(s.state, "institutions", s.inst.id);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "has-dependents");
  assert.equal(res.dependents.accounts, 1);
});

test("deleting becomes allowed once the dependent is tombstoned", function () {
  var s = setup();
  s.acct.deleted = true;
  assert.equal(s.e.canDelete(s.state, "institutions", s.inst.id).ok, true);
});

test("an account with holdings is protected, and a holding with valuations too", function () {
  var s = setup();
  assert.equal(s.e.canDelete(s.state, "accounts", s.acct.id).ok, false);

  var v = s.l.schema.newValuation("dev-1");
  v.holdingId = s.hold.id;
  s.state.valuations.push(v);
  var res = s.e.canDelete(s.state, "holdings", s.hold.id);
  assert.equal(res.ok, false);
  assert.equal(res.dependents.valuations, 1);
});

test("upsert creates with a stamp, then updates in place without duplicating", function () {
  var s = setup();
  var created = s.e.upsert(s.state, "institutions", { name: "CIMB" }, "dev-2");
  assert.equal(s.state.institutions.length, 2);
  assert.ok(created.id);
  assert.equal(created.deviceId, "dev-2");
  assert.equal(created.deleted, false);

  var before = s.state.institutions.length;
  s.e.upsert(s.state, "institutions", { id: created.id, name: "CIMB Bank" }, "dev-3");
  assert.equal(s.state.institutions.length, before, "must update, not append");
  assert.equal(s.e.byId(s.state.institutions, created.id).name, "CIMB Bank");
  assert.equal(s.e.byId(s.state.institutions, created.id).deviceId, "dev-3");
});

test("upsert never lets a caller overwrite the id", function () {
  var s = setup();
  s.e.upsert(s.state, "institutions", { id: s.inst.id, name: "Renamed" }, "dev-1");
  assert.ok(s.e.byId(s.state.institutions, s.inst.id), "original id still resolves");
  assert.equal(s.state.institutions.length, 1);
});

test("archiving keeps history and is reversible", function () {
  var s = setup();
  s.e.setArchived(s.state, "accounts", s.acct.id, true, "dev-2");
  assert.equal(s.e.byId(s.state.accounts, s.acct.id).archived, true);
  assert.equal(s.e.holdingsFor(s.state, s.acct.id).length, 1, "holdings survive archiving");
  s.e.setArchived(s.state, "accounts", s.acct.id, false, "dev-2");
  assert.equal(s.e.byId(s.state.accounts, s.acct.id).archived, false);
});

test("validation requires a name on every entity", function () {
  var s = setup();
  assert.ok(s.e.validate("institutions", { name: "   " }, s.state).indexOf("Name is required") >= 0);
});

test("an account must reference an institution that actually exists", function () {
  var s = setup();
  var errs = s.e.validate("accounts", { name: "X", institutionId: "ghost", currency: "MYR" }, s.state);
  assert.ok(errs.indexOf("Pick an institution") >= 0);
});

test("currency must be a three-letter code", function () {
  var s = setup();
  var base = { name: "X", institutionId: s.inst.id };
  assert.ok(s.e.validate("accounts", Object.assign({}, base, { currency: "Ringgit" }), s.state).length > 0);
  assert.equal(s.e.validate("accounts", Object.assign({}, base, { currency: "myr" }), s.state).length, 0);
});

test("holding rates reject non-numbers and negatives, but allow zero", function () {
  var s = setup();
  var base = { name: "X", accountId: s.acct.id, rate: 0, feePct: 0, salesPct: 0 };
  assert.equal(s.e.validate("holdings", base, s.state).length, 0, "zero is valid");

  var bad = s.e.validate("holdings", Object.assign({}, base, { rate: "abc" }), s.state);
  assert.ok(bad.some(function (m) { return /Rate must be a number/.test(m); }));

  var neg = s.e.validate("holdings", Object.assign({}, base, { feePct: -1 }), s.state);
  assert.ok(neg.some(function (m) { return /Fee cannot be negative/.test(m); }));
});

test("an empty numeric field is treated as zero, not as invalid", function () {
  var s = setup();
  var errs = s.e.validate("holdings",
    { name: "X", accountId: s.acct.id, rate: "", feePct: "", salesPct: "" }, s.state);
  assert.equal(errs.length, 0);
});
