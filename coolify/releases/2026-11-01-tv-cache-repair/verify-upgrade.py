#!/usr/bin/env python3
"""Same-certificate upgrade/file-preservation and cold-launch QA on an owned emulator."""
import argparse
import hashlib
import importlib.util
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
spec=importlib.util.spec_from_file_location('cache_upgrade_profile',Path(__file__).with_name('build-web.py'));web=importlib.util.module_from_spec(spec);spec.loader.exec_module(web)
GateError=web.GateError
PACKAGE='vip.flixify.tv'
DATA='/data/user/0/'+PACKAGE+'/'
def validate_paths(paths):
    if not isinstance(paths,list) or not 3<=len(paths)<=64 or any(not isinstance(path,str) for path in paths) or len(set(paths))!=len(paths):raise GateError('reviewed_preservation_paths_required')
    for path in paths:
        if not isinstance(path,str) or not re.fullmatch(r'(?:shared_prefs|files/catalog-cache-v1|cache/artwork-v1)/[A-Za-z0-9_.-]+',path) or any(part in ('.','..') for part in path.split('/')):raise GateError('preservation_path_outside_app_scope')
    if 'shared_prefs/tv_encrypted_session.xml' not in paths or not any(path.startswith('files/catalog-cache-v1/') for path in paths) or not any(path.startswith('cache/artwork-v1/') for path in paths):raise GateError('session_metadata_and_artwork_fixtures_required')
    return tuple(paths)
def installed(output):
    fields={}
    for key in ('firstInstallTime','versionName'):
        matches=re.findall(r'^\s*'+key+r'=(.+)$',output,re.M)
        if len(matches)!=1:raise GateError('installed_package_identity_ambiguous')
        fields[key]=matches[0].strip()
    codes=re.findall(r'\bversionCode=(\d+)',output)
    if len(codes)!=1:raise GateError('installed_package_version_ambiguous')
    fields['versionCode']=int(codes[0]);return fields
def require_upgrade(before,after,old_files,new_files):
    if (before.get('versionCode'),before.get('versionName'))!=(12,'1.4.4') or (after.get('versionCode'),after.get('versionName'))!=(13,'1.4.5') or not before.get('firstInstallTime') or before['firstInstallTime']!=after.get('firstInstallTime') or not old_files or old_files!=new_files:raise GateError('upgrade_identity_or_private_file_preservation_failed')
def require_install_success(output):
    lines=[line.strip() for line in output.splitlines() if line.strip()]
    if not lines or lines[-1]!='Success' or any('Failure' in line for line in lines):raise GateError('same_certificate_install_r_failed')
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('adb','apk','apk-proof-file','preserved-paths-file','output'):parser.add_argument('--'+name,required=True,type=Path)
    parser.add_argument('--apk-proof-sha256',required=True);parser.add_argument('--serial',required=True);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not re.fullmatch(r'emulator-[0-9]{4,5}',args.serial):raise GateError('owned_emulator_serial_required')
    proof_bytes=args.apk_proof_file.read_bytes()
    if not re.fullmatch(r'[0-9a-f]{64}',args.apk_proof_sha256) or hashlib.sha256(proof_bytes).hexdigest()!=args.apk_proof_sha256:raise GateError('independent_apk_proof_digest_differs')
    proof=json.loads(proof_bytes);web.validate_apk_proof(proof_bytes,proof['nativeRevision'],proof['nativeTree'],proof['sha256'],proof['sizeBytes'])
    if args.apk.is_symlink() or not args.apk.is_file() or args.apk.stat().st_size!=proof['sizeBytes'] or hashlib.sha256(args.apk.read_bytes()).hexdigest()!=proof['sha256']:raise GateError('reviewed_upgrade_apk_differs')
    paths=validate_paths(json.loads(args.preserved_paths_file.read_bytes()))
    def command(*values,timeout=45,binary=False):
        try:result=subprocess.run([str(args.adb),'-s',args.serial,*values],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
        except (OSError,subprocess.TimeoutExpired):raise GateError('bounded_emulator_operation_failed') from None
        if result.returncode or len(result.stdout)>8*1024*1024 or len(result.stderr)>65536:raise GateError('bounded_emulator_operation_failed')
        return result.stdout if binary else result.stdout.decode('utf8')
    if command('shell','getprop','ro.kernel.qemu').strip()!='1' or command('shell','id','-u').strip()!='0':raise GateError('already_rooted_owned_emulator_required_no_security_settings_changed')
    def identity():return installed(command('shell','dumpsys','package',PACKAGE))
    def apk_hash():
        value=command('shell','pm','path',PACKAGE).strip()
        if not re.fullmatch(r'package:/data/app/[A-Za-z0-9_./~+=-]+/base\.apk',value):raise GateError('single_installed_base_apk_required')
        value=command('shell',shlex.join(['sha256sum',value.removeprefix('package:')])).split()
        if not value or not re.fullmatch(r'[0-9a-f]{64}',value[0]):raise GateError('installed_apk_digest_missing')
        return value[0]
    def files():
        rows={}
        for path in paths:
            filename=DATA+path
            script='test -f '+shlex.quote(filename)+' && test ! -L '+shlex.quote(filename)+' && sha256sum '+shlex.quote(filename)
            value=command('shell',script).split()
            if not value or not re.fullmatch(r'[0-9a-f]{64}',value[0]):raise GateError('reviewed_private_fixture_missing')
            rows[path]=value[0]
        return rows
    before=identity()
    if (before['versionCode'],before['versionName'])!=(12,'1.4.4') or apk_hash()!=web.BASELINE_APK_SHA256:raise GateError('exact_published_144_install_required')
    if not args.run:
        files();print(json.dumps({'phase':'preflight','deviceChanged':False,'device':args.serial,'old':before,'preservationPaths':list(paths),'newApkSha256':proof['sha256']}));return
    if args.output.exists() or args.output.is_symlink():raise GateError('new_upgrade_evidence_path_required')
    command('shell','am','force-stop',PACKAGE);old_files=files()
    result=command('install','-r',str(args.apk),timeout=90)
    require_install_success(result)
    after=identity();new_files=files();require_upgrade(before,after,old_files,new_files)
    if apk_hash()!=proof['sha256']:raise GateError('installed_145_apk_digest_differs')
    launch=command('shell','am','start','-W','-n',PACKAGE+'/.MainActivity',timeout=35)
    if 'Status: ok' not in launch:raise GateError('cold_launch_not_successful')
    first_pid=command('shell','pidof',PACKAGE).strip()
    if not re.fullmatch(r'[0-9]+',first_pid):raise GateError('cold_launch_pid_missing')
    time.sleep(5)
    if command('shell','pidof',PACKAGE).strip()!=first_pid:raise GateError('cold_launch_process_did_not_survive')
    logs=command('logcat','-d','--pid='+first_pid,'-v','brief',timeout=20)
    if 'FATAL EXCEPTION' in logs or 'Fatal signal' in logs:raise GateError('cold_launch_fatal_log')
    window=command('shell','dumpsys','window',timeout=20)
    focus=next((line for line in window.splitlines() if 'mCurrentFocus=' in line),'')
    if PACKAGE not in focus:raise GateError('cold_launch_app_not_focused')
    evidence={'schema':1,'device':args.serial,'ownedEmulator':True,'old':before,'new':after,'oldApkSha256':web.BASELINE_APK_SHA256,'newApkSha256':proof['sha256'],'apkProofSha256':args.apk_proof_sha256,'firstInstallTimePreserved':True,'fileDigestsBefore':old_files,'fileDigestsAfterInstall':new_files,'privateFilesPreservedBeforeLaunch':True,'sessionDecryptionVerified':False,'installMode':'adb install -r; no clear/uninstall/permission grants','coldLaunch':launch,'samePidAliveAfterSeconds':5,'noFatalAppLog':True,'appFocused':True,'providerLoginOrMediaOpenedByVerifier':False,'physicalTvVerified':False}
    with args.output.open('xb') as output:output.write((json.dumps(evidence,sort_keys=True,indent=2)+'\n').encode())
    print(json.dumps({'phase':'complete','upgradeVerified':True,'privateFilesPreservedBeforeLaunch':True,'sessionDecryptionVerified':False,'coldLaunchVerified':True,'physicalTvVerified':False}))
if __name__=='__main__':
    try:main()
    except GateError as error:print('upgrade_verification_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('upgrade_verification_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
