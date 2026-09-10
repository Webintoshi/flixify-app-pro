import Image from "next/image";
import Link from "next/link";
import styles from "../../home.module.css";

const categories = [
  {
    tag: "Filmler",
    title: "Sinema Kataloğu",
    text: "Farklı türlerde hikâyeleri düzenli bir katalogda keşfet.",
    linkText: "Filmleri Keşfet",
    href: "/filmler",
    image: "/images/home/category-movies.jpg",
    alt: "Flixify Film Deneyimi"
  },
  {
    tag: "Diziler",
    title: "Sezonlar & Bölümler",
    text: "Sezonları ve bölümleri bir arada gör, izlemek istediğin hikâyeye kolayca ulaş.",
    linkText: "Dizileri Keşfet",
    href: "/diziler",
    image: "/images/home/category-series.jpg",
    alt: "Flixify Dizi Deneyimi"
  },
  {
    tag: "Canlı TV",
    title: "Canlı Yayın Akışı",
    text: "Haber, spor, yaşam ve farklı türde canlı yayınları keşfet.",
    linkText: "Canlı TV’yi Keşfet",
    href: "/canli-tv",
    image: "/images/home/category-live-tv.jpg",
    alt: "Flixify Canlı TV Deneyimi"
  }
];

export default function HomeAbout() {
  return (
    <section id="flixify-nedir" className={styles.aboutSection}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>FLIXIFY NEDİR?</span>
          <h2 className={styles.sectionTitle}>
            Tüm Eğlence, Tek Platformda.
          </h2>
          <p className={styles.sectionDescription}>
            Film, dizi ve canlı yayınlar tek ekranda. Yüksek kalite, kesintisiz izleme deneyimi.
          </p>
        </div>

        <div className={styles.experienceGrid}>
          {categories.map((item) => (
            <Link key={item.tag} href={item.href} className={styles.experienceCard}>
              <Image
                src={item.image}
                alt={item.alt}
                fill
                sizes="(max-width: 960px) 100vw, 33vw"
                className={styles.experienceCardImage}
              />
              <div className={styles.experienceCardOverlay} />
              <div className={styles.experienceCardContent}>
                <span className={styles.experienceCardTag}>{item.tag}</span>
                <h3 className={styles.experienceCardTitle}>{item.title}</h3>
                <p className={styles.experienceCardText}>{item.text}</p>
                <span className={styles.experienceCardLink}>
                  {item.linkText} →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
