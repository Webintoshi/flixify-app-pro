#!/usr/bin/env python3
"""Merge reviewed QR hunks into an exported operational API without replacing it."""
from __future__ import annotations
import argparse
import base64
import difflib
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

BASE = 'cef1a113d5c88821e78cddfd1cb6d222ce3711e2'
MODIFIED = ('apps/api/src/server.ts', 'apps/api/src/repository.ts')
NEW = tuple('apps/api/src/' + n + '.ts' for n in ('device-login', 'device-login-store', 'device-login-routes'))
PACKAGE = 'apps/api/package.json'
LOCK = 'package-lock.json'
QR_KEY = 'node_modules/qrcode-generator'
QR_INTEGRITY = 'sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g=='
OLD_AUTH = 'authenticateUser(request.headers.authorization)'
NEW_AUTH = 'authenticateUser(request.headers.authorization, request)'
SERVER_PATH_IMPORT = 'import path from "node:path";\n'
QR_SERVER_IMPORTS = (
    'import { randomUUID } from "node:crypto";\n'
    'import { DeviceLoginCrypto, DeviceLoginService, redactDeviceLinkedPayload } from "./device-login.js";\n'
    'import { DeviceLoginStore } from "./device-login-store.js";\n'
    'import { registerDeviceLoginRoutes } from "./device-login-routes.js";\n'
)
BASE_REPOSITORY_DB_IMPORT = 'import { query, withTransaction } from "./db.js";\n'
QR_REPOSITORY_DB_IMPORT = 'import { pool, query, withTransaction } from "./db.js";\n'

class GateError(RuntimeError): pass

def sha(value): return hashlib.sha256(value).hexdigest()

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], timeout=60)

def blob(repo, revision, path):
    entry = git(repo, 'ls-tree', '-z', revision, '--', path)
    if not re.fullmatch(rb'100644 blob [a-f0-9]{40}\t' + re.escape(path.encode()) + rb'\0', entry):
        raise GateError('regular_git_blob_required:' + path)
    value = git(repo, 'show', revision + ':' + path)
    if len(value) > 4 * 1024**2: raise GateError('source_blob_too_large:' + path)
    return value

def merge_text(base, changed, actual):
    """Exact anchors only: no fuzz, whitespace normalization, or canonical overwrite."""
    before, after = base.splitlines(keepends=True), changed.splitlines(keepends=True)
    operations = difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
    edits = []
    for tag, i, j, x, y in operations:
        if tag == 'equal': continue
        matches = []
        # Prefer small context, extending only through unchanged canonical lines.
        for width in range(1, 41):
            for left, right in ((width, width), (width, 0), (0, width)):
                lo, hi = max(0, i-left), min(len(before), j+right)
                if any(t != 'equal' and (a < i and b > lo or a >= j and a < hi)
                       for t, a, b, _, _ in operations if (a, b) != (i, j)):
                    continue
                old = ''.join(before[lo:hi])
                if not old or base.count(old) != 1 or actual.count(old) != 1: continue
                offset = actual.index(old) + len(''.join(before[lo:i]))
                matches.append((offset, len(''.join(before[i:j])), ''.join(after[x:y])))
            if matches: break
        if not matches or len({(m[0], m[1]) for m in matches}) != 1:
            raise GateError('nonunique_or_conflicting_hunk_at_base_line:' + str(i+1))
        edits.append(matches[0])
    ordered = sorted(edits)
    for one, two in zip(ordered, ordered[1:]):
        if one[0] + one[1] > two[0] or one[0] == two[0]: raise GateError('overlapping_patch')
    result = actual
    for offset, length, replacement in reversed(ordered):
        result = result[:offset] + replacement + result[offset+length:]
    if actual == base and result != changed: raise GateError('canonical_patch_reconstruction_failed')
    return result

def merge_source(path, base, changed, actual):
    if path == 'apps/api/src/server.ts':
        prefix = SERVER_PATH_IMPORT + QR_SERVER_IMPORTS
        base_lines = base.splitlines(keepends=True)
        if (len(base_lines) < 2 or base_lines[0] != SERVER_PATH_IMPORT
                or not changed.startswith(prefix + base_lines[1])
                or any(base.count(line) or changed.count(line) != 1 for line in QR_SERVER_IMPORTS.splitlines(keepends=True))):
            raise GateError('canonical_server_import_shape_differs')
        anchor = list(re.finditer('^' + re.escape(SERVER_PATH_IMPORT), actual, re.MULTILINE))
        if len(anchor) != 1: raise GateError('server_path_import_not_unique')
        for module in ('./device-login.js', './device-login-store.js', './device-login-routes.js'):
            if re.search(r'''\bimport\b[^;]*\bfrom\s*["']''' + re.escape(module) + r'''["']''', actual):
                raise GateError('device_login_import_already_present')
        if re.search(r'''\bimport\b[^;]*\brandomUUID\b[^;]*\bfrom\s*["']node:crypto["']''', actual):
            raise GateError('random_uuid_import_already_present')
        # Operational imports may separate the two sides of the canonical insertion.
        changed = SERVER_PATH_IMPORT + changed[len(prefix):]
        merged = merge_text(base, changed, actual)
        return re.sub('^' + re.escape(SERVER_PATH_IMPORT), lambda match: match.group() + QR_SERVER_IMPORTS,
                      merged, count=1, flags=re.MULTILINE)
    if path == 'apps/api/src/repository.ts' and QR_REPOSITORY_DB_IMPORT in actual:
        if (base.count(BASE_REPOSITORY_DB_IMPORT) != 1 or changed.count(QR_REPOSITORY_DB_IMPORT) != 1
                or actual.count(QR_REPOSITORY_DB_IMPORT) != 1 or BASE_REPOSITORY_DB_IMPORT in actual):
            raise GateError('repository_pool_import_shape_differs')
        # The operational repository already imports pool for unrelated features.
        base = base.replace(BASE_REPOSITORY_DB_IMPORT, QR_REPOSITORY_DB_IMPORT, 1)
    return merge_text(base, changed, actual)

def dependencies(base_package, next_package, actual_package, base_lock, next_lock, actual_lock):
    bp, np, ap, bl, nl, al = (json.loads(v) for v in (base_package, next_package, actual_package, base_lock, next_lock, actual_lock))
    expected = json.loads(json.dumps(bp)); expected['dependencies']['qrcode-generator'] = '^2.0.4'
    if np != expected: raise GateError('only_qrcode_dependency_addition_allowed')
    entry = nl['packages'].get(QR_KEY)
    if entry != {'version':'2.0.4', 'resolved':'https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz', 'integrity':QR_INTEGRITY, 'license':'MIT'}:
        raise GateError('qrcode_lock_entry_differs')
    expected_lock = json.loads(json.dumps(bl))
    expected_lock['packages']['apps/api']['dependencies']['qrcode-generator'] = '^2.0.4'
    expected_lock['packages'][QR_KEY] = entry
    if nl != expected_lock: raise GateError('unrelated_canonical_lock_change')
    if 'qrcode-generator' in ap['dependencies'] or QR_KEY in al['packages']:
        raise GateError('qrcode_already_present_in_actual_baseline')
    ap['dependencies']['qrcode-generator'] = '^2.0.4'
    al['packages']['apps/api']['dependencies']['qrcode-generator'] = '^2.0.4'
    al['packages'][QR_KEY] = entry
    return {PACKAGE:(json.dumps(ap, indent=2)+'\n').encode(), LOCK:(json.dumps(al, indent=2)+'\n').encode()}

def tar_files(data):
    if len(data) > 2*1024**2 or 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() != QR_INTEGRITY:
        raise GateError('qrcode_tarball_integrity_differs')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            if not path.parts or path.parts[0] != 'package' or '..' in path.parts or path.is_absolute():
                raise GateError('unsafe_tar_path')
            if item.isdir(): continue
            if not item.isfile() or item.size > 1024**2 or item.mode & 0o111:
                raise GateError('unsupported_tar_member')
            name = QR_KEY + '/' + '/'.join(path.parts[1:])
            if name in files: raise GateError('duplicate_tar_path')
            files[name] = archive.extractfile(item).read()
    pkg = json.loads(files.get(QR_KEY + '/package.json', b'{}'))
    if pkg.get('name') != 'qrcode-generator' or pkg.get('version') != '2.0.4' or pkg.get('dependencies') or pkg.get('scripts', {}).get('install'):
        raise GateError('qrcode_package_contract_differs')
    return files

def prepare(repo, revision, actual, qrcode_tarball):
    if not re.fullmatch('[a-f0-9]{40}', revision) or git(repo, 'rev-parse', revision+'^{commit}').decode().strip() != revision:
        raise GateError('exact_source_revision_required')
    git(repo, 'merge-base', '--is-ancestor', BASE, revision)
    updates, audit = {}, {}
    for path in MODIFIED:
        base, changed, live = blob(repo, BASE, path).decode(), blob(repo, revision, path).decode(), actual(path).decode()
        count = live.count(OLD_AUTH) if path.endswith('/server.ts') else 0
        if path.endswith('/server.ts'):
            # Repeated viewer calls are one explicit exact transformation; include overlay-added calls.
            base, changed = base.replace(OLD_AUTH, NEW_AUTH), changed.replace(OLD_AUTH, NEW_AUTH)
            live_for_merge = live.replace(OLD_AUTH, NEW_AUTH)
        else: live_for_merge = live
        merged = merge_source(path, base, changed, live_for_merge)
        if path.endswith('/server.ts') and OLD_AUTH in merged: raise GateError('unprojected_direct_viewer_call')
        updates[path] = merged.encode()
        audit[path] = {'actualSha256':sha(live.encode()), 'mergedSha256':sha(updates[path]), 'forwardedViewerCalls':count}
    for path in NEW:
        if git(repo, 'ls-tree', BASE, '--', path): raise GateError('new_module_in_canonical_base')
        try: actual(path)
        except FileNotFoundError: pass
        else: raise GateError('new_module_in_actual_base:' + path)
        updates[path] = blob(repo, revision, path)
    updates.update(dependencies(*(blob(repo, ref, path) if ref else actual(path)
                                 for path in (PACKAGE, LOCK) for ref in (BASE, revision, None))))
    for path, data in tar_files(qrcode_tarball).items():
        try: actual(path)
        except FileNotFoundError: pass
        else: raise GateError('qrcode_package_path_already_present')
        updates[path] = data
    return updates, audit

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path); parser.add_argument('--revision', required=True)
    parser.add_argument('--actual-root', required=True, type=Path)
    parser.add_argument('--qrcode-tarball', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    def actual(path):
        source=args.actual_root/path
        if source.is_symlink(): raise GateError('actual_source_symlink')
        return source.read_bytes()
    updates, audit = prepare(args.repo, args.revision, actual, args.qrcode_tarball.read_bytes())
    args.output.mkdir(parents=True, exist_ok=False)
    for path, data in updates.items():
        destination=args.output/path; destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(data)
    (args.output/'merge-receipt.json').write_text(json.dumps({'revision':args.revision,'base':BASE,'audit':audit,'files':{p:sha(b) for p,b in updates.items()}}, indent=2)+'\n')

if __name__ == '__main__': main()
