"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "../../../lib/api";

type DashboardState = {
  usersTotal: number;
  usersBlocked: number;
  usersWaitingForLink: number;
  activeSubscriptions: number;
  pendingPaymentRequests: number;
  pendingTrialRequests: number;
  queuedM3UJobs: number;
  failedM3UJobs: number;
  liveHealthyChannels: number;
  liveDegradedChannels: number;
  liveBrokenChannels: number;
  liveLastError: string | null;
};

type AdminUserRow = {
  id: string;
  status: "new" | "active" | "blocked";
  kryptoniteCode: string | null;
  codeSuffix: string | null;
  notes: string | null;
  subscriptionEndsAt: string | null;
  packageStatus: "active" | "expired" | "none";
};

type PaymentRow = {
  id: string;
  status: string;
  packageTitle: string;
  createdAt: string;
  userId: string;
};

const initialDashboard: DashboardState = {
  usersTotal: 0,
  usersBlocked: 0,
  usersWaitingForLink: 0,
  activeSubscriptions: 0,
  pendingPaymentRequests: 0,
  pendingTrialRequests: 0,
  queuedM3UJobs: 0,
  failedM3UJobs: 0,
  liveHealthyChannels: 0,
  liveDegradedChannels: 0,
  liveBrokenChannels: 0,
  liveLastError: null
};

function getCodeLabel(user: AdminUserRow) {
  if (user.kryptoniteCode) {
    return user.kryptoniteCode;
  }

  if (user.codeSuffix) {
    return `Kod kaydı eksik (${user.codeSuffix})`;
  }

  return user.id.slice(0, 8).toUpperCase();
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [recentUsers, setRecentUsers] = useState<AdminUserRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest<DashboardState>("/admin/dashboard", { useAdminToken: true }),
      apiRequest<{ items: AdminUserRow[] }>("/admin/users?page=1&pageSize=6", { useAdminToken: true }),
      apiRequest<{ items: PaymentRow[] }>("/admin/payment-requests", { useAdminToken: true })
    ])
      .then(([dashboardResponse, usersResponse, paymentsResponse]) => {
        setDashboard(dashboardResponse);
        setRecentUsers(usersResponse.items ?? []);
        setPayments((paymentsResponse.items ?? []).slice(0, 6));
      })
      .catch(() => setError("Dashboard verileri yüklenemedi. Lütfen oturumunuzu kontrol edin."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Flixify Pro operasyonel durum, kullanıcı özetleri ve sistem metrikleri</p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link
            href="/admin/kullanicilar"
            className="button"
            style={{ minHeight: "44px", padding: "10px 18px", borderRadius: "12px", fontSize: "0.9rem" }}
          >
            <svg width="18" height="18" aria-hidden="true" style={{ marginRight: "6px" }}>
              <use href="/icons/admin-icons.svg#action-assign" />
            </svg>
            Kullanıcı Yönetimi
          </Link>
        </div>
      </section>

      {error ? (
        <div className="auth-error">
          ✕ {error}
        </div>
      ) : null}

      {/* Metric Cards */}
      <section className="admin-stats-grid">
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-total" aria-hidden="true">
              <use href="/icons/admin-icons.svg#users-total" />
            </svg>
            Toplam Kullanıcı
          </span>
          <strong>{dashboard.usersTotal}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: "100%" }} />
          </div>
          <span className="admin-stat-note">{dashboard.activeSubscriptions} aktif abonelik</span>
        </article>

        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-waiting" aria-hidden="true">
              <use href="/icons/admin-icons.svg#users-waiting" />
            </svg>
            M3U Bekleyen
          </span>
          <strong>{dashboard.usersWaitingForLink}</strong>
          <div className="admin-stat-progress">
            <div
              className="admin-stat-progress-fill"
              style={{
                width: `${dashboard.usersTotal > 0 ? (dashboard.usersWaitingForLink / dashboard.usersTotal) * 100 : 0}%`
              }}
            />
          </div>
          <span className="admin-stat-note">Bağlantı tanımlanmamış hesap</span>
        </article>

        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-expired" aria-hidden="true">
              <use href="/icons/admin-icons.svg#package" />
            </svg>
            Bekleyen Ödemeler
          </span>
          <strong>{dashboard.pendingPaymentRequests}</strong>
          <div className="admin-stat-progress">
            <div
              className="admin-stat-progress-fill"
              style={{ width: `${dashboard.pendingPaymentRequests > 0 ? 100 : 0}%` }}
            />
          </div>
          <span className="admin-stat-note">Manuel onay bekliyor</span>
        </article>

        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-waiting" aria-hidden="true">
              <use href="/icons/admin-icons.svg#users-waiting" />
            </svg>
            Bekleyen Denemeler
          </span>
          <strong>{dashboard.pendingTrialRequests}</strong>
          <div className="admin-stat-progress">
            <div
              className="admin-stat-progress-fill"
              style={{ width: `${dashboard.pendingTrialRequests > 0 ? 100 : 0}%` }}
            />
          </div>
          <span className="admin-stat-note">{dashboard.usersBlocked} bloklu kullanıcı</span>
        </article>

        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-active" aria-hidden="true">
              <use href="/icons/admin-icons.svg#tv" />
            </svg>
            Canlı Kanal Sağlığı
          </span>
          <strong>{dashboard.liveHealthyChannels}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: "100%" }} />
          </div>
          <span className="admin-stat-note">
            {dashboard.liveDegradedChannels} kararsız • {dashboard.liveBrokenChannels} sorunlu
          </span>
        </article>
      </section>

      {/* Quick Action Navigation Bar */}
      <section
        style={{
          display: "grid",
          gap: "14px",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          padding: "16px 20px",
          borderRadius: "20px",
          background: "linear-gradient(145deg, rgba(18, 19, 22, 0.7), rgba(12, 13, 16, 0.7))",
          border: "1px solid rgba(255, 255, 255, 0.06)"
        }}
      >
        <Link
          href="/admin/kullanicilar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            transition: "all 180ms ease"
          }}
          className="admin-quick-link"
        >
          <span style={{ fontSize: "1.4rem" }}>👥</span>
          <div>
            <strong style={{ display: "block", fontSize: "0.95rem" }}>Kullanıcı Listesi</strong>
            <small style={{ color: "rgba(255, 255, 255, 0.45)" }}>IPTV & Paket Tanımla</small>
          </div>
        </Link>

        <Link
          href="/admin/paketler"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            transition: "all 180ms ease"
          }}
          className="admin-quick-link"
        >
          <span style={{ fontSize: "1.4rem" }}>📦</span>
          <div>
            <strong style={{ display: "block", fontSize: "0.95rem" }}>Paket Fiyatlandırma</strong>
            <small style={{ color: "rgba(255, 255, 255, 0.45)" }}>1, 3, 6, 12 Ay Fiyatları</small>
          </div>
        </Link>

        <Link
          href="/admin/odeme-yontemleri"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            transition: "all 180ms ease"
          }}
          className="admin-quick-link"
        >
          <span style={{ fontSize: "1.4rem" }}>💳</span>
          <div>
            <strong style={{ display: "block", fontSize: "0.95rem" }}>Ödeme Kanalları</strong>
            <small style={{ color: "rgba(255, 255, 255, 0.45)" }}>Banka, IBAN, Kripto</small>
          </div>
        </Link>

        <Link
          href="/admin/ayarlar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            transition: "all 180ms ease"
          }}
          className="admin-quick-link"
        >
          <span style={{ fontSize: "1.4rem" }}>⚙️</span>
          <div>
            <strong style={{ display: "block", fontSize: "0.95rem" }}>Sistem & Playlist</strong>
            <small style={{ color: "rgba(255, 255, 255, 0.45)" }}>Ortak Kaynak & Destek</small>
          </div>
        </Link>
      </section>

      {dashboard.liveLastError ? (
        <section
          className="admin-section-card"
          style={{
            borderColor: "rgba(244, 6, 18, 0.3)",
            background: "rgba(244, 6, 18, 0.08)"
          }}
        >
          <strong style={{ color: "#ff6d76", display: "block", marginBottom: "6px" }}>
            ⚠️ Son Canlı Yayın Uyarısı
          </strong>
          <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.8)", fontSize: "0.9rem" }}>
            {dashboard.liveLastError}
          </p>
        </section>
      ) : null}

      {/* Two Column Tables */}
      <section className="admin-two-column">
        {/* Recent Users */}
        <article className="admin-section-card">
          <div className="admin-section-header">
            <div>
              <h2>Son Eklenen Kullanıcılar</h2>
              <p>Hesapların son durumu ve paket bitiş süreleri</p>
            </div>
            <Link
              href="/admin/kullanicilar"
              style={{
                fontSize: "0.85rem",
                color: "#f40612",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              Tümünü Gör ↗
            </Link>
          </div>

          <div className="admin-mini-table">
            <div className="admin-mini-row admin-mini-head">
              <span>Müşteri Kodu</span>
              <span>Paket</span>
              <span>Bitiş</span>
              <span>Durum</span>
            </div>

            {loading ? (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                Yükleniyor...
              </div>
            ) : recentUsers.length === 0 ? (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                Kayıtlı kullanıcı bulunmuyor.
              </div>
            ) : (
              recentUsers.map((item) => (
                <div className="admin-mini-row" key={item.id}>
                  <span
                    style={{
                      fontFamily: '"SF Mono", "Segoe UI Mono", monospace',
                      fontWeight: 700,
                      color: "white"
                    }}
                  >
                    {getCodeLabel(item)}
                  </span>
                  <span>{item.packageStatus === "active" ? "Aktif" : "Bekliyor"}</span>
                  <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
                    {item.subscriptionEndsAt
                      ? new Date(item.subscriptionEndsAt).toLocaleDateString("tr-TR")
                      : "-"}
                  </span>
                  <span>
                    <span
                      className={`admin-badge ${item.packageStatus === "active" ? "is-success" : "is-warning"}`}
                    >
                      {item.packageStatus === "active" ? "Aktif" : "Bekliyor"}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </article>

        {/* Recent Payments */}
        <article className="admin-section-card">
          <div className="admin-section-header">
            <div>
              <h2>Son Ödeme Talepleri</h2>
              <p>Havale veya kripto üzerinden gelen ödeme bildirimleri</p>
            </div>
            <Link
              href="/admin/kullanicilar"
              style={{
                fontSize: "0.85rem",
                color: "#f40612",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              Kullanıcılar ↗
            </Link>
          </div>

          <div className="admin-mini-table">
            <div className="admin-mini-row admin-mini-head">
              <span>Kullanıcı</span>
              <span>Paket</span>
              <span>Tarih</span>
              <span>Durum</span>
            </div>

            {loading ? (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                Yükleniyor...
              </div>
            ) : payments.length === 0 ? (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                Bekleyen ödeme talebi bulunmuyor.
              </div>
            ) : (
              payments.map((item) => (
                <div className="admin-mini-row" key={item.id}>
                  <span
                    style={{
                      fontFamily: '"SF Mono", "Segoe UI Mono", monospace',
                      fontWeight: 700,
                      color: "white"
                    }}
                  >
                    {item.userId.slice(0, 8).toUpperCase()}
                  </span>
                  <span>{item.packageTitle}</span>
                  <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
                    {new Date(item.createdAt).toLocaleDateString("tr-TR")}
                  </span>
                  <span>
                    <span
                      className={`admin-badge ${item.status === "pending-review" ? "is-warning" : item.status === "completed" ? "is-success" : "is-muted"}`}
                    >
                      {item.status === "pending-review" ? "Onay Bekliyor" : item.status}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
