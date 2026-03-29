import Link from "next/link";

const downloads = [
  {
    title: "Android TV Cihaz APK",
    description:
      "Gercek Android TV cihazlar ve arm64 destekli kutular icin yuklenebilir paket.",
    href: "/downloads/Flixify-Pro-TV-android-arm64-release.apk",
    badge: "ARM64",
    buttonLabel: "APK'yi Indir"
  },
  {
    title: "Android TV Emulator APK",
    description:
      "Android Studio icindeki TV emulator testleri icin x86_64 derlemesi.",
    href: "/downloads/Flixify-Pro-TV-android-x86_64-release.apk",
    badge: "x86_64",
    buttonLabel: "Emulator APK'si"
  }
];

const checks = [
  "Ilk acilista kayit veya giris ekrani gorunuyor mu",
  "D-pad ile odak gecisleri temiz calisiyor mu",
  "Canli TV, film ve dizi ekranlari aciliyor mu",
  "Player acildiginda kontroller dogru gorunuyor mu"
];

export default function AndroidTvPage() {
  return (
    <main className="android-tv-page">
      <section className="android-tv-hero">
        <div className="android-tv-copy">
          <span className="android-tv-kicker">Android TV Test Surumu</span>
          <h1>APK indir, cihaza yukle, dogrudan test et.</h1>
          <p>
            Windows native deneyimine parity hedefiyle hazirlanan Android TV surumunu
            gercek cihazda veya emulatorde dogrudan kurup test edebilirsin.
          </p>
          <div className="android-tv-actions">
            <Link href="#android-tv-downloads" className="button button-hero">
              Indirme Bolumune Git
            </Link>
            <Link href="/kayit-ol" className="ghost-link android-tv-link">
              Hesap Olustur
            </Link>
          </div>
        </div>
      </section>

      <section id="android-tv-downloads" className="android-tv-downloads">
        <div className="android-tv-heading">
          <span className="section-kicker">Indirme Secenekleri</span>
          <h2 className="section-title">Dogru APK'yi sec.</h2>
          <p className="section-description">
            Gercek cihaz icin ARM64, Android Studio TV emulatoru icin x86_64 paketi
            kullan.
          </p>
        </div>

        <div className="android-tv-grid">
          {downloads.map((item) => (
            <article key={item.href} className="android-tv-card">
              <span className="android-tv-badge">{item.badge}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <a href={item.href} className="button button-hero android-tv-download-button" download>
                {item.buttonLabel}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="android-tv-guide">
        <div className="android-tv-heading">
          <span className="section-kicker">Test Notlari</span>
          <h2 className="section-title">Ilk kontrolde bakilacaklar</h2>
        </div>
        <div className="android-tv-checklist">
          {checks.map((item) => (
            <div key={item} className="android-tv-check">
              <span className="android-tv-check-dot" aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
