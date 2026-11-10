#!/usr/bin/env python3
"""Publish/restore only WEB; keep the closed API, bot, environment and data unchanged."""
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('otp_recovery_build',Path(__file__).with_name('build.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def main():
 if len(sys.argv)<2:raise c.GateError('server_checkout_argument_required')
 with c.profile(Path(sys.argv[1])) as frozen:frozen.main()
if __name__=='__main__':
 try:main()
 except Exception as e:print('otp_recovery_release_stopped:'+str(e) if isinstance(e,c.GateError) else 'otp_recovery_release_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
