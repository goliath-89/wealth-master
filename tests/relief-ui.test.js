"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var year = String(new Date().getFullYear());

  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Provider";
  s.institutions.push(inst);
  var acct = l.schema.newAccount("dev-1");
  acct.institutionId = inst.id;
  acct.name = "Retirement";
  acct.class = "retirement";
  s.accounts.push(acct);

  var h = l.schema.newHolding("dev-1");
  h.accountId = acct.id;
  h.name = "PRS fund";
  h.reliefCategory = opts.category === undefined ? "prs" : opts.category;
  s.holdings.push(h);

  if (opts.contribution !== undefined) {
    l.valuations.upsertValuation(s, {
      holdingId: h.id, period: year + "-03", balance: 20000,
      contribution: opts.contribution, withdrawal: opts.withdrawal
    }, "dev-1");
  }

  return { l: l, state: s, h: h, acct: acct, year: year };
}

function taxTab(doc) { doc.querySelector('.tab[data-v="tax"]').click(); }
function saved(app) {
  return JSON.parse(app.window.localStorage.getItem("wealthmaster.state"));
}

test("tagged contributions are summed for the year with the claimable figure", function () {
  var f = seeded({ contribution: 2000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  taxTab(doc);

  var text = doc.getElementById("reliefList").textContent;
  assert.match(text, /PRS \(private retirement\)/);
  assert.match(text, /RM 2,000\.00 paid in/);
  assert.match(text, /RM 1,000\.00 headroom/);
  assert.match(text, /Total to claim/);
  assert.deepEqual(app.consoleErrors, []);
});

test("a contribution above the limit is capped and the excess explained", function () {
  var f = seeded({ contribution: 5000 });
  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);

  var text = doc.getElementById("reliefList").textContent;
  assert.match(text, /RM 5,000\.00 paid in/);
  assert.match(text, /RM 3,000\.00/, "capped at the limit");
  assert.match(text, /sits above the limits set below/);
});

test("withdrawals are netted off in the display", function () {
  var f = seeded({ contribution: 8000, withdrawal: 3000 });
  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);
  assert.match(doc.getElementById("reliefList").textContent, /less RM 3,000\.00 withdrawn/);
});

test("the tab states plainly that this is contributions, not tax", function () {
  var f = seeded({ contribution: 2000 });
  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);
  var view = doc.getElementById("v-tax").textContent;
  // NG5: surfacing totals is in scope, filing is not — and limits move between years.
  assert.match(view, /Contributions, not tax/);
  assert.match(view, /does not work out your tax/);
  assert.match(view, /confirm every figure against LHDN/);
});

test("an untagged holding contributes nothing to the tax view", function () {
  var f = seeded({ category: null, contribution: 9000 });
  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);
  assert.match(doc.getElementById("reliefList").textContent, /Nothing tagged for/);
});

test("a holding can be tagged from its own form and shows up immediately", function () {
  var f = seeded({ category: null, contribution: 2000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;

  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-hold="' + f.h.id + '"]').click();
  doc.getElementById("h_relief").value = "prs";
  doc.getElementById("holdSave").click();

  assert.equal(saved(app).holdings[0].reliefCategory, "prs");
  taxTab(doc);
  assert.match(doc.getElementById("reliefList").textContent, /RM 2,000\.00 paid in/);
});

test("the relief dropdown offers every category plus not-eligible", function () {
  var f = seeded({ contribution: 1000 });
  var doc = helpers.loadApp(f.state).window.document;
  doc.querySelector('.tab[data-v="accounts"]').click();
  doc.querySelector('[data-edit-hold="' + f.h.id + '"]').click();

  var opts = doc.getElementById("h_relief").options;
  assert.equal(opts[0].value, "", "not eligible is the safe default");
  assert.ok(opts.length >= 6);
});

test("limits can be edited and take effect immediately", function () {
  var f = seeded({ contribution: 5000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  taxTab(doc);

  // Capped at RM 3,000 by default.
  assert.match(doc.getElementById("reliefList").textContent, /sits above the limits/);

  doc.getElementById("lim_prs").value = "6000";
  doc.getElementById("saveLimitsBtn").click();

  assert.equal(saved(app).settings.reliefLimits.prs, 6000);
  assert.equal(/sits above the limits/.test(doc.getElementById("reliefList").textContent), false);
});

test("a non-numeric limit is refused", function () {
  var f = seeded({ contribution: 2000 });
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  taxTab(doc);

  doc.getElementById("lim_prs").value = "3O00";
  doc.getElementById("saveLimitsBtn").click();
  assert.ok(!saved(app).settings.reliefLimits, "nothing stored on a rejected edit");
});

test("the year selector lists years that actually have contributions", function () {
  var f = seeded({ contribution: 2000 });
  f.l.valuations.upsertValuation(f.state, {
    holdingId: f.h.id, period: "2024-05", balance: 10000, contribution: 1500
  }, "dev-1");

  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);
  var years = Array.prototype.map.call(doc.getElementById("taxYear").options, function (o) { return o.value; });
  assert.ok(years.indexOf("2024") !== -1);
  assert.ok(years.indexOf(f.year) !== -1);
  assert.equal(years[0], f.year, "newest first");
});

test("switching year changes the totals shown", function () {
  var f = seeded({ contribution: 2000 });
  f.l.valuations.upsertValuation(f.state, {
    holdingId: f.h.id, period: "2024-05", balance: 10000, contribution: 1500
  }, "dev-1");

  var doc = helpers.loadApp(f.state).window.document;
  taxTab(doc);
  doc.getElementById("taxYear").value = "2024";
  doc.getElementById("taxYear").onchange();
  assert.match(doc.getElementById("reliefList").textContent, /RM 1,500\.00 paid in/);
});
