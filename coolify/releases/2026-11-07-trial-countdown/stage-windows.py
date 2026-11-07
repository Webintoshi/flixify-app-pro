#!/usr/bin/env python3
"""Stage only the accepted Windows installer from an exact CI artifact ZIP."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('trial_windows_stage_common',HERE/'common.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
MEMBER='Flixify-Pro-Windows-1.0.4-x64-TEST-Setup.exe'

def safe_url(value):
    if not isinstance(value,str) or not 1<=len(value)<=8192 or any(ord(ch)<33 or ord(ch)>126 for ch in value):raise c.GateError('temporary_artifact_url_invalid')
    parsed=urllib.parse.urlsplit(value)
    host=parsed.hostname or ''
    allowed=host=='oaiusercontent.com' or host.endswith('.oaiusercontent.com') or re.fullmatch(r'productionresultssa[0-9]+\.blob\.core\.windows\.net',host)
    if parsed.scheme!='https' or parsed.port not in (None,443) or parsed.username or parsed.password or parsed.fragment or not allowed:raise c.GateError('temporary_artifact_url_origin_not_allowed')
    return value

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        safe_url(newurl)
        return super().redirect_request(request,fp,code,msg,headers,newurl)

def download(url,target):
    request=urllib.request.Request(safe_url(url),headers={'User-Agent':'Flixify-release-validation'})
    opener=urllib.request.build_opener(SafeRedirect());deadline=time.monotonic()+180
    digest=hashlib.sha256();size=0
    with opener.open(request,timeout=30) as response,target.open('xb') as destination:
        safe_url(response.url)
        length=response.headers.get('Content-Length')
        if response.status!=200 or length is not None and length!=str(c.WINDOWS_ZIP_BYTES):raise c.GateError('accepted_windows_artifact_http_size_differs')
        while True:
            if time.monotonic()>deadline:raise c.GateError('windows_artifact_download_deadline')
            chunk=response.read(1024**2)
            if not chunk:break
            size+=len(chunk)
            if size>c.WINDOWS_ZIP_BYTES:raise c.GateError('accepted_windows_artifact_zip_oversize')
            digest.update(chunk);destination.write(chunk)
    if size!=c.WINDOWS_ZIP_BYTES or digest.hexdigest()!=c.WINDOWS_ZIP_SHA:raise c.GateError('accepted_windows_artifact_zip_digest_differs')

def extract(archive,destination,proof):
    if destination.exists() or destination.is_symlink():raise c.GateError('windows_staging_destination_must_be_new')
    digest=hashlib.sha256();size=0
    with archive.open('rb') as source:
        for chunk in iter(lambda:source.read(1024**2),b''):size+=len(chunk);digest.update(chunk)
    if size!=proof['artifactZipBytes'] or digest.hexdigest()!=proof['artifactZipSha256']:raise c.GateError('accepted_windows_artifact_zip_digest_differs')
    with zipfile.ZipFile(archive) as source:
        matches=[info for info in source.infolist() if info.filename==MEMBER]
        if len(matches)!=1:raise c.GateError('single_accepted_windows_installer_required')
        info=matches[0];mode=info.external_attr>>16
        if info.is_dir() or stat.S_ISLNK(mode) or info.file_size!=c.WINDOWS_BYTES or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):raise c.GateError('accepted_windows_zip_member_differs')
        digest=hashlib.sha256();size=0;header=bytearray()
        with source.open(info) as stream,destination.open('xb') as target:
            for chunk in iter(lambda:stream.read(1024**2),b''):
                size+=len(chunk)
                if size>c.WINDOWS_BYTES:raise c.GateError('windows_installer_extraction_oversize')
                digest.update(chunk);target.write(chunk)
                if len(header)<65536:header.extend(chunk[:65536-len(header)])
        if size!=c.WINDOWS_BYTES or digest.hexdigest()!=c.WINDOWS_SHA:raise c.GateError('accepted_windows_installer_digest_differs')
        c.windows_pe(header,size)
    destination.chmod(0o644)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download-url-file',type=Path,required=True);parser.add_argument('--windows-proof',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();proof=c.windows_proof(args.windows_proof.read_bytes())
    if args.download_url_file.stat().st_size>8192:raise c.GateError('temporary_artifact_url_file_oversize')
    url=safe_url(args.download_url_file.read_text().strip());output=args.output
    if not output.parent.is_dir() or output.parent.resolve()!=output.parent.absolute() or output.exists() or output.is_symlink():raise c.GateError('new_regular_windows_staging_path_required')
    if shutil.disk_usage(output.parent).free<c.RESERVE+c.WINDOWS_ZIP_BYTES+2*c.WINDOWS_BYTES+2*1024**2:raise c.GateError('windows_staging_requires_preserved_disk_reserve')
    created=False
    try:
        with tempfile.TemporaryDirectory(prefix='flixify-windows-artifact-',dir=output.parent) as directory:
            archive=Path(directory)/'accepted-ci.zip';download(url,archive)
            staged=Path(directory)/'accepted-installer.exe';extract(archive,staged,proof)
            with output.open('xb') as target,staged.open('rb') as source:created=True;shutil.copyfileobj(source,target,1024**2)
            output.chmod(0o644)
    except Exception:
        if created:output.unlink(missing_ok=True)
        raise
    print(json.dumps({'state':'accepted_windows_installer_staged','sizeBytes':c.WINDOWS_BYTES,'sha256':c.WINDOWS_SHA}))

if __name__=='__main__':
    try:main()
    except c.GateError as error:print(str(error),file=sys.stderr);raise SystemExit(1)
    except Exception:print('windows_artifact_transfer_failed_no_credentials_logged',file=sys.stderr);raise SystemExit(1)
