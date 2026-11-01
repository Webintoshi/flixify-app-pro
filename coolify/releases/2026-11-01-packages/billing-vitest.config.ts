import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const candidatePolicy = fileURLToPath(new URL('../../../apps/api/src/referral-policy.ts', import.meta.url));
const referencePolicy = fileURLToPath(new URL('../../../../artifacts/packages-20261101/production-source/referral-policy.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: [
    { find: /^\.\/user-route-error\.js$/, replacement: fileURLToPath(new URL('../../../apps/api/src/user-route-error.ts', import.meta.url)) },
    { find: /^\.\/referral-store\.js$/, replacement: fileURLToPath(new URL('./billing-tests/referral-store.fixture.ts', import.meta.url)) },
    { find: /^\.\/referral-policy\.js$/, replacement: existsSync(candidatePolicy) ? candidatePolicy : referencePolicy },
    { find: /^\.\/time\.js$/, replacement: fileURLToPath(new URL('../../../apps/api/src/time.ts', import.meta.url)) }
  ] },
  test: { include: ['coolify/releases/2026-11-01-packages/billing-tests/*.test.ts'] }
});
