#!/usr/bin/env python3
"""WEB image-only login release; preserves API, all environment rows and .env bytes."""
from __future__ import annotations
import argparse, base64, fcntl, importlib.util, json, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('login_focus_build',HERE/'build.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
GateError=c.GateError
PHP_APPS=r'''function protectedApps($s){$out=[];foreach($s->applications()->where('name','!=','ops-web')->get() as $a)$out[$a->id]=$a->getAttributes();ksort($out);return hash('sha256',json_encode($out,JSON_THROW_ON_ERROR));}'''
PHP_MUTATE=PHP_APPS+r'''
$touched=false;$s=null;$original=null;
try{$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$result=Illuminate\Support\Facades\DB::transaction(function()use($p,&$s,&$touched,&$original){
 $s=App\Models\Service::where('uuid',$p['uuid'])->lockForUpdate()->firstOrFail();if($s->id!==1||hash('sha256',$s->docker_compose_raw)!==$p['rawSha']||hash('sha256',$s->docker_compose)!==$p['renderedSha'])throw new RuntimeException('source_model_drift');
 $rows=$s->environment_variables()->lockForUpdate()->get();if(unrelatedRows($rows,[])!==$p['otherModelsSha']||protectedApps($s)!==$p['protectedAppsSha'])throw new RuntimeException('protected_model_drift');
 $raw=Symfony\Component\Yaml\Yaml::parse($s->docker_compose_raw);$rendered=Symfony\Component\Yaml\Yaml::parse($s->docker_compose);$names=array_keys($raw['services']);sort($names);if($names!==['api','db','ops-web','worker']||array_keys($raw['services'])!==array_keys($rendered['services']))throw new RuntimeException('service_scope');
 foreach($p['protectedImages'] as $name=>$tag)if($raw['services'][$name]['image']!==$tag||$rendered['services'][$name]['image']!==$tag)throw new RuntimeException('protected_image_drift');
 $a=$s->applications()->where('name','ops-web')->firstOrFail();if($a->image!==$p['old']||$raw['services']['ops-web']['image']!==$p['old']||$rendered['services']['ops-web']['image']!==$p['old'])throw new RuntimeException('web_source_drift');
 $original=base64_decode($p['generatedBytes'],true);if(!is_string($original)||hash('sha256',$original)!==$p['generatedSha']||Symfony\Component\Yaml\Yaml::parse($original)!==$rendered)throw new RuntimeException('source_file_drift');
 $raw['services']['ops-web']['image']=$p['new'];$rendered['services']['ops-web']['image']=$p['new'];$s->docker_compose_raw=Symfony\Component\Yaml\Yaml::dump($raw,10,2);$s->docker_compose=Symfony\Component\Yaml\Yaml::dump($rendered,10,2);$a->image=$p['new'];
 if($p['action']==='apply'){$s->save();$a->save();}elseif($p['action']!=='preview')throw new RuntimeException('action');
 if(unrelatedRows($s->environment_variables()->get(),[])!==$p['otherModelsSha']||protectedApps($s)!==$p['protectedAppsSha'])throw new RuntimeException('protected_models_modified');
 if($p['action']==='apply'){$touched=true;instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$s->docker_compose);}
 return ['rawSha'=>hash('sha256',$s->docker_compose_raw),'renderedSha'=>hash('sha256',$s->docker_compose)];
},1);echo json_encode($result,JSON_THROW_ON_ERROR);}catch(Throwable $e){if($touched&&$s&&is_string($original)){try{instant_remote_write_file($s->server,$s->workdir().'/docker-compose.yml',$original);}catch(Throwable $ignored){}}fwrite(STDERR,'focus_web_metadata_transaction_failed');exit(1);}
'''

def state(r):
 value=r.coolify_state()
 script=r.PHP_BOOT+PHP_APPS+r'''try{$p=json_decode(stream_get_contents(STDIN),true);$s=App\Models\Service::where('uuid',$p['uuid'])->firstOrFail();if($s->id!==1)throw new RuntimeException('identity');echo json_encode(['protectedAppsSha'=>protectedApps($s)]);}catch(Throwable $e){exit(1);}'''
 value.update(r.php(script,{'uuid':r.b.UUID}));return value
def fingerprint(r,value):return {**r.state_fingerprint(value),'protectedAppsSha':value['protectedAppsSha']}
def require_models(r,value,web_tag):
 expected={'api':c.API[0],'ops-web':web_tag,'worker':r.b.WORKER[0],'db':r.b.DB[0]}
 for doc in ('raw','rendered','generated'):
  if any(value[doc]['services'][name]['image']!=tag for name,tag in expected.items()):raise GateError('current_model_image_drift')
 if any(value['applications'][name]!=tag for name,tag in expected.items() if name!='db'):raise GateError('application_image_drift')
def runtime_env(r,row):return r.b.protected_environment(r.runtime_env(row))
def mutate(r,current,old,new,action):
 data=r.COMPOSE.read_bytes()
 if c.sha(data)!=current['generatedSha'] or c.sha(r.ENV.read_bytes())!=current['envSha']:raise GateError('service_file_drift_before_web_metadata')
 payload={'uuid':r.b.UUID,'action':action,'rawSha':current['rawSha'],'renderedSha':current['renderedSha'],'otherModelsSha':current['otherModelsSha'],'protectedAppsSha':current['protectedAppsSha'],'generatedSha':current['generatedSha'],'generatedBytes':base64.b64encode(data).decode(),'old':old,'new':new,'protectedImages':{'api':c.API[0],'worker':r.b.WORKER[0],'db':r.b.DB[0]}}
 return r.php(r.PHP_BOOT+r.PHP_ENV+PHP_MUTATE,payload)
def apply(r,current,old,new):
 planned=mutate(r,current,old,new,'preview');actual=mutate(r,current,old,new,'apply');after=state(r)
 if planned!=actual or any(after[k]!=actual[k] for k in ('rawSha','renderedSha')) or after['generatedSha']!=actual['renderedSha'] or any(after[k]!=current[k] for k in ('modelEnvSha','otherModelsSha','envSha','protectedAppsSha')):raise GateError('web_metadata_postcheck_differs')
 require_models(r,after,new);return after
def current_web(r,proof):
 row=r.b.services(allow_changed_stopped=True)['ops-web']
 if (row['Config']['Image'],row['Image']) not in (c.WEB,(proof['candidateTag'],proof['candidateId'])):raise GateError('foreign_web_runtime')
 return row
def guarded_recreate(r,proof,journal,tag,identity):
 current=state(r)
 if fingerprint(r,current)!=journal['targetState'] or c.protected_snapshot(r)!=journal['protected']:raise GateError('protected_state_changed_before_web_recreate')
 require_models(r,current,tag);current_web(r,proof)
 if r.b.image_info(tag)['Id']!=identity:raise GateError('web_tag_retargeted_before_recreate')
 r.b.command('docker','compose','-p',r.b.UUID,'--project-directory',r.DIRECTORY,'-f',r.COMPOSE,'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','ops-web',timeout=180)
 r.healthy('ops-web',False)
 row=r.b.services()['ops-web']
 if row['Image']!=identity or row['Config']['Image']!=tag or c.sha(json.dumps(runtime_env(r,row),sort_keys=True).encode())!=journal['webRuntimeEnvSha'] or c.protected_snapshot(r)!=journal['protected'] or fingerprint(r,state(r))!=journal['targetState']:raise GateError('web_cutover_postcheck_failed')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--proof',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);actions=p.add_mutually_exclusive_group()
 for name in ('apply','recreate','rollback'):actions.add_argument('--'+name,action='store_true')
 a=p.parse_args();c.revision(a.revision)
 if a.manifest.read_bytes()!=c.git_blob(a.repo,a.revision,c.MANIFEST_PATH):raise GateError('manifest_must_match_exact_reviewed_commit')
 proof=json.loads(a.proof.read_text());entries=c.validate_manifest(json.loads(a.manifest.read_text()))
 if proof.get('revision')!=a.revision or proof.get('sourceHashes')!={x['path']:x['sha256'] for x in entries}:raise GateError('approved_login_payload_proof_differs')
 for item in entries:
  if c.sha(c.git_blob(a.repo,a.revision,item['path']))!=item['sha256']:raise GateError('committed_login_source_differs')
 with c.helpers(a.repo) as r:
  r.JOURNAL=r.DIRECTORY/'.login-focus-release.json';r.b.require_disk();c.validate_proof(r.b,proof)
  with (r.DIRECTORY/'.phone-login-release.lock').open('a+') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);outside=c.protected_snapshot(r);current=state(r)
   if a.recreate or a.rollback:
    journal=r.load_journal()
    if journal['revision']!=a.revision or journal['candidateId']!=proof['candidateId'] or outside!=journal['protected'] or fingerprint(r,current)!=journal['targetState']:raise GateError('release_journal_or_target_drift')
    if a.rollback:
     current_web(r,proof);after=apply(r,current,proof['candidateTag'],c.WEB[0]);journal['targetState']=fingerprint(r,after);r.save_journal(journal);guarded_recreate(r,proof,journal,*c.WEB);journal['phase']='rolled_back'
    else:
     if journal['phase']!='metadata_applied':raise GateError('metadata_apply_required')
     guarded_recreate(r,proof,journal,proof['candidateTag'],proof['candidateId']);journal['phase']='running'
    r.save_journal(journal)
   else:
    r.b.assert_source();require_models(r,current,c.WEB[0]);planned=mutate(r,current,c.WEB[0],proof['candidateTag'],'preview')
    if a.apply:
     if r.JOURNAL.exists():raise GateError('existing_focus_journal_requires_review')
     row=r.b.services()['ops-web'];after=apply(r,current,c.WEB[0],proof['candidateTag']);journal={'schemaVersion':1,'revision':a.revision,'phase':'metadata_applied','candidateId':proof['candidateId'],'targetState':fingerprint(r,after),'protected':outside,'webRuntimeEnvSha':c.sha(json.dumps(runtime_env(r,row),sort_keys=True).encode())};r.save_journal(journal)
    else:print(json.dumps({'state':'login_focus_release_preflight_verified','noMutation':True,'planned':planned}));return
   if c.protected_snapshot(r)!=outside:raise GateError('api_or_other_project_changed')
   print(json.dumps({'state':'login_focus_'+journal['phase']+'_verified','changed':['ops-web'],'apiRestarted':False,'environmentChanged':False}))

if __name__=='__main__':
 try:main()
 except Exception as e:print('login_focus_release_stopped:'+str(e) if isinstance(e,GateError) else 'login_focus_release_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
