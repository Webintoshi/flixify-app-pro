import { defineConfig, mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import billing from '../2026-11-01-welcome-offer/billing-vitest.config';
export default mergeConfig(billing, defineConfig({resolve:{alias:
  ['analytics-policy','analytics-delivery','analytics-routes','analytics-store','analytics-runtime'].map(name => ({find:new RegExp(`^(?:.*\\/)?${name}\\.js$`),replacement:fileURLToPath(new URL(`../../../apps/api/src/${name}.ts`,import.meta.url))}))
},test:{include:['coolify/releases/2026-11-01-welcome-offer/welcome-tests/*.test.ts','coolify/releases/2026-11-01-packages/billing-tests/*.test.ts']}}));
