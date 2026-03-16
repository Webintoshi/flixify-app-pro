export default function ContactPage() {
  const whatsapp =
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ??
    process.env.PUBLIC_SUPPORT_WHATSAPP ??
    "https://wa.me/900000000000";
  const telegram =
    process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM ??
    process.env.PUBLIC_SUPPORT_TELEGRAM ??
    "https://t.me/yourchannel";

  return (
    <main className="page-grid">
      <section className="preview-hero">
        <span className="section-kicker">Iletisim</span>
        <h1 className="section-title">Satin alma ve deneme akislari destek ekibiyle tamamlanir.</h1>
        <p className="section-description">
          Paket satin almadan once veya sonra ekiple WhatsApp ya da Telegram uzerinden iletisime
          gecilebilir. Link atamasi ve manuel dogrulama burada yonetilir.
        </p>
        <div className="hero-actions">
          <a className="button button-hero" href={whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="icon-button" href={telegram} target="_blank" rel="noreferrer">
            +
          </a>
        </div>
      </section>

      <section className="contact-grid">
        <article className="teaser-card">
          <span className="teaser-label">WhatsApp</span>
          <h2>Hizli satin alma destegi</h2>
          <p>Paket sorulari, hesap aktivasyonu ve genel yonlendirme icin anlik destek hatti.</p>
        </article>
        <article className="teaser-card">
          <span className="teaser-label">Telegram</span>
          <h2>Alternatif kanal</h2>
          <p>Destek, takip ve kampanya akislarini ikinci kanaldan yonetmek isteyenler icin hazir.</p>
        </article>
      </section>
    </main>
  );
}
