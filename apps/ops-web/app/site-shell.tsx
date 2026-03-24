"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearAdminToken } from "../lib/api";

const publicNavigation = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/filmler", label: "Filmler" },
  { href: "/diziler", label: "Diziler" },
  { href: "/canli-tv", label: "Canli TV" }
];

const adminNavigation = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/kullanicilar", label: "Kullanıcılar" },
  { href: "/admin/paketler", label: "Paketler" },
  { href: "/admin/odeme-yontemleri", label: "Odeme Yontemleri" },
  { href: "/admin/ayarlar", label: "Ayarlar" }
];

function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <Image src="/logo/flixify-icon-only.svg" alt="" width={42} height={42} className="brand-mark-image" />
      </span>
      <span className="brand-word">FLIXIFY</span>
      <span className="brand-badge">PRO</span>
    </Link>
  );
}

function PublicHeader({ pathname }: { pathname: string }) {
  return (
    <header className="site-header public-header">
      <BrandLockup />
      <nav className="public-nav" aria-label="Public navigation">
        {publicNavigation.map((item) => (
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
        <Link href="/giris-yap" className="ghost-link">
          Giris Yap
        </Link>
        <Link href="/kayit-ol" className="button button-hero">
          Hesap Olustur
        </Link>
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
          <span className="admin-brand-icon" aria-hidden="true">
            <Image
              src="/logo/flixify-icon-only.svg"
              alt=""
              width={48}
              height={48}
              className="admin-brand-icon-image"
            />
          </span>
          <div>
            <strong>Admin Panel</strong>
          </div>
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
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <Link href="/" className="admin-topbar-link">
            Siteyi Görüntüle
          </Link>
          <div className="admin-topbar-actions">
            <span className="admin-date" suppressHydrationWarning>
              {todayLabel}
            </span>
            <button
              className="button secondary admin-logout"
              type="button"
              onClick={() => {
                clearAdminToken();
                router.push("/admin");
              }}
            >
              Çıkış
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

  return (
    <div className="page-shell marketing-shell">
      <PublicHeader pathname={pathname} />
      <div className="marketing-page">{children}</div>
    </div>
  );
}
