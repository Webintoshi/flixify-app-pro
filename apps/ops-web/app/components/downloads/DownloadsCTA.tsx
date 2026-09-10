import Image from "next/image";
import Link from "next/link";
import styles from "../../downloads.module.css";

export default function DownloadsCTA() {
  return (
    <section className={styles.ctaBannerSection}>
      <div className={styles.container}>
        <div className={styles.ctaBannerCard}>
          <Image
            src="/images/downloads/downloads-cta-banner.jpg"
            alt="Flixify Sinematik Ev Sineması Salonu"
            fill
            sizes="(max-width: 1360px) 100vw, 1360px"
            className={styles.ctaBannerImage}
          />
          <div className={styles.ctaBannerOverlay} />

          <div className={styles.ctaBannerInner}>
            <div className={styles.ctaBannerContent}>
              <span className={styles.ctaBannerKicker}>EĞLENCE HER YERDE</span>
              <h2 className={styles.ctaBannerTitle}>Flixify Seninle, Her Ekranda.</h2>
              <p className={styles.ctaBannerText}>
                Flixify deneyimine katıl, sana uygun uygulama seçeneklerini keşfet.
              </p>
            </div>

            <div className={styles.ctaBannerActions}>
              <Link href="/kayit-ol" className={styles.ctaBannerBtn}>
                Hesap Oluştur
              </Link>
              <span className={styles.ctaBannerSubtext}>
                Bir hesabın var mı?{" "}
                <Link href="/giris-yap" className={styles.ctaBannerSublink}>
                  Giriş Yap
                </Link>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
