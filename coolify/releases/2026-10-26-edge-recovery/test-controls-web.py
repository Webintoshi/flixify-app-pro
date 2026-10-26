"""Focused offline adapter policy checks; no streams or live commands."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("controls_builder_adapter", "build-controls-web.py")
release = load("controls_release_adapter", "release-controls-web.py")


class ControlsWebTests(unittest.TestCase):
    def test_builder_pins_current_quiet_web_and_only_chrome_runtime_scope(self):
        self.assertEqual(build.builder.BASE_REVISION, "f8737c27d1d161d5268e8003bf53ef0a7a91147d")
        self.assertEqual(build.builder.SOURCE_ID, release.SOURCE_ID)
        dockerfile = build.builder.dockerfile("a" * 40)
        self.assertEqual([line for line in dockerfile.splitlines() if line.startswith("COPY")], [
            "COPY apps/ops-web/app/components/player-chrome.tsx /app/apps/ops-web/app/components/player-chrome.tsx",
            "COPY apps/ops-web/app/components/player-chrome-policy.ts /app/apps/ops-web/app/components/player-chrome-policy.ts",
        ])
        self.assertIn("FROM flixify-ops-web:edge-recovery-f8737c27d1d1-20261026", dockerfile)
        self.assertIn("vip.flixify.edge-recovery.base=" + release.SOURCE_ID, dockerfile)

    def test_resource_disk_and_restore_guards_are_inherited(self):
        self.assertEqual(build.builder.MIN_FREE_BYTES, 8 * 1024**3)
        self.assertEqual((build.builder.RUN_MEMORY_MIB, build.builder.RUN_TOTAL_MEMORY_MIB), (1280, 1536))
        script = build.builder.build_script()
        self.assertLess(script.index("build_cgroup_limit_exceeds_cap"), script.index("cp.execFileSync"))
        self.assertIn("finally{fs.writeFileSync(p,original)", script)

    def test_release_changes_only_web_and_preserves_explicit_worker(self):
        worker_tag = "flixify-worker:edge-recovery-7731936e27df-20261026"
        worker_id = "sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3"
        release.release.configure("a" * 40, "sha256:" + "b" * 64, worker_tag, worker_id)
        guard = release.release.guard
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(guard.SOURCE, {"ops-web": release.SOURCE_TAG})
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": release.SOURCE_ID})
        self.assertEqual(guard.PROTECTED_IMAGES["worker"], (worker_tag, worker_id))

    def test_historical_quiet_and_original_modules_remain_unchanged(self):
        quiet = load("quiet_builder_control", "build-quiet-web.py")
        original = load("original_builder_control", "build-web.py")
        self.assertEqual(quiet.builder.BASE_REVISION, "2a7c60e07826fc3dd81606f8eb5534641a931bb7")
        self.assertEqual(quiet.builder.SOURCE_ID, "sha256:1a1e54ab741b5564462ed62645a7590617420ea5005b68595676f6e63df52552")
        self.assertEqual(quiet.builder.PATHS, ("apps/ops-web/app/canli-tv/page.tsx",))
        self.assertEqual(original.BASE_REVISION, "5002a7a32d2a54c1b882f375c2bd43dc71d9c59c")
        self.assertEqual(len(original.PATHS), 3)


if __name__ == "__main__":
    unittest.main()
