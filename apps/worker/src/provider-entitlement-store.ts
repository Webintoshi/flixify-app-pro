import type { Pool, PoolClient } from 'pg';
import { ProviderEntitlementError, type ProviderEntitlement } from './provider-entitlement.js';
import type { EntitlementJob, EntitlementStore } from './provider-entitlement-sync.js';
// Reused at discovery, claim and apply. Missing shared settings fail closed.
const eligible = `u.deleted_at is null and u.status <> 'blocked'
 and length(btrim(c.username)) > 0 and length(btrim(c.password)) > 0
 and exists (select 1 from public.app_settings a where a.id=true
   and c.username is distinct from a.shared_source_reference_username
   and not (c.username is not distinct from a.shared_source_reference_username and c.password is not distinct from a.shared_source_reference_password))
 and not exists(select 1 from public.user_iptv_credentials other where other.id<>c.id and other.username=c.username and other.password=c.password)`;
async function transaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
        await c.query('begin');
        const result = await fn(c);
        await c.query('commit');
        return result;
    }
    catch (e) {
        await c.query('rollback');
        throw e;
    }
    finally {
        c.release();
    }
}
type SubscriptionRow = {
    id: string;
    status: string;
    end_reason: string | null;
    ends_at: Date | string;
    package_id: string;
};
const conflict = () => new ProviderEntitlementError('SYNC_CONFLICT');
export function createProviderEntitlementStore(pool: Pool): EntitlementStore {
    return {
        async discover() {
            await pool.query(`insert into public.provider_entitlement_sync(user_id,credential_id,credential_version)
    select u.id,c.id,c.updated_at::text from public.users u join public.user_iptv_credentials c on c.user_id=u.id
    where ${eligible} on conflict(user_id,credential_id,credential_version) do nothing`);
        },
        async claim() {
            return transaction(pool, async (c) => {
                const result = await c.query(`select j.id,j.user_id,j.credential_id,j.credential_version,j.provider_line_id,c.username,c.password
     from public.provider_entitlement_sync j join public.users u on u.id=j.user_id
     join public.user_iptv_credentials c on c.id=j.credential_id and c.user_id=u.id and c.updated_at::text=j.credential_version
     where ${eligible} and j.next_attempt_at<=now() and (j.lease_until is null or j.lease_until<=now())
     order by j.next_attempt_at,j.id limit 5 for update of j skip locked`);
                const jobs: EntitlementJob[] = [];
                for (const r of result.rows) {
                    const lease = await c.query(`update public.provider_entitlement_sync set lease_token=gen_random_uuid(),lease_until=now()+interval '300 seconds' where id=$1 returning lease_token`, [r.id]);
                    jobs.push({ id: r.id, userId: r.user_id, credentialId: r.credential_id, credentialVersion: r.credential_version, providerLineId: r.provider_line_id, username: r.username, password: r.password, leaseToken: lease.rows[0].lease_token });
                }
                return jobs;
            });
        },
        async fail(job, code) {
            await pool.query(`update public.provider_entitlement_sync set failure_count=failure_count+1,last_error=$3,
    next_attempt_at=now()+make_interval(secs=>least(900,30*power(2,least(failure_count,5)))::integer),lease_token=null,lease_until=null
    where id=$1 and lease_token=$2 and lease_until>now()`, [job.id, job.leaseToken, code]);
        },
        async apply(job, line) {
            if (line.username !== job.username || line.password !== job.password || (job.providerLineId && job.providerLineId !== line.lineId))
                throw conflict();
            await transaction(pool, async (c) => {
                // Prevent reassignment/duplicate pair insertion between eligibility check and commit.
                const user = await c.query('select id from public.users where id=$1 for update', [job.userId]);
                if (!user.rows.length)
                    throw conflict();
                await c.query('lock table public.user_iptv_credentials in share mode');
                await c.query('select id from public.app_settings where id=true for share');
                const check = await c.query(`select j.subscription_id,j.provider_line_id
     from public.provider_entitlement_sync j join public.users u on u.id=j.user_id
     join public.user_iptv_credentials c on c.id=j.credential_id and c.user_id=u.id
     where j.id=$1 and j.lease_token=$2 and j.lease_until>now() and j.user_id=$3 and j.credential_id=$4
       and j.credential_version=$5 and c.updated_at::text=$5 and c.username=$6 and c.password=$7
       and ${eligible} for update of j,c`, [job.id, job.leaseToken, job.userId, job.credentialId, job.credentialVersion, job.username, job.password]);
                const state = check.rows[0];
                if (!state || (state.provider_line_id && state.provider_line_id !== line.lineId))
                    throw conflict();
                // A new credential version may verify the same line. Transfer its unique mapping only within this user.
                const previous = await c.query(`with old as (
                select id,subscription_id from public.provider_entitlement_sync where user_id=$1 and id<>$2 and provider_line_id=$3 for update
              ), cleared as (
                update public.provider_entitlement_sync j set provider_line_id=null,subscription_id=null from old where j.id=old.id
              ) select subscription_id from old`, [job.userId, job.id, line.lineId]);
                state.subscription_id ??= previous.rows[0]?.subscription_id ?? null;
                const subscriptions = await c.query(`select s.* from public.subscriptions s where s.user_id=$1 order by s.id for update`, [job.userId]);
                const subscriptionRows = subscriptions.rows as SubscriptionRow[];
                const current = subscriptionRows.find(s => s.id === state.subscription_id);
                const clock = await c.query('select now() as checked_at');
                const checkedAt = new Date(clock.rows[0].checked_at).getTime();
                const paid = !line.isTrial && line.enabled && line.adminEnabled && Date.parse(line.expiresAt) > checkedAt;
                const canReopen = !current || current.status !== 'cancelled' || ['provider-disabled', 'provider-trial', 'provider-expired', 'provider-replaced'].includes(current.end_reason);
                let subscriptionId: string | null = state.subscription_id;
                const audit = async (id: string, action: string, from: unknown, to: unknown) => {
                    await c.query(`insert into public.admin_audit_logs(admin_id,action,entity_type,entity_id,payload)
      values('provider-sync',$1,'subscription',$2,jsonb_build_object('syncId',$3::text,'providerLineId',$4::text,'before',$5::jsonb,'after',$6::jsonb))`, [action, id, job.id, line.lineId, JSON.stringify(from), JSON.stringify(to)]);
                };
                if (paid && canReopen) {
                    const slug = ({ '8': '1-ay', '9': '3-ay', '10': '6-ay', '11': '12-ay' } as Record<string, string>)[line.packageId] ?? 'provider-managed';
                    const packages = await c.query('select id from public.packages where slug=$1', [slug]);
                    const packageId = packages.rows[0]?.id;
                    if (!packageId)
                        throw conflict();
                    for (const s of subscriptionRows.filter(s => s.status === 'active' && s.id !== subscriptionId)) {
                        await c.query("update public.subscriptions set status='cancelled',end_reason='provider-replaced' where id=$1", [s.id]);
                        await audit(s.id, 'provider-close-conflict', { status: s.status, endReason: s.end_reason }, { status: 'cancelled', endReason: 'provider-replaced' });
                    }
                    if (!current) {
                        const created = await c.query(`insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id,end_reason)
       values($1,$2,'active',now(),$3,'provider-sync',null) returning id`, [job.userId, packageId, line.expiresAt]);
                        subscriptionId = created.rows[0].id;
                        await audit(subscriptionId!, 'provider-activate', null, { status: 'active', endsAt: line.expiresAt, packageId });
                    }
                    else if (current.status !== 'active' || new Date(current.ends_at).toISOString() !== line.expiresAt || current.package_id !== packageId || current.end_reason !== null) {
                        await c.query("update public.subscriptions set status='active',ends_at=$2,package_id=$3,end_reason=null where id=$1", [current.id, line.expiresAt, packageId]);
                        await audit(current.id, 'provider-update', { status: current.status, endsAt: current.ends_at, packageId: current.package_id }, { status: 'active', endsAt: line.expiresAt, packageId });
                    }
                    await c.query("update public.users set status='active' where id=$1 and status='new'", [job.userId]);
                }
                else if (!paid) {
                    // Close all sync-managed records including older credential versions, preserving trials and admin reasons.
                    const managed = await c.query('select subscription_id from public.provider_entitlement_sync where user_id=$1', [job.userId]);
                    const ids = new Set(managed.rows.map((r: {
                        subscription_id: string | null;
                    }) => r.subscription_id));
                    const reason = line.isTrial ? 'provider-trial' : !line.enabled || !line.adminEnabled ? 'provider-disabled' : 'provider-expired';
                    for (const s of subscriptionRows.filter(s => (ids.has(s.id) || !line.isTrial) && s.status === 'active')) {
                        await c.query('update public.subscriptions set status=$2,end_reason=$3,ends_at=$4 where id=$1', [s.id, reason === 'provider-expired' ? 'expired' : 'cancelled', reason, ids.has(s.id) ? line.expiresAt : s.ends_at]);
                        await audit(s.id, 'provider-close', { status: s.status, endsAt: s.ends_at }, { status: reason === 'provider-expired' ? 'expired' : 'cancelled', endReason: reason, endsAt: line.expiresAt });
                    }
                }
                await c.query(`update public.provider_entitlement_sync set provider_line_id=$3,subscription_id=$4,last_success_at=now(),
     failure_count=0,last_error=null,next_attempt_at=now()+interval '60 seconds',lease_token=null,lease_until=null where id=$1 and lease_token=$2`, [job.id, job.leaseToken, line.lineId, subscriptionId]);
            });
        }
    };
}
