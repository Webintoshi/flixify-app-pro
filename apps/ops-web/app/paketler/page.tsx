"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PackageRecord } from "@flixify/contracts";
import { apiRequest } from "../../lib/api";

export default function PackagesPage() {
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ items: PackageRecord[] }>("/admin/packages/public")
      .then((response) => setPackages(response.items))
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Paketler yuklenemedi"));
  }, []);

  return (
    <main className="page-grid">
      <section className="preview-hero">
        <span className="section-kicker">Paketler</span>
        <h1 className="section-title">Aylik planlar admin onayi ile aktif edilir.</h1>
        <p className="section-description">
          V1 akista satin alim otomatik checkout ile degil, destek ekibi uzerinden manuel
          dogrulama ile tamamlanir. Kullanici once paketini secer, sonra ekip onay verir.
        </p>
        <div className="hero-actions">
          <Link href="/kayit-ol" className="button button-hero">
            Hesap Olustur
          </Link>
          <Link href="/iletisim" className="icon-button">
            +
          </Link>
        </div>
      </section>

      {error ? <section className="panel">{error}</section> : null}

      <section className="pricing-grid">
        {packages.map((item) => (
          <article key={item.id} className="pricing-card">
            <span className="teaser-label">{item.durationMonths} ay</span>
            <h2>{item.title}</h2>
            <p>
              {item.priceLabel && item.priceLabel.trim().length > 0
                ? `Fiyat: ${item.priceLabel}`
                : "Fiyat bilgisi destek ekibi tarafindan iletilir."}
            </p>
            <p>
              Paket seciminden sonra kullanici uygulama icinde odeme talebi olusturur, ekip manuel
              onay verir.
            </p>
            <div className="pricing-actions">
              <Link href="/kayit-ol" className="button button-hero">
                Hesap Ac
              </Link>
              <Link href="/iletisim" className="ghost-link">
                Destek
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
