"use strict";
// Wealth Master — import safety guard (ADR 001, NFR-7)
//
// The single-writer model has one dangerous case: importing a file that is older than
// what is already here, silently discarding local work. This module decides whether an
// import is safe and, when it is not, describes precisely what would be lost so the UI
// can say "this file is 3 days older and would discard 7 changes" rather than "are you
// sure?".
//
// Deliberately pure — no DOM, no storage, no File System Access API. This is the logic
// protecting against data loss, so it has to be testable without a browser.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./schema.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema) {

  var ENTITY_LISTS = schema.ENTITY_LISTS;

  // Every record across every entity list, tombstones included — a delete is a change.
  function allRecords(state) {
    var out = [];
    if (!state) return out;
    ENTITY_LISTS.forEach(function (key) {
      if (Array.isArray(state[key])) out = out.concat(state[key]);
    });
    return out;
  }

  // Most recent updatedAt anywhere in the state, or null for an empty//unstamped state.
  function latestChangeAt(state) {
    var latest = null;
    allRecords(state).forEach(function (r) {
      if (r && r.updatedAt && (latest === null || r.updatedAt > latest)) latest = r.updatedAt;
    });
    return latest;
  }

  // Which devices contributed the most recent edits, newest first. Used to name the
  // source in the warning ("this file is from your laptop") rather than showing a
  // meaningless device id.
  function contributingDevices(state) {
    var seen = {};
    allRecords(state).forEach(function (r) {
      if (!r || !r.deviceId) return;
      if (!seen[r.deviceId] || r.updatedAt > seen[r.deviceId]) seen[r.deviceId] = r.updatedAt;
    });
    return Object.keys(seen)
      .sort(function (a, b) { return seen[a] < seen[b] ? 1 : -1; })
      .map(function (id) { return { deviceId: id, lastChangeAt: seen[id] }; });
  }

  // Records present locally that the incoming file has never seen — either absent from
  // it entirely, or present but with an older updatedAt. These are what an import would
  // destroy, and they are counted per entity so the warning can be specific.
  function localChangesNotIn(incoming, local) {
    var incomingById = {};
    allRecords(incoming).forEach(function (r) {
      if (r && r.id) incomingById[r.id] = r;
    });

    var byEntity = {};
    var total = 0;
    ENTITY_LISTS.forEach(function (key) {
      var list = Array.isArray(local && local[key]) ? local[key] : [];
      var n = 0;
      list.forEach(function (r) {
        if (!r || !r.id) return;
        var match = incomingById[r.id];
        if (!match) { n++; return; }
        if (r.updatedAt && (!match.updatedAt || r.updatedAt > match.updatedAt)) n++;
      });
      if (n > 0) byEntity[key] = n;
      total += n;
    });
    return { total: total, byEntity: byEntity };
  }

  // Whole-day difference between two ISO timestamps, or null if either is missing.
  function daysBetween(aIso, bIso) {
    if (!aIso || !bIso) return null;
    var ms = Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime());
    return Math.floor(ms / 86400000);
  }

  // The decision. Returns:
  //   safe        — nothing local would be lost; import freely
  //   verdict     — "empty-local" | "newer" | "same" | "stale"
  //   losses      — { total, byEntity } local records the import would discard
  //   incomingAt / localAt / daysApart / incomingDevices
  //
  // "stale" does not mean "refuse". It means the UI must state the cost and make the
  // owner choose, per NFR-7: no silent loss, but never block a deliberate action.
  function assessImport(incoming, local) {
    var incomingAt = latestChangeAt(incoming);
    var localAt = latestChangeAt(local);
    var losses = localChangesNotIn(incoming, local);

    var verdict;
    if (losses.total === 0 && localAt === null) verdict = "empty-local";
    else if (losses.total === 0) verdict = incomingAt && localAt && incomingAt > localAt ? "newer" : "same";
    else verdict = "stale";

    return {
      safe: losses.total === 0,
      verdict: verdict,
      losses: losses,
      incomingAt: incomingAt,
      localAt: localAt,
      daysApart: daysBetween(incomingAt, localAt),
      incomingDevices: contributingDevices(incoming)
    };
  }

  return {
    latestChangeAt: latestChangeAt,
    contributingDevices: contributingDevices,
    localChangesNotIn: localChangesNotIn,
    assessImport: assessImport
  };
});
