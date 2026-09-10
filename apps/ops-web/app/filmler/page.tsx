"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "../catalog.module.css";

const movieGenres = [
  "Tümü",
  "Aksiyon",
  "Bilim Kurgu",
  "Dram",
  "Gerilim",
  "Komedi",
  "Animasyon",
  "Korku"
];

const moviesData = [
  {
    id: "dune-2",
    title: "Dune: Part Two",
    genre: "Bilim Kurgu",
    year: "2024",
    duration: "166 dk",
    rating: "8.6",
    quality: "4K UHD",
    image: "/images/home/category-movies.jpg",
    description: "Paul Atreides, Chani ve Fremenlerle birleşerek ailesini yok eden komploculara karşı intikam savaşına girer."
  },
  {
    id: "oppenheimer",
    title: "Oppenheimer",
    genre: "Dram",
    year: "2023",
    duration: "180 dk",
    rating: "8.9",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "Amerikalı bilim insanı J. Robert Oppenheimer'ın atom bombasının geliştirilmesindeki rolü ve tarihin akışını değiştiren serüveni."
  },
  {
    id: "blade-runner-2049",
    title: "Blade Runner 2049",
    genre: "Bilim Kurgu",
    year: "2017",
    duration: "164 dk",
    rating: "8.0",
    quality: "4K UHD",
    image: "/images/downloads/downloads-hero-desktop.jpg",
    description: "Los Angeles polis memuru K, toplumdan geriye kalanı kaosa sürükleme potansiyeline sahip uzun süredir gömülü bir sırrı keşfeder."
  },
  {
    id: "the-batman",
    title: "The Batman",
    genre: "Aksiyon",
    year: "2022",
    duration: "176 dk",
    rating: "7.8",
    quality: "4K UHD",
    image: "/images/home/category-series.jpg",
    description: "Gotham City'deki yozlaşmış elitleri hedef alan sadist bir seri katil, Batman'i yeraltı dünyasına uzanan bir soruşturmaya iter."
  },
  {
    id: "interstellar",
    title: "Interstellar",
    genre: "Bilim Kurgu",
    year: "2014",
    duration: "169 dk",
    rating: "8.7",
    quality: "4K UHD",
    image: "/images/home/category-movies.jpg",
    description: "İnsanlığın Dünya'daki zamanı sona ererken, bir grup kaşif insanlığın geleceğini kurtarmak için yıldızlararası bir yolculuğa çıkar."
  },
  {
    id: "inception",
    title: "Inception",
    genre: "Gerilim",
    year: "2010",
    duration: "148 dk",
    rating: "8.8",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "Rüya paylaşım teknolojisi kullanarak kurumsal sırları çalan yetenekli bir hırsıza, bir CEO'nun zihnine fikir ekleme görevi verilir."
  },
  {
    id: "gladiator-2",
    title: "Gladiator II",
    genre: "Aksiyon",
    year: "2024",
    duration: "148 dk",
    rating: "7.9",
    quality: "4K UHD",
    image: "/images/home/category-live-tv.jpg",
    description: "Lucilla'nın oğlu Lucius, Kolezyum'a girerek Roma'nın ihtişamını halkına geri kazandırmak için geçmişine güç arar."
  },
  {
    id: "spider-verse",
    title: "Across the Spider-Verse",
    genre: "Animasyon",
    year: "2023",
    duration: "140 dk",
    rating: "8.6",
    quality: "4K UHD",
    image: "/images/home/category-movies.jpg",
    description: "Miles Morales, çoklu evrende diğer Örümcek Kahramanlarla tanışır ve varoluşu korumak için yeni bir tehditle yüzleşir."
  },
  {
    id: "parasite",
    title: "Parasite",
    genre: "Gerilim",
    year: "2019",
    duration: "132 dk",
    rating: "8.5",
    quality: "4K UHD",
    image: "/images/home/hero-cinema-desktop.jpg",
    description: "Yoksul Kim ailesi, zengin Park ailesinin evinde çalışan olarak sırayla işe girer ve beklenmedik olaylar zinciri başlar."
  },
  {
    id: "top-gun-maverick",
    title: "Top Gun: Maverick",
    genre: "Aksiyon",
    year: "2022",
    duration: "130 dk",
    rating: "8.3",
    quality: "4K UHD",
    image: "/images/downloads/downloads-hero-desktop.jpg",
    description: "Otuz yılı aşkın hizmetten sonra Maverick, zorlu bir görev için genç Top Gun mezunlarını eğitmekle görevlendirilir."
  },
  {
    id: "john-wick-4",
    title: "John Wick: Chapter 4",
    genre: "Aksiyon",
    year: "2023",
    duration: "169 dk",
    rating: "7.7",
    quality: "4K UHD",
    image: "/images/home/category-series.jpg",
    description: "John Wick, High Table'ı alt etmenin yolunu bulur ancak özgürlüğünü kazanmadan önce güçlü ittifaklara karşı savaşmalıdır."
  },
  {
    id: "grand-budapest",
    title: "The Grand Budapest Hotel",
    genre: "Komedi",
    year: "2014",
    duration: "99 dk",
    rating: "8.1",
    quality: "Full HD",
    image: "/images/home/category-movies.jpg",
    description: "Ünlü bir Avrupa otelinin efsanevi konsiyerjı ile otelde komi olan güvenilir dostunun eğlenceli ve sıra dışı maceraları."
  }
];

export default function MoviesPage() {
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

  const filteredMovies = useMemo(() => {
    return moviesData.filter((movie) => {
      const matchesGenre =
        selectedGenre === "Tümü" || movie.genre.toLowerCase().includes(selectedGenre.toLowerCase());
      const matchesQuery =
        searchQuery.trim() === "" ||
        movie.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movie.genre.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movie.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesGenre && matchesQuery;
    });
  }, [selectedGenre, searchQuery]);

  return (
    <div className={styles.flixifyCatalog}>
      {/* 1. Header with Filmler active */}
      <HomeHeader activeRoute="/filmler" userCode={userCode} onLogout={handleLogout} />

      <main>
        {/* 2. Hero Section */}
        <section className={styles.heroSection}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div className={styles.heroContent}>
                <span className={styles.kicker}>SİNEMA & VİZYON FİLMLERİ</span>
                <h1 className={styles.heroTitle}>
                  Geniş Film Arşivi,<br />
                  Sinematik Kalite.
                </h1>
                <p className={styles.heroDescription}>
                  En yeni vizyon filmleri, klasik başyapıtlar ve ödüllü sinema
                  koleksiyonları. 4K Ultra HD, HDR ve surround ses desteğiyle sinema
                  keyfi evinize geliyor.
                </p>

                <div className={styles.heroPillsRow} aria-label="Film Özellikleri">
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">★</span>
                    <span>4K Ultra HD</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">✓</span>
                    <span>Çoklu Dil & Altyazı</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">❖</span>
                    <span>Kategori Filtresi</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">▶</span>
                    <span>Hızlı Başlatma</span>
                  </span>
                </div>
              </div>

              <div className={styles.heroVisualWrapper}>
                <Image
                  src="/images/home/category-movies.jpg"
                  alt="Flixify Sinema Kataloğu"
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
              <div className={styles.tabsScroll} role="tablist" aria-label="Film Türleri">
                {movieGenres.map((genre) => (
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
                  placeholder="Film veya tür ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                  aria-label="Film ara"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 4. Film Vitrini (Grid) */}
        <section className={styles.catalogSection}>
          <div className={styles.container}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeadingTitle}>
                {selectedGenre === "Tümü" ? "Öne Çıkan Filmler" : `${selectedGenre} Filmleri`}
              </h2>
              <span className={styles.sectionCount}>
                {filteredMovies.length} içerik listeleniyor
              </span>
            </div>

            {filteredMovies.length > 0 ? (
              <div className={styles.posterGrid}>
                {filteredMovies.map((movie) => (
                  <article key={movie.id} className={styles.posterCard}>
                    <div className={styles.posterImageWrapper}>
                      <Image
                        src={movie.image}
                        alt={movie.title}
                        fill
                        sizes="(max-width: 680px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className={styles.posterImage}
                      />
                      <div className={styles.posterOverlay} />

                      <div className={styles.badgeRow}>
                        <span className={styles.qualityBadge}>{movie.quality}</span>
                        <span className={styles.ratingBadge}>★ {movie.rating}</span>
                      </div>
                    </div>

                    <div className={styles.posterContent}>
                      <span className={styles.posterTag}>{movie.genre}</span>
                      <h3 className={styles.posterTitle}>{movie.title}</h3>
                      <div className={styles.posterMeta}>
                        <span>{movie.year}</span>
                        <span>•</span>
                        <span>{movie.duration}</span>
                      </div>
                      <p className={styles.posterDesc}>{movie.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p>"{searchQuery}" aramasına uygun film bulunamadı.</p>
              </div>
            )}
          </div>
        </section>

        {/* 5. Sinema Özellikleri Bandı */}
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
                <h3 className={styles.featureTitle}>4K Ultra HD & HDR</h3>
                <p className={styles.featureText}>
                  Yüksek dinamik aralık ve kristal netliğinde görüntü kalitesiyle
                  her sahneyi yönetmenin gözünden izleyin.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Çoklu Seslendirme & Altyazı</h3>
                <p className={styles.featureText}>
                  Orijinal stüdyo sesleri, Türkçe dublaj ve yüksek çözünürlüklü altyazı
                  seçenekleriyle kişiselleştirilmiş izleme deneyimi.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Kaldığın Yerden Devam Et</h3>
                <p className={styles.featureText}>
                  Televizyonda başladığınız filme bilgisayarınızda veya telefonunuzda
                  kaldığınız saniyeden devam edin.
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
                <span className={styles.ctaKicker}>SİNEMA HER YERDE</span>
                <h2 className={styles.ctaTitle}>Flixify ile Sinema Dünyasına Adım Atın.</h2>
                <p className={styles.ctaText}>
                  Binlerce film, özel koleksiyonlar ve yeni vizyon yapımları tek platformda.
                  Hemen hesabınızı oluşturun.
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
