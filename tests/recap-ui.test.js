"use strict";
// The Recap screen: the decomposition as rendered.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function fixture() {
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var inst = l.schema.newInstitution("dev-1");
  inst.name = "Maybank";
  s.institutions.push(inst);
  function holding(name, cls) {
    var a = l.schema.newAccount("dev-1");
    a.institutionId = inst.id;
    a.name = name;
    a.class = cls || "cash";
    s.accounts.push(a);
    var h = l.schema.newHolding("dev-1");
    h.accountId = a.id;
    h.name = name;
    s.holdings.push(h);
    return h;
  }
  return { l: l, state: s, holding: holding };
}

function record(f, entry) { f.l.valuations.upsertValuation(f.state, entry, "dev-1"); }
function period(f, back) {
  var p = f.l.valuations.currentPeriod();
  for (var i = 0; i < (back || 0); i++) p = f.l.valuations.prevPeriod(p);
  return p;
}
function recapTab(doc) { doc.querySelector('.tab[data-v="recap"]').click(); }

// Twelve months of saving, with one clear contribution rate and some market movement.
function saver() {
  var f = fixture();
  var h = f.holding("ASB", "investment");
  for (var i = 12; i >= 0; i--) {
    record(f, {
      holdingId: h.id, period: period(f, i),
      balance: 100000 + (12 - i) * 3000,
      contribution: i === 12 ? null : 2000
    });
  }
  return f;
}

test("Recap has its own screen in the navigation", function () {
  var doc = helpers.loadApp().window.document;
  var tab = doc.querySelector('.tab[data-v="recap"]');
  assert.ok(tab, "a tab");
  assert.ok(doc.getElementById("v-recap"), "and a view");
  tab.click();
  assert.ok(doc.getElementById("v-recap").classList.contains("on"));
});

test("with nothing recorded it invites the first months instead of comparing zeroes", function () {
  var app = helpers.loadApp();
  var doc = app.window.document;
  recapTab(doc);
  assert.match(doc.getElementById("recapSummary").textContent, /Nothing to compare yet/);
  assert.equal(doc.getElementById("recapParts").innerHTML, "");
  assert.deepEqual(app.consoleErrors, []);
});

test("it opens on the last twelve months and says which they are", function () {
  var f = saver();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  recapTab(doc);

  assert.equal(doc.getElementById("recapFrom").value, period(f, 12));
  assert.equal(doc.getElementById("recapTo").value, period(f, 0));
  var summary = doc.getElementById("recapSummary").textContent;
  assert.match(summary, /12 months/);
  assert.match(summary, /\+RM 36,000/, "the change over the window");
  assert.match(summary, /RM 100,000\.00 → RM 136,000\.00/);
});

test("the parts are named, measured and add up on screen", function () {
  var doc = helpers.loadApp(saver().state).window.document;
  recapTab(doc);
  var parts = doc.getElementById("recapParts").textContent;
  assert.match(parts, /Contributions/);
  assert.match(parts, /\+RM 24,000/, "twelve months at 2,000");
  assert.match(parts, /Market movement/);
  assert.match(parts, /residual/, "and it is labelled as one, not as growth");
  assert.match(parts, /\+RM 12,000/);
  assert.match(parts, /Change in net worth/);
  assert.match(parts, /\+RM 36,000/);
});

test("a loss is drawn and coloured as a loss", function () {
  var f = fixture();
  var h = f.holding("Equities", "investment");
  record(f, { holdingId: h.id, period: period(f, 2), balance: 50000 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 44000 });

  var doc = helpers.loadApp(f.state).window.document;
  recapTab(doc);
  assert.ok(doc.querySelector("#recapParts .rrow-v.dn"));
  assert.ok(doc.querySelector("#recapParts .rbar-f.dn"));
  assert.match(doc.getElementById("recapSummary").textContent, /−RM 6,000/);
});

test("line by line names what moved, biggest first, and why", function () {
  var f = fixture();
  var small = f.holding("Savings");
  var big = f.holding("ASB", "investment");
  record(f, { holdingId: small.id, period: period(f, 1), balance: 10000 });
  record(f, { holdingId: big.id, period: period(f, 1), balance: 60000 });
  record(f, { holdingId: small.id, period: period(f, 0), balance: 10500, contribution: 500 });
  record(f, { holdingId: big.id, period: period(f, 0), balance: 66000, income: 1000 });

  var doc = helpers.loadApp(f.state).window.document;
  recapTab(doc);
  var rows = doc.querySelectorAll("#recapLines .wline");
  assert.equal(rows[0].textContent.indexOf("ASB"), 0, "the larger move leads");
  assert.match(rows[0].textContent, /earned RM 1,000/);
  assert.match(rows[0].textContent, /market \+RM 5,000/);
  assert.match(rows[1].textContent, /in RM 500/);
});

test("changing either month recomputes the comparison", function () {
  var f = saver();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  recapTab(doc);

  var from = doc.getElementById("recapFrom");
  from.value = period(f, 1);
  from.dispatchEvent(new app.window.Event("change"));

  var summary = doc.getElementById("recapSummary").textContent;
  assert.match(summary, /1 month/);
  assert.match(summary, /\+RM 3,000/);
});

test("months the wrong way round are refused, not guessed at", function () {
  var f = saver();
  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  recapTab(doc);

  var to = doc.getElementById("recapTo");
  to.value = period(f, 13);
  to.dispatchEvent(new app.window.Event("change"));
  assert.match(doc.getElementById("recapSummary").textContent, /earliest first/);
  assert.equal(doc.getElementById("recapParts").innerHTML, "");
});

test("a comparison resting on carried figures says so", function () {
  var f = fixture();
  var h = f.holding("EPF", "retirement");
  record(f, { holdingId: h.id, period: period(f, 6), balance: 90000 });
  record(f, { holdingId: h.id, period: period(f, 5), balance: 92000 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  recapTab(doc);
  // It opens on the last recorded months, where nothing is carried. Ask instead for a
  // window running up to this month, which has no entry of its own.
  var to = doc.getElementById("recapTo");
  to.value = period(f, 0);
  to.dispatchEvent(new app.window.Event("change"));

  var summary = doc.getElementById("recapSummary").textContent;
  assert.match(summary, /carried\s+forward/);
  assert.ok(doc.querySelector("#recapSummary .stale-mark"));
});

test("the screen says plainly what market movement is", function () {
  var doc = helpers.loadApp(saver().state).window.document;
  recapTab(doc);
  var note = doc.querySelector("#v-recap details.warnbox");
  assert.match(note.querySelector("summary").textContent, /do not explain/);
  assert.match(note.textContent, /never recorded/);
});

test("a name typed into a holding cannot inject markup through the recap (SEC-7)", function () {
  var f = fixture();
  var h = f.holding("<img src=x onerror=alert(1)>");
  record(f, { holdingId: h.id, period: period(f, 1), balance: 100 });
  record(f, { holdingId: h.id, period: period(f, 0), balance: 200 });

  var app = helpers.loadApp(f.state);
  var doc = app.window.document;
  recapTab(doc);
  assert.equal(doc.querySelectorAll("#recapLines img").length, 0);
  assert.deepEqual(app.consoleErrors, []);
});
