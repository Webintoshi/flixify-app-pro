import Link from "next/link";

type PreviewItem = {
  label: string;
  title: string;
  description: string;
};

type PublicPreviewPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  stats: string[];
  items: PreviewItem[];
};

export function PublicPreviewPage({
  eyebrow,
  title,
  description,
  stats,
  items
}: PublicPreviewPageProps) {
  return (
    <main className="page-grid">
      <section className="preview-hero">
        <span className="section-kicker">{eyebrow}</span>
        <h1 className="section-title">{title}</h1>
        <p className="section-description">{description}</p>
        <div className="preview-stat-row">
          {stats.map((stat) => (
            <span key={stat} className="preview-stat">
              {stat}
            </span>
          ))}
        </div>
        <div className="hero-actions">
          <Link href="/kayit-ol" className="button button-hero">
            Hesap Olustur
          </Link>
          <Link href="/paketler" className="icon-button">
            +
          </Link>
        </div>
      </section>

      <section className="teaser-grid">
        {items.map((item) => (
          <article key={item.title} className="teaser-card">
            <span className="teaser-label">{item.label}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
