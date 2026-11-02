"""Fail-closed checks shared by provisioning, packaging and their tests."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
from urllib.parse import urlparse

SMOKE_SCREENS = ('home', 'live', 'search', 'series', 'account', 'player', 'ts-player', 'mkv-player')
CODEC_FIXTURES = ('h264-mp2.ts', 'two-audio-subtitles.mkv')
REQUIRED_FILES = ('Flixify Pro.exe', 'libvlc.dll', 'libvlccore.dll', 'Qt6Core.dll',
                  'Qt6Gui.dll', 'Qt6Quick.dll', 'platforms/qwindows.dll',
                  'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
                  'qt.conf', 'licenses/THIRD-PARTY-NOTICES.md')
PERSONAL_PATTERNS = (
    rb'(?i)(?:[A-Z]:[\\/](?:Users|Documents and Settings)[\\/]|/Users/|/home/)',
    rb'(?i)[A-Z]:[\\/]a[\\/][^\x00\r\n ]+',
    rb'(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}',
    rb'(?i)(?:github_pat_|ghp_|sk_live_|AKIA)[A-Za-z0-9_-]{12,}',
    rb'(?i)(?:password|access_token|refresh_token|provider_password)\s*[=:]\s*["\x27][^"\x27\r\n]{8,}',
)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_digest(path, expected):
    if not re.fullmatch('[0-9a-f]{64}', expected) or sha256(path) != expected:
        raise ValueError('SHA256 mismatch: ' + Path(path).name)


def safe_archive_name(name):
    normalized = name.replace('\\', '/')
    path = PurePosixPath(normalized)
    if path.is_absolute() or '..' in path.parts or ':' in normalized or '\x00' in name:
        raise ValueError('Unsafe archive member')
    return normalized


def verify_lock(lock):
    if lock.get('schema') != 1 or len(lock.get('archives', [])) < 3:
        raise ValueError('Missing dependency pins')
    for archive in lock['archives']:
        parsed = urlparse(archive['url'])
        if parsed.scheme != 'https' or parsed.hostname not in {
            'download.qt.io', 'download.videolan.org', 'prdownloads.sourceforge.net'
        } or not re.fullmatch('[0-9a-f]{64}', archive.get('sha256', '')):
            raise ValueError('Invalid dependency pin: ' + archive.get('name', '?'))
        if not any(version in parsed.path for version in (lock['qtVersion'], lock['vlcVersion'], lock['nsisVersion'])):
            raise ValueError('Unversioned dependency URL')


def _privacy_matches(data):
    variants = [('bytes', 0, 1, data)]
    for encoding, expression in (('utf-16le', rb'(?:[\x20-\x7e]\x00){4,}'),
                                 ('utf-16be', rb'(?:\x00[\x20-\x7e]){4,}')):
        for string in re.finditer(expression, data):
            decoded = string.group().decode(encoding).encode('ascii')
            variants.append((encoding, string.start(), 2, decoded))
    for encoding, base, stride, variant in variants:
        for index, pattern in enumerate(PERSONAL_PATTERNS, 1):
            for match in re.finditer(pattern, variant):
                yield str(index), encoding, base + match.start() * stride, len(match.group()) * stride


def privacy_findings(data):
    return sorted({match[0] for match in _privacy_matches(data)})


def _binary_region(data, offset):
    if data[:2] != b'MZ' or len(data) < 64:
        return 'non-PE'
    try:
        pe = struct.unpack_from('<I', data, 60)[0]
        if data[pe:pe + 4] != b'PE\0\0':
            return 'invalid-PE'
        count = struct.unpack_from('<H', data, pe + 6)[0]
        size = struct.unpack_from('<H', data, pe + 20)[0]
        sections = pe + 24 + size
        for index in range(count):
            start = sections + index * 40
            raw_size, raw = struct.unpack_from('<II', data, start + 16)
            if raw <= offset < raw + raw_size:
                section = data[start:start + 8].rstrip(b'\0')
                return section.decode('ascii') if re.fullmatch(rb'[.A-Za-z0-9_]+', section) else 'other-section'
        return 'PE-header-or-overlay'
    except (struct.error, UnicodeError):
        return 'invalid-PE'


def privacy_diagnostics(data, known_assets=None, upstream_objects=None):
    findings = []
    for pattern, encoding, offset, length in _privacy_matches(data):
        context = data[max(0, offset - 32):min(len(data), offset + length + 32)]
        findings.append({
            'patternId': pattern, 'encoding': encoding, 'offset': offset, 'length': length,
            'region': _binary_region(data, offset), 'contextSha256': hashlib.sha256(context).hexdigest(),
            'knownRawAssetContexts': [name for name, content in (known_assets or {}).items() if context in content],
            'upstreamObjectContexts': [name for name, content in (upstream_objects or {}).items() if context in content]
        })
    return {'findings': findings, 'rawMatchedValuesIncluded': False,
            'legacyNulCollapsedPatternIds': sorted({str(index + 1) for index, pattern in enumerate(PERSONAL_PATTERNS)
                                                   if re.search(pattern, data.replace(b'\x00', b''))})}


def stage_findings(root):
    root = Path(root)
    errors = ['Missing required file: ' + name for name in REQUIRED_FILES if not (root / name).is_file()]
    if not any((root / 'plugins').rglob('*.dll')):
        errors.append('Missing VLC codec plugins')
    for path in root.rglob('*'):
        if path.is_symlink():
            errors.append('Symlink in package: ' + path.relative_to(root).as_posix())
        if path.suffix.lower() in {'.pdb', '.ilk', '.obj', '.lib', '.exp', '.pem', '.key', '.pfx', '.p12'}:
            errors.append('Forbidden package file: ' + path.relative_to(root).as_posix())
    if (root / 'Qt6Test.dll').exists() or (root / 'ui_smoke.exe').exists():
        errors.append('Test-only executable or QtTest runtime in final package')
    owned = [root / 'Flixify Pro.exe', root / 'qt.conf']
    for path in owned:
        if path.is_file() and privacy_findings(path.read_bytes()):
            errors.append('Personal path or credential marker in owned file: ' + path.name)
    return errors


def verify_smoke(root):
    root = Path(root)
    proof = json.loads((root / 'smoke.json').read_text(encoding='utf-8'))
    for key in ('passed', 'localMediaPlaying', 'fixtureHttp'):
        if proof.get(key) is not True:
            raise ValueError('UI smoke did not verify ' + key)
    codecs = proof.get('codecFixtures')
    if not isinstance(codecs, dict) or any(codecs.get(key) is not True for key in ('tsMp2', 'mkvTracks')):
        raise ValueError('UI smoke did not verify TS/MP2 playback and MKV track switching')
    for name in SMOKE_SCREENS:
        path = root / (name + '.png')
        if not path.is_file() or path.stat().st_size < 1024 or path.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Missing rendered screenshot: ' + name)
    return proof


def verify_install(root):
    root = Path(root)
    proof = json.loads((root / 'install-report.json').read_text(encoding='utf-8-sig'))
    for key in ('passed', 'installedExeMatchesStage', 'installedWindowStarted',
                'userDataPreservedAcrossUpgradeAndUninstall', 'uninstallerRemovedApp',
                'desktopShortcutCreated', 'startMenuShortcutCreated', 'shortcutPropertiesVerified',
                'desktopShortcutRestoredOnUpgrade', 'ownedShortcutRepairedOnUpgrade',
                'ownedShortcutsRemovedOnUninstall', 'unrelatedDesktopShortcutPreserved'):
        if proof.get(key) is not True:
            raise ValueError('Install test did not verify ' + key)
    for name in ('installed-window-report.json', 'installed-window-upgrade-report.json'):
        window = json.loads((root / name).read_text(encoding='utf-8-sig'))
        if (any(window.get(key) is not True for key in ('passed', 'closePosted', 'exitedWithinTimeout'))
                or window.get('cleanupTerminatedProcess') is not False
                or type(window.get('exitCode')) is not int or window['exitCode'] != 0
                or window.get('launchMethod') != 'desktop shortcut'
                or window.get('closeMethod') != 'WM_CLOSE to exact visible unowned Flixify Pro root window'):
            raise ValueError('Desktop shortcut launch did not exit normally: ' + name)
    return proof


def verify_codec_fixtures(root):
    root = Path(root)
    provenance = json.loads((root / 'provenance.json').read_text(encoding='utf-8'))
    hashes = provenance.get('sha256')
    if provenance.get('syntheticGeneratedLocally') is not True or not isinstance(hashes, dict) or set(hashes) != set(CODEC_FIXTURES):
        raise ValueError('Incomplete synthetic codec fixture provenance')
    for name in CODEC_FIXTURES:
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise ValueError('Missing synthetic codec fixture: ' + name)
        verify_digest(path, hashes[name])
    return provenance


def pe_imports(data):
    """Read AMD64 PE imports and delay imports without trusting executable tools."""
    if len(data) < 128 or data[:2] != b'MZ':
        raise ValueError('Not a PE image')
    pe = struct.unpack_from('<I', data, 60)[0]
    if pe + 24 > len(data) or data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Invalid PE header')
    machine, count = struct.unpack_from('<HH', data, pe + 4)
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    if machine != 0x8664 or struct.unpack_from('<H', data, optional)[0] != 0x20b:
        raise ValueError('Package contains a non-AMD64 PE image')
    sections = optional + optional_size
    image_base = struct.unpack_from('<Q', data, optional + 24)[0]

    def offset(rva):
        for index in range(count):
            start = sections + index * 40
            virtual_size, virtual_address, raw_size, raw = struct.unpack_from('<IIII', data, start + 8)
            if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
                result = raw + rva - virtual_address
                if result < len(data):
                    return result
        raise ValueError('PE import points outside image')

    def name(rva):
        begin = offset(rva)
        end = data.find(b'\0', begin, begin + 512)
        if end < 0:
            raise ValueError('Invalid PE import name')
        value = data[begin:end].decode('ascii').lower()
        if not re.fullmatch(r'[a-z0-9_.-]+\.dll', value):
            raise ValueError('Invalid DLL import name')
        return value

    imports = set()
    directories = optional + 112
    for index, stride, name_index in ((1, 20, 3), (13, 32, 1)):
        rva, size = struct.unpack_from('<II', data, directories + index * 8)
        if not rva:
            continue
        start = offset(rva)
        for position in range(start, min(start + size, len(data) - stride + 1), stride):
            fields = struct.unpack_from('<' + 'I' * (stride // 4), data, position)
            if not any(fields):
                break
            name_rva = fields[name_index]
            if index == 13 and not fields[0] & 1:
                name_rva -= image_base
            imports.add(name(name_rva))
    return sorted(imports)


def dependency_report(root, system_directory):
    root = Path(root)
    system_directory = Path(system_directory)
    images = [p for p in root.rglob('*') if p.suffix.lower() in {'.dll', '.exe'}]
    bundled = {p.name.lower() for p in images}
    report = []
    for image in images:
        imports = pe_imports(image.read_bytes())
        missing = [dll for dll in imports if dll not in bundled
                   and not dll.startswith(('api-ms-win-', 'ext-ms-win-'))
                   and not (system_directory / dll).is_file()]
        if missing:
            raise ValueError(image.relative_to(root).as_posix() + ': missing dependencies ' + ', '.join(missing))
        report.append({'file': image.relative_to(root).as_posix(), 'sha256': sha256(image), 'imports': imports})
    return report


def uninstall_manifest(root):
    """Remove the shipped payload while preserving all additional user files."""
    root = Path(root)

    def literal(path):
        relative = safe_archive_name(path.relative_to(root).as_posix())
        if any(character in relative for character in ('"', '\r', '\n')):
            raise ValueError('Unsafe NSIS filename')
        return relative.replace('$', '$$').replace('/', '\\')

    files = []
    directories = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlink in uninstall payload')
        if path.is_file():
            files.append('Delete "$INSTDIR\\' + literal(path) + '"')
        elif path.is_dir():
            directories.append(path)
    result = files + ['Delete "$INSTDIR\\Uninstall.exe"']
    for path in sorted(directories, key=lambda path: (-len(path.relative_to(root).parts), str(path))):
        result.append('RMDir "$INSTDIR\\' + literal(path) + '"')
    result.append('RMDir "$INSTDIR"')
    return '\n'.join(result) + '\n'


def prune_test_runtime(root):
    root = Path(root)
    if (root / 'ui_smoke.exe').exists():
        raise ValueError('Cannot prune the test runtime while the smoke harness remains staged')
    library = root / 'Qt6Test.dll'
    if not library.is_file():
        return False
    for image in root.rglob('*'):
        if image == library or image.suffix.lower() not in {'.exe', '.dll'}:
            continue
        if 'qt6test.dll' in pe_imports(image.read_bytes()):
            raise ValueError('Production image still requires Qt6Test.dll: ' + image.relative_to(root).as_posix())
    library.unlink()
    return True
