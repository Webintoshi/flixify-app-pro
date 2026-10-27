#!/usr/bin/env python3
"""Web-only Apple TV player APK rollout over the verified current web."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('apple_tv_apk_web_release',Path(__file__).with_name('release-web.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
release.SOURCE_TAG='flixify-ops-web:edge-recovery-cf0703ee3230-20261026'
release.SOURCE_ID='sha256:0798cdecfbc024c4a17beb09cb16d05db84c98ad9d62870e832172c8ec5eda24'
if __name__=='__main__':
    try:release.main()
    except release.GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
