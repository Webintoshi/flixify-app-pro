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
    return `Kod kaydi eksik (${user.codeSuffix})`;
  }

  return user.id.slice(0, 8).toUpperCase();
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [recentUsers, setRecentUsers] = useState<AdminUserRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<DashboardState>("/admin/dashboard", { useAdminToken: true }),
      apiRequest<{ items: AdminUserRow[] }>("/admin/users?page=1&pageSize=5", { useAdminToken: true }),
      apiRequest<{ items: PaymentRow[] }>("/admin/payment-requests", { useAdminToken: true })
    ])
      .then(([dashboardResponse, usersResponse, paymentsResponse]) => {
        setDashboard(dashboardResponse);
        setRecentUsers(usersResponse.items);
        setPayments(paymentsResponse.items.slice(0, 5));
      })
      .catch(() => setError("Dashboard verileri yuklenemedi."));
  }, []);

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Sistem genel gorunumu</p>
        </div>
      </section>

      <section className="admin-stats-grid">
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">Toplam Kullanici</span>
          <strong>{dashboard.usersTotal}</strong>
          <span className="admin-stat-note">{dashboard.activeSubscriptions} aktif abonelik</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">M3U Bekleyen</span>
          <strong>{dashboard.usersWaitingForLink}</strong>
          <span className="admin-stat-note">Baglanti tanimlanmamis hesap</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">Bekleyen Odemeler</span>
          <strong>{dashboard.pendingPaymentRequests}</strong>
          <span className="admin-stat-note">Panel onayi bekliyor</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">Bekleyen Denemeler</span>
          <strong>{dashboard.pendingTrialRequests}</strong>
          <span className="admin-stat-note">{dashboard.usersBlocked} bloklu kullanici</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">Canli Kanal Sagligi</span>
          <strong>{dashboard.liveHealthyChannels}</strong>
          <span className="admin-stat-note">
            {dashboard.liveDegradedChannels} kararsiz • {dashboard.liveBrokenChannels} sorunlu
          </span>
        </article>
      </section>

      {error ? <section className="admin-section-card">{error}</section> : null}

      {dashboard.liveLastError ? (
        <section className="admin-section-card">
          <strong>Son canli yayin hatasi</strong>
          <p>{dashboard.liveLastError}</p>
        </section>
      ) : null}

      <section className="admin-two-column">
        <article className="admin-section-card">
          <div className="admin-section-header">
            <div>
              <h2>Son Eklenen Kullanicilar</h2>
              <p>Hesaplarin son durumunu buradan gorebilirsin.</p>
            </div>
            <Link href="/admin/kullanicilar">Tumunu Gor</Link>
          </div>

          <div className="admin-mini-table">
            <div className="admin-mini-row admin-mini-head">
              <span>Kod</span>
              <span>Paket</span>
              <span>Bitis</span>
              <span>Durum</span>
            </div>
            {recentUsers.map((item) => (
              <div className="admin-mini-row" key={item.id}>
                <span>{getCodeLabel(item)}</span>
                <span>{item.packageStatus === "active" ? "Aktif" : "Bekliyor"}</span>
                <span>{item.subscriptionEndsAt ? new Date(item.subscriptionEndsAt).toLocaleDateString("tr-TR") : "N/A"}</span>
                <span>
                  <span className={`admin-badge ${item.packageStatus === "active" ? "is-success" : "is-warning"}`}>
                    {item.packageStatus === "active" ? "Aktif" : "Bekliyor"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-section-card">
          <div className="admin-section-header">
            <div>
              <h2>Son Odemeler</h2>
              <p>Manuel onay akisini hizli gormek icin.</p>
            </div>
            <Link href="/admin/kullanicilar">Kullanicilar</Link>
          </div>

          <div className="admin-mini-table">
            <div className="admin-mini-row admin-mini-head">
              <span>Kullanici</span>
              <span>Paket</span>
              <span>Tarih</span>
              <span>Durum</span>
            </div>
            {payments.map((item) => (
              <div className="admin-mini-row" key={item.id}>
                <span>{item.userId.slice(0, 8).toUpperCase()}</span>
                <span>{item.packageTitle}</span>
                <span>{new Date(item.createdAt).toLocaleDateString("tr-TR")}</span>
                <span>
                  <span className={`admin-badge ${item.status === "pending-review" ? "is-warning" : "is-muted"}`}>
                    {item.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
