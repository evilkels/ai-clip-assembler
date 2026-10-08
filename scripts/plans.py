from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
START = "<!-- plans:index:start -->"
END = "<!-- plans:index:end -->"
TASK = re.compile(r"^- \[( |x|X)\] (\S+) (.*)$")
LINK = re.compile(
    r"\]\(\s*(?P<inline><[^>]*>|(?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+)"
    r"|^ {0,3}\[[^\]\n]+\]:\s*(?P<reference><[^>]*>|\S+)",
    re.MULTILINE,
)
SYMBOLS = {"TODO": "🔴", "IN PROGRESS": "🟡", "HUMAN": "🟣",
           "DONE": "🟢", "SUPERSEDED": "⚪", "MALFORMED": "⚠️"}
ORDER = {"HUMAN": 0, "IN PROGRESS": 1, "TODO": 2, "MALFORMED": 3}


@dataclass
class Task:
    ticked: bool
    human: bool
    text: str


@dataclass
class Plan:
    path: Path
    title: str
    tasks: list[Task]
    superseded: bool

    @property
    def phase_tasks(self) -> list[Task]:
        return [task for task in self.tasks if not task.human]

    @property
    def open_human_tasks(self) -> list[Task]:
        return [task for task in self.tasks if task.human and not task.ticked]

    @property
    def progress(self) -> str:
        phase = self.phase_tasks
        return f"{sum(task.ticked for task in phase)}/{len(phase)}"

    @property
    def status(self) -> str:
        if self.superseded:
            return "SUPERSEDED"
        if not self.tasks:
            return "MALFORMED"
        if not any(task.ticked for task in self.tasks):
            return "TODO"
        if any(not task.ticked for task in self.phase_tasks):
            return "IN PROGRESS"
        if self.open_human_tasks:
            return "HUMAN"
        return "DONE"


def read_plans(root: Path) -> list[Plan]:
    plans = []
    for path in sorted((root / "docs/plans").glob("*.md")):
        if path.name == "README.md":
            continue
        title = None
        tasks = []
        superseded = False
        human_section = False
        for line in path.read_text(encoding="utf-8").splitlines():
            if title is None and line.startswith("# "):
                title = line[2:]
            if line.startswith("## "):
                human_section = line == "## Human tasks"
            if line.startswith("Superseded by: "):
                superseded = True
            match = TASK.fullmatch(line)
            if match:
                box, task_id, text = match.groups()
                tasks.append(Task(box != " ", human_section or task_id.startswith("H"), text))
        plans.append(Plan(path, title if title is not None else path.stem, tasks, superseded))
    return plans


def table_cell(text: str) -> str:
    return text.replace("|", "\\|")


def index_table(plans: list[Plan]) -> str:
    active = [plan for plan in plans if plan.status not in ("DONE", "SUPERSEDED")]
    rows = ["| | Plan | Progress | Next |", "|---|---|---|---|"]
    for plan in sorted(active, key=lambda plan: (ORDER[plan.status], plan.path.name)):
        title = re.sub(r"^\d{3}: ", "", plan.title)
        progress = plan.progress
        if plan.open_human_tasks:
            progress += f" · {len(plan.open_human_tasks)} human"
        open_tasks = (plan.open_human_tasks if plan.status == "HUMAN" else
                      [task for task in plan.phase_tasks if not task.ticked])
        next_task = open_tasks[0].text if open_tasks else ""
        if len(next_task) > 90:
            next_task = re.sub(r"\s+\S*$", "", next_task[:90]).rstrip() + "…"
        rows.append(f"| {SYMBOLS[plan.status]} | [{table_cell(title)}]({plan.path.name}) | "
                    f"{progress} | {table_cell(next_task)} |")
    return "\n".join(rows)


def replace_index(content: str, plans: list[Plan]) -> str:
    start = content.find(START)
    end = content.find(END, start + len(START))
    if start == -1 or end == -1:
        raise ValueError(f"docs/plans/README.md: add {START} and {END} markers")
    return content[:start + len(START)] + "\n" + index_table(plans) + "\n" + content[end:]


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True,
                          capture_output=True, text=True).stdout


def rewrite_links(content: str, source: Path, destination: Path,
                  moves: dict[Path, Path]) -> str:
    def rewrite(match: re.Match[str]) -> str:
        group = "inline" if match.group("inline") is not None else "reference"
        target = match.group(group)
        angled = target.startswith("<")
        url = target[1:-1] if angled else target
        parts = urlsplit(url)
        if parts.scheme or parts.netloc or not parts.path or parts.path.startswith("/"):
            return match.group()
        old_target = (source.parent / unquote(parts.path)).resolve()
        if old_target not in moves and source == destination:
            return match.group()
        new_path = os.path.relpath(moves.get(old_target, old_target), destination.parent)
        new_url = urlunsplit(("", "", quote(new_path, safe="/.-_~()"), parts.query, parts.fragment))
        if angled:
            new_url = f"<{new_url}>"
        offset = match.start(group) - match.start()
        return match.group()[:offset] + new_url

    return LINK.sub(rewrite, content)


def sync(root: Path, plans: list[Plan], readme: Path, content: str) -> None:
    replace_index(content, plans)
    moves = {plan.path: plan.path.parent / "done" / plan.path.name
             for plan in plans if plan.status in ("DONE", "SUPERSEDED")}
    tracked = [root / name for name in git(root, "ls-files", "-z", "*.md").split("\0") if name]
    documents = {path: path.read_text(encoding="utf-8")
                 for path in [*tracked, *moves] if path.is_file()}
    for source, destination in moves.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source in tracked:
            git(root, "mv", str(source.relative_to(root)), str(destination.relative_to(root)))
        else:
            source.rename(destination)
    for source, original in documents.items():
        destination = moves.get(source, source)
        updated = rewrite_links(original, source, destination, moves)
        if updated != original:
            destination.write_text(updated, encoding="utf-8")
    current = readme.read_text(encoding="utf-8")
    updated = replace_index(current, plans)
    if updated != current:
        readme.write_text(updated, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Derive plan status and synchronize the plan index.")
    parser.add_argument("command", nargs="?", choices=("status", "sync", "check"), default="status")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    plans = read_plans(root)
    if args.command == "status":
        for plan in plans:
            status = plan.status
            label = "MALFORMED" if status == "MALFORMED" else f"{SYMBOLS[status]} {status}"
            print(f"{label}\t{plan.path.relative_to(root)}\t{plan.progress}\t"
                  f"{len(plan.open_human_tasks)} human")
        return 0
    readme = root / "docs/plans/README.md"
    content = readme.read_text(encoding="utf-8") if readme.exists() else ""
    if args.command == "sync":
        sync(root, plans, readme, content)
        return 0
    problems = []
    for plan in plans:
        if plan.status == "MALFORMED":
            problems.append(f"MALFORMED: {plan.path.relative_to(root)}")
        elif plan.status in ("DONE", "SUPERSEDED"):
            problems.append(f"{plan.status}: {plan.path.relative_to(root)} belongs in done/")
    try:
        if replace_index(content, plans) != content:
            problems.append("docs/plans/README.md: index differs from sync output")
    except ValueError as error:
        problems.append(str(error))
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
