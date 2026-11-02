import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { analyticsConfiguration, deliverAnalyticsEvent, type AnalyticsConfiguration, type AnalyticsStream } from './analytics-delivery.js';
import { analyticsStore, type ClaimedAnalyticsEvent } from './analytics-store.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';

type DispatchStore = { claim(limit: number, streams: AnalyticsStream[]): Promise<ClaimedAnalyticsEvent[]>; consentActive(event: ClaimedAnalyticsEvent): Promise<boolean>; finish(eventId: string, leaseToken: string, result: {delivered:boolean;retryable:boolean}): Promise<void>; prune?(): Promise<void>; reconcileVerifiedSales?():Promise<void> };
export class AnalyticsDispatcher {
  private running = false;
  private stopped = false;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly store: DispatchStore, private readonly configuration: AnalyticsConfiguration, private readonly fetcher: typeof fetch = fetch) {}
  wake(): void {
    if (this.stopped || this.scheduled) return;
    this.scheduled = setTimeout(() => { this.scheduled=null; void this.flush(); },50);
    this.scheduled.unref?.();
  }
  close(): void { this.stopped=true; if(this.scheduled)clearTimeout(this.scheduled); this.scheduled=null; }
  async flush(): Promise<number> {
    if (this.running || this.stopped) return 0;
    const streams: AnalyticsStream[]=[]; if(this.configuration.web)streams.push('web'); if(this.configuration.windows)streams.push('windows');
    if(!streams.length)return 0;
    this.running=true; let delivered=0;
    try {
      await this.store.prune?.();
      await this.store.reconcileVerifiedSales?.();
      const events=await this.store.claim(10,streams);
      for(const event of events) {
        if(this.stopped)break;
        const outcome=await this.store.consentActive(event) ? await deliverAnalyticsEvent(this.configuration,event,this.fetcher) : {delivered:false,retryable:false};
        await this.store.finish(event.id,event.leaseToken,outcome);
        if(outcome.delivered)delivered++;
      }
    } catch { /* Keep leased rows recoverable; analytics cannot stop service work. */ }
    finally { this.running=false; }
    return delivered;
  }
}
export function registerAnalyticsRuntime(app: FastifyInstance, deps: { pool: Pool; authenticate(authorization?:string):Promise<{userId:string}>; environment?:Record<string,string|undefined>; fetcher?:typeof fetch }): void {
  const configuration=analyticsConfiguration(deps.environment??process.env);
  const store=analyticsStore(deps.pool,configuration);
  const dispatcher=new AnalyticsDispatcher(store,configuration,deps.fetcher);
  registerAnalyticsRoutes(app,{configuration,authenticate:deps.authenticate,store:{acceptWindowsBatch:(userId,batch)=>store.acceptWindowsBatch(userId,batch),setConsent:(userId,clientId,accepted)=>store.setConsent(userId,clientId,accepted),wake:()=>dispatcher.wake()}});
  const timer=setInterval(()=>dispatcher.wake(),15_000); timer.unref?.();
  app.addHook('onClose',async()=>{clearInterval(timer);dispatcher.close();});
}
