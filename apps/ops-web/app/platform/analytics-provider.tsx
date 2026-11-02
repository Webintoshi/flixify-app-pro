"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { openAnalyticsPreferences, webAnalytics } from "./analytics";
import { ANALYTICS_CONSENT_KEY, type AnalyticsConsent } from "./analytics-policy";
import s from "./analytics.module.css";
const AnalyticsPromptContext = createContext(false);
export function useAnalyticsPromptVisible() { return useContext(AnalyticsPromptContext); }

export function AnalyticsBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [choice, setChoice] = useState<AnalyticsConsent>("unknown");
  const [ready, setReady] = useState(false);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const analytics = webAnalytics(); if (!analytics) return;
    const update = () => setChoice(analytics.consent());
    update(); setReady(true);
    const unsubscribe = analytics.subscribe(update);
    const open = () => setOpened(true);
    const stored = (event: StorageEvent) => { if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) void analytics.syncStoredConsent(); };
    const resume = () => { if (document.visibilityState !== "hidden") void analytics.start(); };
    window.addEventListener("flixify-analytics-preferences", open);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", resume); window.addEventListener("online", resume);
    const refresh = window.setInterval(resume, 60_000);
    void analytics.start();
    return () => { unsubscribe(); window.removeEventListener("flixify-analytics-preferences", open); window.removeEventListener("storage", stored); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); window.clearInterval(refresh); };
  }, []);
  useEffect(() => { webAnalytics()?.page(pathname); }, [pathname]);
  const choose = (next: "accepted" | "rejected") => { void webAnalytics()?.setConsent(next); setOpened(false); };
  const promptVisible = !pathname.startsWith("/admin") && (choice === "unknown" || opened);
  return <AnalyticsPromptContext.Provider value={promptVisible}>{children}{ready && promptVisible && <section className={s.banner} aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-description">
    <div><h2 id="analytics-consent-title">Kullanım istatistikleri</h2><p id="analytics-consent-description">Flixify’ı iyileştirmek için Google Analytics ile kullanım ve oynatma performansını ölçebiliriz. Kullanıcı kodun ve yayın bağlantıların paylaşılmaz. Seçimini Hesabım’dan veya sayfanın altındaki “İstatistik tercihleri” düğmesinden değiştirebilirsin.</p></div>
    <div className={s.actions}><button type="button" onClick={() => choose("rejected")}>İzin verme</button><button type="button" onClick={() => choose("accepted")}>İzin ver</button>{choice !== "unknown" && <button type="button" onClick={() => setOpened(false)}>Kapat</button>}</div>
  </section>}</AnalyticsPromptContext.Provider>;
}

export function AnalyticsPreferencesButton() { return <button type="button" className={s.preferences} onClick={openAnalyticsPreferences}>İstatistik tercihleri</button>; }

export function AnalyticsPreferencesFooter() { return <footer className={s.preferencesFooter}><AnalyticsPreferencesButton /></footer>; }

export function AnalyticsPreferences() {
  const [choice, setChoice] = useState<AnalyticsConsent>("unknown");
  useEffect(() => { const analytics = webAnalytics(); if (!analytics) return; setChoice(analytics.consent()); return analytics.subscribe(() => setChoice(analytics.consent())); }, []);
  return <section className={s.settings} aria-labelledby="analytics-settings-title"><h2 id="analytics-settings-title">Kullanım istatistikleri</h2><p>Google Analytics ile kullanım ve oynatma performansı ölçümü: <strong>{choice === "accepted" ? "Açık" : "Kapalı"}</strong>. Bu tercih hesabının ve izleme erişiminin çalışmasını etkilemez.</p><AnalyticsPreferencesButton /></section>;
}
