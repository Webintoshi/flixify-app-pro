#!/usr/bin/env python3
"""Web-only cinematic TV APK rollout over the verified first APK web."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('tv_apk_web_release',Path(__file__).with_name('release-web.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
release.SOURCE_TAG='flixify-ops-web:edge-recovery-04a5f5db4677-20261026'
release.SOURCE_ID='sha256:1d7a1fde872b02467cd245a28d45947468871fa35273e08b3f029fbd3a685034'
if __name__=='__main__':
    try:release.main()
    except release.GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
