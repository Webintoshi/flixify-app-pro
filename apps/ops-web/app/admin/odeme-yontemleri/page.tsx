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

  async function handleSave() {
    setMessage(null);

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
      setMessage("Odeme yontemleri kaydedildi.");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Odeme yontemleri kaydedilemedi.");
    }
  }

  return (
    <main className="page-grid">
      <section className="panel stack">
        <h1 style={{ margin: 0 }}>/admin/odeme-yontemleri</h1>
        <p className="muted">
          Kullanici tarafindaki satin alim popup'inda gosterilecek odeme yontemleri ve aciklamalari buradan yonetin.
        </p>
      </section>

      <section className="panel stack">
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={settings.bankTransferEftEnabled}
              onChange={(event) =>
                setSettings({ ...settings, bankTransferEftEnabled: event.target.checked })
              }
              style={{ marginRight: 8 }}
            />
            Banka Havale / EFT aktif
          </span>
          <textarea
            rows={3}
            value={settings.bankTransferEftDetails}
            onChange={(event) => setSettings({ ...settings, bankTransferEftDetails: event.target.value })}
            placeholder="IBAN, alici adi, banka adi gibi bilgileri yazin."
          />
        </label>

        <label className="field">
          <span>Alici Adi</span>
          <input
            type="text"
            value={settings.bankTransferRecipientName}
            onChange={(event) => setSettings({ ...settings, bankTransferRecipientName: event.target.value })}
            placeholder="Hesap sahibi / alici unvani"
          />
        </label>

        <label className="field">
          <span>IBAN</span>
          <input
            type="text"
            value={settings.bankTransferIban}
            onChange={(event) => setSettings({ ...settings, bankTransferIban: event.target.value })}
            placeholder="TR..."
          />
        </label>

        <label className="field">
          <span>Banka Adi</span>
          <input
            type="text"
            value={settings.bankTransferBankName}
            onChange={(event) => setSettings({ ...settings, bankTransferBankName: event.target.value })}
            placeholder="Banka adi (opsiyonel)"
          />
        </label>

        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={settings.cryptoEnabled}
              onChange={(event) => setSettings({ ...settings, cryptoEnabled: event.target.checked })}
              style={{ marginRight: 8 }}
            />
            Kripto aktif
          </span>
          <textarea
            rows={3}
            value={settings.cryptoDetails}
            onChange={(event) => setSettings({ ...settings, cryptoDetails: event.target.value })}
            placeholder="Ag tipi, coin ve cuzdan adresini yazin."
          />
        </label>

        <label className="field">
          <span>USDT (TRC20) Cuzdan</span>
          <input
            type="text"
            value={settings.cryptoWalletUsdtTrc20}
            onChange={(event) => setSettings({ ...settings, cryptoWalletUsdtTrc20: event.target.value })}
            placeholder="USDT TRC20 adresi"
          />
        </label>

        <label className="field">
          <span>TRON (TRX) Cuzdan</span>
          <input
            type="text"
            value={settings.cryptoWalletTron}
            onChange={(event) => setSettings({ ...settings, cryptoWalletTron: event.target.value })}
            placeholder="TRON adresi"
          />
        </label>

        <label className="field">
          <span>SOL Cuzdan</span>
          <input
            type="text"
            value={settings.cryptoWalletSol}
            onChange={(event) => setSettings({ ...settings, cryptoWalletSol: event.target.value })}
            placeholder="SOL adresi"
          />
        </label>

        <label className="field">
          <span>BTC Cuzdan</span>
          <input
            type="text"
            value={settings.cryptoWalletBtc}
            onChange={(event) => setSettings({ ...settings, cryptoWalletBtc: event.target.value })}
            placeholder="BTC adresi"
          />
        </label>

        <label className="field">
          <span>USDC Cuzdan</span>
          <input
            type="text"
            value={settings.cryptoWalletUsdc}
            onChange={(event) => setSettings({ ...settings, cryptoWalletUsdc: event.target.value })}
            placeholder="USDC adresi"
          />
        </label>

        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={settings.bankCardEnabled}
              onChange={(event) => setSettings({ ...settings, bankCardEnabled: event.target.checked })}
              style={{ marginRight: 8 }}
            />
            Banka Karti aktif
          </span>
          <textarea
            rows={3}
            value={settings.bankCardDetails}
            onChange={(event) => setSettings({ ...settings, bankCardDetails: event.target.value })}
            placeholder="Sanal POS linki veya kart odeme yonergelerini yazin."
          />
        </label>

        {message ? <div className="muted">{message}</div> : null}
        <button className="button" onClick={() => void handleSave()}>
          Kaydet
        </button>
      </section>
    </main>
  );
}
