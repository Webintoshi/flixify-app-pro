#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v17)"
fi
script_root="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$script_root" "$@" <<'PY'
import hashlib,json,os,re,secrets,shutil,stat,subprocess,sys,uuid,zipfile
from pathlib import Path

ANDROID=Path(sys.argv[1]).resolve()
REPOSITORY=ANDROID.parent.parent
PRIVATE=Path.home()/'.codex/private/flixify-phone-android'
CONFIG=Path(os.environ.get('FLIXIFY_PHONE_SIGNING_FILE',str(PRIVATE/'phone-signing.properties'))).expanduser()
KEYS=('FLIXIFY_PHONE_KEYSTORE_PATH','FLIXIFY_PHONE_KEY_ALIAS','FLIXIFY_PHONE_STORE_PASSWORD','FLIXIFY_PHONE_KEY_PASSWORD','FLIXIFY_PHONE_SIGNER_SHA256')
class BuildError(Exception):pass

def private_file(path):
    try:
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.getuid() or path.resolve().is_relative_to(REPOSITORY):raise BuildError('Signing files must be owned 0600 regular files outside this repository.')
    except OSError:raise BuildError('Private phone signing configuration is missing or inaccessible.') from None

def load_config():
    private_file(CONFIG)
    values={}
    for line in CONFIG.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        if '=' not in line:raise BuildError('Private phone signing configuration is malformed.')
        key,value=line.split('=',1)
        if key not in KEYS or key in values or not value:raise BuildError('Private phone signing configuration is malformed.')
        values[key]=value
    if set(values)!=set(KEYS) or not re.fullmatch(r'[a-f0-9]{64}',values['FLIXIFY_PHONE_SIGNER_SHA256']):raise BuildError('Private phone signing configuration is incomplete.')
    key_path=Path(values['FLIXIFY_PHONE_KEYSTORE_PATH'])
    if not key_path.is_absolute():raise BuildError('Phone keystore path must be absolute.')
    private_file(key_path)
    return values

def keytool():
    candidate=Path(os.environ.get('JAVA_HOME',''))/'bin/keytool'
    result=str(candidate) if candidate.is_file() else shutil.which('keytool')
    if not result:raise BuildError('JDK 17 keytool is required.')
    return result

def certificate_digest(values):
    env={**os.environ,'FLIXIFY_PHONE_STORE_PASSWORD':values['FLIXIFY_PHONE_STORE_PASSWORD']}
    result=subprocess.run([keytool(),'-exportcert','-keystore',values['FLIXIFY_PHONE_KEYSTORE_PATH'],'-storetype','JKS','-storepass:env','FLIXIFY_PHONE_STORE_PASSWORD','-alias',values['FLIXIFY_PHONE_KEY_ALIAS']],env=env,capture_output=True)
    if result.returncode or not result.stdout:raise BuildError('Phone release certificate could not be verified.')
    return hashlib.sha256(result.stdout).hexdigest()

def check_signing():
    values=load_config()
    if certificate_digest(values)!=values['FLIXIFY_PHONE_SIGNER_SHA256']:raise BuildError('Phone release signing identity does not match its pinned certificate.')
    return values

def init_signing():
    if CONFIG.exists():
        values=check_signing();print('Existing private phone signing identity verified.');print('Signer SHA256:',values['FLIXIFY_PHONE_SIGNER_SHA256']);return
    if CONFIG!=PRIVATE/'phone-signing.properties':raise BuildError('Initialize the default private phone signing directory first; custom signing files are never created implicitly.')
    PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=PRIVATE.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o700 or info.st_uid!=os.getuid():raise BuildError('Phone signing directory must be owned and private (0700).')
    destination=PRIVATE/'phone-release.jks'
    if destination.exists():raise BuildError('A partial phone signing setup exists; no existing key will be overwritten.')
    lock=PRIVATE/'.initializing'
    try:lock.mkdir(mode=0o700)
    except FileExistsError:raise BuildError('Phone signing initialization is already in progress.') from None
    temporary=PRIVATE/f'.phone-release-{uuid.uuid4().hex}.jks'
    values={'FLIXIFY_PHONE_KEYSTORE_PATH':str(destination),'FLIXIFY_PHONE_KEY_ALIAS':'flixify-phone-release','FLIXIFY_PHONE_STORE_PASSWORD':secrets.token_urlsafe(36),'FLIXIFY_PHONE_KEY_PASSWORD':secrets.token_urlsafe(36)}
    env={**os.environ,**{k:v for k,v in values.items() if 'PASSWORD' in k}}
    try:
        old_mask=os.umask(0o077)
        try:
            result=subprocess.run([keytool(),'-genkeypair','-keystore',str(temporary),'-storetype','JKS','-alias',values['FLIXIFY_PHONE_KEY_ALIAS'],'-storepass:env','FLIXIFY_PHONE_STORE_PASSWORD','-keypass:env','FLIXIFY_PHONE_KEY_PASSWORD','-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10000','-dname','CN=Flixify Pro, OU=Mobile, O=Flixify Pro, C=TR','-noprompt'],env=env,capture_output=True)
        finally:os.umask(old_mask)
        if result.returncode:raise BuildError('Phone release signing identity could not be created.')
        temporary.chmod(0o600)
        probe={**values,'FLIXIFY_PHONE_KEYSTORE_PATH':str(temporary)}
        values['FLIXIFY_PHONE_SIGNER_SHA256']=certificate_digest(probe)
        os.link(temporary,destination)
        fd=os.open(CONFIG,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as stream:
            for key in KEYS:stream.write(f'{key}={values[key]}\n')
            stream.flush();os.fsync(stream.fileno())
        check_signing()
        print('Private phone release signing identity created.');print('Signing configuration:',CONFIG);print('Signer SHA256:',values['FLIXIFY_PHONE_SIGNER_SHA256'])
    finally:
        if temporary.exists():temporary.unlink()
        lock.rmdir()

def android_tools():
    sdk=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        local=ANDROID/'local.properties'
        if local.is_file():
            for line in local.read_text().splitlines():
                if line.startswith('sdk.dir='):sdk=line.split('=',1)[1].replace('\\:',':').replace('\\\\','\\')
    sdk=Path(sdk).expanduser() if sdk else Path.home()/'Library/Android/sdk'
    tools=sdk/'build-tools/36.0.0'
    if not (tools/'apksigner').is_file() or not (tools/'aapt').is_file():raise BuildError('Android build-tools 36.0.0 are required.')
    return tools

def capture(command):
    result=subprocess.run([str(part) for part in command],capture_output=True,text=True)
    if result.returncode:raise BuildError('APK verification command failed; no release proof was accepted.')
    return result.stdout

def manifest_blocks(text,kind):
    lines=text.splitlines();blocks=[]
    for index,line in enumerate(lines):
        found=re.match(r'(\s*)E: '+re.escape(kind)+r'\b',line)
        if not found:continue
        indent=len(found.group(1));end=index+1
        while end<len(lines):
            following=re.match(r'(\s*)E:',lines[end])
            if following and len(following.group(1))<=indent:break
            end+=1
        blocks.append('\n'.join(lines[index:end]))
    return blocks

def manifest_name(block):
    found=re.search(r'android:name[^=]*="([^"]+)"',block)
    return found.group(1) if found else None

def manifest_false(block,attribute):
    return bool(re.search(r'android:'+re.escape(attribute)+r'[^=]*=\(type 0x12\)0x0\b',block))

def manifest_own_attributes(block):
    return '\n'.join(block.splitlines()[0:next((index for index,line in enumerate(block.splitlines()) if index and re.match(r'\s*E:',line)),len(block.splitlines()))])

def verify_manifest_security(manifest):
    applications=manifest_blocks(manifest,'application')
    if len(applications)!=1:raise BuildError('Phone APK must declare exactly one application.')
    application=manifest_own_attributes(applications[0])
    if manifest_name(application)!='vip.flixify.tv.PhoneApplication':raise BuildError('Phone APK application identity is incorrect.')
    if (re.search(r'android:debuggable\b',application) and not manifest_false(application,'debuggable')) or not manifest_false(application,'allowBackup') or not manifest_false(application,'usesCleartextTraffic'):raise BuildError('Phone APK release debugging, backup or cleartext policy is unsafe.')
    launchers=[manifest_own_attributes(block) for block in manifest_blocks(manifest,'activity') if manifest_name(manifest_own_attributes(block))=='vip.flixify.tv.PhoneActivity']
    if len(launchers)!=1 or not re.search(r'android:exported[^=]*=\(type 0x12\)0x(?:ffffffff|1)\b',launchers[0]):raise BuildError('Phone APK launcher must be explicitly exported.')

def verify_apk(path,values):
    path=path.resolve()
    if not path.is_file() or not 32768<=path.stat().st_size<=100*1024*1024:raise BuildError('Phone APK is missing or exceeds the allowed artifact bounds.')
    tools=android_tools()
    badging=capture([tools/'aapt','dump','badging',path])
    package=re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",badging,re.M)
    if not package or package.groups()!=('vip.flixify.mobile','2','1.0.1'):raise BuildError('Phone APK package or version identity is incorrect.')
    if "sdkVersion:'23'" not in badging or "targetSdkVersion:'36'" not in badging or "launchable-activity: name='vip.flixify.tv.PhoneActivity'" not in badging:raise BuildError('Phone APK SDK or launcher identity is incorrect.')
    permissions=set(re.findall(r"uses-permission(?:-sdk-23)?: name='([^']+)'",capture([tools/'aapt','dump','permissions',path])))
    private_permission='vip.flixify.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
    platform_permissions={'android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE'}
    if permissions!=platform_permissions|{private_permission}:raise BuildError('Phone APK requests unexpected permissions.')
    manifest=capture([tools/'aapt','dump','xmltree',path,'AndroidManifest.xml'])
    verify_manifest_security(manifest)
    if 'LEANBACK_LAUNCHER' in manifest or 'vip.flixify.tv.PhoneApplication' not in manifest:raise BuildError('Phone APK contains an unexpected TV launcher or application component.')
    private_declarations=[block for block in manifest_blocks(manifest,'permission') if manifest_name(block)==private_permission]
    if len(private_declarations)!=1 or not re.search(r'android:protectionLevel[^=]*=\(type 0x11\)0x0*2\b',private_declarations[0]):raise BuildError('AndroidX receiver protection must remain app-private and signature-only.')
    providers=manifest_blocks(manifest,'provider')
    if len(providers)!=1 or manifest_name(providers[0])!='androidx.startup.InitializationProvider' or not manifest_false(providers[0],'exported') or 'vip.flixify.mobile.androidx-startup' not in providers[0]:raise BuildError('Phone APK contains an unexpected exported or update provider.')
    activities={manifest_name(block):block for block in manifest_blocks(manifest,'activity')}
    if set(activities)!={'vip.flixify.tv.PhoneActivity','vip.flixify.tv.PhonePlayerActivity'} or not manifest_false(activities['vip.flixify.tv.PhonePlayerActivity'],'exported') or manifest_false(activities['vip.flixify.tv.PhoneActivity'],'exported'):raise BuildError('Phone APK activity exposure is incorrect.')
    if manifest_blocks(manifest,'service'):raise BuildError('Phone APK contains an unexpected service.')
    signature=capture([tools/'apksigner','verify','--verbose','--print-certs',path])
    match=re.search(r'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]{64})',signature)
    if not match or match.group(1).lower()!=values['FLIXIFY_PHONE_SIGNER_SHA256'] or 'Verified using v1 scheme (JAR signing): true' not in signature or 'Verified using v2 scheme (APK Signature Scheme v2): true' not in signature:raise BuildError('Phone APK signing certificate or Android 6 signature compatibility is incorrect.')
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(('.jks','.keystore','phone-signing.properties','google-services.json')) or Path(name).name=='.env':raise BuildError('Phone APK contains an unexpected configuration or private signing file.')
            if re.fullmatch(r'classes\d*\.dex',name) and b'Lcom/google/firebase/' in archive.read(name):raise BuildError('Firebase runtime unexpectedly entered the phone APK.')
    proof={'distribution':'local-only; not published','packageName':'vip.flixify.mobile','versionName':'1.0.1','versionCode':2,'minSdk':23,'targetSdk':36,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'signerSha256':values['FLIXIFY_PHONE_SIGNER_SHA256'],'androidPlatformPermissions':sorted(platform_permissions),'appPrivateSignaturePermission':private_permission,'signatureV1V2':True,'firebaseRuntime':False,'debuggable':False,'allowBackup':False,'usesCleartextTraffic':False,'launcherExplicitlyExported':True}
    proof_path=path.with_suffix('.proof.json');proof_path.write_text(json.dumps(proof,indent=2)+'\n')
    print('Verified local phone APK:',path);print('Bytes:',proof['bytes']);print('SHA256:',proof['sha256']);print('Signer SHA256:',proof['signerSha256']);print('Proof:',proof_path)

def main():
    args=sys.argv[2:]
    if args==['--help']:
        print('Usage: build-phone-apk.sh [--init-signing | --check-signing | --verify-apk APK]');return
    if args==['--init-signing']:init_signing();return
    values=check_signing()
    if args==['--check-signing']:
        print('Private phone release signing configuration verified.');print('Signer SHA256:',values['FLIXIFY_PHONE_SIGNER_SHA256']);return
    if len(args)==2 and args[0]=='--verify-apk':verify_apk(Path(args[1]),values);return
    if args:raise BuildError('Unknown phone build arguments.')
    env={**os.environ,'FLIXIFY_PHONE_SIGNING_FILE':str(CONFIG)}
    result=subprocess.run([str(ANDROID/'gradlew'),'--no-daemon','--max-workers=2',':mobile:testDebugUnitTest',':mobile:lintRelease',':mobile:assembleRelease'],cwd=ANDROID,env=env)
    if result.returncode:raise BuildError('Phone release build or required checks failed.')
    generated=ANDROID/'mobile/build/outputs/apk/release/mobile-release.apk'
    artifact=generated.with_name('flixify-pro-android-phone-1.0.1.apk')
    shutil.copyfile(generated,artifact)
    verify_apk(artifact,values)

try:main()
except BuildError as error:print(str(error),file=sys.stderr);sys.exit(1)
except KeyboardInterrupt:sys.exit(130)
except Exception:print('Phone build stopped without accepting a release artifact.',file=sys.stderr);sys.exit(1)
PY
