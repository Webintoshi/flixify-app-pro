# One-time single/dual packages

New sales use six one-time Stripe prices, version `2026-11-01-one-time`. Checkout uses `mode: payment`, `ui_mode: embedded` and returns the authenticated customer’s client secret and the public publishable key. It never creates a new subscription. Existing recurring subscriptions and their four legacy runtime price IDs remain unchanged; only their genuine invoice renewals use the old invoice worker.

## API and payment verification

- `POST /me/billing/checkout-session` accepts only a server-defined package slug and returns `{clientSecret, sessionId, publishableKey}`. Exact active database price, Stripe one-time Price metadata, duration/user mapping and provider package are verified. Checkout reservations pin their immutable price and catalog version. Old ambiguous reservations cannot be replayed at a new price.
- `GET /me/billing/payment-status?session_id=...` is authenticated and first checks the local session owner. It returns awaiting_payment, processing, active, review_required or expired. A browser return or completion callback never grants access.
- Signed completed/async-succeeded payment events only enqueue a registered local checkout. The new worker reads the actual Checkout Session and its PaymentIntent from Stripe. It requires a completed/paid session, succeeded PI, exact received amount/currency/quantity/price, account ownership and catalog/user metadata before any provider operation.

## Separate idempotent fulfillment

`stripe_payment_jobs` is separate from legacy invoice/subscription tables. Session IDs are unique and PaymentIntent IDs are globally unique. Jobs claim once; provider ambiguity becomes review instead of another create or extension. A user advisory lock serializes provider writes. Its database client is reused through async context, and global payment concurrency is bounded to two.

The verified provider package determines one/two connections and 1/6/12 months (including the provider’s official year unit). The exact owned line is read after a single write. Capacity must match and expiry must advance a full package window. Only that observed provider expiry is saved as access end.

Completion locks the user and compares credentials against the pre-write snapshot. Any changed credentials roll back local activation. A trial record is cancelled with its original trial marker retained; a fresh paid row is inserted with explicit `activated_by_admin_id`. Existing paid access is updated to the authoritative provider expiry. One-time payment completion never writes a Stripe subscription record. The checkout becomes a compatible terminal expired row with fulfilled_at, releasing existing unfinished-checkout uniqueness; its fulfilled payment job determines active/expired status.

## Additive rollout

Migration 002 adds nullable checkout pins/fulfilled_at and the new job table. Legacy inserts explicitly set actor stripe-billing, and paid trial conversion preserves trial history. New paid line creation enables the same Private CDN and EPG settings required by the existing app. No existing provider line, customer, subscription price, secret or environment setting is changed by preparing these sources.

Verification covers mocked Stripe/provider boundaries plus an isolated real PostgreSQL fixture with strict NOT NULL actor, credential CAS, advisory locks, PI uniqueness, trial history and the existing partial unique unfinished-checkout index. No real charge is needed.

The existing referral program accepts only the first genuinely fulfilled live one-time session, using a separate unique payment-session proof. It retains inviter locking, first-paid attribution timing and the existing milestone rules. Qualification runs after activation commits and the provider lock releases; failures reconcile through the existing referral summary path without retrying provider writes. Referral reward inserts explicitly set their required actor and select the single-user one-month base package.
