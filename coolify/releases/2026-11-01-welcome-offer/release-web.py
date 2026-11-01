#!/usr/bin/env python3
"""Publish only welcome UI/APK, retaining the verified welcome API and worker."""
import importlib.util
import sys
from pathlib import Path
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
HERE=Path(__file__).parent
reviewed=load('welcome_web_transaction',HERE.parent/'2026-11-01-packages'/'release-web-embedded.py')
build=load('welcome_web_payload',HERE/'build-web.py')
guard,GateError=reviewed.guard,reviewed.GateError
SOURCE_TAG,SOURCE_ID,target=build.SOURCE_TAG,build.SOURCE_ID,build.target
original_configure=reviewed.configure
def configure(revision,candidate_id,api_tag,api_id):
    build.accept_api_pin(api_tag,api_id)
    if (api_tag,api_id)==(build.API_TAG,build.API_ID):raise GateError('welcome_api_must_be_published_before_new_clients')
    reviewed.API_TAG,reviewed.API_ID=api_tag,api_id
    return original_configure(revision,candidate_id,api_tag,api_id)
reviewed.SOURCE_TAG,reviewed.SOURCE_ID,reviewed.target=SOURCE_TAG,SOURCE_ID,target
reviewed.WORKER_TAG,reviewed.WORKER_ID=build.WORKER_TAG,build.WORKER_ID
reviewed.reviewed.builder.host_snapshot=build.backend.host_snapshot
reviewed.configure=configure
main=reviewed.main
if __name__=='__main__':
    try:main()
    except GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError,guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
