"""A small XLSX writer and reader check, standard library only (an .xlsx is a zip of a few XML parts; no openpyxl).

Writer: real numbers with number formats, formulas with cached values, shared strings, bold / header / band / italic styles, frozen
panes, column widths, per-cell hyperlinks (external URLs share one relationship per URL; internal links jump to a cell). The output is
deterministic (fixed zip timestamps, sorted parts), so a rebuild of unchanged data is byte-equal.

    wb = Book(title)
    sh = wb.sheet("P&L", widths=[..], freeze=(3, 5))
    sh.row([Cell("Key", "head"), ...]); sh.row([...])
    data = wb.bytes()

read_book(data) parses a written file back: {sheet name: {"A1": (kind, value, formula, style)}} plus hyperlinks, and fails loudly on
any XML that does not parse. pipeline/build_model_xlsx.py --check uses it.
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
ZDATE = (2026, 1, 1, 0, 0, 0)
QUOT = {'"': "&quot;"}
BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# number formats (custom ids 164+)
NUMFMT = {"m": (164, "#,##0.0;-#,##0.0"), "nis": (165, "0.00"), "pct": (166, "0.0"), "int": (167, "#,##0"), "x": (168, "0.000")}
# styles: name -> (numFmtId, fontId, fillId, applyAlignment-wrap)
FONTS = ['<font><sz val="10"/><name val="Arial"/></font>',
         '<font><b/><sz val="10"/><name val="Arial"/></font>',
         '<font><i/><sz val="10"/><color rgb="FF374151"/><name val="Arial"/></font>',
         '<font><u/><sz val="10"/><color rgb="FF1F3A93"/><name val="Arial"/></font>',
         '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>',
         '<font><sz val="9"/><color rgb="FF4B5563"/><name val="Arial"/></font>',
         '<font><b/><sz val="13"/><name val="Arial"/></font>']
FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
         '<fill><patternFill patternType="solid"><fgColor rgb="FF1B2340"/><bgColor indexed="64"/></patternFill></fill>',
         '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F5"/><bgColor indexed="64"/></patternFill></fill>']
STYLES = ["text", "head", "band", "title", "note", "link"]
for _k in NUMFMT:
    STYLES += [_k, f"{_k}_i"]  # printed figure, derived / formula (italic)
STYLE_IX = {s: i for i, s in enumerate(STYLES)}


def _xf(name):
    if name == "text":
        return '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    if name == "head":
        return '<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    if name == "band":
        return '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    if name == "title":
        return '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    if name == "note":
        return '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    if name == "link":
        return '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    k, _, it = name.partition("_")
    af = ' applyFont="1"' if it else ""
    return f'<xf numFmtId="{NUMFMT[k][0]}" fontId="{2 if it else 0}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"{af}/>'


def col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def ref(r, c):
    """0-based row, column -> A1"""
    return f"{col(c)}{r + 1}"


def qsheet(name):
    return "'" + name.replace("'", "''") + "'"


class Cell:
    __slots__ = ("v", "style", "f", "link", "loc")

    def __init__(self, v, style=None, f=None, link=None, loc=None):
        self.v, self.f, self.link, self.loc = v, f, link, loc
        self.style = style or ("text" if not isinstance(v, (int, float)) or isinstance(v, bool) else "m")


class Sheet:
    def __init__(self, name, widths=None, freeze=None, rtl=False):
        self.name, self.widths, self.freeze, self.rtl = name, widths or [], freeze, rtl
        self.rows = []

    def row(self, cells):
        self.rows.append([c if isinstance(c, Cell) or c is None else Cell(c) for c in cells])
        return len(self.rows) - 1


def _num(v):
    if isinstance(v, bool):
        v = int(v)
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer() and abs(v) < 1e15):
        return str(int(v))
    return repr(round(v, 10))


class Book:
    def __init__(self, title="", author="fox"):
        self.title, self.author, self.sheets = title, author, []

    def sheet(self, name, **kw):
        s = Sheet(name, **kw)
        self.sheets.append(s)
        return s

    def bytes(self):
        sst, sst_ix = [], {}

        def si(s):
            s = BAD.sub("", str(s))
            if s not in sst_ix:
                sst_ix[s] = len(sst)
                sst.append(s)
            return sst_ix[s]

        parts = {}
        for n, sh in enumerate(self.sheets, 1):
            urls, links, out = {}, [], []
            ncols = max((len(r) for r in sh.rows), default=1)
            out.append(f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="{NS}" xmlns:r="{RNS}">')
            out.append(f'<dimension ref="A1:{ref(max(len(sh.rows) - 1, 0), max(ncols - 1, 0))}"/>')
            rtl_a = ' rightToLeft="1"' if sh.rtl else ""
            sel_a = ' tabSelected="1"' if n == 1 else ""
            view = f'<sheetView workbookViewId="0"{rtl_a}{sel_a}>'
            if sh.freeze:
                fr, fc = sh.freeze
                attrs = (f' xSplit="{fc}"' if fc else "") + (f' ySplit="{fr}"' if fr else "")
                pane = "bottomRight" if fr and fc else "bottomLeft" if fr else "topRight"
                view += f'<pane{attrs} topLeftCell="{ref(fr, fc)}" activePane="{pane}" state="frozen"/><selection pane="{pane}"/>'
            out.append(f"<sheetViews>{view}</sheetView></sheetViews>")
            out.append('<sheetFormatPr defaultRowHeight="13.8"/>')
            if sh.widths:
                out.append("<cols>" + "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(sh.widths) if w) + "</cols>")
            out.append("<sheetData>")
            for ri, cells in enumerate(sh.rows):
                buf = [f'<row r="{ri + 1}">']
                for ci, c in enumerate(cells):
                    if c is None or (c.v is None and c.f is None and c.style == "text"):
                        continue
                    r_ = ref(ri, ci)
                    s = STYLE_IX[c.style]
                    sa = f' s="{s}"' if s else ""
                    if c.f is not None:
                        cached = "" if c.v is None else ("<v>" + (_num(c.v) if isinstance(c.v, (int, float)) else escape(BAD.sub("", str(c.v)))) + "</v>")
                        t = ' t="str"' if isinstance(c.v, str) else ""
                        buf.append(f'<c r="{r_}"{sa}{t}><f>{escape(c.f)}</f>{cached}</c>')
                    elif isinstance(c.v, (int, float)) and not isinstance(c.v, bool):
                        buf.append(f'<c r="{r_}"{sa}><v>{_num(c.v)}</v></c>')
                    elif c.v is None or c.v == "":
                        buf.append(f'<c r="{r_}"{sa}/>')
                    else:
                        buf.append(f'<c r="{r_}"{sa} t="s"><v>{si(c.v)}</v></c>')
                    if c.link:
                        if c.link not in urls:
                            urls[c.link] = f"rId{len(urls) + 1}"
                        links.append(f'<hyperlink ref="{r_}" r:id="{urls[c.link]}"/>')
                    elif c.loc:
                        links.append(f'<hyperlink ref="{r_}" location="{escape(c.loc, QUOT)}"/>')
                buf.append("</row>")
                out.append("".join(buf))
            out.append("</sheetData>")
            if links:
                out.append("<hyperlinks>" + "".join(links) + "</hyperlinks>")
            out.append('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>')
            parts[f"xl/worksheets/sheet{n}.xml"] = "".join(out)
            if urls:
                parts[f"xl/worksheets/_rels/sheet{n}.xml.rels"] = (
                    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{PKG}">'
                    + "".join(f'<Relationship Id="{i}" Type="{RNS}/hyperlink" Target="{escape(u, QUOT)}" TargetMode="External"/>' for u, i in urls.items())
                    + "</Relationships>")
        n_sh = len(self.sheets)
        parts["[Content_Types].xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, n_sh + 1))
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>')
        parts["_rels/.rels"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{PKG}">'
            f'<Relationship Id="rId1" Type="{RNS}/officeDocument" Target="xl/workbook.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            f'<Relationship Id="rId3" Type="{RNS}/extended-properties" Target="docProps/app.xml"/></Relationships>')
        parts["docProps/core.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(self.title)}</dc:title><dc:creator>{escape(self.author)}</dc:creator></cp:coreProperties>")
        parts["docProps/app.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            "<Application>fox</Application></Properties>")
        parts["xl/workbook.xml"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="{NS}" xmlns:r="{RNS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
            + "".join(f'<sheet name="{escape(s.name, QUOT)}" sheetId="{i}" r:id="rId{i}"/>' for i, s in enumerate(self.sheets, 1))
            + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
        parts["xl/_rels/workbook.xml.rels"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{PKG}">'
            + "".join(f'<Relationship Id="rId{i}" Type="{RNS}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, n_sh + 1))
            + f'<Relationship Id="rId{n_sh + 1}" Type="{RNS}/styles" Target="styles.xml"/>'
            f'<Relationship Id="rId{n_sh + 2}" Type="{RNS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
        parts["xl/styles.xml"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="{NS}">'
            f'<numFmts count="{len(NUMFMT)}">' + "".join(f'<numFmt numFmtId="{i}" formatCode="{escape(f, QUOT)}"/>' for i, f in NUMFMT.values()) + "</numFmts>"
            f'<fonts count="{len(FONTS)}">' + "".join(FONTS) + "</fonts>"
            f'<fills count="{len(FILLS)}">' + "".join(FILLS) + "</fills>"
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            f'<cellXfs count="{len(STYLES)}">' + "".join(_xf(s) for s in STYLES) + "</cellXfs>"
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
        parts["xl/sharedStrings.xml"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="{NS}" count="{len(sst)}" uniqueCount="{len(sst)}">'
            + "".join(f'<si><t xml:space="preserve">{escape(s)}</t></si>' for s in sst) + "</sst>")
        buf = io.BytesIO()
        order = ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                 "xl/styles.xml", "xl/sharedStrings.xml"]
        order += sorted((p for p in parts if p not in order), key=lambda p: (p.count("/"), int(re.search(r"(\d+)", p).group(1)) if re.search(r"sheet(\d+)", p) else 0, p))
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for p in order:
                zi = zipfile.ZipInfo(p, ZDATE)
                zi.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(zi, parts[p].encode("utf-8"), compresslevel=9)
        return buf.getvalue()


def _col_ix(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_book(data):
    """Parse a written workbook back. Every XML part must parse. Returns {"sheets": [(name, cells, links)], "styles": [style names]}
    where cells = {"A1": (kind, value, formula, style index)} and links = {"A1": ("ext", url) | ("loc", location)}."""
    z = zipfile.ZipFile(io.BytesIO(data))
    bad = z.testzip()
    if bad:
        raise ValueError(f"corrupt zip member {bad}")
    for p in z.namelist():
        if p.endswith(".xml") or p.endswith(".rels"):
            ET.fromstring(z.read(p))  # raises on malformed XML
    q = lambda t: f"{{{NS}}}{t}"
    sst = [("".join(t.text or "" for t in si.iter(q("t")))) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(q("si"))]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = []
    for s in wb.iter(q("sheet")):
        path = "xl/" + rels[s.get(f"{{{RNS}}}id")]
        root = ET.fromstring(z.read(path))
        cells = {}
        for c in root.iter(q("c")):
            r, t, st = c.get("r"), c.get("t"), int(c.get("s") or 0)
            f, v = c.find(q("f")), c.find(q("v"))
            val = None if v is None else v.text
            if t == "s" and val is not None:
                cells[r] = ("s", sst[int(val)], None, st)
            elif f is not None:
                cells[r] = ("f", None if val is None else (val if t == "str" else float(val)), f.text, st)
            elif val is not None:
                cells[r] = ("n", float(val), None, st)
        srel_p = path.replace("worksheets/", "worksheets/_rels/") + ".rels"
        srel = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read(srel_p))} if srel_p in z.namelist() else {}
        links = {}
        for h in root.iter(q("hyperlink")):
            rid = h.get(f"{{{RNS}}}id")
            links[h.get("ref")] = ("ext", srel[rid]) if rid else ("loc", h.get("location"))
        out.append((s.get("name"), cells, links))
    return {"sheets": out, "styles": STYLES}


def split_ref(r):
    m = re.match(r"([A-Z]+)(\d+)$", r)
    return int(m.group(2)) - 1, _col_ix(m.group(1))
