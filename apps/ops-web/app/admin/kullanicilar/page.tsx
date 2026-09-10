"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";

type AdminUserRow = {
  id: string;
  status: "new" | "active" | "blocked";
  kryptoniteCode: string | null;
  codeSuffix: string | null;
  notes: string | null;
  deletedAt: string | null;
  hasAssignedLink: boolean;
  hasActiveSubscription: boolean;
  activePackage: {
    duration: "1m" | "3m" | "6m" | "12m";
    endsAt: string;
    remainingDays: number;
  } | null;
  subscriptionEndsAt: string | null;
  remainingDays: number | null;
  packageStatus: "active" | "expired" | "none";
  m3uAssigned: boolean;
  currentSourceStatus: string | null;
};

type AdminUserDetail = {
  summary: AdminUserRow;
  currentSourceStatus: string | null;
  currentSourceUrl: string | null;
  iptvUsername?: string | null;
  iptvPassword?: string | null;
  snapshotVersion: number;
};

type StatusFilter = "all" | "new" | "active" | "blocked" | "deleted";
type M3UFilter = "all" | "assigned" | "unassigned";
type PackageSlug = "1-ay" | "3-ay" | "6-ay" | "12-ay";

const packageOptions: Array<{
  slug: PackageSlug;
  title: string;
  subtitle: string;
  days: number;
  accentClass: string;
  badge: string | null;
}> = [
  { slug: "1-ay", title: "30 Gün", subtitle: "1 Aylık kullanım", days: 30, accentClass: "is-blue", badge: null },
  { slug: "3-ay", title: "90 Gün", subtitle: "3 Aylık kullanım", days: 90, accentClass: "is-purple", badge: "Popüler" },
  { slug: "6-ay", title: "180 Gün", subtitle: "6 Aylık kullanım", days: 180, accentClass: "is-amber", badge: null },
  { slug: "12-ay", title: "365 Gün", subtitle: "1 Yıllık kullanım", days: 365, accentClass: "is-green", badge: "En İyi" }
];

function getCodeLabel(user: Pick<AdminUserRow, "kryptoniteCode" | "codeSuffix" | "id">) {
  if (user.kryptoniteCode) {
    return user.kryptoniteCode;
  }

  if (user.codeSuffix) {
    return `Kod kaydı eksik (${user.codeSuffix})`;
  }

  return user.id.slice(0, 8).toUpperCase();
}

function getStatusFilterParams(statusFilter: StatusFilter) {
  if (statusFilter === "all") {
    return "";
  }
  return `&status=${statusFilter}`;
}

function getM3UFilterParams(m3uFilter: M3UFilter) {
  if (m3uFilter === "all") {
    return "";
  }
  return `&m3u=${m3uFilter}`;
}

function getPackageLabel(user: AdminUserRow) {
  if (user.deletedAt) {
    return "Silinmiş";
  }
  if (user.activePackage) {
    return "Aktif";
  }
  return "Süresi Dolmuş";
}

function getPackageSlug(user: AdminUserRow): PackageSlug {
  switch (user.activePackage?.duration) {
    case "3m":
      return "3-ay";
    case "6m":
      return "6-ay";
    case "12m":
      return "12-ay";
    default:
      return "1-ay";
  }
}

function calculatePreviewDate(packageSlug: PackageSlug) {
  const days = packageOptions.find((item) => item.slug === packageSlug)?.days ?? 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString("tr-TR");
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [m3uFilter, setM3UFilter] = useState<M3UFilter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigningUser, setAssigningUser] = useState<AdminUserDetail | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [iptvUsername, setIptvUsername] = useState("");
  const [iptvPassword, setIptvPassword] = useState("");
  const [selectedPackageSlug, setSelectedPackageSlug] = useState<PackageSlug>("1-ay");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<"new" | "active" | "blocked">("new");
  const [submitting, setSubmitting] = useState(false);

  const counters = useMemo(
    () => ({
      total: users.filter((item) => !item.deletedAt).length,
      active: users.filter((item) => item.packageStatus === "active" && !item.deletedAt).length,
      waitingM3u: users.filter((item) => !item.m3uAssigned && !item.deletedAt).length,
      expired: users.filter((item) => item.packageStatus !== "active" && !item.deletedAt).length
    }),
    [users]
  );

  async function loadUsers() {
    const query = `/admin/users?page=1&pageSize=100&search=${encodeURIComponent(search)}${getStatusFilterParams(statusFilter)}${getM3UFilterParams(m3uFilter)}`;
    const response = await apiRequest<{ items: AdminUserRow[] }>(query, { useAdminToken: true });
    setUsers(response.items);
  }

  async function loadUserDetail(userId: string) {
    return apiRequest<AdminUserDetail>(`/admin/users/${userId}`, {
      useAdminToken: true
    });
  }

  useEffect(() => {
    loadUsers()
      .then(() => {
        setError(null);
      })
      .catch(() => setError("Kullanıcılar yüklenemedi."));
  }, [search, statusFilter, m3uFilter]);

  async function openAssignModal(user: AdminUserRow) {
    const detail = await loadUserDetail(user.id);
    setAssigningUser(detail);
    setIptvUsername(detail.iptvUsername ?? "");
    setIptvPassword(detail.iptvPassword ?? "");
    setSelectedPackageSlug(getPackageSlug(detail.summary));
    setMessage(null);
  }

  function openEditModal(user: AdminUserRow) {
    setEditingUser(user);
    setEditNotes(user.notes ?? "");
    setEditStatus(user.status);
    setMessage(null);
  }

  async function handleAssignmentSave() {
    if (!assigningUser) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest(`/admin/users/${assigningUser.summary.id}/m3u-source`, {
        method: "POST",
        body: {
          username: iptvUsername.trim(),
          password: iptvPassword.trim()
        },
        useAdminToken: true
      });

      await apiRequest(`/admin/users/${assigningUser.summary.id}/subscriptions`, {
        method: "POST",
        body: { packageSlug: selectedPackageSlug },
        useAdminToken: true
      });

      setAssigningUser(null);
      setIptvUsername("");
      setIptvPassword("");
      setMessage("Kullanıcıya IPTV bilgileri ve paket başarıyla tanımlandı.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kayıt tamamlanamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssign24HourTest() {
    if (!assigningUser) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest(`/admin/users/${assigningUser.summary.id}/m3u-source`, {
        method: "POST",
        body: {
          username: iptvUsername.trim(),
          password: iptvPassword.trim()
        },
        useAdminToken: true
      });

      await apiRequest(`/admin/users/${assigningUser.summary.id}/subscriptions/test-24h`, {
        method: "POST",
        useAdminToken: true
      });

      setAssigningUser(null);
      setIptvUsername("");
      setIptvPassword("");
      setMessage("Kullanıcıya 24 saatlik test yayını başarıyla tanımlandı.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "24 saat test tanımlanamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditSave() {
    if (!editingUser) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest(`/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: {
          notes: editNotes.trim() ? editNotes.trim() : null,
          status: editStatus
        },
        useAdminToken: true
      });

      setEditingUser(null);
      setMessage("Kullanıcı bilgileri güncellendi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kullanıcı güncellenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(user: AdminUserRow) {
    const confirmed = window.confirm("Bu kullanıcı sistemden kaldırılacak. Devam etmek istiyor musunuz?");
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: "DELETE",
        useAdminToken: true
      });
      setMessage("Kullanıcı başarıyla silindi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kullanıcı silinemedi.");
    }
  }

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Kullanıcılar</h1>
          <p>Kullanıcıları, IPTV bağlantılarını ve abonelik sürelerini tek ekrandan yönetin.</p>
        </div>
      </section>

      <section className="admin-stats-grid">
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-total" aria-hidden="true"><use href="/icons/admin-icons.svg#users-total"/></svg>
            Toplam Kullanıcı
          </span>
          <strong>{counters.total}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: '100%' }} />
          </div>
          <span className="admin-stat-note">Listelenen hesaplar</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-active" aria-hidden="true"><use href="/icons/admin-icons.svg#users-active"/></svg>
            Aktif
          </span>
          <strong>{counters.active}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: `${counters.total > 0 ? (counters.active / counters.total) * 100 : 0}%` }} />
          </div>
          <span className="admin-stat-note">Paket süresi aktif</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-waiting" aria-hidden="true"><use href="/icons/admin-icons.svg#users-waiting"/></svg>
            M3U Bekleyen
          </span>
          <strong>{counters.waitingM3u}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: `${counters.total > 0 ? (counters.waitingM3u / counters.total) * 100 : 0}%` }} />
          </div>
          <span className="admin-stat-note">Link tanımlanmamış</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">
            <svg className="stat-icon stat-icon-expired" aria-hidden="true"><use href="/icons/admin-icons.svg#users-expired"/></svg>
            Süresi Dolmuş
          </span>
          <strong>{counters.expired}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: `${counters.total > 0 ? (counters.expired / counters.total) * 100 : 0}%` }} />
          </div>
          <span className="admin-stat-note">Yenileme bekleyen hesap</span>
        </article>
      </section>

      <section className="admin-section-card">
        <div className="admin-toolbar">
          <label className="field admin-filter-field">
            <span>Ara</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kod veya not ile ara"
            />
          </label>

          <label className="field admin-filter-field">
            <span>Durum</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">Tümü</option>
              <option value="active">Aktif</option>
              <option value="new">Bekleyen</option>
              <option value="blocked">Bloklu</option>
              <option value="deleted">Silinmiş</option>
            </select>
          </label>

          <label className="field admin-filter-field">
            <span>M3U</span>
            <select value={m3uFilter} onChange={(event) => setM3UFilter(event.target.value as M3UFilter)}>
              <option value="all">Tümü</option>
              <option value="assigned">Tanımlı</option>
              <option value="unassigned">Tanımsız</option>
            </select>
          </label>
        </div>

        {message ? <div className="admin-inline-message">{message}</div> : null}
        {error ? <div className="auth-error">{error}</div> : null}

        <div className="admin-users-table">
          <div className="admin-users-head">
            <span>Kod</span>
            <span>Bitiş</span>
            <span>Kalan</span>
            <span>Paket</span>
            <span>M3U</span>
            <span>Aksiyonlar</span>
          </div>

          {users.length === 0 ? (
            <div style={{ 
              padding: '60px 20px', 
              textAlign: 'center', 
              color: 'rgba(255,255,255,0.5)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px'
            }}>
              <div style={{ fontSize: '3rem', opacity: 0.5 }}>📭</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Kullanıcı bulunamadı</div>
              <div style={{ fontSize: '0.95rem' }}>Arama kriterlerinizi değiştirin veya filtreleri temizleyin</div>
            </div>
          ) : users.map((user) => {
            const primaryLabel = user.m3uAssigned || user.hasActiveSubscription ? "Yenile" : "Tanımla";
            return (
              <article className="admin-user-row" key={user.id}>
                <div className="admin-user-cell admin-user-code" title={user.notes ?? "Anonymous User"}>{getCodeLabel(user)}</div>
                <div className="admin-user-cell">
                  {user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt).toLocaleDateString("tr-TR") : "-"}
                </div>
                <div className="admin-user-cell admin-user-remaining" style={{ 
                  color: user.remainingDays !== null && user.remainingDays < 0 ? '#ff6d76' : 
                         user.remainingDays !== null && user.remainingDays < 7 ? '#ffc94d' : 
                         user.remainingDays !== null ? '#2ee59e' : 'inherit'
                }}>
                  {user.remainingDays !== null ? `${user.remainingDays} gün` : "-"}
                </div>
                <div className="admin-user-cell">
                  <span className={`admin-badge ${user.packageStatus === "active" ? "is-success" : "is-danger"}`}>
                    {getPackageLabel(user)}
                  </span>
                </div>
                <div className="admin-user-cell">
                  {user.m3uAssigned ? (
                    <span className="admin-badge is-success">Tanımlı</span>
                  ) : (
                    <span className="admin-badge is-muted">-</span>
                  )}
                </div>
                <div className="admin-user-cell admin-user-actions">
                  <button className={`button admin-primary-action ${primaryLabel === "Yenile" ? "secondary" : ""}`} type="button" onClick={() => void openAssignModal(user)}>
                    <svg className="icon-btn-svg" aria-hidden="true"><use href="/icons/admin-icons.svg#action-assign"/></svg>
                    {primaryLabel}
                  </button>
                  <button className="icon-button admin-row-icon icon-btn-edit" type="button" onClick={() => openEditModal(user)} title="Düzenle">
                    <svg className="icon" aria-hidden="true"><use href="/icons/admin-icons.svg#action-edit"/></svg>
                  </button>
                  <button className="icon-button admin-row-icon icon-btn-delete" type="button" onClick={() => void handleDelete(user)} title="Sil">
                    <svg className="icon" aria-hidden="true"><use href="/icons/admin-icons.svg#action-delete"/></svg>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {assigningUser ? (
        <div className="admin-modal-backdrop" onClick={() => setAssigningUser(null)}>
          <section className="admin-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-heading">
              <div>
                <h2>IPTV Atama & Paket Tanımlama</h2>
                <strong>{getCodeLabel(assigningUser.summary)}</strong>
              </div>
              <button className="admin-modal-close" onClick={() => setAssigningUser(null)} aria-label="Kapat">
                <svg className="icon" aria-hidden="true"><use href="/icons/admin-icons.svg#close"/></svg>
              </button>
            </div>

            <div className="admin-inline-message admin-info-box">
              <svg className="icon-inline icon-lg" aria-hidden="true"><use href="/icons/admin-icons.svg#info"/></svg>
              <span>Ortak playlist kaynağı tüm kullanıcılar için tektir. Burada sadece kullanıcıya ait IPTV kullanıcı adı ve şifre tanımlanır.</span>
            </div>

            <div className="admin-package-grid">
              {packageOptions.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`admin-package-card ${item.accentClass}${selectedPackageSlug === item.slug ? " is-selected" : ""}`}
                  onClick={() => setSelectedPackageSlug(item.slug)}
                >
                  {item.badge ? <span className="admin-package-badge">{item.badge}</span> : null}
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </button>
              ))}
            </div>

            <div className="admin-expiry-preview">
              <div>
                <span>Yeni Bitiş Tarihi:</span>
                <small>Bugünden itibaren yeni süre uygulanacak</small>
              </div>
              <strong>{calculatePreviewDate(selectedPackageSlug)}</strong>
            </div>

            <label className="field">
              <span>IPTV Kullanıcı Adı</span>
              <input
                value={iptvUsername}
                onChange={(event) => setIptvUsername(event.target.value)}
                placeholder="Örn: H6mwDgP9em"
              />
            </label>

            <label className="field">
              <span>IPTV Şifre</span>
              <input
                value={iptvPassword}
                onChange={(event) => setIptvPassword(event.target.value)}
                placeholder="Örn: rEFqxGUvJR"
              />
            </label>

            {assigningUser.currentSourceUrl ? (
              <div className="muted">Playlist önizleme: {assigningUser.currentSourceUrl}</div>
            ) : (
              <div className="muted">Ortak playlist kaynağını önce /admin/ayarlar ekranından tanımlayın.</div>
            )}

            <div className="admin-modal-actions">
              <button className="button secondary" type="button" onClick={() => setAssigningUser(null)}>
                İptal
              </button>
              <button className="button secondary" type="button" disabled={submitting} onClick={() => void handleAssign24HourTest()}>
                {submitting ? "Tanımlanıyor..." : "24 Saat Test Ver"}
              </button>
              <button className="button" type="button" disabled={submitting} onClick={() => void handleAssignmentSave()}>
                {submitting ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingUser ? (
        <div className="admin-modal-backdrop" onClick={() => setEditingUser(null)}>
          <section className="admin-modal-card admin-edit-card" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-heading">
              <div>
                <h2>Kullanıcıyı Düzenle</h2>
                <strong>{getCodeLabel(editingUser)}</strong>
              </div>
              <button className="admin-modal-close" onClick={() => setEditingUser(null)} aria-label="Kapat">
                <svg className="icon" aria-hidden="true"><use href="/icons/admin-icons.svg#close"/></svg>
              </button>
            </div>

            <label className="field">
              <span>Yönetici Notu</span>
              <textarea
                rows={4}
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                placeholder="Kullanıcıyı tanımlayan veya müşteri ile ilgili not..."
              />
            </label>

            <label className="field">
              <span>Hesap Durumu</span>
              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as "new" | "active" | "blocked")}>
                <option value="new">Yeni (Bekleyen)</option>
                <option value="active">Aktif</option>
                <option value="blocked">Bloklu</option>
              </select>
            </label>

            <div className="admin-modal-actions">
              <button className="button secondary" type="button" onClick={() => setEditingUser(null)}>
                İptal
              </button>
              <button className="button" type="button" disabled={submitting} onClick={() => void handleEditSave()}>
                {submitting ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
