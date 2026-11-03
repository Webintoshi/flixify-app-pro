import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent


def load_builder():
    spec = importlib.util.spec_from_file_location("forced_consent_builder_under_test", HERE / "build-web.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ContainerBuildCommandTests(unittest.TestCase):
    def test_creates_one_writable_build_layer_with_reviewed_limits(self):
        module = load_builder()
        command = module.container_create_command("build-name", "script", {"A": "B"})

        self.assertEqual(command[:3], ("docker", "create", "--name"))
        self.assertIn("--network", command)
        self.assertEqual(command[command.index("--network") + 1], "none")
        self.assertEqual(command[command.index("--memory") + 1], "1280m")
        self.assertEqual(command[command.index("--memory-swap") + 1], "1536m")
        self.assertIn("A=B", command)
        self.assertEqual(command[-4:], (module.SOURCE_ID, "node", "-e", "script"))

    def test_build_script_removes_deleted_consent_styles_before_compilation(self):
        module = load_builder()
        script = module.container_build_script()

        self.assertIn(module.DELETED_PATH, script)
        self.assertIn("rmSync", script)
        self.assertIn('execFileSync("npm"', script)

    def test_commit_restores_runtime_command_and_records_pinned_base(self):
        module = load_builder()
        base = {"Config": {"Cmd": ["npm", "start"]}}
        command = module.container_commit_command("build-name", "candidate:tag", "a" * 40, base)

        self.assertEqual(command[:2], ("docker", "commit"))
        self.assertIn('CMD ["npm", "start"]', command)
        self.assertIn("LABEL org.opencontainers.image.revision=" + "a" * 40, command)
        self.assertIn("LABEL vip.flixify.edge-recovery.base=" + module.SOURCE_ID, command)
        self.assertEqual(command[-2:], ("build-name", "candidate:tag"))


if __name__ == "__main__":
    unittest.main()
