"use strict";
// Wealth Master — chart hover layer (P7.1, docs/ui-redesign-plan.md)
//
// One behaviour for every hand-drawn SVG chart: point at it and a guide line snaps to the
// nearest data point, with a tooltip. The chart supplies the points and the (already
// escaped) tooltip HTML; this module owns the pointer, touch and keyboard handling, so
// every chart behaves the same way.
//
// Rules carried over from the rest of the app:
//   - It only reads and draws; it never touches state.
//   - Tooltip HTML comes from the caller, which escapes user strings (SEC-7). This module
//     never builds text from data itself.
//   - Hover does not exist on a phone, so a tap shows the tooltip and stays until the
//     next tap elsewhere. The keyboard gets arrow keys, Home/End and Esc.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.WM = root.WM || {};
    var exported = factory();
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function () {

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(doc, name, attrs) {
    var e = doc.createElementNS(SVG_NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // opts:
  //   points  [{ x, html, markers: [{ y, colour, hollow }] }] in viewBox units, ordered by x
  //   plot    { top, bottom } viewBox y-range the guide line spans
  // Returns { show(i), hide(), index() }, or null when there is nothing to attach to.
  function attachHover(host, opts) {
    if (!host || !opts || !opts.points || !opts.points.length) return null;
    var svg = host.querySelector("svg.chart");
    if (!svg) return null;

    var doc = host.ownerDocument;
    var points = opts.points;
    var plot = opts.plot || { top: 0, bottom: 0 };
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var vbW = vb && vb.width ? vb.width : parseFloat((svg.getAttribute("viewBox") || "").split(/\s+/)[2]) || 1;

    host.classList.add("hover-host");

    var layer = svgEl(doc, "g", { "class": "hv", "pointer-events": "none" });
    layer.style.display = "none";
    var line = svgEl(doc, "line", { "class": "hv-line", y1: plot.top, y2: plot.bottom });
    layer.appendChild(line);
    svg.appendChild(layer);

    var tip = doc.createElement("div");
    tip.className = "hv-tip";
    tip.setAttribute("role", "status");
    tip.hidden = true;
    host.appendChild(tip);

    // Focusable, so the keyboard has a way in. The label says what the arrows do.
    svg.setAttribute("tabindex", "0");

    var current = -1;

    function nearest(clientX) {
      var r = svg.getBoundingClientRect();
      var x = r.width ? ((clientX - r.left) / r.width) * vbW : 0;
      var best = 0, gap = Infinity;
      for (var i = 0; i < points.length; i++) {
        var d = Math.abs(points[i].x - x);
        if (d < gap) { gap = d; best = i; }
      }
      return best;
    }

    function show(i) {
      if (i < 0 || i >= points.length) return;
      current = i;
      var p = points[i];
      line.setAttribute("x1", p.x);
      line.setAttribute("x2", p.x);

      while (layer.childNodes.length > 1) layer.removeChild(layer.lastChild);
      (p.markers || []).forEach(function (m) {
        layer.appendChild(svgEl(doc, "circle", {
          cx: p.x, cy: m.y, r: 4.5,
          fill: m.hollow ? "var(--bg)" : m.colour,
          stroke: m.hollow ? m.colour : "var(--bg)",
          "stroke-width": 2
        }));
      });
      layer.style.display = "";

      tip.innerHTML = p.html;
      tip.hidden = false;

      // Sit beside the guide line, on whichever side has room.
      var sr = svg.getBoundingClientRect();
      var hr = host.getBoundingClientRect();
      var px = sr.width ? (p.x / vbW) * sr.width + (sr.left - hr.left) : 0;
      var w = tip.offsetWidth || 0, hw = hr.width || 0;
      // Beside the guide line on the side with room, then kept inside the chart: on a phone
      // the tooltip is wider than either half, and off-screen is unreadable.
      var left = px > hw / 2 ? px - w - 14 : px + 14;
      if (hw) left = Math.max(0, Math.min(left, hw - w));
      tip.style.left = left + "px";
    }

    function hide() {
      current = -1;
      layer.style.display = "none";
      tip.hidden = true;
    }

    svg.addEventListener("pointermove", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("pointerdown", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("pointerleave", function (e) {
      // A finger lifting is not "leaving": on touch the tooltip stays until the next tap.
      if (e.pointerType !== "touch") hide();
    });

    svg.addEventListener("keydown", function (e) {
      var i = current;
      if (e.key === "ArrowRight") i = i < 0 ? 0 : Math.min(points.length - 1, i + 1);
      else if (e.key === "ArrowLeft") i = i < 0 ? points.length - 1 : Math.max(0, i - 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = points.length - 1;
      else if (e.key === "Escape") { hide(); return; }
      else return;
      e.preventDefault();
      show(i);
    });
    svg.addEventListener("blur", hide);

    return { show: show, hide: hide, index: function () { return current; } };
  }

  return { attachHover: attachHover };
});
