#!/usr/bin/env python3
"""Apply a reviewed source overlay to an extracted staging tree, never deploy services.

The caller must extract EXPECTED_SOURCE_ID independently. All edits are planned and
validated before staging writes; abandon the staging tree if any write fails.
"""
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

EXPECTED_SOURCE_ID='sha256:66805232ca883cbd6385c38341d21b4be0b9fc436b5718cc2b8e20d4398de4fb'
BASE_REVISION='2522149cfda9dae514fc81d9820cbbfb70c57ea6'
RECIPE='coolify/releases/2026-11-07-phone-login/api-edits.json'
RECIPE_SHA256='ca485847b178d3503810d2ce4e3372f3e3e258f0ad7d275b209f64466a5452ff'
EXISTING_FILES=tuple('apps/api/src/'+x+'.ts' for x in ('server','repository','env','device-login-store','device-login','demo-store'))+('packages/contracts/src/domain.ts',)
NEW_FILES=tuple('apps/api/src/'+x+'.ts' for x in ('phone-auth','phone-auth-accounts','phone-auth-config','phone-auth-routes','phone-auth-store','phone-auth-vatansms','remembered-session'))
UNCHANGED_FILES=('apps/api/src/cors-config.ts',)
PATCHED_PATHS=EXISTING_FILES+NEW_FILES
PAYLOAD_PATHS=(RECIPE,*NEW_FILES)
MAX_SOURCE_BYTES=2*1024*1024

def sha(data):return hashlib.sha256(data).hexdigest()

def logical_source(data):return data.decode('utf8').replace('\r\n','\n')

def restore_equal_lines(original,updated):
    """Keep untouched line bytes, including mixed CRLF/LF, after reviewed logical edits."""
    raw=original.decode('utf8').splitlines(keepends=True)
    before=[line.replace('\r\n','\n') for line in raw]
    after=updated.replace('\r\n','\n').splitlines(keepends=True)
    parts=[]
    for operation,a,b,c,d in difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes():
        parts.extend(raw[a:b] if operation=='equal' else after[c:d])
    return ''.join(parts).encode('utf8')

def root_path(value):
    path=Path(value).absolute()
    if path.is_symlink() or not path.is_dir():raise PatchError('root_must_be_regular_directory')
    return path.resolve()

def selected_path(root,relative,*,absent=False):
    parts=Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(x in ('.','..') for x in parts):raise PatchError('relative_path_required')
    current=root
    for number,part in enumerate(parts):
        current=current/part;last=number==len(parts)-1
        try:info=current.lstat()
        except FileNotFoundError:
            if absent and last:return current
            raise PatchError('required_source_path_missing:'+relative) from None
        if stat.S_ISLNK(info.st_mode):raise PatchError(('source_must_be_regular:' if last else 'source_parent_symlink:')+relative)
        if not last and not stat.S_ISDIR(info.st_mode):raise PatchError('source_parent_not_directory:'+relative)
        if last:
            if absent:raise PatchError('new_module_already_exists:'+relative)
            if not stat.S_ISREG(info.st_mode):raise PatchError('source_must_be_regular:'+relative)
    return current

def read_source(root,relative):
    path=selected_path(root,relative)
    if not 1<=path.stat().st_size<=MAX_SOURCE_BYTES:raise PatchError('source_size_invalid:'+relative)
    data=path.read_bytes()
    if not 1<=len(data)<=MAX_SOURCE_BYTES or b'\0' in data:raise PatchError('source_bytes_invalid:'+relative)
    try:data.decode('utf8')
    except UnicodeDecodeError:raise PatchError('source_utf8_required:'+relative) from None
    return data

def unique_json(data):
    def pairs(rows):
        value={}
        for key,item in rows:
            if key in value:raise PatchError('duplicate_recipe_field')
            value[key]=item
        return value
    try:return json.loads(data,object_pairs_hook=pairs)
    except (ValueError,TypeError):raise PatchError('recipe_json_invalid') from None

def recipe(repo):
    data=read_source(repo,RECIPE)
    if sha(data)!=RECIPE_SHA256:raise PatchError('reviewed_recipe_hash_differs')
    value=unique_json(data)
    if (not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageId','canonicalBaseRevision','existing','new','createUser','unchanged'}
        or value['schemaVersion']!=1 or value['sourceImageId']!=EXPECTED_SOURCE_ID or value['canonicalBaseRevision']!=BASE_REVISION
        or set(value['existing'])!=set(EXISTING_FILES) or set(value['new'])!=set(NEW_FILES) or set(value['unchanged'])!=set(UNCHANGED_FILES)):
        raise PatchError('reviewed_recipe_scope_differs')
    return value

def exact_edits(source,rows,path):
    if not isinstance(rows,list) or not rows:raise PatchError('reviewed_edit_list_invalid:'+path)
    text=logical_source(source)
    for number,row in enumerate(rows):
        if not isinstance(row,dict) or set(row)!={'old','new'} or not all(isinstance(v,str) and 1<=len(v.encode())<=256*1024 and '\0' not in v for v in row.values()) or row['old']==row['new']:
            raise PatchError('reviewed_edit_invalid:'+path)
        if text.count(row['old'])!=1:raise PatchError('exact_anchor_not_unique:'+path+':'+str(number))
        text=text.replace(row['old'],row['new'],1)
    return restore_equal_lines(source,text)

def create_user_from_actual(source,description):
    text=logical_source(source)
    if 'export async function createUserInTransaction(' in text or 'export async function preparePhoneRegistration(' in text:raise PatchError('create_user_helper_already_exists')
    if not isinstance(description,dict) or set(description)!={'header','wrapper','suffix','helperSignature','wrapperCall','prepareFunction','nextFunction','welcomeAnchor','referralGuard'}:raise PatchError('create_user_recipe_invalid')
    header,wrapper,suffix=(description[x] for x in ('header','wrapper','suffix'))
    if text.count(header)!=1:raise PatchError('create_user_transaction_header_changed')
    boundary='\nexport async function '+description['nextFunction']+'('
    if text.count(boundary)!=1:raise PatchError('create_user_transaction_boundary_changed')
    start=text.index(header);end=text.index(boundary,start)
    whole=text[start:end];block=whole.rstrip('\n');trailing=whole[len(block):]
    if not block.startswith(header+wrapper) or not block.endswith(suffix):raise PatchError('create_user_transaction_wrapper_changed')
    body=block[len(header+wrapper):-len(suffix)]
    final_return='    return userId;\n'
    if (not body.endswith(final_return) or body.count(final_return)!=1
        or body.count('await claimRegistrationSlots(client, {')!=1
        or body.count('insert into public.users (')!=1
        or body.count('insert into public.auto_trial_provision_jobs')!=1
        or 'guardSecret: env.REGISTRATION_GUARD_SECRET' not in body or 'ipLimit: env.AUTO_TRIAL_DAILY_IP_LIMIT' not in body):
        raise PatchError('create_user_transaction_shape_changed')
    if body.count(description['welcomeAnchor'])!=1:raise PatchError('actual_production_welcome_insert_required')
    if body.count(description['referralGuard'])!=1 or 'insert into public.referral_attributions' in body:raise PatchError('actual_referral_store_guard_required')
    preserved=body[:-len(final_return)]
    transaction='  return withTransaction(async client => {\n'
    if not wrapper.endswith(transaction):raise PatchError('actual_transaction_entry_changed')
    prelude=wrapper[:-len(transaction)]
    updated=(header+prelude+description['wrapperCall']+'}\n\n'+description['prepareFunction']+'\n\n'
        +description['helperSignature']+'\n'+body+'}'+trailing)
    body_line=text[:start+len(header+wrapper)].count('\n')
    raw_lines=source.decode('utf8').splitlines(keepends=True)
    raw_body=''.join(raw_lines[body_line:body_line+body.count('\n')])
    raw_preserved=''.join(raw_body.splitlines(keepends=True)[:-1]).encode('utf8')
    result=restore_equal_lines(source,text[:start]+updated+text[end:])
    if raw_body.encode() not in result:raise PatchError('actual_create_user_body_not_preserved')
    summary='export async function getReferralSummary(';following='export async function storePlainKryptoniteCode('
    original_raw=source.decode();updated_raw=result.decode()
    if original_raw.count(summary)!=1 or updated_raw.count(summary)!=1 or original_raw.count(following)!=1 or updated_raw.count(following)!=1:raise PatchError('referral_summary_boundary_changed')
    summary_before=original_raw[original_raw.index(summary):original_raw.index(following)]
    summary_after=updated_raw[updated_raw.index(summary):updated_raw.index(following)]
    if summary_before!=summary_after:raise PatchError('existing_referral_summary_changed')
    proof={'createUserOriginalBodySha256':sha(raw_body.encode()),'createUserPreservedPrefixSha256':sha(raw_preserved),'createUserOriginalBodyBytes':len(raw_body.encode()),'getReferralSummarySha256':sha(summary_before.encode())}
    return result,proof

def protected_server(original,updated):
    before,after=original.decode(),updated.decode();anchor='  app.get("/me", async (request, reply) => {'
    if before.count(anchor)!=1 or after.count(anchor)!=1:raise PatchError('protected_me_route_boundary_changed')
    old_tail,new_tail=(value[value.index(anchor):] for value in (before,after))
    if old_tail!=new_tail:raise PatchError('protected_countdown_payments_referral_routes_changed')
    start='  app.post("/auth/register-anon",';end='  app.post("/auth/refresh",'
    regions=[]
    for value in (before,after):
        if value.count(start)!=1 or value.count(end)!=1:raise PatchError('protected_existing_login_boundary_changed')
        regions.append(value[value.index(start):value.index(end)])
    if regions[0]!=regions[1]:raise PatchError('protected_existing_registration_or_login_changed')
    return {'protectedMeAndFollowingRoutesSha256':sha(old_tail.encode()),'protectedExistingRegistrationAndCodeLoginSha256':sha(regions[0].encode())}

def plan(repo_payload_root,extracted_app_root,*,source_image_id):
    if source_image_id!=EXPECTED_SOURCE_ID:raise PatchError('exact_source_image_required')
    repo,stage=root_path(repo_payload_root),root_path(extracted_app_root)
    if repo==stage:raise PatchError('separate_extracted_staging_tree_required')
    description=recipe(repo)
    originals={path:read_source(stage,path) for path in EXISTING_FILES}
    unchanged={path:sha(read_source(stage,path)) for path in UNCHANGED_FILES}
    if unchanged!=description['unchanged']:raise PatchError('unchanged_source_hash_differs')
    for path in NEW_FILES:selected_path(stage,path,absent=True)
    additions={}
    for path in NEW_FILES:
        data=read_source(repo,path)
        if sha(data)!=description['new'][path]:raise PatchError('reviewed_payload_hash_differs:'+path)
        additions[path]=data
    updates={path:exact_edits(originals[path],description['existing'][path],path) for path in EXISTING_FILES}
    repository='apps/api/src/repository.ts'
    updates[repository],preserved=create_user_from_actual(updates[repository],description['createUser'])
    preserved.update(protected_server(originals['apps/api/src/server.ts'],updates['apps/api/src/server.ts']))
    preserved['unchangedSources']=unchanged
    updates.update(additions)
    if any(updates[path]==originals[path] for path in EXISTING_FILES):raise PatchError('expected_source_update_missing')
    proof={'sourceImageId':EXPECTED_SOURCE_ID,'recipeSha256':RECIPE_SHA256,'changedPaths':list(EXISTING_FILES+NEW_FILES),
        'before':{path:sha(data) for path,data in originals.items()},'after':{path:sha(data) for path,data in updates.items()},'preserved':preserved}
    return updates,proof

def apply(repo_payload_root,extracted_app_root,*,source_image_id):
    updates,proof=plan(repo_payload_root,extracted_app_root,source_image_id=source_image_id)
    stage=root_path(extracted_app_root)
    for path in EXISTING_FILES:
        if sha(read_source(stage,path))!=proof['before'][path]:raise PatchError('staging_source_changed_before_write:'+path)
    for path,expected in proof['preserved']['unchangedSources'].items():
        if sha(read_source(stage,path))!=expected:raise PatchError('unchanged_source_hash_differs_before_write')
    for path in NEW_FILES:selected_path(stage,path,absent=True)
    for path,data in updates.items():
        target=selected_path(stage,path,absent=path in NEW_FILES)
        if path in NEW_FILES:
            descriptor=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
            with os.fdopen(descriptor,'wb') as output:output.write(data)
        else:target.write_bytes(data)
    for path,expected in proof['after'].items():
        if sha(read_source(stage,path))!=expected:raise PatchError('staging_source_write_verification_failed:'+path)
    for path,expected in proof['preserved']['unchangedSources'].items():
        if sha(read_source(stage,path))!=expected:raise PatchError('unchanged_source_hash_differs_after_write')
    return proof

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('repo',type=Path);parser.add_argument('stage',type=Path);parser.add_argument('--source-image-id',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if args.apply:proof=apply(args.repo,args.stage,source_image_id=args.source_image_id)
    else:_,proof=plan(args.repo,args.stage,source_image_id=args.source_image_id)
    print(json.dumps({'state':'phone_api_overlay_applied' if args.apply else 'phone_api_overlay_preflight_passed',**proof},sort_keys=True))

if __name__=='__main__':
    try:main()
    except (PatchError,OSError,ValueError,TypeError,KeyError) as error:
        print('api_overlay_stopped:'+str(error) if isinstance(error,PatchError) else 'api_overlay_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
