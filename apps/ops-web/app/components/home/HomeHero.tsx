import Image from "next/image";
import Link from "next/link";
import styles from "../../home.module.css";

export default function HomeHero() {
  return (
    <section className={styles.heroSection}>
      <div className={styles.container}>
        <div className={styles.heroGrid}>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>
              Sınırsız Eğlence,<br />
              Tek Bir Deneyimde.
            </h1>

            <p className={styles.heroDescription}>
              Film, dizi ve canlı TV yayınları tek platformda. Yüksek kalite ve kesintisiz izleme deneyimi.
            </p>

            <div className={styles.heroActions}>
              <Link href="/kayit-ol" className={styles.primaryHeroBtn}>
                Hesap Oluştur
              </Link>
              <Link href="#nasil-baslanir" className={styles.secondaryHeroBtn}>
                <span className={styles.playCircle} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                </span>
                <span>Nasıl Çalışır?</span>
              </Link>
            </div>
          </div>

          <div className={styles.heroVisualWrapper}>
            <span className={styles.decorativeHeroBadge} aria-hidden="true">
              HER YERDE / HER ZAMAN / FLIXIFY
            </span>
            <picture>
              <source media="(max-width: 768px)" srcSet="/images/home/hero-cinema-mobile.jpg" />
              <Image
                src="/images/home/hero-cinema-desktop.jpg"
                alt="Flixify Sinematik Cihaz Deneyimi"
                width={1100}
                height={620}
                priority
                className={styles.heroImage}
              />
            </picture>
          </div>
        </div>
      </div>
    </section>
  );
}
