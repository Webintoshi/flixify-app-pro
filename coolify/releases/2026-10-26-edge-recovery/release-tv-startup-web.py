#!/usr/bin/env python3
"""Web-only1.4.1 APK/manifest rollout over the exact verified38b22d4 website image."""
import importlib.util
import sys
from pathlib import Path

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
publication=load("startup_release_acceptance","build-tv-startup-web.py")
release=load("startup_scoped_web_transaction","release-web.py")
release.SOURCE_TAG,release.SOURCE_ID=publication.SOURCE_TAG,publication.SOURCE_ID

def main():
    publication.require_native_pin()
    release.main()

if __name__=="__main__":
    try:main()
    except release.GateError as error:print("release_stopped:"+str(error),file=sys.stderr);sys.exit(1)
    except publication.GateError as error:print("release_stopped:"+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,release.guard.yaml.YAMLError) as error:print("release_stopped:"+type(error).__name__,file=sys.stderr);sys.exit(1)
