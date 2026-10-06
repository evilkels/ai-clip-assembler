from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "plans.py"
START = "<!-- plans:index:start -->"
END = "<!-- plans:index:end -->"


class PlansContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.write("docs/plans/README.md", f"# Plans\n\n{START}\nstale\n{END}\n\nKeep this.\n")

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=self.root, check=True, capture_output=True, text=True,
        ).stdout

    def write(self, name: str, content: str) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def run_plans(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), *args],
            cwd=self.root, capture_output=True, text=True,
        )

    def snapshot(self) -> dict[str, bytes]:
        return {
            str(path.relative_to(self.root)): path.read_bytes()
            for path in self.root.rglob("*")
            if path.is_file() and ".git" not in path.relative_to(self.root).parts
        }

    def test_status_rules_and_counts(self) -> None:
        cases = [
            ("todo", "- [ ] 1.1 Start\n- [ ] H1 Review\n", "🔴 TODO", "0/1", "1"),
            ("progress", "- [X] 1.1 Shipped\n- [ ] 1.2 Finish\n", "🟡 IN PROGRESS", "1/2", "0"),
            ("human", "- [x] 1.1 Shipped\n- [ ] H1 Review\n", "🟣 HUMAN", "1/1", "1"),
            ("done", "- [x] 1.1 Shipped\n- [X] H1 Reviewed\n", "🟢 DONE", "1/1", "0"),
            ("superseded", "Superseded by: [next](next.md)\n- [ ] 1.1 Old\n", "⚪ SUPERSEDED", "0/1", "0"),
            ("malformed", "No tasks.\n", "MALFORMED", "0/0", "0"),
        ]
        for name, tasks, _, _, _ in cases:
            self.write(f"docs/plans/{name}.md", f"# {name}\n{tasks}")
        result = self.run_plans("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), len(cases))
        for name, _, status, progress, human in cases:
            with self.subTest(plan=name):
                line = next(line for line in lines if f"/{name}.md" in line)
                self.assertIn(status, line)
                self.assertIn(progress, line)
                self.assertIn(f"{human} human", line)

    def test_ticked_human_task_with_all_phase_tasks_open_is_in_progress(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [ ] 1.1 Start\n- [ ] 1.2 Finish\n"
                   "- [x] H1 Reviewed\n")
        result = self.run_plans("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("🟡 IN PROGRESS", result.stdout)
        self.assertIn("0/2", result.stdout)
        self.assertIn("0 human", result.stdout)
        self.assertEqual(self.run_plans("sync").returncode, 0)
        self.assertIn("| 🟡 | [A](a.md) | 0/2 | Start |", (self.root / "docs/plans/README.md").read_text())

    def test_default_command_is_read_only_status(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [x] 1.1 Done\n")
        before = self.snapshot()
        result = self.run_plans()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, self.run_plans("status").stdout)
        self.assertEqual(self.snapshot(), before)

    def test_parser_uses_column_zero_tasks_and_first_title(self) -> None:
        self.write("docs/plans/a.md", "Introduction\n# 001: First\n# Second\n"
                   " - [x] 1.1 Indented\n- [y] 1.2 Invalid\n- [ ] Missing\n"
                   "- [ ] 1.3 Real\ncontinued text\n")
        result = self.run_plans("sync")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("| 🔴 | [First](a.md) | 0/1 | Real |", (self.root / "docs/plans/README.md").read_text())

    def test_human_section_and_id_both_classify_human_tasks(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [x] 1.1 Done\n- [x] H1 Reviewed\n"
                   "## Human tasks\n- [ ] 2.1 Manual QA\n- [ ] H2 Approve\n")
        result = self.run_plans("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("🟣 HUMAN", result.stdout)
        self.assertIn("1/1", result.stdout)
        self.assertIn("2 human", result.stdout)
        self.assertEqual(self.run_plans("sync").returncode, 0)
        self.assertIn("| 🟣 | [A](a.md) | 1/1 · 2 human | Manual QA |", (self.root / "docs/plans/README.md").read_text())

    def test_closed_plans_and_readme_are_not_parsed(self) -> None:
        self.write("docs/plans/done/old.md", "# Old\nNo tasks\n")
        result = self.run_plans("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_sync_moves_tracked_and_untracked_closed_plans_and_rewrites_links(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [x] 1.1 Done\n[Other](b.md#context)\n")
        self.write("docs/plans/b.md", "# B\nSuperseded by: [C](c.md)\n- [ ] 1.1 Old\n")
        self.write("docs/plans/c.md", "# C\n- [ ] 1.1 Work\n[Old](a.md)\n")
        guide = self.write("docs/guide.md", "[A](plans/a.md#phase-1)\n[B](./plans/b.md \"Title\")\n"
                           "[Web](https://example.com/plans/a.md)\n[Anchor](#local)\n[Other](plans/c.md)\n")
        untracked = self.write("untracked.md", "[A](docs/plans/a.md)\n")
        self.git("add", "docs/plans/a.md", "docs/plans/c.md", "docs/guide.md", "docs/plans/README.md")
        result = self.run_plans("sync")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "docs/plans/a.md").exists())
        self.assertFalse((self.root / "docs/plans/b.md").exists())
        self.assertTrue((self.root / "docs/plans/done/a.md").exists())
        self.assertTrue((self.root / "docs/plans/done/b.md").exists())
        self.assertIn("docs/plans/done/a.md", self.git("ls-files"))
        self.assertNotIn("docs/plans/done/b.md", self.git("ls-files"))
        self.assertEqual(guide.read_text(), "[A](plans/done/a.md#phase-1)\n[B](plans/done/b.md \"Title\")\n"
                         "[Web](https://example.com/plans/a.md)\n[Anchor](#local)\n[Other](plans/c.md)\n")
        self.assertIn("[Other](b.md#context)", (self.root / "docs/plans/done/a.md").read_text())
        self.assertIn("[Old](done/a.md)", (self.root / "docs/plans/c.md").read_text())
        self.assertEqual(untracked.read_text(), "[A](docs/plans/a.md)\n")
        self.assertEqual(self.run_plans("check").returncode, 0)

    def test_sync_generates_ordered_index_and_preserves_surrounding_text(self) -> None:
        self.write("docs/plans/z-human.md", "# 009: Human\n- [x] 1.1 Done\n- [ ] H1 Review\n")
        self.write("docs/plans/b-progress.md", "# Progress B\n- [x] 1.1 Done\n- [ ] 1.2 Finish B\n- [ ] H1 Review\n")
        self.write("docs/plans/a-progress.md", "# Progress A\n- [x] 1.1 Done\n- [ ] 1.2 Finish A\n")
        self.write("docs/plans/a-todo.md", "# Todo\n- [ ] 1.1 Begin\n")
        self.write("docs/plans/b-malformed.md", "# Broken\nNo tasks\n")
        result = self.run_plans("sync")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "docs/plans/README.md").read_text(),
                         f"# Plans\n\n{START}\n| | Plan | Progress | Next |\n|---|---|---|---|\n"
                         "| 🟣 | [Human](z-human.md) | 1/1 · 1 human | Review |\n"
                         "| 🟡 | [Progress A](a-progress.md) | 1/2 | Finish A |\n"
                         "| 🟡 | [Progress B](b-progress.md) | 1/2 · 1 human | Finish B |\n"
                         "| 🔴 | [Todo](a-todo.md) | 0/1 | Begin |\n"
                         f"| ⚠️ | [Broken](b-malformed.md) | 0/0 |  |\n{END}\n\nKeep this.\n")

    def test_next_task_is_truncated_at_word_boundary(self) -> None:
        text = "word " * 17 + "longword beyond"
        self.write("docs/plans/a.md", f"# A\n- [ ] 1.1 {text}\n")
        self.assertEqual(self.run_plans("sync").returncode, 0)
        self.assertIn(" | " + ("word " * 17).rstrip() + "… |", (self.root / "docs/plans/README.md").read_text())

    def test_sync_is_idempotent(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [x] 1.1 Done\n")
        self.git("add", ".")
        self.assertEqual(self.run_plans("sync").returncode, 0)
        before = self.snapshot()
        index = self.git("ls-files", "--stage")
        result = self.run_plans("sync")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.git("ls-files", "--stage"), index)

    def test_sync_requires_index_markers(self) -> None:
        self.write("docs/plans/README.md", "# Plans\n")
        result = self.run_plans("sync")
        self.assertEqual(result.returncode, 1)
        self.assertIn("add", (result.stdout + result.stderr).lower())
        self.assertIn(START, result.stdout + result.stderr)
        self.assertIn(END, result.stdout + result.stderr)

    def test_check_reports_every_problem_without_changes(self) -> None:
        self.write("docs/plans/a.md", "# A\nNo tasks\n")
        self.write("docs/plans/b.md", "# B\n- [x] 1.1 Done\n")
        self.write("docs/plans/c.md", "# C\nSuperseded by: [D](d.md)\n- [ ] 1.1 Old\n")
        before = self.snapshot()
        result = self.run_plans("check")
        self.assertEqual(result.returncode, 1)
        lines = (result.stdout + result.stderr).splitlines()
        self.assertEqual(len(lines), 4)
        for problem in ("MALFORMED", "DONE", "SUPERSEDED", "README.md"):
            self.assertTrue(any(problem in line for line in lines), problem)
        self.assertEqual(self.snapshot(), before)

    def test_check_detects_only_stale_index(self) -> None:
        self.write("docs/plans/a.md", "# A\n- [ ] 1.1 Work\n")
        result = self.run_plans("check")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len((result.stdout + result.stderr).splitlines()), 1)
        self.assertIn("README.md", result.stdout + result.stderr)
        self.assertEqual(self.run_plans("sync").returncode, 0)
        result = self.run_plans("check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout + result.stderr, "")

    def test_check_requires_index_markers(self) -> None:
        self.write("docs/plans/README.md", "# Plans\n")
        before = self.snapshot()
        result = self.run_plans("check")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len((result.stdout + result.stderr).splitlines()), 1)
        self.assertIn("add", (result.stdout + result.stderr).lower())
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()
