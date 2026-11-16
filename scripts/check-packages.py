#!/usr/bin/env python3
"""Fail if any NuGet package (including transitive) has a disallowed license or a known vulnerability.

Run after `dotnet restore`:  python3 scripts/check-packages.py
"""
import json
import os
import re
import subprocess
import sys

ALLOWED_LICENSES = {"MIT", "Apache-2.0"}
NUGET_ROOT = os.environ.get("NUGET_PACKAGES", os.path.expanduser("~/.nuget/packages"))


def dotnet_list(*args):
    out = subprocess.run(
        ["dotnet", "list", "package", "--include-transitive", "--format", "json", *args],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def packages(report):
    for project in report.get("projects", []):
        name = os.path.basename(project["path"])
        for framework in project.get("frameworks", []):
            for kind in ("topLevelPackages", "transitivePackages"):
                for pkg in framework.get(kind, []):
                    yield name, pkg


def license_of(pkg_id, version):
    path = os.path.join(NUGET_ROOT, pkg_id.lower(), version, f"{pkg_id.lower()}.nuspec")
    with open(path, encoding="utf-8-sig") as f:
        nuspec = f.read()
    m = re.search(r'<license type="expression">([^<]+)</license>', nuspec)
    if m:
        return m.group(1).strip()
    m = re.search(r'<license type="file">([^<]+)</license>', nuspec) or re.search(r"<licenseUrl>([^<]+)</licenseUrl>", nuspec)
    return f"unknown ({m.group(1)})" if m else "unknown"


def main():
    failures = []

    seen = {}
    for project, pkg in packages(dotnet_list()):
        seen.setdefault((pkg["id"], pkg["resolvedVersion"]), project)
    counts = {}
    for (pkg_id, version), project in sorted(seen.items()):
        lic = license_of(pkg_id, version)
        counts[lic] = counts.get(lic, 0) + 1
        if lic not in ALLOWED_LICENSES:
            failures.append(f"license: {pkg_id} {version} ({project}) is '{lic}'")
    print("Licenses: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    for project, pkg in packages(dotnet_list("--vulnerable")):
        for v in pkg.get("vulnerabilities", []):
            failures.append(f"vulnerable: {pkg['id']} {pkg['resolvedVersion']} ({project}) {v['severity']} {v['advisoryurl']}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"OK: {len(seen)} packages, all licenses allowed ({', '.join(sorted(ALLOWED_LICENSES))}), no known vulnerabilities.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
