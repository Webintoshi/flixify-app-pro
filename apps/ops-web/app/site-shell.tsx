"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearAdminToken } from "../lib/api";
import MobileTabBar from "./components/navigation/MobileTabBar";

const publicNavigation = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/filmler", label: "Filmler" },
  { href: "/diziler", label: "Diziler" },
  { href: "/canli-tv", label: "Canli TV" },
  { href: "/indir", label: "İndir" }
];

const adminNavigation = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/kullanicilar", label: "Kullanıcılar", icon: "users-total" },
  { href: "/admin/paketler", label: "Paketler", icon: "package" },
  { href: "/admin/odeme-yontemleri", label: "Ödeme Yöntemleri", icon: "filter" },
  { href: "/admin/ayarlar", label: "Ayarlar", icon: "settings" }
];

function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup" aria-label="Flixify Pro">
      <Image
        src="/logo/flixify-logo.png"
        alt="Flixify Pro"
        width={142}
        height={37}
        priority
        style={{ height: "36px", width: "auto", objectFit: "contain" }}
      />
    </Link>
  );
}

function PublicHeader({ pathname }: { pathname: string }) {
  const [userCode, setUserCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("flixify-public-session");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.kryptoniteCode) {
          setUserCode(parsed.kryptoniteCode);
        }
      }
    } catch {}
  }, [pathname]);

  const navItems = userCode
    ? [...publicNavigation, { href: "/ayarlar", label: "Hesabım" }]
    : publicNavigation;

  return (
    <header className="site-header public-header">
      <BrandLockup />
      <nav className="public-nav" aria-label="Public navigation">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link${pathname === item.href ? " is-active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        {userCode ? (
          <>
            <Link href="/ayarlar" className="ghost-link" title="Hesap ve Paket Durumu">
              Hesabım ({userCode.slice(-4)})
            </Link>
            <button
              type="button"
              className="button button-hero"
              style={{ padding: "8px 14px", fontSize: "13px", cursor: "pointer" }}
              onClick={() => {
                try {
                  window.localStorage.removeItem("flixify-public-session");
                } catch {}
                setUserCode(null);
                window.location.href = "/giris-yap";
              }}
            >
              Çıkış Yap
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

function AdminShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    const label = new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      weekday: "long"
    }).format(new Date());
    setTodayLabel(label);
  }, []);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Link href="/admin/dashboard" style={{ display: "flex", flexDirection: "column", gap: "6px", textDecoration: "none" }}>
            <Image
              src="/logo/flixify-logo.png"
              alt="Flixify Pro"
              width={160}
              height={42}
              priority
              style={{ height: "38px", width: "auto", objectFit: "contain", alignSelf: "flex-start" }}
            />
            <small style={{ color: "rgba(255, 255, 255, 0.45)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, paddingLeft: "2px" }}>Admin Panel</small>
          </Link>
        </div>

        <nav className="admin-sidebar-nav" aria-label="Admin navigation">
          {adminNavigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-sidebar-link${isActive ? " is-active" : ""}`}
              >
                <svg className="admin-nav-icon" width="20" height="20" aria-hidden="true" style={{ marginRight: 12, flexShrink: 0 }}>
                  <use href={`/icons/admin-icons.svg#${item.icon}`} />
                </svg>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Link href="/" target="_blank" rel="noopener noreferrer" className="admin-topbar-link" style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "0.95rem" }}>
              <svg width="18" height="18" aria-hidden="true" style={{ stroke: "currentColor" }}><use href="/icons/admin-icons.svg#tv" /></svg>
              <span>Siteyi Görüntüle ↗</span>
            </Link>
          </div>
          <div className="admin-topbar-actions">
            <span className="admin-date" suppressHydrationWarning style={{ fontSize: "0.9rem" }}>
              {todayLabel}
            </span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 12px", background: "rgba(255,255,255,0.06)", borderRadius: "999px", fontSize: "0.85rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00c781" }} />
              <span style={{ fontWeight: 600 }}>admin@flixify.vip</span>
            </div>
            <button
              className="button secondary admin-logout"
              type="button"
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}
              onClick={() => {
                clearAdminToken();
                router.push("/admin");
              }}
            >
              <svg width="16" height="16" aria-hidden="true" style={{ stroke: "currentColor" }}><use href="/icons/admin-icons.svg#logout" /></svg>
              <span>Çıkış</span>
            </button>
          </div>
        </header>

        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}

export default function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isAdminRoute = pathname.startsWith("/admin");
  const isAdminLoginRoute = pathname === "/admin";
  const isAuthRoute =
    pathname === "/kayit-ol" ||
    pathname === "/register" ||
    pathname === "/giris-yap" ||
    pathname === "/giris";

  if (isAdminRoute) {
    if (isAdminLoginRoute) {
      return (
        <div className="page-shell marketing-shell auth-shell admin-login-shell">
          {children}
        </div>
      );
    }

    return (
      <div className="page-shell admin-page-shell">
        <AdminShell pathname={pathname}>{children}</AdminShell>
      </div>
    );
  }

  if (isAuthRoute) {
    const isModernAuthPage = pathname === "/giris-yap" || pathname === "/kayit-ol";
    return (
      <div className={`page-shell auth-shell${isModernAuthPage ? " login-page-shell" : " marketing-shell"}`}>
        {!isModernAuthPage && (
          <div className="auth-brand">
            <BrandLockup />
          </div>
        )}
        {children}
      </div>
    );
  }

  const isCinematicShell =
    pathname === "/" ||
    pathname === "/indir" ||
    pathname === "/filmler" ||
    pathname === "/diziler" ||
    pathname === "/canli-tv";

  if (isCinematicShell) {
    return (
      <div className="homepage-shell">
        {children}
        <MobileTabBar />
      </div>
    );
  }

  return (
    <div className="page-shell marketing-shell">
      <PublicHeader pathname={pathname} />
      <div className="marketing-page">{children}</div>
    </div>
  );
}
