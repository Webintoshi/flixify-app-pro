#!/usr/bin/env python3
"""Welcome UI and signed TV1.4.6 publication over the current cache-repair website."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
HERE=Path(__file__).parent
reviewed=load('welcome_reviewed_publication',HERE.parent/'2026-11-01-tv-cache-repair'/'build-web.py')
backend=load('welcome_api_source_scope',HERE/'build-backend.py')
publication=reviewed.reviewed
builder,core,GateError,command=reviewed.builder,reviewed.core,reviewed.GateError,reviewed.command
BASE_REVISION=backend.BASE_REVISION
SOURCE_TAG,SOURCE_ID=backend.WEB_TAG,backend.WEB_ID
API_TAG,API_ID,WORKER_TAG,WORKER_ID,DB_ID=backend.API_TAG,backend.API_ID,backend.WORKER_TAG,backend.WORKER_ID,backend.DB_ID
PATHS=tuple(sorted(backend.WEB_PATHS));NEW_PATHS=backend.WEB_NEW_PATHS
DESCRIPTOR=reviewed.DESCRIPTOR
APK,UPDATE_MANIFEST=backend.PUBLIC_PATHS
APK_URL='https://flixify.vip/downloads/flixify-pro-1.4.6.apk'
BASELINE_APK='apps/ops-web/public/downloads/flixify-pro-1.4.5.apk'
BASELINE_APK_SHA256='0557946f54082e60a171d5ada901b725e8308b7136d606efcb78233b5ff4d338'
BASELINE_APK_BYTES=1367652
BASELINE_MANIFEST_BYTES=460
BASELINE_MANIFEST_SHA256='e3aa29d2f3c8ec7e7856607e5e8200f902216fc3715550fff27f184f17f387b8'
SIGNER_SHA256,GRADLE,ANDROID_MANIFEST=reviewed.SIGNER_SHA256,reviewed.GRADLE,reviewed.ANDROID_MANIFEST
MAX_APK_BYTES=reviewed.MAX_APK_BYTES
EXCLUDED=(*PATHS,APK,UPDATE_MANIFEST,'apps/ops-web/.next')
unique_json=reviewed.unique_json

def target(revision):
    if not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision):raise GateError('exact_revision_required')
    return 'flixify-ops-web:welcome-offer-'+revision[:12]+'-20261101'

for module in (reviewed,publication,publication.reviewed,builder):
    module.SOURCE_TAG,module.SOURCE_ID,module.BASE_REVISION,module.target=SOURCE_TAG,SOURCE_ID,BASE_REVISION,target
for module in (reviewed,publication,publication.reviewed):
    for name in ('APK','APK_URL','BASELINE_APK','BASELINE_APK_SHA256','BASELINE_APK_BYTES','BASELINE_MANIFEST_BYTES','BASELINE_MANIFEST_SHA256','NEW_PATHS','API_TAG','API_ID','WORKER_TAG','WORKER_ID'):
        setattr(module,name,globals()[name])
publication.RUNTIME_ALLOWLIST=frozenset(PATHS)
publication.configure_paths(PATHS)
original_download=reviewed.download_verification_script
original_protected=reviewed.protected_snapshot

def parse_runtime_paths(data):
    paths=unique_json(data,'welcome_runtime_paths_invalid')
    if not isinstance(paths,list) or any(not isinstance(p,str) for p in paths) or len(paths)!=len(PATHS) or set(paths)!=set(PATHS):raise GateError('welcome_exact_runtime_paths_required')
    return PATHS

def validate_source_scope(repo,revision,native,native_tree,paths):
    if tuple(paths)!=PATHS:raise GateError('welcome_exact_runtime_paths_required')
    try:backend.validate_companion_scope(repo,revision)
    except backend.GateError as error:raise GateError(str(error)) from None
    for ref in (native,revision):
        target(ref)
        if command('git','-C',str(repo),'rev-parse',ref+'^{commit}').decode().strip()!=ref:raise GateError('welcome_native_revision_not_exact')
        if command('git','-C',str(repo),'rev-parse',ref+':apps/tv-android').decode().strip()!=native_tree:raise GateError('welcome_native_tree_changed_after_freeze')
    command('git','-C',str(repo),'merge-base','--is-ancestor',BASE_REVISION,native)
    command('git','-C',str(repo),'merge-base','--is-ancestor',native,revision)
    changed=set(command('git','-C',str(repo),'diff','--name-only',BASE_REVISION,revision,'--','apps/ops-web').decode().splitlines())
    runtime={p for p in changed if not re.fullmatch(r'apps/ops-web/(?:app|components|lib)/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?',p)}
    if runtime!=set((*PATHS,APK,UPDATE_MANIFEST)):raise GateError('welcome_web_runtime_scope_differs')
    for path in PATHS:
        builder.require_regular_blob(repo,revision,path)
        if path in NEW_PATHS and builder.git_entry(repo,BASE_REVISION,path):raise GateError('welcome_new_source_already_exists')
    published=set(command('git','-C',str(repo),'diff','--name-only',native,revision,'--','apps/ops-web').decode().splitlines())
    if not {DESCRIPTOR,APK,UPDATE_MANIFEST}<=published:raise GateError('welcome_publication_missing_after_native_freeze')

def validate_versions(repo,revision,native):
    original=core.git_file(repo,BASE_REVISION,DESCRIPTOR)
    if original.count(b'flixify-pro-1.4.5.apk')!=2 or original.count(b'"1.4.5"')!=1 or core.git_file(repo,revision,DESCRIPTOR)!=original.replace(b'1.4.5',b'1.4.6'):raise GateError('welcome_descriptor_outside_exact_version_replacement')
    gradle=core.git_file(repo,native,GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]",rb'(?m)^\s*minSdk\s+23\s*$',rb'(?m)^\s*targetSdk\s+35\s*$',rb'(?m)^\s*versionCode\s+14\s*$',rb"(?m)^\s*versionName\s+['\"]1\.4\.6['\"]\s*$"):
        if len(re.findall(pattern,gradle))!=1:raise GateError('welcome_native_version_differs')
    if core.git_file(repo,native,ANDROID_MANIFEST).count(b'android:label="Flixify Pro"')!=1:raise GateError('welcome_native_label_differs')

def parse_manifest(data,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=65536:raise GateError('welcome_manifest_size_invalid')
    value=unique_json(data,'welcome_manifest_invalid')
    expected={'packageName':'vip.flixify.tv','versionName':'1.4.6','versionCode':14,'minSdk':23,'apkUrl':APK_URL,'sha256':sha256,'sizeBytes':size}
    if not isinstance(value,dict) or set(value)!=set(expected)|{'notes'} or any(value[k]!=v or type(value[k]) is not type(v) for k,v in expected.items()):raise GateError('welcome_manifest_pin_differs')
    notes=value['notes']
    if not isinstance(notes,str) or sum(2 if ord(c)>0xffff else 1 for c in notes)>2048 or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]',notes):raise GateError('welcome_manifest_notes_invalid')
    return value

def validate_apk_proof(data,native,native_tree,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=16384:raise GateError('independent_apk_proof_invalid')
    value=unique_json(data,'independent_apk_proof_invalid')
    expected={'schema':1,'nativeRevision':native,'nativeTree':native_tree,'packageName':'vip.flixify.tv','versionName':'1.4.6','versionCode':14,'minSdk':23,'targetSdk':35,'sha256':sha256,'sizeBytes':size,'certificateSha256':SIGNER_SHA256,'baselineApkSha256':BASELINE_APK_SHA256,'baselineApkSizeBytes':BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}
    if not isinstance(value,dict) or set(value)!=set(expected) or any(value[k]!=v or type(value[k]) is not type(v) for k,v in expected.items()):raise GateError('independent_apk_proof_differs')
    return value

def accept_api_pin(tag,identity):
    if (tag,identity)==(API_TAG,API_ID):
        if core.image(identity)['Id']!=identity or core.image(tag)['Id']!=identity:raise GateError('welcome_api_baseline_drift')
        return tag,identity
    if not isinstance(identity,str) or not re.fullmatch(r'sha256:[0-9a-f]{64}',identity) or not re.fullmatch(r'flixify-api:welcome-offer-[0-9a-f]{12}-20261101',str(tag)):raise GateError('welcome_exact_api_pin_required')
    image=core.image(identity);labels=image.get('Config',{}).get('Labels') or {};revision=labels.get('org.opencontainers.image.revision');layers=core.image(API_ID).get('RootFS',{}).get('Layers') or []
    if image.get('Id')!=identity or core.image(tag)['Id']!=identity or not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision) or tag!=backend.target('api',revision) or labels.get('vip.flixify.edge-recovery.base')!=API_ID or not layers or image.get('RootFS',{}).get('Layers',[])[:len(layers)]!=layers:raise GateError('welcome_api_ancestry_differs')
    return tag,identity

def protected_snapshot(api_tag,api_id):
    accepted=accept_api_pin(api_tag,api_id);deepest=publication.reviewed;previous=(deepest.API_TAG,deepest.API_ID)
    deepest.API_TAG,deepest.API_ID=accepted
    try:
        result=original_protected(api_tag,api_id)
        try:backend.validate_runtime_proofs(result['host'])
        except backend.GateError as error:raise GateError(str(error)) from None
        return result
    finally:deepest.API_TAG,deepest.API_ID=previous

def download_verification_script(sha256,size,manifest):
    script=original_download(sha256,size,manifest)
    if script.count('flixify-pro-1.4.5.apk')!=1 or script.count('j.versionName!=="1.4.5"||j.versionCode!==13')!=1:raise GateError('welcome_download_verifier_anchor_differs')
    return script.replace('flixify-pro-1.4.5.apk','flixify-pro-1.4.6.apk').replace('j.versionName!=="1.4.5"||j.versionCode!==13','j.versionName!=="1.4.6"||j.versionCode!==14')

publication.parse_runtime_paths,publication.validate_source_scope,publication.validate_versions=parse_runtime_paths,validate_source_scope,validate_versions
publication.parse_manifest,publication.reviewed.parse_manifest=parse_manifest,parse_manifest
publication.validate_apk_proof,publication.protected_snapshot=validate_apk_proof,protected_snapshot
publication.download_verification_script=download_verification_script
snapshot_script,untouched=publication.snapshot_script,publication.untouched
validate_artifacts,expected_public_manifest=publication.validate_artifacts,publication.expected_public_manifest
preflight,verify_candidate,main=publication.preflight,publication.verify_candidate,publication.main
if __name__=='__main__':
    try:main()
    except GateError as error:print('build_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('build_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
