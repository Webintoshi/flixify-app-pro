#!/usr/bin/env python3
"""Apply only reviewed WhatsApp registration edits to extracted staging sources."""
from __future__ import annotations
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

class PatchError(RuntimeError):pass
EXPECTED_SOURCE_ID='sha256:44ff3909282231848200aab83adad8ce8e9ad2da76ed28e16deb417efe609442'
RECIPE='coolify/releases/2026-11-08-whatsapp-only/api-edits.json'
RECIPE_SHA256='dd2396f168701610028b1e892872ff530adda8c919ebb0fe8e376c12c8e60093'
PATCHED_PATHS=tuple('apps/api/src/'+name+'.ts' for name in ('server','repository','phone-auth-accounts'))
PAYLOAD_PATHS=(RECIPE,)
MAX_BYTES=2*1024*1024

def sha(data):return hashlib.sha256(data).hexdigest()
def root_path(value):
    path=Path(value).absolute()
    if path.is_symlink() or not path.is_dir():raise PatchError('root_must_be_regular_directory')
    return path.resolve()
def source_path(root,relative):
    parts=Path(relative).parts
    if Path(relative).is_absolute() or not parts or any(p in ('.','..') for p in parts):raise PatchError('relative_path_required')
    path=root
    for index,part in enumerate(parts):
        path=path/part
        try:info=path.lstat()
        except FileNotFoundError:raise PatchError('required_source_path_missing:'+relative) from None
        if stat.S_ISLNK(info.st_mode):raise PatchError('source_symlink_forbidden:'+relative)
        if index<len(parts)-1 and not stat.S_ISDIR(info.st_mode):raise PatchError('source_parent_not_directory:'+relative)
        if index==len(parts)-1 and not stat.S_ISREG(info.st_mode):raise PatchError('source_must_be_regular:'+relative)
    return path
def read_source(root,relative):
    path=source_path(root,relative)
    if not 1<=path.stat().st_size<=MAX_BYTES:raise PatchError('source_size_invalid:'+relative)
    data=path.read_bytes()
    if not 1<=len(data)<=MAX_BYTES or b'\0' in data:raise PatchError('source_bytes_invalid:'+relative)
    try:data.decode('utf8')
    except UnicodeDecodeError:raise PatchError('source_utf8_required:'+relative) from None
    return data

def recipe(root):
    data=read_source(root,RECIPE)
    if sha(data)!=RECIPE_SHA256:raise PatchError('reviewed_recipe_hash_differs')
    def pairs(rows):
        result={}
        for key,value in rows:
            if key in result:raise PatchError('duplicate_recipe_field')
            result[key]=value
        return result
    try:value=json.loads(data,object_pairs_hook=pairs)
    except (ValueError,TypeError):raise PatchError('recipe_json_invalid') from None
    if not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageId','existing'} or value['schemaVersion']!=1 or value['sourceImageId']!=EXPECTED_SOURCE_ID or set(value['existing'])!=set(PATCHED_PATHS):raise PatchError('reviewed_recipe_scope_differs')
    return value

def restore_equal_lines(original,updated):
    raw=original.decode('utf8').splitlines(keepends=True)
    before=[line.replace('\r\n','\n') for line in raw]
    after=updated.replace('\r\n','\n').splitlines(keepends=True)
    result=[]
    for kind,a,b,c,d in difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes():result.extend(raw[a:b] if kind=='equal' else after[c:d])
    return ''.join(result).encode('utf8')

def exact_edits(original,description,path):
    if not isinstance(description,dict) or set(description)!={'before','after','edits'} or not all(isinstance(description[k],str) and len(description[k])==64 for k in ('before','after')):raise PatchError('reviewed_source_descriptor_invalid:'+path)
    if sha(original)!=description['before']:raise PatchError('exact_source_hash_differs:'+path)
    rows=description['edits']
    if not isinstance(rows,list) or not rows:raise PatchError('reviewed_edit_list_invalid:'+path)
    text=original.decode('utf8').replace('\r\n','\n')
    for index,row in enumerate(rows):
        if not isinstance(row,dict) or set(row)!={'old','new'} or not all(isinstance(v,str) and 1<=len(v.encode())<=256*1024 and '\0' not in v for v in row.values()) or row['old']==row['new']:raise PatchError('reviewed_edit_invalid:'+path)
        if text.count(row['old'])!=1:raise PatchError('exact_anchor_not_unique:'+path+':'+str(index))
        text=text.replace(row['old'],row['new'],1)
    updated=restore_equal_lines(original,text)
    if sha(updated)!=description['after']:raise PatchError('exact_updated_hash_differs:'+path)
    return updated

def unchanged_region(original,updated,start,end=None):
    before,after=original.decode('utf8'),updated.decode('utf8')
    if before.count(start)!=1 or after.count(start)!=1:raise PatchError('protected_region_boundary_changed')
    old,new=before[before.index(start):],after[after.index(start):]
    if end:
        if old.count(end)!=1 or new.count(end)!=1:raise PatchError('protected_region_end_changed')
        old,new=old[:old.index(end)],new[:new.index(end)]
    if old!=new:raise PatchError('protected_existing_behavior_changed')
    return sha(old.encode('utf8'))

def plan(repo_payload_root,extracted_app_root,*,source_image_id):
    if source_image_id!=EXPECTED_SOURCE_ID:raise PatchError('exact_source_image_required')
    payload,stage=root_path(repo_payload_root),root_path(extracted_app_root)
    if payload==stage:raise PatchError('separate_extracted_staging_tree_required')
    description=recipe(payload)
    originals={path:read_source(stage,path) for path in PATCHED_PATHS}
    updates={path:exact_edits(originals[path],description['existing'][path],path) for path in PATCHED_PATHS}
    server,repository=PATCHED_PATHS[:2]
    preserved={
      'existingCodeLoginAndFollowingRoutes':unchanged_region(originals[server],updates[server],'  app.post("/auth/login-by-code",'),
      'coreUserCreationAndTrial':unchanged_region(originals[repository],updates[repository],'export async function createUser(','export async function storePlainKryptoniteCode(')
    }
    return updates,{'sourceImageId':EXPECTED_SOURCE_ID,'recipeSha256':RECIPE_SHA256,'changedPaths':list(PATCHED_PATHS),'before':{p:sha(b) for p,b in originals.items()},'after':{p:sha(b) for p,b in updates.items()},'preserved':preserved}

def apply(repo_payload_root,extracted_app_root,*,source_image_id):
    updates,proof=plan(repo_payload_root,extracted_app_root,source_image_id=source_image_id)
    stage=root_path(extracted_app_root)
    for path,expected in proof['before'].items():
        if sha(read_source(stage,path))!=expected:raise PatchError('staging_source_changed_before_write:'+path)
    for path,data in updates.items():source_path(stage,path).write_bytes(data)
    for path,expected in proof['after'].items():
        if sha(read_source(stage,path))!=expected:raise PatchError('staging_source_write_verification_failed:'+path)
    return proof

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('payload',type=Path);parser.add_argument('stage',type=Path);parser.add_argument('--source-image-id',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    proof=apply(args.payload,args.stage,source_image_id=args.source_image_id) if args.apply else plan(args.payload,args.stage,source_image_id=args.source_image_id)[1]
    print(json.dumps({'state':'whatsapp_only_api_overlay_applied' if args.apply else 'whatsapp_only_api_overlay_preflight_passed',**proof},sort_keys=True))
if __name__=='__main__':
    try:main()
    except (PatchError,OSError,ValueError,TypeError,KeyError) as error:
        print('api_overlay_stopped:'+str(error) if isinstance(error,PatchError) else 'api_overlay_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
