"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAdminToken } from "../../lib/api";
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
      <form className="auth-card admin-login-card" onSubmit={handleSubmit}>
        <span className="auth-code-label">Admin</span>
        <h1 className="auth-title">Admin Paneli Girişi</h1>
        <p className="auth-subtitle">
          Bu alan yalnizca yetkili yoneticiler icindir. Kullanici oturumu bu panele erisim saglamaz.
        </p>

        <div className="auth-input-wrap admin-login-fields">
          <label className="field admin-field">
            <span>E-posta</span>
            <input
              className="auth-input admin-text-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </label>

          <label className="field admin-field">
            <span>Sifre</span>
            <input
              className="auth-input admin-text-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}

        <button className="button auth-submit" type="submit" disabled={loading}>
          {loading ? "Giris yapiliyor..." : "Admin Girisi Yap"}
        </button>
      </form>
    </main>
  );
}
