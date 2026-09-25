"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { usePlatform } from "./session";
import { maskCode } from "./types";
import { LoginDialog } from "./login";
import s from "./platform.module.css";

const links = [{ href: "/", label: "Ana Sayfa", icon: "home" }, { href: "/canli-tv", label: "Canlı TV", icon: "live" }, { href: "/filmler", label: "Filmler", icon: "movie" }, { href: "/diziler", label: "Diziler", icon: "series" }, { href: "/favoriler", label: "Favoriler", icon: "heart" }];
export function AppShell({ children, publicAccess = false }: { children: ReactNode; publicAccess?: boolean }) {
  const { session, ready, error, dismissError, reload, logout } = usePlatform();
  const pathname = usePathname();
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const code = session?.kryptoniteCode ?? session?.user?.kryptoniteCode ?? "";
  const navigation = session ? links : [...links, { href: "/kayit-ol", label: "Kayıt Ol", icon: "arrow" }];
  const catalogRoute = ["/", "/filmler", "/diziler", "/favoriler"].includes(pathname);
  useEffect(() => { setRevealed(false); }, [pathname]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!codeRef.current?.contains(e.target as Node)) setRevealed(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setRevealed(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, []);
  if (!ready) return <div className={s.loading} aria-busy="true">Flixify hazırlanıyor…</div>;
  if (!session && !publicAccess) return <div className={s.app}><Link href="/" className={s.brand}><img src="/logo/flixify-logo.png" alt="Flixify" width="142" height="37" /></Link><div className={s.loading}>İçeriklerin. Tek yerde.</div><LoginDialog onClose={() => router.push("/")} onSuccess={() => setRevealed(false)} /></div>;
  return <div className={`${s.app}${pathname === "/canli-tv" ? ` ${s.liveTvApp}` : ""}${catalogRoute ? ` ${s.catalogApp}` : ""}`}>
    <header className={s.header}>
      <Link href="/" className={s.brand} aria-label="Flixify ana sayfa"><img src="/logo/flixify-logo.png" alt="Flixify" width="142" height="37" /></Link>
      <nav className={s.nav} aria-label="Ana menü">{navigation.map(link => <Link key={link.href} href={link.href} className={pathname === link.href ? s.active : ""} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav>
      <div className={s.account} ref={codeRef}>
        {session ? <button className={s.code} aria-label={revealed ? "Kullanıcı kodunu gizle" : "Kullanıcı kodunu göster"} aria-expanded={revealed} onClick={() => setRevealed(v => !v)}><span>{revealed ? code : maskCode(code)}</span><Icon name="chevron" /></button> : <div className={s.guestActions}><Link href="/giris-yap" className={s.code}>Giriş yap</Link><Link href="/kayit-ol" className={s.code}>Kayıt Ol</Link></div>}
        {revealed && <div className={s.accountMenu}><span>Kullanıcı kodun</span><strong>{code}</strong><Link href="/ayarlar">Hesap ayarları</Link><button onClick={() => { logout(); router.push("/"); }}>Çıkış Yap</button></div>}
      </div>
    </header>
    <div className={s.appBody}>
      <nav className={s.rail} aria-label="Hızlı menü">{links.map(link => <Link key={link.href} href={link.href} aria-label={link.label} className={pathname === link.href ? s.active : ""}><Icon name={link.icon} /></Link>)}<Link className={s.settings} href="/ayarlar" aria-label="Hesap ayarları"><Icon name="settings" /></Link></nav>
      <div className={s.main}>{children}</div>
    </div>
    <nav className={s.mobileNav} aria-label="Mobil menü">{navigation.map(link => <Link key={link.href} href={link.href} className={pathname === link.href ? s.active : ""} aria-current={pathname === link.href ? "page" : undefined}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</nav>
    {error && <div className={s.toast} role="alert"><span>{error}</span><button onClick={reload}>Tekrar Dene</button><button aria-label="Bildirimi kapat" onClick={dismissError}><Icon name="close" /></button></div>}
  </div>;
}
