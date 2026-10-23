"""Shared paths and helpers for the quarterly asset-list lane (pipeline/asset_lists)."""
from __future__ import annotations
import json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RAW = ROOT / "data" / "raw" / "asset_lists"          # downloaded Excel files (Drive symlink), only when < 30 MB per manager-quarter
WORK = ROOT / "data" / "work" / "asset_lists"        # normalised parquet + validation per manager-quarter
OUT = ROOT / "web" / "public" / "data" / "assets"
SOURCES = HERE / "sources.json"
COVERAGE = HERE / "coverage.json"                    # probe result, committed (small)
MAX_RAW_MB = 30

# CMA file name: <9-digit company id>_<product>_p_<Q><YY>.xlsx  (case varies: _P_, _GM_, a trailing -1 or _for-yesod)
CMA_NAME = re.compile(r"(?<!\d)(\d{9})_(gm|pn|ca|in)_p_0([1-4])(\d{2})(?!\d)", re.I)


def load_sources() -> dict:
    return json.loads(SOURCES.read_text(encoding="utf-8"))


def qkey(q: int, yy: int) -> str:
    """2026Q2"""
    return f"{2000 + yy}Q{q}"


def qlabel(k: str) -> str:
    """2026Q2 -> Q2'26"""
    return f"Q{k[5]}'{k[2:4]}"


def last_quarters(n: int, latest: str) -> list[str]:
    y, q = int(latest[:4]), int(latest[5])
    out = []
    for _ in range(n):
        out.append(f"{y}Q{q}")
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return out[::-1]


def parse_name(s: str):
    """(company_id, product, quarter key) from a URL or file name, or None"""
    m = CMA_NAME.search(s)
    if not m:
        return None
    return m.group(1), m.group(2).lower(), qkey(int(m.group(3)), int(m.group(4)))
