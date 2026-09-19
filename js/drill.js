"use strict";
// Wealth Master — drill-down (P7.4, docs/ui-redesign-plan.md)
//
// Every figure on the Net worth screen is a summary of something. This module turns a
// figure into the list of lines behind it, so a card can open onto the numbers it adds up
// from: what makes up "Assets", what is in "Retirement", which lines moved.
//
// Like the headline strip, everything here reads the SAME net worth positions the rest of
// the app reads (networth.positionAt), never re-summing valuations, so a list can never
// disagree with the card that opened it. A holding left out of net worth for want of an
// exchange rate has no value here either; it is listed, and marked, rather than added at
// face value.
//
// Rules carried over: blank is not zero (a month with nothing recorded has no point, not a
// zero one), and a figure carried forward from an earlier month stays flagged.
// Reads state and returns data; it never mutates.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./networth.js"), require("./entities.js"),
      require("./categories.js"), require("./valuations.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (nw, ent, cat, val) {

  // What a card can open. `net` is everything; the rest are the parts of it.
  var CATEGORY_LABELS = {};
  cat.ASSET_CATEGORIES.forEach(function (c) { CATEGORY_LABELS[c.key] = c.label; });

  var SCOPES = [
    { key: "net", label: "Net worth" },
    { key: "assets", label: "Assets" },
    { key: "liabilities", label: "Liabilities" },
    { key: "liquid", label: "Liquid assets" },
    { key: "investable", label: "Investable assets" }
  ].concat(cat.ASSET_CATEGORIES.map(function (c) { return { key: c.key, label: c.label }; }));

  function scopeInfo(key) {
    for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].key === key) return SCOPES[i];
    return null;
  }

  // The ways a list or a chart can be cut. `category` is the strip's own categories, so a
  // slice here matches a card on the Net worth screen.
  var DIMENSIONS = {
    category: { label: "Category", of: function (r) { return r.categoryLabel; } },
    institution: { label: "Institution", of: function (r) { return r.institution; } },
    type: { label: "Type", of: function (r) { return r.type || "—"; } },
    liquidity: { label: "Liquidity", of: function (r) { return r.liquid ? "Liquid" : "Illiquid"; } },
    rate: { label: "Rate basis", of: function (r) { return r.rateBasis || "—"; } }
  };

  // Which cuts make sense for a scope. Liabilities have no institution or liquidity, and a
  // scope that is already one category gains nothing from being cut by category.
  function dimensionsFor(key) {
    if (key === "liabilities") return ["type", "rate"];
    if (cat.ASSET_CATEGORIES.some(function (c) { return c.key === key; })) {
      return ["institution", "type", "liquidity"];
    }
    return ["category", "institution", "type", "liquidity"];
  }

  function lineRow(state, line) {
    var row = {
      kind: line.kind, id: line.id, name: line.name,
      side: line.kind === "liability" ? "liability" : "asset",
      liquid: !!line.liquid, stale: !!line.stale, sourcePeriod: line.sourcePeriod,
      // A foreign holding with no rate is a line without a ringgit value, not a zero.
      convertible: line.convertible !== false,
      value: line.convertible === false ? null : line.balance,
      institution: "", type: "", rateBasis: "", category: "", categoryLabel: ""
    };

    if (line.kind === "holding") {
      var h = ent.byId(state.holdings, line.id);
      var acct = h ? ent.byId(state.accounts, h.accountId) : null;
      var inst = acct ? ent.byId(state.institutions, acct.institutionId) : null;
      row.institution = inst ? inst.name : "—";
      row.type = (h && h.instrumentType) || (acct && acct.class) || "";
      row.category = cat.holdingCategory(state, line);
    } else if (line.kind === "asset") {
      var a = ent.byId(state.assets, line.id);
      row.institution = "Directly held";
      row.type = (a && a.class) || "";
      row.category = "useAssets";
    } else {
      var l = ent.byId(state.liabilities, line.id);
      row.type = (l && l.type) || "";
      row.rateBasis = l ? (l.rateBasis === "flat" ? "Flat rate" : "Reducing") : "";
      row.category = "liabilities";
    }
    row.categoryLabel = row.side === "liability" ? "Liabilities" : (CATEGORY_LABELS[row.category] || "Other");
    return row;
  }

  // Every line at a period, each with what it was a month earlier so the list can say what
  // moved. A carried-forward line has no change: nothing was recorded, which is not the
  // same as nothing happening.
  function drillRows(state, period) {
    var p = period || val.currentPeriod();
    var now = nw.positionAt(state, p);
    var before = {};
    nw.positionAt(state, val.prevPeriod(p)).lines.forEach(function (l) {
      if (l.convertible !== false) before[l.id] = l.balance;
    });
    return now.lines.map(function (line) {
      var row = lineRow(state, line);
      var prev = before[line.id];
      row.prev = prev === undefined ? null : prev;
      row.change = (row.value === null || row.stale || prev === undefined) ? null : row.value - prev;
      return row;
    });
  }

  function inScope(row, key) {
    switch (key) {
      case "net": return true;
      case "assets": return row.side === "asset";
      case "liabilities": return row.side === "liability";
      case "liquid": return row.side === "asset" && row.liquid;
      case "investable": return row.category === "freeCash" || row.category === "investments";
      default: return row.side === "asset" && row.category === key;
    }
  }

  function drillScope(rows, key) {
    if (!scopeInfo(key)) return null;
    return rows.filter(function (r) { return inScope(r, key); });
  }

  // The figure a card shows for this scope. Net worth is assets less liabilities, so a
  // liability row subtracts there and adds everywhere else it appears.
  function drillTotal(rows, key) {
    var t = 0, stale = false, counted = 0;
    rows.forEach(function (r) {
      if (r.value === null) return;
      t += (key === "net" && r.side === "liability") ? -r.value : r.value;
      counted++;
      if (r.stale) stale = true;
    });
    return { value: t, partial: stale, count: counted };
  }

  // The same scope a month earlier, for "change since last month". Only lines that existed
  // in both months are compared, so a newly opened account is not reported as growth.
  function drillChange(rows, key) {
    var now = 0, then = 0, n = 0;
    rows.forEach(function (r) {
      if (r.value === null || r.prev === null) return;
      var sign = (key === "net" && r.side === "liability") ? -1 : 1;
      now += sign * r.value;
      then += sign * r.prev;
      n++;
    });
    if (!n) return null;
    return { delta: now - then, pct: then ? (now - then) / Math.abs(then) * 100 : null, lines: n };
  }

  // Slices for a donut: assets only, positive balances, like the allocation chart, since
  // mixing debt into a share-of-portfolio chart makes the slices meaningless.
  function drillGroups(rows, dim) {
    var def = DIMENSIONS[dim] || DIMENSIONS.category;
    var buckets = {}, order = [], total = 0;
    rows.forEach(function (r) {
      if (r.value === null || r.value <= 0) return;
      var k = def.of(r);
      if (!buckets[k]) { buckets[k] = { label: k, value: 0, count: 0, partial: false }; order.push(k); }
      buckets[k].value += r.value;
      buckets[k].count += 1;
      if (r.stale) buckets[k].partial = true;
      total += r.value;
    });
    return {
      dimension: dim, label: def.label, total: total,
      slices: order.map(function (k) {
        var b = buckets[k];
        b.share = total ? b.value / total * 100 : 0;
        return b;
      }).sort(function (a, b) { return b.value - a.value; })
    };
  }

  // The scope's total at every recorded month. A month in which the scope holds nothing has
  // no point: an account opened this year did not have a RM 0 balance last year.
  function drillTrend(state, key) {
    var pts = nw.series(state, val.currentPeriod());
    var out = [];
    pts.forEach(function (pt) {
      var rows = nw.positionAt(state, pt.period).lines.map(function (line) { return lineRow(state, line); });
      var scoped = rows.filter(function (r) { return inScope(r, key); });
      var t = drillTotal(scoped, key);
      if (!t.count) return;
      out.push({ period: pt.period, value: t.value, partial: t.partial });
    });
    return out;
  }

  return {
    DRILL_SCOPES: SCOPES,
    drillScopeInfo: scopeInfo,
    DRILL_DIMENSIONS: DIMENSIONS,
    drillDimensionsFor: dimensionsFor,
    drillRows: drillRows,
    drillScope: drillScope,
    drillTotal: drillTotal,
    drillChange: drillChange,
    drillGroups: drillGroups,
    drillTrend: drillTrend
  };
});
