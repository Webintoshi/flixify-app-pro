#!/usr/bin/env python3
from macos_notarized_zip import ReleaseError, main

try:
    main()
except (ReleaseError, OSError, ValueError) as error:
    raise SystemExit(str(error))
