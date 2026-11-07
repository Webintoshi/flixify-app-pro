#!/usr/bin/env python3
"""Phone/login rollout. Default validates only; explicit phases never restart worker/DB."""
from __future__ import annotations
import argparse,fcntl,hashlib,importlib.util,json,os,sys,time
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('phone_release_builder',HERE/'build-release.py');b=importlib.util.module_from_spec(spec);sys.modules[spec.name]=b;spec.loader.exec_module(b)
GateError=b.GateError
DIRECTORY=Path('/data/coolify/services')/b.UUID
COMPOSE=DIRECTORY/'docker-compose.yml';ENV=DIRECTORY/'.env';JOURNAL=DIRECTORY/'.phone-login-release.json'
PHP_BOOT=r'''require '/var/www/html/vendor/autoload.php';$app=require '/var/www/html/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();'''
PHP_ENV=r'''
function envMap($a){if(!is_array($a))throw new RuntimeException('env_shape');if(!array_is_list($a))return $a;$r=[];foreach($a as $e){[$k,$v]=array_pad(explode('=',$e,2),2,null);if(array_key_exists($k,$r))throw new RuntimeException('env_duplicate');$r[$k]=$v;}return $r;}
function canonical($a){if(is_array($a)){if(!array_is_list($a))ksort($a);foreach($a as $k=>$v)$a[$k]=canonical($v);}return $a;}
function unrelatedRows($rows,$keys){$out=[];foreach($rows as $row){if(!in_array($row->key,$keys,true))$out[$row->id]=$row->getAttributes();}ksort($out);return hash('sha256',json_encode($out));}
function generatedEnvironment($s,$compose,$rows){$lines=[];foreach(array_keys($compose['services']) as $n)$lines[]='SERVICE_NAME_'.strtoupper(str_replace(['-','.'],'_',$n)).'='.$n;$sorted=$rows->sortBy(function($e){if(str($e->key)->startsWith('SERVICE_'))return 1;if(str($e->value)->startsWith('$SERVICE_')||str($e->value)->startsWith('${SERVICE_'))return 2;return 3;});foreach($sorted as $e){if(!$e->preservesLegacyComposeNull()&&dockerComposeEnvironmentVariableShouldBeUnset($s->docker_compose_raw??$s->docker_compose,$e->key,$e->value))continue;$lines[]=$s->composeEnvironmentFileLine($e);}return implode("\n",$lines);}
function bindSettings(&$doc,$settings){$a=&$doc['services']['api']['environment'];$map=envMap($a);foreach($settings as $key=>$value){$ref='${'.$key.'}';if(isset($map[$key])&&$map[$key]!==$ref)throw new RuntimeException('existing_phone_binding');if(array_is_list($a)){if(!array_key_exists($key,$map))$a[]=$key.'='.$ref;}else{$a[$key]=$ref;}}}
'''
PHP_READ=PHP_BOOT+PHP_ENV+r'''
try{$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$s=App\Models\Service::where('uuid',$p['uuid'])->firstOrFail();if($s->id!==1)throw new RuntimeException('identity');$raw=Symfony\Component\Yaml\Yaml::parse($s->docker_compose_raw);$rendered=Symfony\Component\Yaml\Yaml::parse($s->docker_compose);$rows=$s->environment_variables()->get();$apps=[];foreach(['api','ops-web','worker'] as $n)$apps[$n]=$s->applications()->where('name',$n)->firstOrFail()->image;$file=Symfony\Component\Yaml\Yaml::parse(base64_decode($p['generated']));echo json_encode(['raw'=>$raw,'rendered'=>$rendered,'generated'=>$file,'rawSha'=>hash('sha256',$s->docker_compose_raw),'renderedSha'=>hash('sha256',$s->docker_compose),'modelEnvSha'=>hash('sha256',generatedEnvironment($s,$rendered,$rows)),'otherModelsSha'=>unrelatedRows($rows,$p['keys']),'applications'=>$apps],JSON_THROW_ON_ERROR);}catch(Throwable $e){fwrite(STDERR,'phone_metadata_read_failed');exit(1);}
'''
PHP_APPLY=PHP_BOOT+PHP_ENV+r'''
$p=null;$s=null;$touched=false;$oldCompose=null;$oldEnv=null;
try{$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$allowed=['PHONE_AUTH_ENABLED','PHONE_AUTH_LOCAL_ONLY','PHONE_AUTH_ALLOWED_ORIGINS','PHONE_AUTH_SECRET','PHONE_AUTH_PROVIDER_DIAGNOSTICS','VATANSMS_WHATSAPP_API_KEY','VATANSMS_WHATSAPP_REG_ID','VATANSMS_WHATSAPP_BASE_URL'];$keys=array_keys($p['settings']);sort($keys);$sorted=$allowed;sort($sorted);if($keys!==$sorted)throw new RuntimeException('setting_scope');
$result=Illuminate\Support\Facades\DB::transaction(function()use($p,$allowed,&$s,&$touched,&$oldCompose,&$oldEnv){
 $s=App\Models\Service::where('uuid',$p['uuid'])->lockForUpdate()->firstOrFail();if($s->id!==1||hash('sha256',$s->docker_compose_raw)!==$p['rawSha']||hash('sha256',$s->docker_compose)!==$p['renderedSha'])throw new RuntimeException('source_drift');
 $raw=Symfony\Component\Yaml\Yaml::parse($s->docker_compose_raw);$rendered=Symfony\Component\Yaml\Yaml::parse($s->docker_compose);$names=array_keys($raw['services']);sort($names);if($names!==['api','db','ops-web','worker']||array_keys($raw['services'])!==array_keys($rendered['services']))throw new RuntimeException('service_scope');
 $rows=$s->environment_variables()->lockForUpdate()->get();$futureRows=$rows->map(fn($e)=>clone $e);if(unrelatedRows($rows,$allowed)!==$p['otherModelsSha'])throw new RuntimeException('other_models_changed');$oldEnv=generatedEnvironment($s,$rendered,$rows);$oldCompose=$s->docker_compose;if(hash('sha256',$oldEnv)!==$p['envSha'])throw new RuntimeException('existing_env_drift');
 foreach(['api','ops-web'] as $name){if($raw['services'][$name]['image']!==$p['old'][$name]||$rendered['services'][$name]['image']!==$p['old'][$name]||$s->applications()->where('name',$name)->firstOrFail()->image!==$p['old'][$name])throw new RuntimeException('source_image_drift');$raw['services'][$name]['image']=$p['new'][$name];$rendered['services'][$name]['image']=$p['new'][$name];}
 bindSettings($raw,$p['settings']);bindSettings($rendered,$p['settings']);
 foreach($p['settings'] as $key=>$value){if(!is_string($value)||strlen($value)>2048||str_contains($value,"\n")||str_contains($value,"\r"))throw new RuntimeException('setting_value');$match=$futureRows->where('key',$key);if($match->count()>1)throw new RuntimeException('duplicate_phone_model');$e=$match->first()??new App\Models\EnvironmentVariable(['key'=>$key,'is_literal'=>true,'is_runtime'=>true,'is_buildtime'=>false,'is_required'=>true,'is_preview'=>false,'is_shown_once'=>true]);if(in_array($key,['PHONE_AUTH_SECRET','VATANSMS_WHATSAPP_API_KEY','VATANSMS_WHATSAPP_REG_ID'],true)&&$match->count()===1&&$e->value!==$value)throw new RuntimeException('stable_secret_or_sender_changed');$e->value=$value;$e->is_literal=true;$e->is_runtime=true;$e->is_buildtime=false;if($p['action']==='apply')$s->environment_variables()->save($e);if($match->count()===0)$futureRows->push($e);}
 $s->docker_compose_raw=Symfony\Component\Yaml\Yaml::dump($raw,10,2);$s->docker_compose=Symfony\Component\Yaml\Yaml::dump($rendered,10,2);if($p['action']==='apply')$s->save();foreach($p['new'] as $name=>$tag){$a=$s->applications()->where('name',$name)->firstOrFail();$a->image=$tag;if($p['action']==='apply')$a->save();}
 if(unrelatedRows($s->environment_variables()->get(),$allowed)!==$p['otherModelsSha'])throw new RuntimeException('unrelated_models_modified');
 $newEnv=generatedEnvironment($s,$rendered,$p['action']==='apply'?$s->environment_variables()->get():$futureRows);if($p['action']==='apply'){$touched=true;instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$s->docker_compose);instant_remote_write_file($s->server,$s->workdir().'/.env',$newEnv);}elseif($p['action']!=='preview')throw new RuntimeException('action');
 return ['rawSha'=>hash('sha256',$s->docker_compose_raw),'renderedSha'=>hash('sha256',$s->docker_compose),'envSha'=>hash('sha256',$newEnv)];
},1);echo json_encode($result,JSON_THROW_ON_ERROR);
}catch(Throwable $e){if($touched&&$s&&is_string($oldCompose)&&is_string($oldEnv)){try{instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$oldCompose);instant_remote_write_file($s->server,$s->workdir().'/.env',$oldEnv);}catch(Throwable $ignored){}}fwrite(STDERR,'phone_metadata_transaction_failed');exit(1);}
'''

def setting_hashes(settings):return {k:b.sha(v.encode()) for k,v in settings.items()}
def runtime_env(row):return dict(x.split('=',1) for x in row['Config'].get('Env',[]))
def php(script,payload):return json.loads(b.command('docker','exec','-i','coolify','php','-r',script,input_data=json.dumps(payload,separators=(',',':')).encode(),timeout=90))
def coolify_state():
 import base64
 if not COMPOSE.is_file() or COMPOSE.is_symlink() or not ENV.is_file() or ENV.is_symlink():raise GateError('regular_service_config_required')
 compose_data=COMPOSE.read_bytes();env_data=ENV.read_bytes()
 result=php(PHP_READ,{'uuid':b.UUID,'keys':sorted(b.SETTINGS),'generated':base64.b64encode(compose_data).decode()})
 if result['rendered']!=result['generated'] or result['modelEnvSha']!=b.sha(env_data):raise GateError('coolify_disk_model_or_environment_drift')
 result.update({'generatedSha':b.sha(compose_data),'envSha':b.sha(env_data)})
 for doc in (result['raw'],result['rendered'],result['generated']):
  if set(doc.get('services',{}))!=set(('api','ops-web','worker','db')):raise GateError('exact_flixify_service_set_required')
  for name,pin in [('worker',b.WORKER),('db',b.DB)]:
   if doc['services'][name].get('image')!=pin[0]:raise GateError('protected_compose_image_drift')
 return result

def state_fingerprint(value):return {k:value[k] for k in ('rawSha','renderedSha','modelEnvSha','otherModelsSha','generatedSha','envSha')}
def load_journal():
 try:return json.loads(JOURNAL.read_text())
 except (OSError,ValueError):raise GateError('release_journal_missing_or_invalid') from None

def save_journal(value):
 temp=JOURNAL.with_suffix('.writing');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(temp,JOURNAL)

def node_json(script,payload=None):
 args=['docker','exec']+(['-i'] if payload is not None else [])+['api-'+b.UUID,'node','-e',script]
 return json.loads(b.command(*args,input_data=None if payload is None else json.dumps(payload).encode(),timeout=100))

SCHEMA_CHECK=r'''const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await c.connect();try{const q=await c.query("select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity) tables,(select attnotnull from pg_attribute where attrelid='public.device_sessions'::regclass and attname='expires_at') required,(select count(*)::int from pg_constraint where conrelid='public.device_sessions'::regclass and pg_get_constraintdef(oid) like '%phone_otp%') checks",[['phone_auth_identities','phone_auth_challenges','phone_auth_rates','session_refresh_rotations']]);console.log(JSON.stringify(q.rows[0]));}finally{await c.end()}})().catch(()=>process.exit(1));'''
def schema_ready():
 try:x=node_json(SCHEMA_CHECK);return x=={'tables':4,'required':False,'checks':1}
 except GateError:return False

def migrate(repo,ref):
 migrations=[]
 for path in b.MIGRATIONS:
  sql=b.command('git','-C',repo,'show',ref+':'+path).decode();migrations.append({'path':path,'sql':sql,'sha256':b.sha(sql.encode())})
 script=r'''const fs=require('node:fs'),crypto=require('node:crypto'),{Client}=require('pg');(async()=>{const p=JSON.parse(fs.readFileSync(0,'utf8'));if(!Array.isArray(p)||p.length!==2||p.some(x=>crypto.createHash('sha256').update(x.sql).digest('hex')!==x.sha256))throw Error('input');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await c.connect();try{await c.query('begin');await c.query("set local lock_timeout='10s'");await c.query("set local statement_timeout='60s'");await c.query('select pg_advisory_xact_lock(7311072026)');for(const x of p)await c.query(x.sql);await c.query('commit');console.log(JSON.stringify({schemaApplied:true,migrations:2}));}catch(e){await c.query('rollback').catch(()=>{});throw e}finally{await c.end()}})().catch(()=>process.exit(1));'''
 result=node_json(script,migrations)
 if result!={'schemaApplied':True,'migrations':2} or not schema_ready():raise GateError('schema_postcheck_failed')
 return result

def guarded_schema(repo,ref,outside):
 b.assert_source();result=migrate(repo,ref)
 if b.outside_snapshot()!=outside:raise GateError('protected_container_changed_during_schema')
 return result

def backfill(repo,ref,proof):
 rows=b.services()
 if rows['api']['Image']!=proof['candidateId']:raise GateError('new_api_required_before_backfill')
 listed=json.loads(b.command('docker','inspect',*b.command('docker','ps','-q','--filter','label=com.docker.compose.project='+b.UUID,'--filter','label=com.docker.compose.service=api').decode().split()))
 if len(listed)!=1 or listed[0]['Image']!=proof['candidateId']:raise GateError('all_api_instances_must_be_nullable_aware')
 sql=b.command('git','-C',repo,'show',ref+':'+b.BACKFILL).decode()
 expected="update public.device_sessions set expires_at=null\nwhere revoked_at is null and expires_at>clock_timestamp();"
 if expected not in sql or sql.count('update public.device_sessions')!=1:raise GateError('reviewed_backfill_sql_required')
 script=r'''const fs=require('node:fs'),{Client}=require('pg');(async()=>{const p=JSON.parse(fs.readFileSync(0,'utf8'));const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await c.connect();try{await c.query('begin');await c.query("set local lock_timeout='10s'");await c.query("set local statement_timeout='60s'");await c.query('select pg_advisory_xact_lock(7311072026)');const r=await c.query(p.sql);await c.query('commit');console.log(JSON.stringify({backfillApplied:true,changedRows:r.rowCount}));}catch(e){await c.query('rollback').catch(()=>{});throw e}finally{await c.end()}})().catch(()=>process.exit(1));'''
 return node_json(script,{'sql':sql})

def exact_runtime(settings,proofs,disabled=False):
 rows=b.services()
 for name,proof in proofs.items():
  expected=b.SOURCES['ops-web'][1] if disabled and name=='ops-web' else proof['candidateId']
  if rows[name]['Image']!=expected:raise GateError('running_candidate_identity_differs:'+name)
 actual=runtime_env(rows['api'])
 if any(actual.get(k)!=v for k,v in settings.items()):raise GateError('running_phone_environment_differs')
 return rows

def healthy(name,phone_enabled):
 port=4000 if name=='api' else 3000
 paths=['/health','/auth/phone/status'] if name=='api' else ['/giris-yap','/kayit-ol','/indir','/paketler','/']
 script=r'''(async()=>{for(const p of PATHS){const r=await fetch('http://127.0.0.1:PORT'+p,{redirect:'manual',signal:AbortSignal.timeout(8000)});if(r.status!==200)throw Error('status');if(p==='/auth/phone/status'){const x=await r.json();if(x.nativePhoneLogin!==true||x.enabled!==ENABLED)throw Error('phone')}}console.log(JSON.stringify({ok:true}))})().catch(()=>process.exit(1));'''.replace('PATHS',json.dumps(paths)).replace('PORT',str(port)).replace('ENABLED','true' if phone_enabled else 'false')
 for _ in range(30):
  try:
   if json.loads(b.command('docker','exec',name+'-'+b.UUID,'node','-e',script,timeout=60))=={'ok':True}:return
  except (GateError,ValueError):pass
  time.sleep(1)
 raise GateError('candidate_not_healthy:'+name)

def recreate(name):
 b.command('docker','compose','-p',b.UUID,'--project-directory',str(DIRECTORY),'-f',str(COMPOSE),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate',name,timeout=180)

def guarded_recreate(name,expected_state,targets,settings,outside,*,proofs,protected,require_new_api=False):
 rows=b.services(allow_changed_stopped=True)
 for service,proof in proofs.items():
  actual=(rows[service]['Config']['Image'],rows[service]['Image'])
  if actual not in (b.SOURCES[service],(proof['candidateTag'],proof['candidateId'])):raise GateError('foreign_running_image_before_recreate:'+service)
 for service,pin in [('worker',b.WORKER),('db',b.DB)]:
  if (rows[service]['Config']['Image'],rows[service]['Image'])!=pin:raise GateError('protected_running_image_drift:'+service)
 if require_new_api:
  api_tag,api_id=targets['api'];actual=runtime_env(rows['api'])
  if not rows['api']['State']['Running'] or rows['api']['Image']!=api_id or rows['api']['Config']['Image']!=api_tag or any(actual.get(k)!=v for k,v in settings.items()):raise GateError('exact_new_api_required_before_web')
  if b.sha(json.dumps(b.protected_environment(actual),sort_keys=True).encode())!=protected['api']:raise GateError('unrelated_api_environment_changed_before_web')
 if b.outside_snapshot()!=outside:raise GateError('protected_container_changed_before_recreate')
 state=coolify_state()
 if state_fingerprint(state)!=expected_state:raise GateError('metadata_or_environment_changed_before_recreate')
 for service,(tag,identity) in targets.items():
  if any(state[document]['services'][service].get('image')!=tag for document in ('raw','rendered','generated')) or state['applications'].get(service)!=tag:raise GateError('target_metadata_image_changed:'+service)
  if b.image_info(tag)['Id']!=identity:raise GateError('target_tag_retargeted_before_recreate:'+service)
 recreate(name)

def preview_metadata(state,old,new,settings):
 return php(PHP_APPLY,{'uuid':b.UUID,'action':'preview','rawSha':state['rawSha'],'renderedSha':state['renderedSha'],'otherModelsSha':state['otherModelsSha'],'envSha':b.sha(ENV.read_bytes()),'old':old,'new':new,'settings':settings})

def apply_metadata(state,old,new,settings):
 old_rows=b.services(allow_changed_stopped=True);protected={k:b.protected_environment(runtime_env(v)) for k,v in old_rows.items() if k in ('api','ops-web')}
 planned=preview_metadata(state,old,new,settings)
 result=php(PHP_APPLY,{'uuid':b.UUID,'action':'apply','rawSha':state['rawSha'],'renderedSha':state['renderedSha'],'otherModelsSha':state['otherModelsSha'],'envSha':b.sha(ENV.read_bytes()),'old':old,'new':new,'settings':settings})
 after=coolify_state()
 if result!=planned or after['rawSha']!=result['rawSha'] or after['renderedSha']!=result['renderedSha'] or b.sha(ENV.read_bytes())!=result['envSha'] or after['otherModelsSha']!=state['otherModelsSha']:raise GateError('metadata_postcheck_differs')
 return after,protected

def delivery_proof(path,enabled):
 if not enabled:return
 if path is None:raise GateError('live_provider_acceptance_proof_required_before_enabling_phone')
 value=json.loads(Path(path).read_text())
 if value.get('schemaVersion')!=1 or value.get('deliveryAccepted') is not True or not isinstance(value.get('checkedAt'),str):raise GateError('actual_delivery_acceptance_not_verified')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--api-proof',type=Path,required=True);p.add_argument('--web-proof',type=Path,required=True);p.add_argument('--private-env',type=Path,required=True);p.add_argument('--delivery-proof',type=Path)
 actions=p.add_mutually_exclusive_group()
 for action in ('schema','apply','recreate','backfill','disable-phone'):actions.add_argument('--'+action,action='store_true')
 a=p.parse_args();b.revision(a.revision);proofs={'api':json.loads(a.api_proof.read_text()),'ops-web':json.loads(a.web_proof.read_text())}
 for key,proof in proofs.items():
  if proof['service']!=key or proof['revision']!=a.revision:raise GateError('same_exact_release_revision_required')
  b.verify_candidate(proof)
 settings=b.private_settings(a.private_env);current=b.services(allow_changed_stopped=a.disable_phone or a.recreate);b.validate_settings(settings,runtime_env(current['api']))
 for name,pin in [('worker',b.WORKER),('db',b.DB)]:
  if (current[name]['Config']['Image'],current[name]['Image'])!=pin:raise GateError('protected_running_image_drift:'+name)
 if not a.disable_phone:delivery_proof(a.delivery_proof,settings['PHONE_AUTH_ENABLED']=='true')
 b.require_disk();lock=DIRECTORY/'.phone-login-release.lock'
 with lock.open('a+') as f:
  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  outside=b.outside_snapshot();state=coolify_state()
  if a.schema:
   result=guarded_schema(a.repo,a.revision,outside);print(json.dumps(result));return
  if a.apply:
   b.assert_source()
   if not schema_ready():raise GateError('additive_schema_required_before_api')
   old={k:v[0] for k,v in b.SOURCES.items()};new={k:v['candidateTag'] for k,v in proofs.items()}
   after,protected=apply_metadata(state,old,new,settings)
   journal={'schemaVersion':1,'revision':a.revision,'phase':'metadata_applied','candidates':{k:v['candidateId'] for k,v in proofs.items()},'targetState':state_fingerprint(after),'protectedEnvironment':{k:b.sha(json.dumps(v,sort_keys=True).encode()) for k,v in protected.items()},'settings':setting_hashes(settings),'outside':outside,'backfillApplied':False}
   save_journal(journal)
  elif a.recreate:
   journal=load_journal()
   if journal['revision']!=a.revision or journal['phase']!='metadata_applied' or state_fingerprint(state)!=journal['targetState'] or journal['settings']!=setting_hashes(settings) or outside!=journal['outside']:raise GateError('applied_state_drift')
   targets={k:(v['candidateTag'],v['candidateId']) for k,v in proofs.items()}
   for name in ('api','ops-web'):
    guarded_recreate(name,journal['targetState'],targets,settings,outside,proofs=proofs,protected=journal['protectedEnvironment'],require_new_api=name=='ops-web');healthy(name,settings['PHONE_AUTH_ENABLED']=='true')
    if b.outside_snapshot()!=outside:raise GateError('protected_container_changed')
   rows=exact_runtime(settings,proofs)
   for name in ('api','ops-web'):
    if b.sha(json.dumps(b.protected_environment(runtime_env(rows[name])),sort_keys=True).encode())!=journal['protectedEnvironment'][name]:raise GateError('unrelated_runtime_environment_changed')
   journal['phase']='running';save_journal(journal)
  elif a.backfill:
   journal=load_journal()
   if journal['revision']!=a.revision or journal['phase']!='running' or state_fingerprint(state)!=journal['targetState']:raise GateError('healthy_new_api_cutover_required')
   exact_runtime(settings,proofs);healthy('api',settings['PHONE_AUTH_ENABLED']=='true');result=backfill(a.repo,a.revision,proofs['api']);journal['backfillApplied']=True;journal['backfillRows']=result.get('changedRows');save_journal(journal)
  elif a.disable_phone:
   journal=load_journal()
   if journal['revision']!=a.revision:raise GateError('same_nullable_aware_release_required')
   current=b.services(allow_changed_stopped=True)
   if current['api']['Image']!=proofs['api']['candidateId']:raise GateError('unsafe_old_api_rollback_forbidden')
   settings['PHONE_AUTH_ENABLED']='false';old={k:current[k]['Config']['Image'] for k in ('api','ops-web')};new={'api':proofs['api']['candidateTag'],'ops-web':b.SOURCES['ops-web'][0]}
   after,protected=apply_metadata(state,old,new,settings);protected={k:b.sha(json.dumps(v,sort_keys=True).encode()) for k,v in protected.items()};expected_state=state_fingerprint(after);targets={'api':(proofs['api']['candidateTag'],proofs['api']['candidateId']),'ops-web':b.SOURCES['ops-web']}
   guarded_recreate('api',expected_state,targets,settings,outside,proofs=proofs,protected=protected);healthy('api',False);guarded_recreate('ops-web',expected_state,targets,settings,outside,proofs=proofs,protected=protected,require_new_api=True);healthy('ops-web',False);exact_runtime(settings,proofs,disabled=True)
   journal.update({'phase':'phone_disabled_compatible_api_retained','settings':setting_hashes(settings),'targetState':state_fingerprint(after)});save_journal(journal)
  else:
   b.assert_source()
   preview_metadata(state,{k:v[0] for k,v in b.SOURCES.items()},{k:v['candidateTag'] for k,v in proofs.items()},settings)
   print(json.dumps({'state':'phone_login_release_preflight_verified','schemaReady':schema_ready(),'enabled':settings['PHONE_AUTH_ENABLED']=='true','noMutation':True}));return
  if b.outside_snapshot()!=outside:raise GateError('protected_worker_db_or_other_project_changed')
  print(json.dumps({'state':'phone_login_'+('schema' if a.schema else 'apply' if a.apply else 'recreate' if a.recreate else 'backfill' if a.backfill else 'phone_disabled')+'_verified','changed':['api','ops-web'],'oldApiRollbackAllowed':False}))

if __name__=='__main__':
 try:main()
 except (GateError,OSError,ValueError,KeyError,TypeError) as e:print('phone_login_release_stopped:'+str(e) if isinstance(e,GateError) else 'phone_login_release_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
