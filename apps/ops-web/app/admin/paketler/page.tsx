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
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Paket Yönetimi</h1>
          <p>
            Sabit abonelik süreleri (1, 3, 6 ve 12 ay) için fiyat etiketlerini ve paket görünürlüklerini buradan yönetebilirsiniz.
          </p>
        </div>
      </section>

      {message ? (
        <div style={{ padding: "14px 20px", borderRadius: "14px", background: "rgba(0, 199, 129, 0.12)", border: "1px solid rgba(0, 199, 129, 0.28)", color: "#19d690", fontWeight: 600 }}>
          ✓ {message}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: "14px 20px", borderRadius: "14px", background: "rgba(244, 6, 18, 0.12)", border: "1px solid rgba(244, 6, 18, 0.28)", color: "#ff6d76", fontWeight: 600 }}>
          ✕ {error}
        </div>
      ) : null}

      <section style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {packages.map((item) => (
          <article key={item.id} className="admin-section-card" style={{ display: "flex", flexDirection: "column", gap: "16px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "10px", background: "rgba(244, 6, 18, 0.15)", color: "#f40612" }}>
                  <svg width="20" height="20" aria-hidden="true"><use href="/icons/admin-icons.svg#package" /></svg>
                </span>
                <div>
                  <strong style={{ fontSize: "1.25rem", display: "block" }}>{item.title}</strong>
                  <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Slug: {item.slug}</span>
                </div>
              </div>
              <span className={`admin-badge ${item.isActive ? "is-success" : "is-muted"}`}>
                {item.isActive ? "Yayında" : "Pasif"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <span style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.9rem" }}>Süre:</span>
              <strong style={{ color: "white" }}>{item.durationMonths} Ay</strong>
              <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "#f0af31", fontWeight: 700 }}>
                {item.priceLabel && item.priceLabel.trim().length > 0 ? item.priceLabel : "Fiyat Belirlenmedi"}
              </span>
            </div>

            <label className="field" style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontSize: "0.85rem", color: "rgba(255, 255, 255, 0.72)", fontWeight: 600 }}>Fiyat Etiketi</span>
              <input
                type="text"
                className="admin-input"
                value={priceDrafts[item.id] ?? ""}
                onChange={(event) =>
                  setPriceDrafts((prev) => ({
                    ...prev,
                    [item.id]: event.target.value
                  }))
                }
                placeholder="Örnek: 499 TL"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "white"
                }}
              />
            </label>

            <div style={{ display: "flex", gap: "10px", marginTop: "auto", paddingTop: "8px" }}>
              <button
                className="button"
                style={{ flex: 1, minHeight: "44px", borderRadius: "12px", cursor: "pointer", background: "#f40612", color: "white", fontWeight: 700 }}
                onClick={() => void savePrice(item.id)}
                disabled={savingById[item.id] === true}
              >
                {savingById[item.id] ? "Kaydediliyor..." : "Fiyatı Kaydet"}
              </button>
              <button
                className="button secondary"
                style={{ minHeight: "44px", paddingInline: "16px", borderRadius: "12px", cursor: "pointer", background: "rgba(255, 255, 255, 0.08)", color: "white" }}
                onClick={() => void togglePackage(item.id, item.isActive)}
                disabled={savingById[item.id] === true}
              >
                {item.isActive ? "Pasife Al" : "Aktif Et"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
