import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import subprocess
import select
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('live-channel-cdn-probe.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
URL='https://edge.flixify.vip/signed/path/90.ts?token=a%2Fb%3D&x=1&x=2'
PENDING_INPUT_CLI = r'''
import os,runpy,sys
helper,ready,operator,binary=sys.argv[1:];ready=int(ready);original=sys.stdin
class ObservedBuffer:
    def read(self,size):
        os.write(ready,b'r');os.close(ready)
        return original.buffer.read(size)
class ObservedInput:
    buffer=ObservedBuffer()
    def __getattr__(self,name):return getattr(original,name)
sys.stdin=ObservedInput()
sys.argv=[helper,'--operator',operator,'--ffmpeg',binary]
runpy.run_path(helper,run_name='__main__')
'''

class ProbeTests(unittest.TestCase):
    def pending_cli(self):
        temporary=tempfile.TemporaryDirectory(prefix='flixify-pending-input-')
        self.addCleanup(temporary.cleanup)
        root=Path(temporary.name)
        reader,writer=os.pipe();ready_reader,ready_writer=os.pipe()
        os.set_blocking(reader,False)
        process=subprocess.Popen([sys.executable,'-c',PENDING_INPUT_CLI,str(Path(__file__).with_name('live-channel-cdn-probe.py')),str(ready_writer),str(root/'unused-operator.py'),str(root/'unused-decoder')],stdin=reader,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(ready_writer,))
        os.close(reader);os.close(ready_writer)
        def cleanup():
            for descriptor in [writer,ready_reader]:
                try:os.close(descriptor)
                except OSError:pass
            if process.poll() is None:process.kill()
            process.wait(timeout=5)
            process.stdout.close();process.stderr.close()
        self.addCleanup(cleanup)
        self.assertTrue(select.select([ready_reader],[],[],3)[0],'helper-did-not-enter-read')
        self.assertEqual(os.read(ready_reader,1),b'r')
        return process,writer

    def assert_waiting_for_input(self,process):
        self.assertFalse(select.select([process.stderr],[],[],0.12)[0],'helper-failed-before-input-EOF')
        self.assertIsNone(process.poll())

    def test_nonblocking_empty_open_pipe_waits_and_empty_eof_is_still_rejected(self):
        process,writer=self.pending_cli()
        self.assert_waiting_for_input(process)
        os.close(writer)
        output,error=process.communicate(timeout=5)
        self.assertEqual(process.returncode,1);self.assertEqual(output,b'')
        self.assertEqual(json.loads(error)['probeStopped'],'invalid-input-json')

    def test_nonblocking_split_payload_waits_for_complete_json_and_eof(self):
        process,writer=self.pending_cli()
        self.assert_waiting_for_input(process)
        payload=json.dumps({'url':URL,'streamId':'90'}).encode();middle=len(payload)//2
        os.write(writer,payload[:middle]);self.assert_waiting_for_input(process)
        os.write(writer,payload[middle:]);self.assert_waiting_for_input(process)
        os.close(writer)
        output,error=process.communicate(timeout=5)
        self.assertEqual(process.returncode,1);self.assertEqual(output,b'')
        self.assertEqual(json.loads(error)['probeStopped'],'FileNotFoundError')
        self.assertNotIn(b'token',error)

    def test_exact_signed_url_uses_one_approved_decoder_chain_and_real_frame(self):
        runner=Mock(return_value=SimpleNamespace(returncode=0,stdout=b'frame=1\nprogress=end\n',stderr=b''))
        result=probe.decode_url(URL,'/private/ffmpeg',runner)
        runner.assert_called_once();args,timeout=runner.call_args.args
        self.assertEqual(args[args.index('-i')+1],URL)
        self.assertEqual(args[args.index('-protocol_whitelist')+1],'https,tls,tcp,crypto')
        self.assertEqual(args[args.index('-analyzeduration')+1],'1000000')
        self.assertLess(args.index('-analyzeduration'),args.index('-i'))
        self.assertEqual(args[args.index('-rw_timeout')+1],'15000000');self.assertEqual(timeout,15)
        self.assertEqual(args[args.index('-frames:v')+1],'1');self.assertNotIn('-probesize',args)
        self.assertEqual(result['status'],'working');self.assertEqual(result['decodedFrames'],1)
        self.assertIsInstance(result['firstDecodedFrameMs'],int)
        self.assertIsNone(result['decoderHttpError']);self.assertFalse(result['exclusionEvidence'])
        self.assertNotIn('token',json.dumps(result))

    def test_unproved_frame_or_nonzero_decoder_never_means_working(self):
        for code,output in [(0,b'progress=end\n'),(1,b'frame=1\n')]:
            result=probe.decode_url(URL,'ffmpeg',Mock(return_value=SimpleNamespace(returncode=code,stdout=output,stderr=URL.encode())))
            self.assertEqual(result['status'],'undecodable');self.assertEqual(result['decodedFrames'],0)
            self.assertNotIn('token',json.dumps(result))

    def test_decoder_http_errors_are_not_top_level_exclusion_proof_or_second_requests(self):
        for code in [401,403,404,410,429,503]:
            runner=Mock(return_value=SimpleNamespace(returncode=1,stdout=b'',stderr=f'HTTP error {code} Failure'.encode()))
            result=probe.decode_url(URL,'ffmpeg',runner)
            self.assertEqual(result['status'],'blocked' if code in {401,403,429} else 'unverified')
            self.assertEqual(result['decoderHttpError'],code);self.assertFalse(result['exclusionEvidence'])
            self.assertFalse(result['sourceEntryRevalidated']);runner.assert_called_once()

    def test_timeout_hides_sensitive_command_and_does_not_open_another_connection(self):
        runner=Mock(side_effect=subprocess.TimeoutExpired(['ffmpeg','-i',URL],15))
        result=probe.decode_url(URL,'ffmpeg',runner)
        self.assertEqual(result['status'],'timeout');self.assertNotIn('token',json.dumps(result));runner.assert_called_once()

    def test_failure_diagnostics_are_bounded_keywords_and_never_raw_stderr(self):
        samples=[
            (b"Protocol 'http' not on whitelist 'https,tls,tcp,crypto'!",'transport-not-whitelisted','protocolNotWhitelisted'),
            (b'Protocol not found','unsupported-protocol','unsupportedProtocol'),
            (b'Unrecognized option user_agent','decoder-option-error','optionError'),
            (b'TLS handshake failed','tls-error','tlsError'),
            (b'Failed to resolve hostname','dns-error','dnsError'),
            (b'Connection refused','connection-error','connectionError'),
            (b'Invalid data found when processing input','invalid-input','invalidInput'),
            (b'Could not find codec parameters','codec-error','codecError'),
            (b'Error opening input file','input-open-error','inputOpenError'),
            (b'HTTP error 403 Forbidden','delivery-access-rejected','httpError'),
        ]
        for message,kind,flag in samples:
            with self.subTest(kind=kind):
                stderr=message+b' '+URL.encode()
                runner=Mock(return_value=SimpleNamespace(returncode=1,stdout=b'',stderr=stderr))
                result=probe.decode_url(URL,'ffmpeg',runner)
                self.assertEqual(result['failureClass'],kind)
                self.assertTrue(result['diagnostics'][flag]);self.assertEqual(result['returnCode'],1)
                self.assertEqual(result['capturedStderrBytes'],len(stderr));self.assertFalse(result['stderrAtCaptureLimit'])
                self.assertNotIn(URL,json.dumps(result));self.assertNotIn('token',json.dumps(result));runner.assert_called_once()

    def test_timeout_has_no_invented_return_code_or_stderr_count(self):
        result=probe.decode_url(URL,'ffmpeg',Mock(side_effect=subprocess.TimeoutExpired(['ffmpeg',URL],15)))
        self.assertEqual(result['failureClass'],'timeout')
        self.assertIsNone(result['returnCode']);self.assertIsNone(result['capturedStderrBytes'])

    def test_echoed_signed_or_redirected_urls_cannot_trigger_diagnostic_keywords(self):
        keyword_url='https://edge.flixify.vip/signed/getaddrinfo/TLS/failed/90.ts?token=fixture-only'
        for echoed in [keyword_url,'https://redirect.invalid/getaddrinfo/TLS/failed/90.ts?token=fixture-only']:
            stderr=('Error opening input file '+echoed+'.').encode()
            result=probe.decode_url(keyword_url,'ffmpeg',Mock(return_value=SimpleNamespace(returncode=1,stdout=b'',stderr=stderr)))
            self.assertEqual(result['failureClass'],'input-open-error')
            self.assertFalse(result['diagnostics']['dnsError']);self.assertFalse(result['diagnostics']['tlsError'])
            self.assertEqual(result['capturedStderrBytes'],len(stderr));self.assertNotIn('fixture-only',json.dumps(result))

    def test_success_has_no_failure_class_and_unknown_decoder_exit_is_explicit(self):
        working=probe.decode_url(URL,'ffmpeg',Mock(return_value=SimpleNamespace(returncode=0,stdout=b'frame=1\n',stderr=b'')))
        self.assertIsNone(working['failureClass']);self.assertEqual(working['returnCode'],0)
        failed=probe.decode_url(URL,'ffmpeg',Mock(return_value=SimpleNamespace(returncode=-9,stdout=b'',stderr=b'')))
        self.assertEqual(failed['failureClass'],'decoder-signal');self.assertEqual(failed['returnCode'],-9)

    def test_input_protocol_retains_exact_url_and_rejects_unsafe_values_before_decoder(self):
        value=probe.read_request(io.BytesIO(json.dumps({'url':URL,'streamId':'90'}).encode()))
        self.assertEqual(value,{'url':URL,'streamId':'90'})
        for url in ['http://edge.flixify.vip/path','https://other.invalid/path','https://edge.flixify.vip:444/path','https://name:secret@edge.flixify.vip/path',' https://edge.flixify.vip/path','https://edge.flixify.vip/path\n','https://edge.flixify.vip/path#fragment']:
            with self.subTest(url=url),self.assertRaisesRegex(ValueError,'invalid-signed-url'):
                probe.read_request(io.BytesIO(json.dumps({'url':url}).encode()))
        with self.assertRaisesRegex(ValueError,'input-too-large'):probe.read_request(io.BytesIO(b'x'*65537))

    def test_pinned_runner_import_and_bounded_pipes_work_offline(self):
        source=Path(__file__).with_name('live-channel-audit.py').read_bytes()
        with tempfile.TemporaryDirectory(prefix='flixify-signed-probe-offline-') as temporary:
            root=Path(temporary);os.chmod(root,0o700)
            operator=root/'operator.py';operator.write_bytes(source);operator.chmod(0o600)
            binary=root/'fixture-decoder';binary.write_text('#!/usr/bin/env python3\nimport sys\nsys.stderr.write("B"*200000+sys.argv[-1])\nsys.stdout.write("A"*200000+"\\nframe=1\\nprogress=end\\n")\n');binary.chmod(0o700)
            original_hash=probe.FFMPEG_SHA256
            try:
                probe.FFMPEG_SHA256=hashlib.sha256(binary.read_bytes()).hexdigest()
                runner=probe.load_runner(operator,binary)
                self.assertEqual(runner.__globals__['__name__'],'pinned_live_audit')
                result=probe.decode_url(URL,binary,runner)
                self.assertEqual(result['status'],'working');self.assertNotIn('token',json.dumps(result))
                completed=runner([str(binary)],15)
                self.assertLessEqual(len(completed.stdout),65536);self.assertLessEqual(len(completed.stderr),65536)
                original_directory=Path.cwd()
                try:
                    os.chdir(root)
                    with self.assertRaisesRegex(ValueError,'absolute-artifact-path-required'):probe.load_runner(Path(operator.name),Path(binary.name))
                finally:os.chdir(original_directory)
                binary.write_text('changed')
                with self.assertRaisesRegex(ValueError,'artifact-hash-mismatch'):probe.load_runner(operator,binary)
                operator.chmod(0o644)
                with self.assertRaisesRegex(ValueError,'private-artifact-required'):probe.load_runner(operator,binary)
            finally:probe.FFMPEG_SHA256=original_hash

if __name__=='__main__':unittest.main()
