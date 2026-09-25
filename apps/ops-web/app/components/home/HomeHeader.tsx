"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "../../home.module.css";

type HomeHeaderProps = {
  userCode?: string | null;
  onLogout?: () => void;
  activeRoute?: string;
};

export default function HomeHeader({ userCode, onLogout, activeRoute = "/" }: HomeHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
      }
    }
    if (drawerOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className={`${styles.headerWrapper} ${scrolled ? styles.headerWrapperScrolled : ""}`}>
      <header className={styles.header}>
        <Link href="/" className={styles.brandLockup} aria-label="Flixify Pro Ana Sayfa">
          <Image
            src="/logo/flixify-logo.png"
            alt="Flixify Pro"
            width={142}
            height={37}
            priority
            className={styles.brandLogoImage}
          />
        </Link>

        <nav className={styles.nav} aria-label="Ana Menü">
          <Link href="/" className={`${styles.navLink} ${activeRoute === "/" ? styles.navLinkActive : ""}`}>
            Ana Sayfa
          </Link>
          <Link href="/filmler" className={`${styles.navLink} ${activeRoute === "/filmler" ? styles.navLinkActive : ""}`}>
            Filmler
          </Link>
          <Link href="/diziler" className={`${styles.navLink} ${activeRoute === "/diziler" ? styles.navLinkActive : ""}`}>
            Diziler
          </Link>
          <Link href="/canli-tv" className={`${styles.navLink} ${activeRoute === "/canli-tv" ? styles.navLinkActive : ""}`}>
            Canlı TV
          </Link>
          {!userCode && <Link href="/kayit-ol" className={styles.navLink}>Kayıt Ol</Link>}
        </nav>

        <div className={styles.headerActions}>
          {userCode ? (
            <>
              <Link href="/ayarlar" className={styles.loginLink} title="Hesap Detayları">
                Hesabım ({userCode.slice(-4)})
              </Link>
              <button
                type="button"
                className={styles.registerButton}
                onClick={onLogout}
                style={{ padding: "0 16px", height: "40px", fontSize: "0.88rem" }}
              >
                Çıkış Yap
              </button>
            </>
          ) : (
            <>
              <Link href="/giris-yap" className={styles.loginLink}>Giriş Yap</Link>
              <Link href="/kayit-ol" className={styles.registerButton}>Kayıt Ol</Link>
            </>
          )}
        </div>

        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setDrawerOpen(true)}
          aria-label="Menüyü Aç"
          ref={menuButtonRef}
          aria-expanded={drawerOpen}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* Mobile Drawer */}
      <div
        className={`${styles.mobileDrawer} ${drawerOpen ? styles.mobileDrawerOpen : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div className={styles.mobileDrawerHeader}>
          <Link href="/" className={styles.brandLockup} onClick={() => setDrawerOpen(false)} aria-label="Flixify Pro Ana Sayfa">
            <Image
              src="/logo/flixify-logo.png"
              alt="Flixify Pro"
              width={126}
              height={33}
              priority
              className={styles.brandLogoImage}
            />
          </Link>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setDrawerOpen(false)}
            aria-label="Menüyü Kapat"
            style={{ display: "inline-flex" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className={styles.mobileDrawerNav} aria-label="Mobil ana menü">
          <Link href="/" className={styles.mobileNavLink} onClick={() => setDrawerOpen(false)}>
            Ana Sayfa
          </Link>
          <Link href="/filmler" className={styles.mobileNavLink} onClick={() => setDrawerOpen(false)}>
            Filmler
          </Link>
          <Link href="/diziler" className={styles.mobileNavLink} onClick={() => setDrawerOpen(false)}>
            Diziler
          </Link>
          <Link href="/canli-tv" className={styles.mobileNavLink} onClick={() => setDrawerOpen(false)}>
            Canlı TV
          </Link>
          {!userCode && <Link href="/kayit-ol" className={styles.mobileNavLink} onClick={() => setDrawerOpen(false)}>Kayıt Ol</Link>}
        </nav>

        <div className={styles.mobileDrawerActions}>
          {userCode ? (
            <>
              <Link
                href="/ayarlar"
                className={styles.registerButton}
                onClick={() => setDrawerOpen(false)}
                style={{ textAlign: "center" }}
              >
                Hesabım ({userCode.slice(-4)})
              </Link>
              <button
                type="button"
                className={styles.secondaryHeroBtn}
                onClick={() => {
                  setDrawerOpen(false);
                  onLogout?.();
                }}
                style={{ justifyContent: "center" }}
              >
                Çıkış Yap
              </button>
            </>
          ) : (
            <>
              <Link href="/kayit-ol" className={styles.registerButton} onClick={() => setDrawerOpen(false)}>Kayıt Ol</Link>
              <Link href="/giris-yap" className={styles.loginLink} onClick={() => setDrawerOpen(false)}>Giriş Yap</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
