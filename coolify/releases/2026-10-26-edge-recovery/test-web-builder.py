"""Offline checks for the scoped web overlay and build-only cache override."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
import types

spec = importlib.util.spec_from_file_location("edge_web_build", Path(__file__).with_name("build-web.py"))
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


class WebBuilderTests(unittest.TestCase):
    def cgroup(self, root):
        cgroup = root / "cgroup"
        cgroup.mkdir()
        (cgroup / "memory.max").write_text(str(web.RUN_MEMORY_MIB * 1024**2))
        (cgroup / "memory.swap.max").write_text(str((web.RUN_TOTAL_MEMORY_MIB - web.RUN_MEMORY_MIB) * 1024**2))
        return cgroup

    def test_only_reviewed_runtime_files_are_copied(self):
        dockerfile = web.dockerfile("a" * 40)
        copies = [line for line in dockerfile.splitlines() if line.startswith("COPY")]
        self.assertEqual(copies, [f"COPY {path} /app/{path}" for path in web.PATHS])
        self.assertEqual(set(web.PATHS), {
            "apps/ops-web/app/platform/session.tsx",
            "apps/ops-web/app/platform/onboarding.tsx",
            "apps/ops-web/app/canli-tv/page.tsx",
        })
        self.assertIn("FROM " + web.SOURCE_TAG, dockerfile)
        self.assertNotIn("COPY package", dockerfile)
        self.assertNotIn("npm ci", dockerfile)
        self.assertIn("config.cache = false", dockerfile)
        self.assertIn("webpackBuildWorker: true", dockerfile)
        self.assertIn("webpackMemoryOptimizations: true", dockerfile)
        self.assertIn("cpus: 1", dockerfile)
        self.assertEqual(sum(line.startswith("RUN ") for line in dockerfile.splitlines()), 1)

    def test_next_config_is_restored_and_cache_removed_after_success_or_failure(self):
        original = b'const nextConfig: NextConfig = {\n async headers() { return []; }\n};\nexport default nextConfig;\n'
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config = root / "next.config.ts"
                config.write_bytes(original)
                cgroup = self.cgroup(root)
                # Patch child_process only inside this fresh offline Node process.
                body = (
                    'const fs=require("node:fs"),cp=require("node:child_process");'
                    'cp.execFileSync=()=>{'
                    f'const config=fs.readFileSync({json.dumps(str(config))},"utf8");'
                    'if(!config.includes("\\n  webpack(config) { config.cache = false; return config; },"))throw Error("override_missing");'
                    'if(!config.includes("webpackBuildWorker: true")||!config.includes("cpus: 1"))throw Error("worker_limit_missing");'
                    f'fs.mkdirSync({json.dumps(str(root / ".next/cache"))},{{recursive:true}});'
                    f'fs.writeFileSync({json.dumps(str(root / ".next/BUILD_ID"))},"test");'
                    + ('throw Error("simulated_build_failure");' if fail else '') + '};'
                )
                # The builder is a self-contained script; rewriting its fixed
                # app path lets the exact code run safely in this test sandbox.
                script = web.build_script().replace("/app/apps/ops-web", str(root)).replace("/sys/fs/cgroup", str(cgroup))
                # Scope the mock declarations to avoid redeclaring fs/cp.
                result = subprocess.run(("node", "-e", "{" + body + "}" + script), capture_output=True)
                self.assertEqual(result.returncode != 0, fail, result.stderr.decode())
                self.assertEqual(config.read_bytes(), original)
                self.assertFalse((root / ".next/cache").exists())
                self.assertTrue((root / ".next/BUILD_ID").is_file())

    def test_unknown_webpack_configuration_fails_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = b'const nextConfig: NextConfig = { webpack() {} };'
            config = root / "next.config.ts"
            config.write_bytes(original)
            cgroup = self.cgroup(root)
            script = web.build_script().replace("/app/apps/ops-web", str(root)).replace("/sys/fs/cgroup", str(cgroup))
            result = subprocess.run(("node", "-e", script), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"unreviewed_next_config", result.stderr)
            self.assertEqual(config.read_bytes(), original)

    def test_missing_unbounded_or_relaxed_cgroup_stops_before_build(self):
        for value, swap in (("max", "0"), (str(2 * 1024**3), "0"), (str(web.RUN_MEMORY_MIB * 1024**2), str(1024**3)), (None, None)):
            with self.subTest(memory=value, swap=swap), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config = root / "next.config.ts"
                original = b"const nextConfig: NextConfig = {};"
                config.write_bytes(original)
                cgroup = root / "cgroup"
                cgroup.mkdir()
                if value is not None:
                    (cgroup / "memory.max").write_text(value)
                    (cgroup / "memory.swap.max").write_text(swap)
                marker = root / "build-was-invoked"
                mock = 'require("node:child_process").execFileSync=()=>require("node:fs").writeFileSync(' + json.dumps(str(marker)) + ',"unexpected");'
                script = web.build_script().replace("/app/apps/ops-web", str(root)).replace("/sys/fs/cgroup", str(cgroup))
                result = subprocess.run(("node", "-e", mock + script), capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"build_cgroup_", result.stderr)
                self.assertFalse(marker.exists())
                self.assertEqual(config.read_bytes(), original)

    def test_build_requests_both_enforced_resource_caps(self):
        with patch.object(sys, "argv", ["build-web.py", ".", "--revision", "a" * 40, "--build"]), \
             patch.object(web, "preflight", return_value=({}, {path: b"source" for path in web.PATHS}, {key: "public" for key in web.PUBLIC_WEB_KEYS}, b"config")), \
             patch.object(web.shutil, "disk_usage", return_value=types.SimpleNamespace(free=20 * 1024**3)), \
             patch.object(web, "command", return_value=b"") as command, \
             patch.object(web, "verify_candidate", return_value="sha256:accepted"):
            web.main()
            args = command.call_args.args
            self.assertEqual(args[:2], ("docker", "build"))
            self.assertIn("--load", args)
            self.assertIn("--network=none", args)
            self.assertIn("memory=1280m", args)
            self.assertIn("memory-swap=1536m", args)


if __name__ == "__main__":
    unittest.main()
