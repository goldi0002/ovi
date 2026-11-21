#!/usr/bin/env python3
"""Print the release notes for one version, taken from docs/CHANGELOG.md.

Usage: python3 scripts/release-notes.py 1.0.0 [path/to/CHANGELOG.md]

The changelog has a "## <version>" heading per release (anything after the version, such as " — 2026-11-21",
is ignored). Prints that section, without its heading, followed by how to pull the image. Exits with an error
if the version has no section or the section is empty, so a release can't go out without notes.
"""
import re
import sys
from pathlib import Path

IMAGE = "ghcr.io/goldi0002/ovi"


def section(changelog: str, version: str) -> str:
    heading = re.compile(r"^## \[?v?" + re.escape(version) + r"\]?(?:\s|$)")
    lines = changelog.splitlines()
    start = next((i for i, line in enumerate(lines) if heading.match(line)), None)
    if start is None:
        raise ValueError(f"docs/CHANGELOG.md has no '## {version}' section")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    body = "\n".join(lines[start + 1:end]).strip()
    if not body:
        raise ValueError(f"The '## {version}' section of docs/CHANGELOG.md is empty")
    return body


def notes(changelog: str, version: str) -> str:
    major = version.split(".")[0]
    return (
        section(changelog, version)
        + "\n\n## Image\n\n"
        + "For amd64 and ARM64:\n\n"
        + f"```bash\ndocker pull {IMAGE}:{version}\n```\n\n"
        + f"With Docker Compose, the `{IMAGE}:{major}` tag in `docker-compose.yml` gets every {major}.x release: "
        + "`docker compose pull && docker compose up -d`.\n"
    )


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", argv[1]):
        print("Usage: release-notes.py <version, e.g. 1.0.0> [CHANGELOG.md]", file=sys.stderr)
        return 2
    path = Path(argv[2] if len(argv) == 3 else Path(__file__).resolve().parent.parent / "docs" / "CHANGELOG.md")
    try:
        print(notes(path.read_text(encoding="utf-8"), argv[1]), end="")
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
