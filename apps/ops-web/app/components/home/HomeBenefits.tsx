import styles from "../../home.module.css";

const benefits = [
  {
    title: "Geniş Arşiv",
    text: "Film, dizi ve yüzlerce canlı TV kanalı tek ekranda.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    )
  },
  {
    title: "Sade Arayüz",
    text: "Aradığın içeriğe saniyeler içinde kolayca ulaş.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    )
  },
  {
    title: "Tüm Cihazlar",
    text: "Televizyon, bilgisayar, tablet ve telefonda hazır.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  },
  {
    title: "Sinematik Keyif",
    text: "Karanlık mod ve yüksek çözünürlüklü akıcı yayınlar.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 2 2 9 12 22 22 9 12 2" />
      </svg>
    )
  }
];

export default function HomeBenefits() {
  return (
    <section id="ozellikler" className={styles.benefitsSection}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>NEDEN FLIXIFY?</span>
          <h2 className={styles.sectionTitle}>
            Özgür ve Kesintisiz Eğlence.
          </h2>
          <p className={styles.sectionDescription}>
            Tek platformda film, dizi ve canlı TV. Sade, hızlı ve modern izleme deneyimi.
          </p>
        </div>

        <div className={styles.benefitsGrid}>
          {benefits.map((item) => (
            <article key={item.title} className={styles.benefitCard}>
              <div className={styles.benefitCardIcon} aria-hidden="true">
                {item.icon}
              </div>
              <h3 className={styles.benefitCardTitle}>{item.title}</h3>
              <p className={styles.benefitCardText}>{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
