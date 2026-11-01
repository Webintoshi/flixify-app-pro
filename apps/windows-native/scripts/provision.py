"""Install only checksum-pinned upstream inputs into an app-owned CI directory."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

from package_policy import safe_archive_name, sha256, verify_digest, verify_lock


def download(entry, destination):
    partial = destination.with_suffix(destination.suffix + '.part')
    with urllib.request.urlopen(entry['url'], timeout=90) as response, partial.open('wb') as output:
        total = 0
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > 512 * 1024 * 1024:
                raise ValueError('Dependency exceeds size limit')
            output.write(block)
    verify_digest(partial, entry['sha256'])
    partial.replace(destination)


def extract_7z(archive, destination, sevenzip):
    listing = subprocess.run([str(sevenzip), 'l', '-slt', '-ba', str(archive)], check=True,
                             capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    for line in listing.splitlines():
        if line.startswith('Path = '):
            safe_archive_name(line[7:])
        if 'Symbolic Link =' in line or 'Hard Link =' in line:
            raise ValueError('Unexpected link in dependency archive')
    destination.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(sevenzip), 'x', '-y', '-bd', str(archive), '-o' + str(destination)], check=True,
                   stdout=subprocess.DEVNULL)


def extract_licenses(archive, destination):
    with tarfile.open(archive) as source:
        extracted = 0
        for member in source:
            safe_archive_name(member.name)
            basename = Path(member.name).name
            if not member.isfile() or not (re.match(r'(?i)^(?:licen[cs]e|copying|copyright|notice|authors|reuse)', basename)
                                          or basename in {'qt_attribution.json', 'qt_attributions.json'}):
                continue
            if member.size > 8 * 1024 * 1024:
                raise ValueError('Unexpectedly large upstream notice')
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.extractfile(member).read())
            extracted += 1
        if not extracted:
            raise ValueError('No upstream licenses in ' + archive.name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--github-env', type=Path)
    args = parser.parse_args()
    lock = json.loads(Path(__file__).with_name('dependencies.lock.json').read_text())
    verify_lock(lock)
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 6 * 1024 ** 3:
        raise ValueError('At least 6 GiB of free build space required')
    sevenzip = shutil.which('7z') or str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / '7-Zip/7z.exe')
    subprocess.run([sevenzip, 'i'], check=True, stdout=subprocess.DEVNULL)
    cache = root / 'downloads'
    cache.mkdir(exist_ok=True)
    qt = root / 'Qt' / lock['qtVersion'] / 'msvc2022_64'
    dependencies = root / 'deps'
    report = []
    for entry in lock['archives']:
        archive = cache / entry['name']
        if not archive.is_file():
            download(entry, archive)
        verify_digest(archive, entry['sha256'])
        kind = entry['kind']
        print('Verified ' + entry['name'], flush=True)
        if kind == 'qt':
            extract_7z(archive, qt, sevenzip)
        elif kind == 'qt-licenses':
            extract_licenses(archive, dependencies / 'licenses' / 'Qt')
        elif kind == 'vlc':
            extract_7z(archive, dependencies / 'vlc', sevenzip)
        elif kind == 'nsis':
            with zipfile.ZipFile(archive) as source:
                for name in source.namelist():
                    safe_archive_name(name)
                source.extractall(dependencies / 'nsis')
        else:
            raise ValueError('Unknown dependency kind')
        report.append({'name': entry['name'], 'url': entry['url'], 'sha256': sha256(archive)})
        archive.unlink()
    (qt / 'bin' / 'qt.conf').write_text('[Paths]\nPrefix=..\n', encoding='utf-8')
    vlc_candidates = list((dependencies / 'vlc').rglob('libvlc.dll'))
    nsis_candidates = list((dependencies / 'nsis').rglob('makensis.exe'))
    if len(vlc_candidates) != 1 or len(nsis_candidates) != 1 or not (qt / 'bin' / 'windeployqt.exe').is_file():
        raise ValueError('Dependency layout incomplete')
    (dependencies / 'provenance.json').write_text(json.dumps({'inputs': report}, indent=2) + '\n')
    environment = {
        'QT_ROOT': str(qt), 'FLIXIFY_VLC_ROOT': str(vlc_candidates[0].parent),
        'NSIS_ROOT': str(nsis_candidates[0].parent), 'FLIXIFY_DEPENDENCY_ROOT': str(dependencies)
    }
    if args.github_env:
        with args.github_env.open('a', encoding='utf-8') as output:
            for key, value in environment.items():
                output.write(key + '=' + value + '\n')
    print(json.dumps({'qtVersion': lock['qtVersion'], 'vlcVersion': lock['vlcVersion'], 'verifiedInputs': len(report)}))


if __name__ == '__main__':
    main()
