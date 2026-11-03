"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { webAnalytics } from "./analytics";

export function AnalyticsBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    const analytics = webAnalytics(); if (!analytics) return;
    const resume = () => { if (document.visibilityState !== "hidden") void analytics.start(); };
    window.addEventListener("focus", resume); window.addEventListener("online", resume);
    const refresh = window.setInterval(resume, 60_000);
    void analytics.start();
    return () => { window.removeEventListener("focus", resume); window.removeEventListener("online", resume); window.clearInterval(refresh); };
  }, []);
  useEffect(() => { webAnalytics()?.page(pathname); }, [pathname]);
  return children;
}
