#!/usr/bin/env python3
"""Build the shared-movie-detail guard on the exact deployed v1 API image.

This only creates a new local Docker image. It neither updates Coolify nor
restarts containers. The sole source overlay is account-library.ts, extracted
from the checked v1 image into a disposable build directory.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile


BASE_IMAGE = "flixify-api:proxy-free-movies-20261013"
BASE_IMAGE_ID = "sha256:ab019fc46d52aa556829e967b92a5cc99cde536d911103cda95592b23e9c690d"
SOURCE_SHA = "9c1a9360c0848d1959e2595fa398c967634df1a2b151c5a5be8d751b9feb06a2"
TARGET_IMAGE = "flixify-api:proxy-free-movies-v2-20261013"
SOURCE_PATH = "/app/apps/api/src/account-library.ts"


def run(*args: str, check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(
        args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        check=False, **kwargs,
    )
    if check and result.returncode:
        # Build/test output should contain no credentials, but do not dump it
        # into a terminal that may be copied into support messages.
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode})")
    return result


def digest(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match; found {count}")
    return source.replace(before, after, 1)


def route_bounds(source: str, method: str, path: str) -> tuple[int, int]:
    signature = f'app.{method}("{path}"'
    if source.count(signature) != 1:
        raise RuntimeError(f"Unexpected {path} route")
    start = source.find(signature)
    following = re.search(
        r"\n\s*app\.(?:get|post|put|patch|delete)\(", source[start + 1:]
    )
    end = start + 1 + following.start() if following else len(source)
    return start, end


def main() -> None:
    image_id = run("docker", "image", "inspect", "--format", "{{.Id}}", BASE_IMAGE).stdout.strip()
    if image_id != BASE_IMAGE_ID:
        raise RuntimeError("Unexpected v1 API image ID")
    if run("docker", "image", "inspect", TARGET_IMAGE, check=False).returncode == 0:
        raise RuntimeError("Target v2 image tag already exists")

    with tempfile.TemporaryDirectory(prefix="proxy-free-movies-v2-") as scratch:
        root = Path(scratch)
        source_file = root / "apps/api/src/account-library.ts"
        source_file.parent.mkdir(parents=True)
        extracted = subprocess.run(
            ["docker", "run", "--rm", "--network", "none", "--entrypoint", "cat",
             BASE_IMAGE, SOURCE_PATH],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if extracted.returncode:
            raise RuntimeError("Could not extract account-library.ts from exact v1 image")
        if digest(extracted.stdout) != SOURCE_SHA:
            raise RuntimeError("Unexpected account-library.ts checksum")
        source = extracted.stdout.decode("utf-8")

        source = replace_once(
            source,
            'import { getUserContext, listSeriesCatalog } from "./repository.js";',
            'import { getMovieForPlayback, getUserContext, listSeriesCatalog } from "./repository.js";',
            "repository import",
        )

        # A saved favorite can bypass the shared catalog list and reveal an
        # adult movie. Resolve shared movie rows through the filtered lookup.
        favorite_return = (
            'if(row.kind==="live" || !accountCatalog(runtime,userId,row.kind,policy))return row;'
        )
        source = replace_once(
            source,
            favorite_return,
            'if(row.kind==="movie" && !accountCatalog(runtime,userId,row.kind,policy) && '
            '!(await getMovieForPlayback(context.snapshotVersion,row.id)))return null;\n'
            '  ' + favorite_return,
            "shared favorite resolution",
        )

        route_start, route_end = route_bounds(source, "get", "/me/library/:kind/:itemId")
        route = source[route_start:route_end]
        marker = (
            'const result = await query(`WITH catalog AS (${catalogSql}) '
            'SELECT * FROM catalog WHERE kind=$2 AND id=$3`, '
            '[context.snapshotVersion, kind, itemId]);'
        )
        if route.count(marker) != 1:
            raise RuntimeError("Unexpected shared detail query")
        guard = (
            'if (kind === "movie" && '
            '!(await getMovieForPlayback(context.snapshotVersion, itemId))) {\n'
            '        return reply.code(404).send({ error: "not_found" });\n'
            '      }\n      '
        )
        patched_route = route.replace(marker, guard + marker, 1)
        source = source[:route_start] + patched_route + source[route_end:]

        # The favorites PUT route has its own raw shared-catalog INSERT path.
        # Reject filtered movies before that INSERT to prevent saving them.
        route_start, route_end = route_bounds(source, "put", "/me/favorites/:kind/:itemId")
        route = source[route_start:route_end]
        insert_marker = 'const result = await query(`WITH catalog AS (${catalogSql})'
        if route.count(insert_marker) != 1:
            raise RuntimeError("Unexpected shared favorite INSERT query")
        patched_route = route.replace(insert_marker, guard + insert_marker, 1)
        source = source[:route_start] + patched_route + source[route_end:]
        if source.count('getMovieForPlayback(context.snapshotVersion, itemId)') != 2 or \
           source.count('getMovieForPlayback(context.snapshotVersion,row.id)') != 1:
            raise RuntimeError("The three shared-movie guards were not added exactly once")
        source_file.write_text(source, encoding="utf-8")

        dockerfile = root / "Dockerfile"
        dockerfile.write_text(
            f"FROM {BASE_IMAGE}\n"
            "COPY apps/api/src/account-library.ts /app/apps/api/src/account-library.ts\n"
            "RUN npm run build -w @flixify/api\n",
            encoding="utf-8",
        )
        built = run("docker", "build", "-t", TARGET_IMAGE, "-f", str(dockerfile), str(root))
        if "Successfully" not in built.stdout and "exporting to image" not in built.stdout:
            # Docker output varies by BuildKit version; image presence is the
            # authoritative check immediately below.
            pass
        candidate_id = run("docker", "image", "inspect", "--format", "{{.Id}}", TARGET_IMAGE).stdout.strip()
        if not candidate_id.startswith("sha256:") or candidate_id == BASE_IMAGE_ID:
            raise RuntimeError("Candidate image was not created as a new image")

        tests = run(
            "docker", "run", "--rm", "--network", "none", "--entrypoint", "find",
            TARGET_IMAGE, "/app/apps/api/src", "-maxdepth", "1",
            "-name", "account-library*.test.ts", "-print",
        ).stdout.splitlines()
        relative_tests = sorted(
            test.removeprefix("/app/apps/api/") for test in tests
            if test.startswith("/app/apps/api/src/") and test.endswith(".test.ts")
        )
        if not relative_tests:
            raise RuntimeError("No account-library test file found in candidate image")
        test_result = run(
            "docker", "run", "--rm", "--network", "none",
            "-e", "DATABASE_URL=postgres://test:test@127.0.0.1:5432/test",
            "-e", "APP_JWT_SECRET=test-secret-012345678901234567890123456789",
            "-e", "ADMIN_EMAILS=admin@example.invalid",
            "-e", "SUPABASE_URL=https://example.invalid",
            "-e", "SUPABASE_JWKS_URL=https://example.invalid/jwks",
            "--entrypoint", "npm", TARGET_IMAGE,
            "test", "-w", "@flixify/api", "--", *relative_tests,
        )
        summary = [line.strip() for line in test_result.stdout.splitlines()
                   if line.strip().startswith(("Test Files", "Tests"))]
        print("Candidate image:", TARGET_IMAGE)
        print("Candidate image ID:", candidate_id)
        print("Account-library test files:", len(relative_tests))
        print(" ".join(summary[-2:]) if summary else "Account-library tests exited 0")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
