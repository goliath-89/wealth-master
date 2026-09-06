"use strict";
// Wealth Master — P0 shell: connected data file, store wiring, guarded import, exports.

var deviceId = WM.getDeviceId();
var state = WM.load().state;

// The connected data file (ADR 001). null until connected or restored.
var fileHandle = null;
var filePermission = "prompt";
var dirty = false;
var lastSavedAt = null;

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Marks the state changed, persists to the localStorage cache, then pushes to the
// connected file. The cache write is synchronous and always happens; the file write is
// async and may fail, which is what `dirty` and the status pill exist to surface.
function commit(opts) {
  var res = WM.save(state);
  if (!res.ok) toast("Could not save to this browser — storage may be full or blocked");
  if (!opts || opts.markDirty !== false) dirty = true;
  render();
  if (fileHandle && filePermission === "granted") saveToFile();
}

function saveToFile() {
  if (!fileHandle) return Promise.resolve(false);
  return WM.write(fileHandle, state).then(function () {
    dirty = false;
    lastSavedAt = new Date();
    render();
    return true;
  }).catch(function (err) {
    filePermission = "denied";
    render();
    toast("Could not write to the data file — reconnect to fix");
    console.error("File write failed:", err);
    return false;
  });
}

function toast(msg) {
  var s = $("snack");
  $("snackMsg").textContent = msg;
  s.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { s.classList.remove("on"); }, 4200);
}

function liveCount(list) {
  return list.filter(function (r) { return !r.deleted; }).length;
}

// Explicit rather than rule-based: "liabilities" does not singularise by dropping an s,
// and loanPayments needs a space. A warning about losing data should read like English.
var ENTITY_LABELS = {
  institutions: ["institution", "institutions"],
  accounts: ["account", "accounts"],
  holdings: ["holding", "holdings"],
  valuations: ["valuation", "valuations"],
  assets: ["asset", "assets"],
  liabilities: ["liability", "liabilities"],
  loanPayments: ["loan payment", "loan payments"],
  scenarios: ["scenario", "scenarios"],
  goals: ["goal", "goals"],
  reference: ["reference row", "reference rows"]
};

function entityLabel(entity, count) {
  var pair = ENTITY_LABELS[entity] || [entity, entity];
  return count === 1 ? pair[0] : pair[1];
}

function relativeTime(date) {
  if (!date) return "";
  var secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return secs + "s ago";
  if (secs < 3600) return Math.round(secs / 60) + " min ago";
  return Math.round(secs / 3600) + "h ago";
}

// ---- rendering -------------------------------------------------------------

function fileStatus() {
  if (!WM.isSupported()) return { cls: "", label: "Manual export", kind: "unsupported" };
  if (!fileHandle) return { cls: "", label: "Not connected", kind: "none" };
  if (filePermission !== "granted") return { cls: "err", label: "Reconnect needed", kind: "permission" };
  if (dirty) return { cls: "dirty", label: "Unsaved", kind: "dirty" };
  return { cls: "ok", label: "Saved " + relativeTime(lastSavedAt), kind: "saved" };
}

function renderFileSection() {
  var st = fileStatus();
  var pill = $("filePill");
  pill.className = "pill " + st.cls;
  $("fileLabel").textContent = st.label;

  var row = "", note = "";
  if (st.kind === "unsupported") {
    row = '<button class="btn" id="exportNowBtn">Export a copy now</button>';
    note = "This browser cannot hold a link to a file, so saving is manual. " +
      "Chrome or Edge on a desktop will save automatically. Export after every session — " +
      "this browser's storage is a cache, not a safe place to keep your only copy.";
  } else if (st.kind === "none") {
    row = '<button class="btn pri" id="connectNewBtn">Connect a new file</button>' +
      '<button class="btn" id="connectExistingBtn">Open an existing file</button>';
    note = "Pick a file in a folder that syncs — OneDrive, iCloud Drive — and every change " +
      "saves to it automatically. That file becomes the real home of your data; this " +
      "browser only holds a cache of it.";
  } else if (st.kind === "permission") {
    row = '<span class="fname">' + esc(fileHandle.name) + '</span>' +
      '<button class="btn pri" id="reconnectBtn">Reconnect</button>' +
      '<button class="btn" id="disconnectBtn">Disconnect</button>';
    note = "Your browser drops write permission between sessions. Reconnect to resume " +
      "automatic saving — nothing is lost in the meantime, but changes are only in this browser.";
  } else {
    row = '<span class="fname">' + esc(fileHandle.name) + '</span>' +
      '<button class="btn" id="saveNowBtn">Save now</button>' +
      '<button class="btn" id="disconnectBtn">Disconnect</button>';
    note = dirty
      ? "Changes not yet written to the file."
      : "Saved automatically on every change.";
  }
  $("fileRow").innerHTML = row;
  $("fileNote").textContent = note;

  wire("connectNewBtn", function () { connect(WM.connectNew); });
  wire("connectExistingBtn", function () { connect(WM.connectExisting, true); });
  wire("reconnectBtn", reconnect);
  wire("disconnectBtn", disconnectFile);
  wire("saveNowBtn", function () { saveToFile().then(function (ok) { if (ok) toast("Saved"); }); });
  wire("exportNowBtn", exportJSON);
}

function wire(id, fn) {
  var el = $(id);
  if (el) el.onclick = fn;
}

// ---- net worth -------------------------------------------------------------

function renderWorth() {
  var pts = WM.series(state, WM.currentPeriod());
  if (!pts.length) {
    $("worthKpis").innerHTML = "";
    $("staleWrap").style.display = "none";
    $("worthChart").innerHTML = "";
    $("worthLines").innerHTML = '<div class="empty"><div class="et">No figures yet</div>' +
      '<div class="es">Record a month to see what you are worth.</div></div>';
    return;
  }

  var now = pts[pts.length - 1];
  var prev = pts.length > 1 ? pts[pts.length - 2] : null;
  var change = WM.changeBetween(prev, now);

  var deltaHtml = '<span class="neu">First month recorded</span>';
  if (change) {
    var up = change.delta >= 0;
    deltaHtml = '<span class="' + (up ? "up" : "dn") + '">' + (up ? "▲ " : "▼ ") +
      esc(fmtRM(Math.abs(change.delta))) + "</span>" +
      (change.pct === null ? "" : ' <span class="neu">' + esc(Math.abs(change.pct).toFixed(1)) + "%</span>");
  }

  $("worthKpis").innerHTML =
    '<div class="kpi"><div class="k">Net worth' + (now.partial ? '<span class="stale-mark">*</span>' : "") +
      '</div><div class="v">' + esc(fmtRM(now.net)) + '</div><div class="d">' + deltaHtml + "</div></div>" +
    '<div class="kpi"><div class="k">Assets</div><div class="v">' + esc(fmtRM(now.assets)) + "</div></div>" +
    '<div class="kpi"><div class="k">Liabilities</div><div class="v">' + esc(fmtRM(now.liabilities)) + "</div></div>" +
    '<div class="kpi"><div class="k">Liquid</div><div class="v">' + esc(fmtRM(now.liquid)) +
      '</div><div class="d neu">' + esc(fmtRM(now.illiquid)) + " illiquid</div></div>";

  // Staleness is stated in words, not only in colour — colour must never be the sole
  // signal (NFR-9).
  if (now.partial) {
    var stale = now.lines.filter(function (l) { return l.stale; });
    $("staleWrap").style.display = "";
    $("staleNote").innerHTML = "<b>* Carried forward.</b> " + stale.length + " of " + now.lines.length +
      " figures have not been updated for " + esc(monthLabel(now.period)) + ", so the last known balance is used: " +
      stale.map(function (l) {
        return esc(l.name) + " (" + esc(monthLabel(l.sourcePeriod)) + ")";
      }).join(", ") + ". The total is real but rests partly on older data.";
  } else {
    $("staleWrap").style.display = "none";
  }

  drawWorthChart(pts);

  // Holdings and physical assets both sit on the asset side — listing only holdings
  // would leave the Assets subtotal unreconcilable against the lines above it (AC-1).
  var holdings = now.lines.filter(function (l) {
    return l.kind === "holding" || l.kind === "asset";
  });
  var liabs = now.lines.filter(function (l) { return l.kind === "liability"; });

  function lineHtml(l, negative) {
    return '<div class="wline"><div class="wn">' + esc(l.name) +
      (l.stale ? '<span class="stale-mark" title="carried forward">*</span>' : "") +
      '<div class="ws' + (l.stale ? " stale" : "") + '">' +
      (l.stale ? "carried from " + esc(monthLabel(l.sourcePeriod)) : esc(l.accountName || "")) +
      "</div></div>" +
      '<div class="wv">' + (negative ? "−" : "") + esc(fmtRM(l.balance)) + "</div></div>";
  }

  $("worthLines").innerHTML =
    (holdings.length ? holdings.map(function (l) { return lineHtml(l, false); }).join("") +
      '<div class="subtot"><span>Assets</span><span class="wv">' + esc(fmtRM(now.assets)) + "</span></div>" : "") +
    (liabs.length ? '<div style="height:14px"></div>' +
      liabs.map(function (l) { return lineHtml(l, true); }).join("") +
      '<div class="subtot"><span>Liabilities</span><span class="wv">−' + esc(fmtRM(now.liabilities)) + "</span></div>" : "") +
    '<div class="subtot"><span>Net worth</span><span class="wv">' + esc(fmtRM(now.net)) + "</span></div>";
}

// Hand-rolled SVG: no charting library, so the app stays offline and dependency-free.
function drawWorthChart(pts) {
  var el = $("worthChart");
  if (pts.length < 2) {
    el.innerHTML = '<div class="note" style="text-align:center;padding:30px 0">' +
      "A trend needs at least two months.</div>";
    return;
  }

  var W = 720, H = 240, ml = 62, mr = 12, mt = 12, mb = 28;
  var pw = W - ml - mr, ph = H - mt - mb;

  var vals = pts.map(function (p) { return p.net; });
  var lo = Math.min.apply(null, vals.concat([0]));
  var hi = Math.max.apply(null, vals.concat([0]));
  if (hi === lo) { hi = lo + 1; }
  var pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  var X = function (i) { return ml + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw); };
  var Y = function (v) { return mt + ph - ((v - lo) / (hi - lo)) * ph; };

  var body = "";
  [lo, (lo + hi) / 2, hi].forEach(function (t) {
    var y = Y(t);
    body += '<line class="gridline" x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (W - mr) +
      '" y2="' + y.toFixed(1) + '"></line>';
    body += '<text class="axis-t" x="' + (ml - 8) + '" y="' + (y + 3.5).toFixed(1) +
      '" text-anchor="end">' + esc(shortRM(t)) + "</text>";
  });
  if (lo < 0 && hi > 0) {
    body += '<line x1="' + ml + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - mr) + '" y2="' + Y(0).toFixed(1) +
      '" stroke="currentColor" stroke-width="1" opacity="0.35"></line>';
  }

  var d = pts.map(function (p, i) { return X(i).toFixed(1) + "," + Y(p.net).toFixed(1); }).join(" L");
  body += '<path d="M' + d + '" fill="none" stroke="var(--accent)" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round"></path>';

  // A carried-forward month is drawn hollow, so the chart shows which points are
  // estimates rather than entries.
  pts.forEach(function (p, i) {
    var cx = X(i).toFixed(1), cy = Y(p.net).toFixed(1);
    body += p.partial
      ? '<circle cx="' + cx + '" cy="' + cy + '" r="3.4" fill="var(--bg)" stroke="var(--warn)" stroke-width="2"></circle>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="var(--accent)"></circle>';
  });

  var step = Math.max(1, Math.ceil(pts.length / 6));
  pts.forEach(function (p, i) {
    if (i % step !== 0 && i !== pts.length - 1) return;
    body += '<text class="axis-t" x="' + X(i).toFixed(1) + '" y="' + (H - 8) +
      '" text-anchor="middle">' + esc(monthLabel(p.period)) + "</text>";
  });

  el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" ' +
    'role="img" aria-label="Net worth trend">' + body + "</svg>";
}

function shortRM(n) {
  var abs = Math.abs(n);
  var sign = n < 0 ? "−" : "";
  if (abs >= 1000000) return sign + "RM " + (abs / 1000000).toFixed(1) + "m";
  if (abs >= 1000) return sign + "RM " + Math.round(abs / 1000) + "k";
  return sign + "RM " + Math.round(abs);
}

// ---- forecast --------------------------------------------------------------

var SCENARIO_COLOURS = { Conservative: "#e0a02a", Base: "#3987e5", Optimistic: "#1fae7f" };

function scenarioColour(name, i) {
  return SCENARIO_COLOURS[name] || sliceColour(i);
}

// Defaults live in memory until the owner actually edits one. Writing them to the store
// on render would stamp three records the owner never created, and the import guard
// would then rightly report that an incoming file was about to discard them — turning
// every cross-device import into a false alarm. Rendering must not mutate state.
var defaultScenarioCache = null;

function activeScenarios() {
  var stored = WM.live(state.scenarios);
  if (stored.length) return stored;
  if (!defaultScenarioCache) defaultScenarioCache = WM.defaultScenarios(deviceId);
  return defaultScenarioCache;
}

// Called only from the editor: the moment the owner changes an assumption, the whole set
// becomes their data and is persisted with the ids already on screen.
function materialiseScenarios() {
  if (WM.live(state.scenarios).length) return;
  state.scenarios = state.scenarios.concat(activeScenarios());
}

function renderForecast() {
  var months = parseInt($("horizon").value, 10) || 120;
  var real = $("realTerms").checked;
  var projections = WM.projectAll(state, months, null, activeScenarios());

  if (!projections.length || !projections[0].points.length || projections[0].openingNet === 0) {
    $("forecastKpis").innerHTML = "";
    $("forecastChart").innerHTML = '<div class="note" style="text-align:center;padding:30px 0">' +
      "Record a month first — a projection needs somewhere to start from.</div>";
    $("forecastLegend").innerHTML = "";
    $("assumptions").innerHTML = "";
    return;
  }

  function shown(p, pt) {
    return real ? WM.inRealTerms(pt.net, p.assumptions.inflationPct, pt.monthsAhead) : pt.net;
  }

  var range = WM.rangeAt(projections, months);
  var years = Math.round(months / 12);

  // The headline is a RANGE, never one figure (R3). A single number here would read as
  // a prediction no matter how it were labelled.
  $("forecastKpis").innerHTML =
    '<div class="kpi"><div class="k">In ' + years + " years, between</div><div class=\"v\">" +
      esc(fmtRM(projections.map(function (p) { return shown(p, p.points[months]); })
        .reduce(function (a, b) { return Math.min(a, b); }))) + "</div>" +
      '<div class="d neu">and ' + esc(fmtRM(projections.map(function (p) { return shown(p, p.points[months]); })
        .reduce(function (a, b) { return Math.max(a, b); }))) + "</div></div>" +
    '<div class="kpi"><div class="k">Today</div><div class="v">' +
      esc(fmtRM(projections[0].openingNet)) + "</div></div>" +
    '<div class="kpi"><div class="k">Spread</div><div class="v">' + esc(fmtRM(range.spread)) +
      '</div><div class="d neu">between scenarios</div></div>' +
    (real ? '<div class="kpi"><div class="k">Shown in</div><div class="v" style="font-size:17px">Today\'s money</div>' +
      '<div class="d neu">inflation-adjusted</div></div>' : "");

  drawForecastChart(projections, months, real);

  $("assumptions").innerHTML = projections.map(function (p, i) {
    var sc = WM.byId(state.scenarios, p.scenarioId);
    var g = p.assumptions.growth;
    return '<div class="acct"><div class="acct-h">' +
      '<span class="lgd" style="background:' + scenarioColour(p.scenarioName, i) + '"></span>' +
      '<span class="acct-n">' + esc(p.scenarioName) + "</span>" +
      '<div class="spacer"></div>' +
      '<span class="wv">' + esc(fmtRM(shown(p, p.points[months]))) + "</span>" +
      '<button class="btn sm" data-edit-scenario="' + esc(p.scenarioId) + '">Edit</button></div>' +
      '<div class="prev">Cash ' + esc(String(g.cash || 0)) + "% · Investments " + esc(String(g.investment || 0)) +
      "% · Retirement " + esc(String(g.retirement || 0)) + "% · Inflation " +
      esc(String(p.assumptions.inflationPct)) + "%" +
      (p.assumptions.monthlyContribution ? " · Adding " + esc(fmtRM(p.assumptions.monthlyContribution)) + "/month" : "") +
      "</div></div>";
  }).join("");

  bindAll("[data-edit-scenario]", "data-edit-scenario", openScenario);
}

// Historical actuals continuing into the projected range (FR-6.5). Actuals are drawn
// solid, projections dashed, so the eye can tell recorded fact from arithmetic.
function drawForecastChart(projections, months, real) {
  var history = WM.series(state, WM.currentPeriod()).slice(-24);
  var W = 720, H = 260, ml = 62, mr = 12, mt = 12, mb = 28;
  var pw = W - ml - mr, ph = H - mt - mb;

  var histLen = history.length;
  var total = histLen + months;
  var all = [];
  history.forEach(function (h) { all.push(h.net); });
  projections.forEach(function (p) {
    p.points.forEach(function (pt) {
      all.push(real ? WM.inRealTerms(pt.net, p.assumptions.inflationPct, pt.monthsAhead) : pt.net);
    });
  });

  var lo = Math.min.apply(null, all.concat([0]));
  var hi = Math.max.apply(null, all.concat([0]));
  if (hi === lo) hi = lo + 1;
  var pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;

  var X = function (i) { return ml + (total <= 1 ? pw / 2 : (i / (total - 1)) * pw); };
  var Y = function (v) { return mt + ph - ((v - lo) / (hi - lo)) * ph; };

  var body = "";
  [lo, (lo + hi) / 2, hi].forEach(function (t) {
    var y = Y(t);
    body += '<line class="gridline" x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (W - mr) +
      '" y2="' + y.toFixed(1) + '"></line>' +
      '<text class="axis-t" x="' + (ml - 8) + '" y="' + (y + 3.5).toFixed(1) +
      '" text-anchor="end">' + esc(shortRM(t)) + "</text>";
  });

  // The boundary between what happened and what is merely assumed.
  if (histLen > 0) {
    var bx = X(histLen - 1);
    body += '<line x1="' + bx.toFixed(1) + '" y1="' + mt + '" x2="' + bx.toFixed(1) + '" y2="' + (mt + ph) +
      '" stroke="var(--line2)" stroke-width="1"></line>' +
      '<text class="axis-t" x="' + (bx + 5).toFixed(1) + '" y="' + (mt + 10) + '">projected →</text>';
  }

  if (histLen > 1) {
    body += '<path d="M' + history.map(function (h, i) {
      return X(i).toFixed(1) + "," + Y(h.net).toFixed(1);
    }).join(" L") + '" fill="none" stroke="var(--tx)" stroke-width="2"></path>';
  }

  projections.forEach(function (p, idx) {
    var d = p.points.map(function (pt, i) {
      var v = real ? WM.inRealTerms(pt.net, p.assumptions.inflationPct, pt.monthsAhead) : pt.net;
      return X(Math.max(0, histLen - 1) + i).toFixed(1) + "," + Y(v).toFixed(1);
    });
    body += '<path d="M' + d.join(" L") + '" fill="none" stroke="' +
      scenarioColour(p.scenarioName, idx) + '" stroke-width="2" stroke-dasharray="5 4"></path>';
  });

  $("forecastChart").innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H +
    '" preserveAspectRatio="xMidYMid meet" role="img" ' +
    'aria-label="Net worth recorded to date, continuing into three projected scenarios">' +
    body + "</svg>";

  $("forecastLegend").innerHTML = '<div class="legend">' +
    '<span class="lg"><span class="lgd" style="background:var(--tx)"></span>Recorded</span>' +
    projections.map(function (p, i) {
      return '<span class="lg"><span class="lgd" style="background:' + scenarioColour(p.scenarioName, i) +
        '"></span>' + esc(p.scenarioName) + " (projected)</span>";
    }).join("") + "</div>";
}

function openScenario(id) {
  editing.scenario = id;
  var sc = WM.byId(activeScenarios(), id);
  if (!sc) return;
  var g = sc.growthAssumptions || {};
  $("scenarioModalT").textContent = "Assumptions — " + sc.name;
  $("sc_cash").value = g.cash || 0;
  $("sc_inv").value = g.investment || 0;
  $("sc_ret").value = g.retirement || 0;
  $("sc_prop").value = g.property || 0;
  $("sc_infl").value = sc.inflationPct || 0;
  $("sc_contrib").value = WM.formatAmount(sc.monthlyContribution || 0);
  showErrors("scenarioErr", []);
  openModal("scenarioModal");
}

// ---- tax relief (S6) -------------------------------------------------------

function renderRelief() {
  var years = WM.yearsWithContributions(state);
  var sel = $("taxYear");
  var current = String(new Date().getFullYear());
  if (!years.length) years = [current];

  var chosen = sel.value && years.indexOf(sel.value) !== -1 ? sel.value : years[0];
  sel.innerHTML = years.map(function (y) {
    return '<option value="' + esc(y) + '"' + (y === chosen ? " selected" : "") + ">" + esc(y) + "</option>";
  }).join("");

  var t = WM.totalsFor(state, chosen);

  if (!t.lines.length) {
    $("reliefList").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">Nothing tagged for ' + esc(chosen) + "</div>" +
      '<div class="es">Tag a holding with a relief category when editing it, then record its contributions on the Month tab.</div></div></div>';
  } else {
    $("reliefList").innerHTML = '<div class="card">' + t.lines.map(function (l) {
      var over = l.overLimit;
      return '<div class="wline"><div class="wn">' + esc(l.label) +
        '<div class="ws">' + esc(fmtRM(l.contributed)) + " paid in" +
        (l.withdrawn ? ", less " + esc(fmtRM(l.withdrawn)) + " withdrawn" : "") +
        (l.limit ? " · limit " + esc(fmtRM(l.limit)) : " · no limit set") +
        (l.headroom !== null && !over && l.headroom > 0 ? " · " + esc(fmtRM(l.headroom)) + " headroom" : "") +
        "</div></div>" +
        '<div class="wv' + (over ? " stale" : "") + '">' + esc(fmtRM(l.claimable)) +
        (over ? '<span class="stale-mark" title="capped at the limit">*</span>' : "") + "</div></div>";
    }).join("") +
      '<div class="subtot"><span>Total to claim</span><span class="wv">' +
      esc(fmtRM(t.totalClaimable)) + "</span></div>" +
      (t.totalContributed > t.totalClaimable
        ? '<div class="prev">* ' + esc(fmtRM(t.totalContributed)) + " was contributed; the rest sits above the limits set below.</div>"
        : "") +
      "</div>";
  }

  $("reliefLimits").innerHTML = WM.CATEGORIES.map(function (c) {
    return '<div class="fitem"><label class="fl" for="lim_' + esc(c.key) + '">' + esc(c.label) + "</label>" +
      '<input type="text" inputmode="decimal" id="lim_' + esc(c.key) + '" value="' +
      esc(WM.formatAmount(WM.limitFor(state, c.key))) + '">' +
      '<div class="prev">' + esc(c.note) + "</div></div>";
  }).join("");
}

$("saveLimitsBtn").onclick = function () {
  var limits = {};
  var bad = null;
  WM.CATEGORIES.forEach(function (c) {
    var parsed = WM.parseAmount($("lim_" + c.key).value);
    if (parsed.error) bad = c.label;
    limits[c.key] = parsed.value === null ? 0 : parsed.value;
  });
  if (bad) { toast(bad + " limit must be a number"); return; }
  state.settings.reliefLimits = limits;
  commit();
  toast("Limits saved");
};

$("taxYear").onchange = renderRelief;

// ---- goals (S5) ------------------------------------------------------------

var GOAL_WORDS = {
  "on-track": "On track",
  "behind": "Behind",
  "reached": "Reached",
  "overdue": "Date passed",
  "unknown": "No contributions recorded",
  "no-date": "No target date",
  "no-target": "No target amount"
};

function renderGoals() {
  var list = WM.live(state.goals);
  if (!list.length) {
    $("goalList").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">No goals</div>' +
      '<div class="es">Set a target and a date to see whether you are on track for it.</div>' +
      '<button class="btn pri" id="firstGoalBtn">Add first goal</button></div></div>';
    wire("firstGoalBtn", function () { openGoal(null); });
    return;
  }

  // Growth taken from the Base scenario, so a goal and the forecast never disagree.
  var base = activeScenarios().filter(function (s) { return s.name === "Base"; })[0] || activeScenarios()[0];
  var growthPct = base && base.growthAssumptions ? base.growthAssumptions.investment : 4;

  $("goalList").innerHTML = WM.progressAll(state, { growthPct: growthPct }).map(function (p) {
    var cls = p.status === "on-track" || p.status === "reached" ? "up"
      : p.status === "behind" || p.status === "overdue" ? "dn" : "neu";

    var detail = "";
    if (p.status === "behind") {
      detail = "Putting aside " + esc(fmtRM(p.actualMonthly)) + " a month against " +
        esc(fmtRM(p.requiredMonthly)) + " needed" +
        (p.monthsAtCurrentRate
          ? " — at this rate you get there in " + p.monthsAtCurrentRate + " months, not " + p.monthsRemaining
          : " — at this rate it does not get there") + ".";
    } else if (p.status === "on-track") {
      detail = "Putting aside " + esc(fmtRM(p.actualMonthly)) + " a month, against " +
        esc(fmtRM(p.requiredMonthly)) + " needed.";
    } else if (p.status === "reached") {
      detail = "Target met.";
    } else if (p.status === "overdue") {
      detail = "The target date has passed with " + esc(fmtRM(p.shortfall)) + " still to find.";
    } else if (p.status === "unknown") {
      detail = p.requiredMonthly !== null
        ? "Needs " + esc(fmtRM(p.requiredMonthly)) + " a month. Record contributions on the Month tab to track progress."
        : "Record contributions on the Month tab to track progress.";
    } else if (p.status === "no-date") {
      detail = "Add a target date to see what it needs each month.";
    }

    var pctWidth = Math.max(0, Math.min(100, p.pctComplete));
    return '<div class="acct"><div class="acct-h">' +
      '<span class="acct-n">' + esc(p.name) + "</span>" +
      '<span class="tag ' + (cls === "up" ? "good" : "") + '">' + esc(GOAL_WORDS[p.status] || p.status) + "</span>" +
      '<div class="spacer"></div>' +
      '<span class="wv">' + esc(fmtRM(p.current)) + " of " + esc(fmtRM(p.target)) + "</span>" +
      '<button class="btn sm" data-edit-goal="' + esc(p.goalId) + '">Edit</button></div>' +
      '<div style="height:6px;border-radius:3px;background:var(--surface3);margin-top:8px;overflow:hidden">' +
      '<div style="height:100%;width:' + pctWidth + '%;background:var(--' +
      (cls === "dn" ? "bad" : "good") + ')"></div></div>' +
      '<div class="prev">' + esc(p.pctComplete) + "% · " + detail + "</div></div>";
  }).join("");

  bindAll("[data-edit-goal]", "data-edit-goal", openGoal);
}

function openGoal(id) {
  editing.goal = id;
  var g = id ? WM.byId(state.goals, id) : null;
  $("goalModalT").textContent = g ? "Edit goal" : "Add goal";
  $("g_name").value = g ? g.name : "";
  $("g_target").value = g ? WM.formatAmount(g.targetAmount) : "";
  $("g_date").value = g && g.targetDate ? String(g.targetDate).slice(0, 7) : "";

  var linked = (g && g.linkedHoldingIds) || [];
  $("g_holdings").innerHTML = WM.contributingHoldings(state).map(function (h) {
    var acct = WM.byId(state.accounts, h.accountId);
    return '<option value="' + esc(h.id) + '"' + (linked.indexOf(h.id) !== -1 ? " selected" : "") + ">" +
      esc((acct ? acct.name + " · " : "") + h.name) + "</option>";
  }).join("");

  $("goalDelete").style.display = g ? "" : "none";
  showErrors("goalErr", []);
  openModal("goalModal");
}

$("goalSave").onclick = function () {
  var target = WM.parseAmount($("g_target").value);
  var errors = [];
  if (target.error) errors.push("Target amount must be a number");
  var date = $("g_date").value;
  if (date && !WM.isPeriod(date)) errors.push("Target date must be a valid month");

  var rec = {
    id: editing.goal || undefined,
    name: $("g_name").value.trim(),
    targetAmount: target.value,
    targetDate: date || null,
    linkedHoldingIds: Array.prototype.filter.call($("g_holdings").options, function (o) {
      return o.selected;
    }).map(function (o) { return o.value; })
  };
  errors = errors.concat(WM.validate("goals", rec, state));
  if (showErrors("goalErr", errors)) return;

  WM.upsert(state, "goals", rec, deviceId);
  closeModal("goalModal");
  commit();
  toast(editing.goal ? "Goal updated" : "Goal added");
};

$("goalDelete").onclick = function () { removeRecord("goals", editing.goal, "goalModal", "Goal"); };
$("addGoalBtn").onclick = function () { openGoal(null); };

// ---- overpay or invest (S3) ------------------------------------------------

function renderDecision() {
  var loansList = WM.live(state.liabilities);
  var sel = $("dec_loan");

  if (!loansList.length) {
    sel.innerHTML = "";
    $("decisionResult").innerHTML = '<p class="note" style="margin-top:12px">' +
      "Add a loan on the Accounts tab to compare against investing.</p>";
    return;
  }

  var previous = sel.value;
  sel.innerHTML = options(loansList, previous || loansList[0].id);
  if (previous) sel.value = previous;

  var liability = WM.byId(state.liabilities, sel.value) || loansList[0];
  var amount = WM.parseAmount($("dec_amount").value);
  var growth = parseFloat($("dec_growth").value);
  var months = parseInt($("horizon").value, 10) || 120;

  if (amount.error) {
    $("decisionResult").innerHTML = '<div class="dangerbox" style="margin-top:12px">' +
      "The monthly amount must be a number.</div>";
    return;
  }

  var res = WM.overpayVsInvest(liability, {
    monthlyAmount: amount.value || 0,
    growthPct: isNaN(growth) ? 0 : growth,
    horizonMonths: months
  });

  if (!res) {
    $("decisionResult").innerHTML = '<p class="note" style="margin-top:12px">' +
      "Enter this loan's principal, rate and tenure to compare it.</p>";
    return;
  }

  var years = Math.round(months / 12);

  if (res.flatRate) {
    // No overpay branch: inventing a saving here would be the R4 trap again.
    $("decisionResult").innerHTML = '<div class="warnbox" style="margin-top:12px"><b>Invest it.</b> ' +
      esc(res.reason) + "</div>" +
      '<div class="lsum">' +
      '<div><div class="k">Invested over ' + years + " yrs</div><div class=\"v\">" +
        esc(fmtRM(res.investOnly)) + "</div></div>" +
      (res.settlement ? '<div><div class="k">Or settle now for</div><div class="v">' +
        esc(fmtRM(res.settlement.settlementAmount)) + '</div></div>' +
        '<div><div class="k">Rebate if settled</div><div class="v">' +
        esc(fmtRM(res.settlement.rebate)) + "</div></div>" : "") +
      "</div>";
    return;
  }

  var winner = res.verdict === "similar" ? "Line ball"
    : res.verdict === "overpay" ? "Overpay the loan" : "Invest the money";
  var box = res.verdict === "similar" ? "warnbox" : "warnbox";

  $("decisionResult").innerHTML =
    '<div class="' + box + '" style="margin-top:12px"><b>' + esc(winner) + ".</b> " +
    (res.verdict === "similar" ? "" : "Ahead by <b>" + esc(fmtRM(res.difference)) +
      "</b> after " + years + " years. ") + esc(res.reason) + "</div>" +
    '<div class="lsum">' +
    '<div><div class="k">Overpaying</div><div class="v">' + esc(fmtRM(res.overpay.netAtHorizon)) +
      '</div><div class="k" style="margin-top:4px">clears ' + res.overpay.monthsSaved +
      " mths early, saves " + esc(fmtRM(res.overpay.interestSaved)) + " interest</div></div>" +
    '<div><div class="k">Investing</div><div class="v">' + esc(fmtRM(res.invest.netAtHorizon)) +
      '</div><div class="k" style="margin-top:4px">' +
      (res.invest.debtRemaining ? esc(fmtRM(res.invest.debtRemaining)) + " still owed at that point"
        : "loan repaid on schedule") + "</div></div>" +
    "</div>" +
    '<div class="cmp">Both spend <b>' + esc(fmtRM(res.monthlyAmount)) + "</b> a month and are valued at the " +
    "same date. The loan costs <b>" + esc(pct(res.loanRatePct)) + "</b>; the comparison assumes investments " +
    "return <b>" + esc(pct(res.growthPct)) + "</b>. Overpaying stops winning above roughly <b>" +
    esc(pct(WM.breakEvenGrowth(liability, { monthlyAmount: res.monthlyAmount, horizonMonths: months }))) +
    "</b> — and unlike the loan's interest, a return is an assumption rather than a certainty.</div>";
}

// ---- allocation and PIDM ---------------------------------------------------

// Categorical palette, reused across the app. Chosen to stay distinguishable in both
// themes and for the commonest colour-vision deficiencies — but the legend always
// carries the label and figure too, so colour is never the only signal (NFR-9).
var SLICE_COLOURS = [
  "#3987e5", "#1fae7f", "#e07a3c", "#dfa62a", "#dd7ba4",
  "#5ac26a", "#8d80e8", "#e06767", "#4bc0d0", "#b58bd4"
];

function sliceColour(i) { return SLICE_COLOURS[i % SLICE_COLOURS.length]; }

function polar(cx, cy, r, deg) {
  var a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx, cy, rOut, rIn, a0, a1) {
  var big = (a1 - a0) > 180 ? 1 : 0;
  var p1 = polar(cx, cy, rOut, a0), p2 = polar(cx, cy, rOut, a1);
  var p3 = polar(cx, cy, rIn, a1), p4 = polar(cx, cy, rIn, a0);
  return "M" + p1[0].toFixed(2) + "," + p1[1].toFixed(2) +
    " A" + rOut + "," + rOut + " 0 " + big + " 1 " + p2[0].toFixed(2) + "," + p2[1].toFixed(2) +
    " L" + p3[0].toFixed(2) + "," + p3[1].toFixed(2) +
    " A" + rIn + "," + rIn + " 0 " + big + " 0 " + p4[0].toFixed(2) + "," + p4[1].toFixed(2) + " Z";
}

function renderAllocation() {
  var period = WM.currentPeriod();
  var sel = $("allocDim");
  if (!sel.options.length) {
    sel.innerHTML = Object.keys(WM.DIMENSIONS).map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(WM.DIMENSIONS[k].label) + "</option>";
    }).join("");
  }
  var alloc = WM.allocation(state, period, sel.value || "class");

  if (!alloc.slices.length) {
    $("allocChart").innerHTML = '<div class="note" style="text-align:center;padding:30px 0">' +
      "Nothing recorded to allocate yet.</div>";
    $("allocLegend").innerHTML = "";
    return;
  }

  var W = 300, H = 220, cx = 150, cy = 110, rO = 88, rI = 58;
  var body = "";
  if (alloc.slices.length === 1) {
    // A single slice as a full circle — an arc from 0 to 360 degenerates to nothing.
    body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((rO + rI) / 2) +
      '" fill="none" stroke="' + sliceColour(0) + '" stroke-width="' + (rO - rI) + '"></circle>';
  } else {
    var angle = 0;
    alloc.slices.forEach(function (s, i) {
      var sweep = s.value / alloc.total * 360;
      if (sweep <= 0) return;
      var gap = sweep > 3 ? 1 : 0;
      body += '<path d="' + arcPath(cx, cy, rO, rI, angle, angle + sweep - gap) +
        '" fill="' + sliceColour(i) + '"></path>';
      angle += sweep;
    });
  }
  body += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" fill="currentColor" ' +
    'style="font-size:17px;font-weight:600">' + esc(fmtRM(alloc.total)) + "</text>";
  body += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" class="axis-t">assets</text>';

  $("allocChart").innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H +
    '" preserveAspectRatio="xMidYMid meet" style="max-height:230px" role="img" ' +
    'aria-label="Allocation by ' + esc(alloc.label) + '">' + body + "</svg>";

  $("allocLegend").innerHTML = '<div class="legend">' + alloc.slices.map(function (s, i) {
    return '<span class="lg"><span class="lgd" style="background:' + sliceColour(i) + '"></span>' +
      esc(s.label) + ' <span class="lgv">' + esc(s.share.toFixed(1)) + "% · " +
      esc(fmtRM(s.value)) + "</span></span>";
  }).join("") + "</div>";
}

// Runway and savings rate share a home on the net worth screen: both answer "how solid
// is this", which is a different question from "how much is it".
function renderResilience() {
  var period = WM.currentPeriod();
  var run = WM.emergencyRunway(state, period);
  var save = WM.savingsRate(state, period, 12);

  var runHtml;
  if (run.months === null) {
    runHtml = '<div class="kpi"><div class="k">Emergency runway</div><div class="v" style="font-size:16px">—</div>' +
      '<div class="d neu">Add your monthly spending on the Data tab</div></div>';
  } else {
    // Three months is the common floor; six is the usual comfortable target.
    var tone = run.months >= 6 ? "up" : run.months >= 3 ? "neu" : "dn";
    runHtml = '<div class="kpi"><div class="k">Emergency runway</div><div class="v">' +
      esc(run.months) + (run.months === 1 ? " month" : " months") + "</div>" +
      '<div class="d ' + tone + '">' + esc(fmtRM(run.liquid)) + " liquid ÷ " +
      esc(fmtRM(run.monthlyExpenses)) + "/month</div></div>";
  }

  var saveHtml;
  if (save.pct === null) {
    saveHtml = '<div class="kpi"><div class="k">Savings rate</div><div class="v" style="font-size:16px">—</div>' +
      '<div class="d neu">Add your take-home on the Data tab</div></div>';
  } else {
    saveHtml = '<div class="kpi"><div class="k">Savings rate</div><div class="v">' +
      esc(save.pct) + "%</div>" +
      '<div class="d neu">' + esc(fmtRM(save.monthlyAverage)) + "/month over 12 months</div></div>";
  }

  $("resilience").innerHTML = runHtml + saveHtml;
}

function renderSettingsFields() {
  // Only overwrite while the owner is not mid-edit, so a re-render cannot wipe typing.
  if (document.activeElement !== $("set_income")) {
    $("set_income").value = WM.formatAmount(state.settings.monthlyIncome);
  }
  if (document.activeElement !== $("set_expenses")) {
    $("set_expenses").value = WM.formatAmount(state.settings.monthlyExpenses);
  }
  var have = state.settings.monthlyIncome || state.settings.monthlyExpenses;
  $("settingsNote").textContent = have ? "" : "Neither is set yet.";
}

$("saveSettingsBtn").onclick = function () {
  var income = WM.parseAmount($("set_income").value);
  var expenses = WM.parseAmount($("set_expenses").value);
  if (income.error || expenses.error) {
    toast("Those must be numbers");
    return;
  }
  state.settings.monthlyIncome = income.value;
  state.settings.monthlyExpenses = expenses.value;
  commit();
  toast("Saved");
};

function renderPidm() {
  var over = WM.pidmExposure(state, WM.currentPeriod()).filter(function (e) { return e.overLimit; });
  if (!over.length) { $("pidmWrap").style.display = "none"; return; }
  $("pidmWrap").style.display = "";
  $("pidmNote").innerHTML = "<b>Above PIDM cover.</b> " + over.map(function (e) {
    return esc(fmtRM(e.protectedTotal)) + " held at <b>" + esc(e.institution) +
      "</b> — " + esc(fmtRM(e.excess)) + " above the " + esc(fmtRM(e.limit)) + " limit";
  }).join("; ") + ". The limit applies per depositor per member bank, so splitting across " +
    "institutions restores full cover.";
}

// ---- loan schedules --------------------------------------------------------

var openSchedules = {};

function pct(n) {
  return n === null || n === undefined || isNaN(n) ? "—" : Number(n).toFixed(2) + "%";
}

// What-if inputs, held in memory only — a simulation is not a decision, so nothing is
// written to the store until the owner actually pays the money.
var simInputs = {};

// The interest-saving simulator. Reducing-balance loans get a payment slider; flat-rate
// facilities get early settlement instead, because paying extra monthly does not reduce
// term charges that were fixed on day one.
function renderSimulator(l, s) {
  var sim = simInputs[l.id] || {};

  if (s.basis === "flat") {
    var paid = sim.settleAfter === undefined ? Math.min(12, s.months - 1) : sim.settleAfter;
    var set = WM.ruleOf78Settlement(s, paid);
    var body = "";
    if (set) {
      body = '<div class="lsum">' +
        '<div><div class="k">Settle after</div><div class="v">' + set.instalmentsPaid + " mths</div></div>" +
        '<div><div class="k">Settlement figure</div><div class="v">' + esc(fmtRM(set.settlementAmount)) + "</div></div>" +
        '<div><div class="k">Rebate (Rule of 78)</div><div class="v">' + esc(fmtRM(set.rebate)) + "</div></div>" +
        "</div>" +
        '<div class="cmp">Paying the remaining ' + set.instalmentsRemaining + " instalments in full would cost <b>" +
        esc(fmtRM(set.outstandingInstalments)) + "</b>. Settling now costs <b>" + esc(fmtRM(set.settlementAmount)) +
        "</b>, saving <b>" + esc(fmtRM(set.rebate)) + "</b>." +
        " Note the rebate is smaller than the <b>" + esc(fmtRM(set.interestIfContinued)) +
        "</b> of interest still nominally outstanding — Rule of 78 front-loads the charges.</div>";
    }
    return '<hr class="hr"><div class="sec-t" style="margin-bottom:8px">Early settlement</div>' +
      '<div class="warnbox" style="margin-bottom:10px">Paying extra each month does <b>not</b> cut the interest on a flat-rate hire purchase — the term charges were fixed when you signed. The only way to save is to settle early, and the rebate is set by the Hire Purchase Act.</div>' +
      '<div class="fgrid"><div class="fitem">' +
      '<label class="fl" for="sim_' + esc(l.id) + '">Instalments paid before settling</label>' +
      '<input type="number" id="sim_' + esc(l.id) + '" min="0" max="' + (s.months - 1) +
      '" value="' + paid + '" data-simsettle="' + esc(l.id) + '"></div></div>' + body;
  }

  var payment = sim.payment === undefined ? s.instalment : sim.payment;
  var result = WM.simulatePayment(l, payment);
  var body2 = "";
  if (result && result.error) {
    body2 = '<div class="dangerbox" style="margin-top:10px">' + esc(result.error) + "</div>";
  } else if (result && result.comparison) {
    var c = result.comparison;
    if (c.monthsSaved === 0 && c.interestSaved === 0) {
      body2 = '<div class="cmp">That is the contractual instalment, so there is nothing saved yet. ' +
        "Raise it to see the effect.</div>";
    } else {
      var years = Math.floor(Math.abs(c.monthsSaved) / 12);
      var rem = Math.abs(c.monthsSaved) % 12;
      var span = (years ? years + (years === 1 ? " year " : " years ") : "") +
        (rem ? rem + (rem === 1 ? " month" : " months") : "");
      body2 = '<div class="lsum">' +
        '<div><div class="k">Interest saved</div><div class="v">' + esc(fmtRM(c.interestSaved)) + "</div></div>" +
        '<div><div class="k">Time saved</div><div class="v">' + Math.abs(c.monthsSaved) + " mths</div></div>" +
        '<div><div class="k">New payoff</div><div class="v">' + esc(monthLabel(c.acceleratedPayoff)) + "</div></div>" +
        "</div>" +
        '<div class="cmp">Paying <b>' + esc(fmtRM(payment)) + "</b> instead of <b>" + esc(fmtRM(s.instalment)) +
        "</b> clears the loan in " + c.acceleratedMonths + " months rather than " + c.baselineMonths +
        (span ? " — <b>" + esc(span.trim()) + "</b> earlier" : "") +
        ", and cuts total interest from <b>" + esc(fmtRM(c.baselineInterest)) + "</b> to <b>" +
        esc(fmtRM(c.acceleratedInterest)) + "</b>.</div>" +
        drawPayoffChart(result.baseline, result.accelerated);
    }
  }

  return '<hr class="hr"><div class="sec-t" style="margin-bottom:8px">Interest saving scenario</div>' +
    '<p class="note" style="margin-bottom:10px">Type a different monthly payment to see what it saves. Nothing is saved to your data — this is a what-if.</p>' +
    '<div class="fgrid"><div class="fitem">' +
    '<label class="fl" for="sim_' + esc(l.id) + '">Monthly payment</label>' +
    '<input type="text" inputmode="decimal" id="sim_' + esc(l.id) + '" value="' +
    esc(WM.formatAmount(payment)) + '" data-simpay="' + esc(l.id) + '"></div></div>' + body2;
}

// Amortisation as a stacked area: interest below, principal above, per instalment
// (FR-6.6). On a reducing loan the interest band tapers as the balance falls; on a flat
// facility it is a constant slab, which makes the difference between the two visible at
// a glance rather than only in the numbers.
function drawAmortChart(schedule, simulated) {
  if (!schedule.rows.length) return "";

  var W = 720, H = 200, ml = 58, mr = 12, mt = 10, mb = 26;
  var pw = W - ml - mr, ph = H - mt - mb;
  var rows = schedule.rows;
  var maxPay = rows.reduce(function (m, r) { return Math.max(m, r.payment); }, 0);
  if (maxPay <= 0) return "";

  var X = function (i) { return ml + (rows.length === 1 ? pw / 2 : (i / (rows.length - 1)) * pw); };
  var Y = function (v) { return mt + ph - (v / maxPay) * ph; };

  var body = "";
  [0, maxPay / 2, maxPay].forEach(function (t) {
    var y = Y(t);
    body += '<line class="gridline" x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (W - mr) +
      '" y2="' + y.toFixed(1) + '"></line>' +
      '<text class="axis-t" x="' + (ml - 8) + '" y="' + (y + 3.5).toFixed(1) +
      '" text-anchor="end">' + esc(shortRM(t)) + "</text>";
  });

  // Interest band from the baseline up; principal band stacked on top of it.
  var interestTop = rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.interest).toFixed(1); });
  var totalTop = rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.payment).toFixed(1); });

  body += '<path d="M' + X(0).toFixed(1) + "," + Y(0).toFixed(1) + " L" + interestTop.join(" L") +
    " L" + X(rows.length - 1).toFixed(1) + "," + Y(0).toFixed(1) +
    ' Z" fill="var(--bad)" fill-opacity="0.55"></path>';
  body += '<path d="M' + interestTop.join(" L") + " L" + totalTop.slice().reverse().join(" L") +
    ' Z" fill="var(--accent)" fill-opacity="0.55"></path>';

  var step = Math.max(1, Math.ceil(rows.length / 6));
  rows.forEach(function (r, i) {
    if (i % step !== 0 && i !== rows.length - 1) return;
    body += '<text class="axis-t" x="' + X(i).toFixed(1) + '" y="' + (H - 8) +
      '" text-anchor="middle">' + esc(r.period ? monthLabel(r.period) : String(r.n)) + "</text>";
  });

  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" ' +
    'role="img" aria-label="Interest and principal per instalment over the life of the loan">' +
    body + "</svg>" +
    '<div class="legend">' +
    '<span class="lg"><span class="lgd" style="background:var(--bad);opacity:.7"></span>Interest</span>' +
    '<span class="lg"><span class="lgd" style="background:var(--accent);opacity:.7"></span>Principal</span>' +
    "</div>";
}

// Baseline against accelerated balance over time (FR-6.7).
function drawPayoffChart(baseline, accelerated) {
  if (!baseline.rows.length || !accelerated.rows.length) return "";
  var W = 720, H = 180, ml = 58, mr = 12, mt = 10, mb = 26;
  var pw = W - ml - mr, ph = H - mt - mb;
  var span = Math.max(baseline.rows.length, accelerated.rows.length);
  var maxBal = baseline.principal;

  var X = function (i) { return ml + (span === 1 ? pw / 2 : (i / (span - 1)) * pw); };
  var Y = function (v) { return mt + ph - (v / maxBal) * ph; };

  function line(rows, colour, dashed) {
    var d = rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.balance).toFixed(1); });
    return '<path d="M' + X(0).toFixed(1) + "," + Y(baseline.principal).toFixed(1) + " L" + d.join(" L") +
      '" fill="none" stroke="' + colour + '" stroke-width="2" stroke-linejoin="round"' +
      (dashed ? ' stroke-dasharray="5 4"' : "") + "></path>";
  }

  var body = '<line class="gridline" x1="' + ml + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - mr) +
    '" y2="' + Y(0).toFixed(1) + '"></line>' +
    '<text class="axis-t" x="' + (ml - 8) + '" y="' + (Y(maxBal) + 3.5).toFixed(1) +
    '" text-anchor="end">' + esc(shortRM(maxBal)) + "</text>" +
    line(baseline.rows, "var(--tx3)", true) + line(accelerated.rows, "var(--good)", false);

  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" ' +
    'role="img" aria-label="Balance over time, contractual against accelerated">' + body + "</svg>" +
    '<div class="legend">' +
    '<span class="lg"><span class="lgd" style="background:var(--tx3)"></span>As contracted</span>' +
    '<span class="lg"><span class="lgd" style="background:var(--good)"></span>Paying more</span>' +
    "</div>";
}

// Only shown with two or more debts — with one, "which first" is not a question.
function renderStrategy() {
  var debts = WM.live(state.liabilities);
  if (debts.length < 2) { $("strategyWrap").style.display = "none"; return; }

  var extra = WM.parseAmount($("strat_extra").value);
  if (extra.error) {
    $("strategyWrap").style.display = "";
    $("strategyResult").innerHTML = '<div class="dangerbox">That must be a number.</div>';
    return;
  }

  var cmp = WM.compare(state, extra.value || 0);
  if (!cmp) { $("strategyWrap").style.display = "none"; return; }
  $("strategyWrap").style.display = "";

  var order = WM.costOrder(state);
  var misranked = order.filter(function (d) { return d.understated; });

  function months(n) {
    var y = Math.floor(n / 12), m = n % 12;
    return (y ? y + (y === 1 ? " yr " : " yrs ") : "") + (m ? m + " mths" : "");
  }

  var best = cmp[cmp.best];
  var rows = best.order.map(function (o, i) {
    return "<li><b>" + esc(o.name) + "</b> — cleared month " + o.month +
      " (" + esc(o.via) + ")</li>";
  }).join("");

  // A quoted rate can rank a hire purchase as the cheapest debt when it is the dearest.
  // Say so plainly, because it inverts the whole answer.
  var flatNote = misranked.length
    ? '<div class="warnbox" style="margin-top:12px"><b>Ranked by real cost.</b> ' +
      misranked.map(function (d) {
        return esc(d.name) + " quotes " + esc(pct(d.quotedRatePct)) + " flat but actually costs <b>" +
          esc(pct(d.effectiveRatePct)) + "</b>";
      }).join("; ") + ". Ordering by the quoted figure would pay it off last when it should " +
      "be first. Extra money cannot reduce a flat-rate loan's charges either, so here it is " +
      "accumulated until the facility can be settled outright.</div>"
    : "";

  $("strategyResult").innerHTML =
    '<p class="note" style="margin-bottom:12px">With ' + esc(fmtRM(extra.value || 0)) +
    " a month spare on top of every minimum. When a debt clears, its instalment rolls into the next.</p>" +
    '<div class="lsum">' +
    '<div><div class="k">Best order</div><div class="v" style="font-size:17px">' +
      (cmp.best === "avalanche" ? "Dearest first" : "Smallest first") + "</div></div>" +
    '<div><div class="k">Debt-free in</div><div class="v">' + esc(months(best.monthsToDebtFree)) + "</div></div>" +
    '<div><div class="k">Interest saved</div><div class="v">' + esc(fmtRM(cmp.interestSavedVsMinimums)) +
      '</div><div class="k" style="margin-top:4px">vs minimums only</div></div>' +
    '<div><div class="k">Time saved</div><div class="v">' + esc(months(cmp.monthsSavedVsMinimums)) + "</div></div>" +
    "</div>" +
    flatNote +
    '<div class="cmp"><b>Order to clear them in:</b><ul class="losslist">' + rows + "</ul>" +
    (cmp.avalancheAdvantage > 0
      ? "Paying the dearest first saves <b>" + esc(fmtRM(cmp.avalancheAdvantage)) +
        "</b> more than paying the smallest first. If clearing a small debt quickly would keep " +
        "you going, that is a reasonable trade for the difference."
      : "Both orders cost the same here, so take whichever keeps you at it.") + "</div>";
}

function renderLoans() {
  var list = WM.live(state.liabilities);
  if (!list.length) {
    $("loanList").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">No loans</div>' +
      '<div class="es">Add a liability on the Accounts tab to see its schedule.</div></div></div>';
    return;
  }

  var period = WM.currentPeriod();
  $("loanList").innerHTML = list.map(function (l) {
    var s = WM.scheduleFor(l);

    if (s.error) {
      return '<div class="card" style="margin-bottom:12px"><div class="acct-h">' +
        '<span class="acct-n">' + esc(l.name) + "</span></div>" +
        '<div class="dangerbox" style="margin-top:10px">' + esc(s.error) + "</div></div>";
    }
    if (!s.rows.length) {
      return '<div class="card" style="margin-bottom:12px"><div class="acct-h">' +
        '<span class="acct-n">' + esc(l.name) + "</span>" +
        '<span class="tag">' + (l.rateBasis === "flat" ? "Flat rate" : "Reducing") + "</span></div>" +
        '<p class="note" style="margin-top:8px">Enter principal, rate and tenure to see a schedule.</p></div>';
    }

    var pos = WM.positionInSchedule(s, period);
    var open = !!openSchedules[l.id];

    // The same terms on the other basis. For a hire purchase this is the number that
    // shows what the flat quote actually costs.
    var other = l.rateBasis === "flat"
      ? WM.reducingSchedule({ principal: l.principal, ratePct: l.ratePct, tenureMonths: l.tenureMonths })
      : WM.flatSchedule({ principal: l.principal, ratePct: l.ratePct, tenureMonths: l.tenureMonths });
    var cmp = "";
    if (other.rows.length && l.rateBasis === "flat") {
      cmp = '<div class="cmp">At the same quoted rate on a reducing basis this loan would cost <b>' +
        esc(fmtRM(other.totalInterest)) + "</b> in interest instead of <b>" + esc(fmtRM(s.totalInterest)) +
        "</b> — a flat quote of " + esc(pct(l.ratePct)) + " really costs about <b>" +
        esc(pct(s.effectiveRatePct)) + "</b> a year.</div>";
    }

    var rows = s.rows.map(function (r) {
      var isPaid = r.period && r.period <= period;
      return '<tr' + (isPaid ? ' class="paid"' : "") + "><td>" + r.n + "</td><td>" +
        esc(r.period ? monthLabel(r.period) : "—") + '</td><td class="r">' + esc(fmtRM(r.payment)) +
        '</td><td class="r">' + esc(fmtRM(r.interest)) + '</td><td class="r">' + esc(fmtRM(r.principal)) +
        '</td><td class="r">' + esc(fmtRM(r.balance)) + "</td></tr>";
    }).join("");

    // Whether this loan has ever been checked against a real statement, and how it went.
    var chk = checkFor(l.id);
    var rec = chk ? WM.reconcile(s, chk) : null;
    var checkTag = '<span class="tag">Unverified</span>';
    if (rec && rec.found) {
      checkTag = rec.verdict === "exact"
        ? '<span class="tag good">Matches statement</span>'
        : rec.termsVerified
          // The instalment matched even though something else did not — the terms are
          // right, so the schedule's shape can be trusted even if a rest-basis detail
          // is still off.
          ? '<span class="tag good">Instalment verified</span>'
          : rec.verdict === "close" && !rec.mustBeExact
            ? '<span class="tag">Close to statement</span>'
            : '<span class="tag" style="background:rgba(226,80,79,.16);color:#f08585">Disagrees with statement</span>';
    }

    var sim = renderSimulator(l, s);

    return '<div class="card" style="margin-bottom:12px">' +
      '<div class="acct-h"><span class="acct-n">' + esc(l.name) + "</span>" +
      '<span class="tag">' + (s.basis === "flat" ? "Flat rate" : "Reducing balance") + "</span>" +
      '<span class="tag">' + esc(pct(l.ratePct)) + "</span>" +
      checkTag +
      "</div>" +
      '<div class="lsum">' +
      '<div><div class="k">Instalment</div><div class="v">' + esc(fmtRM(s.instalment)) + "</div></div>" +
      '<div><div class="k">Total interest</div><div class="v">' + esc(fmtRM(s.totalInterest)) + "</div></div>" +
      '<div><div class="k">Total payable</div><div class="v">' + esc(fmtRM(s.totalPaid)) + "</div></div>" +
      '<div><div class="k">Effective rate</div><div class="v">' + esc(pct(s.effectiveRatePct)) + "</div></div>" +
      '<div><div class="k">Payoff</div><div class="v">' + esc(s.payoffPeriod ? monthLabel(s.payoffPeriod) : "—") + "</div></div>" +
      (pos ? '<div><div class="k">Paid so far</div><div class="v">' + pos.instalmentsPaid + " / " + s.months + "</div></div>" : "") +
      "</div>" +
      drawAmortChart(s) + cmp + sim +
      '<button class="btn sm" data-sched="' + esc(l.id) + '">' +
      (open ? "Hide schedule" : "Show schedule (" + s.months + " rows)") + "</button>" +
      (open ? '<div class="tscroll"><table><thead><tr><th>#</th><th>Month</th>' +
        '<th class="r">Payment</th><th class="r">Interest</th><th class="r">Principal</th>' +
        '<th class="r">Balance</th></tr></thead><tbody>' + rows + "</tbody></table></div>" : "") +
      "</div>";
  }).join("");

  bindAll("[data-sched]", "data-sched", function (id) {
    openSchedules[id] = !openSchedules[id];
    renderLoans();
  });

  // Recalculates on change rather than on every keystroke, so a half-typed "1,2" is not
  // briefly read as RM 1.20 and the caret is left where the owner put it.
  Array.prototype.forEach.call(document.querySelectorAll("[data-simpay]"), function (el) {
    el.onchange = function () {
      var id = el.getAttribute("data-simpay");
      var parsed = WM.parseAmount(el.value);
      simInputs[id] = simInputs[id] || {};
      simInputs[id].payment = parsed.error ? undefined : parsed.value;
      renderLoans();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-simsettle]"), function (el) {
    el.onchange = function () {
      var id = el.getAttribute("data-simsettle");
      simInputs[id] = simInputs[id] || {};
      simInputs[id].settleAfter = parseInt(el.value, 10) || 0;
      renderLoans();
    };
  });
}

// ---- physical assets -------------------------------------------------------

function renderAssets() {
  var list = WM.live(state.assets);
  if (!list.length) {
    $("assetList").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">No physical assets</div>' +
      '<div class="es">Add a property or vehicle to include it in net worth.</div></div></div>';
    return;
  }
  var period = WM.currentPeriod();
  $("assetList").innerHTML = list.map(function (a) {
    var eq = WM.equityFor(state, a.id, period);
    var equityLine = "";
    if (eq && eq.liabilityName) {
      // Equity is shown per asset only — the asset and its loan already sit on opposite
      // sides of the net worth total, so adding equity again would double count.
      equityLine = '<div class="prev">Equity ' + esc(fmtRM(eq.equity)) + " — " +
        esc(fmtRM(eq.value)) + " less " + esc(fmtRM(eq.owed)) + " owed on " + esc(eq.liabilityName) + "</div>";
    }
    return '<div class="acct"><div class="acct-h">' +
      '<span class="acct-n">' + esc(a.name) + "</span>" +
      '<span class="tag">' + esc(a.class || "—") + "</span>" +
      (a.liquid ? "" : '<span class="tag">Illiquid</span>') +
      '<div class="spacer"></div>' +
      '<span class="wv">' + (eq ? esc(fmtRM(eq.value)) + (eq.stale ? '<span class="stale-mark">*</span>' : "") : "—") + "</span>" +
      '<button class="btn sm" data-edit-asset="' + esc(a.id) + '">Edit</button>' +
      "</div>" + equityLine + "</div>";
  }).join("");
  bindAll("[data-edit-asset]", "data-edit-asset", openAsset);
}

function openAsset(id) {
  editing.asset = id;
  var r = id ? WM.byId(state.assets, id) : null;
  var period = WM.currentPeriod();
  $("assetModalT").textContent = r ? "Edit asset" : "Add asset";
  $("s_name").value = r ? r.name : "";
  $("s_class").value = r ? (r.class || "property") : "property";
  $("s_acquired").value = r && r.acquiredOn ? String(r.acquiredOn).slice(0, 7) : period;
  $("s_cost").value = r ? WM.formatAmount(r.cost) : "";

  var pos = r ? WM.positionFor(state, r.id, period) : null;
  $("s_value").value = pos ? WM.formatAmount(pos.balance) : "";

  $("s_liab").innerHTML = '<option value="">Not financed</option>' +
    options(WM.live(state.liabilities), r ? r.linkedLiabilityId : null);
  $("s_liquid").checked = r ? !!r.liquid : false;
  $("assetDelete").style.display = r ? "" : "none";

  var eq = r ? WM.equityFor(state, r.id, period) : null;
  $("s_equityNote").textContent = eq && eq.liabilityName
    ? "Equity today: " + fmtRM(eq.equity) + " (" + fmtRM(eq.value) + " less " + fmtRM(eq.owed) + " owed)."
    : "Changing the current value records it against " + monthLabel(period) +
      ", so past months keep the value they had at the time.";
  showErrors("assetErr", []);
  openModal("assetModal");
}

$("assetSave").onclick = function () {
  var cost = WM.parseAmount($("s_cost").value);
  var value = WM.parseAmount($("s_value").value);
  var acquired = $("s_acquired").value;
  var errors = [];
  if (cost.error) errors.push("Purchase cost must be a number");
  if (value.error) errors.push("Current value must be a number");
  if (acquired && !WM.isPeriod(acquired)) errors.push("Acquired must be a valid month");

  var rec = {
    id: editing.asset || undefined,
    name: $("s_name").value.trim(),
    class: $("s_class").value,
    acquiredOn: acquired || null,
    cost: cost.value,
    linkedLiabilityId: $("s_liab").value || null,
    liquid: $("s_liquid").checked
  };
  errors = errors.concat(WM.validate("assets", rec, state));
  if (showErrors("assetErr", errors)) return;

  var saved = WM.upsert(state, "assets", rec, deviceId);

  // The purchase cost is a real, dated figure — seed it at acquisition so historical
  // months show what the asset was worth then, not what it is worth now.
  if (acquired && cost.value !== null && !WM.valuationFor(state, saved.id, acquired)) {
    WM.upsertValuation(state, {
      assetId: saved.id, period: acquired, balance: cost.value, note: "purchase cost"
    }, deviceId);
  }
  if (value.value !== null) {
    var period = WM.currentPeriod();
    var existing = WM.positionFor(state, saved.id, period);
    if (!existing || existing.balance !== value.value || existing.stale) {
      WM.upsertValuation(state, { assetId: saved.id, period: period, balance: value.value }, deviceId);
    }
  }

  closeModal("assetModal");
  commit();
  toast(editing.asset ? "Asset updated" : "Asset added");
};

$("assetDelete").onclick = function () { removeRecord("assets", editing.asset, "assetModal", "Asset"); };
$("addAssetBtn").onclick = function () { openAsset(null); };

// ---- liabilities -----------------------------------------------------------

function renderLiabilities() {
  var list = WM.live(state.liabilities);
  if (!list.length) {
    $("liabList").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">No liabilities</div>' +
      '<div class="es">Add a mortgage, car loan or card to include debt in net worth.</div></div></div>';
    return;
  }
  var period = WM.currentPeriod();
  $("liabList").innerHTML = list.map(function (l) {
    var pos = WM.positionFor(state, l.id, period);
    return '<div class="acct"><div class="acct-h">' +
      '<span class="acct-n">' + esc(l.name) + "</span>" +
      '<span class="tag">' + esc(l.type || "—") + "</span>" +
      '<span class="tag">' + (l.rateBasis === "flat" ? "Flat rate" : "Reducing") + "</span>" +
      '<div class="spacer"></div>' +
      '<span class="wv">' + (pos ? esc(fmtRM(pos.balance)) + (pos.stale ? '<span class="stale-mark">*</span>' : "") : "—") + "</span>" +
      '<button class="btn sm" data-edit-liab="' + esc(l.id) + '">Edit</button>' +
      "</div></div>";
  }).join("");
  bindAll("[data-edit-liab]", "data-edit-liab", openLiab);
}

function checkFor(liabilityId) {
  var list = WM.live(state.loanChecks);
  for (var i = 0; i < list.length; i++) {
    if (list[i].liabilityId === liabilityId) return list[i];
  }
  return null;
}

// Renders the verdict of the last statement check, in words as well as colour (NFR-9).
function renderCheckResult(liability) {
  var box = $("c_result");
  var chk = liability ? checkFor(liability.id) : null;
  if (!liability || !chk) { box.innerHTML = ""; return; }

  var res = WM.reconcile(WM.scheduleFor(liability), chk);
  if (!res) { box.innerHTML = ""; return; }
  if (!res.found) {
    box.innerHTML = '<div class="warnbox" style="margin-top:12px">' + esc(res.message) + "</div>";
    return;
  }

  function line(label, cmp) {
    if (!cmp) return "";
    var word = cmp.diff === 0 ? "matches exactly"
      : (cmp.diff > 0 ? "statement is " : "statement is ") + fmtRM(Math.abs(cmp.diff)) +
        (cmp.diff > 0 ? " higher" : " lower");
    return "<li>" + esc(label) + ": engine " + esc(fmtRM(cmp.expected)) +
      ", statement " + esc(fmtRM(cmp.actual)) + " — <b>" + esc(word) + "</b></li>";
  }

  var cls = res.verdict === "exact" ? "warnbox" : res.verdict === "close" ? "warnbox" : "dangerbox";
  var headline;
  if (res.verdict === "exact") {
    headline = "<b>Matches to the sen.</b> The engine agrees with your statement for " +
      esc(monthLabel(res.period)) + ".";
  } else if (res.verdict === "close" && !res.mustBeExact) {
    headline = "<b>Close, not exact.</b> Expected on a Malaysian mortgage: most are daily rest, " +
      "where interest depends on the exact day each payment lands, while this engine computes " +
      "monthly rest. A small, month-length-dependent gap is the signature of that.";
  } else {
    headline = "<b>Does not match.</b> " + (res.mustBeExact
      ? "Flat-rate hire purchase is fixed by the Hire Purchase Act, so any difference means the engine or the terms are wrong — not a rounding convention."
      : "The gap is too large to be a rest-basis difference. Check the rate, tenure and start month first.");
  }

  box.innerHTML = '<div class="' + cls + '" style="margin-top:12px">' + headline +
    '<ul class="losslist">' + line("Interest", res.interest) + line("Balance", res.balance) +
    line("Instalment", res.instalment) + "</ul></div>";
}

function openLiab(id) {
  editing.liab = id;
  var r = id ? WM.byId(state.liabilities, id) : null;
  var chk = r ? checkFor(r.id) : null;
  $("c_period").value = chk ? chk.period : "";
  $("c_interest").value = chk ? WM.formatAmount(chk.statementInterest) : "";
  $("c_balance").value = chk ? WM.formatAmount(chk.statementBalance) : "";
  $("c_instalment").value = chk ? WM.formatAmount(chk.statementInstalment) : "";
  renderCheckResult(r);
  $("liabModalT").textContent = r ? "Edit liability" : "Add liability";
  $("l_name").value = r ? r.name : "";
  $("l_type").value = r ? (r.type || "mortgage") : "mortgage";
  $("l_basis").value = r ? (r.rateBasis || "reducing") : "reducing";
  $("l_principal").value = r ? WM.formatAmount(r.principal) : "";
  $("l_rate").value = r && r.ratePct ? r.ratePct : "";
  $("l_tenure").value = r && r.tenureMonths ? r.tenureMonths : "";
  $("l_instalment").value = r ? WM.formatAmount(r.instalment) : "";
  $("liabDelete").style.display = r ? "" : "none";
  showErrors("liabErr", []);
  openModal("liabModal");
}

// ---- month entry -----------------------------------------------------------

function fmtRM(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(period) {
  if (!WM.isPeriod(period)) return period || "";
  var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[parseInt(period.slice(5, 7), 10) - 1] + " " + period.slice(0, 4);
}

// Holdings whose account is neither archived nor tombstoned. Archived accounts drop out
// of entry but keep their history (FR-1.5).
function holdingsForEntry() {
  return WM.live(state.holdings).filter(function (h) {
    var a = WM.byId(state.accounts, h.accountId);
    return a && !a.deleted && !a.archived;
  });
}

// One row per thing that needs a monthly figure: holdings get four fields, liabilities
// just an outstanding balance.
function monthSubjects() {
  var subjects = holdingsForEntry().map(function (h) {
    var acct = WM.byId(state.accounts, h.accountId);
    var inst = acct ? WM.byId(state.institutions, acct.institutionId) : null;
    return {
      kind: "holding", id: h.id, name: h.name,
      context: (inst ? inst.name + " · " : "") + (acct ? acct.name : ""),
      fields: WM.AMOUNT_FIELDS
    };
  });
  WM.live(state.liabilities).forEach(function (l) {
    subjects.push({
      kind: "liability", id: l.id, name: l.name,
      context: l.type || "liability",
      fields: ["balance"]
    });
  });
  return subjects;
}

function renderMonth() {
  var period = $("periodPick").value;
  var holdings = monthSubjects();

  if (!holdings.length) {
    $("monthRows").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">Nothing to record yet</div>' +
      '<div class="es">Add an institution, an account and a holding first.</div></div></div>';
    $("monthActions").style.display = "none";
    return;
  }
  $("monthActions").style.display = "";

  $("monthRows").innerHTML = holdings.map(function (h) {
    var existing = WM.isPeriod(period) ? WM.valuationFor(state, h.id, period) : null;
    var prior = WM.isPeriod(period) ? WM.lastRecordedBefore(state, h.id, period) : null;

    var fields = h.fields.map(function (f) {
      var label = {
        balance: h.kind === "liability" ? "Outstanding balance" : "Closing balance",
        contribution: "Added", withdrawal: "Withdrawn", income: "Income"
      }[f];
      var stored = existing && existing[f] !== null && existing[f] !== undefined ? existing[f] : null;
      return '<div><label for="m_' + esc(h.id) + "_" + f + '">' + label + "</label>" +
        '<input type="text" inputmode="decimal" id="m_' + esc(h.id) + "_" + f + '"' +
        ' data-hold="' + esc(h.id) + '" data-field="' + f + '" value="' + esc(WM.formatAmount(stored)) + '"' +
        ' placeholder="—"></div>';
    }).join("");

    return '<div class="mrow' + (h.kind === "liability" ? " liab" : "") + '" id="mrow_' + esc(h.id) + '">' +
      '<div class="mrow-h"><span class="mrow-n">' + esc(h.name) + "</span>" +
      '<span class="mrow-s">' + esc(h.context) + "</span></div>" +
      '<div class="mgrid">' + fields + "</div>" +
      (prior ? '<div class="prev">Last recorded: ' + esc(fmtRM(prior.balance)) +
        " in " + esc(monthLabel(prior.period)) + "</div>" : "") +
      "</div>";
  }).join("");

  wireAmountFields();

  var recorded = holdings.filter(function (h) {
    return WM.isPeriod(period) && WM.valuationFor(state, h.id, period);
  }).length;
  $("monthSummary").textContent = recorded + " of " + holdings.length + " recorded for " + monthLabel(period);
}

// Formatted while at rest, plain digits while being edited. Formatting on blur rather
// than on every keystroke keeps the caret where the owner put it — live reformatting
// has to reposition the caret around inserted separators, and gets it wrong often
// enough to be worse than the problem it solves. A field left mid-edit still saves,
// because parseAmount reads the raw form too.
function wireAmountFields() {
  Array.prototype.forEach.call(document.querySelectorAll(".mgrid input"), function (el) {
    el.onfocus = function () {
      var parsed = WM.parseAmount(el.value);
      if (parsed.error === null) el.value = WM.rawAmount(parsed.value);
      if (el.select) el.select();
    };
    el.onblur = function () {
      var parsed = WM.parseAmount(el.value);
      // Leave an unparseable value exactly as typed — it is about to be flagged, and
      // blanking it would hide the mistake.
      if (parsed.error) return;
      el.value = WM.formatAmount(parsed.value);
      el.classList.remove("badfield");
    };
  });
}

$("saveMonthBtn").onclick = function () {
  var period = $("periodPick").value;
  var rows = monthSubjects().map(function (h) {
    var row = h.kind === "liability" ? { liabilityId: h.id } : { holdingId: h.id };
    h.fields.forEach(function (f) {
      var el = $("m_" + h.id + "_" + f);
      row[f] = el ? el.value : "";
    });
    return row;
  });

  var res = WM.applyMonth(state, period, rows, deviceId);
  var saved = res.created + res.updated;

  // Save first — commit() re-renders these rows from state, so anything marked on the
  // DOM beforehand would be wiped, along with the text the owner actually typed.
  if (saved || res.deleted) commit();

  Array.prototype.forEach.call(document.querySelectorAll(".mrow"), function (el) {
    el.classList.remove("bad");
  });
  Array.prototype.forEach.call(document.querySelectorAll(".mgrid input"), function (el) {
    el.classList.remove("badfield");
  });

  if (res.errors.length) {
    // Point at the offending field, and put the rejected text back so it can be
    // corrected rather than retyped from memory.
    res.errors.forEach(function (e) {
      if (!e.holdingId) return;
      var row = $("mrow_" + e.holdingId);
      if (row) row.classList.add("bad");
      var field = $("m_" + e.holdingId + "_" + e.field);
      if (!field) return;
      field.classList.add("badfield");
      var typed = rows.filter(function (r) { return r.holdingId === e.holdingId; })[0];
      if (typed) field.value = typed[e.field];
    });
    showErrors("monthErr", res.errors.map(function (e) {
      var h = e.holdingId ? WM.byId(state.holdings, e.holdingId) : null;
      return h ? h.name + ": " + e.message + " in " + e.field : e.message;
    }));
  } else {
    showErrors("monthErr", []);
  }

  if (saved || res.deleted) {
    var parts = [];
    if (saved) parts.push(saved + " saved");
    if (res.deleted) parts.push(res.deleted + " cleared");
    if (res.errors.length) parts.push(res.errors.length + " skipped");
    toast(parts.join(", ") + " for " + monthLabel(period));
  } else if (res.errors.length) {
    toast("Nothing saved — " + res.errors.length + " row(s) need fixing");
  } else {
    toast("Nothing to save");
  }
};

$("periodPick").onchange = renderMonth;

// ---- accounts view ---------------------------------------------------------

function renderTree() {
  var E = WM;
  var institutions = E.live(state.institutions);
  var showArchived = $("showArchived").checked;

  if (!institutions.length) {
    $("tree").innerHTML = '<div class="card"><div class="empty">' +
      '<div class="et">No institutions yet</div>' +
      '<div class="es">Add the bank, fund provider or broker that holds your money.</div>' +
      '<button class="btn pri" id="firstInstBtn">Add first institution</button></div></div>';
    wire("firstInstBtn", function () { openInst(null); });
    return;
  }

  var html = institutions.map(function (inst) {
    var accounts = E.accountsFor(state, inst.id).filter(function (a) {
      return showArchived || !a.archived;
    });

    var acctHtml = accounts.map(function (a) {
      var holdings = E.holdingsFor(state, a.id);
      var tags = "";
      if (a.pidmProtected) tags += '<span class="tag good">PIDM</span> ';
      if (a.shariah) tags += '<span class="tag">Shariah</span> ';
      if (!a.liquid) tags += '<span class="tag">Illiquid</span> ';
      if (a.archived) tags += '<span class="tag mute">Archived</span> ';

      var holdHtml = holdings.map(function (h) {
        // Realised beside advertised — the Fund Desk principle (G5). A fund quoting
        // 4.5% that actually paid 3.9% should say so on the same line.
        var n = WM.netOfFees(state, h);
        var yieldHtml = "";
        if (n) {
          var beat = n.versusAdvertised >= 0;
          yieldHtml = '<span class="yield ' + (beat ? "up" : "dn") + '">' +
            (beat ? "▲ " : "▼ ") + esc(n.realisedPct.toFixed(2)) + "% realised" +
            (n.feePct ? " · " + esc(n.netPct.toFixed(2)) + "% net" : "") +
            " · " + n.months + (n.months === 1 ? " month" : " months") + "</span>";
        }
        // Units and cost basis for a unit-based holding. A fixed-price fund reports no
        // unrealised gain by design — its return is the dividend, already counted.
        var unitHtml = "";
        if (h.unitBased) {
          var pos = WM.position(state, h, WM.currentPeriod());
          if (pos && pos.units) {
            unitHtml = '<span class="yield neu">' +
              esc(pos.units.toLocaleString("en-MY")) + " units @ " +
              esc(WM.formatAmount(pos.unitPrice)) +
              (pos.fixedPrice ? " fixed" : "") + "</span>";
            if (!pos.fixedPrice && pos.unrealisedPct !== null) {
              var up = pos.unrealisedGain >= 0;
              unitHtml += '<span class="yield ' + (up ? "up" : "dn") + '">' +
                (up ? "▲ " : "▼ ") + esc(fmtRM(Math.abs(pos.unrealisedGain))) +
                " (" + esc(pos.unrealisedPct.toFixed(1)) + "%) unrealised</span>";
            }
          }
        }

        return '<div class="hold"><span>' + esc(h.name) + '</span>' +
          '<span class="tag">' + esc(h.instrumentType || "—") + "</span>" +
          (h.rate ? '<span>' + esc(String(h.rate)) + "% advertised</span>" : "") +
          yieldHtml + unitHtml +
          '<div class="spacer"></div>' +
          '<button class="btn sm" data-edit-hold="' + esc(h.id) + '">Edit</button></div>';
      }).join("");

      return '<div class="acct"><div class="acct-h">' +
        '<span class="acct-n">' + esc(a.name) + "</span>" +
        '<span class="tag">' + esc(a.class) + "</span>" +
        (a.currency && a.currency !== "MYR" ? '<span class="tag">' + esc(a.currency) + "</span>" : "") +
        tags +
        '<div class="spacer"></div>' +
        '<button class="btn sm" data-edit-acct="' + esc(a.id) + '">Edit</button>' +
        '<button class="btn sm" data-add-hold="' + esc(a.id) + '">+ Holding</button>' +
        "</div>" + holdHtml + "</div>";
    }).join("");

    return '<div class="inst"><div class="inst-h">' +
      '<span class="inst-n">' + esc(inst.name) + "</span>" +
      '<span class="tag">' + esc(inst.type || "—") + "</span>" +
      (inst.pidmMember ? '<span class="tag good">PIDM member</span>' : "") +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-edit-inst="' + esc(inst.id) + '">Edit</button>' +
      '<button class="btn sm" data-add-acct="' + esc(inst.id) + '">+ Account</button>' +
      "</div>" +
      (acctHtml || '<p class="note" style="margin-bottom:8px">No accounts yet.</p>') +
      "</div>";
  }).join("");

  $("tree").innerHTML = html;

  bindAll("[data-edit-inst]", "data-edit-inst", openInst);
  bindAll("[data-edit-acct]", "data-edit-acct", openAcct);
  bindAll("[data-edit-hold]", "data-edit-hold", openHold);
  bindAll("[data-add-acct]", "data-add-acct", function (id) { openAcct(null, id); });
  bindAll("[data-add-hold]", "data-add-hold", function (id) { openHold(null, id); });
}

function bindAll(selector, attr, fn) {
  Array.prototype.forEach.call(document.querySelectorAll(selector), function (el) {
    el.onclick = function () { fn(el.getAttribute(attr)); };
  });
}

// ---- editors ---------------------------------------------------------------

var editing = { inst: null, acct: null, hold: null, liab: null, asset: null, scenario: null, goal: null };

function openModal(id) { $(id).classList.add("on"); }
function closeModal(id) { $(id).classList.remove("on"); }

function showErrors(boxId, errors) {
  var box = $(boxId);
  if (!errors.length) { box.classList.remove("on"); box.innerHTML = ""; return false; }
  box.innerHTML = "<ul>" + errors.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>";
  box.classList.add("on");
  return true;
}

function options(list, selectedId, labelFn) {
  return list.map(function (r) {
    return '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? " selected" : "") + ">" +
      esc(labelFn ? labelFn(r) : r.name) + "</option>";
  }).join("");
}

function openInst(id) {
  editing.inst = id;
  var r = id ? WM.byId(state.institutions, id) : null;
  $("instModalT").textContent = r ? "Edit institution" : "Add institution";
  $("i_name").value = r ? r.name : "";
  $("i_type").value = r ? (r.type || "bank") : "bank";
  $("i_pidm").checked = r ? !!r.pidmMember : false;
  $("instDelete").style.display = r ? "" : "none";
  showErrors("instErr", []);
  openModal("instModal");
}

$("instSave").onclick = function () {
  var rec = {
    id: editing.inst || undefined,
    name: $("i_name").value.trim(),
    type: $("i_type").value,
    pidmMember: $("i_pidm").checked
  };
  if (showErrors("instErr", WM.validate("institutions", rec, state))) return;
  WM.upsert(state, "institutions", rec, deviceId);
  closeModal("instModal");
  commit();
  toast(editing.inst ? "Institution updated" : "Institution added");
};

$("instDelete").onclick = function () { removeRecord("institutions", editing.inst, "instModal", "Institution"); };

function openAcct(id, institutionId) {
  editing.acct = id;
  var r = id ? WM.byId(state.accounts, id) : null;
  $("acctModalT").textContent = r ? "Edit account" : "Add account";
  $("a_inst").innerHTML = options(WM.live(state.institutions), r ? r.institutionId : institutionId);
  $("a_name").value = r ? r.name : "";
  $("a_class").value = r ? r.class : "cash";
  $("a_cur").value = r ? r.currency : "MYR";
  $("a_shariah").checked = r ? !!r.shariah : false;
  $("a_liquid").checked = r ? !!r.liquid : true;
  $("a_pidm").checked = r ? !!r.pidmProtected : false;
  $("a_arch").checked = r ? !!r.archived : false;
  $("acctDelete").style.display = r ? "" : "none";
  showErrors("acctErr", []);
  openModal("acctModal");
}

$("acctSave").onclick = function () {
  var rec = {
    id: editing.acct || undefined,
    name: $("a_name").value.trim(),
    institutionId: $("a_inst").value,
    class: $("a_class").value,
    currency: $("a_cur").value.trim().toUpperCase(),
    shariah: $("a_shariah").checked,
    liquid: $("a_liquid").checked,
    pidmProtected: $("a_pidm").checked,
    archived: $("a_arch").checked
  };
  if (showErrors("acctErr", WM.validate("accounts", rec, state))) return;
  WM.upsert(state, "accounts", rec, deviceId);
  closeModal("acctModal");
  commit();
  toast(editing.acct ? "Account updated" : "Account added");
};

$("acctDelete").onclick = function () { removeRecord("accounts", editing.acct, "acctModal", "Account"); };

function openHold(id, accountId) {
  editing.hold = id;
  var r = id ? WM.byId(state.holdings, id) : null;
  $("holdModalT").textContent = r ? "Edit holding" : "Add holding";
  $("h_acct").innerHTML = options(WM.live(state.accounts), r ? r.accountId : accountId, function (a) {
    var inst = WM.byId(state.institutions, a.institutionId);
    return (inst ? inst.name + " · " : "") + a.name;
  });
  $("h_name").value = r ? r.name : "";
  $("h_type").value = r ? (r.instrumentType || "Money market") : "Money market";
  $("h_rate").value = r && r.rate ? r.rate : "";
  $("h_fee").value = r && r.feePct ? r.feePct : "";
  $("h_sales").value = r && r.salesPct ? r.salesPct : "";
  $("h_relief").innerHTML = '<option value="">Not relief-eligible</option>' +
    WM.CATEGORIES.map(function (c) {
      return '<option value="' + esc(c.key) + '"' + (r && r.reliefCategory === c.key ? " selected" : "") + ">" + esc(c.label) + "</option>";
    }).join("");
  $("h_units").checked = r ? !!r.unitBased : false;
  $("h_fixed").value = r && r.fixedPrice ? String(r.fixedPrice) : "";
  $("holdDelete").style.display = r ? "" : "none";
  showErrors("holdErr", []);
  openModal("holdModal");
}

$("holdSave").onclick = function () {
  var fixedPrice = WM.parseAmount($("h_fixed").value);
  var rec = {
    id: editing.hold || undefined,
    name: $("h_name").value.trim(),
    accountId: $("h_acct").value,
    instrumentType: $("h_type").value,
    rate: parseFloat($("h_rate").value) || 0,
    feePct: parseFloat($("h_fee").value) || 0,
    salesPct: parseFloat($("h_sales").value) || 0,
    unitBased: $("h_units").checked,
    reliefCategory: $("h_relief").value || null,
    fixedPrice: fixedPrice.value
  };
  var holdErrors = WM.validate("holdings", rec, state);
  if (fixedPrice.error) holdErrors = holdErrors.concat(["Fixed unit price must be a number"]);
  if (showErrors("holdErr", holdErrors)) return;
  WM.upsert(state, "holdings", rec, deviceId);
  closeModal("holdModal");
  commit();
  toast(editing.hold ? "Holding updated" : "Holding added");
};

$("holdDelete").onclick = function () { removeRecord("holdings", editing.hold, "holdModal", "Holding"); };

// Refuses rather than cascading: tombstoning a parent would detach years of history
// from one tap. The owner archives, or clears the children first.
function removeRecord(entity, id, modalId, label) {
  var check = WM.canDelete(state, entity, id);
  if (!check.ok) {
    var blocking = Object.keys(check.dependents).filter(function (k) { return check.dependents[k] > 0; });
    var total = blocking.reduce(function (n, k) { return n + check.dependents[k]; }, 0);
    var parts = blocking.map(function (k) {
      return check.dependents[k] + " " + entityLabel(k, check.dependents[k]);
    });
    // Derived, not a hardcoded chain: a new modal previously fell through to the
    // holdings error box, so the refusal appeared nowhere and the delete looked inert.
    showErrors(modalId.replace("Modal", "Err"),
      ["Cannot delete — " + parts.join(" and ") + (total === 1 ? " still belongs" : " still belong") +
       " to this record. Remove them first, or archive instead to keep the history."]);
    return;
  }
  WM.softDelete(state[entity], id, deviceId);
  closeModal(modalId);
  commit();
  toast(label + " deleted");
}

Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
  b.onclick = function () { closeModal(b.getAttribute("data-close")); };
});
Array.prototype.forEach.call(document.querySelectorAll(".modal-bg"), function (bg) {
  bg.onclick = function (e) { if (e.target === bg) bg.classList.remove("on"); };
});

$("liabSave").onclick = function () {
  var principal = WM.parseAmount($("l_principal").value);
  var instalment = WM.parseAmount($("l_instalment").value);
  var errors = [];
  if (principal.error) errors.push("Original principal must be a number");
  if (instalment.error) errors.push("Monthly instalment must be a number");

  var rec = {
    id: editing.liab || undefined,
    name: $("l_name").value.trim(),
    type: $("l_type").value,
    rateBasis: $("l_basis").value,
    principal: principal.value,
    ratePct: parseFloat($("l_rate").value) || 0,
    tenureMonths: parseInt($("l_tenure").value, 10) || 0,
    instalment: instalment.value
  };
  errors = errors.concat(WM.validate("liabilities", rec, state));
  if (showErrors("liabErr", errors)) return;

  var savedLiab = WM.upsert(state, "liabilities", rec, deviceId);

  // The statement check is the owner's own record of what the bank said. Saved as data,
  // never folded back into the calculation.
  var cPeriod = $("c_period").value;
  var cInterest = WM.parseAmount($("c_interest").value);
  var cBalance = WM.parseAmount($("c_balance").value);
  var cInstalment = WM.parseAmount($("c_instalment").value);
  var anyFigure = cInterest.value !== null || cBalance.value !== null || cInstalment.value !== null;

  if (cPeriod && !WM.isPeriod(cPeriod)) {
    showErrors("liabErr", ["Statement month must be a valid month"]);
    return;
  }
  if (anyFigure && !cPeriod) {
    showErrors("liabErr", ["Give the statement month those figures belong to"]);
    return;
  }
  if (cInterest.error || cBalance.error || cInstalment.error) {
    showErrors("liabErr", ["Statement figures must be numbers"]);
    return;
  }

  var existingCheck = checkFor(savedLiab.id);
  if (cPeriod && anyFigure) {
    var chk = existingCheck || WM.newLoanCheck(deviceId);
    chk.liabilityId = savedLiab.id;
    chk.period = cPeriod;
    chk.statementInterest = cInterest.value;
    chk.statementBalance = cBalance.value;
    chk.statementInstalment = cInstalment.value;
    chk.updatedAt = WM.nowIso();
    chk.deviceId = deviceId;
    chk.deleted = false;
    if (!existingCheck) state.loanChecks.push(chk);
  } else if (existingCheck && !anyFigure) {
    WM.softDelete(state.loanChecks, existingCheck.id, deviceId);
  }

  closeModal("liabModal");
  commit();
  toast(editing.liab ? "Liability updated" : "Liability added");
};

$("liabDelete").onclick = function () { removeRecord("liabilities", editing.liab, "liabModal", "Liability"); };
$("addLiabBtn").onclick = function () { openLiab(null); };

$("scenarioSave").onclick = function () {
  var contrib = WM.parseAmount($("sc_contrib").value);
  if (contrib.error) { showErrors("scenarioErr", ["Monthly amount must be a number"]); return; }

  // Editing an assumption is the point at which the defaults become the owner's own
  // data — until now they existed only in memory.
  materialiseScenarios();
  var sc = WM.byId(state.scenarios, editing.scenario);
  if (!sc) return;

  sc.growthAssumptions = {
    cash: parseFloat($("sc_cash").value) || 0,
    investment: parseFloat($("sc_inv").value) || 0,
    retirement: parseFloat($("sc_ret").value) || 0,
    property: parseFloat($("sc_prop").value) || 0,
    other: 0,
    vehicle: (sc.growthAssumptions && sc.growthAssumptions.vehicle) || -10
  };
  sc.inflationPct = parseFloat($("sc_infl").value) || 0;
  sc.monthlyContribution = contrib.value || 0;
  sc.updatedAt = WM.nowIso();
  sc.deviceId = deviceId;

  closeModal("scenarioModal");
  commit();
  toast(sc.name + " assumptions updated");
};

$("horizon").onchange = function () { renderForecast(); renderDecision(); };
$("strat_extra").onchange = renderStrategy;
$("dec_loan").onchange = renderDecision;
$("dec_amount").onchange = renderDecision;
$("dec_growth").onchange = renderDecision;
$("realTerms").onchange = renderForecast;

$("addInstBtn").onclick = function () { openInst(null); };
$("showArchived").onchange = renderTree;
$("allocDim").onchange = renderAllocation;

Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
  t.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) {
      x.classList.toggle("on", x === t);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) {
      v.classList.toggle("on", v.id === "v-" + t.getAttribute("data-v"));
    });
    window.scrollTo(0, 0);
  };
});

function render() {
  if (!$("periodPick").value) $("periodPick").value = WM.currentPeriod();
  renderWorth();
  renderForecast();
  renderRelief();
  renderGoals();
  renderDecision();
  renderAllocation();
  renderResilience();
  renderSettingsFields();
  renderPidm();
  renderMonth();
  renderTree();
  renderLiabilities();
  renderAssets();
  renderStrategy();
  renderLoans();

  var counts = [
    ["Institutions", liveCount(state.institutions)],
    ["Accounts", liveCount(state.accounts)],
    ["Holdings", liveCount(state.holdings)],
    ["Valuations", liveCount(state.valuations)],
    ["Assets", liveCount(state.assets)],
    ["Liabilities", liveCount(state.liabilities)]
  ];
  $("kpis").innerHTML = counts.map(function (c) {
    return '<div class="kpi"><div class="k">' + esc(c[0]) + '</div><div class="v">' + c[1] + "</div></div>";
  }).join("");

  var bytes = 0;
  try { bytes = (localStorage.getItem(WM.STORE_KEY) || "").length; } catch (e) {}
  $("storageInfo").textContent = "Schema v" + state.schemaVersion + " · about " +
    (bytes < 1024 ? bytes + " bytes" : (bytes / 1024).toFixed(1) + " KB") + " cached in this browser.";

  $("csvRow").innerHTML = Object.keys(WM.COLUMNS).map(function (entity) {
    return '<button class="btn sm" data-csv="' + esc(entity) + '">' + esc(entity) + "</button>";
  }).join("");
  Array.prototype.forEach.call(document.querySelectorAll("[data-csv]"), function (b) {
    b.onclick = function () { exportCsv(b.getAttribute("data-csv")); };
  });

  renderFileSection();
}

// ---- data file -------------------------------------------------------------

function connect(picker, readFirst) {
  picker("wealth-master.json").then(function (handle) {
    fileHandle = handle;
    return WM.checkPermission(handle).then(function (p) {
      if (p !== "granted") return WM.requestPermission(handle);
      return p;
    }).then(function (p) {
      filePermission = p;
      // Opening an existing file means adopting its contents — but only through the
      // same guard as any other import, so a stale file cannot quietly win.
      if (readFirst && p === "granted") {
        return WM.read(handle).then(function (text) {
          applyImport(text, "file");
        });
      }
      return saveToFile();
    });
  }).then(render).catch(function (err) {
    if (err && err.name === "AbortError") return;
    console.error("Connect failed:", err);
    toast("Could not connect to that file");
  });
}

function reconnect() {
  if (!fileHandle) return;
  WM.requestPermission(fileHandle).then(function (p) {
    filePermission = p;
    if (p === "granted") return saveToFile().then(function () { toast("Reconnected"); });
    toast("Permission denied — changes stay in this browser only");
    render();
  });
}

function disconnectFile() {
  WM.disconnect().then(function () {
    fileHandle = null;
    filePermission = "prompt";
    lastSavedAt = null;
    render();
    toast("Disconnected — export manually to keep a copy");
  });
}

function restoreFile() {
  WM.restore().then(function (handle) {
    if (!handle) return;
    fileHandle = handle;
    return WM.checkPermission(handle).then(function (p) {
      filePermission = p;
      render();
    });
  }).catch(function () { /* no handle stored; stay disconnected */ });
}

// ---- import, guarded -------------------------------------------------------

var pendingImport = null;

// Runs every inbound state through the guard before it can replace anything.
function applyImport(text, source) {
  var incoming;
  try {
    incoming = WM.migrate(JSON.parse(text));
  } catch (err) {
    toast("That file could not be read");
    return;
  }

  var assessment = WM.assessImport(incoming, state);
  if (assessment.safe) {
    adoptState(incoming);
    toast(source === "file" ? "Loaded from file" : "Imported");
    return;
  }
  pendingImport = incoming;
  showImportWarning(assessment);
}

function adoptState(incoming) {
  state = incoming;
  if (state.settings && state.settings.theme) {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
  }
  commit();
}

function showImportWarning(a) {
  var device = a.incomingDevices.length ? a.incomingDevices[0].deviceId : "another device";
  var age = a.daysApart === null ? "an unknown age"
    : a.daysApart === 0 ? "less than a day older" : a.daysApart + " day" + (a.daysApart === 1 ? "" : "s") + " older";

  var items = Object.keys(a.losses.byEntity).map(function (k) {
    var n = a.losses.byEntity[k];
    return "<li>" + n + " " + esc(entityLabel(k, n)) + "</li>";
  }).join("");

  $("importModalBody").innerHTML =
    '<div class="dangerbox">This file was last changed on <b>' + esc(device) + '</b> and is ' +
    esc(age) + ' than the data in this browser. Importing it discards <b>' +
    a.losses.total + ' change' + (a.losses.total === 1 ? "" : "s") + '</b> made here:' +
    '<ul class="losslist">' + items + "</ul></div>" +
    '<p class="note" style="margin-top:12px">Export a copy first if you are unsure — this cannot be undone.</p>';
  $("importModal").classList.add("on");
}

$("importConfirm").onclick = function () {
  if (pendingImport) adoptState(pendingImport);
  pendingImport = null;
  $("importModal").classList.remove("on");
  toast("Imported — local changes discarded");
};
$("importCancel").onclick = function () {
  pendingImport = null;
  $("importModal").classList.remove("on");
};
$("importModal").onclick = function (e) {
  if (e.target === $("importModal")) $("importCancel").onclick();
};

// ---- export ----------------------------------------------------------------

function download(blob, name) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function exportJSON() {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  var name = "wealth-master-" + stamp() + ".json";
  if (window.showSaveFilePicker) {
    try {
      var h = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
      });
      var w = await h.createWritable();
      await w.write(blob);
      await w.close();
      toast("Exported");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  download(blob, name);
  toast("Exported");
}

function exportCsv(entity) {
  var csv = WM.entityToCsv(state, entity);
  if (csv === null) return;
  download(new Blob([csv], { type: "text/csv" }), "wealth-master-" + entity + "-" + stamp() + ".csv");
  toast(entity + " exported");
}

$("exportBtn").onclick = exportJSON;
$("importBtn").onclick = function () { $("fileIn").click(); };
$("fileIn").onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () { applyImport(r.result, "import"); };
  r.readAsText(f);
  this.value = "";
};

$("migrateBtn").onclick = function () { $("migrateFile").click(); };
$("migrateFile").onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    try {
      var res = WM.migrateFromFundDesk(JSON.parse(r.result), deviceId, state.institutions);
      state.institutions = state.institutions.concat(res.institutions);
      state.accounts = state.accounts.concat(res.accounts);
      state.holdings = state.holdings.concat(res.holdings);
      state.valuations = state.valuations.concat(res.valuations);
      commit();
      if (res.warnings.length) {
        toast("Imported with " + res.warnings.length + " warning(s) — see console");
        res.warnings.forEach(function (w) { console.warn(w); });
      } else {
        toast("Migrated " + res.holdings.length + " holdings, " + res.valuations.length + " valuations");
      }
    } catch (err) {
      toast("That file could not be read");
    }
  };
  r.readAsText(f);
  this.value = "";
};

$("themeBtn").onclick = function () {
  var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  state.settings.theme = next;
  commit();
};

$("wipeBtn").onclick = function () {
  if (!confirm("Erase all Wealth Master data from this browser? Export first if you want a copy.")) return;
  state = WM.blank();
  commit();
  toast("Everything erased");
};

// Last line of defence for the manual-export browsers: never let the tab close on
// unsaved work without the browser's own confirmation.
window.addEventListener("beforeunload", function (e) {
  if (!dirty) return;
  if (fileHandle && filePermission === "granted") return;
  e.preventDefault();
  e.returnValue = "";
});

if (state.settings && state.settings.theme) {
  document.documentElement.setAttribute("data-theme", state.settings.theme);
}
render();
restoreFile();
