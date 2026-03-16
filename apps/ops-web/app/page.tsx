import Link from "next/link";

const capabilities = [
  {
    title: "1000+ Kanal",
    description: "Ulusal ve uluslararasi kanallar"
  },
  {
    title: "4K UHD",
    description: "Ultra yuksek cozumurluk"
  },
  {
    title: "Kesintisiz",
    description: "Donma ve takilma yok"
  }
];

const showcaseTiles = [
  {
    label: "Filmler",
    title: "Poster bazli film katalogu",
    description: "Aksiyon, aile, gerilim ve yeni eklenen filmler daha duzenli rail yapisiyla sunulur."
  },
  {
    label: "Diziler",
    title: "Sezon ve bolum ayrimi korunur",
    description: "Dizi icerikleri bolum yapisini kaybetmeden daha okunur bir deneyime donusturulur."
  },
  {
    label: "Canli TV",
    title: "Spor ve haber icin hizli erisim",
    description: "Canli yayinlar grup basliklariyla ayrilir, kullanici dogrudan izlemek istedigi kategoriye gider."
  }
];

export default function HomePage() {
  return (
    <main className="marketing-home">
      <section className="marketing-hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="hero-meta">
              <span className="rating-chip">9.8</span>
              <span>2026</span>
              <span>Her Gun Guncel Icerik</span>
              <span>4K UHD</span>
            </div>
            <h1 className="hero-title">Sinirsiz Eglence Tek Bir Yerde.</h1>
            <p className="hero-description">
              Favori TV sovlarinizi, filmlerinizi, canli yayinlari, haber kanallarini, spor
              musabakalarini ve cocuk iceriklerini 4K kalitesinde daha duzenli bir arayuzde
              izleyin.
            </p>
            <div className="hero-actions">
              <Link href="/kayit-ol" className="button button-hero">
                Hesap Olustur
              </Link>
              <Link href="/paketler" className="icon-button">
                +
              </Link>
            </div>
          </div>
        </div>

        <div className="capability-strip">
          {capabilities.map((item) => (
            <article key={item.title} className="capability-card">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="showcase-section">
        <div className="section-heading">
          <span className="section-kicker">Platform On Yuzu</span>
          <h2 className="section-title">Kullanicilarin gorecegi deneyim artik landing seviyesinde hazir.</h2>
          <p className="section-description">
            Kategori bazli sunum, anonim hesap olusturma, giris aksiyonu ve paket yonlendirmesi tek
            public katmanda bir araya gelir.
          </p>
        </div>

        <div className="teaser-grid">
          {showcaseTiles.map((item) => (
            <article key={item.title} className="teaser-card">
              <span className="teaser-label">{item.label}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
