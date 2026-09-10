import styles from "../../downloads.module.css";

const steps = [
  {
    step: "1",
    title: "Uygulamayı İndir",
    text: "Cihazına uygun sürümü seç ve indir.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    )
  },
  {
    step: "2",
    title: "Kurulumu Tamamla",
    text: "Birkaç tıkla hızlıca kurulumu yap.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  },
  {
    step: "3",
    title: "Giriş Yap ve İzle",
    text: "Hesabınla anında yayına başla.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    )
  }
];

export default function InstallSteps() {
  return (
    <section id="kurulum" className={styles.installSection}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>NASIL KURULUR?</span>
          <h2 className={styles.sectionTitle}>3 Adımda Hazırsın</h2>
          <p className={styles.sectionDescription}>
            Uygulamayı indir, kurulumu yap ve anında izlemeye başla.
          </p>
        </div>

        <div className={styles.installGrid}>
          {steps.map((item) => (
            <article key={item.step} className={styles.installCard}>
              <span className={styles.stepNumberCircle} aria-label={`Adım ${item.step}`}>
                {item.step}
              </span>
              <div className={styles.installIconBox} aria-hidden="true">
                {item.icon}
              </div>
              <h3 className={styles.installStepTitle}>{item.title}</h3>
              <p className={styles.installStepText}>{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
