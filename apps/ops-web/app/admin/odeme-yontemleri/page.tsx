"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type PaymentMethodSettingsState = {
  bankTransferEftEnabled: boolean;
  bankTransferEftDetails: string;
  cryptoEnabled: boolean;
  cryptoDetails: string;
  bankCardEnabled: boolean;
  bankCardDetails: string;
};

const initialState: PaymentMethodSettingsState = {
  bankTransferEftEnabled: true,
  bankTransferEftDetails: "",
  cryptoEnabled: true,
  cryptoDetails: "",
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
      cryptoEnabled: boolean;
      cryptoDetails: string | null;
      bankCardEnabled: boolean;
      bankCardDetails: string | null;
    }>("/admin/payment-methods", {
      useAdminToken: true
    })
      .then((response) => {
        setSettings({
          bankTransferEftEnabled: response.bankTransferEftEnabled,
          bankTransferEftDetails: response.bankTransferEftDetails ?? "",
          cryptoEnabled: response.cryptoEnabled,
          cryptoDetails: response.cryptoDetails ?? "",
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
          cryptoEnabled: settings.cryptoEnabled,
          cryptoDetails: settings.cryptoDetails.trim() || null,
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
