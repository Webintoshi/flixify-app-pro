#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
if [ "$#" -gt 0 ]; then shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/dist/Flixify Pro.app"

case "$MODE" in
  run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify) ;;
  *) echo "usage: $0 [run|--debug|--logs|--telemetry|--verify] [-- app arguments]" >&2; exit 2 ;;
esac

pkill -x FlixifyMac >/dev/null 2>&1 || true
python3 "$ROOT_DIR/scripts/build-app.py" --configuration debug --host-only
/usr/bin/open -n "$APP_BUNDLE" --args "$@"

case "$MODE" in
  --verify|verify|--debug|debug)
    for attempt in {1..30}; do
      if pgrep -x FlixifyMac >/dev/null; then break; fi
      sleep 0.1
    done
    app_pid="$(pgrep -x FlixifyMac | head -1)"
    if [ -z "$app_pid" ]; then echo "Flixify app did not launch" >&2; exit 1; fi
    if [ "$MODE" = "--debug" ] || [ "$MODE" = "debug" ]; then
      /usr/bin/lldb -p "$app_pid"
    else
      echo "Flixify Pro launched as app bundle (PID $app_pid); local QA signing only."
    fi
    ;;
  --logs|logs) /usr/bin/log stream --info --style compact --predicate 'process == "FlixifyMac"' ;;
  --telemetry|telemetry) /usr/bin/log stream --info --style compact --predicate 'subsystem == "vip.flixify.mac"' ;;
esac
