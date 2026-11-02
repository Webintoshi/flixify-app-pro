import type { FastifyInstance } from 'fastify';
import type { LegacyPackageSlug, PackageSlug } from './stripe-billing-policy.js';
import { resolveSalePackage, SALE_PACKAGE_SLUGS, STRIPE_PUBLISHABLE_KEY, type SalePriceIds, type SalePackage } from './stripe-sales-catalog.js';
import { WELCOME_CAMPAIGN, WELCOME_COUPON_ID, monthlyWelcomeOffer, type WelcomeCheckoutPin } from './welcome-offer.js';
import { BlockedUserRouteError } from './user-route-error.js';
import { validateAnalyticsAttribution, type AnalyticsAttribution } from './analytics-policy.js';

type CheckoutMetadata = { package_slug: PackageSlug; user_id: string; package_users: string; catalog_version: string; sale_price_id: string; welcome_offer_id?: string; welcome_amount_minor?: string; welcome_coupon_id?: string };
type CheckoutParams = {
  mode: 'payment';
  ui_mode: 'embedded_page';
  redirect_on_completion: 'if_required';
  customer: string;
  client_reference_id: string;
  line_items: [{ price: string; quantity: 1 }];
  return_url: string;
  discounts?: [{coupon: string}];
  metadata: CheckoutMetadata;
  payment_intent_data: { metadata: CheckoutMetadata };
};

export type StripeBillingRouteStore = {
  saveAnalyticsAttribution?(operationId: string, userId: string, attribution: AnalyticsAttribution): Promise<void>;
  accountState(userId: string, liveMode: boolean): Promise<{ customerId: string | null; activeSubscription: boolean; openCheckout: boolean }>;
  pendingCheckout(userId: string, liveMode: boolean): Promise<{ operationId: string; packageSlug: PackageSlug; status: 'creating' | 'open' | 'completed'; sessionId: string | null; priceId: string | null; catalogVersion: string | null; offerId?: string | null; couponId?: string | null; expectedAmountMinor?: number | null } | null>;
  expireCheckout(operationId: string, sessionId: string): Promise<void>;
  saveCustomer(userId: string, customerId: string, liveMode: boolean): Promise<string>;
  salePackageAvailable?(slug: string, months: number, amountMinor: number): Promise<boolean>;
  welcomeOfferEligible?(userId: string): Promise<boolean>;
  beginCheckout(userId: string, packageSlug: PackageSlug, liveMode: boolean, priceId: string, catalogVersion: string, offer?: WelcomeCheckoutPin): Promise<string>;
  completeCheckout(operationId: string, sessionId: string): Promise<void>;
  failCheckout(operationId: string): Promise<void>;
  customerFor(userId: string, liveMode: boolean): Promise<string | null>;
  billingStatus(userId: string, liveMode: boolean): Promise<{ status: string; periodEnd?: string | null; cancelAtPeriodEnd?: boolean }>;
};

export type StripeBillingRouteApi = {
  verifyCheckoutPackage?(slug: string): Promise<void>;
  verifyWelcomeCoupon?(): Promise<void>;
  createCustomer(userId: string, idempotencyKey: string): Promise<{ id: string }>;
  createCheckoutSession(params: CheckoutParams, idempotencyKey: string): Promise<{ id: string; clientSecret: string | null }>;
  retrieveCheckoutSession?(sessionId: string): Promise<{ id: string; status: string | null; paymentStatus: string; url: string | null; liveMode: boolean; customerId: string | null; userId: string | null; packageSlug: string | null; priceId: string | null; quantity: number | null; mode: string | null; uiMode: string | null; clientSecret: string | null; offerId?: string | null; couponIds?: (string|null)[]; amountTotal?: number|null; amountSubtotal?: number|null; amountDiscount?: number|null; expectedAmountMinor?: number|null; couponId?: string|null }>;
  expireCheckoutSession?(sessionId: string): Promise<void>;
  createPortalSession(customerId: string): Promise<{ url: string }>;
};

type Dependencies = {
  enabled: boolean;
  portalEnabled?: boolean;
  liveMode: boolean;
  allowedTestUserIds?: Set<string>;
  allowedLiveUserIds?: Set<string>;
  livePublicCheckoutEnabled?: boolean;
  priceIds: Record<LegacyPackageSlug, string>;
  salePriceIds?: SalePriceIds;
  authenticate(authorization?: string): Promise<{ userId: string }>;
  verifyProviderPackage?(providerPackageId: number, months: number, users: number): Promise<boolean>;
  store: StripeBillingRouteStore;
  stripe: StripeBillingRouteApi;
  paymentStatus?(userId: string, sessionId: string): Promise<{ status: string; packageSlug?: string; endsAt?: string } | null>;
};

function isExpectedStripeUrl(value: string | null, hostname: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname;
  } catch {
    return false;
  }
}

export function registerStripeBillingRoutes(app: FastifyInstance, deps: Dependencies): void {
  async function saveAttribution(operationId: string, userId: string, value: unknown): Promise<void> {
    const attribution = validateAnalyticsAttribution(value);
    if (!attribution) return;
    try { await deps.store.saveAnalyticsAttribution?.(operationId, userId, attribution); }
    catch { console.warn('[analytics] Checkout measurement unavailable'); }
  }
  function checkoutAvailableTo(userId: string): boolean {
    if (!deps.enabled) return false;
    if (deps.liveMode) return deps.livePublicCheckoutEnabled !== false || Boolean(deps.allowedLiveUserIds?.has(userId));
    return Boolean(deps.allowedTestUserIds?.has(userId));
  }

  async function saleAvailable(selected: SalePackage): Promise<boolean> {
    try {
      if (!deps.store.salePackageAvailable || !deps.stripe.verifyCheckoutPackage ||
          !await deps.store.salePackageAvailable(selected.slug, selected.intervalMonths, selected.amountMinor)) return false;
      await deps.stripe.verifyCheckoutPackage(selected.slug);
      return true;
    } catch { return false; }
  }

  async function authorized(authorization?: string): Promise<{ userId: string | null; status: 401 | 403 }> {
    try {
      return { userId: (await deps.authenticate(authorization)).userId, status: 401 };
    } catch (error) {
      return { userId: null, status: error instanceof BlockedUserRouteError ? 403 : 401 };
    }
  }

  app.post('/me/billing/checkout-session', async (request, reply) => {
    const auth = await authorized(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: auth.status === 403 ? 'blocked' : 'unauthorized' });
    const userId = auth.userId;
    if (!deps.enabled) return reply.code(503).send({ error: 'checkout_unavailable' });
    if (!checkoutAvailableTo(userId)) return reply.code(403).send({ error: deps.liveMode ? 'live_checkout_restricted' : 'test_checkout_restricted' });
    const body = request.body as { packageSlug?: unknown; offerId?: unknown; analytics?: unknown } | null;
    const slug = typeof body?.packageSlug === 'string' ? body.packageSlug : '';
    let selected;
    try {
      selected = resolveSalePackage(slug, deps.liveMode, deps.salePriceIds);
    } catch {
      return reply.code(503).send({ error: 'checkout_unavailable' });
    }
    if (!selected) return reply.code(400).send({ error: 'invalid_package' });
    const requestedOffer = body && Object.prototype.hasOwnProperty.call(body,'offerId');
    const welcome = requestedOffer ? monthlyWelcomeOffer(slug) : null;
    if (requestedOffer && (body?.offerId !== WELCOME_CAMPAIGN || !welcome)) return reply.code(400).send({error:'invalid_offer'});
    if (welcome && (!deps.store.welcomeOfferEligible || !await deps.store.welcomeOfferEligible(userId))) return reply.code(403).send({error:'offer_unavailable'});
    const offer: WelcomeCheckoutPin | undefined = welcome ? {offerId:WELCOME_CAMPAIGN,couponId:WELCOME_COUPON_ID,amountMinor:welcome.amountMinor} : undefined;
    if (offer) {try {if(!deps.stripe.verifyWelcomeCoupon) throw new Error('coupon_unavailable');await deps.stripe.verifyWelcomeCoupon();}catch{return reply.code(503).send({error:'checkout_unavailable'});}}
    const matchesOffer = (pin:{offerId?:string|null;couponId?:string|null;expectedAmountMinor?:number|null}) => offer ? pin.offerId===offer.offerId&&pin.couponId===offer.couponId&&pin.expectedAmountMinor===offer.amountMinor : !pin.offerId&&!pin.couponId&&pin.expectedAmountMinor==null;
    if (!await saleAvailable(selected) || !deps.verifyProviderPackage ||
        !await deps.verifyProviderPackage(selected.providerPackageId, selected.intervalMonths, selected.users)) {
      return reply.code(503).send({ error: 'checkout_unavailable' });
    }

    const state = await deps.store.accountState(userId, deps.liveMode);
    if (state.activeSubscription) return reply.code(409).send({ error: 'subscription_active' });
    const pending = await deps.store.pendingCheckout(userId, deps.liveMode);
    let resumedOperationId: string | null = null;
    if (pending) {
      if (pending.status === 'completed') return reply.code(409).send({ error: 'checkout_payment_pending' });
      if (pending.status === 'creating') {
        if (pending.packageSlug !== selected.slug || pending.priceId !== selected.priceId || pending.catalogVersion !== selected.catalogVersion || !matchesOffer(pending)) return reply.code(409).send({ error: 'checkout_preparing' });
        resumedOperationId = pending.operationId;
      } else {
        if (!pending.sessionId) return reply.code(503).send({ error: 'checkout_state_unavailable' });
        if (!deps.stripe.retrieveCheckoutSession) return reply.code(503).send({ error: 'checkout_state_unavailable' });
        try {
          const previous = await deps.stripe.retrieveCheckoutSession(pending.sessionId);
          if (previous.id !== pending.sessionId || previous.liveMode !== deps.liveMode || previous.userId !== userId ||
              previous.packageSlug !== pending.packageSlug || previous.customerId !== state.customerId) {
            return reply.code(503).send({ error: 'checkout_state_unavailable' });
          }
          if (previous.status === 'complete') return reply.code(409).send({ error: 'checkout_payment_pending' });
          if (previous.status === 'expired' && previous.paymentStatus === 'unpaid') {
            await deps.store.expireCheckout(pending.operationId, pending.sessionId);
          } else if (previous.status === 'open' && previous.paymentStatus === 'unpaid') {
            if (!previous.priceId || previous.quantity !== 1) return reply.code(503).send({ error: 'checkout_state_unavailable' });
            if (pending.packageSlug === selected.slug && pending.priceId === selected.priceId &&
                pending.catalogVersion === selected.catalogVersion && previous.priceId === selected.priceId && previous.mode === 'payment' &&
                previous.uiMode === 'embedded_page' && previous.clientSecret && matchesOffer(pending) && (!offer || previous.offerId===offer.offerId&&previous.couponId===offer.couponId&&previous.expectedAmountMinor===offer.amountMinor&&previous.amountTotal===offer.amountMinor&&previous.amountSubtotal===selected.amountMinor&&previous.amountDiscount===selected.amountMinor-offer.amountMinor&&previous.couponIds?.length===1&&previous.couponIds[0]===offer.couponId)) {
              await saveAttribution(pending.operationId, userId, body?.analytics);
              return { clientSecret: previous.clientSecret, sessionId: previous.id, publishableKey: STRIPE_PUBLISHABLE_KEY };
            }
            if (!deps.stripe.expireCheckoutSession) return reply.code(503).send({ error: 'checkout_state_unavailable' });
            await deps.stripe.expireCheckoutSession(pending.sessionId);
            await deps.store.expireCheckout(pending.operationId, pending.sessionId);
          } else {
            return reply.code(503).send({ error: 'checkout_state_unavailable' });
          }
        } catch {
          return reply.code(503).send({ error: 'checkout_state_unavailable' });
        }
      }
    }
    let operationId: string;
    try {
      operationId = resumedOperationId ?? await (offer ? deps.store.beginCheckout(userId, selected.slug, deps.liveMode, selected.priceId, selected.catalogVersion, offer) : deps.store.beginCheckout(userId, selected.slug, deps.liveMode, selected.priceId, selected.catalogVersion));
    } catch {
      return reply.code(409).send({ error: 'checkout_already_open' });
    }
    let sessionCreationStarted = false;
    try {
      let customerId = state.customerId;
      if (!customerId) {
        const created = await deps.stripe.createCustomer(userId, `flixify-customer-${deps.liveMode ? 'live' : 'test'}-${userId}`);
        customerId = await deps.store.saveCustomer(userId, created.id, deps.liveMode);
      }
      sessionCreationStarted = true;
      const session = await deps.stripe.createCheckoutSession({
        mode: 'payment',
        ui_mode: 'embedded_page',
        redirect_on_completion: 'if_required',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: selected.priceId, quantity: 1 }],
        ...(offer ? {discounts:[{coupon:offer.couponId}] as [{coupon:string}]} : {}),
        return_url: 'https://flixify.vip/odeme-sonucu?session_id={CHECKOUT_SESSION_ID}',
        metadata: { package_slug: selected.slug, user_id: userId, package_users: String(selected.users), catalog_version: selected.catalogVersion, sale_price_id: selected.priceId, ...(offer?{welcome_offer_id:offer.offerId,welcome_amount_minor:String(offer.amountMinor),welcome_coupon_id:offer.couponId}:{}) },
        payment_intent_data: { metadata: { package_slug: selected.slug, user_id: userId, package_users: String(selected.users), catalog_version: selected.catalogVersion, sale_price_id: selected.priceId, ...(offer?{welcome_offer_id:offer.offerId,welcome_amount_minor:String(offer.amountMinor),welcome_coupon_id:offer.couponId}:{}) } }
      }, operationId);
      if (!session.clientSecret || !session.id.startsWith('cs_')) throw new Error('invalid_checkout_session');
      await deps.store.completeCheckout(operationId, session.id);
      await saveAttribution(operationId, userId, body?.analytics);
      return { clientSecret: session.clientSecret, sessionId: session.id, publishableKey: STRIPE_PUBLISHABLE_KEY };
    } catch {
      // A network timeout can occur after Stripe created a usable Checkout.
      // Keep its reservation until reconciliation/expiry rather than permit a
      // second independently billed session.
      if (!sessionCreationStarted) await deps.store.failCheckout(operationId);
      return reply.code(503).send({ error: 'checkout_unavailable' });
    }
  });

  app.get('/me/billing/payment-status', async (request, reply) => {
    const auth = await authorized(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: auth.status === 403 ? 'blocked' : 'unauthorized' });
    const sessionId = (request.query as { session_id?: unknown })?.session_id;
    if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{1,255}$/.test(sessionId)) return reply.code(400).send({ error: 'invalid_session' });
    if (!deps.paymentStatus) return reply.code(503).send({ error: 'billing_unavailable' });
    const status = await deps.paymentStatus(auth.userId, sessionId);
    return status ?? reply.code(404).send({ error: 'payment_not_found' });
  });

  app.post('/me/billing/portal-session', async (request, reply) => {
    const auth = await authorized(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: auth.status === 403 ? 'blocked' : 'unauthorized' });
    const userId = auth.userId;
    if (!(deps.portalEnabled ?? deps.enabled)) return reply.code(503).send({ error: 'billing_unavailable' });
    const customerId = await deps.store.customerFor(userId, deps.liveMode);
    if (!customerId) return reply.code(404).send({ error: 'billing_customer_not_found' });
    const session = await deps.stripe.createPortalSession(customerId);
    if (!isExpectedStripeUrl(session.url, 'billing.stripe.com')) return reply.code(503).send({ error: 'billing_unavailable' });
    return { url: session.url };
  });

  app.get('/me/billing/status', async (request, reply) => {
    reply.header('cache-control','private, no-store');
    const auth = await authorized(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: auth.status === 403 ? 'blocked' : 'unauthorized' });
    const userId = auth.userId;
    const status = await deps.store.billingStatus(userId, deps.liveMode);
    const checkoutPackages: { packageSlug: string; amountTry: number; users: number; durationMonths: number; offerId?:string }[] = [];
    const eligible = Boolean(deps.store.welcomeOfferEligible && await deps.store.welcomeOfferEligible(userId));
    if (checkoutAvailableTo(userId)) {
      for (const slug of SALE_PACKAGE_SLUGS) {
        try {
          const selected = resolveSalePackage(slug, deps.liveMode, deps.salePriceIds);
          if (selected && await saleAvailable(selected)) {
            const welcome=eligible?monthlyWelcomeOffer(selected.slug):null;
            if(welcome){if(!deps.stripe.verifyWelcomeCoupon)continue;await deps.stripe.verifyWelcomeCoupon();}
            checkoutPackages.push({ packageSlug: selected.slug, amountTry: (welcome?.amountMinor??selected.amountMinor) / 100, users: selected.users, durationMonths: selected.intervalMonths, ...(welcome?{offerId:WELCOME_CAMPAIGN}:{}) });
          }
        } catch { /* Incomplete new-sale configuration cannot advertise a payable package. */ }
      }
    }
    return { ...status, checkoutEnabled: checkoutPackages.length > 0, checkoutPackages };
  });
}
