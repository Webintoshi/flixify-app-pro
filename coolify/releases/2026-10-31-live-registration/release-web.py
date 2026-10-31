#!/usr/bin/env python3
"""Web-only live-registration release; exact API pins required, read-only by default.

Reuse the reviewed Coolify image transaction and its configuration/environment
guards. Apply synchronizes only the website image; recreate and rollback may
restart only ops-web. The current API, worker and database remain protected.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "live_registration_web_prior",
    Path(__file__).parents[1] / "2026-10-26-edge-recovery" / "release-web.py",
)
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
guard, GateError = prior.guard, prior.GateError

SOURCE_TAG = "flixify-ops-web:edge-recovery-ed852d2a69d4-20261026"
SOURCE_ID = "sha256:d6abf84cc47f3395466bf637c3505489b91cc2e69ca2c8ce061e6c815b4354c0"
WORKER_TAG = "flixify-worker:edge-recovery-539e01cff3c3-20261026"
WORKER_ID = "sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee"
ISOLATED_SERVICES = ("ops-web", "worker", "db")
GUARD_KEY = "REGISTRATION_GUARD_SECRET"
LEGACY_WEB_CONTAINER_ID = "74eec230b7dac3715fa2125367e16925d6e019cec9eb0e1a32b09b94af45ce39"
LEGACY_WEB_CONFIG_HASH = "89a26cd2eb2db12b2a5c92e0c01f2a8291ddabed478874c348a7643ac21acd3d"
LEGACY_SHARED_GUARD_HASH = "2ffac5fb7c29cc4ee3c931dc6c8cd487965fbee2343ea7c65813b703faf8ae82"
LEGACY_EMPTY_GUARD_HASH = "2ee72d562864bb7009c330d4d366afe008e04f2c925c37730a69a336ba64588f"
ORIGINAL_VALIDATE_PLAN = guard.validate_plan
ORIGINAL_COMPOSE_HASH = guard.compose_hash
ORIGINAL_RESTORE = guard.restore_prior_images_after_postcheck
ORIGINAL_PHP_APPLY = guard.PHP_APPLY
_restore_isolation = None

PHP_ISOLATION_HELPER = r'''
function isolateRegistrationGuard(&$document, $isolate) {
    if (!is_bool($isolate)) { throw new RuntimeException('guard isolation direction'); }
    $profiles=[];
    foreach (['ops-web','worker','db'] as $name) {
        if (!isset($document['services'][$name]['environment']) || !is_array($document['services'][$name]['environment'])) { throw new RuntimeException('guard environment shape'); }
        $environment=$document['services'][$name]['environment'];$found=0;
        if (array_is_list($environment)) {
            foreach ($environment as $entry) {
                if (!is_string($entry)) { throw new RuntimeException('guard environment entry'); }
                if (explode('=',$entry,2)[0]==='REGISTRATION_GUARD_SECRET') {
                    if ($entry!=='REGISTRATION_GUARD_SECRET=' || ++$found!==1) { throw new RuntimeException('guard environment drift'); }
                }
            }
        } elseif (array_key_exists('REGISTRATION_GUARD_SECRET',$environment)) {
            if ($environment['REGISTRATION_GUARD_SECRET']!=='') { throw new RuntimeException('guard environment drift'); }
            $found=1;
        }
        $profiles[]=$found;
    }
    if (count(array_unique($profiles))!==1 || (!$isolate && $profiles[0]!==1)) { throw new RuntimeException('guard isolation profile'); }
    foreach (['ops-web','worker','db'] as $name) {
        $environment =& $document['services'][$name]['environment'];
        if (array_is_list($environment)) {
            if ($isolate && !$profiles[0]) { $environment[]='REGISTRATION_GUARD_SECRET='; }
            elseif (!$isolate) { $environment=array_values(array_filter($environment,fn($entry)=>explode('=',$entry,2)[0]!=='REGISTRATION_GUARD_SECRET')); }
        } elseif ($isolate) { $environment['REGISTRATION_GUARD_SECRET']=''; }
        else { unset($environment['REGISTRATION_GUARD_SECRET']); }
        unset($environment);
    }
}
'''

def environment(document, name):
    value=document['services'][name].get('environment')
    if isinstance(value,dict):return value
    if not isinstance(value,list):raise GateError('guard_environment_shape')
    result={}
    for entry in value:
        if not isinstance(entry,str):raise GateError('guard_environment_entry')
        key,separator,item=entry.partition('=')
        if key in result:raise GateError('guard_environment_duplicate')
        result[key]=item if separator else None
    return result

def isolation_profile(document):
    profiles=[]
    for name in ISOLATED_SERVICES:
        values=environment(document,name)
        if GUARD_KEY in values and values[GUARD_KEY]!='':raise GateError('guard_isolation_must_be_literal_empty')
        profiles.append(GUARD_KEY in values)
    if len(set(profiles))!=1:raise GateError('guard_isolation_profile_mixed')
    return profiles[0]

def isolate_guard_document(document, isolate=True):
    present=isolation_profile(document)
    if not isolate and not present:raise GateError('guard_isolation_restore_profile_differs')
    for name in ISOLATED_SERVICES:
        values=document['services'][name]['environment']
        if isinstance(values,list):
            if isolate and not present:values.append(GUARD_KEY+'=')
            elif not isolate:values[:]=[row for row in values if row.split('=',1)[0]!=GUARD_KEY]
        elif isolate:values[GUARD_KEY]=''
        else:del values[GUARD_KEY]

def expected_swapped(raw, rendered, new_images):
    if new_images not in (guard.SOURCE,guard.TARGET):raise GateError('web_image_direction_invalid')
    result=(copy.deepcopy(raw),copy.deepcopy(rendered))
    for document in result:
        isolate_guard_document(document)
        document['services']['ops-web']['image']=new_images['ops-web']
    return result

def validate_plan(raw,rendered,generated,containers,applications,stage,*,recovering=False):
    ORIGINAL_VALIDATE_PLAN(raw,rendered,generated,containers,applications,stage,recovering=recovering)
    profiles=[isolation_profile(doc) for doc in (raw,rendered,generated)]
    if len(set(profiles))!=1 or (stage=='target' and not profiles[0]):raise GateError('guard_isolation_profile_differs')

def php_apply():
    anchor='function canonical($x) {';apply="        $phase = 'compose_dump';"
    if ORIGINAL_PHP_APPLY.count(anchor)!=1 or ORIGINAL_PHP_APPLY.count(apply)!=1:raise GateError('web_transaction_anchor_differs')
    return ORIGINAL_PHP_APPLY.replace(anchor,PHP_ISOLATION_HELPER+'\n'+anchor,1).replace(apply,"        isolateRegistrationGuard($raw, $p['isolate_guard']);\n        isolateRegistrationGuard($expected, $p['isolate_guard']);\n"+apply,1)

def locked_image_swap(record,old_images,new_images):
    if (old_images,new_images) not in ((guard.SOURCE,guard.TARGET),(guard.TARGET,guard.SOURCE)):raise GateError('web_image_direction_invalid')
    payload={'uuid':guard.UUID,'old':old_images,'new':new_images,'isolate_guard':True if _restore_isolation is None else _restore_isolation,
             'protected':{name:pin[0] for name,pin in guard.PROTECTED_IMAGES.items()},
             'raw_sha':guard.sha(record['docker_compose_raw']),'rendered_sha':guard.sha(record['docker_compose'])}
    guard.command('docker','exec','-i','coolify','php','-r',guard.PHP_APPLY,input_data=json.dumps(payload,separators=(',',':')).encode(),timeout=180,capture_sync_phase=True)

def restore_prior_images_after_postcheck(*args):
    global _restore_isolation
    _restore_isolation=isolation_profile(args[5])
    try:return ORIGINAL_RESTORE(*args)
    finally:_restore_isolation=None

def normalized_hash(document,name='ops-web'):
    result=guard.command('docker','compose','-p',guard.UUID,'--project-directory',str(guard.DIRECTORY),'-f','-','config','--hash',name,input_data=json.dumps(document,separators=(',',':')).encode())
    parts=result.decode().strip().split()
    if not parts:raise GateError('normalized_hash_missing')
    return parts[-1]

def legacy_source_compatible(item,document,computed):
    config=item.get('Config') or {};labels=config.get('Labels') or {}
    if (item.get('Id')!=LEGACY_WEB_CONTAINER_ID or item.get('Image')!=SOURCE_ID or config.get('Image')!=SOURCE_TAG or
        labels.get('com.docker.compose.config-hash')!=LEGACY_WEB_CONFIG_HASH or computed not in (LEGACY_SHARED_GUARD_HASH,LEGACY_EMPTY_GUARD_HASH) or
        document.get('services',{}).get('ops-web',{}).get('image')!=SOURCE_TAG):return False
    values=environment(document,'ops-web')
    if GUARD_KEY not in values or not isinstance(values[GUARD_KEY],str):return False
    if normalized_hash(document)!=computed:return False
    reconstructed=copy.deepcopy(document)
    del reconstructed['services']['ops-web']['environment'][GUARD_KEY]
    return normalized_hash(reconstructed)==LEGACY_WEB_CONFIG_HASH

def compose_hash(name):
    computed=ORIGINAL_COMPOSE_HASH(name)
    if name!='ops-web':return computed
    data=json.loads(guard.command('docker','inspect','ops-web-'+guard.UUID))
    if not isinstance(data,list) or len(data)!=1:raise GateError('web_hash_inspection_invalid')
    item=data[0]
    if (item.get('Config',{}).get('Labels') or {}).get('com.docker.compose.config-hash')==computed:return computed
    if item.get('Id')!=LEGACY_WEB_CONTAINER_ID:return computed
    document=json.loads(guard.command('docker','compose','-p',guard.UUID,'--project-directory',str(guard.DIRECTORY),'-f',str(guard.COMPOSE),'config','--format','json'))
    return LEGACY_WEB_CONFIG_HASH if legacy_source_compatible(item,document,computed) else computed

def healthy(name,expected_tag,expected_id=None):
    if not prior.healthy(name,expected_tag,expected_id):return False
    try:
        guard.command('docker','exec','ops-web-'+guard.UUID,'node','-e','if(process.env.REGISTRATION_GUARD_SECRET!=="")process.exitCode=1',timeout=15)
        guard.command('docker','exec','api-'+guard.UUID,'node','-e','if(typeof process.env.REGISTRATION_GUARD_SECRET!=="string"||process.env.REGISTRATION_GUARD_SECRET.length<32)process.exitCode=1',timeout=15)
        return True
    except GateError:return False


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return f"flixify-ops-web:live-registration-{revision[:12]}-20261031"


def container_snapshot(*, allow_missing_changed: bool = False) -> dict[str, dict]:
    """Guard restart counts and running state alongside the original identity."""
    result = {}
    for name in guard.SERVICES:
        try:
            data = json.loads(guard.command("docker", "inspect", f"{name}-{guard.UUID}"))
        except GateError:
            if allow_missing_changed and name in guard.CHANGED:
                result[name] = {
                    "id": None, "image_id": None, "tag": None, "hash": None,
                    "guard": None, "running": False, "health": None,
                    "restart_count": None,
                }
                continue
            raise
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise GateError("container_inspection_invalid:" + name)
        item = data[0]
        labels = item.get("Config", {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") != guard.UUID:
            raise GateError("container_project_differs:" + name)
        restart_count = item.get("RestartCount")
        running = item.get("State", {}).get("Running")
        if type(restart_count) is not int or restart_count < 0 or type(running) is not bool:
            raise GateError("container_runtime_identity_invalid:" + name)
        result[name] = {
            "id": item["Id"], "image_id": item["Image"],
            "tag": item["Config"]["Image"],
            "hash": labels.get("com.docker.compose.config-hash"),
            "running": running,
            "health": (item["State"].get("Health") or {}).get("Status"),
            "restart_count": restart_count,
            "guard": guard.sha(json.dumps({
                "Config": item["Config"], "HostConfig": item["HostConfig"],
                "Mounts": item.get("Mounts"),
                "Networks": item.get("NetworkSettings", {}).get("Networks"),
                "StartedAt": item["State"].get("StartedAt"),
                "Running": running, "RestartCount": restart_count,
            }, sort_keys=True, separators=(",", ":"))),
        }
    return result


def configure(revision: str, candidate_id: str, api_tag: str, api_id: str) -> None:
    global _restore_isolation
    target(revision)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if not re.fullmatch(r"flixify-api:[A-Za-z0-9_.-]+", api_tag):
        raise GateError("exact_protected_api_image_tag_required")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", api_id):
        raise GateError("exact_protected_api_image_id_required")
    prior.SOURCE_TAG, prior.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    prior.API_TAG, prior.API_ID = api_tag, api_id
    prior.target = target
    prior.configure(revision, candidate_id, WORKER_TAG, WORKER_ID)
    guard.container_snapshot = container_snapshot
    guard.validate_plan = validate_plan
    guard.expected_swapped = expected_swapped
    guard.locked_image_swap = locked_image_swap
    guard.PHP_APPLY = php_apply()
    guard.compose_hash = compose_hash
    guard.restore_prior_images_after_postcheck = restore_prior_images_after_postcheck
    guard.healthy = healthy
    _restore_isolation = None


protected_application_images = prior.protected_application_images
quiet_recreate = prior.quiet_recreate
quiet_rollback = prior.quiet_rollback


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="full reviewed website commit")
    parser.add_argument("--candidate-id", required=True, help="immutable verified website image ID")
    parser.add_argument("--protected-api-tag", required=True, help="exact accepted running API tag")
    parser.add_argument("--protected-api-id", required=True, help="exact accepted running API image ID")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true", help="sync only website image; no restart")
    actions.add_argument("--recreate", action="store_true", help="recreate only synchronized website")
    actions.add_argument("--rollback", action="store_true", help="restore only pinned source website")
    args = parser.parse_args()
    configure(args.revision, args.candidate_id, args.protected_api_tag, args.protected_api_id)
    if args.rollback:
        quiet_rollback()
        return
    if args.recreate:
        _, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("target")
        try:
            quiet_recreate(before, compose_bytes, env_bytes, raw, rendered)
        except GateError as error:
            if str(error) in {"command_failed", "command_unavailable"} or str(error).startswith(("new_container_unhealthy:", "candidate_tag_drift:")):
                guard.verify_recovery_context(before, compose_bytes, env_bytes)
                try:
                    quiet_rollback()
                except GateError as rollback_error:
                    raise GateError(f"deploy_failed_and_rollback_failed:{rollback_error}") from error
                raise GateError("deploy_failed_but_source_restored") from error
            raise
        return
    record, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("source")
    if args.apply:
        guard.sync_images(record, compose_bytes, env_bytes, before, raw, rendered, guard.SOURCE, guard.TARGET)
        print("coolify_web_image_and_guard_isolation_synced; containers_not_restarted; env_file_unchanged")
    else:
        print("dry_run_ok; web_image_and_three_literal_empty_overrides_would_change; no_mutation")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
