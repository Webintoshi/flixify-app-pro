"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./install.module.css";

type MobilePlatform = "android" | "ios";
type Platform = MobilePlatform | "other";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallContextValue = {
  platform: Platform; installed: boolean; busy: boolean; canInstall: boolean;
  install: (target?: MobilePlatform) => void;
};
const InstallContext = createContext<InstallContextValue | null>(null);
const DISMISSED_KEY = "flixify-install-dismissed:v1";
const QUIET_PERIOD = 7 * 24 * 60 * 60 * 1000;
declare global {
  interface Window {
    __flixifyInstallPrompt?: InstallEvent | null;
    __flixifyAppInstalled?: boolean;
  }
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [platform, setPlatform] = useState<Platform>("other");
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [help, setHelp] = useState<MobilePlatform | null>(null);
  const deferred = useRef<InstallEvent | null>(null);
  const prompting = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const detected = /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      ? "ios" : /Android/i.test(ua) ? "android" : "other";
    setPlatform(detected);
    const standalone = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const checkInstalled = () => setInstalled(Boolean(window.__flixifyAppInstalled) || standalone.matches || fullscreen.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    checkInstalled();
    try {
      const until = Number(localStorage.getItem(DISMISSED_KEY));
      setDismissed(Number.isFinite(until) && until > Date.now() && until <= Date.now() + QUIET_PERIOD);
    } catch { setDismissed(false); }
    const beforeInstall = (event: Event) => {
      // Leave desktop browser behavior alone; we only promote the mobile PWA.
      if (detected !== "android") return;
      event.preventDefault(); deferred.current = event as InstallEvent;
      window.__flixifyInstallPrompt = event as InstallEvent;
      setCanInstall(true);
    };
    if (detected === "android" && window.__flixifyInstallPrompt) {
      deferred.current = window.__flixifyInstallPrompt;
      setCanInstall(true);
    }
    const onInstalled = () => { deferred.current = null; window.__flixifyInstallPrompt = null; window.__flixifyAppInstalled = true; setCanInstall(false); setInstalled(true); setHelp(null); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", checkInstalled);
    fullscreen.addEventListener("change", checkInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", checkInstalled);
      fullscreen.removeEventListener("change", checkInstalled);
    };
  }, []);

  useEffect(() => { setHelp(null); }, [pathname]);
  useEffect(() => {
    if (!help || !dialog.current) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current.showModal();
    return () => { previousFocus?.focus(); };
  }, [help]);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now() + QUIET_PERIOD)); } catch { /* Optional preference only. */ }
  }
  async function install(target?: MobilePlatform) {
    if (prompting.current) return;
    const requested = target ?? (platform === "ios" ? "ios" : "android");
    const event = deferred.current;
    if (requested !== "android" || platform !== "android" || !event) { setHelp(requested); return; }
    prompting.current = true; deferred.current = null; window.__flixifyInstallPrompt = null; setCanInstall(false); setHelp(null); setBusy(true);
    try {
      await event.prompt();
      await event.userChoice;
      dismiss();
    } catch { setHelp("android"); }
    finally { prompting.current = false; setBusy(false); }
  }
  const mediaOrAdmin = /^\/(canli-tv|filmler|diziler|favoriler|admin)(\/|$)/.test(pathname ?? "");
  return <InstallContext.Provider value={{ platform, installed, busy, canInstall, install }}>
    {children}
    {platform !== "other" && !installed && !dismissed && !mediaOrAdmin && <aside className={s.banner} aria-label="Uygulama kurulumu" role="region">
      <div className={s.bannerHeader}>
        <img src="/logo/icon-192.png" alt="" width="42" height="42"/>
        <div className={s.bannerCopy}><strong>Ana ekranına ekle</strong><span>Flixify’ı tek dokunuşla aç.</span></div>
        {platform === "android" && canInstall && <InstallAction className={s.primary}/>}
        <button type="button" className={s.close} aria-label="Kurulum önerisini kapat" onClick={dismiss}>×</button>
      </div>
      {platform === "ios" ? <ol className={s.quickSteps}>
        <li>Safari’de <strong>Paylaş</strong> simgesine dokun.<small>Görünmüyorsa önce ••• menüsünü aç.</small></li>
        <li><strong>Ana Ekrana Ekle → Ekle</strong><small>“Web Uygulaması Olarak Aç” açık kalsın.</small></li>
      </ol> : !canInstall ? <p className={s.quickHint}>Chrome menüsü <strong>⋮ → Ana ekrana ekle / Uygulamayı yükle</strong></p> : null}
    </aside>}
    {help && <dialog ref={dialog} className={s.dialog} aria-labelledby="install-help-title" onCancel={() => setHelp(null)} onClose={() => setHelp(null)}>
      <button type="button" className={s.dialogClose} aria-label="Kurulum yardımını kapat" onClick={() => setHelp(null)}>×</button>
      <img src="/logo/icon-192.png" alt="" width="56" height="56"/>
      <h2 id="install-help-title">{help === "android" && canInstall ? "Flixify kuruluma hazır" : "Flixify’ı ana ekranına ekle"}</h2>
      <p>Mağazadan indirmeden, uygulama gibi kullan. Kurulum ücretsizdir.</p>
      {help === "android" && platform === "android" && canInstall ? <button type="button" className={s.primary} onClick={() => install("android")}>Uygulamayı yükle</button> : help === "ios" ? <ol>
        <li>iPhone veya iPad’inde <strong>flixify.vip</strong> adresini Safari’de aç.</li>
        <li><strong>Paylaş</strong> menüsünden <strong>Ana Ekrana Ekle</strong> seçeneğine dokun.</li>
        <li>Görünüyorsa <strong>Web Uygulaması Olarak Aç</strong> seçeneğini açık bırak, ardından <strong>Ekle</strong> de.</li>
      </ol> : <ol>
        <li>Android telefonunda <strong>flixify.vip</strong> adresini Chrome’da aç.</li>
        <li>Sağ üstteki tarayıcı menüsünden <strong>Uygulamayı yükle</strong> veya <strong>Ana ekrana ekle</strong> seçeneğini seç.</li>
        <li>Kurulumu onayla, ana ekranındaki Flixify simgesinden aç.</li>
      </ol>}
      <p className={s.note}>{help === "android" ? "Tarayıcı doğrudan kuruluma izin verdiğinde “Uygulamayı yükle” düğmesi görünür. Seçenek yoksa Chrome menüsünü kullan; uygulama içi veya gizli tarayıcıdan çık. " : "Seçenek görünmüyorsa bağlantıyı Safari’de aç; uygulama içi veya özel tarayıcıdan çık. "}Mevcut kullanıcı kodunu sakla: ilk açılışta yeniden giriş istenebilir. İçerikler için internet bağlantısı gerekir.</p>
      <button type="button" className={s.primary} onClick={() => setHelp(null)}>Anladım</button>
    </dialog>}
  </InstallContext.Provider>;
}

export function InstallAction({ className = "", target, label, onActivate, compact = false, fallbackHref = "/indir", fallbackLabel = "Uygulamalar" }: {
  className?: string; target?: MobilePlatform; label?: string; onActivate?: () => void; compact?: boolean; fallbackHref?: string; fallbackLabel?: string;
}) {
  const context = useContext(InstallContext);
  if (context?.installed && (!target || context.platform === target)) return target ? <span className={s.installed}>Bu cihazda kurulu</span> : null;
  if (!context || (context.platform === "other" && !target)) return <Link href={fallbackHref} className={className} onClick={onActivate}>{fallbackLabel}</Link>;
  const requested = target ?? context.platform;
  const direct = requested === "android" && context.platform === "android" && context.canInstall;
  const actionLabel = direct ? label ?? "Uygulamayı yükle" : requested === "ios" ? (target ? "iPhone / iPad kurulum adımları" : "Ana ekrana ekle") : target ? "Android kurulum seçenekleri" : "Kurulum seçenekleri";
  return <button type="button" aria-label={actionLabel} className={`${s.action} ${className}`} disabled={context.busy} onClick={() => { onActivate?.(); context.install(target); }}>
    {compact ? <><svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span>{direct ? "Yükle" : "Kurulum"}</span></> : actionLabel}
  </button>;
}
