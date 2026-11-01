import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('codec_probe', Path(__file__).with_name('live-channel-codec-probe.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
URL = 'https://edge.flixify.vip/signed/path/150.ts?token=private-fixture'
INPUT = b'''Input #0, mpegts, from 'https://edge.flixify.vip/private':
  Stream #0:0[0x100]: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 50 fps, 50 tbr
  Stream #0:1[0x101](tur): Audio: mp2, 48000 Hz, stereo, fltp, 192 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
  Stream #0:1 -> #0:1 (mp2 (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Stream #0:0: Video: wrapped_avframe, yuv420p, 640x360, 25 fps
  Stream #0:1: Audio: pcm_s16le, 48000 Hz, stereo
[out#0/null] video:14KiB audio:113KiB subtitle:0KiB other streams:0KiB
'''


class CodecProbeTests(unittest.TestCase):
    def decode(self, stderr=INPUT, stdout=b'frame=30\nprogress=end\n', code=0):
        runner = Mock(return_value=SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr))
        return probe.decode_url(URL, '/private/ffmpeg', runner), runner

    def test_single_https_decoder_decodes_both_tracks_with_fixed_bounds(self):
        result, runner = self.decode()
        args, timeout = runner.call_args.args
        runner.assert_called_once()
        self.assertEqual(args[args.index('-i') + 1], URL)
        self.assertEqual(args[args.index('-protocol_whitelist') + 1], 'https,tls,tcp,crypto')
        self.assertEqual(args[args.index('-loglevel') + 1], 'info')
        self.assertEqual(args[args.index('-analyzeduration') + 1], '1000000')
        self.assertEqual(args[args.index('-frames:v') + 1], '30')
        self.assertEqual(args[args.index('-frames:a') + 1], '30')
        self.assertIn('0:a:0?', args)
        self.assertNotIn('-an', args)
        self.assertEqual(timeout, 15)
        self.assertEqual(result, {'status': 'working', 'videoCodec': 'h264', 'audioCodec': 'mp2', 'width': 1920, 'height': 1080, 'fps': 50.0, 'decodedFrames': 30, 'audioDecoded': True})

    def test_reports_input_codecs_instead_of_null_output_conversion(self):
        for codec in ['aac', 'aac_latm', 'ac3', 'eac3', 'mp2', 'mp3']:
            result, _ = self.decode(stderr=INPUT.replace(b'Audio: mp2,', f'Audio: {codec},'.encode()))
            self.assertEqual(result['audioCodec'], codec)
            self.assertEqual(result['videoCodec'], 'h264')
            self.assertEqual((result['width'], result['height'], result['fps']), (1920, 1080, 50.0))

    def test_no_audio_or_missing_audio_bytes_never_invents_audio_decode(self):
        result, _ = self.decode(stderr=b'Input #0, mpegts, from [url]:\n  Stream #0:0: Video: hevc (Main), yuv420p, 1280x720, 29.97 fps\nStream mapping:\nOutput #0, null:\n')
        self.assertEqual(result['videoCodec'], 'hevc')
        self.assertEqual(result['fps'], 29.97)
        self.assertIsNone(result['audioCodec'])
        self.assertFalse(result['audioDecoded'])
        result, _ = self.decode(stderr=INPUT.replace(b'audio:113KiB', b'audio:0KiB'))
        self.assertEqual(result['audioCodec'], 'mp2')
        self.assertFalse(result['audioDecoded'])

    def test_output_only_or_unknown_metadata_never_leaks_arbitrary_tokens(self):
        result, _ = self.decode(stderr=b'Output #0, null:\n  Stream #0:0: Video: h264, 999x888, 25 fps\n')
        self.assertIsNone(result['videoCodec'])
        self.assertIsNone(result['width'])
        result, _ = self.decode(stderr=b'Input #0, mpegts, from [url]:\n  Stream #0:0: Video: privatecodec, 999999x999999, 99999 fps\n  Stream #0:1: Audio: secretcodec, 48000 Hz\nStream mapping:\n')
        self.assertEqual(result['videoCodec'], 'other')
        self.assertEqual(result['audioCodec'], 'other')
        self.assertIsNone(result['width'])
        self.assertIsNone(result['fps'])
        self.assertNotIn('privatecodec', json.dumps(result))
        self.assertNotIn('secretcodec', json.dumps(result))

    def test_failure_timeout_and_partial_frames_are_sanitized_without_retries(self):
        for code in [401, 403, 404, 410, 429, 503]:
            result, runner = self.decode(stderr=f'HTTP error {code} denied {URL}'.encode(), code=1)
            self.assertEqual(result['status'], 'blocked' if code in {401, 403, 429} else 'unverified')
            self.assertEqual(result['decodedFrames'], 0)
            self.assertNotIn('private-fixture', json.dumps(result))
            runner.assert_called_once()
        runner = Mock(side_effect=subprocess.TimeoutExpired(['ffmpeg', URL], 15, stderr=INPUT))
        result = probe.decode_url(URL, '/private/ffmpeg', runner)
        self.assertEqual(result['status'], 'timeout')
        self.assertEqual(result['decodedFrames'], 0)
        self.assertNotIn(URL, json.dumps(result))
        runner.assert_called_once()

    def test_url_echo_cannot_forge_stream_metadata_or_http_failure(self):
        malicious = 'https://edge.flixify.vip/Audio:secretcodec/1920x1080/50fps?token=403'
        stderr = ('Error opening input file ' + malicious + '\n').encode()
        result = probe.decode_url(malicious, '/private/ffmpeg', Mock(return_value=SimpleNamespace(returncode=1, stdout=b'', stderr=stderr)))
        self.assertIsNone(result['audioCodec'])
        self.assertIsNone(result['videoCodec'])
        self.assertEqual(result['status'], 'undecodable')

    def test_nonzero_or_missing_frames_never_reports_working_or_audio_decoded(self):
        for code, output in [(1, b'frame=30\n'), (0, b'progress=end\n'), (0, b'frame=99999999\n')]:
            result, _ = self.decode(stdout=output, code=code)
            self.assertEqual(result['status'], 'undecodable')
            self.assertEqual(result['decodedFrames'], 0)
            self.assertFalse(result['audioDecoded'])

    def test_request_validation_preserves_signed_url_and_rejects_unsafe_or_unbounded_input(self):
        request = {'url': URL, 'streamId': '150'}
        self.assertEqual(probe.read_request(io.BytesIO(json.dumps(request).encode())), request)
        for url in ['http://edge.flixify.vip/path', 'https://foreign.invalid/path', 'https://edge.flixify.vip:444/path', 'https://name:secret@edge.flixify.vip/path', URL + '\n', URL + '#fragment']:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'invalid-signed-url'):
                probe.read_request(io.BytesIO(json.dumps({'url': url}).encode()))
        for value in [{'url': URL, 'streamId': '0150'}, {'url': URL, 'extra': 'private'}, {'url': URL, 'streamId': 150}]:
            with self.assertRaises(ValueError):
                probe.read_request(io.BytesIO(json.dumps(value).encode()))
        with self.assertRaisesRegex(ValueError, 'input-too-large'):
            probe.read_request(io.BytesIO(b'x' * 65537))

    def test_frozen_bounded_runner_and_artifact_identity_offline(self):
        source = Path(__file__).with_name('live-channel-audit.py').read_bytes()
        with tempfile.TemporaryDirectory(prefix='flixify-codec-fixture-') as directory:
            root = Path(directory)
            operator = root / 'operator.py'; operator.write_bytes(source); operator.chmod(0o600)
            binary = root / 'decoder'; binary.write_text('#!/usr/bin/env python3\nimport sys\nsys.stdout.write("frame=30\\n")\nsys.stderr.write("X"*200000)\n'); binary.chmod(0o700)
            original = probe.FFMPEG_SHA256
            try:
                probe.FFMPEG_SHA256 = hashlib.sha256(binary.read_bytes()).hexdigest()
                runner = probe.load_runner(operator, binary)
                completed = runner([str(binary)], 15)
                self.assertLessEqual(len(completed.stderr), 65536)
                self.assertEqual(completed.stdout, b'frame=30\n')
                binary.write_text('changed')
                with self.assertRaisesRegex(ValueError, 'artifact-hash-mismatch'):
                    probe.load_runner(operator, binary)
                operator.chmod(0o644)
                with self.assertRaisesRegex(ValueError, 'private-artifact-required'):
                    probe.load_runner(operator, binary)
                with self.assertRaisesRegex(ValueError, 'absolute-artifact-path-required'):
                    probe.load_runner(Path('operator.py'), binary)
            finally:
                probe.FFMPEG_SHA256 = original


if __name__ == '__main__':
    unittest.main()
