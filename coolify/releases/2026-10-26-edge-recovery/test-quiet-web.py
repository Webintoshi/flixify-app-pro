"""Small offline adapter checks; no Docker commands, streams or full suite."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("quiet_builder_adapter", "build-quiet-web.py")
release = load("quiet_release_adapter", "release-quiet-web.py")


class QuietWebTests(unittest.TestCase):
    def test_builder_only_overlays_live_page_over_observed_source(self):
        self.assertEqual(build.builder.BASE_REVISION, "2a7c60e07826fc3dd81606f8eb5534641a931bb7")
        self.assertEqual(build.builder.SOURCE_ID, release.SOURCE_ID)
        dockerfile = build.builder.dockerfile("a" * 40)
        self.assertEqual([line for line in dockerfile.splitlines() if line.startswith("COPY")],
                         ["COPY apps/ops-web/app/canli-tv/page.tsx /app/apps/ops-web/app/canli-tv/page.tsx"])
        self.assertIn("FROM flixify-ops-web:edge-recovery-2a7c60e07826-20261026", dockerfile)
        self.assertIn("vip.flixify.edge-recovery.base=" + release.SOURCE_ID, dockerfile)

    def test_resource_and_disk_guards_are_inherited(self):
        self.assertEqual(build.builder.MIN_FREE_BYTES, 8 * 1024**3)
        self.assertEqual((build.builder.RUN_MEMORY_MIB, build.builder.RUN_TOTAL_MEMORY_MIB), (1280, 1536))
        script = build.builder.build_script()
        self.assertLess(script.index("build_cgroup_limit_exceeds_cap"), script.index("cp.execFileSync"))
        self.assertIn("finally{fs.writeFileSync(p,original)", script)

    def test_release_configures_only_web_and_preserves_explicit_worker(self):
        worker_tag = "flixify-worker:edge-recovery-7731936e27df-20261026"
        worker_id = "sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3"
        release.release.configure("a" * 40, "sha256:" + "b" * 64, worker_tag, worker_id)
        guard = release.release.guard
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(guard.SOURCE, {"ops-web": release.SOURCE_TAG})
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": release.SOURCE_ID})
        self.assertEqual(guard.PROTECTED_IMAGES["worker"], (worker_tag, worker_id))

    def test_historical_modules_keep_their_original_constants(self):
        historical_build = load("historical_builder_control", "build-web.py")
        historical_release = load("historical_release_control", "release-web.py")
        self.assertEqual(historical_build.BASE_REVISION, "5002a7a32d2a54c1b882f375c2bd43dc71d9c59c")
        self.assertEqual(historical_build.SOURCE_ID, "sha256:93f913bc8f06137b83187d656d44c139b008df1ed92483f5ac82638e81db41f8")
        self.assertEqual(historical_release.SOURCE_ID, historical_build.SOURCE_ID)
        self.assertEqual(len(historical_build.PATHS), 3)


if __name__ == "__main__":
    unittest.main()
