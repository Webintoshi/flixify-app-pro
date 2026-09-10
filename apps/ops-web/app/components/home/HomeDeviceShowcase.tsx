import Image from "next/image";
import styles from "../../home.module.css";

const platforms = [
  {
    name: "Windows",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    )
  },
  {
    name: "Android",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4111 13.8533 8.0837 12 8.0837s-3.5902.3274-5.1368.866L4.8409 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
      </svg>
    )
  },
  {
    name: "iOS",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.88c.64-.78 1.08-1.86.96-2.88-.93.04-2.05.62-2.71 1.4-.58.67-1.09 1.77-.95 2.81 1.04.08 2.08-.55 2.7-1.33z" />
      </svg>
    )
  },
  {
    name: "macOS",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    )
  },
  {
    name: "Android TV",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    )
  }
];

export default function HomeDeviceShowcase() {
  return (
    <section className={styles.showcaseSection}>
      <div className={styles.container}>
        <div className={styles.showcaseCard}>
          <div className={styles.showcaseInner}>
            <div className={styles.showcaseContent}>
              <span className={styles.showcaseKicker}>HER EKRANDA</span>
              <h2 className={styles.showcaseTitle}>
                Tüm Cihazlarda Aynı Kalite.
              </h2>
              <p className={styles.showcaseText}>
                Windows, Android, iOS, macOS ve Smart TV uyumlu kesintisiz izleme deneyimi.
              </p>

              <div className={styles.platformsBlock}>
                <span className={styles.platformsLabel}>Hedef platformlar</span>
                <div className={styles.platformsList}>
                  {platforms.map((item) => (
                    <span key={item.name} className={styles.platformItem}>
                      {item.icon}
                      <span>{item.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.showcaseVisual}>
              <Image
                src="/images/home/experience-cinema.jpg"
                alt="Flixify Ev Sineması Deneyimi"
                width={800}
                height={500}
                className={styles.showcaseImage}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
