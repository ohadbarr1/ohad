"""Opt-in auto-publish (publish.py, ops/autopilot.toml [deploy]) and the deploy-branch guard. No network: a bare repo in a temp folder
plays origin, a second clone plays GitHub Actions pushing first; gh (fox-ci) and ./deploy.sh are fakes; nothing is shown (FOX_NO_NOTIFY).

/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests -v
"""
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ["FOX_NO_NOTIFY"] = "1"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import conf  # noqa: E402
import live  # noqa: E402
import publish  # noqa: E402
import regulator as rg  # noqa: E402
import run as runmod  # noqa: E402
import tick  # noqa: E402

BRANCH = "deploy-branch"
# git isolated from the owner's global config (signing, hooks, default branch), deterministic identity
GITENV = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
          "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid", "GIT_TERMINAL_PROMPT": "0"}


def sh(cwd, *args):
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {p.stderr}")
    return p.stdout.strip()


def cfg(auto=True):
    c = conf.load(HERE.parent.parent.parent / "ops" / "autopilot.toml")
    c["repo"] = {**c["repo"], "branch": BRANCH}
    c["deploy"] = {**c["deploy"], "auto": auto}
    return c


def landed_run(gate_ok=True, month=202610):
    """What run.run returns after a scheduled tick that fetched a new regulator month."""
    return {"steps": [{"step": "regulator", "ok": True}, {"step": "regulator-fetch", "ok": True}, {"step": "build", "ok": True}],
            "regulator": {"new": True, "datasets": [{"id": "gemel", "upstream": month, "fox": 202609, "new": True}], "errors": []},
            "gate": {"ran": True, "ok": gate_ok, "fails": [] if gate_ok else ["lens"]}, "_problems": [] if gate_ok else ["gate"],
            "_landed": [f"רשות שוק ההון {rg.month_label(month)} (gemel)"]}


class Repo(unittest.TestCase):
    """origin (bare) <- mac (the owner's checkout, insurance-dashboard/ inside) and ci (another clone)."""

    def setUp(self):
        self.env = mock.patch.dict(os.environ, GITENV)
        self.env.start()
        self.tmp = Path(tempfile.mkdtemp(prefix="fox-pub-"))
        self.origin = self.tmp / "origin.git"
        sh(self.tmp, "init", "--quiet", "--bare", str(self.origin))
        seed = self.tmp / "seed"
        sh(self.tmp, "init", "--quiet", "-b", BRANCH, str(seed))
        self.write(seed, "insurance-dashboard/web/public/data/market.json", {"asof": 202609})
        self.write(seed, "insurance-dashboard/data/keep.json", {"k": 1})
        sh(seed, "add", "-A")
        sh(seed, "commit", "--quiet", "-m", "seed")
        sh(seed, "remote", "add", "origin", str(self.origin))
        sh(seed, "push", "--quiet", "origin", BRANCH)
        self.mac = self.clone("mac")
        self.root = self.mac / "insurance-dashboard"
        self.shown, self.deploys, self.ci = [], [], {}
        self.ops = publish.Ops(gh_ci=lambda root, sha: self.ci.get(sha), deploy=self.fake_deploy,
                               show=lambda t, b, subtitle=None: self.shown.append((t, b)), log=lambda *a: None)
        self.st = {}
        self.now = dt.datetime(2026, 11, 2, 7, 0)

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def clone(self, name):
        d = self.tmp / name
        sh(self.tmp, "clone", "--quiet", "-b", BRANCH, str(self.origin), str(d))
        return d

    @staticmethod
    def write(base, rel, obj):
        p = Path(base) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(obj), encoding="utf-8")

    def fake_deploy(self, root, timeout):
        self.deploys.append(sh(root, "rev-parse", "HEAD"))
        return 0, "Deploy complete!"

    def the_run_writes(self):
        """What a regulator month does to the checkout: a tracked file changes, a new (untracked) ledger file appears."""
        self.write(self.root, "web/public/data/market.json", {"asof": 202610})
        self.write(self.root, "data/ledger/nowcast/Q3-2026/stage3.json", {"frozen": True})

    def ci_pushes_first(self):
        ci = self.clone("ci")
        self.write(ci, "insurance-dashboard/web/public/data/market.json", {"asof": 202610, "by": "ci"})
        self.write(ci, "insurance-dashboard/data/ledger/nowcast/Q3-2026/stage3.json", {"frozen": True, "by": "ci"})
        sh(ci, "add", "-A")
        sh(ci, "commit", "--quiet", "-m", "data: regulator 10/26 (fox-data)")
        sh(ci, "push", "--quiet", "origin", BRANCH)
        return sh(ci, "rev-parse", "HEAD")

    def origin_tip(self):
        return sh(self.origin, "rev-parse", BRANCH)


class Switch(unittest.TestCase):
    def test_off_by_default_and_needs_the_deploy_branch(self):
        c = conf.load(HERE.parent.parent.parent / "ops" / "autopilot.toml")
        self.assertFalse(c["deploy"]["auto"], "the committed toml keeps auto-publish off")
        self.assertFalse(conf.deploy_on(c))
        text = (HERE.parent.parent.parent / "ops" / "autopilot.toml").read_text(encoding="utf-8")
        with mock.patch.dict(sys.modules, {"tomllib": None}):  # the 3.9 fallback reader
            self.assertEqual(conf.parse_toml(text)["deploy"]["auto"], False)
        self.assertFalse(conf.deploy_on(conf.load(os.devnull)), "defaults: off")
        self.assertTrue(conf.deploy_on({"deploy": {"auto": True}, "repo": {"branch": "main"}}))
        self.assertFalse(conf.deploy_on({"deploy": {"auto": True}, "repo": {"branch": ""}}), "never without a named deploy branch")

    def test_off_never_touches_git_or_deploys(self):
        tmp = tempfile.mkdtemp(prefix="fox-pub-")
        try:
            from test_autopilot import make_root  # noqa: PLC0415
            paths = make_root(tmp)
            boom = publish.Ops(git=mock.Mock(side_effect=AssertionError("git")), gh_ci=mock.Mock(side_effect=AssertionError("gh")),
                               deploy=mock.Mock(side_effect=AssertionError("deploy")), show=lambda *a, **k: None, log=lambda *a: None)
            with mock.patch.object(tick, "HOME", Path(tmp) / "state"):
                r = tick.tick(paths, cfg(auto=False), now=dt.datetime(2026, 11, 28, 10, 0, tzinfo=tick.sch.ZoneInfo("Asia/Jerusalem")),
                              force=True, runner=lambda *a, **k: landed_run(), log=lambda *a: None, ops=boom)
            self.assertTrue(r["acted"])
            self.assertNotIn("publish", r)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Land(Repo):
    def test_lands_commits_pushes_then_deploys_when_fox_ci_is_green(self):
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.assertTrue(pre["clean"])
        self.the_run_writes()
        r = publish.land(self.root, cfg(), landed_run(), pre, self.st, now=self.now, ops=self.ops)
        self.assertEqual(r["result"], "pushed")
        sha = sh(self.mac, "rev-parse", "HEAD")
        self.assertEqual(self.origin_tip(), sha, "pushed to the deploy branch")
        self.assertIn("stage3.json", sh(self.mac, "show", "--stat", "--format=", "HEAD"), "the run's new files are in the commit")
        self.assertIn("10/26", sh(self.mac, "log", "-1", "--format=%s"))
        self.assertEqual(self.st["deploy"]["pending"]["sha"], sha)
        # fox-ci still running: wait
        self.ci[sha] = ("in_progress", "")
        self.assertIsNone(publish.advance(self.root, cfg(), self.st, now=self.now + dt.timedelta(minutes=15), ops=self.ops))
        self.assertEqual(self.deploys, [])
        # green: ./deploy.sh runs on exactly that commit
        self.ci[sha] = ("completed", "success")
        r = publish.advance(self.root, cfg(), self.st, now=self.now + dt.timedelta(minutes=30), ops=self.ops)
        self.assertEqual((r["result"], self.deploys), ("deployed", [sha]))
        self.assertNotIn("pending", self.st["deploy"])
        self.assertIn("עלה לאתר", self.shown[-1][0])

    def test_ci_first_pulls_and_skips(self):
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.the_run_writes()
        theirs = self.ci_pushes_first()
        r = publish.land(self.root, cfg(), landed_run(), pre, self.st, now=self.now, ops=self.ops)
        self.assertEqual(r["result"], "ci-first")
        self.assertTrue(r["pulled"])
        self.assertEqual(sh(self.mac, "rev-parse", "HEAD"), theirs, "the Mac now sits on CI's commit")
        self.assertEqual(sh(self.mac, "status", "--porcelain"), "", "the run's own files were put back")
        self.assertEqual(self.origin_tip(), theirs, "nothing pushed")
        self.assertNotIn("pending", self.st.get("deploy", {}))
        self.assertIn("CI", self.shown[-1][0])

    def test_preflight_pulls_what_ci_already_published(self):
        theirs = self.ci_pushes_first()
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.assertEqual((pre["pulled"], sh(self.mac, "rev-parse", "HEAD")), (1, theirs))

    def test_gate_red_dirty_tree_or_local_commits_never_push(self):
        tip = self.origin_tip()
        # gate red
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.the_run_writes()
        self.assertEqual(publish.land(self.root, cfg(), landed_run(gate_ok=False), pre, self.st, ops=self.ops)["result"], "skipped")
        sh(self.mac, "checkout", "--quiet", "--", ".")
        # the owner's own uncommitted edit before the tick
        self.write(self.root, "data/keep.json", {"k": 2})
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.assertFalse(pre["clean"])
        r = publish.land(self.root, cfg(), landed_run(), pre, self.st, ops=self.ops)
        self.assertEqual(r["result"], "skipped")
        self.assertIn("uncommitted", r["why"])
        sh(self.mac, "checkout", "--quiet", "--", ".")
        # the owner's local commit not on origin
        self.write(self.root, "data/keep.json", {"k": 3})
        sh(self.mac, "commit", "--quiet", "-am", "owner work")
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.the_run_writes()
        r = publish.land(self.root, cfg(), landed_run(), pre, self.st, ops=self.ops)
        self.assertEqual(r["result"], "skipped")
        self.assertIn("local commit", r["why"])
        self.assertEqual(self.origin_tip(), tip, "nothing was ever pushed")
        self.assertEqual(self.deploys, [])

    def test_nothing_to_publish_without_a_landed_month(self):
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        res = landed_run()
        res["steps"] = [s for s in res["steps"] if s["step"] != "regulator-fetch"]
        self.assertIsNone(publish.land(self.root, cfg(), res, pre, self.st, ops=self.ops))
        res = landed_run()
        res["regulator"]["new"] = False
        self.assertIsNone(publish.land(self.root, cfg(), res, pre, self.st, ops=self.ops))


class Advance(Repo):
    def pushed(self):
        pre = publish.preflight(self.root, cfg(), ops=self.ops)
        self.the_run_writes()
        publish.land(self.root, cfg(), landed_run(), pre, self.st, now=self.now, ops=self.ops)
        return self.st["deploy"]["pending"]["sha"]

    def test_red_ci_drops_and_notifies(self):
        sha = self.pushed()
        self.ci[sha] = ("completed", "failure")
        r = publish.advance(self.root, cfg(), self.st, now=self.now, ops=self.ops)
        self.assertEqual((r["result"], self.deploys), ("failed", []))
        self.assertIn("נכשל", self.shown[-1][0])

    def test_ci_never_finishes(self):
        self.pushed()
        r = publish.advance(self.root, cfg(), self.st, now=self.now + dt.timedelta(minutes=121), ops=self.ops)
        self.assertEqual(r["result"], "failed")
        self.assertNotIn("pending", self.st["deploy"])

    def test_origin_moved_past_it(self):
        sha = self.pushed()
        other = self.clone("other")
        self.write(other, "insurance-dashboard/data/keep.json", {"k": 9})
        sh(other, "commit", "--quiet", "-am", "newer")
        sh(other, "push", "--quiet", "origin", BRANCH)
        self.ci[sha] = ("completed", "success")
        r = publish.advance(self.root, cfg(), self.st, now=self.now, ops=self.ops)
        self.assertEqual((r["result"], self.deploys), ("dropped", []))

    def test_deploy_failure_is_notified(self):
        sha = self.pushed()
        self.ci[sha] = ("completed", "success")
        self.ops.deploy = lambda root, timeout: (1, "route check failed: not deploying")
        r = publish.advance(self.root, cfg(), self.st, now=self.now, ops=self.ops)
        self.assertEqual(r["result"], "failed")
        self.assertIn("route check", r["why"])


class Guard(Repo):
    def test_feature_branch_checkout_skips_every_tick(self):
        sh(self.mac, "checkout", "--quiet", "-b", "feature/x")
        why = tick.guard(self.root, cfg())
        self.assertIn("feature/x", why)
        self.assertIn(BRANCH, why)
        sh(self.mac, "checkout", "--quiet", BRANCH)
        self.assertIsNone(tick.guard(self.root, cfg()))

    def test_tick_on_a_feature_branch_neither_runs_nor_publishes(self):
        sh(self.mac, "checkout", "--quiet", "-b", "feature/x")
        from common import Paths  # noqa: PLC0415
        boom = publish.Ops(git=mock.Mock(side_effect=AssertionError("git")), gh_ci=mock.Mock(side_effect=AssertionError("gh")),
                           deploy=mock.Mock(side_effect=AssertionError("deploy")), show=lambda *a, **k: None, log=lambda *a: None)
        (self.root / "web/public/data/calendar.json").write_text("{}", encoding="utf-8")
        with mock.patch.object(tick, "HOME", self.tmp / "state"):
            r = tick.tick(Paths(self.root), cfg(), now=dt.datetime(2026, 11, 28, 10, 0, tzinfo=tick.sch.ZoneInfo("Asia/Jerusalem")),
                          force=True, runner=mock.Mock(side_effect=AssertionError("run")), log=lambda *a: None, ops=boom)
        self.assertFalse(r["acted"])
        self.assertIn("feature/x", r["skipped"])


class TickPublishes(Repo):
    def test_a_scheduled_tick_lands_and_pushes(self):
        from common import Paths  # noqa: PLC0415
        (self.root / "web/public/data/calendar.json").write_text("{}", encoding="utf-8")
        sh(self.mac, "add", "-A")
        sh(self.mac, "commit", "--quiet", "-m", "calendar")
        sh(self.mac, "push", "--quiet", "origin", BRANCH)

        def runner(paths, tr, **kw):
            self.the_run_writes()
            return landed_run()
        with mock.patch.object(tick, "HOME", self.tmp / "state"):
            r = tick.tick(Paths(self.root), cfg(), now=dt.datetime(2026, 11, 28, 10, 0, tzinfo=tick.sch.ZoneInfo("Asia/Jerusalem")),
                          force=True, runner=runner, log=lambda *a: None, ops=self.ops)
            self.assertEqual(r["publish"]["result"], "pushed")
            sha = self.origin_tip()
            self.ci[sha] = ("completed", "success")
            r2 = tick.tick(Paths(self.root), cfg(), now=dt.datetime(2026, 11, 28, 10, 15, tzinfo=tick.sch.ZoneInfo("Asia/Jerusalem")),
                           runner=mock.Mock(side_effect=AssertionError("cadence: no run")), log=lambda *a: None, ops=self.ops)
        self.assertEqual(r2["publish"]["result"], "deployed", "a pending deploy moves on even when the cadence does not act")
        self.assertEqual(self.deploys, [sha])

    def test_status_reflects_the_switch(self):
        self.assertTrue(runmod.conf.deploy_on(cfg()))
        self.assertFalse(runmod.conf.deploy_on(cfg(auto=False)))


class Probe(unittest.TestCase):
    def test_cli_outputs_for_the_workflow(self):
        from test_schedule import MARKET, FakeHttp  # noqa: PLC0415
        tmp = Path(tempfile.mkdtemp(prefix="fox-pub-"))
        try:
            (tmp / "market.json").write_text(json.dumps(MARKET), encoding="utf-8")
            out = tmp / "gho"
            rc = rg.main(["--data", str(tmp), "--github-output", str(out), "--json", str(tmp / "p.json")], http=FakeHttp())
            got = dict(ln.split("=", 1) for ln in out.read_text(encoding="utf-8").splitlines())
            self.assertEqual(rc, 0)
            self.assertEqual((got["new"], got["month"], got["label"], got["fox"]), ("true", "202609", "09/26", "202608"))
            self.assertEqual(len(got["frozen_key"]), 16)
            # the key covers the frozen resources only: a re-stamped current resource does not change it
            http2 = FakeHttp()
            orig = http2.get_json

            def restamped(url):
                r = orig(url)
                if "package_show" in url:
                    r["result"]["resources"][1]["last_modified"] = "2026-11-02T05:00:00"
                return r
            http2.get_json = restamped
            rg.main(["--data", str(tmp), "--github-output", str(tmp / "g2")], http=http2)
            self.assertIn(f"frozen_key={got['frozen_key']}", (tmp / "g2").read_text(encoding="utf-8"))
            # an unreachable dataset is a failure, never "nothing new"
            rc = rg.main(["--data", str(tmp), "--retries", "2"], http=FakeHttp(fail={"insurance"}), sleep=lambda s: None)
            self.assertEqual(rc, 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Live(unittest.TestCase):
    CHANNELS = {"status": "success", "result": {"channels": [
        {"name": "projects/1/sites/fox-research-il/channels/pr-7", "release": {"version": {"name": "sites/fox-research-il/versions/zzz"}}},
        {"name": "projects/1/sites/fox-research-il/channels/live", "release": {"version": {"name": "sites/fox-research-il/versions/abc123"}}}]}}

    def test_rollback_point_is_the_live_channel_version(self):
        self.assertEqual(live.live_version(self.CHANNELS), "abc123")
        self.assertIsNone(live.live_version({"result": {"channels": []}}))
        tmp = Path(tempfile.mkdtemp(prefix="fox-pub-"))
        try:
            (tmp / "c.json").write_text("i  hosting: listing\n" + json.dumps(self.CHANNELS), encoding="utf-8")
            self.assertEqual(live.main(["prev", "--channels", str(tmp / "c.json")]), 0)
            (tmp / "c.json").write_text("{}", encoding="utf-8")
            self.assertEqual(live.main(["prev", "--channels", str(tmp / "c.json")]), 1, "no rollback point: refuse")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_verify_needs_the_month_everywhere_and_this_commits_qa(self):
        tmp = Path(tempfile.mkdtemp(prefix="fox-pub-"))
        try:
            (tmp / "qa.json").write_text(json.dumps({"built": "B2"}), encoding="utf-8")
            site = {"lens.json": {"meta": {"asof": 202610}}, "funds.json": {"asof": 202610}, "market_home.json": {"meta": {"asof": 202610}},
                    "qa.json": {"built": "B2"}}
            get = lambda url: site[url.split("/data/")[1].split("?")[0]]  # noqa: E731
            self.assertEqual(live.check(202610, data=tmp, get=get), [])
            site["funds.json"] = {"asof": 202609}
            self.assertEqual(live.check(202610, data=tmp, get=get), ["funds.json: as-of 202609, expected 202610"])
            site["funds.json"], site["qa.json"] = {"asof": 202610}, {"built": "B1"}
            self.assertIn("qa.json", live.check(202610, data=tmp, get=get)[0])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
