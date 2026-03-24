"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "../../lib/api";

type RegisterResponse = {
  kryptoniteCode: string | null;
};

const authPrefillCodeKey = "flixify-auth-prefill-code";

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "İşlem tamamlanamadı.";
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

function formatCodeBlocks(value: string) {
  const sanitized = normalizeCode(value);
  if (!sanitized) return "---- ---- ---- ----";
  const groups = sanitized.match(/.{1,4}/g);
  return groups ? groups.join(" ") : sanitized;
}

function downloadCodeAsText(code: string) {
  if (typeof document === "undefined") return;
  const normalized = normalizeCode(code);
  if (!normalized) return;

  const blob = new Blob(
    [
      "Flixify Pro - Hesap Bilgileri\n",
      "=============================\n\n",
      `Erişim Kodu: ${formatCodeBlocks(normalized)}\n`,
      `Kısa Kod: ${normalized.slice(-4)}\n\n`,
      "Bu kodu güvenli bir yerde saklayın.\n",
      `Oluşturulma Tarihi: ${new Date().toLocaleDateString("tr-TR")}\n`
    ],
    { type: "text/plain;charset=utf-8" }
  );

  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `flixify-hesap-${normalized.slice(-4)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

// Icons
function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [issuedCode, setIssuedCode] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const [displayCode, setDisplayCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // More realistic code generation animation
  useEffect(() => {
    if (!issuedCode) {
      setDisplayCode("");
      setRevealedCount(0);
      return;
    }

    setIsGenerating(true);
    setRevealedCount(0);
    setCopied(false);
    setAcknowledged(false);

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let currentIndex = 0;
    const codeLength = issuedCode.length;
    
    // Initial scramble phase
    const scrambleInterval = setInterval(() => {
      let tempCode = "";
      for (let i = 0; i < codeLength; i++) {
        if (i < currentIndex) {
          tempCode += issuedCode[i];
        } else {
          tempCode += chars[Math.floor(Math.random() * chars.length)];
        }
      }
      setDisplayCode(tempCode);
    }, 50);

    // Reveal characters one by one with varying speed
    const revealNextChar = () => {
      if (currentIndex >= codeLength) {
        clearInterval(scrambleInterval);
        setDisplayCode(issuedCode);
        setIsGenerating(false);
        return;
      }

      currentIndex++;
      setRevealedCount(currentIndex);
      
      // Varying speed for more realistic effect
      const delay = 80 + Math.random() * 120;
      setTimeout(revealNextChar, delay);
    };

    // Start revealing after a brief delay
    setTimeout(() => {
      revealNextChar();
    }, 300);

    return () => {
      clearInterval(scrambleInterval);
    };
  }, [issuedCode]);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    setIssuedCode("");

    try {
      const response = await apiRequest<RegisterResponse>("/auth/register-anon", {
        method: "POST",
        body: {
          deviceName: "Flixify Public Web",
          platform: "web"
        }
      });
      const normalized = normalizeCode(response.kryptoniteCode ?? "");
      if (!normalized) {
        throw new Error("Kod oluşturulamadı.");
      }

      setIssuedCode(normalized);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!issuedCode || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function handleGoLogin() {
    if (!issuedCode || !acknowledged || typeof window === "undefined") return;
    window.sessionStorage.setItem(authPrefillCodeKey, issuedCode);
    router.push("/giris-yap");
  }

  const progressPercent = issuedCode ? (revealedCount / issuedCode.length) * 100 : 0;
  const isComplete = issuedCode && !isGenerating && revealedCount === issuedCode.length;

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
        <p className="login-subtitle">
          {!issuedCode ? "Yeni bir hesap oluşturun" : "Hesabınız oluşturuldu!"}
        </p>

        {/* Main Content */}
        <div className="login-form">
          {!issuedCode ? (
            // Initial State - Create Account Button
            <>
              <div className="register-intro">
                <p className="register-description">
                  Tek kullanımlık erişim kodunuzu oluşturun. Bu kod ile tüm içeriklere erişebilirsiniz.
                </p>
              </div>

              <button 
                className="login-submit" 
                type="button" 
                onClick={() => void handleRegister()} 
                disabled={loading}
              >
                {loading ? (
                  <span className="button-loading">
                    <span className="loading-spinner" />
                    Kod Üretiliyor...
                  </span>
                ) : (
                  "Hesap Numarası Oluştur"
                )}
              </button>
            </>
          ) : (
            // Code Generated State
            <>
              {/* Code Display Box */}
              <div className={`code-display-box ${isGenerating ? "generating" : ""} ${isComplete ? "complete" : ""}`}>
                <div className="code-display-header">
                  <span className="code-label">Erişim Kodunuz</span>
                  {isComplete && (
                    <span className="code-status-badge success">
                      <CheckIcon />
                      Hazır
                    </span>
                  )}
                  {isGenerating && (
                    <span className="code-status-badge generating">
                      <span className="pulse-dot" />
                      Üretiliyor
                    </span>
                  )}
                </div>

                <div className="code-display-value">
                  {formatCodeBlocks(displayCode)}
                </div>

                {/* Progress Bar */}
                <div className="code-progress-container">
                  <div className="code-progress-bar">
                    <div 
                      className="code-progress-fill" 
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="code-progress-text">{revealedCount}/16</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="code-actions">
                <button
                  className={`code-action-btn ${copied ? "success" : ""}`}
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!isComplete}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
                
                <button
                  className="code-action-btn"
                  type="button"
                  onClick={() => downloadCodeAsText(issuedCode)}
                  disabled={!isComplete}
                >
                  <DownloadIcon />
                  İndir
                </button>
              </div>

              {/* Warning Box */}
              <div className={`warning-box ${isComplete ? "active" : ""}`}>
                <div className="warning-icon">
                  <ShieldIcon />
                </div>
                <div className="warning-content">
                  <strong>Önemli!</strong>
                  <p>Bu kodu kaybetmeyin. Kodunuzu kaybederseniz hesabınıza erişemezsiniz.</p>
                </div>
              </div>

              {/* Acknowledgment Checkbox */}
              <label className={`acknowledgment-row ${isComplete ? "enabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={!isComplete}
                />
                <span className="checkmark" />
                <span className="acknowledgment-text">
                  Hesap numaramı kaydettiğimi onaylıyorum
                </span>
              </label>

              {/* Login Button */}
              <button
                className="login-submit"
                type="button"
                disabled={!isComplete || !acknowledged}
                onClick={handleGoLogin}
              >
                Oturum Aç
              </button>
            </>
          )}

          {/* Error Message */}
          {error ? <div className="login-error">{error}</div> : null}
        </div>

        {/* Links */}
        <div className="login-links">
          <p className="login-register-link">
            Zaten hesabınız var mı? <Link href="/giris-yap">Giriş Yapın</Link>
          </p>
          <Link href="/" className="login-back-link">
            <ArrowLeftIcon />
            Ana Sayfaya Dön
          </Link>
        </div>

        {/* Feature Cards - Different from login page */}
        <div className="login-features">
          <div className="login-feature-card">
            <div className="login-feature-icon highlight">
              <KeyIcon />
            </div>
            <strong>Anonim</strong>
            <span>Kayıt gerekmez</span>
          </div>
          <div className="login-feature-card">
            <div className="login-feature-icon highlight">
              <SparklesIcon />
            </div>
            <strong>Anında</strong>
            <span>Hemen kullanıma hazır</span>
          </div>
          <div className="login-feature-card">
            <div className="login-feature-icon highlight">
              <ShieldIcon />
            </div>
            <strong>Güvenli</strong>
            <span>Şifreli erişim</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="login-footer">
          <p>© 2026 Flixify Pro. Tüm hakları saklıdır.</p>
        </footer>
      </main>
    </div>
  );
}
