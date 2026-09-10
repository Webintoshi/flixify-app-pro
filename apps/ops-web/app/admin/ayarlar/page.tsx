"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type SettingsState = {
  supportWhatsappUrl: string;
  supportTelegramUrl: string;
  salesPortalUrl: string | null;
  heroTitle: string;
  heroSubtitle: string;
  sharedPlaylistUrl: string | null;
  sharedSourceStatus?: string | null;
  sharedSourceSnapshotVersion?: number | null;
  sharedSourceLastSuccessfulSyncAt?: string | null;
  sharedSourceLastError?: string | null;
};

const initialState: SettingsState = {
  supportWhatsappUrl: "",
  supportTelegramUrl: "",
  salesPortalUrl: "",
  heroTitle: "",
  heroSubtitle: "",
  sharedPlaylistUrl: ""
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(initialState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<SettingsState>("/admin/settings", {
      useAdminToken: true
    })
      .then((response) => setSettings(response))
      .catch(() => setMessage("Ayarlar yuklenemedi. Once admin girisi yap."));
  }, []);

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setMessage(null);
    setSaving(true);

    try {
      await apiRequest("/admin/settings", {
        method: "PUT",
        body: {
          ...settings,
          salesPortalUrl: settings.salesPortalUrl || null,
          sharedPlaylistUrl: settings.sharedPlaylistUrl || null
        },
        useAdminToken: true
      });
      setMessage("Sistem ayarları başarıyla kaydedildi.");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Ayarlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "12px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(255, 255, 255, 0.04)",
    color: "white",
    fontSize: "0.95rem"
  };

  const labelSpanStyle = {
    fontSize: "0.85rem",
    color: "rgba(255, 255, 255, 0.72)",
    fontWeight: 600
  };

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Sistem Ayarları</h1>
          <p>
            Müşteri destek kanalları, genel portal metinleri ve ortak M3U içerik kaynağı yapılandırması
          </p>
        </div>
        <button
          className="button button-hero"
          style={{ minHeight: "46px", paddingInline: "24px", borderRadius: "12px", cursor: "pointer" }}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Kaydediliyor..." : "Ayarları Kaydet"}
        </button>
      </section>

      {message ? (
        <div style={{
          padding: "14px 20px",
          borderRadius: "14px",
          background: message.includes("başarıyla") ? "rgba(0, 199, 129, 0.12)" : "rgba(244, 6, 18, 0.12)",
          border: `1px solid ${message.includes("başarıyla") ? "rgba(0, 199, 129, 0.28)" : "rgba(244, 6, 18, 0.28)"}`,
          color: message.includes("başarıyla") ? "#19d690" : "#ff6d76",
          fontWeight: 600
        }}>
          {message.includes("başarıyla") ? "✓" : "✕"} {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "24px" }}>
        {/* Ortak M3U Kaynağı */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <span style={{ fontSize: "1.3rem" }}>📺</span>
            <div>
              <strong style={{ fontSize: "1.2rem", display: "block" }}>Ortak M3U Playlist & İçerik Kaynağı</strong>
              <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Tüm kullanıcıların eriştiği merkezi IPTV/VOD veritabanı kaynağı</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", padding: "16px", borderRadius: "16px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div>
              <span style={{ display: "block", fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.5)" }}>Snapshot Sürümü</span>
              <strong style={{ fontSize: "1.3rem", color: "white" }}>v{settings.sharedSourceSnapshotVersion ?? 0}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.5)" }}>Durum</span>
              <span className={`admin-badge ${settings.sharedSourceStatus === "ready" ? "is-success" : settings.sharedSourceStatus === "syncing" ? "is-warning" : "is-danger"}`} style={{ marginTop: "4px" }}>
                {settings.sharedSourceStatus === "ready" ? "Yayında (Hazır)" : settings.sharedSourceStatus === "syncing" ? "Eşitleniyor..." : (settings.sharedSourceStatus ?? "Tanımsız")}
              </span>
            </div>
            {settings.sharedSourceLastSuccessfulSyncAt ? (
              <div>
                <span style={{ display: "block", fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.5)" }}>Son Başarılı Eşitleme</span>
                <span style={{ fontSize: "0.95rem", color: "rgba(255, 255, 255, 0.85)", fontWeight: 600 }}>
                  {new Date(settings.sharedSourceLastSuccessfulSyncAt).toLocaleString("tr-TR")}
                </span>
              </div>
            ) : null}
          </div>

          {settings.sharedSourceLastError ? (
            <div style={{ padding: "12px 16px", borderRadius: "12px", background: "rgba(244, 6, 18, 0.12)", border: "1px solid rgba(244, 6, 18, 0.25)", color: "#ff6d76", fontSize: "0.85rem" }}>
              <strong>Son Hata:</strong> {settings.sharedSourceLastError}
            </div>
          ) : null}

          <label style={{ display: "grid", gap: "8px" }}>
            <span style={labelSpanStyle}>Ortak M3U Playlist URL</span>
            <input
              type="text"
              style={inputStyle}
              value={settings.sharedPlaylistUrl ?? ""}
              onChange={(e) => setSettings({ ...settings, sharedPlaylistUrl: e.target.value })}
              placeholder="http://domain:port/get.php?username=...&password=...&type=m3u_plus&output=ts"
            />
            <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>
              Ortak katalog bu kaynaktan veritabanına indekslenir. Kullanıcılar kendi IPTV kullanıcı adı ve şifreleriyle akışı alır.
            </span>
          </label>
        </article>

        {/* Destek Kanalları */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <span style={{ fontSize: "1.3rem" }}>💬</span>
            <div>
              <strong style={{ fontSize: "1.2rem", display: "block" }}>İletişim & Müşteri Destek Kanalları</strong>
              <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Uygulama ve web arayüzündeki destek butonlarının yönlendirme linkleri</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>WhatsApp Destek URL</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.supportWhatsappUrl}
                onChange={(e) => setSettings({ ...settings, supportWhatsappUrl: e.target.value })}
                placeholder="https://wa.me/905xxxxxxxxx"
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Telegram Kanal / Destek URL</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.supportTelegramUrl}
                onChange={(e) => setSettings({ ...settings, supportTelegramUrl: e.target.value })}
                placeholder="https://t.me/kanaladiniz"
              />
            </label>

            <label style={{ display: "grid", gap: "8px", gridColumn: "1 / -1" }}>
              <span style={labelSpanStyle}>Satış Portalı URL (Opsiyonel)</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.salesPortalUrl ?? ""}
                onChange={(e) => setSettings({ ...settings, salesPortalUrl: e.target.value })}
                placeholder="https://bayi.veya.satis.linkiniz.com"
              />
            </label>
          </div>
        </article>

        {/* Hero Metinleri */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <span style={{ fontSize: "1.3rem" }}>✨</span>
            <div>
              <strong style={{ fontSize: "1.2rem", display: "block" }}>Web Açılış Sayfası (Landing) Metinleri</strong>
              <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Ana sayfadaki büyük karşılama başlığı ve alt açıklaması</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: "16px" }}>
            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Karşılama Başlığı (Hero Title)</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.heroTitle}
                onChange={(e) => setSettings({ ...settings, heroTitle: e.target.value })}
                placeholder="Örn: Sınırsız Eğlence, Tek Bir Platformda."
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Karşılama Alt Metni (Hero Subtitle)</span>
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                value={settings.heroSubtitle}
                onChange={(e) => setSettings({ ...settings, heroSubtitle: e.target.value })}
                placeholder="Örn: 4K Canlı TV kanalları, binlerce film ve dizi arşivine kesintisiz erişim sağlayın."
              />
            </label>
          </div>
        </article>
      </div>
    </main>
  );
}
