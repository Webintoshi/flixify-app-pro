"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import s from "./platform.module.css";

type Preference = { visible: boolean; revision: number; available: boolean };
type Updated = { visible: boolean; revision: number; status: "ready" };

export function AdultMovieToggle({ account, onChanged }: {
  account: string;
  onChanged: (revision: number, visible: boolean) => void;
}) {
  const [preference, setPreference] = useState<Preference | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPreference(null);
    setConfirmOpen(false);
    setPending(false);
    setError("");
    setAnnouncement("");
    if (account) {
      apiRequest<Preference>("/me/preferences/adult-movies", { signal: controller.signal })
        .then(value => {
          if (!cancelled) {
            setPreference(value);
            if (value.available) onChanged(value.revision, value.visible);
          }
        })
        .catch(() => { if (!cancelled) setError("18+ film tercihi şu anda yüklenemedi."); });
    }
    return () => { cancelled = true; controller.abort(); };
  }, [account]);

  useEffect(() => {
    if (!confirmOpen) return;
    const panel = dialog.current;
    const previousFocus = document.activeElement;
    panel?.showModal();
    return () => {
      panel?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [confirmOpen]);

  const change = async (visible: boolean) => {
    if (pending) return;
    const startingAccount = account;
    setConfirmOpen(false);
    setPending(true);
    setError("");
    setAnnouncement("");
    try {
      const result = await apiRequest<Updated>("/me/preferences/adult-movies", {
        method: "PUT", body: { visible }
      });
      if (accountRef.current !== startingAccount) return;
      setPreference(current => current && { ...current, visible: result.visible, revision: result.revision });
      onChanged(result.revision, result.visible);
      setAnnouncement(result.visible ? "18+ film kategorileri gösteriliyor." : "18+ film kategorileri gizlendi.");
    } catch {
      if (accountRef.current === startingAccount) setError("Tercih değiştirilemedi. Biraz sonra tekrar deneyebilirsin.");
    } finally {
      if (accountRef.current === startingAccount) setPending(false);
    }
  };

  if (!preference?.available) return null;
  return <div className={s.adultPreference}>
    <button type="button" role="switch" aria-checked={preference.visible} aria-label="18+ film kategorilerini göster"
      disabled={pending} onClick={() => preference.visible ? void change(false) : setConfirmOpen(true)}>
      <span>18+ film kategorileri</span><span className={s.adultSwitchTrack} aria-hidden="true"><span/></span>
    </button>
    {pending && <small role="status">Tercih uygulanıyor…</small>}
    {error && <small role="alert">{error}</small>}
    {announcement && <small role="status">{announcement}</small>}
    {confirmOpen && <dialog ref={dialog} className={s.adultConfirm} aria-labelledby="adult-confirm-title"
      onCancel={event => { event.preventDefault(); setConfirmOpen(false); }}>
      <h2 id="adult-confirm-title">18+ film kategorileri</h2>
      <p>Bu içerikleri görmek için 18 yaşından büyük olduğunu onaylıyor musun? Tercihini istediğin zaman kapatabilirsin.</p>
      <div className={s.adultConfirmActions}>
        <button type="button" onClick={() => setConfirmOpen(false)}>Vazgeç</button>
        <button type="button" className={s.primary} autoFocus onClick={() => void change(true)}>18 yaşından büyüğüm</button>
      </div>
    </dialog>}
  </div>;
}
