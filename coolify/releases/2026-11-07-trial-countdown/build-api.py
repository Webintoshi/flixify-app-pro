#!/usr/bin/env python3
"""Exact additive /me countdown overlay on the current API; no deployment or migration."""
from __future__ import annotations
import argparse
import contextlib
import io
import json
from pathlib import Path
import importlib.util

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('trial_api_common',HERE/'common.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
backend,command,GateError=c.backend,c.command,c.GateError

def checked_pin(value):
    backend.validate_source_pin(value,'api')
    if value['sourceHashes']!={c.SERVER:c.API_SERVER_SHA,c.HELPER:None}:raise GateError('independent_actual_api_source_pin_required')
    return value

def sources(repo,ref,pin):
    c.revision(ref)
    command('git','-C',str(repo),'merge-base','--is-ancestor',c.BASE,ref)
    paths=command('git','-C',str(repo),'diff','--name-only',c.BASE,ref,'--','apps/api').decode().splitlines()
    if {p for p in paths if '.test.' not in p}!=set(c.API_PATHS):raise GateError('api_runtime_delta_outside_countdown_scope')
    original=backend.helpers.image_file(c.SOURCES['api'][1],c.SERVER)
    if c.sha(original)!=pin['sourceHashes'][c.SERVER]:raise GateError('running_api_source_hash_differs')
    recipe=c.previous.unique_json(c.blob(repo,ref,c.PATCHES))
    helper=c.blob(repo,ref,c.HELPER)
    backend.helpers.SOURCE_ID=c.SOURCES['api'][1];backend.helpers.require_image_absent(c.HELPER)
    return {c.SERVER:c.patch_server(original,recipe),c.HELPER:helper}

def dist_delta(before,after):
    if after['untouched']!=before['untouched']:raise GateError('api_untouched_runtime_changed')
    old,new=before['distEntries'],after['distEntries']
    if set(new)!=set(old)|{'trial-countdown.js'} or 'trial-countdown.js' in old:raise GateError('api_dist_scope_changed')
    if any(new[k]!=v for k,v in old.items() if k!='server.js'):raise GateError('api_unrelated_emitted_module_changed')

def helper_check(candidate):
    script='''import assert from "node:assert/strict";
import {deriveTrialCountdown,withTrialCountdown} from "/app/apps/api/dist/trial-countdown.js";
const now=Date.parse("2026-11-07T12:00:00Z"),end="2026-11-07T15:00:00.000Z";
const active={isThreeHourTrial:true,accessUntil:end,trialProviderExpiresAt:end,summary:{status:"active",hasAssignedLink:true,hasActiveSubscription:true}};
assert.equal(deriveTrialCountdown(active,now).status,"active");
assert.equal(deriveTrialCountdown(active,now+10800000).status,"expired");
assert.equal(deriveTrialCountdown({...active,isThreeHourTrial:false},now).status,"none");
assert.equal(deriveTrialCountdown({...active,summary:{trialProvisionStatus:"pending"}},now).status,"pending");
assert.equal(deriveTrialCountdown({...active,trialProviderExpiresAt:null},now).status,"unavailable");
const payload={user:{accessHistory:{preserved:true}},contact:{telegram:"fixture"}};
const output=withTrialCountdown(payload,active,now);assert.deepEqual(output.user,payload.user);assert.deepEqual(output.contact,payload.contact);assert.equal(output.trialCountdown.endsAt,end);assert.equal("trialCountdown" in payload,false);
'''
    command('docker','run','--rm','--network','none','--read-only','--cpus','1','--memory','128m','--memory-swap','192m','--pids-limit','64','--entrypoint','node',candidate,'--input-type=module','-e',script,timeout=30)

def verify(repo,ref,pin,proof):
    c.configure_api();base,_=c.current_source('api');updates=sources(repo,ref,pin)
    if (not isinstance(proof,dict) or set(proof)!={'schemaVersion','service','revision','sourceId','candidateId','expected'}
      or proof['schemaVersion']!=1 or proof['service']!='api' or proof['revision']!=ref or proof['sourceId']!=c.SOURCES['api'][1]):raise GateError('exact_api_build_proof_required')
    expected=proof['expected'];dist_delta(pin,expected)
    if expected['sourceHashes']!={k:c.sha(v) for k,v in updates.items()}:raise GateError('api_build_proof_source_differs')
    candidate=backend.verify_candidate('api',ref,base,updates,pin,expected)
    if candidate!=proof['candidateId']:raise GateError('api_candidate_id_differs_from_build_proof')
    helper_check(candidate);return candidate

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('repo',type=Path,nargs='?');parser.add_argument('--revision');parser.add_argument('--source-pin',type=Path);parser.add_argument('--build-proof',type=Path)
    action=parser.add_mutually_exclusive_group()
    for name in ('measure','build','verify-existing'):action.add_argument('--'+name,action='store_true')
    args=parser.parse_args();c.configure_api();before=c.protected();base,_=c.current_source('api')
    measured=backend.snapshot(c.SOURCES['api'][1],'api');checked_pin(measured)
    if args.measure:
        if c.protected()!=before:raise GateError('host_changed_during_api_measurement')
        print(json.dumps(measured,sort_keys=True));return
    if args.repo is None or args.revision is None or args.source_pin is None:raise GateError('repo_revision_and_independent_api_source_pin_required')
    pin=checked_pin(c.previous.unique_json(args.source_pin.read_bytes()))
    if pin!=measured:raise GateError('api_independent_source_pin_drift')
    updates=sources(args.repo,args.revision,pin)
    if not(args.build or args.verify_existing):
        c.require_disk();print(json.dumps({'state':'trial_api_preflight_passed'}));return
    c.require_disk()
    if args.build:
        if args.build_proof is None or args.build_proof.exists() or args.build_proof.is_symlink():raise GateError('fresh_external_api_build_proof_path_required')
        if c.target('api',args.revision) in command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}').decode().splitlines():raise GateError('api_candidate_exists_use_verify_existing')
        with contextlib.redirect_stdout(io.StringIO()):expected=backend.compile_overlay('api',args.revision,base,updates,pin)
        dist_delta(pin,expected)
        candidate=backend.verify_candidate('api',args.revision,base,updates,pin,expected)
        proof={'schemaVersion':1,'service':'api','revision':args.revision,'sourceId':c.SOURCES['api'][1],'candidateId':candidate,'expected':expected}
        helper_check(candidate);args.build_proof.write_text(json.dumps(proof,sort_keys=True)+'\n')
    else:
        if args.build_proof is None:raise GateError('api_build_proof_required')
        proof=c.previous.unique_json(args.build_proof.read_bytes());candidate=verify(args.repo,args.revision,pin,proof)
    if c.protected()!=before:raise GateError('api_build_changed_live_runtime_or_environment')
    print(json.dumps({'state':'trial_api_candidate_verified','candidateId':candidate,'candidateTag':c.target('api',args.revision),'revision':args.revision},sort_keys=True))

if __name__=='__main__':main()
