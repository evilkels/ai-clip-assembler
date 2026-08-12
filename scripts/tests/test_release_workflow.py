from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "build-dmg.yml"


class ReleaseWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_each_architecture_publishes_its_own_dmg_without_a_matrix_join(self) -> None:
        self.assertNotRegex(self.workflow, r"(?m)^  release:\s*$")
        self.assertRegex(
            self.workflow,
            re.compile(
                r"(?ms)^  build-dmg:\s*$.*?"
                r"^    permissions:\s*$\n"
                r"^      contents: write\s*$.*?"
                r"^      - name: Create or update GitHub Release\s*$.*?"
                r"^          files: frontend/dist/\*\.dmg\s*$"
            ),
        )

    def test_release_upload_runs_only_for_tags_after_the_artifact_upload(self) -> None:
        artifact = self.workflow.index("- name: Upload DMG artifact")
        release = self.workflow.index("- name: Create or update GitHub Release")
        self.assertGreater(release, artifact)

        release_block = self.workflow[release:]
        self.assertIn("if: startsWith(github.ref, 'refs/tags/v')", release_block)
        self.assertIn("uses: softprops/action-gh-release@v3", release_block)
        self.assertIn("generate_release_notes: true", release_block)
        self.assertIn("fail_on_unmatched_files: true", release_block)


if __name__ == "__main__":
    unittest.main()
