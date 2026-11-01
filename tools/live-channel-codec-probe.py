#!/usr/bin/env python3
"""Bounded input-codec diagnostics; no availability or exclusion proof is produced."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types
import urllib.parse

OPERATOR_SHA256 = 'be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520'
FFMPEG_SHA256 = '4d57fcc582c15dd72a6a5f44abb8035810f234b3ec5a12d870ecc88eeb5e7a58'
USER_AGENT = 'Flixify-owned-live-audit'
VIDEO_CODECS = frozenset({'h264', 'hevc', 'mpeg2video', 'mpeg1video', 'mpeg4', 'av1', 'vp8', 'vp9', 'mjpeg', 'vc1', 'wmv3'})
AUDIO_CODECS = frozenset({'aac', 'aac_latm', 'mp2', 'mp3', 'ac3', 'eac3', 'dts', 'truehd', 'opus', 'vorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'amr_nb', 'amr_wb'})
STREAM = re.compile(r'^\s*Stream #0:\d+(?:\[[^\]\r\n]{0,128}\])?(?:\([^\)\r\n]{0,128}\))?:\s*(Video|Audio):\s*([a-zA-Z0-9_]+)(?:\s|,|$)([^\r\n]*)$')


def validate_url(url):
    if not isinstance(url, str) or not 1 <= len(url) <= 32768 or re.search(r'[\x00-\x20\x7f\\]', url):
        raise ValueError('invalid-signed-url')
    try:
        parsed = urllib.parse.urlsplit(url)
        allowed = parsed.scheme == 'https' and parsed.hostname == 'edge.flixify.vip' and parsed.port in {None, 443} and not parsed.username and not parsed.password and not parsed.fragment and parsed.path.startswith('/')
    except ValueError:
        allowed = False
    if not allowed:
        raise ValueError('invalid-signed-url')
    return url


def read_request(source):
    raw = source.read(65537)
    if len(raw) > 65536:
        raise ValueError('input-too-large')
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('invalid-input-json') from None
    if not isinstance(value, dict) or set(value) - {'url', 'streamId'} or 'url' not in value:
        raise ValueError('invalid-input-json')
    validate_url(value['url'])
    if 'streamId' in value and (not isinstance(value['streamId'], str) or not re.fullmatch(r'[1-9][0-9]{0,14}', value['streamId'])):
        raise ValueError('invalid-stream-id')
    return value


def verified_bytes(path, expected):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as source:
        details = os.fstat(source.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077:
            raise ValueError('private-artifact-required')
        data = source.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('artifact-hash-mismatch')
    return data


def load_runner(operator, ffmpeg):
    if not operator.is_absolute() or not ffmpeg.is_absolute():
        raise ValueError('absolute-artifact-path-required')
    source = verified_bytes(operator, OPERATOR_SHA256)
    verified_bytes(ffmpeg, FFMPEG_SHA256)
    if not os.access(ffmpeg, os.X_OK):
        raise ValueError('ffmpeg-not-executable')
    module = types.ModuleType('pinned_live_audit')
    exec(compile(source, str(operator), 'exec'), vars(module))
    return module.run_bounded


def empty_result(status='unverified'):
    return {'status': status, 'videoCodec': None, 'audioCodec': None, 'width': None, 'height': None, 'fps': None, 'decodedFrames': 0, 'audioDecoded': False}


def input_metadata(diagnostic):
    result = empty_result()
    in_input = False
    for line in diagnostic.splitlines():
        if re.match(r'^Input #0,', line):
            in_input = True
            continue
        if re.match(r'^(?:Stream mapping:|Output #)', line):
            break
        stream = STREAM.match(line) if in_input else None
        if not stream:
            continue
        kind, codec, description = stream.groups()
        if kind == 'Video' and result['videoCodec'] is None:
            result['videoCodec'] = codec if codec in VIDEO_CODECS else 'other'
            resolution = re.search(r'(?<!\d)([1-9]\d{0,4})x([1-9]\d{0,4})(?!\d)', description)
            if resolution:
                width, height = map(int, resolution.groups())
                if width <= 16384 and height <= 16384:
                    result.update(width=width, height=height)
            rate = re.search(r'(?<![\d.])(\d{1,3}(?:\.\d{1,6})?)\s+fps\b', description)
            if rate and 0 < float(rate[1]) <= 240:
                result['fps'] = float(rate[1])
        elif kind == 'Audio' and result['audioCodec'] is None:
            result['audioCodec'] = codec if codec in AUDIO_CODECS else 'other'
    return result


def decode_url(url, ffmpeg, runner):
    validate_url(url)
    try:
        process = runner([
            str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'info',
            '-protocol_whitelist', 'https,tls,tcp,crypto', '-user_agent', USER_AGENT,
            '-rw_timeout', '15000000', '-analyzeduration', '1000000', '-i', url,
            '-map', '0:v:0', '-map', '0:a:0?', '-frames:v', '30', '-frames:a', '30',
            '-t', '2', '-progress', 'pipe:1', '-f', 'null', '-'
        ], 15)
    except subprocess.TimeoutExpired:
        return empty_result('timeout')
    except OSError:
        raise ValueError('ffmpeg-unavailable') from None
    diagnostic = re.sub(rb'https?://[^\x00-\x20<>\"\']+', b'[url]', process.stderr[-65536:], flags=re.IGNORECASE).decode('utf-8', errors='replace')
    result = input_metadata(diagnostic)
    frames = [int(value) for value in re.findall(rb'(?m)^frame=(\d{1,8})\s*$', process.stdout[-65536:])]
    decoded = max(frames, default=0)
    if process.returncode == 0 and 1 <= decoded <= 30:
        result.update(status='working', decodedFrames=decoded)
        output = diagnostic.partition('Output #0,')[2]
        audio_bytes = re.findall(r'\baudio:(\d+(?:\.\d+)?)(?:KiB|kB|B)\b', output)
        result['audioDecoded'] = result['audioCodec'] is not None and any(float(size) > 0 for size in audio_bytes)
    else:
        errors = re.findall(r'(?:HTTP error|Server returned)\s+(\d{3})(?:\s|$)', diagnostic)
        code = int(errors[-1]) if errors else None
        result['status'] = 'blocked' if code in {401, 403, 429} else 'unverified' if code else 'undecodable'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    args = parser.parse_args()
    os.set_blocking(sys.stdin.fileno(), True)
    request = read_request(sys.stdin.buffer)
    runner = load_runner(args.operator, args.ffmpeg)
    result = decode_url(request['url'], args.ffmpeg, runner)
    if 'streamId' in request:
        result['streamId'] = request['streamId']
    print(json.dumps(result))
    return 0 if result['status'] == 'working' else 20


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(json.dumps(empty_result('interrupted')))
        sys.exit(130)
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z0-9-]{1,80}', str(error)) else 'probe-failed'
        print(json.dumps({'probeStopped': reason}), file=sys.stderr)
        sys.exit(1)
