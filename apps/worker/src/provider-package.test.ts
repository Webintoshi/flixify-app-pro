import { describe, expect, it } from 'vitest';
import { resolveProviderPackageSlug } from './provider-entitlement-store.js';

describe('provider package capacity mapping', () => {
    it.each([['8', '1-ay'], ['10', '6-ay'], ['11', '12-ay']])('maps verified capacity for duration package %s', (packageId, slug) => {
        expect(resolveProviderPackageSlug(packageId, 1)).toBe(slug);
        expect(resolveProviderPackageSlug(packageId, 2)).toBe(slug + '-2-kullanici');
    });
    it('preserves legacy three month entitlement without selling a new variant', () => {
        expect(resolveProviderPackageSlug('9', 1)).toBe('3-ay');
        expect(resolveProviderPackageSlug('9', 2)).toBe('3-ay');
    });
    it.each([['13', '1-ay'], ['15', '6-ay'], ['16', '12-ay']])('maps verified dual provider package %s without converting years to months again', (packageId, slug) => {
        const dual = slug + '-2-kullanici';
        expect(resolveProviderPackageSlug(packageId, 2)).toBe(dual);
        expect(resolveProviderPackageSlug(packageId, 1)).toBe('provider-managed');
        expect(resolveProviderPackageSlug(packageId, undefined)).toBe('provider-managed');
        expect(resolveProviderPackageSlug(packageId, undefined, dual)).toBe(dual);
        expect(resolveProviderPackageSlug(packageId, undefined, '3-ay')).toBe('provider-managed');
    });
    it('retains current dual capacity only for missing count and matching duration', () => {
        expect(resolveProviderPackageSlug('10', undefined, '6-ay-2-kullanici')).toBe('6-ay-2-kullanici');
        expect(resolveProviderPackageSlug('11', undefined, '6-ay-2-kullanici')).toBe('12-ay');
        expect(resolveProviderPackageSlug('10', undefined, '6-ay')).toBe('6-ay');
        expect(resolveProviderPackageSlug('10', undefined)).toBe('6-ay');
    });
    it('uses observed single capacity even when the managed record was dual', () => {
        expect(resolveProviderPackageSlug('10', 1, '6-ay-2-kullanici')).toBe('6-ay');
    });
    it('uses a neutral package for unsupported provider duration or capacity', () => {
        expect(resolveProviderPackageSlug('999', 2, '6-ay-2-kullanici')).toBe('provider-managed');
        expect(resolveProviderPackageSlug('10', 3, '6-ay-2-kullanici')).toBe('provider-managed');
        expect(resolveProviderPackageSlug('14', 2)).toBe('provider-managed');
        expect(resolveProviderPackageSlug('17', 2)).toBe('provider-managed');
    });
    it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid capacity before any store mutation (%s)', (maxConnections) => {
        expect(() => resolveProviderPackageSlug('10', maxConnections, '6-ay-2-kullanici')).toThrow('PROVIDER_INVALID');
    });
});
