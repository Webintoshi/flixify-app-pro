#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then export JAVA_HOME="$(/usr/libexec/java_home -v17)"; fi
./gradlew --no-daemon --max-workers=2 :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
python3 - <<'PY'
from pathlib import Path
import hashlib
p=Path('app/build/outputs/apk/release/app-release.apk')
print('Flixify Pro APK:',p.resolve())
print('Bytes:',p.stat().st_size)
print('SHA256:',hashlib.sha256(p.read_bytes()).hexdigest())
PY
