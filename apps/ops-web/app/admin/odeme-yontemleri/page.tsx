"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type PaymentMethodSettingsState = {
  bankTransferEftEnabled: boolean;
  bankTransferEftDetails: string;
  bankTransferRecipientName: string;
  bankTransferIban: string;
  bankTransferBankName: string;
  cryptoEnabled: boolean;
  cryptoDetails: string;
  cryptoWalletUsdtTrc20: string;
  cryptoWalletTron: string;
  cryptoWalletSol: string;
  cryptoWalletBtc: string;
  cryptoWalletUsdc: string;
  bankCardEnabled: boolean;
  bankCardDetails: string;
};

const initialState: PaymentMethodSettingsState = {
  bankTransferEftEnabled: true,
  bankTransferEftDetails: "",
  bankTransferRecipientName: "",
  bankTransferIban: "",
  bankTransferBankName: "",
  cryptoEnabled: true,
  cryptoDetails: "",
  cryptoWalletUsdtTrc20: "",
  cryptoWalletTron: "",
  cryptoWalletSol: "",
  cryptoWalletBtc: "",
  cryptoWalletUsdc: "",
  bankCardEnabled: true,
  bankCardDetails: ""
};

export default function AdminPaymentMethodsPage() {
  const [settings, setSettings] = useState<PaymentMethodSettingsState>(initialState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{
      bankTransferEftEnabled: boolean;
      bankTransferEftDetails: string | null;
      bankTransferRecipientName: string | null;
      bankTransferIban: string | null;
      bankTransferBankName: string | null;
      cryptoEnabled: boolean;
      cryptoDetails: string | null;
      cryptoWalletUsdtTrc20: string | null;
      cryptoWalletTron: string | null;
      cryptoWalletSol: string | null;
      cryptoWalletBtc: string | null;
      cryptoWalletUsdc: string | null;
      bankCardEnabled: boolean;
      bankCardDetails: string | null;
    }>("/admin/payment-methods", {
      useAdminToken: true
    })
      .then((response) => {
        setSettings({
          bankTransferEftEnabled: response.bankTransferEftEnabled,
          bankTransferEftDetails: response.bankTransferEftDetails ?? "",
          bankTransferRecipientName: response.bankTransferRecipientName ?? "",
          bankTransferIban: response.bankTransferIban ?? "",
          bankTransferBankName: response.bankTransferBankName ?? "",
          cryptoEnabled: response.cryptoEnabled,
          cryptoDetails: response.cryptoDetails ?? "",
          cryptoWalletUsdtTrc20: response.cryptoWalletUsdtTrc20 ?? "",
          cryptoWalletTron: response.cryptoWalletTron ?? "",
          cryptoWalletSol: response.cryptoWalletSol ?? "",
          cryptoWalletBtc: response.cryptoWalletBtc ?? "",
          cryptoWalletUsdc: response.cryptoWalletUsdc ?? "",
          bankCardEnabled: response.bankCardEnabled,
          bankCardDetails: response.bankCardDetails ?? ""
        });
      })
      .catch(() => setMessage("Odeme yontemleri yuklenemedi. Once admin girisi yap."));
  }, []);

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setMessage(null);
    setSaving(true);

    try {
      await apiRequest("/admin/payment-methods", {
        method: "PUT",
        body: {
          bankTransferEftEnabled: settings.bankTransferEftEnabled,
          bankTransferEftDetails: settings.bankTransferEftDetails.trim() || null,
          bankTransferRecipientName: settings.bankTransferRecipientName.trim() || null,
          bankTransferIban: settings.bankTransferIban.trim() || null,
          bankTransferBankName: settings.bankTransferBankName.trim() || null,
          cryptoEnabled: settings.cryptoEnabled,
          cryptoDetails: settings.cryptoDetails.trim() || null,
          cryptoWalletUsdtTrc20: settings.cryptoWalletUsdtTrc20.trim() || null,
          cryptoWalletTron: settings.cryptoWalletTron.trim() || null,
          cryptoWalletSol: settings.cryptoWalletSol.trim() || null,
          cryptoWalletBtc: settings.cryptoWalletBtc.trim() || null,
          cryptoWalletUsdc: settings.cryptoWalletUsdc.trim() || null,
          bankCardEnabled: settings.bankCardEnabled,
          bankCardDetails: settings.bankCardDetails.trim() || null
        },
        useAdminToken: true
      });
      setMessage("Ödeme yöntemleri başarıyla kaydedildi.");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Ödeme yöntemleri kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "12px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(255, 255, 255, 0.04)",
    color: "white",
    fontSize: "0.95rem"
  };

  const labelSpanStyle = {
    fontSize: "0.85rem",
    color: "rgba(255, 255, 255, 0.72)",
    fontWeight: 600
  };

  return (
    <main className="admin-page-grid">
      <section className="admin-page-heading">
        <div>
          <h1>Ödeme Yöntemleri</h1>
          <p>
            Kullanıcı tarafındaki satın alım ve paket yenileme pencerelerinde gösterilecek ödeme kanallarını yönetin.
          </p>
        </div>
        <button
          className="button button-hero"
          style={{ minHeight: "46px", paddingInline: "24px", borderRadius: "12px", cursor: "pointer" }}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Kaydediliyor..." : "Tümünü Kaydet"}
        </button>
      </section>

      {message ? (
        <div style={{
          padding: "14px 20px",
          borderRadius: "14px",
          background: message.includes("başarıyla") ? "rgba(0, 199, 129, 0.12)" : "rgba(244, 6, 18, 0.12)",
          border: `1px solid ${message.includes("başarıyla") ? "rgba(0, 199, 129, 0.28)" : "rgba(244, 6, 18, 0.28)"}`,
          color: message.includes("başarıyla") ? "#19d690" : "#ff6d76",
          fontWeight: 600
        }}>
          {message.includes("başarıyla") ? "✓" : "✕"} {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "24px" }}>
        {/* Havale / EFT */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.3rem" }}>🏦</span>
              <div>
                <strong style={{ fontSize: "1.2rem", display: "block" }}>Banka Havale & EFT</strong>
                <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Doğrudan banka hesabına ödeme seçeneği</span>
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={settings.bankTransferEftEnabled}
                onChange={(e) => setSettings({ ...settings, bankTransferEftEnabled: e.target.checked })}
                style={{ width: "18px", height: "18px", accentColor: "#f40612" }}
              />
              <span>{settings.bankTransferEftEnabled ? "Aktif" : "Pasif"}</span>
            </label>
          </div>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Banka Adı</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.bankTransferBankName}
                onChange={(e) => setSettings({ ...settings, bankTransferBankName: e.target.value })}
                placeholder="Örn: Garanti BBVA, Ziraat"
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Alıcı Adı / Hesap Sahibi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.bankTransferRecipientName}
                onChange={(e) => setSettings({ ...settings, bankTransferRecipientName: e.target.value })}
                placeholder="Hesap sahibi unvanı"
              />
            </label>

            <label style={{ display: "grid", gap: "8px", gridColumn: "1 / -1" }}>
              <span style={labelSpanStyle}>IBAN Numarası</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.bankTransferIban}
                onChange={(e) => setSettings({ ...settings, bankTransferIban: e.target.value })}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
              />
            </label>

            <label style={{ display: "grid", gap: "8px", gridColumn: "1 / -1" }}>
              <span style={labelSpanStyle}>Açıklama / Havale Talimatları</span>
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                value={settings.bankTransferEftDetails}
                onChange={(e) => setSettings({ ...settings, bankTransferEftDetails: e.target.value })}
                placeholder="Ödeme açıklamasına müşteri kodunu yazınız gibi yönergeler..."
              />
            </label>
          </div>
        </article>

        {/* Kripto */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.3rem" }}>🪙</span>
              <div>
                <strong style={{ fontSize: "1.2rem", display: "block" }}>Kripto Para Cüzdanları</strong>
                <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>USDT, BTC, SOL ve diğer kripto cüzdanları</span>
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={settings.cryptoEnabled}
                onChange={(e) => setSettings({ ...settings, cryptoEnabled: e.target.checked })}
                style={{ width: "18px", height: "18px", accentColor: "#f40612" }}
              />
              <span>{settings.cryptoEnabled ? "Aktif" : "Pasif"}</span>
            </label>
          </div>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>USDT (TRC20) Adresi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.cryptoWalletUsdtTrc20}
                onChange={(e) => setSettings({ ...settings, cryptoWalletUsdtTrc20: e.target.value })}
                placeholder="T..."
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>TRON (TRX) Adresi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.cryptoWalletTron}
                onChange={(e) => setSettings({ ...settings, cryptoWalletTron: e.target.value })}
                placeholder="T..."
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Solana (SOL) Adresi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.cryptoWalletSol}
                onChange={(e) => setSettings({ ...settings, cryptoWalletSol: e.target.value })}
                placeholder="Solana cüzdan adresi"
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={labelSpanStyle}>Bitcoin (BTC) Adresi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.cryptoWalletBtc}
                onChange={(e) => setSettings({ ...settings, cryptoWalletBtc: e.target.value })}
                placeholder="1... veya bc1..."
              />
            </label>

            <label style={{ display: "grid", gap: "8px", gridColumn: "1 / -1" }}>
              <span style={labelSpanStyle}>USD Coin (USDC) Adresi</span>
              <input
                type="text"
                style={inputStyle}
                value={settings.cryptoWalletUsdc}
                onChange={(e) => setSettings({ ...settings, cryptoWalletUsdc: e.target.value })}
                placeholder="USDC cüzdan adresi"
              />
            </label>

            <label style={{ display: "grid", gap: "8px", gridColumn: "1 / -1" }}>
              <span style={labelSpanStyle}>Kripto Ödeme Yönergeleri</span>
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                value={settings.cryptoDetails}
                onChange={(e) => setSettings({ ...settings, cryptoDetails: e.target.value })}
                placeholder="TxID dekontu iletip onay alma gibi açıklamalar..."
              />
            </label>
          </div>
        </article>

        {/* Banka Kartı */}
        <article className="admin-section-card" style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "16px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.3rem" }}>💳</span>
              <div>
                <strong style={{ fontSize: "1.2rem", display: "block" }}>Banka & Kredi Kartı</strong>
                <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.45)" }}>Online kart ödeme veya sanal pos yönlendirmeleri</span>
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={settings.bankCardEnabled}
                onChange={(e) => setSettings({ ...settings, bankCardEnabled: e.target.checked })}
                style={{ width: "18px", height: "18px", accentColor: "#f40612" }}
              />
              <span>{settings.bankCardEnabled ? "Aktif" : "Pasif"}</span>
            </label>
          </div>

          <label style={{ display: "grid", gap: "8px" }}>
            <span style={labelSpanStyle}>Kart Ödeme Yönergeleri / Sanal POS Linki</span>
            <textarea
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
              value={settings.bankCardDetails}
              onChange={(e) => setSettings({ ...settings, bankCardDetails: e.target.value })}
              placeholder="Online ödeme bağlantısı veya kart ödeme açıklaması..."
            />
          </label>
        </article>
      </div>
    </main>
  );
}
