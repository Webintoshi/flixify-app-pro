import type { Pool, PoolClient } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { DeviceLoginError, type PreparedDeviceSession } from './device-login.js';

export type PhoneIdentity = { userId: string; sessionId: string; authMethod?: string };
export type DeviceLoginRow = {
  id: string; user_code: string; secret_verifier: string | null; installation_hash: string | null;
  device_name: string; platform: string; state: 'pending'|'approved'|'issued'|'completed'|'denied'|'cancelled'|'expired';
  user_id: string | null; expires_at: Date; delivery_expires_at: Date | null; envelope: string | null;
  interval_seconds: number; next_poll_at: Date | null; now: Date; account_suffix?: string | null;
};
export class DeviceLoginStore {
  readonly schema: string;
  constructor(private pool: Pool, schema = 'public') {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema');
    this.schema = schema;
  }
  private table(name: string) { return `"${this.schema}".${name}`; }
  async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query('begin'); const result = await run(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async rate(key: string, limit: number) {
    const result = await this.pool.query(`insert into ${this.table('device_login_rates')} as r (key_hash, window_start, hits)
      values ($1, clock_timestamp(), 1) on conflict (key_hash) do update set
      hits = case when r.window_start <= clock_timestamp() - interval '60 seconds' then 1 else r.hits + 1 end,
      window_start = case when r.window_start <= clock_timestamp() - interval '60 seconds' then clock_timestamp() else r.window_start end returning hits`, [key]);
    if (result.rows[0].hits > limit) throw new DeviceLoginError(429, 'rate_limited');
  }
  private async activeUser(client: PoolClient, userId: string) {
    const result = await client.query(`select id, code_suffix from ${this.table('users')} where id=$1 and status <> 'blocked' and deleted_at is null for share`, [userId]);
    if (!result.rows[0]) throw new DeviceLoginError(403, 'account_unavailable');
    return result.rows[0] as { id: string; code_suffix: string | null };
  }
  private async ownerSession(client: PoolClient, auth: PhoneIdentity) {
    const result = await client.query(`select id from ${this.table('device_sessions')} where id=$1 and user_id=$2
      and revoked_at is null and expires_at > clock_timestamp() and auth_method='account_code'`, [auth.sessionId, auth.userId]);
    if (!result.rows[0]) throw new DeviceLoginError(403, 'reauthentication_required');
  }
  private async lock(client: PoolClient, id: string): Promise<DeviceLoginRow> {
    const result = await client.query(`select *, clock_timestamp() as now from ${this.table('device_login_requests')} where id=$1 for update`, [id]);
    if (!result.rows[0]) throw new DeviceLoginError(404, 'request_unavailable');
    // clock_timestamp in the SELECT can precede waiting for the row lock.
    const time = await client.query('select clock_timestamp() as now');
    return { ...result.rows[0], now: time.rows[0].now };
  }
  private async revokeFamily(client: PoolClient, id: string) {
    await client.query(`update ${this.table('device_sessions')} set revoked_at=coalesce(revoked_at,clock_timestamp()) where family_id=$1`, [id]);
  }
  private async terminal(client: PoolClient, row: DeviceLoginRow, state: 'expired'|'cancelled'|'denied') {
    await this.revokeFamily(client, row.id);
    await client.query(`update ${this.table('device_login_requests')} set state=$2,envelope=null where id=$1`, [row.id, state]);
    row.state = state; row.envelope = null;
  }
  private async expire(client: PoolClient, row: DeviceLoginRow) {
    if (row.state === 'pending' && row.expires_at <= row.now || ['issued','approved'].includes(row.state) && (!row.delivery_expires_at || row.delivery_expires_at <= row.now)) {
      await this.terminal(client, row, 'expired');
    }
  }
  async start(input: { id: string; code: string; verifier: string; installationHash: string | null; deviceName: string; platform: string }) {
    return this.transaction(async (client) => {
      if (input.installationHash) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [input.installationHash]);
        const count = await client.query(`select count(*)::int as count from ${this.table('device_login_requests')}
          where installation_hash=$1 and ((state='pending' and expires_at>clock_timestamp()) or (state in ('approved','issued') and delivery_expires_at>clock_timestamp()))`, [input.installationHash]);
        if (count.rows[0].count >= 5) throw new DeviceLoginError(429, 'installation_rate_limited');
      }
      const result = await client.query(`insert into ${this.table('device_login_requests')}
        (id,user_code,secret_verifier,installation_hash,device_name,platform) values ($1,$2,$3,$4,$5,$6) returning *`,
      [input.id,input.code,input.verifier,input.installationHash,input.deviceName,input.platform]);
      return result.rows[0] as DeviceLoginRow;
    });
  }
  async lookup(code: string, auth: PhoneIdentity) {
    return this.transaction(async (client) => {
      const user = await this.activeUser(client, auth.userId); await this.ownerSession(client, auth);
      const result = await client.query(`select id from ${this.table('device_login_requests')} where user_code=$1`, [code]);
      if (!result.rows[0]) throw new DeviceLoginError(404, 'request_unavailable');
      const row = await this.lock(client, result.rows[0].id);
      if (row.user_id && row.user_id !== auth.userId) throw new DeviceLoginError(409, 'account_mismatch');
      await this.expire(client, row);
      return { ...row, account_suffix: user.code_suffix };
    });
  }
  private pendingDecision(row: DeviceLoginRow, code: string, auth: PhoneIdentity) {
    if (row.user_code !== code) throw new DeviceLoginError(404, 'request_unavailable');
    if (row.user_id && row.user_id !== auth.userId) throw new DeviceLoginError(409, 'account_mismatch');
    if (row.state !== 'pending') throw new DeviceLoginError(row.state === 'expired' ? 404 : 409, 'request_unavailable');
  }
  async validateDecision(id: string, code: string, auth: PhoneIdentity) {
    await this.transaction(async (client) => {
      await this.activeUser(client, auth.userId); await this.ownerSession(client, auth);
      const row = await this.lock(client, id); await this.expire(client, row); this.pendingDecision(row, code, auth);
    });
  }
  async decision(id: string, code: string, auth: PhoneIdentity, action: 'approve'|'deny', prepared: PreparedDeviceSession | null, seal: (suffix: string | null) => string) {
    return this.transaction(async (client) => {
      const user = await this.activeUser(client, auth.userId); await this.ownerSession(client, auth);
      const row = await this.lock(client, id); await this.expire(client, row); this.pendingDecision(row, code, auth);
      if (action === 'deny') {
        await client.query(`update ${this.table('device_login_requests')} set state='denied',user_id=$2,approver_session_id=$3,envelope=null where id=$1`, [id,auth.userId,auth.sessionId]);
        return { status: 'denied' as const };
      }
      if (!prepared) throw new Error('Session preparation missing');
      await this.insertSession(client, prepared, auth.userId, row);
      await client.query(`update ${this.table('device_login_requests')} set state='issued',user_id=$2,approver_session_id=$3,
        envelope=$4,delivery_expires_at=clock_timestamp()+interval '60 seconds' where id=$1`, [id,auth.userId,auth.sessionId,seal(user.code_suffix)]);
      return { status: 'approved' as const };
    });
  }
  private async insertSession(client: PoolClient, prepared: PreparedDeviceSession, userId: string, row: DeviceLoginRow) {
    await client.query(`insert into ${this.table('device_sessions')} (id,user_id,device_name,platform,refresh_token_hash,expires_at,auth_method,family_id)
      values ($1,$2,$3,$4,$5,clock_timestamp()+interval '10 years','device_link',$6)`, [prepared.id,userId,row.device_name,row.platform,prepared.refreshHash,row.id]);
  }
  async target(id: string, verifier: string, operation: 'token'|'ack'|'cancel') {
    return this.transaction(async (client) => {
      const row = await this.lock(client, id);
      if (!row.secret_verifier || row.secret_verifier.length !== verifier.length || !timingSafeEqual(Buffer.from(row.secret_verifier), Buffer.from(verifier))) throw new DeviceLoginError(404, 'request_unavailable');
      await this.expire(client, row);
      if (row.state === 'completed') return { status: 'complete' };
      if (operation === 'cancel') {
        if (!['expired','denied','cancelled'].includes(row.state)) await this.terminal(client, row, 'cancelled');
        return { status: 'cancelled' };
      }
      if (operation === 'ack') {
        if (row.state !== 'issued') throw new DeviceLoginError(409, 'request_unavailable');
        await this.complete(client, row.id); return { status: 'complete' };
      }
      if (['denied','cancelled','expired'].includes(row.state)) return { status: row.state };
      if (row.next_poll_at && row.next_poll_at > row.now) {
        const interval = Math.min(60, row.interval_seconds + 5);
        await client.query(`update ${this.table('device_login_requests')} set interval_seconds=$2::integer,next_poll_at=clock_timestamp()+make_interval(secs=>$2::integer) where id=$1`, [id,interval]);
        return { status: 'slow_down', intervalSeconds: interval };
      }
      await client.query(`update ${this.table('device_login_requests')} set next_poll_at=clock_timestamp()+make_interval(secs=>interval_seconds) where id=$1`, [id]);
      return row.state === 'issued' && row.envelope ? { status: 'authorized', envelope: row.envelope } : { status: 'pending', intervalSeconds: row.interval_seconds };
    });
  }
  private async complete(client: PoolClient, id: string) {
    // Keep the verifier for idempotent ACK/cancel; the random proof itself was never stored.
    await client.query(`update ${this.table('device_login_requests')} set state='completed',envelope=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=$1`, [id]);
  }
  async activate(userId: string, sessionId: string, familyId: string) {
    return this.transaction(async (client) => {
      await this.activeUser(client, userId);
      const row = await this.lock(client, familyId); await this.expire(client, row);
      if (row.user_id !== userId || !['issued','completed'].includes(row.state)) return false;
      const session = await client.query(`select id from ${this.table('device_sessions')} where id=$1 and user_id=$2 and family_id=$3 and auth_method='device_link' and revoked_at is null and expires_at>clock_timestamp()`, [sessionId,userId,familyId]);
      if (!session.rows[0]) return false;
      if (row.state !== 'completed') await this.complete(client, familyId);
      return true;
    });
  }
  async refresh(userId: string, oldSessionId: string, familyId: string, prepared: PreparedDeviceSession) {
    return this.transaction(async (client) => {
      await this.activeUser(client, userId);
      const row = await this.lock(client, familyId); await this.expire(client, row);
      if (row.user_id !== userId || !['issued','completed'].includes(row.state)) return false;
      const result = await client.query(`update ${this.table('device_sessions')} set revoked_at=clock_timestamp()
        where id=$1 and user_id=$2 and family_id=$3 and auth_method='device_link' and revoked_at is null and expires_at>clock_timestamp() returning id`, [oldSessionId,userId,familyId]);
      if (!result.rows[0]) return false;
      await this.insertSession(client, prepared, userId, row);
      // A valid refresh proves the target adopted its refresh token, also recovering a lost ACK.
      if (row.state !== 'completed') await this.complete(client, familyId);
      return true;
    });
  }
  async revokeLinkedSession(userId: string, sessionId: string, familyId: string) {
    return this.transaction(async (client) => {
      const row = await this.lock(client, familyId);
      const result = await client.query(`select id from ${this.table('device_sessions')} where id=$1 and user_id=$2 and family_id=$3`, [sessionId,userId,familyId]);
      if (row.user_id !== userId || !result.rows[0]) throw new DeviceLoginError(404, 'request_unavailable');
      await this.terminal(client, row, 'cancelled');
    });
  }
  async cleanup() {
    await this.transaction(async (client) => {
      const result = await client.query(`select *,clock_timestamp() as now from ${this.table('device_login_requests')}
        where (state='pending' and expires_at<=clock_timestamp()) or (state in ('approved','issued') and delivery_expires_at<=clock_timestamp())
        order by id limit 50 for update skip locked`);
      for (const row of result.rows) await this.expire(client, row);
      // Retain all family anchors. Terminal, unlinked requests have no session race to protect.
      await client.query(`delete from ${this.table('device_login_requests')} where id in
        (select r.id from ${this.table('device_login_requests')} r where state in ('expired','denied','cancelled')
         and expires_at<clock_timestamp()-interval '1 day' and not exists (select 1 from ${this.table('device_sessions')} s where s.family_id=r.id)
         limit 50 for update skip locked)`);
      await client.query(`delete from ${this.table('device_login_rates')} where key_hash in
        (select key_hash from ${this.table('device_login_rates')} where window_start<clock_timestamp()-interval '2 minutes' limit 100)`);
    });
  }
}
