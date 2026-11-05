"""The Power Query kit of fox's long tables (lane P4): one M script per table and fox_powerquery.xlsx, a workbook whose queries point at
the stable URLs (https://fox-research-il.web.app/data/tables/v1/<table>.csv) so Data > Refresh All pulls the current figures.

An Excel Power Query workbook = the queries in a DataMashup part (customXml/item1.xml, [MS-QDEFF]: a binary stream, base64 in UTF-16
XML, holding an OPC zip with Formulas/Section1.m), one OLE DB connection per query (provider Microsoft.Mashup.OleDb.1,
xl/connections.xml) and, per query, a worksheet table bound to a query table. Standard library; deterministic (fixed zip times, GUIDs
from uuid5). Used by pipeline/build_tables.py; verify() is its --check.
"""
import base64
import io
import struct
import uuid
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ZDATE = (2026, 1, 1, 0, 0, 0)
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
DM_NS = "http://schemas.microsoft.com/DataMashup"
UID = uuid.UUID("6f0b6c6e-2b7a-4f0e-9a51-0f0c5e1a7f4d")
X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def qname(t):
    return f"fox_{t}"


def esc(s):
    return escape(str(s), {'"': "&quot;"})


def col(i):
    s, i = "", i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


# ---------------------------------------------------------------- M
def m_body(t, base, typed):
    """the let-expression of one query: the CSV at the stable URL, headers promoted, empty cells -> null, typed columns (en-US)"""
    types = {"value": "type number", "source_page": "Int64.Type", "period_end": "type date", "as_of": "type date",
             "old_value": "type number", "new_value": "type number", "build_date": "type date"}
    tl = ", ".join(f'{{"{c}", {types[c]}}}' for c in typed)
    cl = ", ".join(f'"{c}"' for c in typed)
    return (
        "let\n"
        f'    Source = Csv.Document(Web.Contents("{base}{t}.csv"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),\n'
        "    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),\n"
        f"    Blanks = Table.ReplaceValue(Headers, \"\", null, Replacer.ReplaceValue, {{{cl}}}),\n"
        f'    Typed = Table.TransformColumnTypes(Blanks, {{{tl}}}, "en-US")\n'
        "in\n"
        "    Typed")


def m_script(t, he, en, base, cols, typed):
    return (f"// fox · {he} · {en}\n"
            f"// {base}{t}.csv (also .json) · schema v1: a column never changes meaning; new columns are only appended\n"
            f"// columns: {', '.join(cols)}\n"
            "// Excel (Windows / Mac, Microsoft 365): Data > Get Data > From Other Sources > Blank Query > Advanced Editor > paste > Done >\n"
            "//   Close & Load. Then Data > Refresh All refreshes it. First refresh: Web content, Anonymous, Connect; privacy level Public.\n"
            "// Excel (Windows / Mac, Microsoft 365): נתונים > קבלת נתונים > ממקורות אחרים > שאילתה ריקה > עורך מתקדם > הדבקה > סיום >\n"
            "//   סגור וטען. רענון: נתונים > רענן הכל. ברענון הראשון: תוכן אינטרנט, אנונימי, התחבר.\n"
            + m_body(t, base, typed) + "\n")


# ---------------------------------------------------------------- DataMashup ([MS-QDEFF])
def _zip(files, method=zipfile.ZIP_DEFLATED):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", method) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, ZDATE)
            zi.compress_type = method
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
    return buf.getvalue()


BOM = b"\xef\xbb\xbf"


def section(queries):
    return "section Section1;\n" + "".join(f"\nshared {qname(t)} = {body};\n" for t, body, _ in queries)


def mashup(queries, stamp):
    """the DataMashup binary for [(table id, M let-expression, column names)]"""
    pkg = _zip([
        ("[Content_Types].xml", (BOM.decode() + '<?xml version="1.0" encoding="utf-8"?><Types xmlns="' + CT + '"><Default Extension="xml" '
                                 'ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>').encode("utf-8")),
        ("Config/Package.xml", (BOM.decode() + '<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                                'xmlns:xsd="http://www.w3.org/2001/XMLSchema"><Version>1.0.0</Version><MinimumVersion>1.0.0</MinimumVersion>'
                                '<Culture>en-US</Culture></Package>').encode("utf-8")),
        ("Formulas/Section1.m", section(queries).encode("utf-8")),
    ])
    perm = BOM + ('<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                  'xmlns:xsd="http://www.w3.org/2001/XMLSchema"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>'
                  '<FirewallEnabled>true</FirewallEnabled><WorkbookGroupType xsi:nil="true" /></PermissionList>').encode("utf-8")
    items = ['<Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries /></Item>']
    for t, _, cols in queries:
        q = qname(t)
        names = esc("[" + ",".join(f'"{c}"' for c in cols) + "]")
        ent = [("IsPrivate", "l0"), ("FillEnabled", "l1"), ("FillObjectType", "sTable"), ("FillToDataModelEnabled", "l0"), ("ResultType", "sTable"),
               ("NameUpdatedAfterFill", "l0"), ("FillTarget", f"s{q}"), ("FilledCompleteResultToWorksheet", "l1"), ("AddedToDataModel", "l0"),
               ("FillCount", "l0"), ("FillErrorCode", "sUnknown"), ("FillErrorCount", "l0"), ("FillLastUpdated", f"d{stamp}T00:00:00.0000000Z"),
               ("FillColumnNames", f"s{names}"), ("FillStatus", "sComplete"), ("QueryID", f"s{uuid.uuid5(UID, 'q:' + t)}"), ("BufferNextRefresh", "l1")]
        items.append(f"<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/{q}</ItemPath></ItemLocation><StableEntries>"
                     + "".join(f'<Entry Type="{k}" Value="{v}" />' for k, v in ent) + "</StableEntries></Item>")
        for step in ("Source", "Headers", "Blanks", "Typed"):
            items.append(f"<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/{q}/{step}</ItemPath></ItemLocation><StableEntries /></Item>")
    meta_xml = BOM + ('<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                      'xmlns:xsd="http://www.w3.org/2001/XMLSchema"><Items>' + "".join(items) + "</Items></LocalPackageMetadataFile>").encode("utf-8")
    content = _zip([("[Content_Types].xml", (BOM.decode() + '<?xml version="1.0" encoding="utf-8"?><Types xmlns="' + CT + '"><Default Extension="xml" '
                                             'ContentType="text/xml" /></Types>').encode("utf-8"))])
    meta = struct.pack("<I", 0) + struct.pack("<I", len(meta_xml)) + meta_xml + struct.pack("<I", len(content)) + content
    bindings = b""
    return (struct.pack("<I", 0) + struct.pack("<I", len(pkg)) + pkg + struct.pack("<I", len(perm)) + perm + struct.pack("<I", len(meta)) + meta
            + struct.pack("<I", len(bindings)) + bindings)


def read_mashup(blob):
    """parse the DataMashup binary back: {version, section (the M document), permissions, metadata xml}"""
    o = 0

    def take():
        nonlocal o
        n = struct.unpack_from("<I", blob, o)[0]
        o += 4
        b = blob[o:o + n]
        if len(b) != n:
            raise ValueError("DataMashup truncated")
        o += n
        return b

    ver = struct.unpack_from("<I", blob, 0)[0]
    o = 4
    pkg, perm, meta, _ = take(), take(), take(), take()
    if o != len(blob):
        raise ValueError("DataMashup has trailing bytes")
    z = zipfile.ZipFile(io.BytesIO(pkg))
    sec = z.read("Formulas/Section1.m").decode("utf-8")
    ET.fromstring(perm[3:] if perm.startswith(BOM) else perm)
    mlen = struct.unpack_from("<I", meta, 4)[0]
    mxml = meta[8:8 + mlen]
    ET.fromstring(mxml[3:] if mxml.startswith(BOM) else mxml)
    clen = struct.unpack_from("<I", meta, 8 + mlen)[0]
    if 12 + mlen + clen != len(meta):
        raise ValueError("DataMashup metadata length mismatch")
    return {"version": ver, "section": sec, "names": z.namelist(), "metadata": mxml.decode("utf-8-sig")}


# ---------------------------------------------------------------- the workbook
STYLES = (X + f'<styleSheet xmlns="{NS}">'
          '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font>'
          '<font><b/><sz val="14"/><name val="Arial"/></font><font><u/><sz val="10"/><color rgb="FF1F3A93"/><name val="Arial"/></font></fonts>'
          '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
          '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F5"/><bgColor indexed="64"/></patternFill></fill></fills>'
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
          '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
          '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>'
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
S_TEXT, S_BAND, S_TITLE, S_LINK, S_WRAP = 0, 1, 2, 3, 4


def _cell(r, c, v, s=0):
    a = f' s="{s}"' if s else ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return f'<c r="{col(c)}{r + 1}"{a}><v>{v}</v></c>'
    return f'<c r="{col(c)}{r + 1}" t="inlineStr"{a}><is><t xml:space="preserve">{esc(v)}</t></is></c>'


def _sheet(rows, widths, rtl=False, table_rid=None, links=()):
    out = [X, f'<worksheet xmlns="{NS}" xmlns:r="{RNS}">']
    nc = max([len(r) for r in rows] + [1])
    out.append(f'<dimension ref="A1:{col(nc - 1)}{max(len(rows), 1)}"/>')
    rtl_a = ' rightToLeft="1"' if rtl else ""
    out.append(f'<sheetViews><sheetView workbookViewId="0"{rtl_a}/></sheetViews>' if not table_rid else
               '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    out.append('<sheetFormatPr defaultRowHeight="13"/>')
    if widths:
        out.append("<cols>" + "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths)) + "</cols>")
    out.append("<sheetData>")
    for i, r in enumerate(rows):
        cells = "".join(_cell(i, j, v[0] if isinstance(v, tuple) else v, v[1] if isinstance(v, tuple) else 0) for j, v in enumerate(r) if v not in (None, ""))
        out.append(f'<row r="{i + 1}">{cells}</row>')
    out.append("</sheetData>")
    if links:
        out.append("<hyperlinks>" + "".join(f'<hyperlink ref="{ref}" r:id="{rid}"/>' for ref, rid, _ in links) + "</hyperlinks>")
    out.append('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>')
    if table_rid:
        out.append(f'<tableParts count="1"><tablePart r:id="{table_rid}"/></tableParts>')
    out.append("</worksheet>")
    return "".join(out)


def _table(tid, name, cols):
    rng = f"A1:{col(len(cols) - 1)}2"
    tc = "".join(f'<tableColumn id="{i + 1}" uniqueName="{i + 1}" name="{esc(c)}" queryTableFieldId="{i + 1}"/>' for i, c in enumerate(cols))
    return (X + f'<table xmlns="{NS}" id="{tid}" name="{name}" displayName="{name}" ref="{rng}" tableType="queryTable" totalsRowShown="0">'
            f'<autoFilter ref="{rng}"/><tableColumns count="{len(cols)}">{tc}</tableColumns>'
            '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>')


def _query_table(cid, cols):
    f = "".join(f'<queryTableField id="{i + 1}" name="{esc(c)}" tableColumnId="{i + 1}"/>' for i, c in enumerate(cols))
    return (X + f'<queryTable xmlns="{NS}" name="ExternalData_{cid}" connectionId="{cid}" autoFormatId="16" applyNumberFormats="0" '
            'applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0">'
            f'<queryTableRefresh nextId="{len(cols) + 1}"><queryTableFields count="{len(cols)}">{f}</queryTableFields></queryTableRefresh></queryTable>')


def _connections(names):
    cs = "".join(
        f'<connection id="{i + 1}" keepAlive="1" name="Query - {q}" description="Connection to the \'{q}\' query in the workbook." type="5" '
        f'refreshedVersion="8" background="1" saveData="1" refreshOnLoad="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;'
        f'Location={q};Extended Properties=&quot;&quot;" command="SELECT * FROM [{q}]"/></connection>' for i, q in enumerate(names))
    return X + f'<connections xmlns="{NS}">{cs}</connections>'


def readme_rows(base, tables, columns, tabs, stamp):
    n = {x["id"]: x for x in tabs}
    d = f"{stamp[8:10]}.{stamp[5:7]}.{stamp[2:4]}"
    rows = [[("fox בתוך Excel · Power Query", S_TITLE)],
            [f"נבנה {d} · fox-research-il.web.app/data/api · built {d}"],
            [],
            [("איך מרעננים", S_BAND), ("", S_BAND)],
            ["1", "פתחו את הקובץ. אם מופיע פס צהוב 'חיבורי נתונים חיצוניים הושבתו', לחצו 'הפוך תוכן לזמין'."],
            ["2", "נתונים > רענן הכל. בפעם הראשונה Excel שואל איך להתחבר לאתר: תוכן אינטרנט, אנונימי, התחבר (רמת פרטיות: ציבורי)."],
            ["3", "כל גיליון הוא טבלה (fox_kpi, fox_ifrs17 ...). המודל שלכם קורא ממנה ב-SUMIFS או XLOOKUP, או דרך PivotTable; הרענון שומר על השמות."],
            ["4", "הגיליון 'חדש מאז ההורדה הקודמת' מציג אילו שורות נוספו, השתנו או הוסרו בכל בנייה של fox, עם הערך הקודם והחדש."],
            ["5", "Excel ל-Mac: Microsoft 365 (גרסה 16.x) מרענן Power Query מהאינטרנט. בגרסה ישנה: קובצי ה-CSV בקישורים למטה נפתחים ישירות."],
            [],
            [("How to refresh", S_BAND), ("", S_BAND)],
            ["1", "Open the file. If a yellow bar says external data connections are disabled, click Enable Content."],
            ["2", "Data > Refresh All. The first time, Excel asks how to connect: Web content, Anonymous, Connect (privacy level: Public)."],
            ["3", "Each sheet is a table (fox_kpi, fox_ifrs17 ...). Point your model at it with SUMIFS / XLOOKUP or a PivotTable; names survive a refresh."],
            ["4", "The sheet 'חדש מאז ההורדה הקודמת' (new since the previous download) lists the rows added, changed or removed in each fox build."],
            ["5", "Example: =SUMIFS(fox_kpi[value], fox_kpi[entity_id], \"harel\", fox_kpi[metric_id], \"profit\", fox_kpi[period], \"2026Q2\")"],
            [],
            [("טבלאות · Tables", S_BAND), ("", S_BAND), ("", S_BAND), ("", S_BAND), ("", S_BAND), ("", S_BAND)],
            [("טבלה", S_BAND), ("תיאור", S_BAND), ("שורות בבנייה", S_BAND), ("תקופות", S_BAND), ("עודכן", S_BAND), ("CSV", S_BAND)]]
    links = []
    for t, he, en, grain in tables:
        x = n[t]
        ch = x["changed"]
        rows.append([qname(t), f"{he} · {en} · {grain}", x["rows"], f"{x['first_label']} – {x['last_label']}", f"{ch[8:10]}.{ch[5:7]}.{ch[2:4]}",
                     (f"{base}{t}.csv", S_LINK)])
        links.append((f"F{len(rows)}", f"{base}{t}.csv"))
    rows += [[], [("עמודות (v1) · Columns", S_BAND), ("", S_BAND), ("", S_BAND)]]
    rows += [[c[0], c[2], c[3]] for c in columns]
    rows += [[], [("הבטחת גרסה · Versioning", S_BAND), ("", S_BAND)],
             ["v1", "עמודה לעולם לא משנה משמעות; מזהה מדד לא משנה משמעות או יחידה; עמודות חדשות מתווספות בסוף. שינוי שובר יפתח v2 לצד v1."],
             ["", "A column never changes meaning; a metric id never changes meaning or unit; new columns are appended. A breaking change opens v2 beside v1."],
             [], [("תנאים · Terms", S_BAND), ("", S_BAND)],
             ["", "חינם, גם מסחרי. ציטוט: fox והמקור הראשוני (source_url בכל שורה). יסודות בלבד: אין מחירי מניה. בדקו מול העמוד המצוטט."],
             ["", "Free, including commercial use. Cite fox and the primary source (source_url on every row). Fundamentals only: no share prices."]]
    return rows, links


def workbook(base, tables, columns, ch_cols, tabs, stamp):
    """fox_powerquery.xlsx: a README sheet, the changes sheet and one sheet per table, each a query table refreshed from the URL"""
    cols = [c[0] for c in columns]
    typed = [c[0] for c in columns if c[1] in ("number", "integer", "date")]
    queries = [("changes", m_body("changes", base, ["old_value", "new_value", "build_date"]), ch_cols)]
    queries += [(t, m_body(t, base, typed), cols) for t, *_ in tables]
    sheets = [("קרא אותי", None)] + [("חדש מאז ההורדה הקודמת", queries[0])] + [(t, q) for (t, *_), q in zip(tables, queries[1:])]
    files = []
    wb_rels, sheet_xml, ct_over, defined = [], [], [], []
    rows, links = readme_rows(base, tables, columns, tabs, stamp)
    for i, (name, q) in enumerate(sheets, 1):
        sid = f"rId{i}"
        wb_rels.append(f'<Relationship Id="{sid}" Type="{RNS}/worksheet" Target="worksheets/sheet{i}.xml"/>')
        sheet_xml.append(f'<sheet name="{esc(name)}" sheetId="{i}" r:id="{sid}"/>')
        ct_over.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        if q is None:
            lk = [(r, f"rId{k + 1}", u) for k, (r, u) in enumerate(links)]
            files.append((f"xl/worksheets/sheet{i}.xml", _sheet(rows, [18, 120, 12, 18, 10, 60], rtl=True, links=lk)))
            files.append((f"xl/worksheets/_rels/sheet{i}.xml.rels", X + f'<Relationships xmlns="{PKG}">' + "".join(
                f'<Relationship Id="{rid}" Type="{RNS}/hyperlink" Target="{esc(u)}" TargetMode="External"/>' for _, rid, u in lk) + "</Relationships>"))
            continue
        t, body, qcols = q
        n = i - 1  # table / connection number
        files.append((f"xl/worksheets/sheet{i}.xml", _sheet([qcols], [14] * len(qcols), table_rid="rId1")))
        files.append((f"xl/worksheets/_rels/sheet{i}.xml.rels", X + f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{RNS}/table" '
                      f'Target="../tables/table{n}.xml"/></Relationships>'))
        files.append((f"xl/tables/table{n}.xml", _table(n, qname(t), qcols)))
        files.append((f"xl/tables/_rels/table{n}.xml.rels", X + f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{RNS}/queryTable" '
                      f'Target="../queryTables/queryTable{n}.xml"/></Relationships>'))
        files.append((f"xl/queryTables/queryTable{n}.xml", _query_table(n, qcols)))
        ct_over.append(f'<Override PartName="/xl/tables/table{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>')
        ct_over.append(f'<Override PartName="/xl/queryTables/queryTable{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>')
        defined.append(f'<definedName name="ExternalData_{n}" localSheetId="{i - 1}" hidden="1">\'{esc(name)}\'!$A$1:${col(len(qcols) - 1)}$2</definedName>')
    k = len(sheets)
    wb_rels += [f'<Relationship Id="rId{k + 1}" Type="{RNS}/styles" Target="styles.xml"/>',
                f'<Relationship Id="rId{k + 2}" Type="{RNS}/connections" Target="connections.xml"/>',
                f'<Relationship Id="rId{k + 3}" Type="{RNS}/customXml" Target="../customXml/item1.xml"/>']
    workbook_xml = (X + f'<workbook xmlns="{NS}" xmlns:r="{RNS}"><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView activeTab="0"/></bookViews>'
                    f'<sheets>{"".join(sheet_xml)}</sheets><definedNames>{"".join(defined)}</definedNames><calcPr calcId="191029"/></workbook>')
    dm = base64.b64encode(mashup(queries, stamp)).decode("ascii")
    item = ('<?xml version="1.0" encoding="utf-16"?>' + f'<DataMashup xmlns="{DM_NS}">{dm}</DataMashup>').encode("utf-16")  # BOM + UTF-16LE
    props = (X + f'<ds:datastoreItem ds:itemID="{{{str(uuid.uuid5(UID, "datastore")).upper()}}}" '
             'xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>')
    files += [
        ("[Content_Types].xml", X + f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
         '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
         '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>'
         '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>'
         '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
         '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
         + "".join(ct_over) + "</Types>"),
        ("_rels/.rels", X + f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{RNS}/officeDocument" Target="xl/workbook.xml"/>'
         '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
         f'<Relationship Id="rId3" Type="{RNS}/extended-properties" Target="docProps/app.xml"/></Relationships>'),
        ("docProps/core.xml", X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
         'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
         '<dc:title>fox · Power Query</dc:title><dc:creator>fox</dc:creator>'
         f'<dcterms:created xsi:type="dcterms:W3CDTF">{stamp}T00:00:00Z</dcterms:created></cp:coreProperties>'),
        ("docProps/app.xml", X + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>'),
        ("xl/workbook.xml", workbook_xml),
        ("xl/_rels/workbook.xml.rels", X + f'<Relationships xmlns="{PKG}">{"".join(wb_rels)}</Relationships>'),
        ("xl/styles.xml", STYLES),
        ("xl/connections.xml", _connections([qname(t) for t, _, _ in queries])),
        ("customXml/item1.xml", item),
        ("customXml/itemProps1.xml", props),
        ("customXml/_rels/item1.xml.rels", X + f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" '
         f'Type="{RNS}/customXmlProps" Target="itemProps1.xml"/></Relationships>'),
    ]
    order = {n: i for i, n in enumerate(["[Content_Types].xml", "_rels/.rels"])}
    files.sort(key=lambda f: (order.get(f[0], 9), f[0]))
    return _zip([(n, d if isinstance(d, bytes) else d.encode("utf-8")) for n, d in files])


def verify(data, tables):
    """the kit opens: every XML part parses, the DataMashup decodes and holds one shared query per table, each with its connection,
    query table and worksheet table"""
    probs = []
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        for n in z.namelist():
            if n.endswith((".xml", ".rels")):
                raw = z.read(n)
                ET.fromstring(raw.decode("utf-16") if raw[:2] == b"\xff\xfe" else raw)
        root = ET.fromstring(z.read("customXml/item1.xml").decode("utf-16"))
        dm = read_mashup(base64.b64decode(root.text))
        conns = z.read("xl/connections.xml").decode()
        tabs = " ".join(z.read(n).decode() for n in z.namelist() if n.startswith("xl/tables/table"))
        for t in tables:
            q = qname(t)
            if f"shared {q} = " not in dm["section"]:
                probs.append(f"{q}: no query in the DataMashup")
            if f"Location={q};" not in conns:
                probs.append(f"{q}: no connection")
            if f'name="{q}"' not in tabs:
                probs.append(f"{q}: no worksheet table")
            if f"Section1/{q}<" not in dm["metadata"]:
                probs.append(f"{q}: no metadata item")
    except Exception as e:  # noqa: BLE001  any parse error is a failure
        probs.append(f"does not open: {e}")
    return probs
