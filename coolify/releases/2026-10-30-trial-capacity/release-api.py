#!/usr/bin/env python3
"""Guarded API-only trial-capacity rollout; read-only by default."""
from __future__ import annotations
import argparse,contextlib,copy,importlib.util,io,json,re,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('trial_api_guard',Path(__file__).parent.parent/'2026-10-26-edge-recovery'/'release-worker.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
GateError=guard.GateError
SOURCE_TAG='flixify-api:personal-viewer-5002a7a-20261026'
SOURCE_ID='sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53'
WORKER_TAG='flixify-worker:edge-recovery-539e01cff3c3-20261026'
WORKER_ID='sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee'
PROXY_TAG='traefik:v3.6'
PROXY_ID='sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d'
PROXY_NETWORK_ID='c4818456c398e93cd1ed4a243a3cb4713fb894a2d11dc9c99dc116b8a8743749'
TRIAL_ENV={'TRUSTED_PROXY_CIDRS':'10.0.2.4/32,127.0.0.1/32,::1/128','AUTO_TRIAL_DAILY_IP_LIMIT':'1000'}
READ_APPLICATIONS_TEMPLATE=guard.PHP_READ_APPLICATIONS
ORIGINAL_VALIDATE_PLAN=guard.validate_plan
ORIGINAL_PREFLIGHT=guard.preflight
ORIGINAL_RECREATE_CONTEXT=guard.verify_recreate_context
ORIGINAL_RECOVERY_CONTEXT=guard.verify_recovery_context
ORIGINAL_PHP_APPLY=guard.PHP_APPLY
_proxy_identity=None

PHP_ENV_HELPER=r'''
function trialEnv(&$document, $add) {
    $updates = ['TRUSTED_PROXY_CIDRS' => '10.0.2.4/32,127.0.0.1/32,::1/128', 'AUTO_TRIAL_DAILY_IP_LIMIT' => '1000'];
    if (!is_bool($add) || !isset($document['services']['api']['environment']) || !is_array($document['services']['api']['environment'])) {
        throw new RuntimeException('trial environment shape');
    }
    $environment =& $document['services']['api']['environment'];
    if (array_is_list($environment)) {
        $seen = [];
        foreach ($environment as $entry) {
            if (!is_string($entry)) { throw new RuntimeException('trial environment entry'); }
            $key = explode('=', $entry, 2)[0];
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $key)) { throw new RuntimeException('trial environment key'); }
            if (array_key_exists($key, $updates)) {
                if ($add || isset($seen[$key]) || $entry !== $key . '=' . $updates[$key]) { throw new RuntimeException('trial environment drift'); }
                $seen[$key] = true;
            }
        }
        if (!$add && count($seen) !== count($updates)) { throw new RuntimeException('trial environment missing'); }
        if ($add) { foreach ($updates as $key => $value) { $environment[] = $key . '=' . $value; } }
        else { $environment = array_values(array_filter($environment, function ($entry) use ($updates) { return !array_key_exists(explode('=', $entry, 2)[0], $updates); })); }
    } else {
        foreach ($updates as $key => $value) {
            if ($add) {
                if (array_key_exists($key, $environment)) { throw new RuntimeException('trial environment already present'); }
                $environment[$key] = $value;
            } else {
                if (!array_key_exists($key, $environment) || $environment[$key] !== $value) { throw new RuntimeException('trial environment drift'); }
                unset($environment[$key]);
            }
        }
    }
}
'''

def php_apply():
    helper_anchor='function canonical($x) {'
    apply_anchor="        $phase = 'compose_dump';"
    if ORIGINAL_PHP_APPLY.count(helper_anchor)!=1 or ORIGINAL_PHP_APPLY.count(apply_anchor)!=1:raise GateError('historical_transaction_anchor_differs')
    return ORIGINAL_PHP_APPLY.replace(helper_anchor,PHP_ENV_HELPER+'\n'+helper_anchor,1).replace(apply_anchor,"        $phase = 'compose_parse';\n        trialEnv($raw, $p['add_trial_env']);\n        trialEnv($expected, $p['add_trial_env']);\n"+apply_anchor,1)

def validate_trial_environment(document,stage):
    environment=document['services']['api'].get('environment')
    if isinstance(environment,dict):
        for key,value in TRIAL_ENV.items():
            if (stage=='source' and key in environment) or (stage=='target' and environment.get(key)!=value):raise GateError('api_trial_environment_differs')
    elif isinstance(environment,list):
        found={key:[] for key in TRIAL_ENV}
        for entry in environment:
            if not isinstance(entry,str):raise GateError('api_environment_entry_invalid')
            key=entry.split('=',1)[0]
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',key):raise GateError('api_environment_key_invalid')
            if key in found:found[key].append(entry)
        for key,entries in found.items():
            if (stage=='source' and entries) or (stage=='target' and entries!=[key+'='+TRIAL_ENV[key]]):raise GateError('api_trial_environment_differs')
    else:raise GateError('api_environment_shape_invalid')

def validate_plan(raw,rendered,generated,containers,applications,stage,*,recovering=False):
    ORIGINAL_VALIDATE_PLAN(raw,rendered,generated,containers,applications,stage,recovering=recovering)
    for document in (raw,rendered,generated):validate_trial_environment(document,stage)

def expected_swapped(raw,rendered,new_images):
    if new_images not in (guard.SOURCE,guard.TARGET):raise GateError('api_image_direction_invalid')
    adding=new_images==guard.TARGET
    results=[copy.deepcopy(raw),copy.deepcopy(rendered)]
    for document in results:
        validate_trial_environment(document,'source' if adding else 'target')
        document['services']['api']['image']=new_images['api']
        environment=document['services']['api']['environment']
        if isinstance(environment,list):
            if adding:environment.extend(key+'='+value for key,value in TRIAL_ENV.items())
            else:environment[:]=[entry for entry in environment if entry.split('=',1)[0] not in TRIAL_ENV]
        else:
            for key,value in TRIAL_ENV.items():
                if adding:environment[key]=value
                else:del environment[key]
    return tuple(results)

def locked_image_swap(record,old_images,new_images):
    if (old_images,new_images) not in ((guard.SOURCE,guard.TARGET),(guard.TARGET,guard.SOURCE)):raise GateError('api_image_direction_invalid')
    payload={'uuid':guard.UUID,'old':old_images,'new':new_images,'add_trial_env':new_images==guard.TARGET,
             'protected':{name:pin[0] for name,pin in guard.PROTECTED_IMAGES.items()},
             'raw_sha':guard.sha(record['docker_compose_raw']),'rendered_sha':guard.sha(record['docker_compose'])}
    guard.command('docker','exec','-i','coolify','php','-r',guard.PHP_APPLY,input_data=json.dumps(payload,separators=(',',':')).encode(),timeout=180,capture_sync_phase=True)

def target(revision):
    if not re.fullmatch(r'[0-9a-f]{40}',revision):raise GateError('exact_app_revision_required')
    return 'flixify-api:trial-capacity-'+revision[:12]+'-20261030'
def protected_application_images():
    script=READ_APPLICATIONS_TEMPLATE.replace("['worker']","['worker', 'ops-web']")
    return json.loads(guard.command('docker','exec','coolify','php','-r',script))
def healthy(name,tag,image_id=None):
    try:
        item=guard.container_snapshot(allow_missing_changed=True)[name]
        if item['tag']!=tag or item['image_id']!=(image_id or guard.image_id(tag)) or not item['running'] or item['health']=='unhealthy' or item['hash']!=guard.compose_hash(name):return False
        guard.command('docker','exec','api-'+guard.UUID,'node','-e','fetch("http://127.0.0.1:4000/health",{redirect:"manual",signal:AbortSignal.timeout(8000)}).then(async r=>{if(r.status!==200||(await r.json()).ok!==true)process.exitCode=1}).catch(()=>{process.exitCode=1})',timeout=15)
        return True
    except Exception:return False

def configure(revision,candidate_id,web_tag,web_id):
    global _proxy_identity
    tag=target(revision)
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',candidate_id):raise GateError('exact_candidate_image_id_required')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',web_id):raise GateError('exact_protected_web_image_id_required')
    if not re.fullmatch(r'flixify-ops-web:[A-Za-z0-9_.-]+',web_tag):raise GateError('exact_protected_web_image_tag_required')
    guard.REVISION,guard.CANDIDATE_ID=revision,candidate_id;guard.CHANGED=('api',);guard.PROTECTED=('db','worker','ops-web')
    guard.SOURCE={'api':SOURCE_TAG};guard.SOURCE_IDS={'api':SOURCE_ID};guard.TARGET={'api':tag};guard.PROTECTED_IMAGES={'worker':(WORKER_TAG,WORKER_ID),'ops-web':(web_tag,web_id)}
    guard.PHP_READ_APPLICATIONS=READ_APPLICATIONS_TEMPLATE.replace("['worker']","['api']");guard.protected_application_images=protected_application_images;guard.healthy=healthy
    guard.validate_plan=validate_plan;guard.expected_swapped=expected_swapped;guard.locked_image_swap=locked_image_swap;guard.PHP_APPLY=php_apply()
    guard.preflight=preflight;guard.verify_recreate_context=verify_recreate_context;guard.verify_recovery_context=verify_recovery_context
    _proxy_identity=None

def verify_proxy_peer(*,allow_missing_api=False):
    global _proxy_identity
    items=json.loads(guard.command('docker','inspect','coolify-proxy'))
    if len(items)!=1:raise GateError('trusted_proxy_inspection_invalid')
    proxy=items[0];labels=proxy['Config'].get('Labels') or {};network=(proxy.get('NetworkSettings',{}).get('Networks') or {}).get(guard.UUID,{})
    if (proxy['Image']!=PROXY_ID or proxy['Config']['Image']!=PROXY_TAG or not proxy['State']['Running'] or
        labels.get('coolify.managed')!='true' or labels.get('com.docker.compose.project')!='coolify-proxy' or
        network.get('NetworkID')!=PROXY_NETWORK_ID or network.get('IPAddress')!='10.0.2.4'):raise GateError('trusted_proxy_peer_drift')
    identity=(proxy['Id'],proxy['Image'],network['NetworkID'],network['IPAddress'])
    if _proxy_identity is not None and identity!=_proxy_identity:raise GateError('trusted_proxy_identity_changed')
    _proxy_identity=identity
    try:services=json.loads(guard.command('docker','inspect','api-'+guard.UUID))
    except GateError:
        if allow_missing_api:return
        raise
    if len(services)!=1 or services[0].get('Name')!='/api-'+guard.UUID:raise GateError('api_trusted_proxy_inspection_invalid')
    service=services[0];shared=(service.get('NetworkSettings',{}).get('Networks') or {}).get(guard.UUID,{})
    if shared.get('NetworkID')!=PROXY_NETWORK_ID:
        if allow_missing_api and not service.get('State',{}).get('Running') and not shared.get('NetworkID'):return
        raise GateError('api_trusted_proxy_network_differs')

def preflight(stage,*,recovering=False):
    verify_proxy_peer(allow_missing_api=recovering);result=ORIGINAL_PREFLIGHT(stage,recovering=recovering);verify_proxy_peer(allow_missing_api=recovering);return result
def verify_recreate_context(*args,**kwargs):
    expected=kwargs.get('expected',args[5] if len(args)>5 else None)
    verify_proxy_peer(allow_missing_api=expected==guard.SOURCE);ORIGINAL_RECREATE_CONTEXT(*args,**kwargs)
def verify_recovery_context(*args,**kwargs):
    verify_proxy_peer(allow_missing_api=True);ORIGINAL_RECOVERY_CONTEXT(*args,**kwargs)

def quiet_recreate(*args):
    with contextlib.redirect_stdout(io.StringIO()):guard.recreate(*args)
    print('api_recreated_healthy; worker_web_db_unchanged')
def quiet_rollback():
    with contextlib.redirect_stdout(io.StringIO()):guard.rollback()
    print('api_rolled_back_healthy; worker_web_db_unchanged')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision',required=True);parser.add_argument('--candidate-id',required=True)
    parser.add_argument('--protected-web-tag',required=True);parser.add_argument('--protected-web-id',required=True)
    actions=parser.add_mutually_exclusive_group();actions.add_argument('--apply',action='store_true');actions.add_argument('--recreate',action='store_true');actions.add_argument('--rollback',action='store_true')
    args=parser.parse_args();configure(args.revision,args.candidate_id,args.protected_web_tag,args.protected_web_id)
    if args.rollback:quiet_rollback();return
    if args.recreate:
        _,compose,env,before,raw,rendered=guard.preflight('target')
        try:quiet_recreate(before,compose,env,raw,rendered)
        except GateError as error:
            if str(error) in {'command_failed','command_unavailable'} or str(error).startswith(('new_container_unhealthy:','candidate_tag_drift:')):
                guard.verify_recovery_context(before,compose,env)
                try:quiet_rollback()
                except GateError as rollback_error:raise GateError('deploy_failed_and_rollback_failed:'+str(rollback_error)) from error
                raise GateError('deploy_failed_but_source_restored') from error
            raise
        return
    record,compose,env,before,raw,rendered=guard.preflight('source')
    if args.apply:
        guard.sync_images(record,compose,env,before,raw,rendered,guard.SOURCE,guard.TARGET)
        print('coolify_api_image_and_two_settings_synced; containers_not_restarted; env_file_unchanged')
    else:print('dry_run_ok; only_api_image_and_two_settings_would_change; no_mutation')

if __name__=='__main__':
    try:main()
    except GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError,guard.yaml.YAMLError) as error:print('release_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
