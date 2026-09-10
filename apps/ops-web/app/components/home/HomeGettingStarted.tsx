import styles from "../../home.module.css";

const steps = [
  {
    step: "1",
    title: "Hesap Oluştur",
    text: "Saniyeler içinde kaydını tamamla.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  },
  {
    step: "2",
    title: "Paketini Seç",
    text: "İhtiyacına uygun paketi belirle.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    )
  },
  {
    step: "3",
    title: "Giriş Yap",
    text: "Uygulamadan hesabına oturum aç.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
    )
  },
  {
    step: "4",
    title: "İzlemeye Başla",
    text: "Sınırsız içeriğin keyfini çıkar.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    )
  }
];

export default function HomeGettingStarted() {
  return (
    <section id="nasil-baslanir" className={styles.stepsSection}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>NASIL BAŞLARSIN?</span>
          <h2 className={styles.sectionTitle}>
            4 Adımda Kolay Kurulum.
          </h2>
          <p className={styles.sectionDescription}>
            Dakikalar içinde hesabını oluştur ve eğlenceye hemen katıl.
          </p>
        </div>

        <div className={styles.stepsGrid}>
          {steps.map((item) => (
            <article key={item.step} className={styles.stepCard}>
              <span className={styles.stepNumber} aria-label={`Adım ${item.step}`}>
                {item.step}
              </span>
              <div className={styles.stepIcon} aria-hidden="true">
                {item.icon}
              </div>
              <h3 className={styles.stepTitle}>{item.title}</h3>
              <p className={styles.stepText}>{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
