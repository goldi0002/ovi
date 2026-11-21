"""Tests for release-notes.py. Run: python3 -m unittest discover -s scripts -p 'test_*.py'"""
import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("release_notes", Path(__file__).with_name("release-notes.py"))
release_notes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release_notes)

CHANGELOG = """# Changelog

## Unreleased

### Next thing

- Not out yet.

## 1.1.0 — 2026-12-01

### Faster

- Things are faster.

## 1.0.0 — 2026-11-21

### First release

- Everything.
"""


class SectionTests(unittest.TestCase):
    def test_takes_only_that_version(self):
        body = release_notes.section(CHANGELOG, "1.1.0")
        self.assertEqual(body, "### Faster\n\n- Things are faster.")

    def test_last_section_runs_to_the_end(self):
        self.assertEqual(release_notes.section(CHANGELOG, "1.0.0"), "### First release\n\n- Everything.")

    def test_does_not_match_a_longer_version(self):
        with self.assertRaisesRegex(ValueError, "no '## 1.0' section"):
            release_notes.section(CHANGELOG, "1.0")

    def test_missing_version_fails(self):
        with self.assertRaisesRegex(ValueError, "no '## 2.0.0' section"):
            release_notes.section(CHANGELOG, "2.0.0")

    def test_empty_section_fails(self):
        with self.assertRaisesRegex(ValueError, "is empty"):
            release_notes.section("## 1.2.0\n\n## 1.1.0\n\n- x\n", "1.2.0")

    def test_accepts_brackets_and_v_prefix(self):
        self.assertEqual(release_notes.section("## [v3.0.0] - 2027-01-01\n\n- y\n", "3.0.0"), "- y")


class NotesTests(unittest.TestCase):
    def test_adds_pull_instructions_for_the_version_and_major_tag(self):
        text = release_notes.notes(CHANGELOG, "1.1.0")
        self.assertTrue(text.startswith("### Faster"))
        self.assertIn("docker pull ghcr.io/goldi0002/ovi:1.1.0", text)
        self.assertIn("`ghcr.io/goldi0002/ovi:1` tag", text)


class MainTests(unittest.TestCase):
    def test_rejects_a_bad_version(self):
        self.assertEqual(release_notes.main(["release-notes.py", "v1.0.0"]), 2)
        self.assertEqual(release_notes.main(["release-notes.py", "latest"]), 2)

    def test_reads_the_given_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "CHANGELOG.md"
            path.write_text(CHANGELOG, encoding="utf-8")
            self.assertEqual(release_notes.main(["release-notes.py", "1.0.0", str(path)]), 0)
            self.assertEqual(release_notes.main(["release-notes.py", "9.9.9", str(path)]), 1)


if __name__ == "__main__":
    unittest.main()
