import styles from "../../home.module.css";

const values = [
  {
    title: "Canlı TV",
    text: "Haber, spor ve farklı türde yayınlar.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    )
  },
  {
    title: "Film ve Dizi",
    text: "Farklı hikâyeleri tek yerde keşfet.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </svg>
    )
  },
  {
    title: "Kolay Keşif",
    text: "Kategoriler arasında rahatça gezin.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    )
  },
  {
    title: "Sade Deneyim",
    text: "İçeriğe odaklanan düzenli arayüz.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    )
  }
];

export default function HomeValueStrip() {
  return (
    <section className={styles.valueStripSection}>
      <div className={styles.container}>
        <div className={styles.valueStripGrid}>
          {values.map((item) => (
            <article key={item.title} className={styles.valueCard}>
              <div className={styles.valueCardIcon} aria-hidden="true">
                {item.icon}
              </div>
              <div className={styles.valueCardContent}>
                <h3 className={styles.valueCardTitle}>{item.title}</h3>
                <p className={styles.valueCardText}>{item.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
