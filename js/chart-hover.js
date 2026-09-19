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

  // Donuts: point at a slice (or its legend row) and it lifts, the rest dim, and a pop-out
  // names it. Slices and legend rows carry data-slice="<n>"; items[n].html is the pop-out.
  function attachSlices(host, legendHost, items) {
    if (!host || !items || !items.length) return null;
    var svg = host.querySelector("svg.chart");
    if (!svg) return null;
    var doc = host.ownerDocument;
    host.classList.add("hover-host");

    var tip = doc.createElement("div");
    tip.className = "hv-tip";
    tip.setAttribute("role", "status");
    tip.hidden = true;
    host.appendChild(tip);

    var slices = Array.prototype.slice.call(svg.querySelectorAll("[data-slice]"));
    var rows = legendHost ? Array.prototype.slice.call(legendHost.querySelectorAll("[data-slice]")) : [];
    var current = -1;

    function place(x, y) {
      var hr = host.getBoundingClientRect();
      var w = tip.offsetWidth || 0, h = tip.offsetHeight || 0;
      var left = x - hr.left + 14, top = y - hr.top + 14;
      if (hr.width) {
        if (left + w > hr.width) left = x - hr.left - w - 14;
        left = Math.max(0, Math.min(left, hr.width - w));
      }
      if (hr.height) top = Math.max(0, Math.min(top, hr.height - h));
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }

    function centreOf(i) {
      var r = slices[i] ? slices[i].getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      return [r.left + r.width / 2, r.top + r.height / 2];
    }

    function show(i, x, y) {
      if (i < 0 || i >= items.length) return;
      current = i;
      svg.classList.add("hv-dim");
      slices.forEach(function (s) { s.classList.toggle("hv-on", s.getAttribute("data-slice") === String(i)); });
      rows.forEach(function (r) { r.classList.toggle("hv-on", r.getAttribute("data-slice") === String(i)); });
      tip.innerHTML = items[i].html;
      tip.hidden = false;
      if (x === undefined) { var c = centreOf(i); x = c[0]; y = c[1]; }
      place(x, y);
    }

    function hide() {
      current = -1;
      svg.classList.remove("hv-dim");
      slices.concat(rows).forEach(function (n) { n.classList.remove("hv-on"); });
      tip.hidden = true;
    }

    function idx(node) { return parseInt(node.getAttribute("data-slice"), 10); }

    slices.forEach(function (s) {
      s.setAttribute("tabindex", "0");
      s.addEventListener("pointermove", function (e) { show(idx(s), e.clientX, e.clientY); });
      s.addEventListener("pointerdown", function (e) { show(idx(s), e.clientX, e.clientY); });
      s.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") hide(); });
      s.addEventListener("focus", function () { show(idx(s)); });
      s.addEventListener("blur", hide);
      s.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { hide(); return; }
        var step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        slices[(slices.indexOf(s) + step + slices.length) % slices.length].focus();
      });
    });
    rows.forEach(function (r) {
      r.addEventListener("pointerenter", function (e) { if (e.pointerType !== "touch") show(idx(r)); });
      r.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") hide(); });
      r.addEventListener("pointerdown", function () { show(idx(r)); });
    });

    // A touch has no "leave": the pop-out stays until the next tap lands elsewhere.
    if (host._hvOutside) doc.removeEventListener("pointerdown", host._hvOutside);
    host._hvOutside = function (e) {
      if (!host.contains(e.target) && !(legendHost && legendHost.contains(e.target))) hide();
    };
    doc.addEventListener("pointerdown", host._hvOutside);

    return { show: show, hide: hide, index: function () { return current; } };
  }

  return { attachHover: attachHover, attachSlices: attachSlices };
});
