#!/usr/bin/env python3
"""Web-only TV APK rollout over the verified entitlement refresh web."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('tv_apk_web_release',Path(__file__).with_name('release-web.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
release.SOURCE_TAG='flixify-ops-web:edge-recovery-44bd380f6635-20261026'
release.SOURCE_ID='sha256:ad05c92189313c67836da26df42a2f389e2ab8efe4213af7988f7d9cf970963e'
if __name__=='__main__':
    try:release.main()
    except release.GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
