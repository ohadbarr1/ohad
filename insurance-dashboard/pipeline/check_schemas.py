"""Data contracts: every built JSON under web/public/data that has a contract in web/src/lib/schemas.json must match it.

python3 pipeline/check_schemas.py [--quiet]      (standard library only; the same contracts web/src/lib/schema.ts checks in the browser)
Prints one line per failing file and a summary; exit code 1 when any file fails. pipeline/gate.py runs it as the `schemas` check.

Keywords (the subset both validators implement): type, enum, pattern, properties, required, additionalProperties, items, prefixItems,
minItems, allOf, $ref ("#/$defs/<name>"). A file is matched by the first `files` pattern that fits (* = any characters except /).
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
SPEC = ROOT / "web" / "src" / "lib" / "schemas.json"
MAX_ERR = 8


def glob_re(pattern):
    return re.compile("^" + "".join("[^/]*" if c == "*" else re.escape(c) for c in pattern) + "$")


def type_ok(v, t):
    if t == "null":
        return v is None
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")
    if t == "string":
        return isinstance(v, str)
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return isinstance(v, dict)
    return False


class Validator:
    def __init__(self, spec):
        self.defs = spec["$defs"]
        self.rx = {}

    def resolve(self, s):
        while "$ref" in s:
            s = self.defs[s["$ref"].split("/")[-1]]
        return s

    def check(self, v, s, path, errs):
        if len(errs) >= MAX_ERR:
            return
        if "$ref" in s:
            ref = self.defs[s["$ref"].split("/")[-1]]
            extra = {k: x for k, x in s.items() if k != "$ref"}
            self.check(v, ref, path, errs)
            if not extra:
                return
            s = extra
        for sub in s.get("allOf", []):
            self.check(v, sub, path, errs)
        t = s.get("type")
        if t is not None:
            ts = t if isinstance(t, list) else [t]
            if not any(type_ok(v, x) for x in ts):
                errs.append(f"{path or '/'}: expected {'|'.join(ts)}, got {type(v).__name__ if v is not None else 'null'}")
                return
        if "enum" in s and v not in s["enum"]:
            errs.append(f"{path or '/'}: {json.dumps(v, ensure_ascii=False)[:40]} not in {s['enum']}")
            return
        if "pattern" in s and isinstance(v, str):
            r = self.rx.setdefault(s["pattern"], re.compile(s["pattern"]))
            if not r.search(v):
                errs.append(f"{path or '/'}: {v[:40]!r} does not match {s['pattern']}")
        if isinstance(v, dict):
            for k in s.get("required", []):
                if k not in v:
                    errs.append(f"{path or '/'}: missing key '{k}'")
            props = s.get("properties", {})
            for k, sub in props.items():
                if k in v:
                    self.check(v[k], sub, f"{path}/{k}", errs)
            ap = s.get("additionalProperties")
            if ap is False:
                for k in v:
                    if k not in props:
                        errs.append(f"{path or '/'}: unexpected key '{k}'")
            elif isinstance(ap, dict):
                for k, x in v.items():
                    if k not in props:
                        self.check(x, ap, f"{path}/{k}", errs)
                        if len(errs) >= MAX_ERR:
                            return
        elif isinstance(v, list):
            if "minItems" in s and len(v) < s["minItems"]:
                errs.append(f"{path or '/'}: {len(v)} items, at least {s['minItems']} expected")
            pre = s.get("prefixItems", [])
            for i, sub in enumerate(pre[:len(v)]):
                self.check(v[i], sub, f"{path}/{i}", errs)
            it = s.get("items")
            if it is not None:
                for i in range(len(pre), len(v)):
                    self.check(v[i], it, f"{path}/{i}", errs)
                    if len(errs) >= MAX_ERR:
                        return


def run(quiet=False):
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    val = Validator(spec)
    rules = [(glob_re(f["pattern"]), f["schema"]) for f in spec["files"]]
    files = sorted(p for p in DATA.rglob("*.json") if not p.name.startswith("."))

    def one(p):
        rel = p.relative_to(DATA).as_posix()
        name = next((s for r, s in rules if r.match(rel)), None)
        if name is None:
            return rel, None, []
        try:
            v = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            return rel, name, [f"unreadable: {e}"[:160]]
        errs = []
        val.check(v, {"$ref": f"#/$defs/{name}"}, "", errs)
        return rel, name, errs

    with ThreadPoolExecutor(16) as pool:
        res = list(pool.map(one, files))
    checked = [(r, n, e) for r, n, e in res if n]
    bad = [(r, n, e) for r, n, e in checked if e]
    for r, n, e in bad:
        print(f"FAIL {r} [{n}]: {e[0]}" + (f" (+{len(e) - 1} more)" if len(e) > 1 else ""))
    unmatched = len(res) - len(checked)
    summary = f"{len(checked)} files under contract, {len(bad)} failing; {len(set(n for _, n, _ in checked))} contracts; {unmatched} files without a contract"
    if not quiet or bad:
        print(summary)
    return len(checked), bad, summary


if __name__ == "__main__":
    n, bad, _ = run("--quiet" in sys.argv)
    sys.exit(1 if bad else 0)
