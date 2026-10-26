"""Offline showcase overlay proof; Docker calls are mocked, shell checks run locally."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
import types

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(filename):
    spec = importlib.util.spec_from_file_location(filename, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


adapter = load('build-catalog-showcase-web.py')
b = adapter.builder
r = load('release-catalog-showcase-web.py').release
REV = 'a' * 40
NEW = adapter.NEW_PATHS[0]
CONFIG = b'const nextConfig: NextConfig = {};'


class ShowcaseTests(unittest.TestCase):
    def preflight(self, *, entry=b'', image_error=False, git_error=False, candidate=None, candidate_path=NEW, changed=None, original=b'old', updated=b'new', image=b'old'):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if 'rev-parse' in args:
                return (b.BASE_REVISION if b.BASE_REVISION in args[-1] else REV).encode()
            if 'diff' in args:
                return '\n'.join(changed or b.PATHS).encode()
            if 'ls-tree' in args:
                if git_error:
                    raise b.GateError('git_failed')
                return entry if b.BASE_REVISION in args else (candidate if candidate is not None and args[-1] == candidate_path else b'100644 blob ' + b'c'*40 + b'\t' + args[-1].encode() + b'\0')
            if 'inspect' in args:
                return json.dumps([{'Image': b.SOURCE_ID, 'State': {'Running': True}, 'Config': {'Image': b.SOURCE_TAG, 'Labels': {'com.docker.compose.project': b.UUID}, 'Env': [k+'=test' for k in b.PUBLIC_WEB_KEYS]}}]).encode()
            if image_error:
                raise b.GateError('docker_failed')
            return b''
        def git_file(repo, rev, path):
            return CONFIG if path == b.CONFIG else (original if rev == b.BASE_REVISION else updated)
        with patch.object(b, 'command', side_effect=command), patch.object(b.core, 'image', return_value={'Id':b.SOURCE_ID}), patch.object(b.core, 'git_file', side_effect=git_file), patch.object(b, 'image_file', side_effect=lambda _,p: CONFIG if p==b.CONFIG else image):
            result = b.preflight(Path('/fixture'), REV)
        return result, calls

    def test_success_exact_manifest_and_successful_absence_commands(self):
        result, calls = self.preflight()
        self.assertEqual(tuple(result[1]), b.PATHS)
        self.assertTrue(any('ls-tree' in c and b.BASE_REVISION in c for c in calls))
        self.assertTrue(any(c[:2] == ('docker','run') and b.SOURCE_ID in c and '--network' in c for c in calls))
        self.assertEqual([x for x in b.dockerfile(REV).splitlines() if x.startswith('COPY')], [f'COPY {p} /app/{p}' for p in b.PATHS])

    def test_baseline_present_or_git_failure_rejected(self):
        for entry in (b'100644 blob empty\tpath\0', b'120000 blob link\tpath\0', b'040000 tree dir\tpath\0'):
            with self.subTest(entry=entry), self.assertRaises(b.GateError):
                self.preflight(entry=entry)
        with self.assertRaisesRegex(b.GateError, 'git_failed'):
            self.preflight(git_error=True)

    def test_git_symlink_ancestor_rejected(self):
        original = b.git_entry
        def entry(repo, rev, path):
            if rev == b.BASE_REVISION and path == 'apps/ops-web/app/platform':
                return b'120000 blob ' + b'c'*40 + b'\t' + path.encode() + b'\0'
            return original(repo, rev, path)
        with patch.object(b, 'git_entry', side_effect=entry), self.assertRaisesRegex(b.GateError,'ancestor_not_tree'):
            self.preflight()

    def test_candidate_missing_symlink_and_tree_rejected(self):
        for mode in (b'', b'120000 blob ', b'040000 tree '):
            entry = mode + b'c'*40 + b'\t' + NEW.encode() + b'\0' if mode else b''
            with self.subTest(mode=mode), self.assertRaisesRegex(b.GateError, 'not_regular_blob'):
                self.preflight(candidate=entry)

    def test_existing_candidate_requires_regular_blob(self):
        existing = b.PATHS[0]
        for mode in (b'120000 blob ', b'040000 tree ', b'', b'100600 blob '):
            entry = mode + b'c'*40 + b'\t' + existing.encode() + b'\0' if mode else b''
            with self.subTest(mode=mode), self.assertRaisesRegex(b.GateError, 'not_regular_blob:' + existing):
                self.preflight(candidate=entry, candidate_path=existing)

    def test_failed_image_invocation_rejected(self):
        with self.assertRaisesRegex(b.GateError, 'docker_failed'):
            self.preflight(image_error=True)

    def test_absence_shell_rejects_all_leaf_types_and_symlink_ancestors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            with patch.object(b, 'command') as cmd:
                b.require_image_absent(NEW)
                args = cmd.call_args.args
                script = args[args.index('-c')+1]
            self.assertEqual(subprocess.run(['sh','-c',script,'sh',str(root/'leaf')]).returncode, 0)
            for kind in ('file','empty','directory','symlink','dangling'):
                leaf=root/'leaf'
                if kind=='file': leaf.write_text('x')
                elif kind=='empty': leaf.touch()
                elif kind=='directory': leaf.mkdir()
                else: leaf.symlink_to(root if kind=='symlink' else root/'missing')
                with patch.object(b,'command') as cmd:
                    b.require_image_absent(NEW)
                    script=cmd.call_args.args[cmd.call_args.args.index('-c')+1]
                self.assertNotEqual(subprocess.run(['sh','-c',script,'sh',str(leaf)]).returncode,0,kind)
                leaf.rmdir() if kind=='directory' else leaf.unlink()
            (root/'ancestor').symlink_to(root, target_is_directory=True)
            self.assertNotEqual(subprocess.run(['sh','-c',script,'sh',str(root/'ancestor'/'absent')]).returncode,0)

    def test_scope_unchanged_and_base_mismatch_rejected(self):
        for kwargs in ({'changed': list(b.PATHS)+['apps/ops-web/app/other.ts']}, {'updated':b'old'}, {'image':b'drift'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(b.GateError): self.preflight(**kwargs)

    def test_candidate_reads_both_sources_and_rejects_corruption(self):
        base = {'Id': b.SOURCE_ID, 'RootFS': {'Layers': ['base']}, 'Config': {'Env': [], 'Labels': {}}}
        candidate = {'Id': 'sha256:'+'d'*64, 'RootFS': {'Layers': ['base', 'new']}, 'Config': {'Env': [], 'Labels': {'org.opencontainers.image.revision':REV, 'vip.flixify.edge-recovery.base':b.SOURCE_ID}}}
        updated = dict.fromkeys(b.PATHS,b'new')
        for corrupt in (None, *b.PATHS):
            calls=[]
            def image_file(image_id,path):
                calls.append(path)
                return CONFIG if path==b.CONFIG else (b'bad' if path==corrupt else b'new')
            with patch.object(b.core,'image',return_value=candidate), patch.object(b,'image_file',side_effect=image_file), patch.object(b,'command'):
                if corrupt:
                    with self.assertRaisesRegex(b.GateError,'candidate_source_differs'): b.verify_candidate(base,REV,updated,{},CONFIG)
                else:
                    self.assertEqual(b.verify_candidate(base,REV,updated,{},CONFIG),candidate['Id'])
                    self.assertEqual(calls,[*b.PATHS,b.CONFIG])

    def test_manifest_validation(self):
        for paths,new in ((b.PATHS+b.PATHS[:1], b.NEW_PATHS), (b.PATHS, ('outside',)), (('apps/ops-web/app/../bad',), ())):
            with patch.object(b,'PATHS',paths), patch.object(b,'NEW_PATHS',new), self.assertRaises(b.GateError): b.validate_manifest()

    def test_historical_defaults_and_release_pins(self):
        for filename in ('build-web.py','build-quiet-web.py','build-controls-web.py'):
            m=load(filename); historical=getattr(m,'builder',m)
            self.assertEqual(historical.NEW_PATHS,())
        r.configure(REV,'sha256:'+'b'*64,'flixify-worker:edge-recovery-7731936e27df-20261026','sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3')
        self.assertEqual(r.guard.CHANGED,('ops-web',))
        self.assertEqual(r.guard.PROTECTED,('db','api','worker'))
        self.assertEqual(r.guard.SOURCE_IDS,{'ops-web':b.SOURCE_ID})
        self.assertEqual(r.guard.SOURCE,{'ops-web':b.SOURCE_TAG})
        self.assertEqual(r.guard.PROTECTED_IMAGES['api'], (r.API_TAG,r.API_ID))
        self.assertEqual(b.BASE_REVISION,'b859dd670ab3583857d6efd8955d8f525017ce55')
        self.assertEqual(b.MIN_FREE_BYTES,8*1024**3)
        self.assertEqual((b.RUN_MEMORY_MIB,b.RUN_TOTAL_MEMORY_MIB),(1280,1536))
        self.assertLess(b.build_script().index('build_cgroup_limit_exceeds_cap'),b.build_script().index('cp.execFileSync'))


if __name__ == '__main__': unittest.main()
