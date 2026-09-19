"use strict";
// P7.4: a card opens the lines behind it — a list you can edit in place, and charts of just
// those lines.
var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("./helpers.js");

function seeded(opts) {
  opts = opts || {};
  var l = helpers.loadLib(helpers.freshWindow());
  var s = l.schema.blank();
  var now = l.valuations.currentPeriod(), prev = l.valuations.prevPeriod(now);
  var maybank = l.schema.newInstitution("d"); maybank.name = opts.instName || "Maybank"; s.institutions.push(maybank);
  var kwsp = l.schema.newInstitution("d"); kwsp.name = "EPF"; s.institutions.push(kwsp);
  var ids = {};
  function holding(key, name, cls, inst, o) {
    var a = l.schema.newAccount("d");
    a.institutionId = inst.id; a.name = name; a.class = cls; a.liquid = o.liquid !== false;
    s.accounts.push(a);
    var h = l.schema.newHolding("d");
    h.accountId = a.id; h.name = name; h.instrumentType = o.type || "";
    s.holdings.push(h); ids[key] = h.id;
    o.history.forEach(function (p) { l.valuations.upsertValuation(s, { holdingId: h.id, period: p[0], balance: p[1] }, "d"); });
  }
  holding("savings", "Savings", "cash", maybank, { type: "savings", history: [[prev, 5000], [now, 6000]] });
  holding("fd", "Fixed deposit", "cash", maybank, { type: "fixed deposit", liquid: false, history: [[prev, 2000], [now, 2000]] });
  holding("epf", "EPF i-Akaun", "retirement", kwsp, { type: "EPF", history: [[prev, 11000], [now, 12000]] });
  holding("asb", "ASB", "investment", maybank, { type: "unit trust", history: [[prev, 8500], [now, 9000]] });

  var loan = l.schema.newLiability("d");
  loan.name = "Car loan"; loan.type = "personal loan"; loan.rateBasis = "reducing";
  loan.principal = 60000; loan.ratePct = 4; loan.tenureMonths = 60; loan.instalment = 1104.99;
  s.liabilities.push(loan); ids.loan = loan.id;
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: prev, balance: 19000 }, "d");
  l.valuations.upsertValuation(s, { liabilityId: loan.id, period: now, balance: 18000 }, "d");
  return { state: s, ids: ids, now: now };
}

function load(opts) {
  var f = seeded(opts);
  var app = helpers.loadApp(f.state);
  return { f: f, app: app, win: app.window, doc: app.window.document };
}

function open(c, scope) {
  var a = c.doc.querySelector('[data-detail="' + scope + '"]');
  assert.ok(a, "a card links to " + scope);
  a.dispatchEvent(new c.win.MouseEvent("click", { bubbles: true, cancelable: true }));
}
function text(c, id) { return c.doc.getElementById(id).textContent; }
function rowNames(c) {
  return Array.prototype.map.call(c.doc.querySelectorAll("#detailList .srow .srow-t"), function (b) { return b.textContent; });
}
function edit(c, id, value) {
  var cell = c.doc.getElementById("dcell_" + id);
  assert.ok(cell, "an editable cell for " + id);
  cell.value = value;
  cell.dispatchEvent(new c.win.FocusEvent("blur"));
}

test("the cards are real links to the lines behind them", function () {
  var c = load();
  var scopes = Array.prototype.map.call(c.doc.querySelectorAll("#worthKpis [data-detail], #catStrip [data-detail]"),
    function (a) { return a.getAttribute("data-detail"); });
  ["net", "investable", "assets", "liabilities", "liquid", "freeCash", "investments", "retirement", "useAssets"]
    .forEach(function (k) { assert.ok(scopes.indexOf(k) >= 0, "a card opens " + k); });
  var a = c.doc.querySelector('#worthKpis [data-detail="assets"]');
  assert.equal(a.tagName, "A");
  assert.equal(a.getAttribute("href"), "#/detail/assets", "so it can be opened in a new tab");
  assert.deepEqual(c.app.consoleErrors, []);
});

test("clicking a card opens the drill-down and leaves the navigation where it was", function () {
  var c = load();
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), false);
  open(c, "assets");
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), true);
  assert.equal(c.doc.getElementById("v-worth").classList.contains("on"), false);
  assert.equal(c.doc.querySelector('.tab[data-v="worth"]').classList.contains("on"), true);
  assert.equal(c.win.location.hash, "#/detail/assets");
  assert.deepEqual(c.app.consoleErrors, []);
});

test("the heading shows the same figure as the card that opened it", function () {
  var c = load();
  var card = c.doc.querySelector('#worthKpis [data-detail="assets"] .v').textContent;
  open(c, "assets");
  assert.match(text(c, "detailHead"), /Assets/);
  assert.ok(text(c, "detailHead").indexOf(card) >= 0, card + " in " + text(c, "detailHead"));
  assert.match(text(c, "detailHead"), /since last month/);
  assert.match(text(c, "detailHead"), /4 lines/);
});

test("the list holds the lines in that scope, and only those", function () {
  var c = load();
  open(c, "retirement");
  assert.deepEqual(rowNames(c), ["EPF i-Akaun"]);
  open(c, "liabilities");
  assert.deepEqual(rowNames(c), ["Car loan"]);
  open(c, "assets");
  assert.deepEqual(rowNames(c).slice().sort(), ["ASB", "EPF i-Akaun", "Fixed deposit", "Savings"]);
});

test("a figure edited in the list is saved and the whole page follows", function () {
  var c = load();
  open(c, "assets");
  edit(c, c.f.ids.savings, "7000");
  assert.match(text(c, "detailHead"), /RM 30,000\.00/, "assets went from 29,000 by 1,000");
  var accounts = c.doc.getElementById("cell_" + c.f.ids.savings);
  assert.match(accounts.value, /7,000/, "the Accounts screen shows the same figure");
  assert.equal(accounts.value, c.doc.getElementById("dcell_" + c.f.ids.savings).value);
  assert.equal(c.doc.querySelector('#worthKpis [data-detail="assets"] .v').textContent, "RM 30,000.00");
  assert.deepEqual(c.app.consoleErrors, []);
});

test("editing does not leave the other figures of the month behind", function () {
  var c = load();
  open(c, "assets");
  edit(c, c.f.ids.asb, "9500");
  assert.match(text(c, "detailHead"), /RM 29,500\.00/);
  assert.match(c.doc.getElementById("dcell_" + c.f.ids.savings).value, /6,000/);
});

test("no id appears twice on a page that draws the same rows in two places", function () {
  var c = load();
  open(c, "assets");
  var seen = {}, dup = [];
  Array.prototype.forEach.call(c.doc.querySelectorAll("[id]"), function (n) {
    if (seen[n.id]) dup.push(n.id);
    seen[n.id] = true;
  });
  assert.deepEqual(dup, []);
});

test("clicking a slice filters the list, and the chip clears it", function () {
  var c = load();
  open(c, "assets");
  assert.equal(rowNames(c).length, 4);
  var slices = Array.prototype.slice.call(c.doc.querySelectorAll("#detailCatChart [data-slice]"));
  assert.ok(slices.length >= 3, "a slice per category");
  // The slice for Retirement.
  var idx = -1;
  Array.prototype.forEach.call(c.doc.querySelectorAll("#detailCatLegend [data-slice]"), function (r) {
    if (/Retirement/.test(r.textContent)) idx = r.getAttribute("data-slice");
  });
  c.doc.querySelector('#detailCatChart [data-slice="' + idx + '"]').dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(rowNames(c), ["EPF i-Akaun"]);
  assert.match(text(c, "detailChip"), /Category: Retirement/);
  assert.match(c.win.location.hash, /f=category~Retirement/, "the filter is in the address");
  c.doc.querySelector("#detailChip [data-clear-filter]").dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.equal(rowNames(c).length, 4);
  assert.equal(text(c, "detailChip"), "");
});

test("a legend row filters too, and by institution as well as category", function () {
  var c = load();
  open(c, "assets");
  var idx = -1;
  Array.prototype.forEach.call(c.doc.querySelectorAll("#detailDimLegend [data-slice]"), function (r) {
    if (/Maybank/.test(r.textContent)) idx = r.getAttribute("data-slice");
  });
  assert.notEqual(idx, -1, "the second donut is by institution");
  c.doc.querySelector('#detailDimLegend [data-slice="' + idx + '"]').dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(rowNames(c).slice().sort(), ["ASB", "Fixed deposit", "Savings"]);
  assert.match(text(c, "detailChip"), /Institution: Maybank/);
});

test("the second donut can be cut another way", function () {
  var c = load();
  open(c, "assets");
  var sel = c.doc.getElementById("detailDim");
  sel.value = "type";
  sel.dispatchEvent(new c.win.Event("change"));
  assert.match(text(c, "detailDimTitle"), /By type/);
  assert.match(text(c, "detailDimLegend"), /savings/);
});

test("the list can be filtered by name", function () {
  var c = load();
  open(c, "assets");
  var box = c.doc.getElementById("detailFilter");
  box.value = "sav";
  box.dispatchEvent(new c.win.Event("input"));
  assert.deepEqual(rowNames(c), ["Savings"]);
  box.value = "zzz";
  box.dispatchEvent(new c.win.Event("input"));
  assert.match(text(c, "detailList"), /No lines match/);
});

test("sorting by name and by value, and reversing on a second press", function () {
  var c = load();
  open(c, "assets");
  assert.equal(rowNames(c)[0], "EPF i-Akaun", "largest value first to begin with... within its group");
  function press(k) { c.doc.querySelector('#detailList [data-sort="' + k + '"]').dispatchEvent(new c.win.MouseEvent("click", { bubbles: true })); }
  c.doc.getElementById("detailGroup").value = "none";
  c.doc.getElementById("detailGroup").dispatchEvent(new c.win.Event("change"));
  press("name");
  assert.deepEqual(rowNames(c), ["ASB", "EPF i-Akaun", "Fixed deposit", "Savings"]);
  press("name");
  assert.deepEqual(rowNames(c), ["Savings", "Fixed deposit", "EPF i-Akaun", "ASB"]);
  press("value");
  assert.deepEqual(rowNames(c), ["EPF i-Akaun", "ASB", "Savings", "Fixed deposit"]);
});

test("lines are grouped, with a subtotal, and grouping can be turned off", function () {
  var c = load();
  open(c, "assets");
  var heads = Array.prototype.map.call(c.doc.querySelectorAll("#detailList .sheet-h .inst-n"), function (n) { return n.textContent; });
  assert.deepEqual(heads.slice().sort(), ["Free Cash", "Investments", "Retirement"]);
  assert.match(text(c, "detailList"), /RM 12,000\.00/);
  c.doc.getElementById("detailGroup").value = "none";
  c.doc.getElementById("detailGroup").dispatchEvent(new c.win.Event("change"));
  assert.equal(c.doc.querySelectorAll("#detailList .sheet-h").length, 0);
  assert.equal(rowNames(c).length, 4);
});

test("liabilities are grouped by type and the debt donut says what is owed", function () {
  var c = load();
  open(c, "liabilities");
  assert.equal(c.doc.getElementById("detailGroup").value, "type");
  assert.match(text(c, "detailCatTitle"), /By type/);
  assert.match(text(c, "detailDimTitle"), /By rate basis/);
  assert.match(text(c, "detailCatChart"), /owed/);
  assert.match(text(c, "detailHead"), /RM 18,000\.00/);
});

test("net worth lists debt in its own group, marked as a subtraction", function () {
  var c = load();
  open(c, "net");
  var liab = Array.prototype.filter.call(c.doc.querySelectorAll("#detailList .sheet"), function (s) {
    return /Liabilities/.test(s.querySelector(".sheet-h").textContent);
  })[0];
  assert.ok(liab);
  assert.match(liab.querySelector(".sheet-total").textContent, /^−RM 18,000\.00/);
  assert.match(text(c, "detailChartNote"), /Assets only/);
});

test("the biggest moves are listed, and a debt going down is a good move", function () {
  var c = load();
  open(c, "net");
  var movers = c.doc.querySelectorAll("#detailMoversList .mover");
  assert.ok(movers.length >= 3);
  assert.match(movers[0].textContent, /EPF i-Akaun|Car loan|Savings/);
  var car = Array.prototype.filter.call(movers, function (m) { return /Car loan/.test(m.textContent); })[0];
  assert.ok(car.querySelector(".mv-v.up"), "less debt reads as good");
  assert.match(car.querySelector(".mv-v").textContent, /▼ −RM 1,000\.00/, "with the arrow and sign as well as the colour");
});

test("the trend for the scope is drawn and can be read by month", function () {
  var c = load();
  open(c, "assets");
  var svg = c.doc.querySelector("#detailTrend svg.chart");
  assert.ok(svg);
  svg.dispatchEvent(new c.win.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  var tip = c.doc.querySelector("#detailTrend .hv-tip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Assets/);
  assert.match(tip.textContent, /Since last month/);
});

test("Back returns to where the card was", async function () {
  var c = load();
  open(c, "assets");
  var popped = new Promise(function (res) { c.win.addEventListener("popstate", res, { once: true }); });
  c.doc.getElementById("detailBack").click();
  await popped;
  assert.equal(c.doc.getElementById("v-worth").classList.contains("on"), true);
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), false);
  assert.equal(c.win.location.hash, "");
});

test("Back works on a bookmarked page too, where there is nothing to go back to", function () {
  var c = load();
  c.win.history.replaceState(null, "", "#/detail/assets");
  c.win.dispatchEvent(new c.win.Event("popstate"));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), true);
  c.doc.getElementById("detailBack").click();
  assert.equal(c.doc.getElementById("v-worth").classList.contains("on"), true);
  assert.equal(c.win.location.hash, "");
});

test("leaving by any tab clears the address", function () {
  var c = load();
  open(c, "assets");
  c.doc.querySelector('.tab[data-v="loans"]').click();
  assert.equal(c.win.location.hash, "");
  assert.equal(c.doc.getElementById("v-loans").classList.contains("on"), true);
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), false);
});

test("a bookmarked address opens the page directly", function () {
  var c = load();
  c.win.history.pushState(null, "", "#/detail/retirement");
  c.win.dispatchEvent(new c.win.Event("popstate"));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), true);
  assert.match(text(c, "detailHead"), /Retirement/);
  assert.deepEqual(rowNames(c), ["EPF i-Akaun"]);
});

test("a bookmarked filter is restored", function () {
  var c = load();
  c.win.history.pushState(null, "", "#/detail/assets?f=" + encodeURIComponent("institution~Maybank"));
  c.win.dispatchEvent(new c.win.Event("popstate"));
  assert.deepEqual(rowNames(c).slice().sort(), ["ASB", "Fixed deposit", "Savings"]);
  assert.match(text(c, "detailChip"), /Institution: Maybank/);
});

test("an address that matches nothing says so instead of showing a blank page", function () {
  var c = load();
  c.win.history.pushState(null, "", "#/detail/bogus");
  c.win.dispatchEvent(new c.win.Event("popstate"));
  assert.match(text(c, "detailHead"), /does not match anything/);
  assert.equal(c.doc.getElementById("detailBody").style.display, "none");
  assert.deepEqual(c.app.consoleErrors, []);
});

test("a malformed address is ignored rather than breaking the page", function () {
  var c = load();
  c.win.history.pushState(null, "", "#/detail/%E0%A4%A");
  c.win.dispatchEvent(new c.win.Event("popstate"));
  assert.equal(c.doc.getElementById("v-detail").classList.contains("on"), false);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("the month can be changed, and the figures follow", function () {
  var c = load();
  open(c, "assets");
  var prev = c.app.window.WM.prevPeriod(c.f.now);
  var pick = c.doc.getElementById("detailPeriod");
  pick.value = prev;
  pick.dispatchEvent(new c.win.Event("change"));
  assert.match(text(c, "detailHead"), /RM 26,500\.00/, "5,000 + 2,000 + 11,000 + 8,500 a month earlier");
  assert.equal(c.doc.getElementById("sheetPeriod").value, prev, "one month setting for both screens");
});

test("names containing markup are shown as text everywhere on the page", function () {
  var c = load({ instName: '<img src=x onerror="window.__pwned=1">' });
  open(c, "assets");
  assert.equal(c.doc.querySelector("#v-detail img"), null);
  assert.equal(c.win.__pwned, undefined);
  var idx = -1;
  Array.prototype.forEach.call(c.doc.querySelectorAll("#detailDimLegend [data-slice]"), function (r) {
    if (r.textContent.indexOf("<img") !== -1) idx = r.getAttribute("data-slice");
  });
  assert.notEqual(idx, -1);
  c.doc.querySelector('#detailDimLegend [data-slice="' + idx + '"]').dispatchEvent(new c.win.MouseEvent("click", { bubbles: true }));
  assert.equal(c.doc.querySelector("#v-detail img"), null, "not in the chip either");
  assert.match(text(c, "detailChip"), /<img/);
});

test("a scope with nothing in it says so", function () {
  var c = load();
  open(c, "useAssets");
  assert.match(text(c, "detailHead"), /Nothing recorded here yet/);
});

test("the row panel opens from a drill-down row", function () {
  var c = load();
  open(c, "assets");
  c.doc.getElementById("dopen_" + c.f.ids.epf).click();
  assert.equal(c.doc.getElementById("rowPanel").hidden, false);
  assert.match(text(c, "rowPanelTitle"), /EPF i-Akaun/);
  assert.deepEqual(c.app.consoleErrors, []);
});

test("the Edit button on a row opens the same dialog as the Accounts screen", function () {
  var c = load();
  open(c, "assets");
  c.doc.querySelector('#detailList [data-edit-hold="' + c.f.ids.savings + '"]').click();
  assert.equal(c.doc.getElementById("holdModal").classList.contains("on"), true);
  assert.equal(c.doc.getElementById("h_name").value, "Savings");
});
