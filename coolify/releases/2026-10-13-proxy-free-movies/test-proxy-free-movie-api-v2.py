#!/usr/bin/env python3
"""Run the v2 image's account-library tests with its legacy mock extended.

This extracts the exact existing test file, adds the repository method newly
used by v2, then mounts the test file read-only into a disposable container.
It does not rebuild the image, change Coolify, or touch running containers.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile


IMAGE = "flixify-api:proxy-free-movies-v2-20261013"
IMAGE_ID = "sha256:c98c538c8862e33e0186ea33bdf61d627a27aa7704a41d9167dc5071ccfe51b4"
TEST_PATH = "/app/apps/api/src/account-library.test.ts"
TEST_SHA = "e4dc9c431d78f1915479768fce083fb3344f55c64c1badde426428a31d6ff26d"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, check=False)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}")
    return result


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match; found {count}")
    return source.replace(old, new, 1)


def main() -> None:
    actual_id = run("docker", "image", "inspect", "--format", "{{.Id}}", IMAGE).stdout.strip()
    if actual_id != IMAGE_ID:
        raise RuntimeError("Unexpected v2 API image ID")
    extracted = subprocess.run(
        ["docker", "run", "--rm", "--network", "none", "--entrypoint", "cat",
         IMAGE, TEST_PATH],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if extracted.returncode or hashlib.sha256(extracted.stdout).hexdigest() != TEST_SHA:
        raise RuntimeError("Unexpected account-library test source")
    source = extracted.stdout.decode("utf-8")
    source = replace_once(
        source,
        "const mocks = vi.hoisted(() => ({ query: vi.fn(), context: vi.fn() }));",
        "const mocks = vi.hoisted(() => ({ query: vi.fn(), context: vi.fn(), movie: vi.fn() }));",
        "mock declarations",
    )
    source = replace_once(
        source,
        'vi.mock("./repository.js", () => ({ getUserContext: mocks.context, listSeriesCatalog: vi.fn() }));',
        'vi.mock("./repository.js", () => ({ getUserContext: mocks.context, '
        'getMovieForPlayback: mocks.movie, listSeriesCatalog: vi.fn() }));',
        "repository mock",
    )
    source = replace_once(
        source,
        "mocks.context.mockReset().mockResolvedValue({ snapshotVersion: 7, canViewCatalog: true, canPlay: true });",
        "mocks.context.mockReset().mockResolvedValue({ snapshotVersion: 7, canViewCatalog: true, canPlay: true }); "
        "mocks.movie.mockReset().mockResolvedValue({ id: item });",
        "default safe movie result",
    )
    with tempfile.TemporaryDirectory(prefix="account-library-v2-test-") as scratch:
        mounted = Path(scratch) / "account-library.test.ts"
        mounted.write_text(source, encoding="utf-8")
        result = run(
            "docker", "run", "--rm", "--network", "none",
            "-v", f"{mounted}:{TEST_PATH}:ro",
            "-e", "DATABASE_URL=postgres://test:test@127.0.0.1:5432/test",
            "-e", "APP_JWT_SECRET=test-secret-012345678901234567890123456789",
            "-e", "ADMIN_EMAILS=admin@example.invalid",
            "-e", "SUPABASE_URL=https://example.invalid",
            "-e", "SUPABASE_JWKS_URL=https://example.invalid/jwks",
            "--entrypoint", "npm", IMAGE,
            "test", "-w", "@flixify/api", "--", "src/account-library.test.ts",
            check=False,
        )
        summary = [line.strip() for line in result.stdout.splitlines()
                   if line.strip().startswith(("Test Files", "Tests"))]
        print(" ".join(summary[-2:]) if summary else "No test summary emitted")
        if result.returncode:
            raise RuntimeError(f"Account-library tests exited {result.returncode}")
    print("v2 account-library tests passed with test-only repository mock")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
