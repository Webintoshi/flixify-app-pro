import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).with_name('live-channel-cdn-audit.py'))
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
CREDS={'providerOrigin':'https://source.invalid','username':'private-user','password':'private-password'}
CHANNEL={'streamId':'90','extension':'ts'}
LOCATION='https://edge.flixify.vip/signed/90.ts?token=private-token%2Fraw&x=1&x=2'
REMOTE={'ssh_socket':'/tmp/owned-ssh/socket','ssh_target':'root@edge.invalid','directory':'/tmp/flixify-live-audit-owned/runtime','unit_name':'flixify-live-audit-owned.service','helper_sha256':'a'*64,'runtime_sha256':'b'*64}
NONCE='c'*32

def ready(nonce=NONCE):return {'idle':False,'activeState':'active','populated':True,'mainPid':123,'controlPid':0,'cgroupMatches':True,'description':'Flixify owned CDN audit '+nonce}

class FakeSSH:
    def __init__(self,result=None,early_exit=False,interrupt=False):
        self.result=result or SimpleNamespace(returncode=0,stdout=json.dumps(helper()).encode(),stderr=b'')
        self.returncode=self.result.returncode if early_exit else None
        self.stdin=io.BytesIO();self.stdout=io.BytesIO();self.stderr=io.BytesIO();self.sent=None;self.killed=False;self.waited=False;self.interrupt=interrupt
    def poll(self):return self.returncode
    def communicate(self,input,timeout):
        if self.interrupt:raise KeyboardInterrupt()
        self.sent=input;self.returncode=self.result.returncode;return self.result.stdout,self.result.stderr
    def kill(self):self.killed=True;self.returncode=-9
    def wait(self,timeout):self.waited=True;return self.returncode

def helper(status='working',code=None):
    return {'status':status,'decoderHttpError':code,'firstDecodedFrameMs':744 if status=='working' else None,'decodedFrames':1 if status=='working' else 0,'returnCode':0 if status=='working' else 1,'exclusionEvidence':False,'sourceEntryRevalidated':False}

class BridgeTests(unittest.TestCase):
    def fixtures(self,entry=(302,LOCATION),decoded=None):
        events=[]
        def idle(remote):events.append('initial-idle')
        def original(*args):events.append('entry');return entry
        def run(remote,payload,timeout):events.append('remote-decode');self.assertEqual(payload,{'url':LOCATION,'streamId':'90'});return helper() if decoded is None else decoded
        def reconcile(remote):events.append('remote-done');return True
        return events,[patch.object(bridge,'ensure_remote_idle',side_effect=idle),patch.object(bridge,'fetch_original_entry',side_effect=original),patch.object(bridge,'decode_remote',side_effect=run),patch.object(bridge,'reconcile_remote',side_effect=reconcile)]

    def run_case(self,entry=(302,LOCATION),decoded=None,confirm=None):
        events,patches=self.fixtures(entry,decoded)
        for item in patches:item.start();self.addCleanup(item.stop)
        if confirm is not None:
            def validate(*args):events.append('client-revalidate');return confirm
            item=patch.object(bridge,'revalidate_original',side_effect=validate);item.start();self.addCleanup(item.stop)
        result=bridge.probe_channel(CREDS,CHANNEL,REMOTE)
        return result,events

    def test_issued_url_working_frame_preserves_four_field_contract_and_cleanup(self):
        result,events=self.run_case()
        self.assertEqual(set(result),{'status','httpStatus','firstDecodedFrameMs','decodedFrames'})
        self.assertEqual(result['status'],'working');self.assertEqual(result['decodedFrames'],1);self.assertIsNone(result['httpStatus'])
        self.assertEqual(events,['initial-idle','entry','remote-decode','remote-done'])
        self.assertNotIn('private-',json.dumps(result))

    def test_original_hard_and_access_statuses_do_not_launch_decoder(self):
        for code in [404,410,401,403,429,500,503,200]:
            with self.subTest(code=code):
                result,events=self.run_case(entry=(code,None))
                expected='http-unavailable' if code in {404,410} else 'blocked' if code in {401,403,429} else 'unverified'
                self.assertEqual(result['status'],expected);self.assertEqual(result['httpStatus'],code)
                self.assertEqual(events,['initial-idle','entry'])

    def test_cdn_hard_error_is_confirmed_from_original_only_after_remote_done(self):
        for code in [404,410]:
            with self.subTest(code=code):
                result,events=self.run_case(decoded=helper('unverified',404),confirm=code)
                self.assertEqual(result['status'],'http-unavailable');self.assertEqual(result['httpStatus'],code)
                self.assertEqual(events[-2:],['remote-done','client-revalidate'])

    def test_current_top_level_200_protects_from_stale_hls_segment_404(self):
        result,events=self.run_case(decoded=helper('unverified',404),confirm=200)
        self.assertEqual(result['status'],'undecodable');self.assertEqual(result['httpStatus'],200)
        self.assertEqual(events[-2:],['remote-done','client-revalidate'])

    def test_blocked_and_transient_decoder_results_never_become_hard_failures(self):
        for status,code in [('blocked',401),('blocked',403),('blocked',429),('unverified',503),('timeout',None),('undecodable',None)]:
            with self.subTest(code=code,status=status):
                result,events=self.run_case(decoded=helper(status,code))
                self.assertEqual(result['status'],'blocked' if code in {401,403,429} else 'unverified')
                self.assertNotIn('client-revalidate',events);self.assertEqual(events[-1],'remote-done')

    def test_uncertain_transport_halts_even_after_successful_reconciliation(self):
        with patch.object(bridge,'ensure_remote_idle'),patch.object(bridge,'fetch_original_entry',return_value=(302,LOCATION)),patch.object(bridge,'decode_remote',side_effect=bridge.BridgeHalt('remote-transport-uncertain')),patch.object(bridge,'reconcile_remote') as cleanup:
            with self.assertRaisesRegex(bridge.BridgeHalt,'remote-transport-uncertain'):bridge.probe_channel(CREDS,CHANNEL,REMOTE)
            cleanup.assert_called_once_with(REMOTE)

    def test_cleanup_failure_halts_instead_of_returning_working_or_checking_original(self):
        with patch.object(bridge,'ensure_remote_idle'),patch.object(bridge,'fetch_original_entry',return_value=(302,LOCATION)),patch.object(bridge,'decode_remote',return_value=helper()),patch.object(bridge,'reconcile_remote',side_effect=bridge.BridgeHalt('remote-cleanup-unconfirmed')):
            with self.assertRaisesRegex(bridge.BridgeHalt,'remote-cleanup-unconfirmed'):bridge.probe_channel(CREDS,CHANNEL,REMOTE)

    def test_sigint_still_reconciles_before_propagating(self):
        with patch.object(bridge,'ensure_remote_idle'),patch.object(bridge,'fetch_original_entry',return_value=(302,LOCATION)),patch.object(bridge,'decode_remote',side_effect=KeyboardInterrupt),patch.object(bridge,'reconcile_remote') as cleanup:
            with self.assertRaises(KeyboardInterrupt):bridge.probe_channel(CREDS,CHANNEL,REMOTE)
            cleanup.assert_called_once()

    def test_ssh_carries_exact_url_only_in_stdin_and_systemd_owns_process_group(self):
        process=FakeSSH()
        with patch.object(bridge.subprocess,'Popen',return_value=process) as child,patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',return_value=ready()):
            result=bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
        self.assertEqual(result['decodedFrames'],1)
        args=child.call_args.args[0];kwargs=child.call_args.kwargs
        self.assertNotIn(LOCATION,' '.join(args));self.assertEqual(json.loads(process.sent),{'url':LOCATION,'streamId':'90'})
        self.assertEqual(kwargs['stdin'],subprocess.PIPE);self.assertIn('ProxyCommand=false',args)
        self.assertIn('KillMode=control-group',args[-1]);self.assertIn('RuntimeMaxSec=25s',args[-1])
        self.assertIn('MemoryMax=384M',args[-1]);self.assertIn('CPUQuota=150%',args[-1]);self.assertIn('Nice=10',args[-1])

    def test_nonzero_ssh_or_malformed_reply_is_terminal_and_never_echoes_secrets(self):
        for result in [SimpleNamespace(returncode=255,stdout=b'',stderr=LOCATION.encode()),SimpleNamespace(returncode=0,stdout=LOCATION.encode(),stderr=b'')]:
            with patch.object(bridge.subprocess,'Popen',return_value=FakeSSH(result)),patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',return_value=ready()):
                with self.assertRaises(bridge.BridgeHalt) as error:bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
                self.assertNotIn('private',str(error.exception));self.assertNotIn(LOCATION,str(error.exception))

    def test_signed_input_is_withheld_until_exact_nonce_owned_unit_is_ready(self):
        process=FakeSSH();events=[]
        def status(remote,action):
            self.assertEqual(action,'status');self.assertIsNone(process.sent);events.append('owned-ack');return ready()
        with patch.object(bridge.subprocess,'Popen',return_value=process),patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',side_effect=status):
            bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
        self.assertEqual(events,['owned-ack']);self.assertIsNotNone(process.sent);self.assertTrue(process.waited)

    def test_wrong_nonce_or_uncertain_ack_closes_empty_stdin_and_reaps_ssh(self):
        for reply in [ready('d'*32),bridge.BridgeHalt('remote-transport-uncertain')]:
            process=FakeSSH()
            with patch.object(bridge.subprocess,'Popen',return_value=process),patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',side_effect=reply if isinstance(reply,Exception) else None,return_value=reply):
                with self.assertRaises(bridge.BridgeHalt):bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
            self.assertIsNone(process.sent);self.assertTrue(process.stdin.closed);self.assertTrue(process.killed);self.assertTrue(process.waited)

    def test_early_ssh_exit_and_ack_timeout_never_receive_a_url(self):
        for early in [True,False]:
            process=FakeSSH(early_exit=early)
            with patch.object(bridge.subprocess,'Popen',return_value=process),patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',return_value={}),patch.object(bridge.time,'monotonic',side_effect=[0,11]):
                with self.assertRaises(bridge.BridgeHalt):bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
            self.assertIsNone(process.sent);self.assertTrue(process.stdin.closed);self.assertTrue(process.waited)

    def test_interrupt_at_ack_send_boundary_reaps_empty_ssh_before_reconcile(self):
        process=FakeSSH(interrupt=True);events=[]
        def cleanup(remote):
            self.assertTrue(process.killed);self.assertTrue(process.waited);self.assertTrue(process.stdin.closed);events.append('remote-reconciled')
        with patch.object(bridge.subprocess,'Popen',return_value=process),patch.object(bridge,'new_nonce',return_value=NONCE,create=True),patch.object(bridge,'ssh_request',return_value=ready()),patch.object(bridge,'ensure_remote_idle'),patch.object(bridge,'fetch_original_entry',return_value=(302,LOCATION)),patch.object(bridge,'reconcile_remote',side_effect=cleanup):
            with self.assertRaises(KeyboardInterrupt):bridge.probe_channel(CREDS,CHANNEL,REMOTE)
        self.assertIsNone(process.sent);self.assertEqual(events,['remote-reconciled'])

    def test_ssh_exiting_between_poll_and_kill_is_still_closed_and_reaped(self):
        process=FakeSSH()
        def already_exited():process.returncode=0;raise ProcessLookupError()
        process.kill=already_exited
        with patch.object(bridge.subprocess,'Popen',return_value=process),patch.object(bridge,'new_nonce',return_value=NONCE),patch.object(bridge,'ssh_request',return_value=ready('d'*32)):
            with self.assertRaises(bridge.BridgeHalt):bridge.decode_remote(REMOTE,{'url':LOCATION,'streamId':'90'},15)
        self.assertIsNone(process.sent);self.assertTrue(process.stdin.closed);self.assertTrue(process.waited)

    def test_remote_scope_rejects_unowned_unit_or_extra_keys_before_any_request(self):
        for remote in [{**REMOTE,'unit_name':'nginx.service'},{**REMOTE,'extra':'x'}]:
            with patch.object(bridge,'ensure_remote_idle') as idle:
                with self.assertRaises(ValueError):bridge.probe_channel(CREDS,CHANNEL,remote)
                idle.assert_not_called()

    def test_reconcile_requires_each_terminal_state_field_and_an_empty_cgroup(self):
        clean={'idle':True,'activeState':'inactive','populated':False,'mainPid':0,'controlPid':0}
        for altered in [{**clean,'populated':True},{**clean,'activeState':'deactivating'},{**clean,'mainPid':123},{'idle':True}]:
            with patch.object(bridge,'ssh_request',return_value=altered):
                with self.assertRaises(bridge.BridgeHalt):bridge.reconcile_remote(REMOTE)
        with patch.object(bridge,'ssh_request',return_value=clean):self.assertTrue(bridge.reconcile_remote(REMOTE))

    def test_remote_state_program_checks_cgroup_population_even_if_unit_is_inactive(self):
        show='LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\n'
        config={key:REMOTE[key] for key in ['directory','unit_name','helper_sha256','runtime_sha256']};config['action']='status'
        for populated in ['0','1']:
            output=io.StringIO()
            with patch.object(sys,'argv',['remote',json.dumps(config)]),patch.object(bridge.subprocess,'run',return_value=SimpleNamespace(stdout=show,returncode=0)),patch.object(Path,'exists',return_value=True),patch.object(Path,'read_text',return_value='populated '+populated+'\nfrozen 0\n'),contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit) as exited:exec(bridge.REMOTE_PROGRAM,{})
            self.assertEqual(exited.exception.code,0)
            self.assertEqual(json.loads(output.getvalue())['idle'],populated=='0')

    def test_original_request_and_revalidation_close_without_reading_video_body(self):
        response=Mock();response.status=200;response.headers={};response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        with patch.object(bridge.urllib.request,'build_opener') as opener:
            opener.return_value.open.return_value=response
            self.assertEqual(bridge.fetch_original_entry('https://source.invalid/private',15),(200,None))
        response.read.assert_not_called();response.__exit__.assert_called_once()
        response.reset_mock()
        with patch.object(bridge.audit,'open_media_http',return_value=response):self.assertEqual(bridge.revalidate_original('https://source.invalid/private',15),200)
        response.read.assert_not_called();response.__exit__.assert_called_once()

if __name__=='__main__':unittest.main()
