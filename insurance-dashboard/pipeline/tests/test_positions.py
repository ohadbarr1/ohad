"""The position book (module A6): pipeline/position.py (authoring) and pipeline/build_positions.py (engine) against the repo's published
files, with the working folder and the ledger in a temporary directory. Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_positions as bp  # noqa: E402
import check_schemas  # noqa: E402
import position as cli  # noqa: E402

GAP = "lens:clal:pg:ci.ltm - lens:median(harel,migdal,menora,phoenix):pg:ci.ltm"


def sample(pid="test-clal-gap", **kw):
    p = {"id": pid, "claim": "כלל תסגור מחצית מפער יחס ההוצאות להכנסות מול חציון המבטחות עד FY'28.", "horizon": "2029-03-31",
         "confidence": "low", "direction": "constructive", "company": "clal", "mechanism": "הוצאות שגדלות מהר מדמי הניהול.",
         "evidence": [{"ref": "/savings?g=כלל&s=pg", "note": "המגזר"}, {"ref": "lens:clal:pg:ci.ltm", "note": "LTM"},
                      {"ref": "target:clal:target_roe:group:2027", "note": "יעד"}],
         "falsifiers": [{"metric": GAP, "op": ">", "value": 7.0, "period": "Q4'28", "note": ""}],
         "triggers": [{"metric": GAP, "threshold_pp": 2.0}], "review": "print"}
    p.update(kw)
    return p


class Positions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = bp.Ctx()
        cls.spec = json.loads((bp.ROOT / "web" / "src" / "lib" / "schemas.json").read_text(encoding="utf-8"))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.work, self.led = t / "positions", t / "ledger"
        self.book = cli.Book(self.work, self.led, ctx=self.ctx, today="2026-10-27")
        bp.ABSTAIN_PHOENIX = False

    def tearDown(self):
        bp.ABSTAIN_PHOENIX = False
        self.tmp.cleanup()

    def schema_errs(self, v, name):
        errs = []
        check_schemas.Validator(self.spec).check(v, {"$ref": f"#/$defs/{name}"}, "", errs)
        return errs

    # ---------------------------------------------------------------- the metric grammar
    def test_metric_keys_resolve(self):
        for k in (GAP, "lens:median(harel,migdal,clal,menora,phoenix):pen:fy_rep", "lens:altshuler:pg:tr.ltm", "kpi:clal:profit", "solv:clal"):
            m = self.ctx.metric(k)
            self.assertTrue(m["ser"], k)
            self.assertTrue(all(isinstance(x["v"], (int, float)) and x["in"] for x in m["ser"]), k)
        for k in ("lens:nobody:pg:ci", "lens:clal:pg:fy_rep.ltm", "lens:clal:xx:ci", "price:clal", "kpi:clal:nothing"):
            with self.assertRaises(KeyError, msg=k):
                self.ctx.metric(k)

    def test_ltm_ci_is_the_ratio_of_sums(self):
        m = self.ctx.metric("lens:clal:pg:ci.ltm")["ser"][-1]
        sm, ga, fees = (self.ctx.metric(f"lens:clal:pg:{f}.ltm")["ser"][-1]["v"] for f in ("sm", "ga", "fees"))
        self.assertAlmostEqual(m["v"], (sm + ga) / fees * 100, places=4)

    def test_gap_is_the_difference_of_its_terms(self):
        g = self.ctx.metric(GAP)["ser"][-1]
        self.assertAlmostEqual(g["v"], g["in"][0]["v"] - g["in"][1]["v"], places=6)
        peers = [x["v"] for x in g["in"][1]["in"]]
        self.assertEqual(len(peers), 4)
        self.assertAlmostEqual(g["in"][1]["v"], sorted(peers)[1] / 2 + sorted(peers)[2] / 2, places=6)

    def test_routes_exist_in_the_app(self):
        """every static segment of an evidence route is a route path in web/src/App.tsx"""
        app = (bp.ROOT / "web" / "src" / "App.tsx").read_text(encoding="utf-8")
        for r in bp.ROUTES:
            for seg in (x for x in r.strip("/").split("/") if x and not x.startswith(":")):
                self.assertRegex(app, rf'path="([^"]*/)?{re.escape(seg)}(/[^"]*)?"', r)

    # ---------------------------------------------------------------- authoring rules
    def test_new_validates(self):
        self.assertTrue(self.book.new(sample()).exists())
        for bad, why in ((sample("t-nofals", falsifiers=[]), "falsifier"), (sample("t-badref", evidence=[{"ref": "/nowhere", "note": ""}]), "no such fox page"),
                         (sample("t-past", horizon="2026-01-01"), "future"), (sample("t-buy", claim="המלצת קנייה על כלל לקראת הדוח הבא, ברור"), "fundamentals"),
                         (sample("t-unres", falsifiers=[{"metric": "lens:clal:pg:nope", "op": ">", "value": 1, "period": "Q4'28"}]), "field"),
                         (sample("t-period", falsifiers=[{"metric": GAP, "op": ">", "value": 1, "period": "Q4'30"}]), "after the horizon")):
            with self.assertRaises(SystemExit) as e:
                self.book.new(bad)
            self.assertIn(why, str(e.exception))
            self.assertFalse(self.book.path(bad["id"]).exists())

    def test_publish_revise_close_append_only(self):
        self.book.new(sample())
        r1 = self.book.publish("test-clal-gap")
        b1 = r1.read_bytes()
        e1 = json.loads(b1)
        self.assertEqual((e1["rev"], e1["supersedes"], e1["date"]), (1, None, "2026-10-27"))
        self.assertEqual(e1["position"]["triggers"][0]["base"]["per"], "Q2'26")
        self.assertNotIn("status", e1["position"])
        with self.assertRaises(SystemExit):
            self.book.publish("test-clal-gap")
        with self.assertRaises(SystemExit):  # nothing changed
            self.book.revise("test-clal-gap", "no change")
        w = json.loads(self.book.path("test-clal-gap").read_text(encoding="utf-8"))
        self.assertEqual(w["status"], "published")
        w["confidence"] = "medium"
        w["triggers"][0]["base"] = {"per": "Q1'26", "v": 0.0}  # an edited base is ignored: the frozen one is kept
        self.book.write(w)
        self.book.today = "2026-11-30"
        r2 = self.book.revise("test-clal-gap", "Q3'26 print")
        e2 = json.loads(r2.read_bytes())
        self.assertEqual((e2["rev"], e2["supersedes"]), (2, "r1"))
        self.assertEqual(e2["position"]["triggers"][0]["base"], e1["position"]["triggers"][0]["base"])
        self.assertEqual(r1.read_bytes(), b1)
        self.assertEqual(bp.ledger_problems(bp.read_ledger(self.led), self.ctx), [])
        with self.assertRaises(SystemExit):
            self.book.close("test-clal-gap", "expired", "too early")  # the horizon has not passed
        o = self.book.close("test-clal-gap", "withdrawn", "the owner withdrew it")
        self.assertEqual(json.loads(o.read_bytes())["rev"], 2)
        with self.assertRaises(SystemExit):
            self.book.close("test-clal-gap", "confirmed", "twice")
        with self.assertRaises(SystemExit):
            self.book.revise("test-clal-gap", "after a close")
        with self.assertRaises(FileExistsError):
            self.book.append("test-clal-gap", "r1.json", e1)
        self.assertEqual(bp.ledger_problems(bp.read_ledger(self.led), self.ctx), [])

    def test_ledger_tampering_is_caught(self):
        self.book.new(sample())
        f = self.book.publish("test-clal-gap")
        e = json.loads(f.read_text(encoding="utf-8"))
        e["position"]["confidence"] = "high"  # edited in place: the hash no longer recomputes
        f.write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("hash" in x for x in bp.ledger_problems(bp.read_ledger(self.led), self.ctx)))
        e["position"]["falsifiers"] = []
        e["hash"] = bp.sha(e["position"])
        f.write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("falsifier" in x for x in bp.ledger_problems(bp.read_ledger(self.led), self.ctx)))
        e["position"]["falsifiers"] = sample()["falsifiers"]
        e["position"]["evidence"] = [{"ref": "lens:clal:pg:gone", "note": ""}]
        e["hash"] = bp.sha(e["position"])
        f.write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("evidence" in x for x in bp.ledger_problems(bp.read_ledger(self.led), self.ctx)))

    # ---------------------------------------------------------------- the engine
    def test_drafts_hidden_by_default(self):
        self.book.new(sample("draft-one"))
        out, _ = bp.build(self.ctx, self.led, self.work)
        self.assertEqual(out["positions"], [])
        self.assertFalse(out["drafts"])
        out, _ = bp.build(self.ctx, self.led, self.work, drafts=True)
        self.assertEqual([p["status"] for p in out["positions"]], ["draft"])
        self.assertTrue(out["drafts"])
        self.assertEqual(out["events"], [])  # a draft never reaches the feed
        self.assertEqual(self.schema_errs(out, "positions"), [])

    def test_falsifier_met_suggests_but_never_closes(self):
        p = sample("test-alt", company="altshuler", claim="אלטשולר שחם תחזור להעברות נטו חיוביות בפנסיה ובגמל, LTM, עד FY'27.",
                   evidence=[{"ref": "lens:altshuler:pg:tr.ltm", "note": ""}],
                   falsifiers=[{"metric": "lens:altshuler:pg:tr.ltm", "op": "<", "value": -20000, "period": "each", "note": ""}],
                   triggers=[{"metric": "lens:altshuler:pg:tr.ltm", "threshold_pct": 25}])
        self.book.new(p)
        f = self.book.publish("test-alt")
        e = json.loads(f.read_text(encoding="utf-8"))
        # back-date the frozen baselines as if the position had been opened at Q2'25 (a test ledger, rewritten with its hash)
        e["position"]["falsifiers"][0]["since"] = "Q2'25"
        old = next(x for x in self.ctx.metric("lens:altshuler:pg:tr.ltm")["ser"] if x["p"] == "2025Q2")
        e["position"]["triggers"][0]["base"] = {"per": "Q2'25", "v": old["v"]}
        e["hash"] = bp.sha(e["position"])
        f.write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")
        out, _ = bp.build(self.ctx, self.led, self.work)
        x = out["positions"][0]
        self.assertEqual(x["falsifiers"][0]["st"], "met")
        self.assertEqual(x["suggest"], "falsified")
        self.assertEqual(x["outcome"]["st"], "open")
        self.assertTrue(x["drift"])
        self.assertGreater(x["triggers"][0]["first"]["p"], "2025Q2")
        kinds = sorted(ev["pk"] for ev in out["events"])
        self.assertEqual(kinds, ["drift", "falsifier", "open"])
        for ev in out["events"]:
            self.assertEqual(self.schema_errs(ev, "feedEvent"), [], ev["id"])
            self.assertRegex(ev["d"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(self.schema_errs(out, "positions"), [])

    def test_hit_rate_over_closed_only(self):
        for pid, oc in (("t-a", "confirmed"), ("t-b", "falsified"), ("t-c", "withdrawn"), ("t-d", None)):
            self.book.new(sample(pid))
            self.book.publish(pid)
            if oc:
                self.book.close(pid, oc, "note")
        out, _ = bp.build(self.ctx, self.led, self.work)
        h = out["hit"]
        self.assertEqual((h["n"], h["confirmed"], h["falsified"], h["withdrawn"], h["open"], h["hit"]), (3, 1, 1, 1, 1, 50.0))

    def test_phoenix_flag(self):
        p = sample("t-phx", company="phoenix", evidence=[{"ref": "lens:phoenix:pg:ci.ltm", "note": ""}],
                   falsifiers=[{"metric": "lens:phoenix:pg:ci.ltm", "op": ">=", "value": 80, "period": "each"}], triggers=[])
        self.book.new(p)
        bp.ABSTAIN_PHOENIX = True
        with self.assertRaises(SystemExit) as e:
            self.book.publish("t-phx")
        self.assertIn("ABSTAIN_PHOENIX", str(e.exception))
        bp.ABSTAIN_PHOENIX = False  # the owner's default (27.10.26): phoenix is published like any other company
        self.book.publish("t-phx")
        out, _ = bp.build(self.ctx, self.led, self.work)
        self.assertEqual((len(out["positions"]), out["abstain"]), (1, {}))
        bp.ABSTAIN_PHOENIX = True
        out, _ = bp.build(self.ctx, self.led, self.work)
        self.assertEqual((len(out["positions"]), out["withheld"]), (0, 1))
        self.assertIn("phoenix", out["abstain"])

    def test_repo_drafts_are_valid_and_unpublished(self):
        """the seeded candidate drafts: valid, status draft, none in the repo's ledger"""
        L = bp.read_ledger()
        for f in sorted(bp.WORK.glob("*.json")):
            p = bp.load(f)
            if p.get("status") == "draft":
                self.assertNotIn(p["id"], L)
                self.assertEqual(bp.validate({k: v for k, v in p.items() if k != "status"}, self.ctx), [], p["id"])

    def test_cli_parsers(self):
        f = cli.parse_falsifier("lens:clal:pg:ci.ltm > 90 @ Q4'28|note here")
        self.assertEqual((f["metric"], f["op"], f["value"], f["period"], f["note"]), ("lens:clal:pg:ci.ltm", ">", 90, "Q4'28", "note here"))
        self.assertEqual(cli.parse_falsifier(GAP + " >= 7.5 @ each")["metric"], GAP)
        self.assertEqual(cli.parse_trigger("lens:clal:pg:ci.ltm pp=2"), {"metric": "lens:clal:pg:ci.ltm", "threshold_pp": 2.0})
        self.assertEqual(cli.parse_evidence("/savings?g=כלל|why"), {"ref": "/savings?g=כלל", "note": "why"})


if __name__ == "__main__":
    unittest.main()
