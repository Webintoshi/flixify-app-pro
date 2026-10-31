#!/usr/bin/env python3
"""API-only cutover with permanent registration claims; read-only by default."""
from __future__ import annotations
import argparse,base64,contextlib,fcntl,hashlib,importlib.util,io,json,os,re,sys
from pathlib import Path

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
prior=load('permanent_registration_prior',Path(__file__).parents[1]/'2026-10-30-trial-capacity'/'release-api.py')
builder=load('permanent_registration_builder',Path(__file__).with_name('build-api.py'))
guard,GateError=prior.guard,prior.GateError
SOURCE_TAG,SOURCE_ID=builder.SOURCE_TAG,builder.SOURCE_ID
GUARD_KEY='REGISTRATION_GUARD_SECRET'
GUARD_REF='${REGISTRATION_GUARD_SECRET}'
TRUSTED='10.0.2.4/32,127.0.0.1/32,::1/128'
MIGRATIONS=('supabase/migrations/202610310001_registration_lifetime_limits.sql','supabase/migrations/202610310002_live_channel_exclusions.sql')
FENCE=guard.DIRECTORY/'.live-registration-rollout.json'

PHP_FUNCTIONS=r'''
function envMap($environment) {
    if (!is_array($environment)) { throw new RuntimeException('environment shape'); }
    if (!array_is_list($environment)) { return $environment; }
    $result=[];
    foreach ($environment as $entry) {
        if (!is_string($entry)) { throw new RuntimeException('environment entry'); }
        [$key,$value]=array_pad(explode('=',$entry,2),2,null);
        if (array_key_exists($key,$result)) { throw new RuntimeException('environment duplicate'); }
        $result[$key]=$value;
    }
    return $result;
}
function updateEnvironment(&$document,$target) {
    $environment =& $document['services']['api']['environment'];
    $map=envMap($environment);
    if (($map['TRUSTED_PROXY_CIDRS']??null)!=='10.0.2.4/32,127.0.0.1/32,::1/128' ||
        ($map['AUTO_TRIAL_DAILY_IP_LIMIT']??null)!=='1000' || array_key_exists('REGISTRATION_GUARD_SECRET',$map)) {
        throw new RuntimeException('environment drift');
    }
    if (array_is_list($environment)) {
        foreach ($environment as &$entry) {
            if (str_starts_with($entry,'AUTO_TRIAL_DAILY_IP_LIMIT=')) { $entry='AUTO_TRIAL_DAILY_IP_LIMIT=2'; }
        }
        unset($entry);
        $environment[]='REGISTRATION_GUARD_SECRET=${REGISTRATION_GUARD_SECRET}';
    } else {
        $environment['AUTO_TRIAL_DAILY_IP_LIMIT']='2';
        $environment['REGISTRATION_GUARD_SECRET']='${REGISTRATION_GUARD_SECRET}';
    }
    $document['services']['api']['image']=$target;
}
function generatedEnvironment($service,$compose,$rows) {
    $lines=[];
    foreach (array_keys($compose['services']) as $name) { $lines[]='SERVICE_NAME_'.strtoupper(str_replace(['-','.'],'_',$name)).'='.$name; }
    $sorted=$rows->sortBy(function($env) {
        if (str($env->key)->startsWith('SERVICE_')) { return 1; }
        if (str($env->value)->startsWith('$SERVICE_') || str($env->value)->startsWith('${SERVICE_')) { return 2; }
        return 3;
    });
    foreach ($sorted as $env) {
        if (!$env->preservesLegacyComposeNull() && dockerComposeEnvironmentVariableShouldBeUnset($service->docker_compose_raw??$service->docker_compose,$env->key,$env->value)) { continue; }
        $lines[]=$service->composeEnvironmentFileLine($env);
    }
    return implode("\n",$lines);
}
'''

PHP_METADATA=r'''
use App\Models\Service;
use App\Models\EnvironmentVariable;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Yaml\Yaml;
''' + PHP_FUNCTIONS + r'''
$phase='bootstrap';
try {
    require '/var/www/html/vendor/autoload.php';
    $app=require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
    $result=DB::transaction(function()use($p,&$phase){
        $phase='service_lock';
        $s=Service::where('uuid',$p['uuid'])->lockForUpdate()->firstOrFail();
        if ($s->id!==1) { throw new RuntimeException('identity'); }
        foreach($p['protected'] as $name=>$tag){if($s->applications()->where('name',$name)->firstOrFail()->image!==$tag){throw new RuntimeException('protected drift');}}
        $raw=Yaml::parse($s->docker_compose_raw);$rendered=Yaml::parse($s->docker_compose);
        $map=envMap($raw['services']['api']['environment']);$other=envMap($rendered['services']['api']['environment']);
        $secret=$map['APP_JWT_SECRET']??null;
        if(!is_string($secret)||strlen($secret)<32||str_contains($secret,'$')||$secret!==($other['APP_JWT_SECRET']??null)){throw new RuntimeException('stable key source');}
        $source=$raw['services']['api']['image']===$p['source'];
        $target=$raw['services']['api']['image']===$p['target'];
        if(!$source&&!$target){throw new RuntimeException('image direction');}
        $rows=$s->environment_variables()->lockForUpdate()->get();$claims=$rows->where('key','REGISTRATION_GUARD_SECRET');
        if(($source&&$claims->count()!==0)||($target&&($claims->count()!==1||$claims->first()->value!==$secret||!$claims->first()->is_literal))){throw new RuntimeException('stable key drift');}
        $oldRows=$rows->where('key','!=','REGISTRATION_GUARD_SECRET');
        $oldEnv=generatedEnvironment($s,$rendered,$oldRows);
        if(hash('sha256',$oldEnv)!==$p['old_env_sha']){throw new RuntimeException('existing environment bytes');}
        if($source){
            if(hash('sha256',$s->docker_compose_raw)!==$p['raw_sha']||hash('sha256',$s->docker_compose)!==$p['rendered_sha']){throw new RuntimeException('source hash');}
            updateEnvironment($raw,$p['target']);updateEnvironment($rendered,$p['target']);
        } else {
            if(hash('sha256',$s->docker_compose_raw)!==$p['target_raw_sha']||hash('sha256',$s->docker_compose)!==$p['target_rendered_sha']||($map['AUTO_TRIAL_DAILY_IP_LIMIT']??null)!=='2'||($map['REGISTRATION_GUARD_SECRET']??null)!=='${REGISTRATION_GUARD_SECRET}') {throw new RuntimeException('target hash');}
        }
        $newRaw=$source?Yaml::dump($raw,10,2):$s->docker_compose_raw;
        $newRendered=$source?Yaml::dump($rendered,10,2):$s->docker_compose;
        $variable=$target?$claims->first():new EnvironmentVariable(['key'=>'REGISTRATION_GUARD_SECRET','value'=>$secret,'is_literal'=>true,'is_runtime'=>true,'is_buildtime'=>false,'is_required'=>true,'is_preview'=>false,'is_shown_once'=>true]);
        $line=$s->composeEnvironmentFileLine($variable);
        $newEnv=$oldEnv.($oldEnv!==''&&!str_ends_with($oldEnv,"\n")?"\n":'').$line;
        $proof=['target_raw_sha'=>hash('sha256',$newRaw),'target_rendered_sha'=>hash('sha256',$newRendered),'target_env_sha'=>hash('sha256',$newEnv),'guard_line'=>base64_encode($line),'guard_secret'=>base64_encode($secret),'source_valid'=>true];
        if($p['action']==='apply'){
            $phase='target_proof';
            foreach(['target_raw_sha','target_rendered_sha','target_env_sha'] as $key){if($proof[$key]!==$p[$key]){throw new RuntimeException('planned target drift');}}
            if($source){
                $phase='stable_key_save';$s->environment_variables()->save($variable);
                $s->docker_compose_raw=$newRaw;$s->docker_compose=$newRendered;$s->save();
                $application=$s->applications()->where('name','api')->firstOrFail();
                if($application->image!==$p['source']){throw new RuntimeException('api model drift');}
                $application->image=$p['target'];$application->save();
            }
            if(generatedEnvironment($s,$rendered,$s->environment_variables()->get())!==$newEnv){throw new RuntimeException('generated environment drift');}
            $phase='compose_files';$s->saveComposeConfigs();
        }elseif($p['action']!=='preview'){throw new RuntimeException('action');}
        return $proof;
    },1);
    echo json_encode($result,JSON_THROW_ON_ERROR);
}catch(Throwable $error){fwrite(STDERR,"registration_metadata_failed:$phase\n");exit(1);}
'''

MIGRATION_RUNNER=r'''
const fs=require('node:fs'),crypto=require('node:crypto'),{Client}=require('pg');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const names=['registration_ip_lifetime_quota','registration_installation_claims','live_channel_exclusions'];
const schemaSql=`select json_build_object('tables',(select json_agg(t order by t.name) from (select c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,c.relacl::text acl,(select json_agg(a order by a.position) from (select attnum position,attname name,format_type(atttypid,atttypmod) type,attnotnull required,pg_get_expr(d.adbin,d.adrelid) default_value from pg_attribute left join pg_attrdef d on d.adrelid=attrelid and d.adnum=attnum where attrelid=c.oid and attnum>0 and not attisdropped) a) columns,(select json_agg(x order by x.name) from (select conname name,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=c.oid) x) constraints,(select json_agg(x order by x.name) from (select indexname name,indexdef definition from pg_indexes where schemaname='public' and tablename=c.relname) x) indexes,(select json_agg(x order by x.name) from (select policyname name,roles::text,cmd,qual,with_check from pg_policies where schemaname='public' and tablename=c.relname) x) policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])) t)) proof`;
(async()=>{
 const p=JSON.parse(fs.readFileSync(0,'utf8'));
 if(!Array.isArray(p.migrations)||p.migrations.length!==2||p.migrations.some(m=>sha(m.sql)!==m.sha)||typeof p.secret!=='string'||p.secret.length<32)throw Error('input');
 const url=new URL(p.databaseUrl);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('database');url.hostname='127.0.0.1';url.port='5432';
 const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:8000});await client.connect();
 try{
  await client.query('begin');await client.query("set local lock_timeout='15s'");await client.query("set local statement_timeout='60s'");await client.query('select pg_advisory_xact_lock(73103120261031)');
  const marker=(await client.query("select to_regclass('public.flixify_release_migrations')::text marker")).rows[0].marker;
  if(marker){
   const rows=(await client.query('select version,source_sha,schema_sha from public.flixify_release_migrations where version=any($1::text[]) order by version',[p.migrations.map(m=>m.version)])).rows;
   const schema=sha(JSON.stringify((await client.query(schemaSql,[names])).rows[0].proof));
   if(rows.length!==2||rows.some((r,i)=>r.version!==p.migrations[i].version||r.source_sha!==p.migrations[i].sha||r.schema_sha!==schema))throw Error('migration proof');
   await client.query('commit');console.log(JSON.stringify({migrations:2,schemaSha:schema,alreadyApplied:true}));return;
  }
  if((await client.query('select count(*)::int count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=\'public\' and c.relname=any($1::text[])',[names])).rows[0].count!==0)throw Error('unmarked existing schema');
  await client.query("select set_config('flixify.registration_guard_secret',$1,true)",[p.secret]);
  for(const migration of p.migrations)await client.query(migration.sql);
  const schema=sha(JSON.stringify((await client.query(schemaSql,[names])).rows[0].proof));
  await client.query('create table public.flixify_release_migrations(version text primary key,source_sha text not null check(source_sha ~ \'^[0-9a-f]{64}$\'),schema_sha text not null check(schema_sha ~ \'^[0-9a-f]{64}$\'),applied_at timestamptz not null default now())');
  await client.query('alter table public.flixify_release_migrations enable row level security; revoke all on public.flixify_release_migrations from public');
  await client.query("do $r$ begin if exists(select 1 from pg_roles where rolname='anon') then revoke all on public.flixify_release_migrations from anon; end if; if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on public.flixify_release_migrations from authenticated; end if; end $r$");
  for(const m of p.migrations)await client.query('insert into public.flixify_release_migrations(version,source_sha,schema_sha) values($1,$2,$3)',[m.version,m.sha,schema]);
  await client.query('commit');console.log(JSON.stringify({migrations:2,schemaSha:schema,alreadyApplied:false}));
 }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{await client.end()}
})().catch(()=>{console.error('registration_migration_failed; transaction_not_confirmed');process.exitCode=1});
'''

def append_guard_line(before,line):
    if not isinstance(before,bytes) or not isinstance(line,bytes) or not line.startswith((GUARD_KEY+'=').encode()) or b'\n' in line or b'\r' in line or b'\x00' in line:raise GateError('invalid_guard_environment_line')
    if re.search(rb'(?m)^(?:export\s+)?REGISTRATION_GUARD_SECRET\s*=',before):raise GateError('guard_environment_already_present')
    return before+(b'\n' if before and not before.endswith(b'\n') else b'')+line

def target(revision):return builder.target(revision)
def environment(document):
    value=document['services']['api'].get('environment')
    if isinstance(value,dict):return value
    if not isinstance(value,list):raise GateError('api_environment_shape')
    result={}
    for row in value:
        if not isinstance(row,str):raise GateError('api_environment_entry')
        key,_,value=row.partition('=')
        if key in result:raise GateError('api_environment_duplicate')
        result[key]=value
    return result

def validate_plan(raw,rendered,generated,containers,applications,stage,*,recovering=False):
    prior.ORIGINAL_VALIDATE_PLAN(raw,rendered,generated,containers,applications,stage,recovering=recovering)
    for document in (raw,rendered,generated):
        values=environment(document)
        if values.get('TRUSTED_PROXY_CIDRS')!=TRUSTED or values.get('AUTO_TRIAL_DAILY_IP_LIMIT')!=('1000' if stage=='source' else '2'):raise GateError('api_environment_drift')
        if (stage=='source' and GUARD_KEY in values) or (stage=='target' and values.get(GUARD_KEY)!=GUARD_REF):raise GateError('api_guard_reference_drift')

def configure(revision,candidate_id,web_tag,web_id):
    prior.configure(revision,candidate_id,web_tag,web_id)
    guard.SOURCE={'api':SOURCE_TAG};guard.SOURCE_IDS={'api':SOURCE_ID};guard.TARGET={'api':target(revision)}
    guard.validate_plan=validate_plan
    guard.PHP_APPLY=PHP_METADATA

def verify_protected(before):
    prior.verify_proxy_peer(allow_missing_api=True);guard.verify_protected_applications()
    current=guard.container_snapshot(allow_missing_changed=True)
    for name in guard.PROTECTED:
        if not current[name]['running'] or guard.container_identity({name:current[name]})!=guard.container_identity({name:before[name]}):raise GateError('protected_container_changed:'+name)

def metadata_payload(context,action):
    f=context['fence']
    return {'uuid':guard.UUID,'action':action,'source':SOURCE_TAG,'target':guard.TARGET['api'],'protected':{n:p[0] for n,p in guard.PROTECTED_IMAGES.items()},'raw_sha':f['raw_sha'],'rendered_sha':f['rendered_sha'],'old_env_sha':f['old_env_sha'],**{k:f.get(k) for k in ('target_raw_sha','target_rendered_sha','target_env_sha')}}

def metadata(context,action):
    output=guard.command('docker','exec','-i','coolify','php','-r',PHP_METADATA,input_data=json.dumps(metadata_payload(context,action),separators=(',',':')).encode(),timeout=180)
    result=json.loads(output)
    if result.get('source_valid') is not True:raise GateError('metadata_proof_missing')
    for key in ('target_raw_sha','target_rendered_sha','target_env_sha'):
        if not re.fullmatch('[0-9a-f]{64}',result.get(key,'')):raise GateError('metadata_proof_invalid')
    return result

def runtime_values():
    items=json.loads(guard.command('docker','inspect','api-'+guard.UUID));item=items[0]
    if len(items)!=1 or item['Image'] not in (SOURCE_ID,guard.CANDIDATE_ID):raise GateError('api_runtime_identity_drift')
    values={}
    for row in item['Config'].get('Env',[]):
        key,_,value=row.partition('=')
        if key in ('DATABASE_URL','APP_JWT_SECRET',GUARD_KEY,'TRUSTED_PROXY_CIDRS','AUTO_TRIAL_DAILY_IP_LIMIT'):
            if key in values:raise GateError('api_runtime_environment_duplicate')
            values[key]=value
    if not values.get('DATABASE_URL') or len(values.get('APP_JWT_SECRET',''))<32:raise GateError('api_runtime_configuration_missing')
    values['_container_id']=item['Id'];values['_started_at']=item['State']['StartedAt'];values['_image_id']=item['Image'];values['_running']=item['State']['Running']
    return values

def migration_inputs(repo,revision):
    result=[]
    for path in MIGRATIONS:
        builder.helpers.require_regular_blob(repo,revision,path)
        sql=builder.core.git_file(repo,revision,path)
        result.append({'version':Path(path).stem,'sha':hashlib.sha256(sql).hexdigest(),'sql':sql.decode()})
    return result

def prepare(repo,revision):
    record,compose,env,before,raw,rendered=guard.preflight('source')
    context={'before':before,'runtime':runtime_values(),'fence':{'version':1,'revision':revision,'candidate_id':guard.CANDIDATE_ID,'phase':'prepared','raw_sha':guard.sha(record['docker_compose_raw']),'rendered_sha':guard.sha(record['docker_compose']),'compose_sha':guard.sha(compose),'old_env_sha':guard.sha(env),'old_env_length':len(env),'before':before,'migrations':[{k:m[k] for k in ('version','sha')} for m in migration_inputs(repo,revision)]}}
    if GUARD_KEY in context['runtime']:raise GateError('source_runtime_guard_already_present')
    context['fence']['source_started_at']=context['runtime']['_started_at']
    proof=metadata(context,'preview');line=base64.b64decode(proof['guard_line'],validate=True);secret=base64.b64decode(proof['guard_secret'],validate=True).decode()
    if secret!=context['runtime']['APP_JWT_SECRET']:raise GateError('stable_key_runtime_mismatch')
    expected=append_guard_line(env,line)
    if guard.sha(expected)!=proof['target_env_sha']:raise GateError('planned_environment_bytes_differ')
    context['proof']=proof;context['fence'].update({k:proof[k] for k in ('target_raw_sha','target_rendered_sha','target_env_sha')})
    return context

def write_fence(value):
    payload=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    if FENCE.exists():guard.restore_bytes(FENCE,payload,FENCE.stat())
    else:
        fd=os.open(FENCE,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as file:file.write(payload);file.flush();os.fsync(file.fileno())
    directory=os.open(FENCE.parent,os.O_RDONLY)
    try:os.fsync(directory)
    finally:os.close(directory)

@contextlib.contextmanager
def rollout_lock():
    path=FENCE.with_name('.live-registration-rollout.lock')
    try:fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    except OSError:raise GateError('rollout_lock_unavailable')
    try:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise GateError('another_registration_rollout_running')
        yield
    finally:os.close(fd)

def stop_api(context):
    current=guard.container_snapshot(allow_missing_changed=True)['api']
    if current['id'] is None:return
    if current['image_id'] not in (SOURCE_ID,guard.CANDIDATE_ID) or current['tag'] not in (SOURCE_TAG,guard.TARGET['api']):raise GateError('cannot_stop_unrecognized_api')
    if current['running']:guard.command('docker','stop','--time','20','api-'+guard.UUID,timeout=35)
    if guard.container_snapshot(allow_missing_changed=True)['api']['running']:raise GateError('api_did_not_stop')

def migrate(context,repo,revision):
    verify_protected(context['before'])
    if guard.container_snapshot(allow_missing_changed=True)['api']['running']:raise GateError('api_must_be_stopped_before_seed')
    migrations=migration_inputs(repo,revision)
    if [{k:m[k] for k in ('version','sha')} for m in migrations]!=context['fence']['migrations']:raise GateError('migration_revision_drift')
    payload={'databaseUrl':context['runtime']['DATABASE_URL'],'secret':base64.b64decode(context['proof']['guard_secret'],validate=True).decode(),'migrations':migrations}
    result=json.loads(guard.command('docker','run','--rm','-i','--network','container:db-'+guard.UUID,'--memory','256m','--memory-swap','320m','--pids-limit','128','--read-only','--workdir','/app/apps/api','--entrypoint','node',SOURCE_ID,'-e',MIGRATION_RUNNER,input_data=json.dumps(payload,separators=(',',':')).encode(),timeout=150))
    if result.get('migrations')!=2 or not re.fullmatch('[0-9a-f]{64}',result.get('schemaSha','')):raise GateError('migration_confirmation_missing')
    return result

def sync_metadata(context):
    verify_protected(context['before'])
    metadata(context,'apply')
    f=context['fence'];record=guard.service_record()
    if guard.sha(record['docker_compose_raw'])!=f['target_raw_sha'] or guard.sha(record['docker_compose'])!=f['target_rendered_sha'] or guard.sha(guard.COMPOSE.read_bytes())!=f['target_rendered_sha'] or guard.sha(guard.ENV.read_bytes())!=f['target_env_sha']:raise GateError('metadata_or_files_postcheck_failed')
    env=guard.ENV.read_bytes();length=f['old_env_length']
    if guard.sha(env[:length])!=f['old_env_sha']:raise GateError('existing_environment_prefix_changed')
    if guard.application_images()!=guard.TARGET:raise GateError('api_model_postcheck_failed')
    verify_protected(context['before'])

def start_candidate(context):
    _,compose,env,current,raw,rendered=guard.preflight('target',recovering=True)
    verify_protected(context['before'])
    if current['api']['tag']==guard.TARGET['api'] and not current['api']['running']:
        guard.command('docker','compose','-p',guard.UUID,'--project-directory',str(guard.DIRECTORY),'-f',str(guard.COMPOSE),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api',timeout=180)
    with contextlib.redirect_stdout(io.StringIO()):guard.recreate(current,compose,env,raw,rendered)
    verify_protected(context['before'])
    values=runtime_values()
    if (values.get(GUARD_KEY)!=base64.b64decode(context['proof']['guard_secret'],validate=True).decode() or
        values.get('APP_JWT_SECRET')!=context['runtime']['APP_JWT_SECRET'] or
        values.get('TRUSTED_PROXY_CIDRS')!=TRUSTED or values.get('AUTO_TRIAL_DAILY_IP_LIMIT')!='2'):
        raise GateError('candidate_runtime_registration_configuration_differs')

def cutover(context,repo,revision):
    stopped=False
    try:
        write_fence(context['fence']);stopped=True;stop_api(context);verify_protected(context['before'])
        context['fence']['phase']='stopped';write_fence(context['fence'])
        result=migrate(context,repo,revision);context['fence'].update(phase='seeded',migration_proof=result);write_fence(context['fence'])
        sync_metadata(context);context['fence']['phase']='configured';write_fence(context['fence'])
        start_candidate(context);context['fence']['phase']='complete';write_fence(context['fence'])
    except Exception:
        if stopped:
            try:stop_api(context)
            except Exception:raise GateError('rollout_failed_api_stop_unconfirmed; old_image_restart_forbidden')
        raise

def apply(repo,revision):
    with rollout_lock():
        if FENCE.exists():raise GateError('rollout_fence_exists_use_resume')
        cutover(prepare(repo,revision),repo,revision)

def resume_locked(repo,revision):
    if not FENCE.is_file() or FENCE.is_symlink():raise GateError('rollout_fence_missing_or_invalid')
    f=json.loads(FENCE.read_bytes())
    if (f.get('version')!=1 or f.get('revision')!=revision or f.get('candidate_id')!=guard.CANDIDATE_ID or
        f.get('phase') not in {'prepared','stopped','seeded','configured','complete'}):raise GateError('recovery_requires_same_compatible_candidate')
    guard.verify_source_images();guard.candidate_images();verify_protected(f['before'])
    record=guard.service_record()
    if (guard.sha(record['docker_compose_raw']),guard.sha(record['docker_compose'])) not in ((f['raw_sha'],f['rendered_sha']),(f['target_raw_sha'],f['target_rendered_sha'])):raise GateError('recovery_metadata_drift')
    if guard.sha(guard.COMPOSE.read_bytes()) not in (f['compose_sha'],f['target_rendered_sha']) or guard.sha(guard.ENV.read_bytes()) not in (f['old_env_sha'],f['target_env_sha']):raise GateError('recovery_files_drift')
    context={'fence':f,'before':f['before'],'runtime':runtime_values()}
    runtime=context['runtime']
    if runtime['_image_id']==SOURCE_ID and (runtime['_container_id']!=f['before']['api']['id'] or runtime['_started_at']!=f['source_started_at'] or (f['phase']!='prepared' and runtime['_running'])):
        stop_api(context)
        raise GateError('legacy_api_ran_after_fence; manual_ledger_resync_required; api_stopped')
    context['proof']=metadata(context,'preview')
    if base64.b64decode(context['proof']['guard_secret'],validate=True).decode()!=context['runtime']['APP_JWT_SECRET']:raise GateError('stable_key_recovery_runtime_mismatch')
    cutover(context,repo,revision)

def resume(repo,revision):
    with rollout_lock():resume_locked(repo,revision)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source_repo',type=Path)
    for key in ('revision','candidate-id','protected-web-tag','protected-web-id'):parser.add_argument('--'+key,required=True)
    actions=parser.add_mutually_exclusive_group();actions.add_argument('--apply',action='store_true');actions.add_argument('--resume',action='store_true');args=parser.parse_args()
    configure(args.revision,args.candidate_id,args.protected_web_tag,args.protected_web_id)
    if args.apply:apply(args.source_repo,args.revision)
    elif args.resume:resume(args.source_repo,args.revision)
    else:prepare(args.source_repo,args.revision);print('dry_run_ok; no_mutation; candidate_and_permanent_registration_plan_pinned');return
    print('api_healthy; permanent_registration_limits_active; web_worker_db_unchanged')

if __name__=='__main__':
    try:main()
    except GateError as error:print('release_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError,guard.yaml.YAMLError):print('release_stopped:invalid_state; old_image_restart_forbidden',file=sys.stderr);sys.exit(1)
