import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
BASE_ID = 'sha256:85892877db795825c23fc51ad3f56c77bcb503d0000f2fd35bd1c263a208f7f5'
REVISION = 'b' * 40
MARKER = 'vip.flixify.qr-device-login.flattened'
TAG = 'flixify-ops-web:qr-device-login-bbbbbbbbbbbb-20261103'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FlattenTests(unittest.TestCase):
    def setUp(self):
        self.flat = load('qr_test_flatten_' + self._testMethodName, 'flatten.py')
        self.base = {
            'Id': BASE_ID, 'Architecture': 'amd64', 'Os': 'linux',
            'RootFS': {'Type': 'layers', 'Layers': ['sha256:' + 'a' * 64, 'sha256:' + 'c' * 64]},
            'Config': {
                'Env': ['PATH=/usr/bin', 'NEXT_PUBLIC_API_BASE_URL=https://old.invalid', 'KEEP=two words'],
                'Cmd': ['npm', 'run', 'start'], 'Entrypoint': ['/bin/init', '--'],
                'WorkingDir': '/app', 'User': '1000:1000',
                'Healthcheck': {'Test': ['CMD', 'node', 'health.js'], 'Interval': 30000000000},
                'ExposedPorts': {'3000/tcp': {}}, 'StopSignal': 'SIGTERM',
                'Shell': ['/bin/sh', '-c'], 'Volumes': None,
                'Labels': {'owner': 'fixture', 'org.opencontainers.image.revision': 'a' * 40},
                'AttachStdin': False, 'OpenStdin': False, 'StdinOnce': False,
            },
        }
        self.env = {'NEXT_PUBLIC_API_BASE_URL': 'https://api.invalid', 'NEXT_PUBLIC_APP_DEMO_MODE': 'false'}

    def rootfs(self, entries):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as archive:
            for name, kind, value in entries:
                row = tarfile.TarInfo(name)
                row.mode = 0o755 if kind == 'dir' else 0o644
                if kind == 'file':
                    row.size = len(value)
                    archive.addfile(row, io.BytesIO(value))
                else:
                    row.type = {'dir': tarfile.DIRTYPE, 'link': tarfile.SYMTYPE, 'hard': tarfile.LNKTYPE}[kind]
                    if kind != 'dir': row.linkname = value
                    archive.addfile(row)
        return output.getvalue()

    def candidate(self):
        config = copy.deepcopy(self.base['Config'])
        config['Env'] = ['PATH=/usr/bin', 'NEXT_PUBLIC_API_BASE_URL=https://api.invalid', 'KEEP=two words', 'NEXT_PUBLIC_APP_DEMO_MODE=false']
        config['Labels'] = {'owner': 'fixture', 'org.opencontainers.image.revision': REVISION,
                            'vip.flixify.edge-recovery.base': BASE_ID, MARKER: 'docker-export-v1'}
        return {'Id': 'sha256:' + 'd' * 64, 'Architecture': 'amd64', 'Os': 'linux',
                'Config': config, 'RootFS': {'Type': 'layers', 'Layers': ['sha256:' + 'e' * 64]}}

    def test_archive_preserves_runtime_config_and_exact_exported_layer(self):
        original = copy.deepcopy(self.base)
        data = self.rootfs([('app', 'dir', ''), ('app/config', 'file', b'compiled\n'),
                            ('absolute-link', 'link', '/app/config'), ('config-hard', 'hard', 'app/config')])
        with tempfile.TemporaryDirectory() as directory:
            rootfs = Path(directory) / 'rootfs.tar'
            rootfs.write_bytes(data)
            output = io.BytesIO()
            receipt = self.flat.write_archive(output, rootfs, self.base, REVISION, self.env, TAG)
        with tarfile.open(fileobj=io.BytesIO(output.getvalue())) as archive:
            manifest = json.load(archive.extractfile('manifest.json'))
            self.assertEqual(len(manifest), 1)
            self.assertEqual(manifest[0]['RepoTags'], [TAG])
            self.assertEqual(manifest[0]['Layers'], ['rootfs/layer.tar'])
            config_bytes = archive.extractfile(manifest[0]['Config']).read()
            self.assertEqual(manifest[0]['Config'], hashlib.sha256(config_bytes).hexdigest() + '.json')
            self.assertEqual(set(archive.getnames()), {'manifest.json', manifest[0]['Config'], 'rootfs/layer.tar'})
            self.assertEqual(archive.extractfile('rootfs/layer.tar').read(), data)
        config = json.loads(config_bytes)
        self.assertEqual(config['config'], self.candidate()['Config'])
        self.assertEqual(config['rootfs'], {'type': 'layers', 'diff_ids': ['sha256:' + hashlib.sha256(data).hexdigest()]})
        self.assertEqual((config['os'], config['architecture']), ('linux', 'amd64'))
        self.assertEqual(receipt['diffId'], 'sha256:' + hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt['bytes'], len(data))
        self.assertEqual(self.base, original)

    def test_archive_rejects_traversal_duplicate_whiteout_and_bad_hardlinks(self):
        cases = [
            [('app/../../escape', 'file', b'x')], [('/absolute', 'file', b'x')],
            [('app', 'file', b'a'), ('app', 'file', b'b')],
            [('app/.wh.deleted', 'file', b'')], [('link', 'hard', '../outside')],
        ]
        for entries in cases:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                rootfs = Path(directory) / 'rootfs.tar'
                rootfs.write_bytes(self.rootfs(entries))
                output = io.BytesIO()
                with self.assertRaises(self.flat.FlattenError):
                    self.flat.write_archive(output, rootfs, self.base, REVISION, self.env, TAG)
                self.assertEqual(output.getvalue(), b'')

    def test_archive_rejects_symlink_input_and_non_qr_or_unaccepted_base(self):
        with tempfile.TemporaryDirectory() as directory:
            rootfs = Path(directory) / 'rootfs.tar'
            rootfs.write_bytes(self.rootfs([('app', 'dir', '')]))
            linked = Path(directory) / 'link.tar'
            linked.symlink_to(rootfs)
            for source, base, tag in ((linked, self.base, TAG), (rootfs, dict(self.base, Id='sha256:' + 'f' * 64), TAG),
                                      (rootfs, self.base, 'flixify-api:qr-device-login-bbbbbbbbbbbb-20261103')):
                with self.subTest(tag=tag, source=source), self.assertRaises(self.flat.FlattenError):
                    self.flat.write_archive(io.BytesIO(), source, base, REVISION, self.env, tag)

    def test_flat_guard_requires_exact_base_labels_single_layer_and_all_config(self):
        accepted = self.candidate()
        self.flat.verify_flat_candidate(accepted, self.base, REVISION, self.env, accepted['RootFS']['Layers'][0])
        defects = ['layer-count', 'layer-digest', 'base', 'marker', 'extra-label', 'env', 'entrypoint', 'health', 'arch', 'unknown-config']
        for defect in defects:
            candidate = copy.deepcopy(accepted)
            base = copy.deepcopy(self.base)
            if defect == 'layer-count': candidate['RootFS']['Layers'].append('sha256:' + 'f' * 64)
            elif defect == 'layer-digest': candidate['RootFS']['Layers'] = ['sha256:' + 'f' * 64]
            elif defect == 'base': base['Id'] = 'sha256:' + 'f' * 64
            elif defect == 'marker': candidate['Config']['Labels'][MARKER] = 'anything'
            elif defect == 'extra-label': candidate['Config']['Labels']['unreviewed'] = 'yes'
            elif defect == 'env': candidate['Config']['Env'].append('UNREVIEWED=1')
            elif defect == 'entrypoint': candidate['Config']['Entrypoint'] = ['/bin/sh']
            elif defect == 'health': candidate['Config']['Healthcheck']['Test'] = ['NONE']
            elif defect == 'arch': candidate['Architecture'] = 'arm64'
            elif defect == 'unknown-config': candidate['Config']['OpenStdin'] = True
            with self.subTest(defect=defect), self.assertRaises(self.flat.FlattenError):
                self.flat.verify_flat_candidate(candidate, base, REVISION, self.env, accepted['RootFS']['Layers'][0])

    def test_release_accepts_only_marked_flat_web_and_keeps_api_ancestry(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release = load('qr_test_flat_release', 'release.py')
        api_base = {'Id': release.BASELINES['api'][1], 'RootFS': {'Layers': ['api-base']}, 'Config': {'Labels': {}}}
        api_id = 'sha256:' + 'f' * 64
        api_candidate = {'Id': api_id, 'RootFS': {'Layers': ['api-base', 'api-candidate']},
                         'Config': {'Labels': {'org.opencontainers.image.revision': REVISION,
                                               'vip.flixify.edge-recovery.base': api_base['Id']}}}
        web_candidate = self.candidate()
        release.configure(REVISION, {'api': api_id, 'ops-web': web_candidate['Id']})
        images = {release.guard.TARGET['api']: api_candidate, release.guard.TARGET['ops-web']: web_candidate,
                  api_base['Id']: api_base, self.base['Id']: self.base}
        with patch.object(release.guard, 'image', side_effect=lambda ref: images[ref]):
            self.assertEqual(release.guard.candidate_images(), {'api': api_id, 'ops-web': web_candidate['Id']})
            del web_candidate['Config']['Labels'][MARKER]
            with self.assertRaises(release.api.GateError): release.guard.candidate_images()
            web_candidate['Config']['Labels'][MARKER] = 'docker-export-v1'
            api_candidate['RootFS']['Layers'] = ['single-api-layer']
            api_candidate['Config']['Labels'][MARKER] = 'docker-export-v1'
            with self.assertRaises(release.api.GateError): release.guard.candidate_images()

    def test_stream_copy_fails_before_consuming_reserved_disk_or_oversized_export(self):
        for maximum, free in ((3, 10 * 1024**3), (100, self.flat.RESERVE_BYTES + 3)):
            destination = io.BytesIO()
            with patch.object(self.flat.shutil, 'disk_usage', return_value=type('Disk', (), {'free': free})()):
                with self.assertRaises(self.flat.FlattenError):
                    self.flat.copy_export(io.BytesIO(b'1234'), destination, Path('/tmp'), maximum)
            self.assertEqual(destination.getvalue(), b'')

    def test_web_flat_candidate_still_requires_every_owned_source_and_restored_next_config(self):
        web = load('qr_test_flat_web_sources', 'build-web.py')
        candidate = self.candidate()
        source = {'apps/ops-web/app/cihaz/page.tsx': b'reviewed QR source'}
        files = dict(source, **{web.builder.CONFIG: b'original next config'})
        with patch.object(web.builder.core, 'image', return_value=candidate), \
             patch.object(web.builder, 'image_file', side_effect=lambda image, path: files[path]), \
             patch.object(web, 'command', return_value=b''):
            self.assertEqual(web.verify_candidate(self.base, REVISION, source, self.env, b'original next config'), candidate['Id'])
            files['apps/ops-web/app/cihaz/page.tsx'] = b'wrong source'
            with self.assertRaises(web.m.GateError):
                web.verify_candidate(self.base, REVISION, source, self.env, b'original next config')
            files.update(source)
            files[web.builder.CONFIG] = b'build-only cache override'
            with self.assertRaises(web.m.GateError):
                web.verify_candidate(self.base, REVISION, source, self.env, b'original next config')

    def test_process_streams_archive_without_buffering_or_disclosing_child_errors(self):
        data = self.flat._stream([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"exported")'], lambda source: source.read())
        self.assertEqual(data, b'exported')
        self.flat._stream([sys.executable, '-c', 'import sys;raise SystemExit(0 if sys.stdin.buffer.read()==b"archive" else 1)'],
                          lambda destination: destination.write(b'archive'), importing=True)
        with self.assertRaisesRegex(self.flat.FlattenError, '^flat_web_export_failed$'):
            self.flat._stream([sys.executable, '-c', 'import sys;sys.stderr.write("private diagnostic");raise SystemExit(2)'], lambda source: source.read())

    def test_compiler_is_frozen_and_loaded_layer_digest_is_checked(self):
        name = 'flixify-qr-web-build-' + 'a' * 12
        owned = '1' * 64
        row = {'Id': owned, 'Name': '/' + name, 'Image': BASE_ID, 'Mounts': [],
               'HostConfig': {'NetworkMode': 'none'}, 'State': {'Running': True}}
        data = self.rootfs([('app', 'dir', ''), ('app/compiled', 'file', b'compiled bytes')])
        candidate = self.candidate()
        candidate['RootFS']['Layers'] = ['sha256:' + hashlib.sha256(data).hexdigest()]
        archived = []

        def command(*args, **kwargs):
            if args in (('docker', 'inspect', name), ('docker', 'inspect', owned)):
                return json.dumps([row]).encode()
            if args == ('docker', 'stop', '--time', '10', owned):
                row['State']['Running'] = False
                return b''
            if args == ('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', TAG): return b''
            if args == ('docker', 'image', 'inspect', TAG): return json.dumps([candidate]).encode()
            self.fail('unexpected command: ' + str(args[:3]))

        def stream(args, transfer, **kwargs):
            self.assertFalse(row['State']['Running'], 'export must follow the confirmed stop')
            if args == ['docker', 'export', owned]: return transfer(io.BytesIO(data))
            self.assertEqual(args, ['docker', 'load', '--quiet'])
            output = io.BytesIO()
            result = transfer(output)
            archived.append(output.getvalue())
            return result

        with patch.object(self.flat, '_stream', side_effect=stream), \
             patch.object(self.flat.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 20 * 1024**3})()):
            self.assertEqual(self.flat.flatten_compiled(command, self.base, REVISION, self.env, name, TAG), candidate['Id'])
            candidate['RootFS']['Layers'] = ['sha256:' + '0' * 64]
            with self.assertRaisesRegex(self.flat.FlattenError, 'export_digest_mismatch'):
                self.flat.flatten_compiled(command, self.base, REVISION, self.env, name, TAG)
        with tarfile.open(fileobj=io.BytesIO(archived[0])) as archive:
            self.assertEqual(archive.extractfile('rootfs/layer.tar').read(), data)

    def test_load_cannot_start_without_projected_disk_space_or_with_compiler_mounts(self):
        name = 'flixify-qr-web-build-' + 'a' * 12
        owned = '1' * 64
        row = {'Id': owned, 'Name': '/' + name, 'Image': BASE_ID, 'Mounts': [],
               'HostConfig': {'NetworkMode': 'none'}, 'State': {'Running': False}}
        data = self.rootfs([('app', 'dir', ''), ('app/compiled', 'file', b'compiled bytes')])

        def command(*args, **kwargs):
            if args[:2] == ('docker', 'inspect'): return json.dumps([row]).encode()
            if args == ('docker', 'stop', '--time', '10', owned): return b''
            if args == ('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', TAG): return b''
            self.fail('low disk must block image load/inspection')

        def stream(args, transfer, **kwargs):
            self.assertEqual(args, ['docker', 'export', owned], 'low disk must block image load')
            return transfer(io.BytesIO(data))

        with patch.object(self.flat, '_stream', side_effect=stream), \
             patch.object(self.flat.shutil, 'disk_usage', return_value=type('Disk', (), {'free': self.flat.RESERVE_BYTES + len(data)})()):
            with self.assertRaisesRegex(self.flat.FlattenError, 'projected_disk_reserve_required'):
                self.flat.flatten_compiled(command, self.base, REVISION, self.env, name, TAG)
        row['Mounts'] = [{'Type': 'bind', 'Source': '/private', 'Destination': '/app'}]
        with self.assertRaisesRegex(self.flat.FlattenError, 'identity_or_mounts_changed'):
            self.flat.flatten_compiled(command, self.base, REVISION, self.env, name, TAG)


if __name__ == '__main__':
    unittest.main()
