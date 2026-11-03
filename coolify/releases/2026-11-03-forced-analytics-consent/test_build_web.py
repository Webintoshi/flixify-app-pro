import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent


def load_builder():
    spec = importlib.util.spec_from_file_location("forced_consent_builder_under_test", HERE / "build-web.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DockerBuildCommandTests(unittest.TestCase):
    def test_uses_low_disk_legacy_builder_without_buildkit_load(self):
        module = load_builder()
        command = module.docker_build_command(Path("/tmp/context"), "candidate:tag", ["--build-arg", "A=B"])

        self.assertEqual(command[:3], ("env", "DOCKER_BUILDKIT=0", "docker"))
        self.assertEqual(command[3:5], ("build", "--no-cache"))
        self.assertNotIn("--load", command)
        self.assertIn("memory=1280m", command)
        self.assertIn("memory-swap=1536m", command)
        self.assertEqual(command[-1], "/tmp/context")


if __name__ == "__main__":
    unittest.main()
