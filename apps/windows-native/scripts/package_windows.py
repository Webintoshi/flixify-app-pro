"""Deploy, inspect, smoke-test and package an unsigned Windows TEST artifact."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

from package_policy import dependency_report, sha256, stage_findings, uninstall_manifest, verify_smoke


def run(arguments, **kwargs):
    subprocess.run([str(value) for value in arguments], check=True, **kwargs)


def copy_notices(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in source.rglob('*'):
        if path.is_file() and re.match(r'(?i)^(?:licen[cs]e|copying|copyright|notice|authors)', path.name):
            relative = path.relative_to(source)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            count += 1
    if not count:
        raise ValueError('Missing original third-party notices: ' + source.name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--qt', type=Path, required=True)
    parser.add_argument('--vlc', type=Path, required=True)
    parser.add_argument('--dependencies', type=Path, required=True)
    parser.add_argument('--nsis', type=Path, required=True)
    parser.add_argument('--artwork', type=Path, required=True)
    args = parser.parse_args()
    if os.name != 'nt':
        raise ValueError('Windows packaging must execute on Windows')
    source, build, output = args.source.resolve(), args.build.resolve(), args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Package output must be an empty app-owned directory')
    output.mkdir(parents=True, exist_ok=True)
    stage = output / 'portable'
    proof = output / 'proof'
    proof.mkdir()
    (proof / 'build-provenance.json').write_text(json.dumps({
        'sourceCommit': os.environ.get('GITHUB_SHA', 'local-unpublished'),
        'runnerImage': os.environ.get('ImageVersion', 'local'),
        'qt': '6.11.3', 'vlc': '3.0.24', 'nsis': '3.11',
        'msvcToolset': os.environ.get('VCToolsVersion', ''),
        'distribution': 'unsigned TEST', 'automaticRelease': False
    }, indent=2) + '\n')
    version_text = (source / 'CMakeLists.txt').read_text()
    version = re.search(r'project\(FlixifyWindows VERSION (\d+\.\d+\.\d+)', version_text).group(1)
    run(['cmake', '--install', build, '--prefix', stage, '--config', 'Release'])
    smoke_candidates = list(build.glob('ui_smoke.exe')) + list(build.glob('Release/ui_smoke.exe'))
    if len(smoke_candidates) != 1:
        raise ValueError('Missing compiled UI smoke executable')
    shutil.copy2(smoke_candidates[0], stage / 'ui_smoke.exe')
    deploy = args.qt / 'bin' / 'windeployqt.exe'
    run([deploy, '--release', '--no-compiler-runtime', '--no-translations', '--qmldir', source / 'qml',
         '--dir', stage, stage / 'Flixify Pro.exe', stage / 'ui_smoke.exe'])
    for dll in args.vlc.glob('*.dll'):
        shutil.copy2(dll, stage / dll.name)
    shutil.copytree(args.vlc / 'plugins', stage / 'plugins')
    if (args.vlc / 'lua').is_dir():
        shutil.copytree(args.vlc / 'lua', stage / 'lua')
    (stage / 'qt.conf').write_text('[Paths]\nPrefix=.\nPlugins=.\nQmlImports=qml\n', encoding='utf-8')
    licenses = stage / 'licenses'
    shutil.copytree(source / 'licenses', licenses)
    shutil.copytree(args.dependencies / 'licenses' / 'Qt', licenses / 'Qt')
    copy_notices(args.vlc, licenses / 'VLC')
    copy_notices(args.nsis, licenses / 'NSIS')
    vc_redist = Path(os.environ['VCToolsRedistDir'])
    crt = vc_redist / 'x64' / 'Microsoft.VC143.CRT'
    if not crt.is_dir():
        raise ValueError('Pinned MSVC CRT redistributable directory is missing')
    for dll in crt.glob('*.dll'):
        shutil.copy2(dll, stage / dll.name)
    shutil.copy2(args.dependencies / 'provenance.json', licenses / 'provenance.json')
    shutil.copy2(source / 'scripts' / 'dependencies.lock.json', licenses / 'dependencies.lock.json')
    for path in stage.rglob('*'):
        if path.suffix.lower() in {'.pdb', '.ilk', '.obj', '.lib', '.exp'}:
            path.unlink()
    # Run the fixture harness with only the deployed DLL/plugin search paths.
    media = output / 'fixture.avi'
    run([os.sys.executable, source / 'scripts' / 'make_smoke_media.py', media])
    isolated = output / 'smoke-profile'
    isolated.mkdir()
    environment = os.environ.copy()
    environment.update({'PATH': str(stage) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32'),
                        'QT_PLUGIN_PATH': str(stage), 'QML2_IMPORT_PATH': str(stage / 'qml'),
                        'VLC_PLUGIN_PATH': str(stage / 'plugins'), 'LOCALAPPDATA': str(isolated),
                        'APPDATA': str(isolated), 'QT_QUICK_BACKEND': 'software'})
    with (proof / 'ui-smoke.log').open('w', encoding='utf-8') as log:
        run([stage / 'ui_smoke.exe', '--output', proof, '--media', media, '--artwork-dir', args.artwork.resolve()], env=environment,
            cwd=stage, stdout=log, stderr=subprocess.STDOUT, timeout=150)
    verify_smoke(proof)
    (stage / 'ui_smoke.exe').unlink()
    errors = stage_findings(stage)
    if errors:
        raise ValueError('\n'.join(errors))
    dependencies = dependency_report(stage, Path(os.environ['SystemRoot']) / 'System32')
    (proof / 'dependency-report.json').write_text(json.dumps({'passed': True, 'images': dependencies}, indent=2) + '\n')
    (proof / 'privacy-report.json').write_text(json.dumps({
        'passed': True, 'ownedBinary': 'Flixify Pro.exe', 'ownedSha256': sha256(stage / 'Flixify Pro.exe'),
        'forbiddenPersonalPathsAndCredentials': 0, 'debugSymbols': 0,
        'scope': 'Owned application binary and configuration; upstream licenses and runtime attribution preserved.'
    }, indent=2) + '\n')
    manifest = proof / 'uninstall-payload.nsh'
    manifest.write_text(uninstall_manifest(stage), encoding='utf-8')
    installer = output / ('Flixify-Pro-Windows-' + version + '-x64-TEST-Setup.exe')
    run([args.nsis / 'makensis.exe', '/V3', '/DSTAGE_DIR=' + str(stage), '/DOUTPUT_FILE=' + str(installer),
         '/DAPP_VERSION=' + version, '/DUNINSTALL_MANIFEST=' + str(manifest), source / 'installer' / 'Flixify.nsi'], cwd=source / 'installer')
    if not installer.is_file() or installer.stat().st_size < 10 * 1024 * 1024:
        raise ValueError('Missing or implausibly small NSIS installer')
    run(['pwsh', '-NoProfile', '-File', source / 'scripts' / 'verify_install.ps1',
         '-Installer', installer, '-Stage', stage, '-Proof', proof], timeout=120)
    portable = output / ('Flixify-Pro-Windows-' + version + '-x64-TEST-portable.zip')
    with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                archive.write(path, 'Flixify Pro/' + path.relative_to(stage).as_posix())
        for path in sorted(proof.rglob('*')):
            if path.is_file():
                archive.write(path, 'diagnostics/' + path.relative_to(proof).as_posix())
    (output / 'SHA256SUMS.txt').write_text(''.join(sha256(p) + '  ' + p.name + '\n' for p in (installer, portable)))
    (proof / 'artifact-report.json').write_text(json.dumps({
        'version': version, 'architecture': 'x64', 'distribution': 'unsigned TEST',
        'installer': {'name': installer.name, 'bytes': installer.stat().st_size, 'sha256': sha256(installer)},
        'portable': {'name': portable.name, 'bytes': portable.stat().st_size, 'sha256': sha256(portable)}
    }, indent=2) + '\n')
    media.unlink()
    shutil.rmtree(isolated)
    print('Verified TEST installer and portable diagnostic ZIP created.')


if __name__ == '__main__':
    main()
