"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefCallback, type RefObject } from 'react';

export type InfiniteScrollOptions = {
  scopeKey: string | object;
  rootRef?: RefObject<HTMLElement | null>;
  enabled: boolean;
  hasMore: boolean;
  loading: boolean;
  error?: unknown;
  progressKey: string | number;
  onLoadNext: () => void;
};

const prefetchPixels = 320;

export function useInfiniteScroll(options: InfiniteScrollOptions): RefCallback<HTMLElement> {
  const owner = useMemo(() => ({}), [options.scopeKey]);
  const current = useRef({ ...options, owner });
  useLayoutEffect(() => { current.current = { ...options, owner }; });
  const request = useRef<{ owner: object; progress: string | number } | null>(null);
  const check = useRef<(() => void) | null>(null);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => setSentinel(node), []);

  useEffect(() => {
    if (!sentinel) return;
    let disposed = false;
    let observation = 0;
    let observer: IntersectionObserver | null = null;
    let scrollRoot: HTMLElement | null = null;
    const resolveRoot = () => {
      const candidate = options.rootRef?.current;
      if (!candidate || typeof window.getComputedStyle !== 'function') return null;
      const style = window.getComputedStyle(candidate);
      return /^(auto|scroll|overlay)$/.test(style.overflowY || style.overflow) && candidate.clientHeight > 0 && candidate.scrollHeight > candidate.clientHeight ? candidate : null;
    };
    const load = () => {
      const next = current.current;
      if (disposed || next.owner !== owner || !sentinel.isConnected || !next.enabled || !next.hasMore || next.loading || next.error || document.visibilityState === 'hidden') return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (request.current?.owner === owner && Object.is(request.current.progress, next.progressKey)) return;
      request.current = { owner, progress: next.progressKey };
      next.onLoadNext();
    };
    const measure = () => {
      if (typeof sentinel.getBoundingClientRect !== 'function') return;
      const box = sentinel.getBoundingClientRect();
      if (box.width <= 0 && box.height <= 0) return;
      const bounds = scrollRoot?.getBoundingClientRect();
      const top = bounds?.top ?? 0;
      const bottom = bounds?.bottom ?? window.innerHeight;
      if (box.top <= bottom + prefetchPixels && box.bottom >= top - prefetchPixels) load();
    };
    const resize = () => {
      const nextRoot = resolveRoot();
      if (nextRoot !== scrollRoot || !observer) {
        scrollRoot?.removeEventListener('scroll', measure);
        scrollRoot = nextRoot;
        observer?.disconnect();
        const version = ++observation;
        const Observer = window.IntersectionObserver;
        if (typeof Observer === 'function') {
          observer = new Observer(entries => {
            if (version !== observation) return;
            const newest = [...entries].reverse().find(entry => entry.target === sentinel);
            if (newest?.isIntersecting) measure();
          }, { root: scrollRoot, rootMargin: `${prefetchPixels}px 0px`, threshold: 0 });
          observer.observe(sentinel);
        }
        scrollRoot?.addEventListener('scroll', measure, { passive: true });
      }
      measure();
    };
    check.current = measure;
    resize();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('focus', measure);
    document.addEventListener('focusin', measure);
    document.addEventListener('visibilitychange', measure);
    return () => {
      disposed = true;
      observation++;
      observer?.disconnect();
      scrollRoot?.removeEventListener('scroll', measure);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', resize);
      window.removeEventListener('focus', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('visibilitychange', measure);
      if (check.current === measure) check.current = null;
    };
  }, [sentinel, owner, options.rootRef]);

  useEffect(() => { check.current?.(); }, [owner, options.enabled, options.hasMore, options.loading, options.error, options.progressKey]);
  return sentinelRef;
}
