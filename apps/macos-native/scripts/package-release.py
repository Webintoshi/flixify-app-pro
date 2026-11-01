#!/usr/bin/env python3
from macos_release import ReleaseError, package_main

try:
    package_main()
except (ReleaseError, OSError, ValueError) as error:
    raise SystemExit(str(error))
