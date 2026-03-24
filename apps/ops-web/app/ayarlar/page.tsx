"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "../../lib/api";
import "./ayarlar.css";

// ============================================
// 🎨 FLIXIFY PRO - Premium User Settings Page
// ============================================

type UserSettings = {
  username: string;
  code: string;
  packageName: string;
  packageExpiry: string;
  linkStatus: "connected" | "disconnected" | "pending";
  linkStatusText: string;
  remainingDays: number;
};

type MeResponse = {
  user: {
    kryptoniteCode: string;
    activePackage?: {
      title: string;
      endsAt: string;
      remainingDays: number;
    };
  };
};

const initialState: UserSettings = {
  username: "",
  code: "",
  packageName: "",
  packageExpiry: "",
  linkStatus: "pending",
  linkStatusText: "Bekliyor",
  remainingDays: 0
};

export default function UserSettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(initialState);
  const [isLoading, setIsLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    // Fetch user settings from API
    apiRequest<MeResponse>("/me", {})
      .then((response) => {
        setSettings({
          username: response.user.kryptoniteCode || "",
          code: response.user.kryptoniteCode || "",
          packageName: response.user.activePackage?.title || "Aktif Paket Yok",
          packageExpiry: response.user.activePackage?.endsAt 
            ? new Date(response.user.activePackage.endsAt).toLocaleDateString("tr-TR")
            : "-",
          linkStatus: response.user.activePackage ? "connected" : "disconnected",
          linkStatusText: response.user.activePackage ? "Bağlı" : "Bağlı Değil",
          remainingDays: response.user.activePackage?.remainingDays || 0
        });
      })
      .catch(() => {
        // Fallback for demo
        setSettings({
          username: "ZNKEGVLLAT5HBX2G",
          code: "ZNKEGVLLAT5HBX2G",
          packageName: "24 Saat Test",
          packageExpiry: "18.03.2026",
          linkStatus: "connected",
          linkStatusText: "Bağlı",
          remainingDays: 1
        });
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(settings.code);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const getStatusIcon = () => {
    switch (settings.linkStatus) {
      case "connected":
        return (
          <svg className="status-icon status-connected" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        );
      case "disconnected":
        return (
          <svg className="status-icon status-disconnected" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/>
          </svg>
        );
      default:
        return (
          <svg className="status-icon status-pending" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
          </svg>
        );
    }
  };

  if (isLoading) {
    return (
      <main className="settings-page">
        <div className="settings-container">
          <div className="settings-skeleton">
            <div className="skeleton-title"></div>
            <div className="skeleton-cards">
              <div className="skeleton-card"></div>
              <div className="skeleton-card"></div>
              <div className="skeleton-card"></div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="settings-page">
      <div className="settings-container">
        {/* Header Section */}
        <header className="settings-header">
          <div className="settings-header-content">
            <h1 className="settings-title">
              <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Ayarlar
            </h1>
            <p className="settings-subtitle">Hesap bilgilerinizi ve paket durumunuzu yönetin</p>
          </div>
        </header>

        {/* Info Cards Grid */}
        <section className="settings-cards">
          {/* User Code Card */}
          <article className="settings-card settings-card--primary">
            <div className="settings-card-header">
              <div className="settings-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <span className="settings-card-label">Kullanıcı Kodu</span>
            </div>
            <div className="settings-card-content">
              <div className="code-display">
                <code className="code-value">{settings.code}</code>
                <button 
                  className={`copy-btn ${copySuccess ? 'copied' : ''}`}
                  onClick={handleCopyCode}
                  title="Kodu Kopyala"
                >
                  {copySuccess ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="settings-card-footer">
              <span className="hint-text">Bu kod ile tüm cihazlarınızda giriş yapabilirsiniz</span>
            </div>
          </article>

          {/* Package Card */}
          <article className={`settings-card settings-card--package ${settings.remainingDays <= 3 ? 'expiring-soon' : ''}`}>
            <div className="settings-card-header">
              <div className="settings-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
              </div>
              <span className="settings-card-label">Aktif Paket</span>
            </div>
            <div className="settings-card-content">
              <h3 className="package-name">{settings.packageName}</h3>
              <div className="package-expiry">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span>Son Tarih: {settings.packageExpiry}</span>
              </div>
              {settings.remainingDays > 0 && (
                <div className="package-remaining">
                  <div className="remaining-badge">
                    <span className="remaining-number">{settings.remainingDays}</span>
                    <span className="remaining-text">gün kaldı</span>
                  </div>
                  {settings.remainingDays <= 3 && (
                    <span className="expiry-warning">Yenilemenizi öneririz</span>
                  )}
                </div>
              )}
            </div>
          </article>

          {/* Link Status Card */}
          <article className="settings-card settings-card--status">
            <div className="settings-card-header">
              <div className="settings-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
              <span className="settings-card-label">Link Durumu</span>
            </div>
            <div className="settings-card-content">
              <div className="status-display">
                {getStatusIcon()}
                <span className={`status-text status-${settings.linkStatus}`}>
                  {settings.linkStatusText}
                </span>
              </div>
              <div className="status-indicator">
                <span className={`status-dot status-${settings.linkStatus}`}></span>
                <span className="status-description">
                  {settings.linkStatus === "connected" 
                    ? "Tüm içeriklere erişebilirsiniz" 
                    : "Link bağlantısı bekleniyor"}
                </span>
              </div>
            </div>
          </article>
        </section>

        {/* Action Buttons */}
        <section className="settings-actions">
          <Link href="/paketler" className="action-btn action-btn--primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="3" width="15" height="13"/>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
            <span>Paketler</span>
          </Link>
          
          <Link href="/odeme-bildirimi" className="action-btn action-btn--secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            <span>Ödeme Bildirimi</span>
          </Link>
          
          <Link href="/iletisim" className="action-btn action-btn--secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
            <span>İletişim</span>
          </Link>
        </section>

        {/* Quick Help Section */}
        <section className="settings-help">
          <h2 className="help-title">Yardım mı lazım?</h2>
          <div className="help-cards">
            <Link href="/yardim/nasil-kullanirim" className="help-card">
              <div className="help-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <span>Nasıl kullanırım?</span>
            </Link>
            
            <Link href="/yardim/sorun-giderme" className="help-card">
              <div className="help-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
              </div>
              <span>Sorun Giderme</span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
