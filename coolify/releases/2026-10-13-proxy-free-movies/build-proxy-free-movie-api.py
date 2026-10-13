#!/usr/bin/env python3
"""Build a credential-free movie-catalog overlay from the exact live trial API.

The extracted source and regression test exist only in a disposable build
directory. The running service and its database are not changed by this tool.
"""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

BASE_IMAGE = "flixify-api:trial-20261013"
BASE_IMAGE_ID = "sha256:3c85f1bc1d5ec7722b47ece1b5b9d2e7b214f617f4ddb571d6fa5a48e88ff9a4"
TARGET_IMAGE = "flixify-api:proxy-free-movies-20261013"
SERVER_SHA = "513056ecb6da7a52883df6d0eb8a12e9503018b0bc0d9628310968486c70e1b6"
FILTER_SHA = "fdb3a9b0c1fe7b1017be0c7418d71d2d0013cafc45cb4410e36f47c9cd30d289"

SAFE_GROUPS = [
    "Aile", "Aksiyon (Yabancı)", "Aksiyon (Yerli)", "Amazon", "Animasyon",
    "Apple TV+", "Belgesel", "Bilim Kurgu", "Disney+", "Dram (Yabancı)",
    "Dram (Yerli)", "Fantastik", "Filmler", "Gerilim (Yabancı)", "HBO Max",
    "Komedi (Yabancı)", "Komedi (Yerli)", "Korku (Yabancı)", "Korku (Yerli)",
    "MUBI FILMLER", "Müzik", "Netflix", "Romantik", "Savaş", "Seri Filmler",
    "Sinema", "Suç", "Tabii",
]


def run(*args: str, check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False, **kwargs)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode}):\n{result.stdout[-3000:]}")
    return result


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match; found {count}")
    return source.replace(old, new, 1)


def replace_pattern_once(source: str, pattern: str, new: str, label: str) -> str:
    result, count = re.subn(pattern, lambda _: new, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match; found {count}")
    return result


def main() -> None:
    image_id = run("docker", "image", "inspect", "--format", "{{.Id}}", BASE_IMAGE).stdout.strip()
    if image_id != BASE_IMAGE_ID:
        raise RuntimeError("Unexpected trial API image ID")

    with tempfile.TemporaryDirectory(prefix="proxy-free-movies-") as scratch:
        root = Path(scratch)
        server_path = root / "apps/api/src/server.ts"
        filter_path = root / "apps/api/src/vod-catalog-filter.ts"
        for path, expected in ((server_path, SERVER_SHA), (filter_path, FILTER_SHA)):
            path.parent.mkdir(parents=True, exist_ok=True)
            relative = path.relative_to(root)
            extracted = subprocess.run(
                ["docker", "run", "--rm", "--network", "none", "--entrypoint", "cat",
                 BASE_IMAGE, f"/app/{relative}"], stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, check=False,
            )
            if extracted.returncode:
                raise RuntimeError(f"Could not read {relative} from the exact image")
            raw = extracted.stdout
            if sha(raw) != expected:
                raise RuntimeError(f"Unexpected source checksum: {relative}")
            path.write_bytes(raw)

        regression = root / "proxy-free-movies.test.ts"
        regression.write_text('''import { expect, it } from "vitest";
import { filterStoredMovieCatalogRows, shouldUseAccountMovieCatalog } from "./vod-catalog-filter.js";
const movie = (id: string, group_title: string | null) => ({ id, title: "Inception (2010) Turkce Dublaj", poster_url: "https://cdn.example.com/a.jpg", group_title, stream_path: `movie/__IPTV_USERNAME__/__IPTV_PASSWORD__/${id}.mkv`, order_index: 1 });
it("excludes adult and unknown shared movie groups", () => {
  expect(filterStoredMovieCatalogRows([movie("safe", "Netflix"), movie("adult", "XXX:ADULTS"), movie("blank", null), movie("unknown", "New Adults Vault")]).map(row => row.id)).toEqual(["safe"]);
});
it("uses shared movies only for a hidden account without a proxy", () => {
  expect(shouldUseAccountMovieCatalog(false, {visible:false,reconcileRequired:false})).toBe(false);
  expect(shouldUseAccountMovieCatalog(false, {visible:true,reconcileRequired:false})).toBe(true);
  expect(shouldUseAccountMovieCatalog(false, {visible:false,reconcileRequired:true})).toBe(true);
});
''', encoding="utf-8")

        # The source is tested before the production code is changed.
        mount = f"{regression}:/app/apps/api/src/proxy-free-movies.test.ts:ro"
        red = run("docker", "run", "--rm", "--network", "none", "-v", mount,
                  "--entrypoint", "npm", BASE_IMAGE, "test", "-w", "@flixify/api",
                  "--", "src/proxy-free-movies.test.ts", check=False)
        if red.returncode == 0 or "excludes adult and unknown" not in red.stdout or "expected" not in red.stdout:
            raise RuntimeError("Regression test did not fail for the expected catalog bug")
        print("Regression test failed on the current live image as expected.")

        groups = "\n".join(f"  {json.dumps(group, ensure_ascii=False)}," for group in SAFE_GROUPS)
        filter_source = filter_path.read_text(encoding="utf-8")
        marker = "export function filterStoredMovieCatalogRows(rows: StoredMovieCatalogRow[]) {"
        additions = f'''// Shared snapshots do not contain provider category IDs. Unknown groups fail closed.
const safeSharedMovieGroups = new Set([\n{groups}\n]);

export function shouldUseAccountMovieCatalog(
  proxyConfigured: boolean,
  policy: {{ visible: boolean; reconcileRequired?: boolean }}
) {{
  return proxyConfigured || policy.visible || Boolean(policy.reconcileRequired);
}}

'''
        filter_source = replace_once(filter_source, marker, additions + marker, "filter helper")
        filter_source = replace_once(filter_source, "    isValidMovieCatalogEntry({",
                                     '    safeSharedMovieGroups.has(row.group_title?.trim() ?? "") && isValidMovieCatalogEntry({',
                                     "shared movie filter")
        filter_path.write_text(filter_source, encoding="utf-8")

        server_source = server_path.read_text(encoding="utf-8")
        server_source = replace_once(
            server_source,
            'import { AccountVodCatalog, useAccountVod } from "./account-vod.js";',
            'import { AccountVodCatalog, useAccountVod } from "./account-vod.js";\n'
            'import { shouldUseAccountMovieCatalog } from "./vod-catalog-filter.js";',
            "server import",
        )
        server_source = replace_pattern_once(
            server_source,
            r'const useAdultSafeMovieCatalog = \(runtime:unknown,userId:string,policy:\{[^}]+\}\) =>\s*'
            r'\(runtime==="browser"[\s\S]*?\|\| useAccountVod\(runtime,userId\);',
            'const accountVodProxyConfigured = Boolean((process.env.VOD_PROXY_URLS ?? "").trim());\n'
            'const useAdultSafeMovieCatalog = (runtime:unknown,userId:string,policy:{visible:boolean;reconcileRequired?:boolean}) =>\n'
            ' (runtime==="browser" && shouldUseAccountMovieCatalog(accountVodProxyConfigured,policy)) || useAccountVod(runtime,userId);',
            "movie catalog route",
        )
        server_source = replace_pattern_once(
            server_source,
            r'forceAccountMovieVod:policy=>adultMovieEnabled\s*\|\|\s*policy\.adultCategoryIds\.length>0\s*\|\|\s*Boolean\(policy\.reconcileRequired\),',
            'forceAccountMovieVod:policy=>shouldUseAccountMovieCatalog(accountVodProxyConfigured,policy),',
            "movie detail route",
        )
        server_path.write_text(server_source, encoding="utf-8")

        dockerfile = root / "Dockerfile"
        dockerfile.write_text(
            f"FROM {BASE_IMAGE}\n"
            "COPY apps/api/src/server.ts /app/apps/api/src/server.ts\n"
            "COPY apps/api/src/vod-catalog-filter.ts /app/apps/api/src/vod-catalog-filter.ts\n"
            "RUN npm run build -w @flixify/api\n",
            encoding="utf-8",
        )
        build = run("docker", "build", "-t", TARGET_IMAGE, "-f", str(dockerfile), str(root))
        print(build.stdout[-1600:])

        green = run("docker", "run", "--rm", "--network", "none", "-v", mount,
                    "--entrypoint", "npm", TARGET_IMAGE, "test", "-w", "@flixify/api",
                    "--", "src/proxy-free-movies.test.ts")
        print(green.stdout[-1200:])
        print("Candidate image passed the proxy-free movie regression test:", TARGET_IMAGE)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
