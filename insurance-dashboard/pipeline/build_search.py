"""Full-text index over every page of every filed PDF, for the site's search and document reader.

python3 pipeline/build_search.py [--shards N]
  in : data/registry/documents.csv, data/registry/pages_manifest.json, web/public/data/search/text/<rid>/<block>.bin (pipeline/build_pages.py)
  out: web/public/data/search/docs.json      the documents, in index order (a page's number in the index = the pages of the
                                              documents before it + its page number - 1)
       web/public/data/search/ft/meta.json   page count, shard count, stop words
       web/public/data/search/ft/<n>.bin     gzip; [u32 LE header length][header JSON {key: [df, offset, length, enc]}][postings]

Words are normalised exactly as web/src/lib/hebrew.ts does (NFKC, lower case, no niqqud, final letters folded, quotes inside a
word dropped, thousands separators dropped). A key is a word ("הפסד") or a word behind prefix letters ("~הפסד": the pages where
it is printed as בהפסד, והפסד, להפסד ...; kept only when the bare word is itself printed somewhere). A key lives in shard
fnv1a(utf-8 of the bare word) % N, so a word and its prefixed forms arrive in one request.
Postings: enc 0 = varints of (page gap << 2 | min(tf, 4) - 1); enc 1 = a bitmap over all pages (dense words, tf not kept).
Words on more than STOP of all pages are not indexed (listed in meta.json; the query skips them).
"""
import argparse
import csv
import gzip
import json
import re
import struct
import sys
import time
import unicodedata
from array import array
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEARCH = ROOT / "web" / "public" / "data" / "search"
TEXT = SEARCH / "text"
FT = SEARCH / "ft"
MANIFEST = ROOT / "data" / "registry" / "pages_manifest.json"
FILES = "https://mayafiles.tase.co.il/"
TYPES = {"annual", "quarterly", "presentation", "solvency"}
STOP = 0.6
BLOCK = 10

# ---- the normaliser: keep identical to web/src/lib/hebrew.ts ----
TABLE = {}
for c in list(range(0x591, 0x5BE)) + [0x5BF, 0x5C1, 0x5C2, 0x5C4, 0x5C5, 0x5C7]:
    TABLE[c] = None
for c in [0x5BE, 0x5C0, 0x5C3, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]:
    TABLE[c] = " "
TABLE.update({ord("ך"): "כ", ord("ם"): "מ", ord("ן"): "נ", ord("ף"): "פ", ord("ץ"): "צ"})
TOKEN = re.compile(r"[0-9][0-9,]*(?:\.[0-9]+)?|[a-z]+|[א-ת]+(?:['\"׳״`’”][א-ת]+)*")
QUOTES = re.compile(r"['\"׳״`’”]")
PREFIX = "והבלמשכ"


def normalize(s):
    return unicodedata.normalize("NFKC", s).lower().translate(TABLE)


def term(raw):
    c = raw[0]
    if "0" <= c <= "9":
        t = raw.replace(",", "")
        return t if len(t.replace(".", "", 1)) >= 3 else None
    t = QUOTES.sub("", raw) if c >= "א" else raw
    return t if len(t) >= 2 else None


def terms(s):
    out = []
    for m in TOKEN.finditer(normalize(s)):
        t = term(m.group(0))
        if t:
            out.append(t)
    return out


def stems(t):
    out = []
    for k in range(1, 4):
        if len(t) - k < 3:
            break
        ch = t[k - 1]
        if ch not in PREFIX or (ch == "ו" and k > 1):
            break
        out.append(t[k:])
    return out


def fnv(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


# ---- encoding ----
def varint(out, v):
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)


def encode(pages, tfs, n):
    b = bytearray()
    prev = -1
    for g, tf in zip(pages, tfs):
        varint(b, ((g - prev) << 2) | (min(tf, 4) - 1))
        prev = g
    if len(b) <= (n + 7) // 8:
        return 0, bytes(b)
    bm = bytearray((n + 7) // 8)
    for g in pages:
        bm[g >> 3] |= 1 << (g & 7)
    return 1, bytes(bm)


def read_pages(rid, n):
    out = []
    for b in range((n + BLOCK - 1) // BLOCK):
        f = TEXT / rid / f"{b}.bin"
        out += json.loads(gzip.decompress(f.read_bytes())) if f.exists() else [""] * min(BLOCK, n - b * BLOCK)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", type=int, default=0, help="0: about 24 KB of gzip per shard")
    a = ap.parse_args()
    t0 = time.time()
    man = json.loads(MANIFEST.read_text())
    rows = [r for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8"))
            if r["file_type"].startswith("pdf") and r["local_path"] and r["doc_type"] in TYPES and man.get(r["report_id"], {}).get("pages")]
    rows = sorted(rows, key=lambda r: (r["company"], "".join(chr(0x10FFFF - ord(c)) for c in r["publish_date"])))  # company, newest first
    docs = []
    for r in rows:
        title = " ".join(r["title"].split())
        en = 0 if any("֐" <= ch <= "׿" for ch in title) else 1
        m = man[r["report_id"]]
        docs.append([int(r["report_id"]), r["company"], r["doc_type"], r["period"], r["publish_date"][:10], m["pages"], en, title,
                     r["url"], m["empty"], int(r["size_kb"] or 0)])
    N = sum(d[5] for d in docs)
    print(len(docs), "documents,", N, "pages", flush=True)

    post = {}
    tfa = {}
    g = 0
    for i, d in enumerate(docs):
        for text in read_pages(str(d[0]), d[5]):
            for t, tf in Counter(terms(text)).items():
                p = post.get(t)
                if p is None:
                    p = post[t] = array("I")
                    tfa[t] = bytearray()
                p.append(g)
                tfa[t].append(min(tf, 255))
            g += 1
        if i % 100 == 0:
            print(f"  {i}/{len(docs)} docs, {len(post)} words, {time.time() - t0:.0f}s", flush=True)
    assert g == N
    stop = sorted((t for t, p in post.items() if len(p) > STOP * N), key=lambda t: -len(post[t]))
    stopset = set(stop)
    print(len(post), "words,", len(stop), "stop words", flush=True)

    # prefixed forms: the pages where a word appears behind prefix letters, for every bare word printed on at least two pages
    via = defaultdict(list)
    for t in post:
        if "א" <= t[0] <= "ת":
            for s in stems(t):
                if s in post and len(post[s]) >= 2 and s not in stopset:
                    via[s].append(t)
    print(len(via), "words with prefixed forms", flush=True)

    raw = sum(len(p) for p in post.values())
    S = a.shards or max(64, round(raw * 0.75 / 24000 / 64) * 64)  # ~0.75 gzip bytes per posting, measured
    shards = defaultdict(list)
    for t in post:
        if t not in stopset:
            shards[fnv(t) % S].append(t)
    for s in via:
        shards[fnv(s) % S].append("~" + s)
    FT.mkdir(parents=True, exist_ok=True)
    for f in FT.glob("*.bin"):
        f.unlink()
    total = 0
    sizes = []
    for k in range(S):
        head = {}
        body = bytearray()
        for key in sorted(shards.get(k, [])):
            if key[0] == "~":
                acc = Counter()
                for w in via[key[1:]]:
                    for gg, tf in zip(post[w], tfa[w]):
                        acc[gg] += tf
                pages = sorted(acc)
                tfs = [acc[x] for x in pages]
            else:
                pages, tfs = post[key], tfa[key]
            enc, data = encode(pages, tfs, N)
            head[key] = [len(pages), len(body), len(data), enc]
            body += data
        hj = json.dumps(head, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        blob = gzip.compress(struct.pack("<I", len(hj)) + hj + bytes(body), 9, mtime=0)
        (FT / f"{k}.bin").write_bytes(blob)
        total += len(blob)
        sizes.append(len(blob))
    sizes.sort()
    meta = {"v": 1, "built": date.today().isoformat(), "pages": N, "docs": len(docs), "shards": S, "block": BLOCK, "stop": stop}
    (FT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (SEARCH / "docs.json").write_text(json.dumps({"v": 1, "built": meta["built"], "source": "MAYA", "files": FILES, "pages": N, "block": BLOCK,
                                                  "cols": ["id", "company", "type", "period", "date", "pages", "en", "title", "url", "empty", "kb"],
                                                  "docs": docs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{S} shards, {total / 1e6:.1f} MB gzip; shard median {sizes[len(sizes) // 2] / 1e3:.0f} KB, p95 {sizes[int(len(sizes) * .95)] / 1e3:.0f} KB, max {sizes[-1] / 1e3:.0f} KB; {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
