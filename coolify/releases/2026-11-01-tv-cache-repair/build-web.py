#!/usr/bin/env python3
"""Publish only Android TV 1.4.5 APK, manifest and the existing download descriptor."""
from __future__ import annotations
import hashlib
import importlib.util
import re
import sys
from pathlib import Path

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

HERE=Path(__file__).parent
reviewed=load('cache_repair_reviewed_publication',HERE.parent/'2026-10-31-live-curation'/'build-web.py')
backend=load('cache_repair_reviewed_host_proof',HERE.parent/'2026-11-01-packages'/'build-backend.py')
builder,core,GateError,command=reviewed.builder,reviewed.core,reviewed.GateError,reviewed.command
SOURCE_TAG='flixify-ops-web:movie-discovery-c2ece2f6a774-20261101'
SOURCE_ID='sha256:6f0a8b8ae11383d25a76d5ed6c3add935ea5d803415e164875e10a5d69c3fe32'
RUNTIME_REVISION='c2ece2f6a774c586e32364a129b5bbcba15b39b7'
BASE_REVISION='fdbfa41ae058ab671a228c762b38faf95634f0c2'
API_TAG='flixify-api:embedded-page-b0def990e266-20261101'
API_ID='sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1'
WORKER_TAG='flixify-worker:packages-8fa66d103053-20261101'
WORKER_ID='sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57'
DB_ID=reviewed.DB_ID
DESCRIPTOR=reviewed.DESCRIPTOR
APK='apps/ops-web/public/downloads/flixify-pro-1.4.5.apk'
APK_URL='https://flixify.vip/downloads/flixify-pro-1.4.5.apk'
BASELINE_APK='apps/ops-web/public/downloads/flixify-pro-1.4.4.apk'
BASELINE_APK_SHA256='1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f'
BASELINE_APK_BYTES=1355944
BASELINE_MANIFEST_BYTES=441
BASELINE_MANIFEST_SHA256='09e30369f246b965d95d68cecb238fde161a311517786a456fbbc2c3f2e805bf'
SIGNER_SHA256=reviewed.SIGNER_SHA256
UPDATE_MANIFEST,GRADLE,ANDROID_MANIFEST=reviewed.UPDATE_MANIFEST,reviewed.GRADLE,reviewed.ANDROID_MANIFEST
MAX_APK_BYTES=reviewed.MAX_APK_BYTES
PATHS=(DESCRIPTOR,)
NEW_PATHS=()
EXCLUDED=(*PATHS,APK,UPDATE_MANIFEST,'apps/ops-web/.next')
TOOLS=frozenset('coolify/releases/2026-11-01-tv-cache-repair/'+name for name in ('build-web.py','release-web.py','verify-android.py','verify-upgrade.py','test-release.py','README.md'))

def target(revision):
    if not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision):raise GateError('exact_revision_required')
    return 'flixify-ops-web:tv-cache-repair-'+revision[:12]+'-20261101'

for module in (reviewed,reviewed.reviewed,builder):
    module.SOURCE_TAG,module.SOURCE_ID,module.BASE_REVISION=SOURCE_TAG,SOURCE_ID,BASE_REVISION
    module.target=target
for name in ('APK','APK_URL','BASELINE_APK','BASELINE_APK_SHA256','BASELINE_APK_BYTES','BASELINE_MANIFEST_BYTES','BASELINE_MANIFEST_SHA256','NEW_PATHS','TOOLS'):
    setattr(reviewed,name,globals()[name])
reviewed.RUNTIME_ALLOWLIST=frozenset(PATHS)
reviewed.reviewed.APK,reviewed.reviewed.APK_URL=APK,APK_URL
reviewed.API_TAG,reviewed.API_ID,reviewed.WORKER_TAG,reviewed.WORKER_ID=API_TAG,API_ID,WORKER_TAG,WORKER_ID
reviewed.reviewed.API_TAG,reviewed.reviewed.API_ID,reviewed.reviewed.WORKER_TAG,reviewed.reviewed.WORKER_ID=API_TAG,API_ID,WORKER_TAG,WORKER_ID
reviewed.configure_paths(PATHS)
original_scope=reviewed.validate_source_scope
original_protected_snapshot=reviewed.protected_snapshot
original_download_script=reviewed.download_verification_script
parse_runtime_paths,unique_json=reviewed.parse_runtime_paths,reviewed.unique_json

def validate_source_scope(repo,revision,native,native_tree,paths):
    for tree in ('apps/ops-web','packages','apps/tv-android'):
        if command('git','-C',str(repo),'rev-parse',RUNTIME_REVISION+':'+tree)!=command('git','-C',str(repo),'rev-parse',BASE_REVISION+':'+tree):raise GateError('cache_repair_runtime_and_git_baseline_tree_differ')
    original_scope(repo,revision,native,native_tree,paths)

def validate_versions(repo,revision,native):
    original=core.git_file(repo,BASE_REVISION,DESCRIPTOR)
    if original.count(b'flixify-pro-1.4.4.apk')!=2 or original.count(b'"1.4.4"')!=1:raise GateError('cache_repair_descriptor_baseline_differs')
    if core.git_file(repo,revision,DESCRIPTOR)!=original.replace(b'1.4.4',b'1.4.5'):raise GateError('cache_repair_descriptor_outside_version_replacement')
    gradle=core.git_file(repo,native,GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]",rb'(?m)^\s*minSdk\s+23\s*$',rb'(?m)^\s*targetSdk\s+35\s*$',rb'(?m)^\s*versionCode\s+13\s*$',rb"(?m)^\s*versionName\s+['\"]1\.4\.5['\"]\s*$"):
        if len(re.findall(pattern,gradle))!=1:raise GateError('cache_repair_native_version_differs')
    if core.git_file(repo,native,ANDROID_MANIFEST).count(b'android:label="Flixify Pro"')!=1:raise GateError('cache_repair_native_label_differs')

def parse_manifest(data,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=64*1024:raise GateError('cache_repair_manifest_size_invalid')
    value=unique_json(data,'cache_repair_manifest_invalid')
    expected={'packageName':'vip.flixify.tv','versionName':'1.4.5','versionCode':13,'minSdk':23,'apkUrl':APK_URL,'sha256':sha256,'sizeBytes':size}
    if not isinstance(value,dict) or set(value)!=set(expected)|{'notes'} or any(value[key]!=item or type(value[key]) is not type(item) for key,item in expected.items()):raise GateError('cache_repair_manifest_pin_differs')
    notes=value['notes']
    if not isinstance(notes,str) or sum(2 if ord(ch)>0xffff else 1 for ch in notes)>2048 or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]',notes):raise GateError('cache_repair_manifest_notes_invalid')
    return value

def validate_apk_proof(data,native,native_tree,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=16384:raise GateError('independent_apk_proof_invalid')
    value=unique_json(data,'independent_apk_proof_invalid')
    expected={'schema':1,'nativeRevision':native,'nativeTree':native_tree,'packageName':'vip.flixify.tv','versionName':'1.4.5','versionCode':13,'minSdk':23,'targetSdk':35,'sha256':sha256,'sizeBytes':size,'certificateSha256':SIGNER_SHA256,'baselineApkSha256':BASELINE_APK_SHA256,'baselineApkSizeBytes':BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}
    if not isinstance(value,dict) or set(value)!=set(expected) or any(value[key]!=item or type(value[key]) is not type(item) for key,item in expected.items()):raise GateError('independent_apk_proof_differs')
    return value

def protected_snapshot(api_tag,api_id):return {'services':original_protected_snapshot(api_tag,api_id),'host':backend.host_snapshot()}

def download_verification_script(sha256,size,manifest):
    script=original_download_script(sha256,size,manifest)
    if script.count('flixify-pro-1.4.4.apk')!=1 or script.count('j.versionName!=="1.4.4"||j.versionCode!==12')!=1:raise GateError('reviewed_download_verifier_contract_differs')
    return script.replace('flixify-pro-1.4.4.apk','flixify-pro-1.4.5.apk').replace('j.versionName!=="1.4.4"||j.versionCode!==12','j.versionName!=="1.4.5"||j.versionCode!==13')

reviewed.validate_source_scope,reviewed.validate_versions=validate_source_scope,validate_versions
reviewed.parse_manifest,reviewed.reviewed.parse_manifest=parse_manifest,parse_manifest
reviewed.validate_apk_proof,reviewed.protected_snapshot=validate_apk_proof,protected_snapshot
reviewed.download_verification_script=download_verification_script
validate_artifacts,expected_public_manifest=reviewed.validate_artifacts,reviewed.expected_public_manifest
snapshot_script,untouched=reviewed.snapshot_script,reviewed.untouched
preflight,verify_candidate,main=reviewed.preflight,reviewed.verify_candidate,reviewed.main

if __name__=='__main__':
    try:main()
    except GateError as error:print('build_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('build_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
