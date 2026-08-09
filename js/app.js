"use strict";
// Wealth Master — P0 shell: store wiring, migration UI, export/import. No analytics yet.

var deviceId = WM.getDeviceId();
var state = WM.load().state;

function $(id) { return document.getElementById(id); }

function commit() {
  var res = WM.save(state);
  if (!res.ok) toast("Could not save — storage may be full or blocked");
  render();
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

function render() {
  var counts = [
    ["Institutions", liveCount(state.institutions)],
    ["Accounts", liveCount(state.accounts)],
    ["Holdings", liveCount(state.holdings)],
    ["Valuations", liveCount(state.valuations)],
    ["Assets", liveCount(state.assets)],
    ["Liabilities", liveCount(state.liabilities)]
  ];
  $("kpis").innerHTML = counts.map(function (c) {
    return '<div class="kpi"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>';
  }).join("");

  var bytes = 0;
  try { bytes = (localStorage.getItem(WM.STORE_KEY) || "").length; } catch (e) {}
  $("storageInfo").textContent = "Schema v" + state.schemaVersion + " · about " +
    (bytes < 1024 ? bytes + " bytes" : (bytes / 1024).toFixed(1) + " KB") + " stored in this browser.";

  $("syncLabel").textContent = state.sync.status === "offline" ? "Offline" : state.sync.status;
}

$("themeBtn").onclick = function () {
  var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  state.settings.theme = next;
  commit();
};

async function exportJSON() {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  var name = "wealth-master-" + new Date().toISOString().slice(0, 10) + ".json";
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
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast("Exported");
}

function importJSON(text) {
  try {
    var o = WM.migrate(JSON.parse(text));
    state = o;
    if (state.settings && state.settings.theme) {
      document.documentElement.setAttribute("data-theme", state.settings.theme);
    }
    commit();
    toast("Imported");
  } catch (err) {
    toast("That file could not be read");
  }
}

$("exportBtn").onclick = exportJSON;
$("importBtn").onclick = function () { $("fileIn").click(); };
$("fileIn").onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () { importJSON(r.result); };
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
      var fdExport = JSON.parse(r.result);
      var res = WM.migrateFromFundDesk(fdExport, deviceId, state.institutions);
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

$("wipeBtn").onclick = function () {
  if (!confirm("Erase all Wealth Master data from this browser? Export first if you want a copy.")) return;
  state = WM.blank();
  commit();
  toast("Everything erased");
};

if (state.settings && state.settings.theme) {
  document.documentElement.setAttribute("data-theme", state.settings.theme);
}
render();
