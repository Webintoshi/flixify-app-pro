import Image from "next/image";
import styles from "../../downloads.module.css";

const pills = [
  {
    label: "Kolay Kurulum",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    )
  },
  {
    label: "Sürüm Bilgisi",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    )
  },
  {
    label: "Kurulum Rehberi",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  },
  {
    label: "Farklı Ekranlar",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  }
];

export default function DownloadsHero() {
  return (
    <section className={styles.heroSection}>
      <div className={styles.container}>
        <div className={styles.heroGrid}>
          <div className={styles.heroContent}>
            <span className={styles.kicker}>
              FLIXIFY UYGULAMALARI
            </span>

            <h1 className={styles.heroTitle}>
              Her Ekranda,<br />
              Aynı Eğlence.
            </h1>

            <p className={styles.heroDescription}>
              Flixify deneyimi için cihazına uygun uygulamayı keşfet.
              Windows, Android, iOS, macOS ve Android TV için sürüm durumlarını
              ve kullanılabilir indirme seçeneklerini bu sayfadan takip et.
            </p>

            <div className={styles.heroPillsRow} aria-label="Temel Bilgiler">
              {pills.map((pill) => (
                <span key={pill.label} className={styles.heroPill}>
                  <span className={styles.heroPillIcon} aria-hidden="true">
                    {pill.icon}
                  </span>
                  <span>{pill.label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className={styles.heroVisualWrapper}>
            <span className={styles.decorativeHeroBadge} aria-hidden="true">
              Sınır Yok. Sadece Eğlence.
            </span>
            <picture>
              <source media="(max-width: 768px)" srcSet="/images/downloads/downloads-hero-mobile.jpg" />
              <Image
                src="/images/downloads/downloads-hero-desktop.jpg"
                alt="Flixify Uygulamaları Çoklu Cihaz Ekranı"
                width={1000}
                height={560}
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
