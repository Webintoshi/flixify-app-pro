#!/usr/bin/env python3
"""Use the proven inode-preserving bot deployment only after policy-closed API/WEB."""
import argparse,contextlib,fcntl,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('whatsapp_bot_build',HERE/'build.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
spec=importlib.util.spec_from_file_location('whatsapp_bot_release',HERE/'release.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
BOT_REV='eb5166c3ee32ac7da3af1a83f7d387bcec6e7748'
BOT_PROFILE='coolify/releases/2026-11-07-telegram-registration/'
BOT_HELPER_SHA='3d602e6e2edf8d257f6cc106546c5dfceafb9220d8049950d44652f65c978ab7'
PROBE_SHA='a64d42ffa5e7d88a8e258fa639112888e14e116c26e8d74b2a0ef091e96d3c77'
BOT_NAME='/flixify-telegram-bot'

@contextlib.contextmanager
def bot_helpers(repo):
 with tempfile.TemporaryDirectory(prefix='flixify-whatsapp-bot-helper-') as d:
  root=Path(d)
  for name,digest in [('release.py',BOT_HELPER_SHA),('offline-probe.mjs',PROBE_SHA)]:
   data=c.blob(repo,BOT_REV,BOT_PROFILE+name)
   if c.sha(data)!=digest:raise c.GateError('frozen_bot_helper_digest_changed')
   (root/name).write_bytes(data)
  module=c.load('whatsapp_frozen_bot',root/'release.py');module.SOURCE_SHA=c.BOT_SOURCE
  yield module,root/'offline-probe.mjs'

def without_bot(snapshot):return {k:v for k,v in snapshot.items() if k not in (BOT_NAME,c.BOT_FILE_KEY)}
def update_bot_checkpoint(r,journal,before,after,bot,old_identity,source_sha,success):
 if without_bot(before)!=without_bot(after) or after[c.BOT_FILE_KEY]['sha256']!=source_sha or bot.stable_identity(bot.bot_snapshot())!=old_identity:raise c.GateError('bot_or_protected_configuration_changed')
 journal['protected']=after;journal['bot']={'candidateApplied':success,'scriptSha256':source_sha,'sourceSha256':c.BOT_SOURCE,'intendedCandidateSha256':c.BOT_TARGET};r.save_journal(journal)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--candidate',type=Path,required=True);p.add_argument('--api-proof',type=Path,required=True);p.add_argument('--web-proof',type=Path,required=True);p.add_argument('--probe-image-id');p.add_argument('--apply',action='store_true');a=p.parse_args();c.revision(a.revision)
 if c.sha(a.candidate.read_bytes())!=c.BOT_TARGET:raise c.GateError('exact_raw_bot_candidate_required')
 proofs={'api':json.loads(a.api_proof.read_text()),'ops-web':json.loads(a.web_proof.read_text())}
 with bot_helpers(a.repo) as (bot,probe):
  if not a.apply:
   bot.deploy(a.candidate,c.BOT_TARGET,probe,PROBE_SHA,apply=False,source_sha=c.BOT_SOURCE,probe_image_id=a.probe_image_id);return
  with c.helpers(a.repo) as r:
   r.JOURNAL=r.DIRECTORY/'.whatsapp-only-release.json'
   for key,proof in proofs.items():
    if proof['service']!=key or proof['revision']!=a.revision:raise c.GateError('matching_policy_proofs_required_before_bot')
    c.verify_proof(r.b,proof)
   with (r.DIRECTORY/'.phone-login-release.lock').open('a+') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);journal=r.load_journal();before=c.protected_snapshot(r.b);current=release.state(r);rows=r.b.services()
    if journal['revision']!=a.revision or journal['phase']!='running' or journal['protected']!=before or journal['targetState']!=release.fingerprint(r,current) or not release.schema_ready(r):raise c.GateError('completed_policy_release_required_before_bot')
    if any((rows[k]['Config']['Image'],rows[k]['Image'])!=(v['candidateTag'],v['candidateId']) for k,v in proofs.items()):raise c.GateError('new_api_and_web_required_before_bot')
    c.policy_check(r.b,'api-'+r.b.UUID);old_identity=bot.stable_identity(bot.bot_snapshot())
    try:
     bot.deploy(a.candidate,c.BOT_TARGET,probe,PROBE_SHA,apply=True,source_sha=c.BOT_SOURCE,probe_image_id=a.probe_image_id)
    except Exception:
     after=c.protected_snapshot(r.b)
     if after[c.BOT_FILE_KEY]['sha256']==c.BOT_SOURCE and journal['targetState']==release.fingerprint(r,release.state(r)):
      update_bot_checkpoint(r,journal,before,after,bot,old_identity,c.BOT_SOURCE,False)
     raise
    after=c.protected_snapshot(r.b)
    if journal['targetState']!=release.fingerprint(r,release.state(r)):raise c.GateError('api_web_metadata_changed_during_bot_release')
    update_bot_checkpoint(r,journal,before,after,bot,old_identity,c.BOT_TARGET,True)
    print(json.dumps({'state':'whatsapp_only_bot_verified','scriptSha256':c.BOT_TARGET,'apiRestarted':False,'syntheticTelegramMessages':0}))

if __name__=='__main__':
 try:main()
 except Exception as e:print('whatsapp_only_bot_stopped:'+str(e) if isinstance(e,c.GateError) else 'whatsapp_only_bot_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
