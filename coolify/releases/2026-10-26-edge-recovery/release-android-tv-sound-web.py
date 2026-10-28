#!/usr/bin/env python3
"""Web-only TV poster sound APK rollout over the verified current web."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('sound_tv_apk_web_release',Path(__file__).with_name('release-web.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
release.SOURCE_TAG='flixify-ops-web:edge-recovery-8694b8fee0f0-20261026'
release.SOURCE_ID='sha256:a4621ca6637f466057067f1af8235dea780fd0c403caa6a3f1211ed8d81e8335'
if __name__=='__main__':
    try:release.main()
    except release.GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
