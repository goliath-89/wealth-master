"use strict";
// Wealth Master — minimal .xlsx reader (FR-10.1)
//
// An .xlsx is a ZIP of XML. Both halves of that are available natively now —
// DecompressionStream("deflate-raw") inflates, and the SpreadsheetML we need is a narrow,
// machine-generated subset that a targeted scanner handles — so this reads a workbook
// with no library, no CDN and no build step.
//
// That matters more here than saving a few hundred lines. SheetJS would have to come from
// a CDN, which means widening the CSP that currently forbids every script origin but our
// own (SEC-9), and it would break the offline guarantee the whole app is built on. A
// spreadsheet reader is not worth either.
//
// XML is scanned rather than parsed with DOMParser because Node has no DOMParser, and
// pulling jsdom into the app to get one would put a test dependency in the shipping path.
// Regex over arbitrary XML would be a mistake; this is over a fixed, generated schema —
// cells, shared strings and cell formats — and every field it reads is asserted in tests
// against a real workbook.
//
// Reads values and one formatting fact: whether a cell is bold. Bold is how a balance
// sheet marks its totals, and a total imported as a line item double-counts the file.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.WM = root.WM || {};
    var exported = factory();
    for (var k in exported) root.WM[k] = exported[k];
  }
})(typeof self !== "undefined" ? self : this, function () {

  // ---- ZIP -----------------------------------------------------------------

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
  }

  // The end-of-central-directory record sits at the tail, after a comment of unknown
  // length, so it is found by scanning backwards for its signature.
  function findEocd(b) {
    for (var i = b.length - 22; i >= 0 && i > b.length - 65558; i--) {
      if (u32(b, i) === 0x06054b50) return i;
    }
    return -1;
  }

  // Returns { name: {offset, method, size} } for every entry, without inflating any.
  function readDirectory(b) {
    var eocd = findEocd(b);
    if (eocd < 0) throw new Error("Not a .xlsx file — no ZIP directory found");
    var count = u16(b, eocd + 10);
    var pos = u32(b, eocd + 16);
    var entries = {};
    for (var i = 0; i < count; i++) {
      if (u32(b, pos) !== 0x02014b50) break;
      var method = u16(b, pos + 10);
      var compSize = u32(b, pos + 20);
      var nameLen = u16(b, pos + 28);
      var extraLen = u16(b, pos + 30);
      var commentLen = u16(b, pos + 32);
      var localOffset = u32(b, pos + 42);
      var name = "";
      for (var c = 0; c < nameLen; c++) name += String.fromCharCode(b[pos + 46 + c]);
      entries[name] = { offset: localOffset, method: method, size: compSize };
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function inflate(bytes) {
    // deflate-raw, because ZIP stores the deflate payload without a zlib header.
    var ds = new DecompressionStream("deflate-raw");
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return new TextDecoder("utf-8").decode(new Uint8Array(buf));
    });
  }

  function readEntry(b, entries, name) {
    var e = entries[name];
    if (!e) return Promise.resolve(null);
    // The local header repeats the name and extra fields at its own lengths, so the
    // data offset cannot be taken from the central directory alone.
    if (u32(b, e.offset) !== 0x04034b50) return Promise.resolve(null);
    var nameLen = u16(b, e.offset + 26);
    var extraLen = u16(b, e.offset + 28);
    var start = e.offset + 30 + nameLen + extraLen;
    var data = b.subarray(start, start + e.size);
    if (e.method === 0) {
      return Promise.resolve(new TextDecoder("utf-8").decode(data));
    }
    if (e.method === 8) return inflate(data);
    return Promise.reject(new Error("Unsupported compression in the workbook"));
  }

  // ---- XML -----------------------------------------------------------------

  var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

  function decode(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, function (m, g) {
      if (ENTITIES[g] !== undefined) return ENTITIES[g];
      if (g.charAt(0) === "#") {
        var code = g.charAt(1) === "x" || g.charAt(1) === "X"
          ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return m;
    });
  }

  function attr(tag, name) {
    var m = tag.match(new RegExp("\\s" + name + '="([^"]*)"'));
    return m ? decode(m[1]) : null;
  }

  // sharedStrings.xml: each <si> is one string, possibly split across <r> runs, so all
  // <t> inside one <si> are concatenated. Missing the runs silently truncates any cell
  // whose text carries mixed formatting.
  function parseSharedStrings(xml) {
    if (!xml) return [];
    var out = [];
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var text = "";
      var tre = /<t[^>]*>([\s\S]*?)<\/t>/g, tm;
      while ((tm = tre.exec(m[1]))) text += decode(tm[1]);
      out.push(text);
    }
    return out;
  }

  // styles.xml: cellXfs maps a cell's s= index to a fontId; a font is bold if it carries
  // a <b/>. Returns an array indexed by cellXf, true where bold.
  function parseBoldStyles(xml) {
    if (!xml) return [];
    var fonts = [];
    var fBlock = xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/);
    if (fBlock) {
      var fre = /<font>([\s\S]*?)<\/font>|<font\s*\/>/g, fm;
      while ((fm = fre.exec(fBlock[1]))) {
        var body = fm[1] || "";
        // Writers disagree on how they say bold: a bare <b/>, or <b val="1"/>. Both mean
        // bold, and <b val="0"/> means explicitly not bold — reading the tag's presence
        // alone would mark every such font bold and turn every line item into a total.
        var bm = body.match(/<b(\s[^>]*?)?\s*\/?>/);
        var isBold = false;
        if (bm) {
          var val = bm[1] ? attr("<b " + bm[1] + ">", "val") : null;
          isBold = !(val === "0" || val === "false");
        }
        fonts.push(isBold);
      }
    }
    var xfs = [];
    var xBlock = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (xBlock) {
      var xre = /<xf\b([^>]*)\/>|<xf\b([^>]*)>[\s\S]*?<\/xf>/g, xm;
      while ((xm = xre.exec(xBlock[1]))) {
        var tag = "<xf " + (xm[1] || xm[2] || "") + ">";
        var fid = parseInt(attr(tag, "fontId") || "0", 10);
        xfs.push(!!fonts[fid]);
      }
    }
    return xfs;
  }

  // "C12" -> { col: 3, row: 12 }. One-based, to match how a spreadsheet is talked about.
  function refToPos(ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref || "");
    if (!m) return null;
    var col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return { col: col, row: parseInt(m[2], 10) };
  }

  function parseSheet(xml, shared, boldXfs) {
    var rows = [];
    var maxCol = 0;
    // The open tag is matched on its own, then the body is taken separately, because an
    // empty cell is written as <c r="B2" s="2"/> immediately followed by the next cell.
    // A pattern of the form <c([^>]*)(?:\/>|>...<\/c>) lets the attribute run swallow the
    // self-closing slash and then match the other branch, so the empty cell consumes its
    // neighbour's body and every value after it lands one column to the left. Quoted
    // attribute values are stepped over so a "/" inside one cannot end the tag either.
    var cre = /<c\b((?:[^>"]|"[^"]*")*)>/g, cm;
    while ((cm = cre.exec(xml))) {
      var attrs = cm[1];
      var selfClosed = /\/\s*$/.test(attrs);
      if (selfClosed) attrs = attrs.replace(/\/\s*$/, "");
      var tag = "<c " + attrs + ">";

      var body = "";
      if (!selfClosed) {
        var end = xml.indexOf("</c>", cre.lastIndex);
        if (end === -1) break;
        body = xml.slice(cre.lastIndex, end);
        cre.lastIndex = end + 4;
      }
      var pos = refToPos(attr(tag, "r"));
      if (!pos) continue;
      var type = attr(tag, "t");
      var styleIdx = parseInt(attr(tag, "s") || "-1", 10);

      var value = null;
      if (type === "inlineStr") {
        var it = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = it ? decode(it[1]) : null;
      } else {
        var vm = body.match(/<v>([\s\S]*?)<\/v>/);
        var raw = vm ? decode(vm[1]) : null;
        if (raw === null || raw === "") {
          value = null;
        } else if (type === "s") {
          value = shared[parseInt(raw, 10)];
          if (value === undefined) value = null;
        } else if (type === "str") {
          value = raw;
        } else if (type === "b") {
          value = raw === "1";
        } else {
          var n = Number(raw);
          value = isNaN(n) ? raw : n;
        }
      }

      // An empty cell is left out entirely rather than stored as "", so a caller can tell
      // "nothing was entered here" from "a zero was". That distinction is the whole point
      // of importing a balance sheet rather than retyping one.
      if (value === null || value === "") continue;

      if (!rows[pos.row]) rows[pos.row] = [];
      rows[pos.row][pos.col] = {
        value: value,
        bold: styleIdx >= 0 ? !!boldXfs[styleIdx] : false
      };
      if (pos.col > maxCol) maxCol = pos.col;
    }
    return { rows: rows, maxRow: rows.length ? rows.length - 1 : 0, maxCol: maxCol };
  }

  // ---- public --------------------------------------------------------------

  // Reads the first worksheet (or the named one) and returns a sparse grid:
  //   { name, rows: [ , [ , {value, bold}, ... ] ], maxRow, maxCol }
  // Rows and columns are one-based and sparse — index 0 is unused, and a gap means an
  // empty cell.
  function readWorkbook(bytes, sheetName) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var entries;
    try {
      entries = readDirectory(b);
    } catch (e) {
      return Promise.reject(e);
    }

    return Promise.all([
      readEntry(b, entries, "xl/sharedStrings.xml"),
      readEntry(b, entries, "xl/styles.xml"),
      readEntry(b, entries, "xl/workbook.xml"),
      readEntry(b, entries, "xl/_rels/workbook.xml.rels")
    ]).then(function (parts) {
      var shared = parseSharedStrings(parts[0]);
      var boldXfs = parseBoldStyles(parts[1]);
      var workbook = parts[2] || "";
      var rels = parts[3] || "";

      var sheets = [];
      var sre = /<sheet\b([^>]*)\/>|<sheet\b([^>]*)>/g, sm;
      while ((sm = sre.exec(workbook))) {
        var tag = "<sheet " + (sm[1] || sm[2] || "") + ">";
        sheets.push({ name: attr(tag, "name"), rid: attr(tag, "r:id") || attr(tag, "id") });
      }
      if (!sheets.length) throw new Error("No worksheet found in the workbook");

      var wanted = sheetName
        ? sheets.filter(function (x) { return x.name === sheetName; })[0]
        : sheets[0];
      if (!wanted) throw new Error('No sheet named "' + sheetName + '" in the workbook');

      var target = null;
      if (wanted.rid) {
        var rre = /<Relationship\b([^>]*)\/>|<Relationship\b([^>]*)>/g, rm;
        while ((rm = rre.exec(rels))) {
          var rtag = "<r " + (rm[1] || rm[2] || "") + ">";
          if (attr(rtag, "Id") === wanted.rid) { target = attr(rtag, "Target"); break; }
        }
      }
      var path = target
        ? (target.indexOf("/") === 0 ? target.slice(1) : "xl/" + target.replace(/^\.\//, ""))
        : "xl/worksheets/sheet1.xml";

      return readEntry(b, entries, path).then(function (sheetXml) {
        if (!sheetXml) return readEntry(b, entries, "xl/worksheets/sheet1.xml");
        return sheetXml;
      }).then(function (sheetXml) {
        if (!sheetXml) throw new Error("The workbook's first sheet could not be read");
        var grid = parseSheet(sheetXml, shared, boldXfs);
        grid.name = wanted.name;
        grid.sheetNames = sheets.map(function (x) { return x.name; });
        return grid;
      });
    });
  }

  return {
    readWorkbook: readWorkbook,
    refToPos: refToPos,
    parseSharedStrings: parseSharedStrings,
    parseBoldStyles: parseBoldStyles,
    decodeEntities: decode
  };
});
