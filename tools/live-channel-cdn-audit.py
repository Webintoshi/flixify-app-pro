"""Original-origin client headers, followed by one owned remote CDN decoder."""
import hashlib
import json
import math
from pathlib import Path
import re
import secrets
import shlex
import socket
import subprocess
import time
import types
import urllib.error
import urllib.parse
import urllib.request

FROZEN_OPERATOR_SHA256 = "be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520"
REMOTE_KEYS = {"ssh_socket", "ssh_target", "directory", "unit_name", "helper_sha256", "runtime_sha256"}
source = Path(__file__).with_name("live-channel-audit.py").read_bytes()
if hashlib.sha256(source).hexdigest() != FROZEN_OPERATOR_SHA256: raise ValueError("frozen-operator-hash-mismatch")
audit = types.ModuleType("frozen_live_channel_audit")
exec(compile(source, "frozen-live-channel-audit.py", "exec"), vars(audit))

class BridgeHalt(RuntimeError):
    """The caller must stop; no automatic retry or next channel is safe."""

REMOTE_PROGRAM = r'''
import hashlib,json,os,stat,subprocess,sys
from pathlib import Path
c=json.loads(sys.argv[1]);unit=c['unit_name'];root=Path(c['directory'])
def fail(reason):
 print(json.dumps({'remoteError':reason}));raise SystemExit(70)
def state():
 p=subprocess.run(['systemctl','show',unit,'--property=LoadState,ActiveState,SubState,MainPID,ControlPID,ControlGroup,Description'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=5)
 fields=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
 if not {'LoadState','ActiveState','MainPID','ControlPID','ControlGroup'}.issubset(fields):fail('state-unknown')
 expected='/system.slice/'+unit
 if fields['ControlGroup'] not in {'',expected}:fail('unexpected-cgroup')
 group=Path('/sys/fs/cgroup'+expected);populated=False
 if group.exists():
  events=dict(line.split() for line in (group/'cgroup.events').read_text().splitlines())
  if events.get('populated') not in {'0','1'}:fail('cgroup-state-unknown')
  populated=events['populated']=='1'
 idle=fields['ActiveState'] in {'inactive','failed'} and fields['MainPID']=='0' and fields['ControlPID']=='0' and not populated
 return {'idle':idle,'activeState':fields['ActiveState'],'populated':populated,'mainPid':int(fields['MainPID']),'controlPid':int(fields['ControlPID']),'description':fields.get('Description'),'cgroupMatches':fields['ControlGroup']==expected}
try:
 if c['action']=='stop':subprocess.run(['systemctl','stop',unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
 if c['action'] in {'status','stop'}:
  print(json.dumps(state()));raise SystemExit(0)
 if c['action']!='run':fail('invalid-action')
 if len(c.get('nonce',''))!=32 or any(x not in '0123456789abcdef' for x in c['nonce']):fail('invalid-nonce')
 if not state()['idle']:fail('unit-busy')
 details=root.lstat()
 if not stat.S_ISDIR(details.st_mode) or details.st_uid!=os.getuid() or stat.S_IMODE(details.st_mode)!=0o700:fail('private-directory-required')
 for name,expected in [('helper.py',c['helper_sha256']),('ffmpeg-runtime',c['runtime_sha256']),('live-channel-audit.py','be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520')]:
  path=root/name;details=path.lstat()
  if not stat.S_ISREG(details.st_mode) or details.st_uid!=os.getuid() or stat.S_IMODE(details.st_mode)&0o077:fail('private-artifact-required')
  if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:fail('artifact-hash-mismatch')
 command=['systemd-run','--pipe','--wait','--quiet','--collect','--unit='+unit,'--description=Flixify owned CDN audit '+c['nonce'],'--property=Slice=system.slice','--property=MemoryMax=384M','--property=CPUQuota=150%','--property=Nice=10','--property=RuntimeMaxSec=25s','--property=KillMode=control-group','--property=KillSignal=SIGINT','--property=TimeoutStopSec=20s','--property=SendSIGKILL=yes','--property=Restart=no','--property=UMask=0077','/usr/bin/python3',str(root/'helper.py'),'--operator',str(root/'live-channel-audit.py'),'--ffmpeg',str(root/'ffmpeg-runtime')]
 os.execvp(command[0],command)
except Exception:fail('remote-operation-failed')
'''

def validate_remote(remote):
    if not isinstance(remote, dict) or set(remote) != REMOTE_KEYS: raise ValueError("invalid-remote-config")
    if any(not isinstance(value, str) or not value or re.search(r"[\x00-\x1f\x7f]", value) for value in remote.values()): raise ValueError("invalid-remote-config")
    if not Path(remote["ssh_socket"]).is_absolute() or not re.fullmatch(r"root@[A-Za-z0-9][A-Za-z0-9.-]{0,252}", remote["ssh_target"]): raise ValueError("invalid-remote-config")
    if not remote["directory"].startswith("/tmp/flixify-live-audit-") or ".." in Path(remote["directory"]).parts: raise ValueError("invalid-remote-directory")
    if not re.fullmatch(r"flixify-live-audit-[a-z0-9][a-z0-9-]{0,63}\.service", remote["unit_name"]): raise ValueError("invalid-owned-unit")
    if any(not re.fullmatch(r"[0-9a-f]{64}", remote[key]) for key in ("helper_sha256", "runtime_sha256")): raise ValueError("invalid-artifact-hash")

def ssh_args(remote, action, nonce=None):
    config = {key: remote[key] for key in ("directory", "unit_name", "helper_sha256", "runtime_sha256")}
    config["action"] = action
    if nonce is not None: config["nonce"] = nonce
    command = shlex.join(["/usr/bin/python3", "-c", REMOTE_PROGRAM, json.dumps(config)])
    return ["ssh", "-S", remote["ssh_socket"], "-o", "ControlMaster=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ProxyCommand=false", remote["ssh_target"], command]

def parse_reply(process, action):
    if process.returncode not in ({0, 20} if action == "run" else {0}) or len(process.stdout) > 65536 or len(process.stderr) > 65536: raise BridgeHalt("remote-operation-uncertain")
    try: result = json.loads(process.stdout)
    except (ValueError, UnicodeError): raise BridgeHalt("remote-result-invalid") from None
    if not isinstance(result, dict) or "remoteError" in result: raise BridgeHalt("remote-operation-rejected")
    return result

def ssh_request(remote, action):
    if action not in {"status", "stop"}: raise ValueError("invalid-control-action")
    try:
        process = subprocess.run(ssh_args(remote, action), input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40)
    except (OSError, subprocess.TimeoutExpired): raise BridgeHalt("remote-transport-uncertain") from None
    return parse_reply(process, action)

def idle_proved(result):
    return result.get("idle") is True and result.get("activeState") in {"inactive", "failed"} and result.get("populated") is False and all(type(result.get(key)) is int and result[key] == 0 for key in ("mainPid", "controlPid"))

def ensure_remote_idle(remote):
    result = ssh_request(remote, "status")
    if not idle_proved(result): raise BridgeHalt("remote-not-idle")

def reconcile_remote(remote):
    validate_remote(remote)
    result = ssh_request(remote, "stop")
    if not idle_proved(result): raise BridgeHalt("remote-cleanup-unconfirmed")
    return True

def new_nonce(): return secrets.token_hex(16)

def owned_ready(state, nonce):
    return state.get("description") == "Flixify owned CDN audit " + nonce and state.get("idle") is False and state.get("activeState") == "active" and state.get("populated") is True and state.get("cgroupMatches") is True and type(state.get("mainPid")) is int and state["mainPid"] > 0 and type(state.get("controlPid")) is int and state["controlPid"] == 0

def decode_remote(remote, payload, timeout):
    nonce = new_nonce()
    try: process = subprocess.Popen(ssh_args(remote, "run", nonce), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError: raise BridgeHalt("remote-transport-uncertain") from None
    try:
        deadline = time.monotonic() + 10
        while True:
            if process.poll() is not None: raise BridgeHalt("remote-start-not-acknowledged")
            if time.monotonic() >= deadline: raise BridgeHalt("remote-readiness-timeout")
            state = ssh_request(remote, "status")
            if owned_ready(state, nonce): break
            if state.get("activeState") == "active" or state.get("populated") is True: raise BridgeHalt("remote-unit-not-owned")
            time.sleep(0.05)
        try: stdout, stderr = process.communicate(input=json.dumps(payload).encode(), timeout=55)
        except subprocess.TimeoutExpired: raise BridgeHalt("remote-transport-uncertain") from None
        result = parse_reply(subprocess.CompletedProcess([], process.returncode, stdout, stderr), "run")
    finally:
        if process.poll() is None:
            try: process.kill()
            except ProcessLookupError: pass
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream:
                try: stream.close()
                except OSError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: raise BridgeHalt("local-ssh-reap-unconfirmed") from None
    if result.get("status") not in {"working", "blocked", "unverified", "undecodable", "timeout"}: raise BridgeHalt("remote-decoder-result-invalid")
    return result

def fetch_original_entry(url, timeout):
    try:
        with urllib.request.build_opener(audit.NoRedirect()).open(urllib.request.Request(url, headers={"User-Agent": audit.USER_AGENT}), timeout=timeout) as response:
            return response.status, response.headers.get("Location")
    except urllib.error.HTTPError as error:
        result = error.code, error.headers.get("Location")
        error.close(); return result

def revalidate_original(url, timeout):
    try:
        with audit.open_media_http(urllib.request.Request(url, headers={"User-Agent": audit.USER_AGENT, "Accept": "*/*"}), min(timeout, 6)) as response: return response.status
    except urllib.error.HTTPError as error:
        code = error.code; error.close(); return code
    except (OSError, ValueError, TimeoutError, socket.timeout): return None

def blank(status="unverified", code=None):
    return {"status": status, "httpStatus": code, "firstDecodedFrameMs": None, "decodedFrames": 0}

def valid_location(location):
    if not isinstance(location, str) or len(location) > 32768 or re.search(r"[\x00-\x20\x7f\\]", location): return False
    try:
        parsed = urllib.parse.urlsplit(location)
        return parsed.scheme == "https" and parsed.hostname == "edge.flixify.vip" and parsed.port in {None, 443} and not parsed.username and not parsed.password and not parsed.fragment and parsed.path.startswith("/")
    except ValueError: return False

def probe_channel(credentials, channel, remote, timeout=15):
    validate_remote(remote)
    if timeout != 15: raise ValueError("pinned-decoder-requires-fifteen-seconds")
    origin = audit.canonical_origin(credentials["providerOrigin"])
    key = audit.stream_id(channel["streamId"])
    extension = channel["extension"]
    if extension not in audit.EXTENSIONS: raise ValueError("invalid-extension")
    ensure_remote_idle(remote)
    url = origin + "/live/" + urllib.parse.quote(credentials["username"], safe="") + "/" + urllib.parse.quote(credentials["password"], safe="") + "/" + key + "." + extension
    started = time.monotonic()
    try: code, location = fetch_original_entry(url, timeout)
    except (OSError, ValueError, TimeoutError, socket.timeout): return blank()
    if code in audit.HARD: return blank("http-unavailable", code)
    if code in {401, 403, 429}: return blank("blocked", code)
    if code != 302 or not valid_location(location): return blank(code=code)
    try: result = decode_remote(remote, {"url": location, "streamId": key}, timeout)
    finally: reconcile_remote(remote)
    frames = result.get("decodedFrames")
    first = result.get("firstDecodedFrameMs")
    if result["status"] == "working":
        if result.get("returnCode") != 0 or not isinstance(frames, int) or isinstance(frames, bool) or frames < 1 or not isinstance(first, (int, float)) or isinstance(first, bool) or not math.isfinite(first) or first < 0: raise BridgeHalt("remote-frame-not-proved")
        return {"status": "working", "httpStatus": None, "firstDecodedFrameMs": round((time.monotonic()-started)*1000), "decodedFrames": frames}
    code = result.get("decoderHttpError")
    if code is not None and (not isinstance(code, int) or isinstance(code, bool) or not 100 <= code <= 599): raise BridgeHalt("remote-status-invalid")
    if code in {401, 403, 429}: return blank("blocked", code)
    if code in audit.HARD:
        code = revalidate_original(url, timeout)
        return blank("http-unavailable" if code in audit.HARD else "blocked" if code in {401, 403, 429} else "undecodable" if code in {200, 206} else "unverified", code)
    return blank(code=code)
