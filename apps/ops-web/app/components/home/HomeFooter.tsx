import Image from "next/image";
import Link from "next/link";
import styles from "../../home.module.css";

export default function HomeFooter() {
  const currentYear = 2026;

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Link href="/" className={styles.brandLockup} aria-label="Flixify Pro Ana Sayfa">
              <Image
                src="/logo/flixify-logo.png"
                alt="Flixify Pro"
                width={134}
                height={35}
                className={styles.brandLogoImage}
              />
            </Link>
            <p className={styles.footerSlogan}>Sınır Yok. Sadece Eğlence.</p>
          </div>

          <nav className={styles.footerNav} aria-label="Footer Navigasyonu">
            <Link href="/" className={styles.footerLink}>
              Ana Sayfa
            </Link>
            <Link href="/filmler" className={styles.footerLink}>
              Filmler
            </Link>
            <Link href="/diziler" className={styles.footerLink}>
              Diziler
            </Link>
            <Link href="/canli-tv" className={styles.footerLink}>
              Canlı TV
            </Link>
          </nav>
        </div>

        <div className={styles.footerBottom}>
          <span>© {currentYear} Flixify Pro. Tüm hakları saklıdır.</span>
          <span style={{ color: "rgba(255, 255, 255, 0.4)", fontSize: "0.8rem" }}>
            Film, dizi ve canlı yayın deneyimi.
          </span>
        </div>
      </div>
    </footer>
  );
}
