"use client";

import { useEffect, useState } from "react";
import type { PackageRecord } from "@flixify/contracts";
import { apiRequest } from "../../../lib/api";

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPackages() {
    const response = await apiRequest<{ items: PackageRecord[] }>("/admin/packages", {
      useAdminToken: true
    });
    setPackages(response.items);
    setPriceDrafts(
      Object.fromEntries(response.items.map((item) => [item.id, item.priceLabel ?? ""])) as Record<string, string>
    );
  }

  function setSaving(packageId: string, nextValue: boolean) {
    setSavingById((prev) => ({
      ...prev,
      [packageId]: nextValue
    }));
  }

  async function patchPackage(
    packageId: string,
    payload: { isActive?: boolean; priceLabel?: string | null },
    successMessage: string
  ) {
    setMessage(null);
    setError(null);
    setSaving(packageId, true);

    try {
      await apiRequest(`/admin/packages/${packageId}`, {
        method: "PATCH",
        body: payload,
        useAdminToken: true
      });
      setMessage(successMessage);
      await loadPackages();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Paket bilgisi guncellenemedi.");
    } finally {
      setSaving(packageId, false);
    }
  }

  useEffect(() => {
    loadPackages()
      .catch(() => {
        setPackages([]);
        setError("Paketler yuklenemedi.");
      });
  }, []);

  async function togglePackage(id: string, isActive: boolean) {
    await patchPackage(id, { isActive: !isActive }, "Paket durumu guncellendi.");
  }

  async function savePrice(packageId: string) {
    const current = packages.find((item) => item.id === packageId);
    if (!current) {
      return;
    }

    const normalizedDraft = (priceDrafts[packageId] ?? "").trim();
    const nextPriceLabel = normalizedDraft.length > 0 ? normalizedDraft : null;
    if ((current.priceLabel ?? null) === nextPriceLabel) {
      setMessage("Fiyat bilgisi zaten guncel.");
      setError(null);
      return;
    }

    await patchPackage(packageId, { priceLabel: nextPriceLabel }, "Paket fiyati guncellendi.");
  }

  return (
    <main className="page-grid">
      <section className="panel stack">
        <h1 style={{ margin: 0 }}>/admin/paketler</h1>
        <p className="muted">
          Sureler sabit kalir (1, 3, 6 ve 12 ay) ancak fiyat etiketlerini buradan istediginiz zaman
          kampanya veya zam politikaniza gore degistirebilirsiniz.
        </p>
      </section>
      <section className="grid-3">
        {packages.map((item) => (
          <article key={item.id} className="panel stack">
            <span className="badge">{item.durationMonths} ay</span>
            <strong>{item.title}</strong>
            <span className="muted">Slug: {item.slug}</span>
            <label className="field">
              <span>Fiyat Etiketi</span>
              <input
                type="text"
                value={priceDrafts[item.id] ?? ""}
                onChange={(event) =>
                  setPriceDrafts((prev) => ({
                    ...prev,
                    [item.id]: event.target.value
                  }))
                }
                placeholder="Ornek: 499 TL"
              />
            </label>
            <span className="muted">
              Guncel fiyat: {item.priceLabel && item.priceLabel.trim().length > 0 ? item.priceLabel : "Belirlenmedi"}
            </span>
            <span className="muted">Durum: {item.isActive ? "aktif" : "pasif"}</span>
            <div className="button-row">
              <button
                className="button"
                onClick={() => void savePrice(item.id)}
                disabled={savingById[item.id] === true}
              >
                Fiyati Kaydet
              </button>
              <button
                className="button secondary"
                onClick={() => void togglePackage(item.id, item.isActive)}
                disabled={savingById[item.id] === true}
              >
                {item.isActive ? "Pasife Al" : "Aktif Et"}
              </button>
            </div>
          </article>
        ))}
      </section>
      {message ? <section className="panel">{message}</section> : null}
      {error ? <section className="panel">{error}</section> : null}
    </main>
  );
}
