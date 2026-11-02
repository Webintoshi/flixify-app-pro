import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { analyticsConfiguration } from '../api-source/analytics-delivery.js';
import { PostgresAnalyticsStore } from '../api-source/analytics-store.js';
import { validateWindowsAnalyticsBatch } from '../api-source/analytics-policy.js';

const connectionString=process.env.ANALYTICS_TEST_DATABASE_URL;
if(!connectionString)throw Error('ANALYTICS_TEST_DATABASE_URL required; no database fallback');
const target=new URL(connectionString);
if(!['postgres:','postgresql:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.username!=='flixify_fixture'||target.pathname!=='/flixify_analytics_fixture'||target.search||target.hash)throw Error('Refusing non-isolated analytics fixture database');
const pool=new Pool({connectionString,max:6,connectionTimeoutMillis:5000,statement_timeout:5000});
const configuration=analyticsConfiguration({GA4_ENABLED:'true',GA4_WEB_MEASUREMENT_ID:'G-WEB1234567',GA4_WEB_API_SECRET:'fixture-web-secret',GA4_WINDOWS_MEASUREMENT_ID:'G-WIN1234567',GA4_WINDOWS_API_SECRET:'fixture-windows-secret',GA4_ANALYTICS_HASH_SECRET:'x'.repeat(40)});
const store=new PostgresAnalyticsStore(pool,configuration);
const checks:string[]=[];
const checked=(name:string)=>{checks.push(name);console.log(`PASS ${name}`);};
const userId=randomUUID(),otherUserId=randomUUID();
let clientId=randomUUID();
function batch(count=1){const value=validateWindowsAnalyticsBatch({schema:1,consentVersion:1,clientPlatform:'windows',clientId,sessionId:12345,events:Array.from({length:count},()=>({id:randomUUID(),name:'video_start',eventTimestampMs:Date.now(),params:{content_type:'live',startup_ms:1000,content_id:'a'.repeat(64)}}))});assert.ok(value);return value;}
const count=async(where='true')=>Number((await pool.query(`select count(*) from public.analytics_outbox where ${where}`)).rows[0].count);
async function reserve(user:string,slug='1-ay-2-kullanici',liveMode=true,operationId:string=randomUUID()){const sessionId=`cs_fixture_${randomUUID().replaceAll('-','')}`;await pool.query("insert into public.stripe_checkout_sessions(operation_id,stripe_session_id,user_id,package_slug,livemode,status,welcome_offer_id,expected_amount_minor) values($1,$2,$3,$4,$5,'open','welcome-monthly-50-v1',19950)",[operationId,sessionId,user,slug,liveMode]);return{operationId,sessionId};}
async function paid(sessionId:string,user:string,status='fulfilling',liveMode=true){const pi=`pi_fixture_${randomUUID().replaceAll('-','')}`;await pool.query('insert into public.stripe_payment_jobs(stripe_session_id,payment_intent_id,user_id,livemode,status) values($1,$2,$3,$4,$5)',[sessionId,pi,user,liveMode,status]);return pi;}
async function fixture(){
 const identity=(await pool.query('select current_database() as database,current_user as owner')).rows[0];
 assert.deepEqual(identity,{database:'flixify_analytics_fixture',owner:'flixify_fixture'});
 const tables=(await pool.query("select tablename from pg_tables where schemaname='public'")).rows.map(row=>row.tablename);
 const owned=new Set(['analytics_fixture_owner','users','stripe_checkout_sessions','stripe_payment_jobs','analytics_consents','analytics_checkout_attribution','analytics_outbox']);
 assert.ok(tables.every(table=>owned.has(table)),'Unexpected public table; refusing fixture reset');
 if(tables.length){assert.ok(tables.includes('analytics_fixture_owner'));assert.equal((await pool.query('select marker from public.analytics_fixture_owner')).rows[0]?.marker,'flixify-analytics-fixture-20261102');}
 await pool.query('create table if not exists public.analytics_fixture_owner(marker text primary key)');
 await pool.query("insert into public.analytics_fixture_owner values('flixify-analytics-fixture-20261102') on conflict do nothing");
 await pool.query('drop table if exists public.analytics_outbox,public.analytics_checkout_attribution,public.analytics_consents,public.stripe_payment_jobs,public.stripe_checkout_sessions,public.users cascade');
 await pool.query(`create table public.users(id uuid primary key);
 create table public.stripe_checkout_sessions(operation_id text primary key,stripe_session_id text unique,user_id uuid references public.users(id),package_slug text,livemode boolean,status text,fulfilled_at timestamptz,welcome_offer_id text,expected_amount_minor integer);
 create table public.stripe_payment_jobs(stripe_session_id text primary key,payment_intent_id text unique,user_id uuid references public.users(id),livemode boolean,status text,created_at timestamptz not null default now());`);
 const migrationSql=await readFile(new URL('./migration.sql',import.meta.url),'utf8');
 const legacyUuidChild=migrationSql.replace('operation_id text primary key references public.stripe_checkout_sessions(operation_id)','operation_id uuid primary key references public.stripe_checkout_sessions(operation_id)');
 assert.notEqual(legacyUuidChild,migrationSql,'Fixture requires the actual TEXT billing parent and corrected TEXT child');
 const incompatible=await pool.connect();
 try{await assert.rejects(incompatible.query(legacyUuidChild),{code:'42804'});await incompatible.query('rollback');}finally{incompatible.release();}
 assert.equal((await pool.query("select count(*)::int as n from pg_tables where schemaname='public' and tablename in ('analytics_consents','analytics_checkout_attribution','analytics_outbox')")).rows[0].n,0);
 checked('actual TEXT checkout parent rejects the legacy UUID child with 42804 and rolls back all analytics DDL');
 await pool.query(migrationSql);
 await pool.query('insert into public.users(id) values($1),($2)',[userId,otherUserId]);
 assert.equal((await pool.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('analytics_consents','analytics_checkout_attribution','analytics_outbox') and c.relrowsecurity")).rows[0].n,3);
 checked('additive migration and private RLS tables');

 const first=batch();assert.equal(await store.acceptWindowsBatch(userId,first),1);assert.equal(await store.acceptWindowsBatch(userId,first),0);
 const concurrent=batch();assert.equal((await Promise.all([store.acceptWindowsBatch(userId,concurrent),store.acceptWindowsBatch(userId,concurrent)])).reduce((a,b)=>a+b),1);
 assert.equal(await count(),2);checked('durable replay and concurrent duplicate suppression');
 const [left,right]=await Promise.all([store.claim(1,['windows']),store.claim(1,['windows'])]);
 assert.equal(left.length,1);assert.equal(right.length,1);assert.notEqual(left[0].id,right[0].id);
 assert.ok((await pool.query("select lease_until>now()+interval '80 seconds' as bounded from public.analytics_outbox where event_key=$1",[left[0].id])).rows[0].bounded);
 await store.finish(left[0].id,randomUUID(),{delivered:true,retryable:false});
 assert.equal((await pool.query('select state from public.analytics_outbox where event_key=$1',[left[0].id])).rows[0].state,'sending');
 for(const event of [...left,...right])await store.finish(event.id,event.leaseToken,{delivered:false,retryable:false});
 checked('exclusive leases and stale acknowledgement protection');

 await store.acceptWindowsBatch(userId,batch());
 for(let attempt=1;attempt<=5;attempt++){
  const rows=await store.claim(1,['windows']);assert.equal(rows.length,1);
  const event=rows[0];await store.finish(event.id,event.leaseToken,{delivered:false,retryable:true});
  const state=(await pool.query('select state,attempts,next_attempt_at>now() as delayed from public.analytics_outbox where event_key=$1',[event.id])).rows[0];
  assert.equal(state.attempts,attempt);assert.equal(state.state,attempt<5?'pending':'dead');assert.equal(state.delayed,true);
  await pool.query("update public.analytics_outbox set next_attempt_at=now() where event_key=$1",[event.id]);
 }
 assert.equal((await store.claim(1,['windows'])).length,0);checked('bounded delayed retries and terminal failure');

 const stale=batch();await store.acceptWindowsBatch(userId,stale);const claimed=await store.claim(1,['windows']);assert.equal(claimed.length,1);
 await store.setConsent(userId,clientId,false);assert.equal(await store.consentActive(claimed[0]),false);assert.equal(await store.acceptWindowsBatch(userId,batch()),0);
 assert.equal(await count("state in ('pending','sending')"),0);await store.setConsent(userId,clientId,true);
 assert.equal((await pool.query('select accepted from public.analytics_consents where user_id=$1 and client_id=$2',[userId,clientId])).rows[0].accepted,false);
 assert.equal(await store.acceptWindowsBatch(userId,batch()),0);
 checked('withdrawal cancels leased and queued work and blocks a reordered stale grant');

 const reservation=await reserve(userId,'1-ay-2-kullanici',true,'checkout_fixture_non_uuid_operation');const attribution={consentVersion:1 as const,clientId:'12345.67890',sessionId:54321,clientPlatform:'web' as const,sourcePlatform:'macos' as const};
 const checkoutBefore=JSON.stringify((await pool.query('select * from public.stripe_checkout_sessions where operation_id=$1',[reservation.operationId])).rows[0]);
 await store.saveCheckoutAttribution(reservation.operationId,otherUserId,attribution);
 assert.equal((await pool.query('select count(*)::int as n from public.analytics_checkout_attribution')).rows[0].n,0);
 await store.saveCheckoutAttribution(reservation.operationId,userId,attribution);
 assert.equal((await pool.query('select count(*)::int as n from public.analytics_checkout_attribution')).rows[0].n,1);
 assert.equal(JSON.stringify((await pool.query('select * from public.stripe_checkout_sessions where operation_id=$1',[reservation.operationId])).rows[0]),checkoutBefore);
 const pi=await paid(reservation.sessionId,userId);
 const sale={userId,sessionId:reservation.sessionId,paymentIntentId:pi,liveMode:true,packageSlug:'1-ay-2-kullanici',amountMinor:19950,packageMonths:1,packageUsers:2,offerId:'welcome-monthly-50-v1'};
 await store.recordVerifiedSale('purchase',sale);await store.recordVerifiedSale('purchase',sale);await store.recordVerifiedSale('package_activated',sale);
 assert.equal(await count("stream='web' and event_name='purchase'"),1);assert.equal(await count("event_name='package_activated'"),0);
 const purchase=(await pool.query("select params from public.analytics_outbox where stream='web' and event_name='purchase'")).rows[0].params;
 assert.equal(purchase.value,199.5);assert.equal(purchase.currency,'TRY');assert.equal(purchase.client_platform,'web');assert.equal(purchase.source_platform,'macos');assert.match(purchase.transaction_id,/^fx_[a-f0-9]{48}$/);
 assert.ok(!JSON.stringify(purchase).includes(pi)&&!JSON.stringify(purchase).includes(reservation.sessionId)&&!JSON.stringify(purchase).includes(userId));
 await pool.query("update public.stripe_payment_jobs set status='fulfilled' where stripe_session_id=$1",[reservation.sessionId]);
 await store.recordVerifiedSale('package_activated',sale);await store.recordVerifiedSale('package_activated',sale);
 assert.equal(await count("event_name='package_activated'"),1);checked('owned checkout attribution, actual discounted revenue, opaque transaction and separate committed activation');

 const durable=await reserve(userId);const durableAttribution={...attribution,clientId:'97531.86420'};
 await store.saveCheckoutAttribution(durable.operationId,userId,durableAttribution);
 const durablePi=await paid(durable.sessionId,userId);const durableSale={...sale,sessionId:durable.sessionId,paymentIntentId:durablePi};
 const durableCount=async()=>Number((await pool.query('select count(*) from public.analytics_outbox where client_id=$1',[durableAttribution.clientId])).rows[0].count);
 await store.recordVerifiedSale('purchase',durableSale);assert.equal(await durableCount(),1);
 await pool.query("update public.analytics_outbox set state='delivered',created_at=now()-interval '5 days' where client_id=$1",[durableAttribution.clientId]);await store.prune();assert.equal(await durableCount(),0);
 await store.recordVerifiedSale('purchase',durableSale);await store.recordVerifiedSale('purchase',durableSale);assert.equal(await durableCount(),0);
 await pool.query("update public.stripe_payment_jobs set status='fulfilled' where stripe_session_id=$1",[durable.sessionId]);
 await store.recordVerifiedSale('package_activated',durableSale);await store.recordVerifiedSale('package_activated',durableSale);assert.equal(await durableCount(),1);
 await pool.query("update public.analytics_outbox set state='delivered',created_at=now()-interval '5 days' where client_id=$1",[durableAttribution.clientId]);await store.prune();assert.equal(await durableCount(),0);
 checked('durable revenue checkpoints survive outbox pruning while activation remains independent');

 const interrupted=await reserve(userId);await store.saveCheckoutAttribution(interrupted.operationId,userId,attribution);await paid(interrupted.sessionId,userId,'fulfilled');
 const test=await reserve(userId,'1-ay-2-kullanici',false);await store.saveCheckoutAttribution(test.operationId,userId,attribution);await paid(test.sessionId,userId,'fulfilled',false);
 const unpaid=await reserve(userId);await store.saveCheckoutAttribution(unpaid.operationId,userId,attribution);
 await pool.query("insert into public.stripe_payment_jobs(stripe_session_id,user_id,livemode,status) values($1,$2,true,'pending')",[unpaid.sessionId,userId]);
 await store.reconcileVerifiedSales();assert.equal(await count("stream='web'"),4);await store.reconcileVerifiedSales();assert.equal(await count("stream='web'"),4);
 checked('durable recovery of interrupted verified purchase without test or unpaid revenue');
 await store.setConsent(userId,attribution.clientId,false);await store.recordVerifiedSale('purchase',sale);await store.reconcileVerifiedSales();assert.equal(await count("stream='web'"),0);
 checked('withdrawn checkout attribution cannot resurrect revenue');

 clientId=randomUUID();await store.setConsent(userId,clientId,true);
 for(let index=0;index<10;index++)assert.equal(await store.acceptWindowsBatch(userId,batch(20)),20);
 await assert.rejects(store.acceptWindowsBatch(userId,batch()),{message:'analytics_capacity'});assert.equal(await count("state='pending'"),200);
 checked('bounded per-user pending queue capacity');
 await pool.query("update public.analytics_outbox set event_timestamp_ms=(extract(epoch from now()-interval '73 hours')*1000)::bigint where state='pending'");
 await store.prune();assert.equal(await count("state='pending'"),0);
 await pool.query("update public.analytics_outbox set created_at=now()-interval '5 days' where state='dead'");await store.prune();assert.equal(await count(),0);
 checked('expired delivery and bounded privacy retention cleanup');
 console.log(JSON.stringify({passed:true,checks,googleRequests:0,providerRequests:0,productionDatabaseAccess:false}));
}
try{await fixture();}finally{await pool.end();}
