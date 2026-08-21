"use strict";
// Wealth Master — connected data file (ADR 001, replaces FR-7.1's Google Sheet)
//
// The JSON file in the owner's cloud-synced folder is the system of record; localStorage
// is only a cache. The File System Access API lets us hold a handle to that file across
// sessions, so saving is automatic rather than an export the owner must remember.
//
// Chromium desktop only. Safari and Firefox fall back to download-based export, which is
// why isSupported() is checked by the UI rather than assumed.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.WM = root.WM || {};
    var exported = factory();
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function () {

  var DB_NAME = "wealthmaster";
  var DB_STORE = "handles";
  var HANDLE_KEY = "dataFile";

  function isSupported() {
    return typeof self !== "undefined" &&
      typeof self.showSaveFilePicker === "function" &&
      typeof self.indexedDB !== "undefined";
  }

  // A file handle is a structured-cloneable object but not JSON-serialisable, so it has
  // to live in IndexedDB rather than localStorage.
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  function idbDelete(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  // "granted" | "prompt" | "denied". Browsers drop write permission between sessions, so
  // a restored handle usually reports "prompt" and needs a click to revive — which is why
  // the UI has a Reconnect state rather than silently failing to save.
  function checkPermission(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve("denied");
    return handle.queryPermission({ mode: "readwrite" });
  }

  // Must be called from a user gesture or the browser rejects it.
  function requestPermission(handle) {
    if (!handle || !handle.requestPermission) return Promise.resolve("denied");
    return handle.requestPermission({ mode: "readwrite" });
  }

  function connectNew(suggestedName) {
    return self.showSaveFilePicker({
      suggestedName: suggestedName || "wealth-master.json",
      types: [{ description: "Wealth Master data", accept: { "application/json": [".json"] } }]
    }).then(function (handle) {
      return idbPut(HANDLE_KEY, handle).then(function () { return handle; });
    });
  }

  function connectExisting() {
    return self.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Wealth Master data", accept: { "application/json": [".json"] } }]
    }).then(function (handles) {
      var handle = handles[0];
      return idbPut(HANDLE_KEY, handle).then(function () { return handle; });
    });
  }

  function restore() {
    if (!isSupported()) return Promise.resolve(null);
    return idbGet(HANDLE_KEY).catch(function () { return null; });
  }

  function disconnect() {
    return idbDelete(HANDLE_KEY).catch(function () { return null; });
  }

  function write(handle, state) {
    return handle.createWritable().then(function (writable) {
      return writable.write(JSON.stringify(state, null, 2)).then(function () {
        return writable.close();
      });
    });
  }

  function read(handle) {
    return handle.getFile().then(function (file) { return file.text(); });
  }

  return {
    isSupported: isSupported,
    checkPermission: checkPermission,
    requestPermission: requestPermission,
    connectNew: connectNew,
    connectExisting: connectExisting,
    restore: restore,
    disconnect: disconnect,
    write: write,
    read: read
  };
});
