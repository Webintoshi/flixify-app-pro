import { defineConfig, mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import billing from './billing-vitest.config';
const tool = (path: string) => fileURLToPath(new URL(`../../../../artifacts/analytics-backend-tools/node_modules/${path}`, import.meta.url));
const module = (name: string) => fileURLToPath(new URL(`./api-source/${name}.ts`, import.meta.url));
export default mergeConfig(billing, defineConfig({ resolve: { alias: [
  { find: /^fastify$/, replacement: tool('fastify/fastify.js') },
  { find: /^pg$/, replacement: tool('pg/lib/index.js') },
  ...['analytics-policy','analytics-delivery','analytics-routes','analytics-store','analytics-runtime'].map(name => ({ find: new RegExp(`^(?:.*\\/)?${name}\\.js$`), replacement: module(name) }))
] }, test: { include: ['coolify/releases/2026-11-01-welcome-offer/welcome-tests/*.test.ts','coolify/releases/2026-11-01-packages/billing-tests/*.test.ts'] } }));
