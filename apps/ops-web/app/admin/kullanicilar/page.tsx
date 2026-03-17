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
  { slug: "1-ay", title: "30 Gun", subtitle: "1 Aylik kullanim", days: 30, accentClass: "is-blue", badge: null },
  { slug: "3-ay", title: "90 Gun", subtitle: "3 Aylik kullanim", days: 90, accentClass: "is-purple", badge: "Populer" },
  { slug: "6-ay", title: "180 Gun", subtitle: "6 Aylik kullanim", days: 180, accentClass: "is-amber", badge: null },
  { slug: "12-ay", title: "365 Gun", subtitle: "1 Yillik kullanim", days: 365, accentClass: "is-green", badge: "En Iyi" }
];

function getCodeLabel(user: Pick<AdminUserRow, "kryptoniteCode" | "codeSuffix" | "id">) {
  if (user.kryptoniteCode) {
    return user.kryptoniteCode;
  }

  if (user.codeSuffix) {
    return `Kod kaydi eksik (${user.codeSuffix})`;
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
    return "Silinmis";
  }
  if (user.activePackage) {
    return "Aktif";
  }
  return "Suresi Dolmus";
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
      .catch(() => setError("Kullanicilar yuklenemedi."));
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
      setMessage("Kullaniciya IPTV credential ve paket tanimlandi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kayit tamamlanamadi.");
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
      setMessage("Kullaniciya 24 saat test yayini tanimlandi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "24 saat test tanimlanamadi.");
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
      setMessage("Kullanici guncellendi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kullanici guncellenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(user: AdminUserRow) {
    const confirmed = window.confirm("Bu kullanici soft-delete olarak kaldirilacak. Devam edilsin mi?");
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: "DELETE",
        useAdminToken: true
      });
      setMessage("Kullanici silinmis olarak isaretlendi.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kullanici silinemedi.");
    }
  }

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Kullanicilar</h1>
          <p>Kullanicilari, IPTV kullanici bilgilerini ve sure yenilemelerini tek ekrandan yonet.</p>
        </div>
      </section>

      <section className="admin-stats-grid">
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">📊 Toplam Kullanici</span>
          <strong>{counters.total}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: '100%' }} />
          </div>
          <span className="admin-stat-note">Listelenen hesaplar</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">✅ Aktif</span>
          <strong>{counters.active}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: `${counters.total > 0 ? (counters.active / counters.total) * 100 : 0}%` }} />
          </div>
          <span className="admin-stat-note">Paket suresi aktif</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">⏳ M3U Bekleyen</span>
          <strong>{counters.waitingM3u}</strong>
          <div className="admin-stat-progress">
            <div className="admin-stat-progress-fill" style={{ width: `${counters.total > 0 ? (counters.waitingM3u / counters.total) * 100 : 0}%` }} />
          </div>
          <span className="admin-stat-note">Link tanimlanmamis</span>
        </article>
        <article className="admin-stat-card">
          <span className="admin-stat-kicker">⚠️ Suresi Dolmus</span>
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
              <option value="all">Tumu</option>
              <option value="active">Aktif</option>
              <option value="new">Bekleyen</option>
              <option value="blocked">Bloklu</option>
              <option value="deleted">Silinmis</option>
            </select>
          </label>

          <label className="field admin-filter-field">
            <span>M3U</span>
            <select value={m3uFilter} onChange={(event) => setM3UFilter(event.target.value as M3UFilter)}>
              <option value="all">Tumu</option>
              <option value="assigned">Tanimli</option>
              <option value="unassigned">Tanimsiz</option>
            </select>
          </label>
        </div>

        {message ? <div className="admin-inline-message">{message}</div> : null}
        {error ? <div className="auth-error">{error}</div> : null}

        <div className="admin-users-table">
          <div className="admin-users-head">
            <span>🔑 Kod</span>
            <span>📅 Bitis</span>
            <span>⏱️ Kalan</span>
            <span>📦 Paket</span>
            <span>🔗 M3U</span>
            <span>⚡ Aksiyonlar</span>
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
              <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Kullanici bulunamadi</div>
              <div style={{ fontSize: '0.95rem' }}>Arama kriterlerinizi degistirin veya filtreleri temizleyin</div>
            </div>
          ) : users.map((user) => {
            const primaryLabel = user.m3uAssigned || user.hasActiveSubscription ? "Yenile" : "Tanimla";
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
                  {user.remainingDays !== null ? `${user.remainingDays} gun` : "-"}
                </div>
                <div className="admin-user-cell">
                  <span className={`admin-badge ${user.packageStatus === "active" ? "is-success" : "is-danger"}`}>
                    {getPackageLabel(user)}
                  </span>
                </div>
                <div className="admin-user-cell">
                  {user.m3uAssigned ? (
                    <span className="admin-badge is-success">Tanimli</span>
                  ) : (
                    <span className="admin-badge is-muted">-</span>
                  )}
                </div>
                <div className="admin-user-cell admin-user-actions">
                  <button className={`button admin-primary-action ${primaryLabel === "Yenile" ? "secondary" : ""}`} type="button" onClick={() => void openAssignModal(user)}>
                    {primaryLabel}
                  </button>
                  <button className="icon-button admin-row-icon" type="button" onClick={() => openEditModal(user)} title="Düzenle">
                    ✏️
                  </button>
                  <button className="icon-button admin-row-icon" type="button" onClick={() => void handleDelete(user)} title="Sil">
                    🗑️
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
                <h2>IPTV Atama</h2>
                <strong>{getCodeLabel(assigningUser.summary)}</strong>
              </div>
              <button className="admin-modal-close" onClick={() => setAssigningUser(null)}>×</button>
            </div>

            <div className="admin-inline-message">
              Ortak playlist kaynagi tum kullanicilar icin tektir. Burada sadece kullaniciya ait IPTV kullanici adi ve sifre tanimlanir.
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
                <span>Yeni Bitis Tarihi:</span>
                <small>Bugunden itibaren yeni sure uygulanacak</small>
              </div>
              <strong>{calculatePreviewDate(selectedPackageSlug)}</strong>
            </div>

            <label className="field">
              <span>IPTV Kullanici Adi</span>
              <input
                value={iptvUsername}
                onChange={(event) => setIptvUsername(event.target.value)}
                placeholder="H6mwDgP9em"
              />
            </label>

            <label className="field">
              <span>IPTV Sifre</span>
              <input
                value={iptvPassword}
                onChange={(event) => setIptvPassword(event.target.value)}
                placeholder="rEFqxGUvJR"
              />
            </label>

            {assigningUser.currentSourceUrl ? (
              <div className="muted">Playlist onizleme: {assigningUser.currentSourceUrl}</div>
            ) : (
              <div className="muted">Ortak playlist kaynagini once `/admin/ayarlar` ekranindan tanimla.</div>
            )}

            <div className="admin-modal-actions">
              <button className="button secondary" type="button" onClick={() => setAssigningUser(null)}>
                Iptal
              </button>
              <button className="button secondary" type="button" disabled={submitting} onClick={() => void handleAssign24HourTest()}>
                {submitting ? "Test Tanimlaniyor..." : "24 Saat Test Ver"}
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
                <h2>Kullaniciyi Duzenle</h2>
                <strong>{getCodeLabel(editingUser)}</strong>
              </div>
              <button className="admin-modal-close" onClick={() => setEditingUser(null)}>×</button>
            </div>

            <label className="field">
              <span>Not</span>
              <textarea
                rows={4}
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                placeholder="Kullaniciyi tanimlayan not"
              />
            </label>

            <label className="field">
              <span>Durum</span>
              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as "new" | "active" | "blocked")}>
                <option value="new">Yeni</option>
                <option value="active">Aktif</option>
                <option value="blocked">Bloklu</option>
              </select>
            </label>

            <div className="admin-modal-actions">
              <button className="button secondary" type="button" onClick={() => setEditingUser(null)}>
                Iptal
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
