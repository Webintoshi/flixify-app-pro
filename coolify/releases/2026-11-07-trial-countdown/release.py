#!/usr/bin/env python3
"""Guarded countdown API/Web cutover; no migration or device-session revocation."""
from __future__ import annotations
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
api=load('trial_release_api',HERE/'build-api.py');web=load('trial_release_web',HERE/'build-web.py');c=api.c
reviewed=c.load('trial_reviewed_image_transaction',HERE.parent/'2026-11-01-packages/release-backend.py');guard=reviewed.guard
compose=c.load('trial_compose_only_adapter',HERE.parent/'2026-11-04-macos-withdrawal/release.py')
ORIGINAL_PHP=guard.PHP_APPLY
NATIVE,MANIFEST=None,None

def configure(ref,candidates,native,manifest):
    global NATIVE,MANIFEST
    c.revision(ref)
    if set(candidates)!=set(c.SOURCES) or any(not isinstance(v,str) or not re.fullmatch('sha256:[a-f0-9]{64}',v) for v in candidates.values()):raise c.GateError('two_exact_countdown_candidate_ids_required')
    NATIVE,MANIFEST=native,manifest
    guard.REVISION=ref;guard.CHANGED,guard.PROTECTED=('api','ops-web'),('db','worker')
    guard.PHP_APPLY=compose.compose_only_php(ORIGINAL_PHP)
    guard.SOURCE={k:v[0] for k,v in c.SOURCES.items()};guard.SOURCE_IDS={k:v[1] for k,v in c.SOURCES.items()}
    guard.TARGET={k:c.target(k,ref) for k in c.SOURCES};guard.PROTECTED_IMAGES={'worker':c.WORKER};guard.PROTECTED_DB_IMAGE_ID=c.DB
    guard.PHP_READ_APPLICATIONS=reviewed.READ_APPLICATIONS.replace("['worker']","['api', 'ops-web']")
    guard.protected_application_images=lambda:json.loads(guard.command('docker','exec','coolify','php','-r',reviewed.READ_APPLICATIONS))
    guard.validate_plan=reviewed.validate_plan
    def candidate_images():
        for name,identity in candidates.items():
            row=guard.image(guard.TARGET[name]);base=guard.image(guard.SOURCE_IDS[name]);labels=row['Config'].get('Labels') or {};layers=base['RootFS'].get('Layers') or []
            if (row['Id']!=identity or identity==base['Id'] or not layers or row['RootFS']['Layers'][:len(layers)]!=layers
              or labels.get('org.opencontainers.image.revision')!=ref or labels.get('vip.flixify.edge-recovery.base')!=base['Id']):raise c.GateError('countdown_candidate_identity_or_ancestry_drift')
        return candidates
    guard.candidate_images=candidate_images;guard.healthy=healthy

def healthy(name,tag,identity=None):
    try:
        row=guard.container_snapshot(allow_missing_changed=True)[name]
        if row['tag']!=tag or row['image_id']!=identity or not row['running'] or row['health']=='unhealthy' or row['hash']!=guard.compose_hash(name):return False
        if name=='api':script='(async()=>{const r=await fetch("http://127.0.0.1:4000/health",{redirect:"manual",signal:AbortSignal.timeout(8000)});if(r.status!==200||(await r.json()).ok!==true)throw Error("health")})().catch(()=>process.exit(1))'
        elif name=='ops-web' and tag==guard.TARGET[name]:
            web.c.configure_web();script=web.c.prior.download_script(NATIVE,MANIFEST)
        elif name=='ops-web' and tag==guard.SOURCE[name]:script='(async()=>{for(const p of ["/","/indir","/paketler","/cihaz","/giris-yap"]){const r=await fetch("http://127.0.0.1:3000"+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});if(r.status!==200)throw Error("page")}})().catch(()=>process.exit(1))'
        else:return False
        guard.command('docker','exec',name+'-'+guard.UUID,'node','-e',script,timeout=160);return True
    except Exception:return False

def invoke(action):
    before=c.protected(('api','ops-web'))
    if action=='rollback':
        with contextlib.redirect_stdout(io.StringIO()):guard.rollback()
    elif action=='recreate':
        _,compose_document,env,containers,raw,rendered=guard.preflight('target')
        try:
            with contextlib.redirect_stdout(io.StringIO()):guard.recreate(containers,compose_document,env,raw,rendered)
        except Exception:
            guard.verify_recovery_context(containers,compose_document,env)
            with contextlib.redirect_stdout(io.StringIO()):guard.rollback()
            raise c.GateError('countdown_cutover_failed_original_images_restored')
    else:
        record,compose_document,env,containers,raw,rendered=guard.preflight('source')
        if action=='apply':
            with contextlib.redirect_stdout(io.StringIO()):guard.sync_images(record,compose_document,env,containers,raw,rendered,guard.SOURCE,guard.TARGET)
    if c.protected(('api','ops-web'))!=before:raise c.GateError('protected_worker_database_environment_or_other_project_changed')
    print(json.dumps({'state':'trial_'+(action or 'preflight')+'_verified','changed':['api','ops-web'],'sessionRevocation':False},sort_keys=True))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('repo',type=Path);parser.add_argument('--revision',required=True);parser.add_argument('--api-proof',type=Path,required=True);parser.add_argument('--api-source-pin',type=Path,required=True);parser.add_argument('--web-source-pin',type=Path,required=True);parser.add_argument('--native-proof',type=Path,required=True);parser.add_argument('--web-candidate-id',required=True);parser.add_argument('--windows-installer',type=Path,required=True);parser.add_argument('--windows-proof',type=Path,required=True)
    actions=parser.add_mutually_exclusive_group()
    for name in ('apply','recreate','rollback'):actions.add_argument('--'+name,action='store_true')
    args=parser.parse_args();native=c.native_proof(args.native_proof.read_bytes());proof=c.previous.unique_json(args.api_proof.read_bytes());windows=web.c.windows_proof(args.windows_proof.read_bytes())
    action='rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    manifest=c.blob(args.repo,args.revision,c.UPDATE,65536);c.manifest(manifest,native)
    candidates={'api':proof['candidateId'],'ops-web':args.web_candidate_id}
    configure(args.revision,candidates,native,manifest)
    with reviewed.release_lock():
        if action!='rollback':
            c.require_disk(0);before=c.protected(('api','ops-web'))
            api.c.configure_api()
            api_pin=api.checked_pin(c.previous.unique_json(args.api_source_pin.read_bytes()))
            if api.verify(args.repo,args.revision,api_pin,proof)!=candidates['api']:raise c.GateError('api_verification_pin_differs')
            web.c.configure_web();web_pin=web.measured_pin(c.previous.unique_json(args.web_source_pin.read_bytes()))
            if web.verify(args.repo,args.revision,native,web_pin,windows,args.windows_installer)!=candidates['ops-web']:raise c.GateError('web_verification_pin_differs')
            if c.protected(('api','ops-web'))!=before:raise c.GateError('host_changed_during_candidate_verification')
        invoke(action)

if __name__=='__main__':main()
