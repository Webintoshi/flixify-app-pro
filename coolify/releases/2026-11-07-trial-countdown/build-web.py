#!/usr/bin/env python3
"""Fixed countdown Web overlay with accepted Android 1.4.16 and Windows 1.0.4."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import importlib.util
import re

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('trial_web_common',HERE/'common.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
command,GateError=c.command,c.GateError

def windows_sources(repo,ref,proof,installer):
    for rev in (proof['nativeRevision'],ref):
        if command('git','-C',str(repo),'rev-parse',rev+':apps/windows-native').decode().strip()!=proof['nativeTree']:raise GateError('accepted_windows_source_tree_changed')
    command('git','-C',str(repo),'merge-base','--is-ancestor',proof['nativeRevision'],ref)
    if c.builder.git_entry(repo,ref,c.WINDOWS_EXE):raise GateError('windows_installer_must_remain_external_to_git')
    c.builder.require_image_absent(c.WINDOWS_EXE)
    return c.windows_installer(installer,proof)

def windows_descriptor(old):
    replacements=((b'1.0.3',b'1.0.4',3),(b'70365988',str(c.WINDOWS_BYTES).encode(),1),
      (b'5425571a13c4e696b00be4357b5a6be8137d3904c1b1efec3e08dcf69238872e',c.WINDOWS_SHA.encode(),1))
    for before,after,count in replacements:
        if old.count(before)!=count:raise GateError('existing_windows_descriptor_anchor_changed')
        old=old.replace(before,after)
    return old

def sources(repo,ref,native,windows,installer):
    c.revision(ref);command('git','-C',str(repo),'merge-base','--is-ancestor',c.BASE,ref)
    command('git','-C',str(repo),'merge-base','--is-ancestor',native['nativeRevision'],ref)
    for rev in (native['nativeRevision'],ref):
        if command('git','-C',str(repo),'rev-parse',rev+':apps/tv-android').decode().strip()!=native['nativeTree']:raise GateError('accepted_native_source_tree_changed')
    changed=command('git','-C',str(repo),'diff','--name-only',c.BASE,ref,'--','apps/ops-web').decode().splitlines()
    if {p for p in changed if '.test.' not in p}!=set(c.GIT_WEB_PATHS):raise GateError('web_runtime_delta_outside_fixed_countdown_scope')
    result={}
    for path in (*c.WEB_MODIFIED,*c.WEB_NEW,c.DESCRIPTOR,c.WINDOWS_DESCRIPTOR):
        if path in c.WEB_NEW:c.builder.require_image_absent(path)
        elif c.builder.image_file(c.SOURCES['ops-web'][1],path)!=c.blob(repo,c.BASE,path):raise GateError('actual_web_source_differs_from_reviewed_base')
        result[path]=c.blob(repo,ref,path)
    old=c.blob(repo,c.BASE,c.DESCRIPTOR)
    if result[c.DESCRIPTOR]!=old.replace(b'1.4.15',b'1.4.16') or old.count(b'1.4.15')!=3:raise GateError('android_descriptor_outside_exact_version_change')
    if result[c.WINDOWS_DESCRIPTOR]!=windows_descriptor(c.blob(repo,c.BASE,c.WINDOWS_DESCRIPTOR)):raise GateError('windows_descriptor_outside_exact_version_size_hash_change')
    gradle=c.blob(repo,native['nativeRevision'],'apps/tv-android/app/build.gradle')
    for pattern in (rb'(?m)^\s*versionCode\s+24\s*$',rb"(?m)^\s*versionName\s+['\"]1\.4\.16['\"]\s*$",rb'(?m)^\s*minSdk\s+23\s*$',rb'(?m)^\s*targetSdk\s+35\s*$'):
        if len(re.findall(pattern,gradle))!=1:raise GateError('native_version_or_platform_differs')
    c.builder.require_image_absent(c.APK)
    apk=c.blob(repo,ref,c.APK,32*1024**2);manifest=c.blob(repo,ref,c.UPDATE,65536)
    if len(apk)!=native['apkBytes'] or c.sha(apk)!=native['apkSha256'] or not apk.startswith(b'PK\x03\x04'):raise GateError('accepted_android_binary_differs')
    c.manifest(manifest,native);result[c.APK],result[c.UPDATE]=apk,manifest
    if c.builder.image_file(c.SOURCES['ops-web'][1],c.UPDATE)!=c.blob(repo,c.BASE,c.UPDATE,65536):raise GateError('actual_android_updater_manifest_drift')
    result[c.WINDOWS_EXE]=windows_sources(repo,ref,windows,installer)
    return result

def measured_pin(value):
    c.prior.source_pin(json.dumps(value).encode());return value

def prepare(repo,ref,native,pin,windows,installer):
    base,env=c.prior.source_runtime();updates=sources(repo,ref,native,windows,installer)
    public=c.previous.web.public_manifest(c.SOURCES['ops-web'][1])
    if env!=pin['publicBuildEnv'] or c.previous.sha(c.previous.web.canonical_public_manifest(public))!=pin['publicSha256']:raise GateError('actual_web_public_tree_or_environment_changed')
    if c.previous.web.untouched(c.SOURCES['ops-web'][1])!=pin['measurement'] or c.prior.next_footprint()!=pin['nextBytes']:raise GateError('actual_web_independent_source_measurement_drift')
    config=c.builder.image_file(c.SOURCES['ops-web'][1],c.builder.CONFIG)
    if config!=c.blob(repo,c.BASE,c.builder.CONFIG):raise GateError('next_configuration_drift')
    c.expected_public(public,native,updates[c.UPDATE])
    budget=c.web_budget(pin['nextBytes'],sum(len(v) for v in updates.values()),native)
    return base,env,updates,public,config,budget

def verify(repo,ref,native,pin,windows,installer):
    c.configure_web();base,env,updates,public,config,budget=prepare(repo,ref,native,pin,windows,installer)
    c.prior.require_disk(budget)
    return c.prior.verify_candidate(ref,base,updates,env,config,public,native,pin)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('repo',type=Path,nargs='?');parser.add_argument('--revision');parser.add_argument('--native-proof',type=Path);parser.add_argument('--source-pin',type=Path);parser.add_argument('--windows-installer',type=Path);parser.add_argument('--windows-proof',type=Path)
    actions=parser.add_mutually_exclusive_group()
    for name in ('measure','build','verify-existing'):actions.add_argument('--'+name,action='store_true')
    args=parser.parse_args();c.configure_web();before=c.protected()
    if args.measure:
        result=c.prior.measure()
        if c.protected()!=before:raise GateError('host_changed_during_web_measurement')
        print(json.dumps(result,sort_keys=True));return
    if any(value is None for value in (args.repo,args.revision,args.native_proof,args.source_pin,args.windows_installer,args.windows_proof)):raise GateError('web_repo_revision_external_windows_and_independent_proofs_required')
    native=c.native_proof(args.native_proof.read_bytes());pin=measured_pin(c.previous.unique_json(args.source_pin.read_bytes()));windows=c.windows_proof(args.windows_proof.read_bytes())
    base,env,updates,public,config,budget=prepare(args.repo,args.revision,native,pin,windows,args.windows_installer)
    if not(args.build or args.verify_existing):
        c.prior.require_disk(budget,build=True);print(json.dumps({'state':'trial_web_preflight_passed','diskBudget':budget}));return
    if args.build:
        if c.target('ops-web',args.revision) in command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}').decode().splitlines():raise GateError('web_candidate_exists_use_verify_existing')
        c.prior.compile_candidate(args.revision,base,updates,env,budget)
    candidate=c.prior.verify_candidate(args.revision,base,updates,env,config,public,native,pin)
    if c.protected()!=before:raise GateError('web_build_changed_live_host_or_environment')
    print(json.dumps({'state':'trial_web_candidate_verified','candidateId':candidate,'candidateTag':c.target('ops-web',args.revision),'revision':args.revision,'diskBudget':budget},sort_keys=True))

if __name__=='__main__':main()
