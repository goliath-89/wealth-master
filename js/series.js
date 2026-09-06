"use strict";
// Wealth Master — per-holding series over time (FR-6.3, FR-6.4, FR-6.8)
//
// Everything a multi-series chart needs, computed here rather than in the render layer,
// so the arithmetic is unit-testable and the drawing code only places marks.
//
// Three shapes, and they are deliberately not the same:
//
//   BALANCE is a stock. It carries forward — a month with no entry keeps the last known
//   figure — and a holding that has never been valued has no point at all rather than a
//   point at zero. A line that starts at RM 0 in January for an account opened in June
//   invents six months of history.
//
//   INCOME is a flow. It does not carry forward: a month with no income entry earned
//   nothing recorded, and that is a real answer, not a gap. So the bars are honest at
//   zero height where balance would have to be blank.
//
//   ROLLING YIELD is a derived rate over a window. It needs several months inside that
//   window before it means anything, so it returns null until it has them — an annualised
//   figure from one month's income is noise wearing a percentage sign.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./entities.js"), require("./valuations.js"), require("./networth.js"));
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (ent, val, nw) {

  // Annualising from a handful of months is how a fund that paid once looks like it pays
  // every month. Below this, the window reports nothing rather than a flattering number.
  var MIN_YIELD_MONTHS = 3;
  var DEFAULT_WINDOW = 12;

  function round(n) { return Math.round(n * 100) / 100; }

  // Every period with a valuation, oldest first — the x-axis every series shares.
  function periods(state) {
    return val.periodsInState(state);
  }

  // Holdings that count towards current totals, in a stable order so a series keeps its
  // colour between renders.
  function chartableHoldings(state) {
    return nw.contributingHoldings(state).slice().sort(function (a, b) {
      return (a.name || "") < (b.name || "") ? -1 : 1;
    });
  }

  // Balance at each period for one holding. `value` is null before the holding's first
  // recorded month — the chart must break the line there, not draw it along the floor.
  function balancePoints(state, holdingId, ps) {
    return ps.map(function (p) {
      var pos = nw.positionFor(state, holdingId, p);
      return {
        period: p,
        value: pos ? pos.balance : null,
        stale: pos ? pos.stale : false,
        sourcePeriod: pos ? pos.sourcePeriod : null
      };
    });
  }

  // One series per holding, plus the range the chart has to fit.
  function balanceSeries(state, through) {
    var ps = periods(state);
    if (through && val.isPeriod(through)) {
      ps = ps.filter(function (p) { return p <= through; });
    }
    var series = chartableHoldings(state).map(function (h) {
      var pts = balancePoints(state, h.id, ps);
      var recorded = pts.filter(function (pt) { return pt.value !== null; });
      return {
        id: h.id,
        name: h.name,
        points: pts,
        // A series with nothing recorded is dropped rather than drawn flat at zero.
        hasData: recorded.length > 0,
        latest: recorded.length ? recorded[recorded.length - 1].value : null
      };
    }).filter(function (s) { return s.hasData; });

    var vals = [];
    series.forEach(function (s) {
      s.points.forEach(function (pt) { if (pt.value !== null) vals.push(pt.value); });
    });

    return {
      periods: ps,
      series: series,
      min: vals.length ? Math.min.apply(null, vals) : 0,
      max: vals.length ? Math.max.apply(null, vals) : 0,
      unit: "currency"
    };
  }

  // Income recorded per period, split by the holding that paid it (FR-6.4). Income is a
  // flow, so nothing is carried forward and a month with no entry is a genuine zero.
  function incomeByMonth(state, through) {
    var ps = periods(state);
    if (through && val.isPeriod(through)) {
      ps = ps.filter(function (p) { return p <= through; });
    }

    var holdings = chartableHoldings(state);
    var byId = {};
    holdings.forEach(function (h) { byId[h.id] = h; });

    var index = {};
    (state.valuations || []).forEach(function (v) {
      if (v.deleted || !v.holdingId || !byId[v.holdingId]) return;
      if (!v.income) return;
      if (!index[v.period]) index[v.period] = {};
      index[v.period][v.holdingId] = (index[v.period][v.holdingId] || 0) + v.income;
    });

    // Only holdings that ever paid something get a band; a fund that has paid nothing
    // would otherwise sit in the legend as a colour that never appears in the chart.
    var sources = holdings.filter(function (h) {
      return ps.some(function (p) { return index[p] && index[p][h.id]; });
    }).map(function (h) {
      var total = ps.reduce(function (n, p) {
        return n + ((index[p] && index[p][h.id]) || 0);
      }, 0);
      return { id: h.id, name: h.name, total: round(total) };
    }).sort(function (a, b) { return b.total - a.total; });

    var rows = ps.map(function (p) {
      var parts = sources.map(function (s) {
        return { id: s.id, name: s.name, value: round((index[p] && index[p][s.id]) || 0) };
      });
      return {
        period: p,
        parts: parts,
        total: round(parts.reduce(function (n, x) { return n + x.value; }, 0))
      };
    });

    return {
      periods: ps,
      sources: sources,
      rows: rows,
      max: rows.length ? Math.max.apply(null, rows.map(function (r) { return r.total; })) : 0,
      grandTotal: round(rows.reduce(function (n, r) { return n + r.total; }, 0))
    };
  }

  // Trailing realised yield for one holding at one period, annualised from the months
  // inside the window that recorded both income and a balance. Same arithmetic as the
  // lifetime figure in analytics.js, over a moving window instead of everything.
  //
  // Returns null rather than a number when the window is too thin to annualise. A yield
  // is a claim about a rate of return; making one from two months is not a smaller claim,
  // it is a wrong one.
  function rollingYield(state, holdingId, period, windowMonths) {
    var w = windowMonths || DEFAULT_WINDOW;
    var rows = (state.valuations || []).filter(function (v) {
      if (v.deleted || v.holdingId !== holdingId) return false;
      if (v.income === null || v.income === undefined) return false;
      if (v.balance === null || v.balance === undefined || v.balance <= 0) return false;
      if (v.period > period) return false;
      var age = nw.monthsBetween(v.period, period);
      return age !== null && age < w;
    });
    if (rows.length < MIN_YIELD_MONTHS) return null;

    var income = 0, balance = 0;
    rows.forEach(function (v) { income += v.income; balance += v.balance; });
    var avg = balance / rows.length;
    if (avg <= 0) return null;

    return {
      pct: round((income / rows.length) * 12 / avg * 100),
      months: rows.length,
      windowMonths: w
    };
  }

  // One rolling-yield series per holding (FR-6.8), shaped like balanceSeries so both can
  // drive the same chart.
  function yieldSeries(state, through, windowMonths) {
    var ps = periods(state);
    if (through && val.isPeriod(through)) {
      ps = ps.filter(function (p) { return p <= through; });
    }

    var series = chartableHoldings(state).map(function (h) {
      var pts = ps.map(function (p) {
        var y = rollingYield(state, h.id, p, windowMonths);
        return { period: p, value: y ? y.pct : null, stale: false, months: y ? y.months : 0 };
      });
      var recorded = pts.filter(function (pt) { return pt.value !== null; });
      return {
        id: h.id,
        name: h.name,
        points: pts,
        hasData: recorded.length > 0,
        latest: recorded.length ? recorded[recorded.length - 1].value : null
      };
    }).filter(function (s) { return s.hasData; });

    var vals = [];
    series.forEach(function (s) {
      s.points.forEach(function (pt) { if (pt.value !== null) vals.push(pt.value); });
    });

    return {
      periods: ps,
      series: series,
      min: vals.length ? Math.min.apply(null, vals) : 0,
      max: vals.length ? Math.max.apply(null, vals) : 0,
      windowMonths: windowMonths || DEFAULT_WINDOW,
      unit: "percent"
    };
  }

  return {
    MIN_YIELD_MONTHS: MIN_YIELD_MONTHS,
    DEFAULT_WINDOW: DEFAULT_WINDOW,
    chartableHoldings: chartableHoldings,
    balancePoints: balancePoints,
    balanceSeries: balanceSeries,
    incomeByMonth: incomeByMonth,
    rollingYield: rollingYield,
    yieldSeries: yieldSeries
  };
});
