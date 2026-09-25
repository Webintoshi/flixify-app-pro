"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import { accountState, type AccountUser } from "../../lib/account-model";
import { Icon } from "./icons";
import { usePlatform } from "./session";
import { RenewalDialog } from "./renewal";
import s from "./onboarding.module.css";

type User = AccountUser & { id: string };
const mediaRoutes = new Set(["/", "/filmler", "/diziler", "/canli-tv", "/favoriler", "/listem"]);
function hasAccess(user: User | null) { return Boolean(user?.hasAssignedLink && accountState(user).active); }
function Clock() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>; }
function CopyIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="8" y="3" width="12" height="15" rx="2"/><path d="M5 6H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"/></svg>; }
function Book() { return <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Zm0 0v15"/></svg>; }
function seenWelcome(id: string) {
  try { if (localStorage.getItem(`flixify-welcome:v1:${id}`) === "seen") return true; } catch { /* Optional device preference. */ }
  try { return sessionStorage.getItem(`flixify-welcome:v1:${id}`) === "seen"; } catch { return false; }
}
function rememberWelcome(id: string) {
  try { localStorage.setItem(`flixify-welcome:v1:${id}`, "seen"); } catch { /* A blocked store must never block navigation. */ }
  try { sessionStorage.setItem(`flixify-welcome:v1:${id}`, "seen"); } catch { /* Current component state still closes the dialog. */ }
}

function WelcomeDialog({ user, message, onClose }: { user: User; message: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const code = user.kryptoniteCode ?? "";
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyStatus("Kod kopyalandı."); }
    catch { setCopyStatus("Kopyalanamadı. Kodu seçerek kopyalayabilirsin."); }
  }
  return <dialog ref={ref} className={s.dialog} aria-labelledby="welcome-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={s.sheet}>
      <span className={s.handle} aria-hidden="true"/>
      <button type="button" className={s.close} onClick={onClose} aria-label="Karşılamayı kapat"><Icon name="close"/></button>
      <Image className={s.logo} src="/logo/flixify-logo.png" alt="Flixify Pro" width={170} height={44} unoptimized/>
      <h2 id="welcome-title">Flixify’a hoş geldin</h2>
      <p className={s.intro}>Kişisel kodunla hesabına eriş, favorilerini yanında taşı.</p>
      <div className={s.identity}>
        <span className={s.codeLabel}>Kullanıcı kodun</span>
        <div className={s.codeLine}><code>{code.match(/.{1,4}/g)?.join(" ") || "Kod alınamadı"}</code><button type="button" onClick={copy} disabled={!code} aria-label="Kodu kopyala"><CopyIcon/></button></div>
        <span className={s.copyStatus} role="status">{copyStatus || "Kodu kopyalamak için simgeye dokun."}</span>
        <p>Tekrar giriş yapmak için kodunu güvenli bir yerde sakla.</p>
      </div>
      <div className={s.sheetStatus}><Clock/><div><strong>{message}</strong><p>{user.status === "blocked" ? "Hesabınla ilgili yardım için destek ekibimize ulaşabilirsin." : "Erişim açıldığında içerikler burada görünecek."}</p></div></div>
      <button type="button" className={s.primary} onClick={onClose}>Platformu keşfet</button>
      <Link className={s.helpLink} href="/iletisim" onClick={onClose}>Yardım al</Link>
    </div>
  </dialog>;
}

function Preview({ user, refresh, busy, error }: { user: User; refresh: () => void; busy: boolean; error: boolean }) {
  const blocked = user.status === "blocked";
  const unassigned = !user.hasAssignedLink;
  const previousAccess = user.accessHistory?.hasPreviousAccess === true;
  const endedAt = user.accessHistory?.lastAccessEndedAt;
  const renewal = !blocked && !accountState(user).active && previousAccess && endedAt && Number.isFinite(Date.parse(endedAt)) && Date.parse(endedAt) <= Date.now();
  const [welcome, setWelcome] = useState(() => !blocked && !previousAccess && unassigned && !user.hasActiveSubscription && !seenWelcome(user.id));
  const [codeRequested, setCodeRequested] = useState(false);
  const [guide, setGuide] = useState(false);
  const close = useCallback(() => { rememberWelcome(user.id); setWelcome(false); setCodeRequested(false); }, [user.id]);
  const message = blocked ? "Hesabının durumu için destek ekibimizle iletişime geç." : user.hasActiveSubscription && unassigned ? "Paketin aktif; içerik bağlantın henüz tanımlanmamış." : unassigned && !previousAccess ? "Deneme erişimin henüz etkin değil." : "Aktif erişimin bulunmuyor.";
  return <main className={s.page} data-onboarding-preview>
    <header className={s.heading}><h1>Flixify’ı keşfet</h1><div className={s.status}><Clock/><p>{message}</p>{!blocked && <button type="button" onClick={refresh} disabled={busy}>{busy ? "Kontrol ediliyor…" : "Durumu kontrol et"}<Icon name="arrow"/></button>}</div>{error && <p className={s.refreshError} role="status">Durum yenilenemedi. Son doğrulanan bilgi gösteriliyor.</p>}</header>
    <section className={s.hero} aria-label="Platform önizlemesi">
      <Image src="/images/onboarding/discover-v1.webp" alt="Sinema, dağ manzarası ve futbol temalı arayüz önizlemesi" fill sizes="(max-width: 850px) 100vw, 1100px" priority unoptimized/>
      <span className={s.previewLabel}>Arayüz önizlemesi</span>
      <div className={s.heroCopy}><h2>İçeriklerin. Tek yerde.</h2><p>Favoriler, kişisel listeler ve cihazlar arası erişim.</p></div>
    </section>
    {!blocked && <div className={`${s.packages} ${!unassigned ? s.renewal : ""}`}><p>{unassigned ? "Sana uygun kullanım planını keşfet." : "Kaldığın yerden devam etmek için planları incele."}</p><Link href="/paketler">Paketleri incele<Icon name="arrow"/></Link></div>}
    <div className={s.features}>
      <button type="button" onClick={() => setGuide(value => !value)} aria-expanded={guide} aria-controls="welcome-guide"><Icon name="heart"/><span>Favorilerin <Icon name="arrow"/></span></button>
      <button type="button" onClick={() => { setCodeRequested(true); setWelcome(true); }}><span className={s.codeIcon} aria-hidden="true">&lt;/&gt;</span><span>Kullanıcı kodun <Icon name="arrow"/></span></button>
      <button type="button" onClick={() => setGuide(value => !value)} aria-expanded={guide} aria-controls="welcome-guide"><Book/><span>Nasıl kullanılır? <Icon name="arrow"/></span></button>
    </div>
    {guide && <section id="welcome-guide" className={s.guide}><h2>Kişisel alanın nasıl çalışır?</h2><p>Kullanıcı kodunla hesabına giriş yap. Erişimin açıldığında içeriklerin kalp simgesine dokunarak favorilerini oluştur; aynı kodla diğer cihazlarından listene ulaş.</p><p>Deneme durumunu yukarıdan kontrol edebilir, hesabınla ilgili yardım için destek ekibimize ulaşabilirsin.</p></section>}
    <div className={s.support}><span aria-hidden="true">ⓘ</span><p>Bir sorunun mu var? <Link href="/iletisim">Yardım al <Icon name="arrow"/></Link></p></div>
    {welcome && (!renewal || codeRequested) && <WelcomeDialog user={user} message={message} onClose={close}/>}
    {renewal && !codeRequested && <RenewalDialog key={`${user.id}:${endedAt}`} period={`${user.id}:${endedAt}`}/>}
  </main>;
}

function AccountAccess({ children, token }: { children: ReactNode; token: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  // Surface changes only on an authoritative response, never merely as the local clock advances.
  const [active, setActive] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    setBusy(true); setError(false);
    apiRequest<{ user: User }>("/me", { signal: controller.signal }).then(data => {
      if (!data?.user?.id || typeof data.user.hasAssignedLink !== "boolean" || typeof data.user.hasActiveSubscription !== "boolean") throw new Error("Invalid account status");
      if (current) { setUser(data.user); setActive(hasAccess(data.user)); }
    }).catch(() => { if (current) setError(true); }).finally(() => { clearTimeout(timeout); if (current) setBusy(false); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [token, version]);
  // One deadline timer, not player polling. Visibility handles background-tab throttling.
  useEffect(() => {
    const endsAt = Date.parse(user?.activePackage?.endsAt ?? "");
    if (!active || !Number.isFinite(endsAt)) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = endsAt - Date.now();
      if (remaining <= 0) { refresh(); return; }
      timer = setTimeout(schedule, Math.min(remaining + 25, 2147483647));
    };
    const visible = () => { if (document.visibilityState === "visible" && Date.now() >= endsAt) refresh(); };
    schedule(); document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [active, user?.activePackage?.endsAt, refresh]);
  useEffect(() => {
    if (!active || busy || !error || Date.parse(user?.activePackage?.endsAt ?? "") > Date.now()) return;
    const retry = setTimeout(refresh, 20000);
    return () => clearTimeout(retry);
  }, [active, busy, error, user?.activePackage?.endsAt, refresh]);
  // Recheck only inactive accounts. Do not poll or remount a working player.
  useEffect(() => {
    if (!user || active || user.status === "blocked") return;
    const check = () => { if (document.visibilityState === "visible" && !busy) refresh(); };
    const interval = setInterval(check, 20000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", check); };
  }, [Boolean(user), active, user?.status, busy, refresh]);
  if (!user) return <main className={s.initial}><Image src="/logo/flixify-logo.png" alt="Flixify Pro" width={170} height={44} unoptimized/><h1>{error ? "Hesap durumun şu anda doğrulanamıyor." : "Kişisel alanın açılıyor…"}</h1>{error ? <><p>Hesabında bir değişiklik yapılmadı. Tekrar deneyebilirsin.</p><button type="button" className={s.primary} onClick={refresh} disabled={busy}>{busy ? "Kontrol ediliyor…" : "Tekrar dene"}</button><Link href="/iletisim">Yardım al</Link></> : <p role="status">Erişim bilgilerin kontrol ediliyor.</p>}</main>;
  if (active) return <>{user.activePackage?.title === "24 Saat Test" && <div className={s.trialHint}><span>Deneme erişimin açık · Bitiş: {new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(user.activePackage.endsAt))}</span><Link href="/paketler">Paketleri incele<Icon name="arrow"/></Link></div>}{children}</>;
  return <Preview key={user.id} user={user} refresh={refresh} busy={busy} error={error}/>;
}

export function AccessBoundary({ children }: { children: ReactNode }) {
  const { session } = usePlatform();
  const path = usePathname();
  if (!session || !mediaRoutes.has(path ?? "/")) return <>{children}</>;
  const key = session.kryptoniteCode ?? session.user?.kryptoniteCode ?? session.accessToken;
  return <AccountAccess key={key} token={session.accessToken}>{children}</AccountAccess>;
}
