"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  kryptoniteCode: string | null;
  user: {
    status: "new" | "active" | "blocked";
    hasAssignedLink: boolean;
    hasActiveSubscription: boolean;
    activePackage: {
      title: string;
      remainingDays: number;
    } | null;
  };
};

type PublicSettingsResponse = {
  supportWhatsappUrl: string;
};

const storageKey = "flixify-public-session";
const authPrefillCodeKey = "flixify-auth-prefill-code";
const installationIdStorageKey = "flixify-installation-id";
const fallbackWhatsappUrl =
  process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ??
  process.env.PUBLIC_SUPPORT_WHATSAPP ??
  "https://wa.me/900000000000";

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Giriş başarısız.";
  }

  try {
    const parsed = JSON.parse(error.message) as { message?: string };
    return parsed.message ?? error.message;
  } catch {
    return error.message;
  }
}

function normalizeCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
}

function formatCodeDisplay(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
  const parts = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    parts.push(cleaned.slice(i, i + 4));
  }
  return parts.join(" ");
}

function getInstallationId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const existing = window.localStorage.getItem(installationIdStorageKey)?.trim();
  if (existing) {
    return existing;
  }

  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

  window.localStorage.setItem(installationIdStorageKey, nextId);
  return nextId;
}

// Eye icon component - crossed out when code is visible (click to hide)
function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {visible ? (
        // Crossed out eye (code is visible, click to hide)
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      ) : (
        // Normal eye (code is hidden, click to show)
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// Lock icon
function LockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// Zap icon
function ZapIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

// Smartphone icon
function SmartphoneIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

// Arrow left icon
function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [premiumDismissed, setPremiumDismissed] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialMessage, setTrialMessage] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState(fallbackWhatsappUrl);

  useEffect(() => {
    let cancelled = false;

    apiRequest<PublicSettingsResponse>("/settings/public")
      .then((settings) => {
        if (cancelled || !settings.supportWhatsappUrl) {
          return;
        }
        setWhatsappUrl(settings.supportWhatsappUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const prefill = normalizeCode(window.sessionStorage.getItem(authPrefillCodeKey) ?? "");
    window.sessionStorage.removeItem(authPrefillCodeKey);
    if (prefill) {
      setCode(prefill);
    }
  }, []);

  useEffect(() => {
    if (!session?.user.hasActiveSubscription) {
      return;
    }

    router.replace("/");
  }, [router, session]);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    setTrialMessage(null);
    setPremiumDismissed(false);

    try {
      const response = await apiRequest<LoginResponse>("/auth/login-by-code", {
        method: "POST",
        body: {
          code: normalizeCode(code),
          deviceName: "Flixify Public Web",
          platform: "web",
          installationId: getInstallationId()
        }
      });

      setSession(response);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(response));
      }
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleTrialRequest() {
    if (!session) {
      return;
    }

    setTrialLoading(true);
    setTrialMessage(null);

    try {
      await apiRequest<{ ok: true }>("/me/trial-request", {
        method: "POST",
        accessToken: session.accessToken,
        body: {
          note: "ops-web login sonrası test talebi"
        }
      });
      setTrialMessage("Test talebiniz alındı. Destek ekibi sizinle iletişime geçecek.");
    } catch (nextError) {
      setTrialMessage(getErrorMessage(nextError));
    } finally {
      setTrialLoading(false);
    }
  }

  const normalizedCode = normalizeCode(code);
  const shouldShowPremiumModal = Boolean(session && !session.user.hasActiveSubscription && !premiumDismissed);

  // Calculate progress segments (4 segments for 16 characters)
  const progressSegments = Math.min(Math.ceil(normalizedCode.length / 4), 4);

  return (
    <div className="login-page">
      <main className="login-container">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <Image src="/logo/flixify-icon-only.svg" alt="" width={40} height={40} className="login-logo-glyph" />
          </div>
          <span className="login-logo-text">FLIXIFY</span>
          <span className="login-logo-badge">PRO</span>
        </div>

        {/* Subtitle */}
        <p className="login-subtitle">16 haneli erişim kodunuzu girin</p>

        {/* Form */}
        <div className="login-form">
          <label className="login-label">Erişim Kodu</label>
          
          <div className="login-input-wrapper">
            <input
              className="login-input"
              type={showCode ? "text" : "password"}
              value={formatCodeDisplay(code)}
              onChange={(event) => {
                // Extract only alphanumeric characters from input
                const rawValue = event.target.value.replace(/[^a-zA-Z0-9]/g, "");
                setCode(rawValue.toUpperCase().slice(0, 16));
              }}
              placeholder="X7F2 A9B1 C4D8 E6F0"
              autoComplete="off"
              maxLength={19}
            />
            <button
              type="button"
              className="login-eye-button"
              onClick={() => setShowCode(!showCode)}
              aria-label={showCode ? "Kodu gizle" : "Kodu göster"}
            >
              <EyeIcon visible={showCode} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="login-progress">
            <div className="login-progress-segments">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`login-progress-segment ${index < progressSegments ? "active" : ""}`}
                />
              ))}
            </div>
            <span className="login-char-count">{normalizedCode.length}/16</span>
          </div>

          {/* Error message */}
          {error ? <div className="login-error">{error}</div> : null}

          {/* Submit button */}
          <button
            className="login-submit"
            type="button"
            onClick={() => void handleLogin()}
            disabled={loading || normalizedCode.length !== 16}
          >
            {loading ? "Giriş Yapılıyor..." : "Giriş Yap"}
          </button>
        </div>

        {/* Links */}
        <div className="login-links">
          <p className="login-register-link">
            Hesabınız yok mu? <Link href="/kayit-ol">Hesap Oluştur</Link>
          </p>
          <Link href="/" className="login-back-link">
            <ArrowLeftIcon />
            Ana Sayfaya Dön
          </Link>
        </div>

        {/* Feature cards */}
        <div className="login-features">
          <div className="login-feature-card">
            <div className="login-feature-icon">
              <LockIcon />
            </div>
            <strong>Güvenli</strong>
            <span>Şifreli erişim</span>
          </div>
          <div className="login-feature-card">
            <div className="login-feature-icon">
              <ZapIcon />
            </div>
            <strong>Hızlı</strong>
            <span>Anında yayın</span>
          </div>
          <div className="login-feature-card">
            <div className="login-feature-icon">
              <SmartphoneIcon />
            </div>
            <strong>Her Yerde</strong>
            <span>Tüm cihazlar</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="login-footer">
          <p>© 2026 Flixify Pro. Tüm hakları saklıdır.</p>
        </footer>
      </main>

      {/* Premium Modal */}
      {shouldShowPremiumModal ? (
        <section className="auth-premium-modal">
          <button
            type="button"
            className="auth-premium-close"
            onClick={() => setPremiumDismissed(true)}
            aria-label="Kapat"
          >
            ×
          </button>
          <h2>Premium Erişim</h2>
          <p>Tüm içeriklere erişmek için aktif bir paket satın alın.</p>
          <div className="auth-premium-actions">
            <button className="button" type="button" onClick={() => void handleTrialRequest()} disabled={trialLoading}>
              {trialLoading ? "Test Talebi Gönderiliyor" : "Test Yapmak İstiyorum"}
            </button>
            <a className="button secondary" href={whatsappUrl} target="_blank" rel="noreferrer">
              WhatsApp ile İletişime Geç
            </a>
            <button className="button secondary" type="button" onClick={() => router.push("/paketler")}>
              Paket Satın Al
            </button>
          </div>
          {trialMessage ? <div className="auth-premium-note">{trialMessage}</div> : null}
          <button type="button" className="auth-premium-later" onClick={() => setPremiumDismissed(true)}>
            Şimdi değil, daha sonra hatırlat
          </button>
        </section>
      ) : null}
    </div>
  );
}
