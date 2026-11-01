#!/usr/bin/env python3
"""Release only the welcome API, protecting current website, worker and database."""
import importlib.util
import sys
from pathlib import Path
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
HERE=Path(__file__).parent
reviewed=load('welcome_backend_transaction',HERE.parent/'2026-11-01-packages'/'release-backend.py')
build=load('welcome_backend_payload',HERE/'build-backend.py')
guard,GateError=reviewed.guard,reviewed.GateError
build.GateError=GateError
original_configure=reviewed.configure
def protected_pin(name,tag,identity):
    if (name,tag,identity)!=('ops-web',build.WEB_TAG,build.WEB_ID) or guard.image_id(tag)!=identity or guard.image(identity)['Id']!=identity:raise GateError('welcome_current_website_pin_required')
    return tag,identity
def configure(service,revision,candidate_id,web_tag,web_id,api_tag=None,api_id=None):
    build.configuration(service)
    return original_configure(service,revision,candidate_id,web_tag,web_id,api_tag,api_id)
reviewed.builder.configuration=build.configuration
reviewed.builder.host_snapshot=build.host_snapshot
reviewed.builder.WORKER_TAG,reviewed.builder.WORKER_ID=build.WORKER_TAG,build.WORKER_ID
reviewed.target,reviewed.protected_pin,reviewed.configure=build.target,protected_pin,configure
main=reviewed.main
if __name__=='__main__':
    try:main()
    except GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError,guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
