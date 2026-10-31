#!/usr/bin/env python3
"""Bounded search-activation website update and independently pinned Android publication; preflight by default."""
from __future__ import annotations
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

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

publication=load("live_web_previous_publication",Path(__file__).parents[1]/"2026-10-26-edge-recovery"/"build-tv-startup-web.py")
snapshot_helper=load("live_web_snapshot_helper",Path(__file__).parents[1]/"2026-10-31-live-registration"/"build-api.py")
builder,core,GateError,command=publication.builder,publication.core,publication.GateError,publication.command
SOURCE_TAG="flixify-ops-web:live-registration-40882233677b-20261031"
SOURCE_ID="sha256:0f3b05ed0f699f85afb305cdc5dc1870fba94fd856c1d4a29c4d0949d7eddee6"
BASE_REVISION="40882233677b007e2a63aed8f77bb23a4b202df8"
DESCRIPTOR="apps/ops-web/app/platform/tv-download.ts"
PATHS=tuple("apps/ops-web/app/"+path for path in ("platform/catalog-search.tsx","platform/catalog.tsx","platform/detail.tsx","platform/catalog-panels.module.css","platform/platform.module.css"))+(DESCRIPTOR,)
APK="apps/ops-web/public/downloads/flixify-pro-1.4.3.apk"
UPDATE_MANIFEST="apps/ops-web/public/downloads/flixify-tv-update.json"
APK_URL="https://flixify.vip/downloads/flixify-pro-1.4.3.apk"
GRADLE="apps/tv-android/app/build.gradle"
ANDROID_MANIFEST="apps/tv-android/app/src/main/AndroidManifest.xml"
MAX_APK_BYTES=32*1024*1024
BASELINE_MANIFEST_BYTES=378
BASELINE_MANIFEST_SHA256="f97edb5fdda3c944c01dd168f22793d6093a118913463dc00ba437a2ab77dcdd"
EXCLUDED=(*PATHS,APK,UPDATE_MANIFEST,"apps/ops-web/.next")
WORKER_TAG="flixify-worker:edge-recovery-539e01cff3c3-20261026"
WORKER_ID="sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee"
DB_ID="sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
API_TAG="flixify-api:live-registration-8645860e0552-20261031"
API_ID="sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"

def target(revision):
    if not re.fullmatch(r"[0-9a-f]{40}",revision):raise GateError("exact_revision_required")
    return "flixify-ops-web:search-activation-"+revision[:12]+"-20261031"

builder.SOURCE_TAG,builder.SOURCE_ID,builder.BASE_REVISION=SOURCE_TAG,SOURCE_ID,BASE_REVISION
builder.PATHS,builder.NEW_PATHS,builder.target=PATHS,(),target

def validate_source_scope(repo,revision,native):
    for ref in (BASE_REVISION,native,revision):
        target(ref)
        if command("git","-C",str(repo),"rev-parse",ref+"^{commit}").decode().strip()!=ref:raise GateError("web_revision_not_exact")
    for first,last in ((BASE_REVISION,native),(native,revision)):
        command("git","-C",str(repo),"merge-base","--is-ancestor",first,last)
    if command("git","-C",str(repo),"rev-parse",native+":apps/tv-android")!=command("git","-C",str(repo),"rev-parse",revision+":apps/tv-android"):raise GateError("native_tree_changed_after_accepted_freeze")
    changed=command("git","-C",str(repo),"diff","--name-only",BASE_REVISION,revision,"--","apps/ops-web").decode().splitlines()
    runtime={path for path in changed if not re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.(?:m?[jt]sx?)",path)}
    if runtime!=set((*PATHS,APK,UPDATE_MANIFEST)):raise GateError("web_runtime_or_public_overlay_scope_differs")
    for path in PATHS:builder.require_regular_blob(repo,revision,path)
    published=set(command("git","-C",str(repo),"diff","--name-only",native,revision,"--","apps/ops-web").decode().splitlines())
    if not {DESCRIPTOR,APK,UPDATE_MANIFEST}<=published:raise GateError("web_publication_missing_after_native_freeze")

def validate_versions(repo,revision,native):
    original=core.git_file(repo,BASE_REVISION,DESCRIPTOR)
    if original.count(b"flixify-pro-1.4.2.apk")!=2 or original.count(b'"1.4.2"')!=1:raise GateError("web_descriptor_baseline_differs")
    if core.git_file(repo,revision,DESCRIPTOR)!=original.replace(b"1.4.2",b"1.4.3"):raise GateError("web_descriptor_outside_version_replacement")
    gradle=core.git_file(repo,native,GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]",rb"(?m)^\s*minSdk\s+23\s*$",rb"(?m)^\s*targetSdk\s+35\s*$",rb"(?m)^\s*versionCode\s+11\s*$",rb"(?m)^\s*versionName\s+['\"]1\.4\.3['\"]\s*$"):
        if len(re.findall(pattern,gradle))!=1:raise GateError("web_native_version_differs")
    if core.git_file(repo,native,ANDROID_MANIFEST).count(b'android:label="Flixify Pro"')!=1:raise GateError("web_native_label_differs")

def parse_manifest(data,sha256,size):
    if not isinstance(data,bytes) or not 1<=len(data)<=64*1024:raise GateError("web_update_manifest_size_invalid")
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise GateError("web_update_manifest_duplicate_key")
            result[key]=value
        return result
    try:value=json.loads(data.decode("utf8"),object_pairs_hook=unique)
    except (ValueError,UnicodeError):raise GateError("web_update_manifest_invalid") from None
    expected={"packageName":"vip.flixify.tv","versionName":"1.4.3","versionCode":11,"minSdk":23,"apkUrl":APK_URL,"sha256":sha256,"sizeBytes":size}
    if not isinstance(value,dict) or set(value)!=set(expected)|{"notes"} or any(value[key]!=item or type(value[key]) is not type(item) for key,item in expected.items()):raise GateError("web_update_manifest_pin_differs")
    notes=value["notes"]
    if not isinstance(notes,str) or sum(2 if ord(ch)>0xffff else 1 for ch in notes)>2048 or re.search(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]",notes):raise GateError("web_update_manifest_notes_invalid")
    return value

def regular_public_blob(repo,revision,path):
    if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t"+re.escape(path.encode())+rb"\x00",builder.git_entry(repo,revision,path)):raise GateError("web_public_artifact_not_regular:"+path)

def validate_artifacts(repo,revision,sha256,size):
    if not isinstance(sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",sha256) or type(size) is not int or not 1024<=size<=MAX_APK_BYTES:raise GateError("web_apk_pin_invalid")
    status=command("git","-C",str(repo),"diff","--name-status",BASE_REVISION,revision,"--","apps/ops-web/public").decode().splitlines()
    if set(status)!={"A\t"+APK,"M\t"+UPDATE_MANIFEST}:raise GateError("web_public_changes_differ")
    regular_public_blob(repo,BASE_REVISION,UPDATE_MANIFEST)
    if command("git","-C",str(repo),"cat-file","-s",BASE_REVISION+":"+UPDATE_MANIFEST).decode().strip()!=str(BASELINE_MANIFEST_BYTES) or hashlib.sha256(core.git_file(repo,BASE_REVISION,UPDATE_MANIFEST)).hexdigest()!=BASELINE_MANIFEST_SHA256:raise GateError("web_baseline_manifest_differs")
    values={}
    for path in (APK,UPDATE_MANIFEST):
        regular_public_blob(repo,revision,path)
        length=command("git","-C",str(repo),"cat-file","-s",revision+":"+path).decode().strip()
        if not length.isdecimal() or (path==APK and int(length)!=size) or (path==UPDATE_MANIFEST and not 1<=int(length)<=64*1024):raise GateError("web_public_artifact_size_invalid")
        for ancestor in Path(path).parents:
            if str(ancestor)==".":continue
            entry=builder.git_entry(repo,BASE_REVISION,str(ancestor))
            if entry and not entry.startswith(b"040000 tree "):raise GateError("web_public_ancestor_not_tree")
        if path==APK:
            if builder.git_entry(repo,BASE_REVISION,path):raise GateError("web_new_apk_already_exists")
            builder.require_image_absent(path)
        values[path]=core.git_file(repo,revision,path)
    if not values[APK].startswith(b"PK\x03\x04") or len(values[APK])!=size or hashlib.sha256(values[APK]).hexdigest()!=sha256:raise GateError("web_apk_bytes_differ")
    parse_manifest(values[UPDATE_MANIFEST],sha256,size)
    return values

canonical_public_manifest=publication.reviewed.canonical_public_manifest
public_manifest=publication.reviewed.public_manifest

def expected_public_manifest(original,sha256,size,manifest):
    rows=json.loads(canonical_public_manifest(original));entries={row[1]:row for row in rows}
    relative=UPDATE_MANIFEST.removeprefix("apps/ops-web/public/")
    if entries.get("downloads",[None])[0]!="dir" or entries.get(relative)!=["file",relative,0o644,BASELINE_MANIFEST_BYTES,BASELINE_MANIFEST_SHA256]:raise GateError("web_source_public_manifest_differs")
    apk=APK.removeprefix("apps/ops-web/public/")
    if apk in entries:raise GateError("web_new_apk_path_not_absent")
    rows=[row for row in rows if row[1]!=relative]
    rows.extend([["file",apk,0o644,size,sha256],["file",relative,0o644,len(manifest),hashlib.sha256(manifest).hexdigest()]])
    return canonical_public_manifest(json.dumps(rows).encode())

def snapshot_script():return "const fs=require('node:fs');"+snapshot_helper.snapshot_function()+"console.log(JSON.stringify(snapshot('/app',"+json.dumps(EXCLUDED)+")));"
def untouched(image):
    return json.loads(command("docker","run","--rm","--network","none","--memory","512m","--memory-swap","640m","--pids-limit","128","--entrypoint","node",image,"-e",snapshot_script(),timeout=180))
def validate_source_fingerprint(sha256,files):
    if not isinstance(sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",sha256) or type(files) is not int or files<1:raise GateError("independent_source_fingerprint_required")
    return {"sha256":sha256,"files":files}

def require_untouched(before,after):
    if before!=after:raise GateError("web_untouched_source_dependencies_or_public_assets_changed")

def protected_snapshot(api_tag,api_id):
    if (api_tag,api_id)!=(API_TAG,API_ID):raise GateError("accepted_protected_api_pins_required")
    pins={"api":(api_tag,api_id),"worker":(WORKER_TAG,WORKER_ID),"db":("postgres:16-alpine",DB_ID),"ops-web":(SOURCE_TAG,SOURCE_ID)}
    rows=json.loads(command("docker","inspect",*(name+"-"+core.UUID for name in pins)));result={}
    if not isinstance(rows,list) or len(rows)!=len(pins):raise GateError("web_protected_container_set_differs")
    for row in rows:
        name=row["Name"].removeprefix("/").removesuffix("-"+core.UUID)
        if name not in pins or name in result or (row["Config"]["Image"],row["Image"])!=pins[name] or not row["State"]["Running"] or (row["State"].get("Health") or {}).get("Status")=="unhealthy" or (row["Config"].get("Labels") or {}).get("com.docker.compose.project")!=core.UUID:raise GateError("web_protected_container_drift")
        data={key:row.get(key) for key in ("Id","Image","Config","HostConfig","Mounts","RestartCount")};data["Networks"]=(row.get("NetworkSettings") or {}).get("Networks");data["StartedAt"]=row["State"].get("StartedAt")
        result[name]=hashlib.sha256(json.dumps(data,sort_keys=True,separators=(",", ":")).encode()).hexdigest()
    result["env_file"]=hashlib.sha256(Path("/data/coolify/services/"+core.UUID+"/.env").read_bytes()).hexdigest()
    return result

def preflight(repo,revision,native,sha256,size,api_tag,api_id,source_sha256,source_files):
    source_pin=validate_source_fingerprint(source_sha256,source_files)
    protected=protected_snapshot(api_tag,api_id)
    validate_source_scope(repo,revision,native);validate_versions(repo,revision,native)
    artifacts=validate_artifacts(repo,revision,sha256,size)
    base,updated,web_env,config=builder.preflight(repo,revision)
    updated.update(artifacts)
    before=untouched(SOURCE_ID);require_untouched(source_pin,before)
    original_public=public_manifest(SOURCE_ID);expected_public_manifest(original_public,sha256,size,artifacts[UPDATE_MANIFEST])
    if protected_snapshot(api_tag,api_id)!=protected:raise GateError("web_preflight_service_or_environment_drift")
    return base,updated,web_env,config,original_public,before,protected

def container_compile(revision,base,updated,web_env):
    config=base.get("Config") or {}
    if not config.get("Cmd") or config.get("Volumes"):raise GateError("web_compile_base_config_unsupported")
    name="flixify-search-web-build-"+uuid.uuid4().hex[:12];created=False
    args=["docker","create","--name",name,"--network","none","--memory","1280m","--memory-swap","1536m","--pids-limit","256"]
    for key,value in web_env.items():args.extend(("--env",key+"="+value))
    args.extend((SOURCE_ID,"node","-e",builder.build_script()))
    try:
        command(*args);created=True
        with tempfile.TemporaryDirectory(prefix="flixify-live-web-overlay-") as directory:
            for index,(path,value) in enumerate(updated.items()):
                file=Path(directory)/str(index);file.write_bytes(value);file.chmod(0o644);command("docker","cp",str(file),name+":/app/"+path)
        command("docker","start","--attach",name,timeout=1200)
        if command("docker","inspect","--format","{{.State.ExitCode}}",name).decode().strip()!="0":raise GateError("web_bounded_compile_failed")
        command("docker","commit","--change","CMD "+json.dumps(config["Cmd"]),"--change","LABEL org.opencontainers.image.revision="+revision,"--change","LABEL vip.flixify.edge-recovery.base="+SOURCE_ID,name,target(revision),timeout=300)
    finally:
        if created:command("docker","rm","--force",name)
    print("web_actual_compile_passed; cgroup_1280_1536_network_none; owned_container_removed")

def download_verification_script(sha256,size,manifest):
    parse_manifest(manifest,sha256,size)
    apk="http://127.0.0.1:3000/downloads/flixify-pro-1.4.3.apk";update="http://127.0.0.1:3000/downloads/flixify-tv-update.json"
    return ('const crypto=require("node:crypto");(async()=>{const u='+json.dumps(apk)+';let h;'
        'for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.ok)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'if(!h||h.status!==200||Number(h.headers.get("content-length"))!=='+str(size)+'||!h.headers.get("content-type")?.includes("application/vnd.android.package-archive"))throw Error("apk_head_invalid");'
        'const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/'+str(size)+'"||(await r.arrayBuffer()).byteLength!==32)throw Error("apk_range_invalid");'
        'const full=await fetch(u,{signal:AbortSignal.timeout(10000)});if(full.status!==200)throw Error("apk_get_status_invalid");const b=Buffer.from(await full.arrayBuffer());if(b.length!=='+str(size)+'||crypto.createHash("sha256").update(b).digest("hex")!=='+json.dumps(sha256)+')throw Error("apk_get_digest_invalid");'
        'const m=await fetch('+json.dumps(update)+',{signal:AbortSignal.timeout(10000)});if(m.status!==200||!m.headers.get("content-type")?.includes("application/json"))throw Error("manifest_get_invalid");const bytes=Buffer.from(await m.arrayBuffer());if(bytes.length!=='+str(len(manifest))+'||crypto.createHash("sha256").update(bytes).digest("hex")!=='+json.dumps(hashlib.sha256(manifest).hexdigest())+')throw Error("manifest_digest_invalid");'
        'const j=JSON.parse(bytes.toString("utf8"));if(j.packageName!=="vip.flixify.tv"||j.versionName!=="1.4.3"||j.versionCode!==11||j.minSdk!==23||j.apkUrl!=='+json.dumps(APK_URL)+'||j.sha256!=='+json.dumps(sha256)+'||j.sizeBytes!=='+str(size)+')throw Error("manifest_apk_incoherent");console.log("candidate_apk_and_manifest_verified")})().catch(()=>{console.error("candidate_web_download_contract_failed");process.exit(1)})')

def verify_download(candidate,sha256,size,manifest):
    name="flixify-search-web-check-"+uuid.uuid4().hex[:12]
    owned=command("docker","create","--name",name,"--network","none","--memory","512m","--memory-swap","640m","--pids-limit","128",candidate).decode().strip()
    if not re.fullmatch(r"[0-9a-f]{64}",owned):raise GateError("web_download_check_container_id_invalid")
    try:
        command("docker","start",owned)
        if command("docker","inspect","--format","{{.Image}}",owned).decode().strip()!=candidate:raise GateError("web_download_check_container_drift")
        command("docker","exec",owned,"node","-e",download_verification_script(sha256,size,manifest),timeout=100)
    finally:
        command("docker","rm","--force",owned)

def verify_candidate(base,revision,updated,web_env,config,original_public,before,sha256,size):
    candidate=builder.verify_candidate(base,revision,updated,web_env,config)
    require_untouched(before,untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate))!=expected_public_manifest(original_public,sha256,size,updated[UPDATE_MANIFEST]):raise GateError("web_candidate_public_tree_differs")
    verify_download(candidate,sha256,size,updated[UPDATE_MANIFEST])
    print("web_sources_dependencies_config_old_public_assets_and_new_download_verified")
    return candidate

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("source_repo",type=Path);parser.add_argument("--revision",required=True);parser.add_argument("--native-revision",required=True)
    parser.add_argument("--apk-sha256",required=True);parser.add_argument("--apk-bytes",required=True,type=int);parser.add_argument("--protected-api-tag",required=True);parser.add_argument("--protected-api-id",required=True);parser.add_argument("--source-untouched-sha256",required=True);parser.add_argument("--source-untouched-files",required=True,type=int)
    action=parser.add_mutually_exclusive_group();action.add_argument("--build",action="store_true");action.add_argument("--verify-existing",action="store_true");args=parser.parse_args()
    base,updated,web_env,config,public,before,protected=preflight(args.source_repo,args.revision,args.native_revision,args.apk_sha256,args.apk_bytes,args.protected_api_tag,args.protected_api_id,args.source_untouched_sha256,args.source_untouched_files)
    if not (args.build or args.verify_existing):print("search_web_preflight_ok; no_mutation; exact_native_and_apk_pins_required");return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free<builder.MIN_FREE_BYTES:raise GateError("web_build_requires_8GiB")
        if target(args.revision) in command("docker","image","ls","--format","{{.Repository}}:{{.Tag}}",target(args.revision)).decode().splitlines():raise GateError("web_candidate_tag_exists_use_verify_existing")
        container_compile(args.revision,base,updated,web_env)
    candidate=verify_candidate(base,args.revision,updated,web_env,config,public,before,args.apk_sha256,args.apk_bytes)
    if protected_snapshot(args.protected_api_tag,args.protected_api_id)!=protected:raise GateError("web_build_changed_protected_service_or_environment")
    print("web_candidate_verified:"+candidate)

if __name__=="__main__":
    try:main()
    except GateError as error:print("build_stopped:"+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print("build_stopped:"+type(error).__name__,file=sys.stderr);sys.exit(1)
