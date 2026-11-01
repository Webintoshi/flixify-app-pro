#!/usr/bin/env python3
from macos_release import ReleaseError, build_main

try:
    build_main()
except (ReleaseError, OSError, ValueError) as error:
    raise SystemExit(str(error))
