import styles from "../../downloads.module.css";

const devices = [
  {
    name: "Windows",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  },
  {
    name: "Android",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    )
  },
  {
    name: "iOS",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="3" ry="3" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    )
  },
  {
    name: "macOS",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="12" rx="2" ry="2" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    )
  },
  {
    name: "Android TV",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="2" ry="2" />
        <polyline points="17 2 12 6 7 2" />
      </svg>
    )
  }
];

export default function DeviceBand() {
  return (
    <section className={styles.deviceBandSection}>
      <div className={styles.container}>
        <div className={styles.deviceBandCard}>
          <div className={styles.deviceBandInner}>
            <div className={styles.deviceBandContent}>
              <span className={styles.deviceBandKicker}>HESABIN VE CİHAZLARIN</span>
              <h2 className={styles.deviceBandTitle}>Farklı Ekranlarda Flixify Deneyimi</h2>
              <p className={styles.deviceBandText}>
                Kullanılabilir uygulamaya hesabınla giriş yap. Cihaz ve eşzamanlı
                izleme koşulları, hesabına tanımlanan kurallara göre değişebilir.
              </p>
              <span className={styles.deviceBandNote}>
                * Platformlara göre kullanılabilir sürümler değişiklik gösterebilir.
              </span>
            </div>

            <div className={styles.deviceIconsChain} aria-label="Desteklenen Cihazlar">
              {devices.map((dev, idx) => (
                <div key={dev.name} style={{ display: "contents" }}>
                  <div className={styles.deviceChainItem}>
                    <div className={styles.deviceIconCircle} aria-hidden="true">
                      {dev.icon}
                    </div>
                    <span className={styles.deviceChainLabel}>{dev.name}</span>
                  </div>
                  {idx < devices.length - 1 && (
                    <div className={styles.deviceChainConnector} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
