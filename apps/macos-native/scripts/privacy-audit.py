#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from macos_privacy import audit_release_privacy
from macos_release import APP_NAME, ROOT, ReleaseError, validate_app_metadata

parser = argparse.ArgumentParser(description="Scan a release app without printing matched private values")
parser.add_argument("--app", type=Path, default=ROOT / "dist" / f"{APP_NAME}.app")
parser.add_argument("--report", type=Path, default=ROOT / "dist/privacy-report.json")
args = parser.parse_args()
try:
    info = validate_app_metadata(args.app)
    if info.get("FlixifyBuildConfiguration") != "release":
        raise ReleaseError("Debug builds are local QA artifacts, not release privacy candidates")
    report = audit_release_privacy(args.app, raise_on_failure=False)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "findings"}, indent=2))
    if not report["passed"]:
        raise ReleaseError("Release privacy audit failed; matched values suppressed")
except (ReleaseError, OSError, ValueError) as error:
    raise SystemExit(str(error))
