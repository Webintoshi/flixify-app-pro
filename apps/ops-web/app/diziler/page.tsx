"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "../catalog.module.css";

const seriesGenres = [
  "Tümü",
  "Drama",
  "Bilim Kurgu",
  "Suç & Polisiye",
  "Gerilim",
  "Tarih & Dönem",
  "Komedi",
  "Mini Dizi"
];

const seriesData = [
  {
    id: "breaking-bad",
    title: "Breaking Bad",
    genre: "Suç & Polisiye",
    seasons: "5 Sezon · 62 Bölüm",
    year: "2008 - 2013",
    rating: "9.5",
    quality: "4K UHD",
    image: "/images/home/category-series.jpg",
    description: "Kanser teşhisi konan bir kimya öğretmeninin, ailesinin geleceğini güvenceye almak için yeraltı uyuşturucu dünyasına adım atışı."
  },
  {
    id: "succession",
    title: "Succession",
    genre: "Drama",
    seasons: "4 Sezon · 39 Bölüm",
    year: "2018 - 2023",
    rating: "8.9",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "Dünyanın en büyük medya imparatorluklarından birini yöneten Roy ailesinin kontrol savaşı ve entrikaları."
  },
  {
    id: "the-last-of-us",
    title: "The Last of Us",
    genre: "Bilim Kurgu",
    seasons: "1 Sezon · 9 Bölüm",
    year: "2023 - Günümüz",
    rating: "8.8",
    quality: "4K UHD",
    image: "/images/downloads/downloads-hero-desktop.jpg",
    description: "Kıyamet sonrası bir dünyada hayatta kalan Joel, insanlığın tek kurtuluş umudu olan 14 yaşındaki Ellie'ye rehberlik eder."
  },
  {
    id: "dark",
    title: "Dark",
    genre: "Gerilim",
    seasons: "3 Sezon · 26 Bölüm",
    year: "2017 - 2020",
    rating: "8.7",
    quality: "4K UHD",
    image: "/images/home/category-movies.jpg",
    description: "Almanya'da kaybolan iki çocuğun ardından dört ailenin geçmişe dayanan gizemli bağlantıları ve zaman döngüsü açığa çıkar."
  },
  {
    id: "stranger-things",
    title: "Stranger Things",
    genre: "Bilim Kurgu",
    seasons: "4 Sezon · 34 Bölüm",
    year: "2016 - Günümüz",
    rating: "8.7",
    quality: "4K UHD",
    image: "/images/downloads/downloads-hero-mobile.jpg",
    description: "Küçük bir kasabada bir çocuğun kaybolmasıyla doğaüstü güçler, gizli hükümet deneyleri ve gizemli bir kız ortaya çıkar."
  },
  {
    id: "chernobyl",
    title: "Chernobyl",
    genre: "Mini Dizi",
    seasons: "1 Sezon · 5 Bölüm",
    year: "2019",
    rating: "9.4",
    quality: "4K UHD",
    image: "/images/home/category-series.jpg",
    description: "1986'daki Çernobil nükleer santral felaketinin gerçek hikayesi ve Avrupa'yı kurtarmak için hayatını feda eden kahramanlar."
  },
  {
    id: "house-of-the-dragon",
    title: "House of the Dragon",
    genre: "Drama",
    seasons: "2 Sezon · 18 Bölüm",
    year: "2022 - Günümüz",
    rating: "8.4",
    quality: "4K UHD",
    image: "/images/home/category-live-tv.jpg",
    description: "Game of Thrones olaylarından 200 yıl önce, Targaryen Hanesi'nin Demir Taht üzerindeki kanlı taht mücadelesi."
  },
  {
    id: "shogun",
    title: "Shōgun",
    genre: "Tarih & Dönem",
    seasons: "1 Sezon · 10 Bölüm",
    year: "2024",
    rating: "8.7",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "1600'lü yılların Japonya'sında, bir iç savaşın eşiğinde hayatta kalmaya çalışan Lord Toranaga ve gizemli bir İngiliz denizci."
  },
  {
    id: "true-detective",
    title: "True Detective",
    genre: "Suç & Polisiye",
    seasons: "4 Sezon · 30 Bölüm",
    year: "2014 - Günümüz",
    rating: "8.9",
    quality: "4K UHD",
    image: "/images/home/category-series.jpg",
    description: "Farklı dedektiflerin ve karmaşık cinayet vakalarının peşine düşen polislerin karanlık psikolojik yolculukları."
  },
  {
    id: "peaky-blinders",
    title: "Peaky Blinders",
    genre: "Tarih & Dönem",
    seasons: "6 Sezon · 36 Bölüm",
    year: "2013 - 2022",
    rating: "8.8",
    quality: "Full HD",
    image: "/images/downloads/downloads-hero-desktop.jpg",
    description: "1. Dünya Savaşı sonrasında Birmingham sokaklarını kasıp kavuran Thomas Shelby liderliğindeki Shelby suç ailesi."
  },
  {
    id: "the-bear",
    title: "The Bear",
    genre: "Komedi",
    seasons: "3 Sezon · 28 Bölüm",
    year: "2022 - Günümüz",
    rating: "8.6",
    quality: "4K UHD",
    image: "/images/home/category-movies.jpg",
    description: "Seçkin bir şefin, ailesinin sandviç dükkanını devralıp mutfakta düzen ve mükemmeliyet arayışına girişmesi."
  },
  {
    id: "game-of-thrones",
    title: "Game of Thrones",
    genre: "Drama",
    seasons: "8 Sezon · 73 Bölüm",
    year: "2011 - 2019",
    rating: "9.2",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "Westeros'un Yedi Krallığı'nı kontrol etmek için soylu hanedanlar arasında verilen destansı Demir Taht mücadelesi."
  }
];

export default function SeriesPage() {
  const [userCode, setUserCode] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>("Tümü");
  const [searchQuery, setSearchQuery] = useState<string>("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("flixify-public-session");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.kryptoniteCode) {
          setUserCode(parsed.kryptoniteCode);
        }
      }
    } catch {}
  }, []);

  function handleLogout() {
    try {
      window.localStorage.removeItem("flixify-public-session");
    } catch {}
    setUserCode(null);
    window.location.href = "/giris-yap";
  }

  const filteredSeries = useMemo(() => {
    return seriesData.filter((series) => {
      const matchesGenre =
        selectedGenre === "Tümü" || series.genre.toLowerCase().includes(selectedGenre.toLowerCase());
      const matchesQuery =
        searchQuery.trim() === "" ||
        series.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        series.genre.toLowerCase().includes(searchQuery.toLowerCase()) ||
        series.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesGenre && matchesQuery;
    });
  }, [selectedGenre, searchQuery]);

  return (
    <div className={styles.flixifyCatalog}>
      {/* 1. Header with Diziler active */}
      <HomeHeader activeRoute="/diziler" userCode={userCode} onLogout={handleLogout} />

      <main>
        {/* 2. Hero Section */}
        <section className={styles.heroSection}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div className={styles.heroContent}>
                <span className={styles.kicker}>POPÜLER DİZİLER & SEZONLAR</span>
                <h1 className={styles.heroTitle}>
                  Sürükleyici Diziler,<br />
                  Eksiksiz Sezonlar.
                </h1>
                <p className={styles.heroDescription}>
                  Dünyaca ünlü diziler, kült seriler ve yeni sezonlar tek bir arayüzde.
                  Bölüm bölüm düzenlenmiş arşivle favori hikâyelerinize anında ulaşın.
                </p>

                <div className={styles.heroPillsRow} aria-label="Dizi Özellikleri">
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">★</span>
                    <span>Tüm Sezonlar & Bölümler</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">✓</span>
                    <span>Full HD & 4K</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">❖</span>
                    <span>Bölüm Takibi</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">▶</span>
                    <span>Çapraz Cihaz</span>
                  </span>
                </div>
              </div>

              <div className={styles.heroVisualWrapper}>
                <Image
                  src="/images/home/category-series.jpg"
                  alt="Flixify Dizi Kataloğu"
                  fill
                  priority
                  className={styles.heroImage}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Toolbar (Search + Genre Tabs) */}
        <div className={styles.toolbarSection}>
          <div className={styles.container}>
            <div className={styles.toolbarInner}>
              <div className={styles.tabsScroll} role="tablist" aria-label="Dizi Türleri">
                {seriesGenres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    role="tab"
                    aria-selected={selectedGenre === genre}
                    className={`${styles.tabBtn} ${selectedGenre === genre ? styles.tabBtnActive : ""}`}
                    onClick={() => setSelectedGenre(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>

              <div className={styles.searchBox}>
                <span className={styles.searchIcon} aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Dizi veya tür ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                  aria-label="Dizi ara"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 4. Dizi Vitrini (Grid) */}
        <section className={styles.catalogSection}>
          <div className={styles.container}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeadingTitle}>
                {selectedGenre === "Tümü" ? "Öne Çıkan Diziler" : `${selectedGenre} Dizileri`}
              </h2>
              <span className={styles.sectionCount}>
                {filteredSeries.length} içerik listeleniyor
              </span>
            </div>

            {filteredSeries.length > 0 ? (
              <div className={styles.posterGrid}>
                {filteredSeries.map((series) => (
                  <article key={series.id} className={styles.posterCard}>
                    <div className={styles.posterImageWrapper}>
                      <Image
                        src={series.image}
                        alt={series.title}
                        fill
                        sizes="(max-width: 680px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className={styles.posterImage}
                      />
                      <div className={styles.posterOverlay} />

                      <div className={styles.badgeRow}>
                        <span className={styles.qualityBadge}>{series.quality}</span>
                        <span className={styles.ratingBadge}>★ {series.rating}</span>
                      </div>
                    </div>

                    <div className={styles.posterContent}>
                      <span className={styles.posterTag}>{series.genre}</span>
                      <h3 className={styles.posterTitle}>{series.title}</h3>
                      <div className={styles.posterMeta}>
                        <span>{series.seasons}</span>
                        <span>•</span>
                        <span>{series.year}</span>
                      </div>
                      <p className={styles.posterDesc}>{series.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p>"{searchQuery}" aramasına uygun dizi bulunamadı.</p>
              </div>
            )}
          </div>
        </section>

        {/* 5. Dizi Özellikleri Bandı */}
        <section className={styles.featuresSection}>
          <div className={styles.container}>
            <div className={styles.featuresGrid}>
              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Düzenli Bölüm Mimarisi</h3>
                <p className={styles.featureText}>
                  Sezonlar ve bölümler düzenli listelenir; hangi bölümde kaldığınızı
                  kaybetmeden kesintisiz izleyebilirsiniz.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Yeni Bölüm Takibi</h3>
                <p className={styles.featureText}>
                  Takip ettiğiniz dizilerin yeni bölümleri kütüphaneye eklendiğinde
                  anında listenizin en üstünde görünür.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Tüm Ekranlarda Eşzamanlı</h3>
                <p className={styles.featureText}>
                  Evde televizyonda başladığınız dizi bölümüne dışarıda telefon veya
                  tabletten kaldığınız dakikadan devam edin.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Alt CTA Bandı */}
        <section className={styles.ctaSection}>
          <div className={styles.container}>
            <div className={styles.ctaCard}>
              <div className={styles.ctaContent}>
                <span className={styles.ctaKicker}>DİZİ MARATONU</span>
                <h2 className={styles.ctaTitle}>Flixify ile Dizi Maratonuna Başlayın.</h2>
                <p className={styles.ctaText}>
                  Kült diziler, ödüllü yapımlar ve yeni sezonlar tek bir yerde.
                  Hemen hesabınızı oluşturun ve izlemeye başlayın.
                </p>
              </div>

              <div className={styles.ctaActions}>
                <Link href="/kayit-ol" className={styles.ctaPrimaryBtn}>
                  Hesap Oluştur
                </Link>
                <span className={styles.ctaSubtext}>
                  Zaten üye misiniz?{" "}
                  <Link href="/giris-yap" className={styles.ctaSublink}>
                    Giriş Yap
                  </Link>
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 7. Footer */}
      <HomeFooter />
    </div>
  );
}
