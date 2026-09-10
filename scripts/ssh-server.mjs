import { execSync } from 'child_process';
import os from 'os';
import path from 'path';

const k = path.join(os.homedir(), '.ssh', 'coolify_host_key');
try {
  execSync(`icacls "${k}" /inheritance:r /grant:r ${process.env.USERNAME}:F`);
} catch (e) {}

const cmd = process.argv[2] || 'docker ps';
try {
  const res = execSync(`ssh -i "${k}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@87.76.130.252 "${cmd}"`, { stdio: 'pipe' });
  console.log(res.toString());
} catch (err) {
  console.error('ERROR:', err.message);
  if (err.stdout) console.log('STDOUT:', err.stdout.toString());
  if (err.stderr) console.error('STDERR:', err.stderr.toString());
}
