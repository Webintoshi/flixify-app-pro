#!/usr/bin/env python3
"""Add nullable provenance, publish API/WEB; never roll back to open anonymous signup."""
import argparse,base64,fcntl,importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('whatsapp_only_build',Path(__file__).with_name('build.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
PHP_PROTECT=r'''function protectedApps($s){$out=[];foreach($s->applications()->whereNotIn('name',['api','ops-web'])->get() as $a)$out[$a->id]=$a->getAttributes();ksort($out);return hash('sha256',json_encode($out,JSON_THROW_ON_ERROR));}'''
PHP_MUTATE=PHP_PROTECT+r'''
$touched=false;$s=null;$original=null;
try{$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$result=Illuminate\Support\Facades\DB::transaction(function()use($p,&$s,&$touched,&$original){
 if(array_keys($p['old'])!==['api','ops-web']||array_keys($p['new'])!==['api','ops-web'])throw new RuntimeException('two_image_scope');
 $s=App\Models\Service::where('uuid',$p['uuid'])->lockForUpdate()->firstOrFail();if($s->id!==1||hash('sha256',$s->docker_compose_raw)!==$p['rawSha']||hash('sha256',$s->docker_compose)!==$p['renderedSha'])throw new RuntimeException('source_drift');
 $rows=$s->environment_variables()->lockForUpdate()->get();if(unrelatedRows($rows,[])!==$p['otherModelsSha']||protectedApps($s)!==$p['protectedAppsSha'])throw new RuntimeException('protected_models_drift');
 $raw=Symfony\Component\Yaml\Yaml::parse($s->docker_compose_raw);$rendered=Symfony\Component\Yaml\Yaml::parse($s->docker_compose);$names=array_keys($raw['services']);sort($names);if($names!==['api','db','ops-web','worker']||array_keys($raw['services'])!==array_keys($rendered['services']))throw new RuntimeException('service_scope');
 foreach($p['protectedImages'] as $name=>$tag)if($raw['services'][$name]['image']!==$tag||$rendered['services'][$name]['image']!==$tag)throw new RuntimeException('protected_image_drift');
 $original=base64_decode($p['generatedBytes'],true);if(!is_string($original)||hash('sha256',$original)!==$p['generatedSha']||Symfony\Component\Yaml\Yaml::parse($original)!==$rendered)throw new RuntimeException('source_file_drift');
 $apps=[];foreach($p['old'] as $name=>$tag){$a=$s->applications()->where('name',$name)->firstOrFail();if($a->image!==$tag||$raw['services'][$name]['image']!==$tag||$rendered['services'][$name]['image']!==$tag)throw new RuntimeException('source_application_drift');$raw['services'][$name]['image']=$p['new'][$name];$rendered['services'][$name]['image']=$p['new'][$name];$a->image=$p['new'][$name];$apps[]=$a;}
 $s->docker_compose_raw=Symfony\Component\Yaml\Yaml::dump($raw,10,2);$s->docker_compose=Symfony\Component\Yaml\Yaml::dump($rendered,10,2);
 if($p['action']==='apply'){$s->save();foreach($apps as $a)$a->save();}elseif($p['action']!=='preview')throw new RuntimeException('action');
 if(unrelatedRows($s->environment_variables()->get(),[])!==$p['otherModelsSha']||protectedApps($s)!==$p['protectedAppsSha'])throw new RuntimeException('protected_models_modified');
 if($p['action']==='apply'){$touched=true;instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$s->docker_compose);}
 return ['rawSha'=>hash('sha256',$s->docker_compose_raw),'renderedSha'=>hash('sha256',$s->docker_compose)];
},1);echo json_encode($result,JSON_THROW_ON_ERROR);}catch(Throwable $e){if($touched&&$s&&is_string($original)){try{instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$original);}catch(Throwable $ignored){}}fwrite(STDERR,'whatsapp_only_metadata_transaction_failed');exit(1);}
'''
def state(r):
 value=r.coolify_state();value.update(r.php(r.PHP_BOOT+PHP_PROTECT+r'''$p=json_decode(stream_get_contents(STDIN),true);$s=App\Models\Service::where('uuid',$p['uuid'])->firstOrFail();if($s->id!==1)exit(1);echo json_encode(['protectedAppsSha'=>protectedApps($s)]);''',{'uuid':r.b.UUID}));return value
def fingerprint(r,value):return {**r.state_fingerprint(value),'protectedAppsSha':value['protectedAppsSha']}
def require_models(r,value,images):
 expected={**images,'worker':r.b.WORKER[0],'db':r.b.DB[0]}
 if any(value[doc]['services'][name]['image']!=tag for doc in ('raw','rendered','generated') for name,tag in expected.items()) or any(value['applications'][name]!=tag for name,tag in expected.items() if name!='db'):raise c.GateError('metadata_image_drift')
def mutate(r,current,old,new,action):
 data=r.COMPOSE.read_bytes()
 if c.sha(data)!=current['generatedSha'] or c.sha(r.ENV.read_bytes())!=current['envSha']:raise c.GateError('source_service_files_changed')
 payload={'uuid':r.b.UUID,'action':action,'rawSha':current['rawSha'],'renderedSha':current['renderedSha'],'generatedSha':current['generatedSha'],'generatedBytes':base64.b64encode(data).decode(),'otherModelsSha':current['otherModelsSha'],'protectedAppsSha':current['protectedAppsSha'],'old':old,'new':new,'protectedImages':{'worker':r.b.WORKER[0],'db':r.b.DB[0]}}
 return r.php(r.PHP_BOOT+r.PHP_ENV+PHP_MUTATE,payload)
def apply(r,current,old,new):
 planned=mutate(r,current,old,new,'preview');actual=mutate(r,current,old,new,'apply');after=state(r)
 if planned!=actual or any(after[k]!=actual[k] for k in ('rawSha','renderedSha')) or after['generatedSha']!=actual['renderedSha'] or any(after[k]!=current[k] for k in ('modelEnvSha','envSha','otherModelsSha','protectedAppsSha')):raise c.GateError('metadata_postcheck_differs')
 require_models(r,after,new);return after
def env_hash(r,row):return c.sha(json.dumps(r.b.protected_environment(r.runtime_env(row)),sort_keys=True).encode())
def schema_ready(r):
 script=r'''const{Client}=require('pg');(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await db.connect();try{const q=await db.query("select attname,atttypid='text'::regtype as text,attnotnull,atthasdef,attgenerated,attidentity from pg_attribute where attrelid='public.users'::regclass and attname=any($1::text[]) and not attisdropped",[['registration_method','registration_platform']]);const names=['users_registration_method_check','users_registration_platform_check'];const k=await db.query('select conname,convalidated,pg_get_expr(conbin,conrelid) expression from pg_constraint where conrelid=\'public.users\'::regclass and conname=any($1::text[]) and contype=\'c\'',[names]);const expected={users_registration_method_check:"(registration_method = ANY (ARRAY['phone_otp'::text, 'account_code'::text]))",users_registration_platform_check:"(registration_platform = ANY (ARRAY['web'::text, 'android_tv'::text, 'android_phone'::text, 'macos'::text, 'windows'::text]))"};const norm=x=>x.replace(/\s/g,'');console.log(JSON.stringify({ready:q.rows.length===2&&q.rows.every(x=>x.text&&!x.attnotnull&&!x.atthasdef&&!x.attgenerated&&!x.attidentity)&&k.rows.length===2&&k.rows.every(x=>x.convalidated&&norm(x.expression)===norm(expected[x.conname]||''))}));}finally{await db.end();}})().catch(()=>process.exit(1));'''
 try:return r.node_json(script)=={'ready':True}
 except r.b.GateError:return False
def migrate(r,repo,ref,manifest):
 sql=c.blob(repo,ref,c.MIGRATION)
 if c.sha(sql)!=manifest['migration']['sha256']:raise c.GateError('migration_hash_changed')
 script=r'''const fs=require('node:fs'),{Client}=require('pg');(async()=>{const p=JSON.parse(fs.readFileSync(0,'utf8')),db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await db.connect();try{await db.query('begin');await db.query("set local lock_timeout='10s'");await db.query("set local statement_timeout='60s'");await db.query('select pg_advisory_xact_lock(7311082026)');await db.query(p.sql);await db.query('commit');console.log(JSON.stringify({schemaApplied:true,migrations:1}));}catch(e){await db.query('rollback').catch(()=>{});throw e;}finally{await db.end();}})().catch(()=>process.exit(1));'''
 result=r.node_json(script,{'sql':sql.decode()})
 if result!={'schemaApplied':True,'migrations':1} or not schema_ready(r):raise c.GateError('nullable_provenance_schema_postcheck_failed')
 return result
def guarded_recreate(r,name,proofs,journal,targets):
 current=state(r);rows=r.b.services(allow_changed_stopped=True)
 if fingerprint(r,current)!=journal['targetState'] or c.protected_snapshot(r.b)!=journal['protected']:raise c.GateError('protected_state_drift_before_recreate')
 require_models(r,current,{k:v[0] for k,v in targets.items()})
 for key,proof in proofs.items():
  if (rows[key]['Config']['Image'],rows[key]['Image']) not in (c.SOURCES[key],(proof['candidateTag'],proof['candidateId'])):raise c.GateError('foreign_api_or_web_runtime')
 for key,(tag,identity) in targets.items():
  if r.b.image_info(tag)['Id']!=identity:raise c.GateError('candidate_tag_retargeted')
 if name=='ops-web':
  if not rows['api']['State']['Running'] or rows['api']['Image']!=proofs['api']['candidateId'] or env_hash(r,rows['api'])!=journal['runtimeEnvs']['api']:raise c.GateError('policy_closed_api_required_before_web')
  c.policy_check(r.b,'api-'+r.b.UUID)
 r.recreate(name);r.healthy(name,r.runtime_env(rows['api']).get('PHONE_AUTH_ENABLED')=='true')
 after=r.b.services()[name]
 if (after['Config']['Image'],after['Image'])!=targets[name] or env_hash(r,after)!=journal['runtimeEnvs'][name] or c.protected_snapshot(r.b)!=journal['protected'] or fingerprint(r,state(r))!=journal['targetState']:raise c.GateError('cutover_postcheck_failed')
 if name=='api':c.policy_check(r.b,'api-'+r.b.UUID)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--api-proof',type=Path,required=True);p.add_argument('--web-proof',type=Path,required=True);actions=p.add_mutually_exclusive_group()
 for name in ('schema','apply','recreate','rollback-web'):actions.add_argument('--'+name,action='store_true')
 a=p.parse_args();c.revision(a.revision)
 if a.manifest.read_bytes()!=c.blob(a.repo,a.revision,c.MANIFEST_PATH):raise c.GateError('manifest_not_committed_exactly')
 manifest=c.validate_manifest(json.loads(a.manifest.read_text()));proofs={'api':json.loads(a.api_proof.read_text()),'ops-web':json.loads(a.web_proof.read_text())}
 patcher=c.load('whatsapp_release_actual_patcher',Path(__file__).with_name('patch-api.py'));recipe_bytes=c.blob(a.repo,a.revision,'coolify/releases/2026-11-08-whatsapp-only/api-edits.json')
 if c.sha(recipe_bytes)!=patcher.RECIPE_SHA256:raise c.GateError('reviewed_api_recipe_digest_required')
 recipe=json.loads(recipe_bytes)
 if proofs['api'].get('sourceHashes')!={p:x['after'] for p,x in recipe['existing'].items()} or proofs['ops-web'].get('sourceHashes')!={x['path']:x['sha256'] for x in manifest['webFiles']}:raise c.GateError('candidate_sources_not_exact_reviewed_payload')
 with c.helpers(a.repo) as r:
  r.JOURNAL=r.DIRECTORY/'.whatsapp-only-release.json';r.b.require_disk()
  for key,proof in proofs.items():
   if proof['service']!=key or proof['revision']!=a.revision:raise c.GateError('matching_policy_release_proofs_required')
   c.verify_proof(r.b,proof)
  with (r.DIRECTORY/'.phone-login-release.lock').open('a+') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);outside=c.protected_snapshot(r.b);current=state(r)
   if a.schema:
    r.b.assert_source()
    if outside[c.BOT_FILE_KEY]['sha256']!=c.BOT_SOURCE:raise c.GateError('original_bot_required_before_schema')
    result=migrate(r,a.repo,a.revision,manifest)
    if c.protected_snapshot(r.b)!=outside:raise c.GateError('protected_container_changed_during_schema')
    print(json.dumps(result));return
   if a.apply or not (a.recreate or a.rollback_web):
    rows=r.b.assert_source();old={k:v[0] for k,v in c.SOURCES.items()};new={k:v['candidateTag'] for k,v in proofs.items()};require_models(r,current,old);planned=mutate(r,current,old,new,'preview')
    if outside[c.BOT_FILE_KEY]['sha256']!=c.BOT_SOURCE:raise c.GateError('original_bot_required_before_api_policy_cutover')
    if not a.apply:print(json.dumps({'state':'whatsapp_only_release_preflight_verified','schemaReady':schema_ready(r),'noMutation':True,'planned':planned}));return
    if not schema_ready(r) or r.JOURNAL.exists():raise c.GateError('schema_required_or_existing_journal_needs_review')
    after=apply(r,current,old,new);journal={'schemaVersion':1,'revision':a.revision,'phase':'metadata_applied','candidateIds':{k:v['candidateId'] for k,v in proofs.items()},'targetState':fingerprint(r,after),'protected':outside,'runtimeEnvs':{k:env_hash(r,rows[k]) for k in c.SOURCES},'legacySignupRollbackAllowed':False};r.save_journal(journal)
   else:
    journal=r.load_journal()
    if journal['revision']!=a.revision or journal['candidateIds']!={k:v['candidateId'] for k,v in proofs.items()} or fingerprint(r,current)!=journal['targetState'] or outside!=journal['protected']:raise c.GateError('journal_target_or_protected_state_drift')
    targets={k:(v['candidateTag'],v['candidateId']) for k,v in proofs.items()}
    if a.rollback_web:
     rows=r.b.services(allow_changed_stopped=True)
     if rows['api']['Image']!=proofs['api']['candidateId']:raise c.GateError('closed_api_required_no_anonymous_api_rollback')
     old={k:v[0] for k,v in targets.items()};targets['ops-web']=c.WEB;after=apply(r,current,old,{k:v[0] for k,v in targets.items()});journal['targetState']=fingerprint(r,after);r.save_journal(journal);guarded_recreate(r,'ops-web',proofs,journal,targets);journal['phase']='web_rolled_back_closed_api_retained'
    else:
     if journal['phase']!='metadata_applied':raise c.GateError('metadata_apply_required')
     for name in ('api','ops-web'):guarded_recreate(r,name,proofs,journal,targets)
     journal['phase']='running'
    r.save_journal(journal)
   if c.protected_snapshot(r.b)!=outside:raise c.GateError('protected_project_changed')
   print(json.dumps({'state':'whatsapp_only_'+journal['phase']+'_verified','legacySignupRollbackAllowed':False,'settingsChanged':False}))
if __name__=='__main__':
 try:main()
 except Exception as e:print('whatsapp_only_release_stopped:'+str(e) if isinstance(e,c.GateError) else 'whatsapp_only_release_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
