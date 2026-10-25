"""Scheduler, permitted discovery, budget and notification tests (no network, no osascript, no claude, no git writes).

/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests -v
"""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ["FOX_NO_NOTIFY"] = "1"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import conf  # noqa: E402
import llm  # noqa: E402
import notify  # noqa: E402
import poll  # noqa: E402
import regulator as rg  # noqa: E402
import run  # noqa: E402
import schedule as sch  # noqa: E402
import tick  # noqa: E402
from common import Paths  # noqa: E402
from test_autopilot import FIX, make_root  # noqa: E402

IL = sch.ZoneInfo("Asia/Jerusalem")
# three companies from calendar.json as built on 25.10.26 (Phoenix's range starts early: one early Q3 in its history)
CAL = {"companies": [
    {"id": "more_gemel", "name": "מור גמל ופנסיה", "next": {"period": "2026Q3", "expected": "2026-11-20", "lo": "2026-11-20", "hi": "2026-11-22"}},
    {"id": "phoenix", "name": "הפניקס", "next": {"period": "2026Q3", "expected": "2026-11-27", "lo": "2026-11-05", "hi": "2026-11-29"}},
    {"id": "harel", "name": "הראל", "next": {"period": "2026Q3", "expected": "2026-11-28", "lo": "2026-11-25", "hi": "2026-11-28"}},
    {"id": "idi", "name": "ביטוח ישיר", "inactive": True, "next": None},
]}
MARKET = {"products": [{"key": "gemel", "family": "gemel"}, {"key": "pension_new", "family": "pension"}, {"key": "ins", "family": "insurance"}],
          "periods": [202607, 202608], "rows": [[1, 0, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0]]}


def at(y, mo, d, h, mi=0):
    return dt.datetime(y, mo, d, h, mi, tzinfo=IL)


def cfg(**over):
    c = conf.load(HERE.parent.parent.parent / "ops" / "autopilot.toml")
    for sec, vals in over.items():
        c[sec] = {**c[sec], **vals}
    return c


class FakeHttp:
    """data.gov.il CKAN answers: package_show (two resources, the current one named 'היום') and datastore_search (latest month)."""

    def __init__(self, months=None, fail=()):
        self.months = months or {"gemelnet": 202609, "pensia-net": 202609, "insurance": 202609}
        self.fail, self.calls = set(fail), []

    def get_json(self, url):
        self.calls.append(url)
        if "package_show" in url:
            pkg = url.split("id=")[1]
            if pkg in self.fail:
                raise OSError("timed out")
            return {"result": {"resources": [
                {"id": f"{pkg}-old", "name": "נתונים לשנת 2023", "format": "CSV", "datastore_active": True, "last_modified": "2024-07-10T10:50:01"},
                {"id": f"{pkg}-now", "name": "נתונים לשנים 2024-היום", "format": "CSV", "datastore_active": True, "last_modified": "2026-10-25T04:00:17"}]}}
        rid = url.split("resource_id=")[1].split("&")[0]
        return {"result": {"records": [{"REPORT_PERIOD": self.months[rid[:-4]]}]}}


class Config(unittest.TestCase):
    def test_toml_reader_matches_the_committed_file_and_defaults_are_off(self):
        c = cfg()
        text = (HERE.parent.parent.parent / "ops" / "autopilot.toml").read_text(encoding="utf-8")
        with mock.patch.dict(sys.modules, {"tomllib": None}):  # force the 3.9 fallback reader
            fb = conf.parse_toml(text)
        self.assertEqual(fb["schedule"]["in_window_minutes"], 15)
        self.assertEqual(fb["llm"]["season_budget_tokens"], 1_000_000)
        self.assertEqual(fb["schedule"]["days"], ["sun", "mon", "tue", "wed", "thu", "fri"])
        self.assertIs(fb["discovery"]["maya_scheduled"], False)
        self.assertFalse(conf.maya_scheduled(c), "MAYA is never scheduled by default")
        self.assertFalse(conf.llm_on(c), "the LLM hook is off by default")
        self.assertFalse(conf.maya_scheduled(cfg(discovery={"maya_scheduled": True})), "the switch alone is not enough")
        self.assertTrue(conf.maya_scheduled(cfg(discovery={"maya_scheduled": True, "maya_permission_ref": "TASE letter 01.12.26"})))
        self.assertFalse(conf.llm_on(cfg(llm={"enabled": True})), "enabled needs approved_by")


class Cadence(unittest.TestCase):
    def test_windows_merge_and_skip_inactive(self):
        w = sch.windows(CAL, 10)
        self.assertEqual(len(w), 1)
        self.assertEqual((w[0]["start"], w[0]["end"]), (dt.date(2026, 10, 26), dt.date(2026, 12, 9)))
        self.assertEqual(sorted(w[0]["companies"]), ["harel", "more_gemel", "phoenix"])

    def test_every_15_minutes_in_a_window_on_filing_days(self):
        c = cfg()
        last = {"last_run": at(2026, 11, 24, 9, 46).isoformat(), "last_regulator": at(2026, 11, 24, 8).isoformat()}
        d = sch.decide(c, CAL, last, at(2026, 11, 24, 10, 0))  # Tuesday, in the window, 14 min after the last run
        self.assertEqual((d["cadence"], d["why"], d["act"], d["regulator"]), (15, "window", True, False))
        d = sch.decide(c, CAL, {**last, "last_run": at(2026, 11, 24, 9, 55).isoformat()}, at(2026, 11, 24, 10, 0))
        self.assertFalse(d["act"], "5 minutes after the last run")

    def test_hourly_off_hours_saturday_and_off_season(self):
        c = cfg()
        reg = {"last_regulator": at(2026, 11, 28, 8).isoformat()}
        self.assertEqual(sch.decide(c, CAL, reg, at(2026, 11, 24, 22, 15))["cadence"], 60)  # after 22:00
        self.assertEqual(sch.decide(c, CAL, reg, at(2026, 11, 28, 11))["cadence"], 60)  # Saturday
        jan = {"last_run": at(2027, 1, 15, 9, 30).isoformat(), "last_regulator": at(2027, 1, 15, 6).isoformat()}
        d = sch.decide(c, CAL, jan, at(2027, 1, 15, 10, 0))
        self.assertEqual((d["cadence"], d["why"], d["act"]), (60, "season-off", False))
        self.assertTrue(sch.decide(c, CAL, jan, at(2027, 1, 15, 10, 30))["act"])

    def test_regulator_daily(self):
        c = cfg()
        d = sch.decide(c, CAL, {"last_run": at(2027, 1, 15, 9, 50).isoformat(), "last_regulator": at(2027, 1, 14, 10).isoformat()}, at(2027, 1, 15, 10))
        self.assertTrue(d["regulator"] and d["act"], "24 h after the last probe the tick acts for the regulator alone")
        d = sch.decide(c, CAL, {"last_run": at(2027, 1, 15, 9, 50).isoformat(), "last_regulator": at(2027, 1, 15, 4).isoformat()}, at(2027, 1, 15, 10))
        self.assertFalse(d["regulator"])
        self.assertFalse(sch.decide(cfg(discovery={"regulator": False}), CAL, {}, at(2027, 1, 15, 10))["regulator"])

    def test_due_and_late(self):
        self.assertEqual([x["id"] for x in sch.due(CAL, dt.date(2026, 11, 28))], ["more_gemel", "phoenix", "harel"])  # More Gemel: late, still reminded
        self.assertEqual([x["id"] for x in sch.due(CAL, dt.date(2026, 12, 3))], ["phoenix", "harel"])  # 10 days past its range: dropped
        self.assertTrue(next(x for x in sch.due(CAL, dt.date(2026, 11, 29)) if x["id"] == "harel")["late"])
        self.assertEqual(sch.due(CAL, dt.date(2026, 11, 19)), [])
        self.assertEqual(sch.due(CAL, dt.date(2026, 12, 20)), [])


class Regulator(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="fox-ap-"))
        (self.tmp / "market.json").write_text(json.dumps(MARKET), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_new_month_upstream(self):
        r = rg.probe(FakeHttp(), self.tmp, log=lambda *a: None)
        self.assertTrue(r["new"])
        self.assertEqual({d["id"]: (d["fox"], d["upstream"]) for d in r["datasets"]},
                         {"gemel": (202608, 202609), "pensia": (202608, 202609), "insurance": (202608, 202609)})
        self.assertEqual(r["datasets"][0]["resource"], "gemelnet-now")
        self.assertEqual(rg.month_label(202609), "09/26")

    def test_same_month_and_errors_are_not_new(self):
        r = rg.probe(FakeHttp({"gemelnet": 202608, "pensia-net": 202608, "insurance": 202608}, fail={"insurance"}), self.tmp, log=lambda *a: None)
        self.assertFalse(r["new"])
        self.assertEqual(r["errors"][0]["id"], "insurance")
        self.assertIsNone(r["datasets"][2]["upstream"])


class ScheduledRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        (self.paths.data / "market.json").write_text(json.dumps(MARKET), encoding="utf-8")
        (self.paths.data / "calendar.json").write_text(json.dumps(CAL, ensure_ascii=False), encoding="utf-8")
        self.quiet = lambda *a, **k: None
        self.dag = []
        notify.SENT.clear()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_dag(self, paths, argv, log, step="build"):
        self.dag.append(" ".join(argv))
        return {"step": step, "script": " ".join(argv), "ok": True, "tail": "ok"}

    def go(self, http, regulator=True, **kw):
        with mock.patch.object(run, "run_dag", self.fake_dag), \
                mock.patch.object(run, "gate", lambda paths, log: {"ran": True, "ok": True, "fails": [], "built": None}), \
                mock.patch.object(poll, "poll", side_effect=AssertionError("MAYA must not be called")):
            return run.run(self.paths, None, apply=True, do_poll=False, regulator=regulator, http=http, cfg=cfg(), trigger="schedule",
                           today=dt.date(2026, 10, 25), log=self.quiet, **kw)

    def test_new_regulator_month_lands_through_the_dag_and_notifies(self):
        st = self.go(FakeHttp())
        self.assertEqual(self.dag, [" ".join(run.DAG_REGULATOR), " ".join(run.DAG_DEPLOY)])
        self.assertIn("רשות שוק ההון 09/26 (gemel)", st["_landed"])
        s = json.loads(self.paths.status.read_text(encoding="utf-8"))
        self.assertEqual(s["runs"][0]["trigger"], "schedule")
        self.assertTrue(s["runs"][0]["gate"])
        self.assertEqual(s["publish"]["commands"][-1], run.DEPLOY)
        self.assertFalse(s["publish"]["auto"])
        self.assertFalse(s["discovery"]["maya_scheduled"])
        self.assertEqual(s["schedule"]["next"]["start"], "2026-10-26")
        self.assertEqual(s["llm_budget"]["budget"], 1_000_000)
        self.assertEqual(len(notify.SENT), 1)
        self.assertIn("./deploy.sh", notify.SENT[0]["body"])
        self.assertIn("נחת", notify.SENT[0]["title"])

    def test_a_scheduled_tick_that_finds_nothing_leaves_the_repo_untouched(self):
        before = sorted(p for p in Path(self.tmp).rglob("*") if p.is_file())
        st = self.go(FakeHttp({"gemelnet": 202608, "pensia-net": 202608, "insurance": 202608}))
        self.assertEqual(sorted(p for p in Path(self.tmp).rglob("*") if p.is_file()), before)
        self.assertIsNone(st["_written"])
        self.assertEqual(self.dag, [])
        self.assertEqual(notify.SENT, [])

    def test_a_tick_with_nothing_due_does_not_rebuild(self):
        before = sorted(p for p in Path(self.tmp).rglob("*") if p.is_file())
        st = self.go(None, regulator=False)
        self.assertEqual((self.dag, st["_written"], st["gate"]["ran"]), ([], None, False))
        self.assertEqual(sorted(p for p in Path(self.tmp).rglob("*") if p.is_file()), before)


class Entry(unittest.TestCase):
    """The CLI never builds a MAYA transport unless --maya-once (or a replay), and --maya-once is at most one request per 2 s."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        self.toml = Path(self.tmp) / "autopilot.toml"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def main(self, extra, toml=""):
        self.toml.write_text(toml, encoding="utf-8")
        seen = {}

        def transport(a, log=print):
            seen["interval"] = a.interval
            from common import Replay
            return Replay(FIX / "maya_2026q2")
        with mock.patch.dict(os.environ, {"FOX_AUTOPILOT_TOML": str(self.toml)}), mock.patch.object(poll, "transport", transport):
            rc = run.main(["--root", self.tmp, "--no-regulator", "--skip-build", "--skip-gate", "--no-notify", "--companies", "phoenix",
                           "--today", "2026-08-31", "--status-out", str(Path(self.tmp) / "s.json"), *extra])
        return rc, seen

    def test_apply_does_not_touch_maya(self):
        rc, seen = self.main(["--apply"])
        self.assertEqual((rc, seen), (0, {}))
        rc, seen = self.main(["--apply"], toml='[discovery]\nmaya_scheduled = true\nmaya_permission_ref = ""\n')
        self.assertEqual(seen, {}, "maya_scheduled without TASE's permission reference stays off")

    def test_maya_once_is_slow_and_manual(self):
        rc, seen = self.main(["--maya-once", "--dry-run", "--interval", "0.5"])
        self.assertEqual(rc, 0)
        self.assertGreaterEqual(seen["interval"], 2.0)
        s = json.loads((Path(self.tmp) / "s.json").read_text(encoding="utf-8"))
        self.assertEqual(s["mode"], "dry-run")
        self.assertTrue(any(x["step"] == "poll" for x in s["steps"]))


class Tick(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        (self.paths.data / "calendar.json").write_text(json.dumps(CAL, ensure_ascii=False), encoding="utf-8")
        self.home = mock.patch.object(tick, "HOME", Path(self.tmp) / "state")
        self.home.start()
        self.calls = []
        notify.SENT.clear()

    def tearDown(self):
        self.home.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def runner(self, paths, tr, **kw):
        self.calls.append(kw)
        return {"_landed": [], "_problems": [], "_written": None, "regulator": {"errors": []}}

    def test_cadence_state_and_one_reminder_a_day(self):
        c = cfg()
        r1 = tick.tick(self.paths, c, now=at(2026, 11, 28, 10, 0), runner=self.runner, log=lambda *a: None)  # Saturday: hourly
        self.assertTrue(r1["acted"])
        self.assertEqual(self.calls[0]["do_poll"], False, "no MAYA on a schedule")
        self.assertTrue(self.calls[0]["regulator"])
        self.assertEqual(self.calls[0]["trigger"], "schedule")
        self.assertEqual(r1["reminded"], ["more_gemel", "phoenix", "harel"])
        self.assertIn("--maya-once --companies more_gemel,phoenix,harel", notify.SENT[0]["body"])
        r2 = tick.tick(self.paths, c, now=at(2026, 11, 28, 10, 15), runner=self.runner, log=lambda *a: None)
        self.assertFalse(r2["acted"])
        self.assertIn("cadence 60", r2["skipped"])
        self.assertEqual(r2["reminded"], [], "one reminder per company per day")
        r3 = tick.tick(self.paths, c, now=at(2026, 11, 29, 9, 0), runner=self.runner, log=lambda *a: None)  # Sunday, in window
        self.assertTrue(r3["acted"])
        self.assertFalse(self.calls[-1]["regulator"], "the regulator probe is daily")
        self.assertEqual(r3["decision"]["cadence"], 15)
        st = json.loads((Path(self.tmp) / "state" / "state.json").read_text(encoding="utf-8"))
        self.assertEqual(st["reminded"]["harel"], "2026-11-29")

    def test_branch_guard(self):
        with mock.patch.object(tick, "guard", lambda root, c: "on branch feature, the autopilot runs on main"):
            r = tick.tick(self.paths, cfg(), now=at(2026, 11, 24, 10), runner=self.runner, log=lambda *a: None)
        self.assertFalse(r["acted"])
        self.assertEqual(self.calls, [])


class Budget(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        pdf = self.paths.root / "data/sources/pdf/harel/2026Q3/1770000_quarterly.pdf"
        pdf.parent.mkdir(parents=True)
        pdf.write_bytes(b"%PDF-1.7 stub")
        self.filing = {"company": "harel", "period": "2026Q3", "rid": 1770000, "type": "quarterly",
                       "pdf": [{"local": "data/sources/pdf/harel/2026Q3/1770000_quarterly.pdf"}]}
        self.on = cfg(llm={"enabled": True, "approved_by": "Ohad", "season": "2026Q3", "season_budget_tokens": 200_000,
                           "per_filing_tokens": 120_000, "per_run_tokens": 300_000})
        self.cmds = []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_claude(self, tokens):
        def runner(cmd, cwd, **kw):
            self.cmds.append(cmd)
            out = Path(cwd) / cmd[cmd.index("--allowedTools") + 2][len("Write(./"):-1]
            out.write_text(json.dumps({"company": "harel", "period": "2026Q3", "facts": [{"metric": "profit", "value": 1, "page_he": 5}]}))
            return mock.Mock(returncode=0, stdout=json.dumps({"is_error": False, "total_cost_usd": 0.9, "usage": {
                "input_tokens": tokens - 1000, "output_tokens": 1000, "cache_read_input_tokens": 0}}), stderr="")
        return runner

    def test_off_by_default_calls_nothing(self):
        r = llm.extract(self.filing, cfg(), self.paths, llm.Budget(self.paths, cfg()), runner=self.fake_claude(1))
        self.assertFalse(r["ran"])
        self.assertEqual(self.cmds, [])

    def test_on_spends_from_the_season_and_stops_when_short(self):
        b = llm.Budget(self.paths, self.on)
        r = llm.extract(self.filing, self.on, self.paths, b, runner=self.fake_claude(90_000))
        self.assertTrue(r["ran"] and r["ok"])
        self.assertEqual(r["tokens"], 90_000)
        cmd = self.cmds[0]
        self.assertEqual(cmd[:2], ["claude", "-p"])
        self.assertIn("--max-budget-usd", cmd)
        self.assertIn("Write(./data/extracted_autopilot/harel/2026Q3_1770000.json)", cmd)
        self.assertNotIn("Bash", " ".join(cmd[cmd.index("--allowedTools"):]))
        doc = json.loads((self.paths.root / r["out"]).read_text(encoding="utf-8"))
        self.assertEqual(doc["status"], "unverified")
        led = json.loads(llm.ledger_path(self.paths).read_text(encoding="utf-8"))
        self.assertEqual((led["season"], led["spent"]), ("2026Q3", 90_000))
        r2 = llm.extract(self.filing, self.on, self.paths, llm.Budget(self.paths, self.on), runner=self.fake_claude(90_000))
        self.assertFalse(r2["ran"], "110k left < the 120k per-filing cap")
        self.assertIn("2026Q3", r2["why"])
        self.assertEqual(len(self.cmds), 1)
        nxt = {**self.on, "llm": {**self.on["llm"], "season": "2027Q1"}}
        self.assertEqual(llm.Budget(self.paths, nxt).season_left, 200_000, "a new season starts a new budget")
        self.assertEqual(llm.pending(self.paths), ["data/extracted_autopilot/harel/2026Q3_1770000.json"])

    def test_estimate_over_the_per_filing_cap_is_skipped(self):
        r = llm.extract(self.filing, self.on, self.paths, llm.Budget(self.paths, self.on), est=500_000, runner=self.fake_claude(1))
        self.assertFalse(r["ran"])
        self.assertEqual(self.cmds, [])


class Notify(unittest.TestCase):
    def test_recorded_not_shown_under_tests(self):
        m = notify.show('fox · "x"', "body")
        self.assertFalse(m["shown"])
        self.assertEqual(notify.SENT[-1]["title"], 'fox · "x"')


if __name__ == "__main__":
    unittest.main()
