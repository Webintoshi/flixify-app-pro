"use client";

import { useEffect, useState } from "react";
import type { PackageRecord } from "@flixify/contracts";
import { apiRequest } from "../../../lib/api";

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPackages() {
    const response = await apiRequest<{ items: PackageRecord[] }>("/admin/packages", {
      useAdminToken: true
    });
    setPackages(response.items);
  }

  useEffect(() => {
    loadPackages()
      .catch(() => setPackages([]));
  }, []);

  async function togglePackage(id: string, isActive: boolean) {
    await apiRequest(`/admin/packages/${id}`, {
      method: "PATCH",
      body: { isActive: !isActive },
      useAdminToken: true
    });
    setMessage("Paket durumu guncellendi.");
    await loadPackages();
  }

  return (
    <main className="page-grid">
      <section className="panel stack">
        <h1 style={{ margin: 0 }}>/admin/paketler</h1>
        <p className="muted">
          Paketlerin sure mantigi sabittir: 1, 3, 6 ve 12 ay. Aktivasyon her zaman admin onayi ile
          baslar.
        </p>
      </section>
      <section className="grid-3">
        {packages.map((item) => (
          <article key={item.id} className="panel stack">
            <span className="badge">{item.duration}</span>
            <strong>{item.title}</strong>
            <span className="muted">Slug: {item.slug}</span>
            <span className="muted">Durum: {item.isActive ? "aktif" : "pasif"}</span>
            <button className="button secondary" onClick={() => void togglePackage(item.id, item.isActive)}>
              {item.isActive ? "Pasife Al" : "Aktif Et"}
            </button>
          </article>
        ))}
      </section>
      {message ? <section className="panel">{message}</section> : null}
    </main>
  );
}
