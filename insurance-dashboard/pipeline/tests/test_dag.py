"""pipeline/dag.py on a small fixture graph in a temporary folder (standard library only, < 2 s).

/usr/bin/python3 -m unittest discover -s pipeline/tests -v

Fixture: a -> b -> d <- c <- m (manual, network); k -> kedit (edits k.json in place) -> d; day (daily, group deploy). Each script
appends its name to run.log and writes its outputs from its inputs.

"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dag  # noqa: E402

SCRIPT = """import sys, pathlib
name, ins, outs = sys.argv[1], sys.argv[2].split(",") if sys.argv[2] else [], sys.argv[3].split(",") if sys.argv[3] else []
root = pathlib.Path.cwd()
with open(root / "run.log", "a") as f:
    f.write(name + "\\n")
text = name + ":" + "|".join((root / i).read_text() if (root / i).exists() else "-" for i in ins)
for o in outs:
    (root / o).write_text(text)
"""


def S(name, ins, outs, **kw):
    return dag.step(name, [["tool.py", name, ",".join(ins), ",".join(outs)]], ins, outs, **kw)


def fixture_steps():
    return [
        S("d", ["b.txt", "c.txt", "k.json"], ["d.txt"]),  # declared first: order must come from the edges, not the list
        S("a", ["src.txt"], ["a.txt"]),
        S("b", ["a.txt"], ["b.txt"]),
        S("m", [], ["raw.txt"], needs={"network"}),
        S("c", ["src2.txt", "raw.txt"], ["c.txt"]),
        S("k", ["src.txt"], ["k.json"]),
        dag.step("kedit", [["tool.py", "kedit", "k.json", ""]], [], [], edits=["k.json"]),
        S("day", ["src.txt"], ["day.txt"], daily=True, groups={"deploy"}),
    ]


class DagTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "tool.py").write_text(SCRIPT)
        (self.root / "src.txt").write_text("one")
        (self.root / "src2.txt").write_text("two")
        (self.root / "raw.txt").write_text("raw")  # the manual step's output exists (fetched by hand)
        self.state = self.root / "state.json"

    def tearDown(self):
        self.tmp.cleanup()

    def graph(self, today="2026-10-23", steps=None):
        return dag.Graph(steps or fixture_steps(), root=self.root, state_file=self.state, py=sys.executable, today=today)

    def log(self):
        f = self.root / "run.log"
        out = f.read_text().split() if f.exists() else []
        f.write_text("")
        return out

    def run_all(self, g, **kw):
        ran, manual, ok = g.run(g.plan(**kw), log=lambda *a: None)
        self.assertTrue(ok)
        return ran, manual

    def touch(self, rel, text):
        p = self.root / rel
        p.write_text(text)
        st = p.stat()
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))  # a new mtime even on coarse clocks

    def test_order_and_edges(self):
        g = self.graph()
        o = g.order
        for a, b in [("a", "b"), ("b", "d"), ("c", "d"), ("m", "c"), ("k", "kedit"), ("kedit", "d"), ("k", "d")]:
            self.assertLess(o.index(a), o.index(b), f"{a} before {b}")
        self.assertEqual(g.deps["kedit"], {"k"})
        self.assertEqual(g.check(), [])

    def test_first_run_then_noop(self):
        g = self.graph()
        g.run(g.plan(include_manual=False), log=lambda *a: None)
        # m is manual and never ran here: listed, not run; everything automatic ran once, in order
        self.assertEqual(self.log(), ["a", "b", "c", "k", "kedit", "d", "day"])
        g = self.graph()
        self.assertEqual([n for n, _, man in g.plan() if not man], [])
        ran, _ = self.run_all(self.graph())
        self.assertEqual(ran, [])

    def test_input_change_reruns_downstream_only(self):
        self.run_all(self.graph())
        self.log()
        self.touch("src2.txt", "TWO")
        g = self.graph()
        plan = {n: r for n, r, man in g.plan() if not man}
        self.assertEqual(set(plan), {"c", "d"})
        self.assertIn("input changed: src2.txt", plan["c"][0])
        self.assertTrue(plan["d"][0].startswith("upstream step will run"))
        self.run_all(g)
        self.assertEqual(self.log(), ["c", "d"])

    def test_same_content_is_not_a_change(self):
        self.run_all(self.graph())
        self.log()
        self.touch("src.txt", "one")  # new mtime, same bytes
        self.assertEqual([n for n, _, man in self.graph().plan() if not man], [])

    def test_output_changed_outside(self):
        self.run_all(self.graph())
        self.touch("b.txt", "hand edit")
        plan = {n: r for n, r, _ in self.graph().plan()}
        self.assertIn("output changed outside the DAG: b.txt", plan["b"])
        (self.root / "a.txt").unlink()
        plan = {n: r for n, r, _ in self.graph().plan()}
        self.assertTrue(any(r.startswith("output missing") for r in plan["a"]))

    def test_daily_and_code_change(self):
        self.run_all(self.graph())
        self.log()
        plan = [x for x in self.graph(today="2026-10-24").plan() if not x[2]]
        self.assertEqual([n for n, _, _ in plan], ["day"])
        self.assertIn("new day", plan[0][1][0])
        self.touch("tool.py", SCRIPT + "\n# changed\n")
        self.assertEqual({n for n, _, man in self.graph().plan() if not man}, {"a", "b", "c", "k", "kedit", "d", "day"})

    def test_only_targets_and_groups(self):
        g = self.graph()
        self.assertEqual([n for n, _, _ in g.plan(["b"])], ["a", "b"])
        self.assertEqual([n for n, _, _ in g.plan(["b"], deps=False)], ["b"])
        self.assertEqual([n for n, _, _ in g.plan(["deploy"], deps=False)], ["day"])
        with self.assertRaises(SystemExit):
            g.plan(["nope"])

    def test_manual_step(self):
        g = self.graph()
        plan = {n: man for n, _, man in g.plan()}
        self.assertTrue(plan["m"])
        self.run_all(g)
        self.assertNotIn("m", self.log())
        # a manual step whose output moved was run by hand: fresh, and its readers rerun
        g = self.graph()
        g.state["steps"]["m"] = {"sig": g.signature("m")[0], "out": g.signature("m")[1]}
        g.save()
        self.touch("raw.txt", "fetched again")
        plan = {n: r for n, r, _ in self.graph().plan()}
        self.assertNotIn("m", plan)
        self.assertIn("c", plan)

    def test_failure_stops_and_is_not_recorded(self):
        steps = fixture_steps() + [dag.step("bad", [["missing.py"]], ["a.txt"], ["z.txt"])]
        g = self.graph(steps=steps)
        ran, _, ok = g.run(g.plan(), log=lambda *a: None)
        self.assertFalse(ok)
        self.assertNotIn("bad", self.graph(steps=steps).state["steps"])
        self.assertIn("script missing: missing.py", " ".join(self.graph(steps=steps).check()))

    def test_cycle_and_duplicate_writer(self):
        with self.assertRaises(SystemExit):
            self.graph(steps=[S("x", ["y.txt"], ["x.txt"]), S("y", ["x.txt"], ["y.txt"])])
        g = self.graph(steps=[S("x", [], ["o.txt"]), S("y", [], ["o.txt"])])
        self.assertTrue(any("both write" in p for p in g.check()))

    def test_overlaps(self):
        self.assertTrue(dag.overlaps("web/public/data/facts", "web/public/data/facts/*.json"))
        self.assertTrue(dag.overlaps("web/public/data/**/*.json", "web/public/data/coverage.json"))
        self.assertTrue(dag.overlaps("web/public/data/**/*.json", "web/public/data/peers"))
        self.assertFalse(dag.overlaps("web/public/data/ifrs_*.json", "web/public/data/ifrs.json"))
        self.assertFalse(dag.overlaps("web/public/data/companies/*.docs.json", "web/public/data/companies/*.price.json"))
        self.assertFalse(dag.overlaps("web/public/data/companies/*.docs.json", "web/public/data/companies/phoenix.json"))

    def test_real_graph_is_valid(self):
        g = dag.Graph(dag.STEPS, state_file=self.state)
        self.assertEqual(g.check(), [])
        deploy = [n for n in g.order if "deploy" in g.steps[n]["groups"]]
        self.assertEqual(deploy, ["build_web_index", "build_calendar", "canon_kpi", "build_registry", "build_market_home", "build_cards", "build_since", "build_positions", "build_feed", "build_attribution", "build_drivers", "build_regulation", "build_warroom", "build_capital", "build_coverage"])
        self.assertLess(g.order.index("facts"), g.order.index("build_restatements"))
        self.assertIn("build_kpi", g.deps["canon_kpi"])


if __name__ == "__main__":
    unittest.main()
