#!/usr/bin/env python3
"""Produce independent same-signer 1.4.5/code13 APK evidence; no device mutation."""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
HERE=Path(__file__).parent
web=load('cache_repair_apk_profile',HERE/'build-web.py')
reviewed=load('cache_repair_reviewed_apk_checks',HERE.parent/'2026-10-31-live-curation'/'verify-android.py')
GateError,SIGNER_SHA256=web.GateError,web.SIGNER_SHA256
reviewed.web=web
reviewed.GateError=GateError
validate_signatures,regular_bytes,run=reviewed.validate_signatures,reviewed.regular_bytes,reviewed.run
def validate_tool_output(signing,badging):
    validate_signatures(signing)
    package=re.findall(r"(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",badging)
    minimum=re.findall(r"(?m)^(?:sdkVersion|minSdkVersion):'([^']+)'",badging);target=re.findall(r"(?m)^targetSdkVersion:'([^']+)'",badging)
    if package!=[('vip.flixify.tv','13','1.4.5')] or minimum!=['23'] or target!=['35'] or re.search(r'(?m)^application-debuggable(?:\s|$)',badging):raise GateError('apk_release_package_version_or_api_differs')
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source_repo',type=Path);parser.add_argument('--native-revision',required=True)
    for name in ('apk','previous-apk','apksigner','aapt2','output'):parser.add_argument('--'+name,required=True,type=Path)
    args=parser.parse_args();web.target(args.native_revision)
    if web.command('git','-C',str(args.source_repo),'rev-parse',args.native_revision+'^{commit}').decode().strip()!=args.native_revision:raise GateError('native_revision_not_exact')
    web.command('git','-C',str(args.source_repo),'merge-base','--is-ancestor',web.BASE_REVISION,args.native_revision)
    native_tree=web.command('git','-C',str(args.source_repo),'rev-parse',args.native_revision+':apps/tv-android').decode().strip();web.target(native_tree)
    current,previous=regular_bytes(args.apk),regular_bytes(args.previous_apk)
    if len(previous)!=web.BASELINE_APK_BYTES or hashlib.sha256(previous).hexdigest()!=web.BASELINE_APK_SHA256:raise GateError('previous_published_apk_bytes_differ')
    validate_tool_output(run(str(args.apksigner),'verify','--verbose','--print-certs',str(args.apk)),run(str(args.aapt2),'dump','badging',str(args.apk)))
    validate_signatures(run(str(args.apksigner),'verify','--verbose','--print-certs',str(args.previous_apk)))
    proof={'schema':1,'nativeRevision':args.native_revision,'nativeTree':native_tree,'packageName':'vip.flixify.tv','versionName':'1.4.5','versionCode':13,'minSdk':23,'targetSdk':35,'sha256':hashlib.sha256(current).hexdigest(),'sizeBytes':len(current),'certificateSha256':SIGNER_SHA256,'baselineApkSha256':web.BASELINE_APK_SHA256,'baselineApkSizeBytes':web.BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}
    with args.output.open('xb') as output:output.write((json.dumps(proof,sort_keys=True,indent=2)+'\n').encode())
    print(json.dumps({'proofSha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'apkSha256':proof['sha256'],'apkBytes':len(current),'nativeTree':native_tree}))
if __name__=='__main__':
    try:main()
    except GateError as error:print('android_verification_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('android_verification_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
