#!/usr/bin/env python3
from macos_runtime import ReleaseError, prepare_runtime

try:
    print(prepare_runtime())
except (ReleaseError, OSError, ValueError) as error:
    raise SystemExit(str(error))
