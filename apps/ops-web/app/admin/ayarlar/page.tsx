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

  async function handleSave() {
    setMessage(null);

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
      setMessage("Ayarlar kaydedildi.");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Ayarlar kaydedilemedi.");
    }
  }

  return (
    <main className="page-grid">
      <section className="panel stack">
        <h1 style={{ margin: 0 }}>/admin/ayarlar</h1>
        <p className="muted">
          Destek kanallari ve satis portalinin merkezi ayarlari burada saklanir.
        </p>
      </section>
      <section className="panel stack">
        <label className="field">
          <span>WhatsApp URL</span>
          <input
            value={settings.supportWhatsappUrl}
            onChange={(event) => setSettings({ ...settings, supportWhatsappUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Telegram URL</span>
          <input
            value={settings.supportTelegramUrl}
            onChange={(event) => setSettings({ ...settings, supportTelegramUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Satis Portal URL</span>
          <input
            value={settings.salesPortalUrl ?? ""}
            onChange={(event) => setSettings({ ...settings, salesPortalUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Ortak Playlist URL</span>
          <input
            value={settings.sharedPlaylistUrl ?? ""}
            onChange={(event) => setSettings({ ...settings, sharedPlaylistUrl: event.target.value })}
            placeholder="http://domain:80/playlist/kullanici/sifre/m3u_plus"
          />
        </label>
        <div className="muted">
          Ortak katalog kaynagi burada tanimlanir. Tum kullanicilar ayni icerigi kullanir; kullanici bazinda sadece IPTV kullanici adi ve sifresi degisir.
        </div>
        <div className="muted">
          Durum: {settings.sharedSourceStatus ?? "-"} | Snapshot: {settings.sharedSourceSnapshotVersion ?? 0}
        </div>
        {settings.sharedSourceLastSuccessfulSyncAt ? (
          <div className="muted">
            Son basarili senkron: {new Date(settings.sharedSourceLastSuccessfulSyncAt).toLocaleString("tr-TR")}
          </div>
        ) : null}
        {settings.sharedSourceLastError ? <div className="auth-error">{settings.sharedSourceLastError}</div> : null}
        <label className="field">
          <span>Hero Baslik</span>
          <input
            value={settings.heroTitle}
            onChange={(event) => setSettings({ ...settings, heroTitle: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Hero Alt Baslik</span>
          <textarea
            rows={3}
            value={settings.heroSubtitle}
            onChange={(event) => setSettings({ ...settings, heroSubtitle: event.target.value })}
          />
        </label>
        {message ? <div className="muted">{message}</div> : null}
        <button className="button" onClick={() => void handleSave()}>
          Kaydet
        </button>
      </section>
    </main>
  );
}
