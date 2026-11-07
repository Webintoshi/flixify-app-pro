import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,describe,expect,it } from 'vitest';

const database=new URL(process.env.DATABASE_URL??'http://unconfigured.invalid');
const local=database.hostname==='127.0.0.1'&&database.port==='55441'&&database.pathname==='/flixify_phone_preview'&&process.env.PHONE_AUTH_TEST_DATABASE==='owned-local-only';
const cases=local?describe:describe.skip;
const pool=local?new Pool({connectionString:database.href}):null;
const schemas:string[]=[];
async function fixture(columns='id uuid primary key,created_at timestamptz not null default now()'){
  if(!pool)throw Error('Owned local database required');
  const name=`registration_provenance_${randomUUID().replaceAll('-','')}`;schemas.push(name);
  await pool.query(`create schema ${name};create table ${name}.users(${columns})`);
  const migration=(await readFile(new URL('../../../supabase/migrations/202611080001_registration_provenance.sql',import.meta.url),'utf8')).replaceAll('public.users',`${name}.users`);
  return {name,migrate:()=>pool.query(migration)};
}
cases('owned local registration provenance migration',()=>{
  afterAll(async()=>{if(pool){for(const name of schemas)await pool.query(`drop schema ${name} cascade`);await pool.end();}});
  it('is additive and idempotent without inferring or rewriting historical accounts',async()=>{
    const f=await fixture();const id=randomUUID();const date='2026-01-02T03:04:05.000Z';
    await pool!.query(`insert into ${f.name}.users(id,created_at) values($1,$2)`,[id,date]);
    await f.migrate();await f.migrate();
    expect((await pool!.query(`select id,created_at,registration_method,registration_platform from ${f.name}.users`)).rows).toEqual([{id,created_at:new Date(date),registration_method:null,registration_platform:null}]);
    const columns=(await pool!.query("select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema=$1 and column_name like 'registration_%' order by column_name",[f.name])).rows;
    expect(columns).toEqual([{column_name:'registration_method',data_type:'text',is_nullable:'YES',column_default:null},{column_name:'registration_platform',data_type:'text',is_nullable:'YES',column_default:null}]);
    await expect(pool!.query(`update ${f.name}.users set registration_method='unverified'`)).rejects.toMatchObject({code:'23514'});
    await expect(pool!.query(`update ${f.name}.users set registration_platform='unknown-device'`)).rejects.toMatchObject({code:'23514'});
  });
  it.each(['integer','text not null','text default \'web\''])('fails atomically for incompatible existing platform column %s',async definition=>{
    const f=await fixture(`id uuid primary key,registration_platform ${definition}`);
    await expect(f.migrate()).rejects.toThrow('Incompatible existing registration provenance column');
    expect((await pool!.query("select column_name from information_schema.columns where table_schema=$1 and column_name='registration_method'",[f.name])).rowCount).toBe(0);
  });
  it('rejects an unrelated existing check that reused the migration constraint name',async()=>{
    const f=await fixture("id uuid primary key,registration_method text constraint users_registration_method_check check(registration_method<>'bad'),registration_platform text");
    await expect(f.migrate()).rejects.toThrow('Incompatible existing registration provenance constraint');
  });
});
