#!/usr/bin/env python3
"""Pinned1.4.1 Android download publication; read-only preflight by default."""
import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

spec=importlib.util.spec_from_file_location("startup_reviewed_apk_build",Path(__file__).with_name("build-tv-direct-web.py"))
reviewed=importlib.util.module_from_spec(spec);spec.loader.exec_module(reviewed)
builder,core,GateError,command=reviewed.builder,reviewed.core,reviewed.GateError,reviewed.command
SOURCE_TAG="flixify-ops-web:edge-recovery-38b22d4b23e6-20261026"
SOURCE_ID="sha256:6cbd625e42a2fb61e330f90d13789f3083ea6342422cbb0593d3016e1707ca4c"
RUNTIME_REVISION="38b22d4b23e6161aca5413b53faf8d2ffb842d0f"
BASE_REVISION="b967fa670b1c4bc5957ff7b08ef7cf3ba7eb1c6d"
ACCEPTED_NATIVE_REVISION="4404db9362ed654ae6a205a2b33665f663a43e7b"
DESCRIPTOR="apps/ops-web/app/platform/tv-download.ts"
APK="apps/ops-web/public/downloads/flixify-pro-1.4.1.apk"
UPDATE_MANIFEST="apps/ops-web/public/downloads/flixify-tv-update.json"
PATHS=(DESCRIPTOR,)
NEW_PATHS=()
TOOL_PATHS=tuple("coolify/releases/2026-10-26-edge-recovery/"+name for name in ("build-tv-startup-web.py","release-tv-startup-web.py","test-tv-startup-web.py"))
GRADLE="apps/tv-android/app/build.gradle"
ANDROID_MANIFEST="apps/tv-android/app/src/main/AndroidManifest.xml"
APK_URL="https://flixify.vip/downloads/flixify-pro-1.4.1.apk"
MAX_APK_BYTES=32*1024*1024
BASELINE_MANIFEST_SHA256="49aced337dd56d0603700694496334cf3a97310c015d65d42fbdf1b366ffaca2"
BASELINE_MANIFEST_BYTES=428
for module in (reviewed,reviewed.style,builder):
    module.SOURCE_TAG,module.SOURCE_ID,module.BASE_REVISION=SOURCE_TAG,SOURCE_ID,BASE_REVISION
    module.PATHS,module.NEW_PATHS=PATHS,NEW_PATHS

def require_native_pin():
    if not re.fullmatch(r"[0-9a-f]{40}",ACCEPTED_NATIVE_REVISION):raise GateError("accepted_native_revision_missing")
    return ACCEPTED_NATIVE_REVISION

def changed(repo,first,last,*paths):
    return command("git","-C",str(repo),"diff","--name-only",first,last,"--",*paths).decode().splitlines()

def reviewed_support(path):
    return path in TOOL_PATHS or path=="coolify/README.md" or (path.startswith("docs/") and path.endswith(".md"))

def validate_source_scope(repo,revision):
    builder.target(revision);native=require_native_pin()
    for exact in (RUNTIME_REVISION,BASE_REVISION,native,revision):
        if command("git","-C",str(repo),"rev-parse",exact+"^{commit}").decode().strip()!=exact:raise GateError("startup_revision_not_exact")
    for first,last in ((RUNTIME_REVISION,BASE_REVISION),(BASE_REVISION,native),(native,revision)):
        command("git","-C",str(repo),"merge-base","--is-ancestor",first,last)
    if changed(repo,RUNTIME_REVISION,BASE_REVISION,"apps/ops-web"):raise GateError("startup_runtime_base_differs")
    for path in changed(repo,BASE_REVISION,native):
        if not path.startswith("apps/tv-android/") and not reviewed_support(path):raise GateError("startup_unaccepted_native_scope:"+path)
    native_tree=command("git","-C",str(repo),"rev-parse",native+":apps/tv-android")
    if native_tree!=command("git","-C",str(repo),"rev-parse",revision+":apps/tv-android"):raise GateError("startup_native_tree_changed_after_freeze")
    publication=set(changed(repo,native,revision))
    if not {DESCRIPTOR,APK,UPDATE_MANIFEST}<=publication:raise GateError("startup_publication_missing_required_file")
    for path in publication:
        if path not in (DESCRIPTOR,APK,UPDATE_MANIFEST) and not reviewed_support(path):raise GateError("startup_publication_outside_allowlist:"+path)

def validate_versions(repo,revision):
    native=require_native_pin();original=core.git_file(repo,BASE_REVISION,DESCRIPTOR)
    if original.count(b"flixify-pro-1.4.0.apk")!=2 or original.count(b'"1.4.0"')!=1:raise GateError("startup_descriptor_baseline_differs")
    if core.git_file(repo,revision,DESCRIPTOR)!=original.replace(b"1.4.0",b"1.4.1"):raise GateError("startup_descriptor_outside_version_replacement")
    gradle=core.git_file(repo,native,GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]",rb"(?m)^\s*minSdk\s+23\s*$",rb"(?m)^\s*versionCode\s+9\s*$",rb"(?m)^\s*versionName\s+['\"]1\.4\.1['\"]\s*$"):
        if len(re.findall(pattern,gradle))!=1:raise GateError("startup_native_version_differs")
    if core.git_file(repo,native,ANDROID_MANIFEST).count(b'android:label="Flixify Pro"')!=1:raise GateError("startup_native_label_differs")

def parse_manifest(data,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=64*1024:raise GateError("startup_update_manifest_size_invalid")
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise GateError("startup_update_manifest_duplicate_key")
            result[key]=value
        return result
    try:manifest=json.loads(data.decode("utf-8"),object_pairs_hook=unique)
    except (ValueError,UnicodeError):raise GateError("startup_update_manifest_invalid") from None
    expected={"packageName":"vip.flixify.tv","versionName":"1.4.1","versionCode":9,"minSdk":23,"apkUrl":APK_URL,"sha256":sha256,"sizeBytes":size}
    if not isinstance(manifest,dict) or set(manifest)!=set(expected)|{"notes"}:raise GateError("startup_update_manifest_schema_invalid")
    if any(manifest[key]!=value or type(manifest[key]) is not type(value) for key,value in expected.items()):raise GateError("startup_update_manifest_pin_differs")
    notes=manifest["notes"]
    if (not isinstance(notes,str) or sum(2 if ord(character)>0xffff else 1 for character in notes)>2048
            or re.search(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]",notes)):
        raise GateError("startup_update_manifest_notes_invalid")
    return manifest

def validate_artifacts(repo,revision,sha256,size):
    if not isinstance(sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",sha256) or type(size) is not int or not 1024<=size<=MAX_APK_BYTES:raise GateError("startup_apk_pin_invalid")
    status=command("git","-C",str(repo),"diff","--name-status",BASE_REVISION,revision,"--","apps/ops-web/public").decode().splitlines()
    if set(status)!={"A\t"+APK,"M\t"+UPDATE_MANIFEST}:raise GateError("startup_public_changes_differ")
    baseline=builder.git_entry(repo,BASE_REVISION,UPDATE_MANIFEST)
    if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t"+re.escape(UPDATE_MANIFEST.encode())+rb"\x00",baseline):raise GateError("startup_baseline_manifest_not_regular")
    baseline_size=command("git","-C",str(repo),"cat-file","-s",BASE_REVISION+":"+UPDATE_MANIFEST).decode().strip()
    if baseline_size!=str(BASELINE_MANIFEST_BYTES):raise GateError("startup_baseline_manifest_size_differs")
    if hashlib.sha256(core.git_file(repo,BASE_REVISION,UPDATE_MANIFEST)).hexdigest()!=BASELINE_MANIFEST_SHA256:raise GateError("startup_baseline_manifest_digest_differs")
    values={}
    for path in (APK,UPDATE_MANIFEST):
        entry=builder.git_entry(repo,revision,path)
        if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t"+re.escape(path.encode())+rb"\x00",entry):raise GateError("startup_public_artifact_not_regular:"+path)
        if path==APK and builder.git_entry(repo,BASE_REVISION,path):raise GateError("startup_public_artifact_already_exists")
        blob_size=command("git","-C",str(repo),"cat-file","-s",revision+":"+path).decode().strip()
        if not blob_size.isdecimal() or (path==APK and int(blob_size)!=size) or (path==UPDATE_MANIFEST and not 1<=int(blob_size)<=64*1024):raise GateError("startup_public_artifact_size_invalid")
        for ancestor in Path(path).parents:
            if str(ancestor)==".":continue
            existing=builder.git_entry(repo,BASE_REVISION,str(ancestor))
            if existing and not existing.startswith(b"040000 tree "):raise GateError("startup_public_ancestor_not_directory")
        if path==APK:builder.require_image_absent(path)
        values[path]=core.git_file(repo,revision,path)
    if len(values[APK])!=size or not values[APK].startswith(b"PK\x03\x04") or hashlib.sha256(values[APK]).hexdigest()!=sha256:raise GateError("startup_apk_bytes_differ")
    parse_manifest(values[UPDATE_MANIFEST],sha256,size)
    return values

def expected_public_manifest(original,sha256,size,manifest):
    rows=json.loads(reviewed.canonical_public_manifest(original));entries={row[1]:row for row in rows}
    if entries.get("downloads",[None])[0]!="dir":raise GateError("startup_downloads_directory_differs")
    manifest_path=UPDATE_MANIFEST.removeprefix("apps/ops-web/public/")
    if entries.get(manifest_path)!=["file",manifest_path,0o644,BASELINE_MANIFEST_BYTES,BASELINE_MANIFEST_SHA256]:raise GateError("startup_baseline_manifest_image_differs")
    rows=[row for row in rows if row[1]!=manifest_path]
    for path,length,digest in ((APK,size,sha256),(UPDATE_MANIFEST,len(manifest),hashlib.sha256(manifest).hexdigest())):
        relative=path.removeprefix("apps/ops-web/public/")
        if path==APK and relative in entries:raise GateError("startup_new_public_path_already_exists")
        rows.append(["file",relative,0o644,length,digest])
    return reviewed.canonical_public_manifest(json.dumps(rows).encode())

def dockerfile(revision):
    value=builder.dockerfile(revision)
    if value.count("\nRUN node -e ")!=1:raise GateError("startup_compile_layer_differs")
    additions="".join(f"\nCOPY {path} /app/{path}" for path in (APK,UPDATE_MANIFEST))
    return value.replace("\nRUN node -e ",additions+"\nRUN node -e ",1)

def download_verification_script(sha256,size,manifest):
    parse_manifest(manifest,sha256,size)
    url="http://127.0.0.1:3000/downloads/flixify-pro-1.4.1.apk"
    manifest_url="http://127.0.0.1:3000/downloads/flixify-tv-update.json"
    return (
        'const crypto=require("node:crypto");(async()=>{const u='+json.dumps(url)+';let h;'
        'for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.ok)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'if(!h||h.status!==200||Number(h.headers.get("content-length"))!=='+str(size)+'||!h.headers.get("content-type")?.includes("application/vnd.android.package-archive"))throw Error("apk_head_invalid");'
        'const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});'
        'if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/'+str(size)+'"||(await r.arrayBuffer()).byteLength!==32)throw Error("apk_range_invalid");'
        'const response=await fetch(u,{signal:AbortSignal.timeout(10000)});if(response.status!==200)throw Error("apk_get_status_invalid");'
        'const b=Buffer.from(await response.arrayBuffer());if(b.length!=='+str(size)+'||crypto.createHash("sha256").update(b).digest("hex")!=='+json.dumps(sha256)+')throw Error("apk_get_digest_invalid");'
        'const m=await fetch('+json.dumps(manifest_url)+',{signal:AbortSignal.timeout(10000)});if(m.status!==200||!m.headers.get("content-type")?.includes("application/json"))throw Error("manifest_get_invalid");'
        'const j=Buffer.from(await m.arrayBuffer());if(j.length!=='+str(len(manifest))+'||crypto.createHash("sha256").update(j).digest("hex")!=='+json.dumps(hashlib.sha256(manifest).hexdigest())+')throw Error("manifest_get_digest_invalid");'
        'const value=JSON.parse(j.toString("utf8"));if(value.packageName!=="vip.flixify.tv"||value.versionCode!==9||value.minSdk!==23||value.versionName!=="1.4.1"||value.apkUrl!=='+json.dumps(APK_URL)+'||value.sha256!=='+json.dumps(sha256)+'||value.sizeBytes!=='+str(size)+')throw Error("manifest_apk_incoherent");'
        'console.log("candidate_apk_and_static_manifest_verified")})().catch(()=>{console.error("candidate_startup_download_failed");process.exit(1)})'
    )

def verify_download(candidate_id,sha256,size,manifest):
    name="flixify-tv-startup-check-"+uuid.uuid4().hex[:12]
    command("docker","run","--rm","-d","--name",name,"--network","none","--memory","512m","--memory-swap","640m","--pids-limit","128",candidate_id)
    try:command("docker","exec",name,"node","-e",download_verification_script(sha256,size,manifest),timeout=100)
    finally:
        if command("docker","inspect","--format","{{.Image}}",name).decode().strip()!=candidate_id:raise GateError("startup_check_container_drift")
        command("docker","stop","-t","10",name)

def preflight(repo,revision,sha256,size):
    validate_source_scope(repo,revision);validate_versions(repo,revision)
    artifacts=validate_artifacts(repo,revision,sha256,size)
    base,updated,web_env,config=builder.preflight(repo,revision);updated.update(artifacts)
    original_public=reviewed.public_manifest(SOURCE_ID)
    expected_public_manifest(original_public,sha256,size,artifacts[UPDATE_MANIFEST])
    return base,updated,web_env,config,original_public

def verify_candidate(base,revision,updated,web_env,config,original_public,sha256,size):
    candidate=builder.verify_candidate(base,revision,updated,web_env,config)
    if reviewed.canonical_public_manifest(reviewed.public_manifest(candidate))!=expected_public_manifest(original_public,sha256,size,updated[UPDATE_MANIFEST]):raise GateError("startup_candidate_public_tree_differs")
    verify_download(candidate,sha256,size,updated[UPDATE_MANIFEST]);return candidate

container_compile=reviewed.container_compile

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("source_repo",type=Path);parser.add_argument("--revision",required=True)
    parser.add_argument("--apk-sha256",required=True);parser.add_argument("--apk-bytes",type=int,required=True)
    actions=parser.add_mutually_exclusive_group();actions.add_argument("--build",action="store_true");actions.add_argument("--container-build",action="store_true");actions.add_argument("--verify-existing",action="store_true")
    args=parser.parse_args();base,updated,web_env,config,original_public=preflight(args.source_repo,args.revision,args.apk_sha256,args.apk_bytes)
    if not (args.build or args.container_build or args.verify_existing):print("tv_startup_web_preflight_ok; no_live_mutation; native_and_public_artifacts_pinned");return
    if args.build or args.container_build:
        if shutil.disk_usage("/var/lib/docker").free<builder.MIN_FREE_BYTES:raise GateError("insufficient_disk_web_build_requires_8GiB")
        tags=command("docker","image","ls","--format","{{.Repository}}:{{.Tag}}",builder.target(args.revision)).decode().splitlines()
        if builder.target(args.revision) in tags:raise GateError("candidate_tag_already_exists_use_verify_existing")
        if args.container_build:container_compile(args.revision,base,updated,web_env)
        else:
            with tempfile.TemporaryDirectory(prefix="flixify-tv-startup-web-") as directory:
                root=Path(directory)
                for path,value in updated.items():
                    file=root/path;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value);file.chmod(0o644)
                (root/"Dockerfile").write_text(dockerfile(args.revision))
                build_args=[argument for key,value in web_env.items() for argument in ("--build-arg",key+"="+value)]
                command("docker","build","--load","--no-cache","--rm","--force-rm","--pull=false","--network=none","--resource",f"memory={builder.RUN_MEMORY_MIB}m","--resource",f"memory-swap={builder.RUN_TOTAL_MEMORY_MIB}m","-t",builder.target(args.revision),*build_args,str(root),timeout=1200)
    candidate=verify_candidate(base,args.revision,updated,web_env,config,original_public,args.apk_sha256,args.apk_bytes)
    print("web_candidate_verified:"+candidate)

if __name__=="__main__":
    try:main()
    except GateError as error:print("build_stopped:"+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print("build_stopped:"+type(error).__name__,file=sys.stderr);sys.exit(1)
