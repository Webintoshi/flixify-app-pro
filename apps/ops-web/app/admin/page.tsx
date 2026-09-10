"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { API_BASE_URL, setAdminToken } from "../../lib/api";
import { getSupabaseBrowserClient } from "../../lib/supabase";

export default function AdminEntryPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.accessToken);
        router.push("/admin/dashboard");
        return;
      }

      if (res.status === 401 || res.status === 400) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Giriş başarısız.");
      }

      const supabase = getSupabaseBrowserClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError || !data.session?.access_token) {
        throw signInError ?? new Error("Admin oturumu olusturulamadi.");
      }

      setAdminToken(data.session.access_token);
      router.push("/admin/dashboard");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Giris basarisiz.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-stage admin-login-stage">
      <form className="auth-card admin-login-card" onSubmit={handleSubmit} style={{ maxWidth: "480px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <Image
            src="/logo/flixify-logo.png"
            alt="Flixify Pro"
            width={160}
            height={42}
            priority
            style={{ height: "40px", width: "auto", objectFit: "contain" }}
          />
          <span className="brand-badge" style={{ fontSize: "0.75rem", padding: "4px 8px", borderRadius: "8px" }}>Admin</span>
        </div>

        <h1 className="auth-title" style={{ fontSize: "2rem" }}>Yönetici Girişi</h1>
        <p className="auth-subtitle" style={{ fontSize: "0.95rem" }}>
          Bu alan yalnızca yetkili yöneticiler içindir. Sistem yönetim ve operasyon araçlarına erişim sağlar.
        </p>

        <div className="auth-input-wrap admin-login-fields" style={{ width: "100%", gap: "16px" }}>
          <label className="field admin-field" style={{ display: "grid", gap: "6px", textAlign: "left" }}>
            <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>E-posta Adresi</span>
            <input
              className="auth-input admin-text-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              placeholder="admin@flixify.vip"
              style={{
                textAlign: "left",
                minHeight: "52px",
                fontSize: "1rem",
                padding: "12px 16px",
                borderRadius: "14px",
                letterSpacing: "normal"
              }}
            />
          </label>

          <label className="field admin-field" style={{ display: "grid", gap: "6px", textAlign: "left" }}>
            <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>Yönetici Şifresi</span>
            <input
              className="auth-input admin-text-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••••••"
              style={{
                textAlign: "left",
                minHeight: "52px",
                fontSize: "1rem",
                padding: "12px 16px",
                borderRadius: "14px",
                letterSpacing: "normal"
              }}
            />
          </label>
        </div>

        {error ? <div className="auth-error" style={{ width: "100%" }}>✕ {error}</div> : null}

        <button
          className="button auth-submit"
          type="submit"
          disabled={loading}
          style={{ width: "100%", minHeight: "54px", borderRadius: "14px", fontSize: "1.05rem" }}
        >
          {loading ? "Giriş yapılıyor..." : "Admin Girişi Yap"}
        </button>
      </form>
    </main>
  );
}
