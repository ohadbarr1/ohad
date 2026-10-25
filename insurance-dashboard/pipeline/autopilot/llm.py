"""Optional LLM extraction hook: one new filing's PDF -> one JSON under pipeline/EXTRACT_SPEC.md, by the Claude Code CLI in headless mode.

OFF unless ops/autopilot.toml [llm] has enabled = true AND approved_by set (conf.llm_on). Budget, all in tokens as the CLI reports them
(input + output + cache creation + cache read):
  season_budget_tokens  everything spent in [llm] season (default 1,000,000); the ledger resets when `season` changes
  per_filing_tokens     a filing is started only if the season and the run still have this much left, and only if its estimate
                        (config.json est_tokens) is within it
  per_run_tokens        one run never starts calls beyond this
  per_filing_max_usd    passed to the CLI as --max-budget-usd: the hard stop inside a call
A call can overshoot its token cap by what one call spends before the CLI's own stop; the ledger records actuals and the next call is
refused when the remainder is short. Ledger: data/registry/autopilot_llm_ledger.json (committed with the data: who spent what, when).

Output lands in data/extracted_autopilot/<company>/<period>_<rid>.json with "status": "unverified". It feeds nothing on the site until
the owner runs verify_extraction.py on it and moves it into data/extracted*/ (EXTRACT_SPEC.md); the autopilot never does that.
"""
import datetime as dt
import json
import subprocess
from pathlib import Path

from common import read_json, write_json

KINDS = ("quarterly", "annual", "presentation", "solvency")
PROMPT = (
    "You extract one Israeli insurer/fund-manager filing for fox, a fundamentals research site. Read pipeline/EXTRACT_SPEC.md first and "
    "follow it exactly (use the section for this document type). Filing: company {company}, period {period}, document type {type}, "
    "MAYA report id {rid}. Input PDF(s), read them directly: {pdfs}. Write exactly one JSON file, {out}, in the spec's output format, "
    "with the extra top-level fields \"status\": \"unverified\" and \"extracted_by\": \"autopilot-llm\". Copy every number exactly as "
    "printed with its Hebrew PDF page; never calculate, sum or infer; put anything not printed in not_found. Do not read files other "
    "than the spec and the PDFs, do not write any other file, do not run commands. Reply with one line: the number of facts written."
)


def ledger_path(paths):
    return paths.registry / "autopilot_llm_ledger.json"


def ledger(paths, season):
    led = read_json(ledger_path(paths), {}) or {}
    if led.get("season") != season:
        led = {"season": season, "spent": 0, "calls": [], "previous": ({"season": led["season"], "spent": led.get("spent", 0)}
                                                                        if led.get("season") else None)}
    return led


def usage_tokens(u):
    u = u or {}
    return int(sum(int(u.get(k) or 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")))


class Budget:
    """Season + run accounting around the ledger."""

    def __init__(self, paths, cfg):
        self.paths, self.llm = paths, cfg.get("llm", {})
        self.season = str(self.llm.get("season") or "")
        self.led = ledger(paths, self.season)
        self.run_spent = 0

    @property
    def season_left(self):
        return int(self.llm.get("season_budget_tokens") or 0) - int(self.led["spent"])

    @property
    def run_left(self):
        return int(self.llm.get("per_run_tokens") or 0) - self.run_spent

    def why_not(self, est):
        cap = int(self.llm.get("per_filing_tokens") or 0)
        if est and est > cap:
            return f"האומדן ({est:,}) מעל התקרה לדוח ({cap:,})"
        if self.season_left < cap:
            return f"תקציב העונה {self.season} נגמר: נותרו {max(self.season_left, 0):,} מתוך {int(self.llm.get('season_budget_tokens') or 0):,}"
        if self.run_left < cap:
            return f"תקציב הריצה נגמר ({self.run_spent:,})"
        return None

    def spend(self, entry):
        self.led["spent"] = int(self.led["spent"]) + entry["tokens"]
        self.led["calls"].append(entry)
        self.run_spent += entry["tokens"]
        write_json(ledger_path(self.paths), self.led, compact=False)

    def summary(self):
        return {"season": self.season, "budget": int(self.llm.get("season_budget_tokens") or 0), "spent": int(self.led["spent"]),
                "calls": len(self.led["calls"]), "per_filing": int(self.llm.get("per_filing_tokens") or 0),
                "per_run": int(self.llm.get("per_run_tokens") or 0)}


def command(cfg, prompt, out_rel):
    llm = cfg["llm"]
    cmd = [llm.get("claude_bin") or "claude", "-p", prompt, "--output-format", "json", "--no-session-persistence",
           "--max-turns", str(int(llm.get("max_turns") or 40)), "--max-budget-usd", str(float(llm.get("per_filing_max_usd") or 4.0)),
           "--allowedTools", "Read", f"Write(./{out_rel})", f"Edit(./{out_rel})"]
    if llm.get("model"):
        cmd += ["--model", llm["model"]]
    return cmd


def extract(filing, cfg, paths, budget, est=None, runner=subprocess.run):
    """Run (or skip, with the reason) the extraction of one filing. Returns the record status.json and the filings log keep."""
    from conf import llm_on  # noqa: PLC0415
    if not llm_on(cfg):
        return {"ran": False, "why": "כבוי: ops/autopilot.toml [llm] enabled + approved_by", "est_tokens": est}
    if filing.get("type") not in KINDS:
        return {"ran": False, "why": "סוג מסמך ללא חילוץ", "est_tokens": est}
    pdfs = [p["local"] for p in filing.get("pdf", []) if p.get("local")]
    if not pdfs:
        return {"ran": False, "why": "אין PDF מקומי", "est_tokens": est}
    why = budget.why_not(est)
    if why:
        return {"ran": False, "why": why, "est_tokens": est}
    out_rel = f"data/extracted_autopilot/{filing['company']}/{filing['period']}_{filing['rid']}.json"
    prompt = PROMPT.format(company=filing["company"], period=filing["period"], type=filing["type"], rid=filing["rid"],
                           pdfs=", ".join(pdfs), out=out_rel)
    (paths.root / out_rel).parent.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    try:
        p = runner(command(cfg, prompt, out_rel), cwd=paths.root, capture_output=True, text=True, timeout=1800)
        res = json.loads((p.stdout or "").strip().splitlines()[-1]) if (p.stdout or "").strip() else {}
        rc = p.returncode
    except Exception as e:  # noqa: BLE001
        res, rc = {"is_error": True, "result": str(e)[:200]}, -1
    tokens = usage_tokens(res.get("usage"))
    out = paths.root / out_rel
    ok = False
    if out.exists():
        try:
            doc = json.loads(out.read_text(encoding="utf-8"))
            doc.update(status="unverified", extracted_by="autopilot-llm", extracted_at=started)
            write_json(out, doc, compact=False)
            ok = bool(doc.get("facts"))
        except ValueError:
            ok = False
    entry = {"at": started, "company": filing["company"], "rid": filing["rid"], "period": filing["period"], "type": filing["type"],
             "tokens": tokens, "usd": res.get("total_cost_usd"), "ok": ok and rc == 0 and not res.get("is_error"), "out": out_rel if ok else None}
    budget.spend(entry)
    return {"ran": True, "ok": entry["ok"], "tokens": tokens, "usd": entry["usd"], "out": entry["out"], "est_tokens": est,
            "why": None if entry["ok"] else (str(res.get("result") or res.get("subtype") or f"exit {rc}")[:200])}


def pending(paths):
    """Extractions waiting for the owner's verification (data/extracted_autopilot/**)."""
    base = paths.root / "data" / "extracted_autopilot"
    return sorted(str(p.relative_to(paths.root)) for p in base.rglob("*.json")) if base.exists() else []
