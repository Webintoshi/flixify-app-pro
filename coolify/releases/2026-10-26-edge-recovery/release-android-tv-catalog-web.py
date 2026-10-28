#!/usr/bin/env python3
"""Web-only TV search/category APK rollout over the verified current web."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('catalog_tv_apk_web_release',Path(__file__).with_name('release-web.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
release.SOURCE_TAG='flixify-ops-web:edge-recovery-acb1f7f741ca-20261026'
release.SOURCE_ID='sha256:76b82c65b0646dff539faeaed79f22c8f62e716f1b5d484ae80647532abc2d0c'
if __name__=='__main__':
    try:release.main()
    except release.GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
