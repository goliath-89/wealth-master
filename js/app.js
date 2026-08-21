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
        return '<div class="hold"><span>' + esc(h.name) + '</span>' +
          '<span class="tag">' + esc(h.instrumentType || "—") + "</span>" +
          (h.rate ? '<span>' + esc(String(h.rate)) + "% p.a.</span>" : "") +
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

var editing = { inst: null, acct: null, hold: null };

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
  $("h_units").checked = r ? !!r.unitBased : false;
  $("holdDelete").style.display = r ? "" : "none";
  showErrors("holdErr", []);
  openModal("holdModal");
}

$("holdSave").onclick = function () {
  var rec = {
    id: editing.hold || undefined,
    name: $("h_name").value.trim(),
    accountId: $("h_acct").value,
    instrumentType: $("h_type").value,
    rate: parseFloat($("h_rate").value) || 0,
    feePct: parseFloat($("h_fee").value) || 0,
    salesPct: parseFloat($("h_sales").value) || 0,
    unitBased: $("h_units").checked
  };
  if (showErrors("holdErr", WM.validate("holdings", rec, state))) return;
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
    showErrors(modalId === "instModal" ? "instErr" : modalId === "acctModal" ? "acctErr" : "holdErr",
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

$("addInstBtn").onclick = function () { openInst(null); };
$("showArchived").onchange = renderTree;

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
  renderTree();

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
