import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("smtp_build_candidates", HERE / "build-candidates.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def archive(entries):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as output:
        for path, content in entries:
            info = tarfile.TarInfo(path)
            info.size = len(content)
            output.addfile(info, io.BytesIO(content))
    return raw.getvalue()


def dependency_pin(data, count):
    return {
        **builder.DEPENDENCY,
        "bytes": len(data), "files": count,
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
    }


class CandidateInputTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((HERE / "runtime-manifest.json").read_text())

    def test_runtime_scope(self):
        self.assertEqual(builder.validate_manifest(self.manifest), self.manifest)
        for mutation in ("extra", "missing", "duplicate", "missing_original"):
            with self.subTest(mutation=mutation):
                manifest = copy.deepcopy(self.manifest)
                api = manifest["runtime"]["api"]
                if mutation == "extra":
                    api.append({**api[0], "path": "apps/api/src/repository.ts"})
                elif mutation == "missing":
                    api.pop()
                elif mutation == "duplicate":
                    api.append(api[0])
                else:
                    api[0]["beforeSha256"] = None
                with self.assertRaises(RuntimeError):
                    builder.validate_manifest(manifest)

    def test_dependency_archive_integrity(self):
        with self.assertRaisesRegex(RuntimeError, "archive identity"):
            builder.dependency_payload(b"wrong archive")

    def test_dependency_archive_contents(self):
        package = json.dumps({"name": "nodemailer", "version": "10.5.0"}).encode()
        entries = [("package/package.json", package), ("package/lib/entry.js", b"content")]
        data = archive(entries)
        with patch.object(builder, "DEPENDENCY", dependency_pin(data, len(entries))):
            self.assertEqual(builder.dependency_payload(data)["node_modules/nodemailer/lib/entry.js"], b"content")
        for invalid in ("package/../wrong", "package//lib/entry.js", "package/package.json"):
            with self.subTest(invalid=invalid):
                data = archive([*entries, (invalid, b"wrong")])
                with patch.object(builder, "DEPENDENCY", dependency_pin(data, len(entries) + 1)):
                    with self.assertRaises(RuntimeError):
                        builder.dependency_payload(data)


if __name__ == "__main__":
    unittest.main()
