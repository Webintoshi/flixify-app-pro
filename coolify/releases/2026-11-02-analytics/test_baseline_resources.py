import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import build


class BaselineResourceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name);self.directory.chmod(0o755)
        for name,data in [('server.js',b'export const ready=true;\n'),('chunk.js',b'export const n=1;\n')]:
            path=self.directory/name;path.write_bytes(data);path.chmod(0o644)
        digest=hashlib.sha256()
        entries=[['dir','',0o755]]
        for path in sorted(self.directory.iterdir()):entries.append(['file',path.name,0o644,path.stat().st_size,hashlib.sha256(path.read_bytes()).hexdigest()])
        for row in entries:digest.update((json.dumps(row,separators=(',',':'))+'\n').encode())
        self.fingerprint={'sha256':digest.hexdigest(),'files':2}
    def tearDown(self):self.temp.cleanup()
    def execute(self,expected,memory='1342177280',swap='268435456'):
        script=build.backend.compile_script('api',expected)
        wrapper='''const vm=require('node:vm'),realFs=require('node:fs');const root=JSON.parse(process.argv[1]),script=JSON.parse(process.argv[2]),values=JSON.parse(process.argv[3]);let compiled=0;
const map=p=>typeof p==='string'&&p.startsWith('/app/apps/api/dist')?root+p.slice('/app/apps/api/dist'.length):p;
const fs={...realFs,existsSync:p=>p==='/sys/fs/cgroup/memory.max'||realFs.existsSync(map(p)),readFileSync:(p,...args)=>p==='/sys/fs/cgroup/memory.max'?values.memory:p==='/sys/fs/cgroup/memory.swap.max'?values.swap:realFs.readFileSync(map(p),...args),lstatSync:(p,...args)=>realFs.lstatSync(map(p),...args),readdirSync:(p,...args)=>realFs.readdirSync(map(p),...args),openSync:(p,...args)=>realFs.openSync(map(p),...args)};
try{vm.runInNewContext(script,{require:n=>n==='node:fs'?fs:n==='node:child_process'?{execFileSync:()=>{compiled++}}:require(n),Buffer});console.log(JSON.stringify({ok:true,compiled}))}catch(error){console.log(JSON.stringify({ok:false,compiled,error:error.message}))}'''
        result=subprocess.check_output(['node','-e',wrapper,json.dumps(str(self.directory)),json.dumps(script),json.dumps({'memory':memory,'swap':swap})])
        return json.loads(result)
    def test_only_owned_compiler_creates_gain_one_cpu_with_same_memory_limits(self):
        calls=[]
        def original(*args,**kwargs):calls.append(args);return b'checked'
        common=('--network','none','--memory','1280m','--memory-swap','1536m','--pids-limit','256')
        for name,image in [('flixify-packages-api-build-123456789abc',build.p.API_ID),('flixify-search-web-build-123456789abc',build.p.WEB_ID)]:
            build.compiler_command(original,'docker','create','--name',name,*common,image,'node','-e','fixture')
            actual=calls[-1];self.assertEqual(actual[actual.index('--cpus')+1],'1')
            for key,value in [('--memory','1280m'),('--memory-swap','1536m'),('--pids-limit','256'),('--network','none')]:self.assertEqual(actual[actual.index(key)+1],value)
        other=('docker','create','--name','unrelated-project',build.p.API_ID)
        build.compiler_command(original,*other);self.assertEqual(calls[-1],other)
    def test_owned_compiler_with_relaxed_limits_is_rejected(self):
        with self.assertRaises(build.p.GateError):
            build.compiler_command(lambda *a,**k: self.fail('must not create relaxed compiler'),'docker','create','--name','flixify-packages-api-build-123456789abc','--network','none','--memory','2560m','--memory-swap','3072m','--pids-limit','256',build.p.API_ID)
    def test_sorted_measurement_keys_are_semantically_identical(self):
        expected=json.loads(json.dumps(self.fingerprint,sort_keys=True))
        self.assertEqual(list(expected),['files','sha256'])
        self.assertEqual(self.execute(expected),{'ok':True,'compiled':1})
    def test_changed_hash_or_file_count_is_still_rejected(self):
        for expected in (self.fingerprint|{'sha256':'a'*64},self.fingerprint|{'files':3}):
            self.assertEqual(self.execute(expected),{'ok':False,'compiled':1,'error':'baseline_source_dist_mismatch'})
    def test_unbounded_or_excessive_memory_stops_before_compiler(self):
        for memory,swap in [('max','268435456'),('1342177280','536870912')]:
            result=self.execute(self.fingerprint,memory,swap)
            self.assertFalse(result['ok']);self.assertEqual(result['compiled'],0);self.assertIn('build_cgroup_',result['error'])


if __name__=='__main__':unittest.main()
