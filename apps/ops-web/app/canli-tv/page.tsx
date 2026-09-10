"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "../catalog.module.css";

const channelCategories = [
  "Tümü",
  "Ulusal",
  "Spor",
  "Haber",
  "Belgesel",
  "Sinema & Dizi",
  "Müzik & Eğlence",
  "Çocuk"
];

const channelsData = [
  {
    id: "trt-1",
    name: "TRT 1",
    shortName: "TRT",
    category: "Ulusal",
    quality: "Full HD",
    currentProgram: "Gönül Dağı - Yeni Bölüm",
    progressPercent: 65
  },
  {
    id: "bein-sports-1",
    name: "beIN Sports 1",
    shortName: "beIN",
    category: "Spor",
    quality: "4K UHD",
    currentProgram: "Süper Lig: Maç Önü & Analiz",
    progressPercent: 40
  },
  {
    id: "s-sport",
    name: "S Sport",
    shortName: "SS",
    category: "Spor",
    quality: "Full HD",
    currentProgram: "La Liga: Canlı Karşılaşma",
    progressPercent: 75
  },
  {
    id: "tv8",
    name: "TV8",
    shortName: "TV8",
    category: "Müzik & Eğlence",
    quality: "Full HD",
    currentProgram: "Survivor All Star - Canlı",
    progressPercent: 50
  },
  {
    id: "cnn-turk",
    name: "CNN Türk",
    shortName: "CNN",
    category: "Haber",
    quality: "Full HD",
    currentProgram: "Gündem Özel: Canlı Tartışma",
    progressPercent: 30
  },
  {
    id: "ntv",
    name: "NTV",
    shortName: "NTV",
    category: "Haber",
    quality: "Full HD",
    currentProgram: "Yakın Plan & Ekonomi Bülteni",
    progressPercent: 85
  },
  {
    id: "nat-geo",
    name: "National Geographic",
    shortName: "GEO",
    category: "Belgesel",
    quality: "4K UHD",
    currentProgram: "Vahşi Krallık: Afrika Savanları",
    progressPercent: 55
  },
  {
    id: "eurosport",
    name: "Eurosport 1",
    shortName: "EURO",
    category: "Spor",
    quality: "Full HD",
    currentProgram: "Dünya Tenis Şampiyonası",
    progressPercent: 60
  },
  {
    id: "trt-spor",
    name: "TRT Spor",
    shortName: "SPOR",
    category: "Spor",
    quality: "Full HD",
    currentProgram: "Spor Stüdyosu & Maç Özetleri",
    progressPercent: 45
  },
  {
    id: "dmax",
    name: "DMAX",
    shortName: "DMAX",
    category: "Belgesel",
    quality: "Full HD",
    currentProgram: "Hurda Avcıları: Özel Seri",
    progressPercent: 20
  },
  {
    id: "cartoon-network",
    name: "Cartoon Network",
    shortName: "CN",
    category: "Çocuk",
    quality: "Full HD",
    currentProgram: "Gumball & Sürekli Dizi Kuşağı",
    progressPercent: 70
  },
  {
    id: "kral-pop",
    name: "Kral Pop TV",
    shortName: "KRAL",
    category: "Müzik & Eğlence",
    quality: "Full HD",
    currentProgram: "Top 20 Canlı Klip Kuşağı",
    progressPercent: 35
  }
];

export default function LiveTvPage() {
  const [userCode, setUserCode] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("Tümü");
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

  const filteredChannels = useMemo(() => {
    return channelsData.filter((channel) => {
      const matchesCategory =
        selectedCategory === "Tümü" ||
        channel.category.toLowerCase().includes(selectedCategory.toLowerCase());
      const matchesQuery =
        searchQuery.trim() === "" ||
        channel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        channel.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        channel.currentProgram.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesQuery;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className={styles.flixifyCatalog}>
      {/* 1. Header with Canlı TV active */}
      <HomeHeader activeRoute="/canli-tv" userCode={userCode} onLogout={handleLogout} />

      <main>
        {/* 2. Hero Section */}
        <section className={styles.heroSection}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div className={styles.heroContent}>
                <span className={styles.kicker}>KESİNTİSİZ CANLI YAYIN AKIŞI</span>
                <h1 className={styles.heroTitle}>
                  Ulusal, Spor & Haber,<br />
                  Canlı Yayında Tek Merkezde.
                </h1>
                <p className={styles.heroDescription}>
                  Süper Lig ve Avrupa maçları, anlık haber bültenleri, belgeseller ve
                  ulusal kanallar. Düşük gecikme ve optimize akış altyapısıyla
                  televizyon keyfi elinizin altında.
                </p>

                <div className={styles.heroPillsRow} aria-label="Canlı TV Özellikleri">
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">★</span>
                    <span>Düşük Gecikme</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">✓</span>
                    <span>Full HD & 4K Akış</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">❖</span>
                    <span>EPG Yayın Akışı</span>
                  </span>
                  <span className={styles.heroPill}>
                    <span className={styles.heroPillIcon} aria-hidden="true">▶</span>
                    <span>Hızlı Kanal Geçişi</span>
                  </span>
                </div>
              </div>

              <div className={styles.heroVisualWrapper}>
                <Image
                  src="/images/home/category-live-tv.jpg"
                  alt="Flixify Canlı TV Yayını"
                  fill
                  priority
                  className={styles.heroImage}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Toolbar (Search + Category Tabs) */}
        <div className={styles.toolbarSection}>
          <div className={styles.container}>
            <div className={styles.toolbarInner}>
              <div className={styles.tabsScroll} role="tablist" aria-label="Kanal Kategorileri">
                {channelCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === cat}
                    className={`${styles.tabBtn} ${selectedCategory === cat ? styles.tabBtnActive : ""}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
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
                  placeholder="Kanal veya program ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                  aria-label="Kanal ara"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 4. Canlı TV Kanalları Vitrini (Grid) */}
        <section className={styles.catalogSection}>
          <div className={styles.container}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeadingTitle}>
                {selectedCategory === "Tümü" ? "Canlı Kanallar" : `${selectedCategory} Kanalları`}
              </h2>
              <span className={styles.sectionCount}>
                {filteredChannels.length} kanal listeleniyor
              </span>
            </div>

            {filteredChannels.length > 0 ? (
              <div className={styles.liveChannelsGrid}>
                {filteredChannels.map((channel) => (
                  <article key={channel.id} className={styles.channelCard}>
                    <div className={styles.channelHeader}>
                      <div className={styles.channelLogoBox} aria-hidden="true">
                        {channel.shortName}
                      </div>

                      <div className={styles.channelBadges}>
                        <span className={styles.liveBadge}>
                          <span className={styles.liveDot} aria-hidden="true" />
                          <span>CANLI</span>
                        </span>
                        <span className={styles.qualityBadge}>{channel.quality}</span>
                      </div>
                    </div>

                    <h3 className={styles.channelName}>{channel.name}</h3>
                    <span className={styles.channelCategory}>{channel.category}</span>

                    <div className={styles.channelEpgBox}>
                      <span className={styles.epgLabel}>Şu An Yayında</span>
                      <span className={styles.epgProgram} title={channel.currentProgram}>
                        {channel.currentProgram}
                      </span>
                      <div className={styles.epgProgressBar} aria-hidden="true">
                        <div
                          className={styles.epgProgressFill}
                          style={{ width: `${channel.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p>"{searchQuery}" aramasına uygun canlı kanal bulunamadı.</p>
              </div>
            )}
          </div>
        </section>

        {/* 5. Canlı Yayın Özellikleri Bandı */}
        <section className={styles.featuresSection}>
          <div className={styles.container}>
            <div className={styles.featuresGrid}>
              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                    <polyline points="17 2 12 7 7 2" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Kesintisiz Canlı Akış</h3>
                <p className={styles.featureText}>
                  Yüksek bant genişlikli optimize CDN sunucularımız sayesinde
                  yoğun maç saatlerinde bile stabil ve akıcı canlı yayın.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>EPG Elektronik Program Rehberi</h3>
                <p className={styles.featureText}>
                  Hangi kanalda hangi programın yayınlandığını ve sonraki yayın akışını
                  doğrudan arayüz üzerinden takip edin.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIconBox} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>Akıllı TV & Kumanda Uyumlu</h3>
                <p className={styles.featureText}>
                  Android TV ve büyük ekranlarda geleneksel TV kumandasıyla hızlı
                  kanal geçişi (Zapping) rahatlığı.
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
                <span className={styles.ctaKicker}>CANLI YAYIN KEYFİ</span>
                <h2 className={styles.ctaTitle}>Tüm Canlı Kanalları ve Yayınları Keşfet.</h2>
                <p className={styles.ctaText}>
                  Ulusal kanallar, spor heyecanı ve canlı haber akışı tek ekranda.
                  Hemen hesabınızı oluşturun ve canlı yayınlara katılın.
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
