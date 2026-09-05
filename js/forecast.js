"use strict";
// Wealth Master — deterministic projection (FR-5.1, FR-5.2, FR-5.3, FR-5.8)
//
// Risk R3 governs this module: a forecast is easily mistaken for a promise. Three rules
// follow from that and are enforced here rather than left to the UI:
//
//   1. Every projected point carries the assumptions that produced it, so a number can
//      never be displayed without them.
//   2. Projections are always produced as a SET of scenarios. There is no single-scenario
//      entry point, because a lone line reads as a prediction.
//   3. Projected points are marked `projected: true` and never merged into actuals.
//
// Growth is applied per asset class. Cash and equities do not compound alike, and a
// single portfolio rate would flatter a cash-heavy position and understate a
// growth-heavy one.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(
      require("./schema.js"), require("./valuations.js"),
      require("./entities.js"), require("./networth.js"), require("./loans.js")
    );
  } else {
    root.WM = root.WM || {};
    var exported = factory(root.WM, root.WM, root.WM, root.WM, root.WM);
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function (schema, val, ent, nw, loans) {

  // Starting points, not recommendations. Deliberately unremarkable: the owner is meant
  // to replace them with their own view, and the UI keeps them on screen so they are
  // never forgotten.
  var DEFAULT_SCENARIOS = [
    {
      name: "Conservative", inflationPct: 3.0, monthlyContribution: 0,
      growth: { cash: 2.0, investment: 3.0, retirement: 4.0, other: 0, property: 0, vehicle: -10 }
    },
    {
      name: "Base", inflationPct: 2.5, monthlyContribution: 0,
      growth: { cash: 2.5, investment: 6.0, retirement: 5.5, other: 0, property: 3.0, vehicle: -10 }
    },
    {
      name: "Optimistic", inflationPct: 2.0, monthlyContribution: 0,
      growth: { cash: 3.0, investment: 9.0, retirement: 6.5, other: 0, property: 5.0, vehicle: -10 }
    }
  ];

  function defaultScenarios(deviceId) {
    return DEFAULT_SCENARIOS.map(function (s) {
      return schema.stamp({
        id: schema.uid(), name: s.name, inflationPct: s.inflationPct,
        monthlyContribution: s.monthlyContribution,
        growthAssumptions: JSON.parse(JSON.stringify(s.growth)),
        contributionSchedule: []
      }, deviceId);
    });
  }

  // Annual percentage to a monthly compounding factor. Uses the twelfth root rather than
  // dividing by twelve, so 12 months of growth actually lands on the annual figure.
  function monthlyFactor(annualPct) {
    var r = Number(annualPct) || 0;
    return Math.pow(1 + r / 100, 1 / 12);
  }

  function growthFor(scenario, key) {
    var g = scenario.growthAssumptions || {};
    return g[key] === undefined ? 0 : g[key];
  }

  // Projects one scenario forward from the latest recorded position.
  //
  // Liabilities are not grown or guessed: they amortise down using the same loan engines
  // that draw the schedules, so a projection and a loan schedule can never disagree
  // (FR-5.3). A liability with no usable terms holds flat rather than vanishing, which
  // would overstate net worth.
  function projectScenario(state, scenario, months, fromPeriod) {
    var start = fromPeriod || val.currentPeriod();
    var opening = nw.positionAt(state, start);

    // Seed each subject at its current balance, tagged with the growth key that applies.
    var lines = [];
    nw.contributingHoldings(state).forEach(function (h) {
      var pos = nw.positionFor(state, h.id, start);
      if (!pos) return;
      var acct = ent.byId(state.accounts, h.accountId);
      lines.push({
        kind: "holding", id: h.id, balance: pos.balance,
        growthKey: acct ? acct.class : "other",
        liquid: !!(acct && acct.liquid)
      });
    });
    ent.live(state.assets).forEach(function (a) {
      var pos = nw.positionFor(state, a.id, start);
      if (!pos) return;
      lines.push({ kind: "asset", id: a.id, balance: pos.balance, growthKey: a.class || "other", liquid: !!a.liquid });
    });

    // Each liability's own schedule, so the projection tracks real amortisation.
    var loanLines = ent.live(state.liabilities).map(function (l) {
      var pos = nw.positionFor(state, l.id, start);
      var schedule = loans.scheduleFor(l);
      return {
        id: l.id,
        openingBalance: pos ? pos.balance : null,
        schedule: schedule.rows.length ? schedule : null
      };
    }).filter(function (l) { return l.openingBalance !== null || l.schedule; });

    var points = [];
    var period = start;
    var contribution = Number(scenario.monthlyContribution) || 0;

    for (var m = 0; m <= months; m++) {
      if (m > 0) {
        period = nw.nextPeriod(period);
        lines.forEach(function (line) {
          var f = monthlyFactor(growthFor(scenario, line.growthKey));
          line.balance = line.balance * f;
          // New money goes to liquid financial holdings only — contributions do not
          // enlarge a house.
          if (line.kind === "holding" && line.liquid && contribution > 0) {
            line.balance += contribution / Math.max(1, liquidHoldingCount(lines));
          }
        });
      }

      var assets = lines.reduce(function (n, l) { return n + l.balance; }, 0);
      var liquid = lines.reduce(function (n, l) { return n + (l.liquid ? l.balance : 0); }, 0);

      var liabilities = 0;
      loanLines.forEach(function (l) {
        if (l.schedule) {
          var row = rowAt(l.schedule, period);
          // Past the payoff date the loan is gone, not frozen at its last balance.
          liabilities += row ? row.balance : (afterSchedule(l.schedule, period) ? 0 : (l.openingBalance || 0));
        } else {
          liabilities += l.openingBalance || 0;
        }
      });

      points.push({
        period: period,
        assets: Math.round(assets * 100) / 100,
        liabilities: Math.round(liabilities * 100) / 100,
        net: Math.round((assets - liabilities) * 100) / 100,
        liquid: Math.round(liquid * 100) / 100,
        projected: m > 0,
        monthsAhead: m
      });
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      // The assumptions travel with the numbers — a projected figure cannot be rendered
      // without the basis for it being available (FR-5.8).
      assumptions: {
        growth: JSON.parse(JSON.stringify(scenario.growthAssumptions || {})),
        inflationPct: Number(scenario.inflationPct) || 0,
        monthlyContribution: contribution
      },
      openingNet: opening.net,
      points: points,
      illustrative: true
    };
  }

  function liquidHoldingCount(lines) {
    return lines.filter(function (l) { return l.kind === "holding" && l.liquid; }).length;
  }

  function rowAt(schedule, period) {
    for (var i = 0; i < schedule.rows.length; i++) {
      if (schedule.rows[i].period === period) return schedule.rows[i];
    }
    return null;
  }

  function afterSchedule(schedule, period) {
    var last = schedule.rows[schedule.rows.length - 1];
    return !!(last && last.period && period > last.period);
  }

  // The only public way to project: always a set, never one line (R3).
  // `scenarios` may be supplied by the caller so unsaved defaults can be projected
  // without first being written to the store.
  function projectAll(state, months, fromPeriod, scenarios) {
    var list = scenarios || ent.live(state.scenarios);
    if (!list.length) return [];
    return list.map(function (s) {
      return projectScenario(state, s, months, fromPeriod);
    });
  }

  // Restates a projected figure in today's money, so a large future number is not
  // mistaken for a large future improvement.
  function inRealTerms(nominal, inflationPct, monthsAhead) {
    var f = Math.pow(1 + (Number(inflationPct) || 0) / 100, monthsAhead / 12);
    return Math.round((nominal / f) * 100) / 100;
  }

  // The spread across scenarios at a horizon — the range that must be shown instead of
  // any single figure.
  function rangeAt(projections, monthsAhead) {
    var nets = projections.map(function (p) {
      var pt = p.points[Math.min(monthsAhead, p.points.length - 1)];
      return pt ? pt.net : null;
    }).filter(function (n) { return n !== null; });
    if (!nets.length) return null;
    return {
      low: Math.min.apply(null, nets),
      high: Math.max.apply(null, nets),
      spread: Math.round((Math.max.apply(null, nets) - Math.min.apply(null, nets)) * 100) / 100
    };
  }

  return {
    DEFAULT_SCENARIOS: DEFAULT_SCENARIOS,
    defaultScenarios: defaultScenarios,
    monthlyFactor: monthlyFactor,
    projectScenario: projectScenario,
    projectAll: projectAll,
    inRealTerms: inRealTerms,
    rangeAt: rangeAt
  };
});
