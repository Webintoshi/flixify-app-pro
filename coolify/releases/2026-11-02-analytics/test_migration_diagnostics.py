import json
from pathlib import Path
import subprocess
import sys
import unittest

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import migrate


class MigrationDiagnosticsTests(unittest.TestCase):
    def execute(self, *, apply=False, rows=None):
        wrapper=r'''const vm=require('node:vm'),script=JSON.parse(process.argv[1]),input=JSON.parse(process.argv[2]),rows=JSON.parse(process.argv[3]);const queries=[],stdout=[],stderr=[];const processMock={env:{DATABASE_URL:'postgresql://private-user:private-password@db/fixture'},exitCode:0};
class Client{async connect(){}async end(){}async query(sql){queries.push(sql);if(sql===input.sql){const e=Error('postgresql://private-user:private-password@db/fixture secret payload');e.code='42501';throw e}if(sql.startsWith('select c.relname'))return{rows};if(sql.includes('aclexplode'))return{rows:[{allowed:false}]};if(sql.includes('pg_roles'))return{rows:[]};throw Error('unexpected fixture query')}}
(async()=>{await vm.runInNewContext(script,{require:n=>n==='node:fs'?{readFileSync:()=>JSON.stringify(input)}:n==='pg'?{Client}:require(n),URL,process:processMock,console:{log:s=>stdout.push(String(s)),error:s=>stderr.push(String(s))}});console.log(JSON.stringify({queries,stdout,stderr,exitCode:processMock.exitCode}))})().catch(e=>{console.error(e.message);process.exitCode=2});'''
        payload={'apply':apply,'existingReceipt':False,'sql':'fixture-pinned-migration'}
        result=subprocess.check_output(['node','-e',wrapper,json.dumps(migrate.NODE),json.dumps(payload),json.dumps(rows or [])])
        return json.loads(result)
    def test_first_ddl_failure_exposes_only_phase_sqlstate_and_allowlisted_reason(self):
        result=self.execute(apply=True)
        self.assertEqual(result['exitCode'],1)
        self.assertTrue(result['stderr'][0].startswith('{'),'migration failure must carry bounded sanitized metadata')
        value=json.loads(result['stderr'][0]);self.assertEqual(value,{'analyticsMigrationFailure':1,'phase':'migration_first_apply','sqlState':'42501','reason':'database_error'})
        self.assertNotIn('private',json.dumps(result['stderr']))
        self.assertNotIn('fixture-pinned-migration',json.dumps(result['stderr']))
    def test_readonly_current_schema_failure_never_reexecutes_ddl(self):
        rows=[{'relname':name,'relkind':'r','relrowsecurity':True,'columns':[],'constraints':[1,2],'indexes':[]} for name in migrate.TABLES]
        result=self.execute(rows=rows)
        self.assertEqual(result['exitCode'],1)
        self.assertTrue(result['stderr'][0].startswith('{'),'current-schema failure must be diagnosable without writes')
        value=json.loads(result['stderr'][0]);self.assertEqual(value['phase'],'validate_current_shape');self.assertEqual(value['reason'],'analytics_schema_shape')
        self.assertTrue(all(query.startswith('select ') for query in result['queries']))
    def test_readonly_empty_schema_is_still_readonly(self):
        result=self.execute();self.assertEqual(result['exitCode'],0);self.assertEqual(result['stderr'],[])
        self.assertEqual(json.loads(result['stdout'][0])['tables'],[])
        self.assertTrue(all(query.startswith('select ') for query in result['queries']))


if __name__=='__main__':unittest.main()
