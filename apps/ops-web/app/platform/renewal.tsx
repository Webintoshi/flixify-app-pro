"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import s from "./renewal.module.css";

export function RenewalDialog({ period }: { period: string }) {
  const key = `flixify-renewal:v1:${period}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(key) === "seen"; } catch { return false; }
  });
  const ref = useRef<HTMLDialogElement>(null);
  function close() {
    try { sessionStorage.setItem(key, "seen"); } catch { /* Dismissal still works when storage is unavailable. */ }
    setDismissed(true);
  }
  useEffect(() => {
    if (dismissed) return;
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    try { sessionStorage.setItem(key, "seen"); } catch { /* Optional session preference. */ }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissed, key]);
  if (dismissed) return null;
  return <dialog ref={ref} className={s.dialog} aria-labelledby="renewal-title" aria-describedby="renewal-description" onCancel={event => { event.preventDefault(); close(); }}>
    <button type="button" className={s.close} onClick={close} aria-label="Yenileme penceresini kapat"><Icon name="close"/></button>
    <div className={s.play} aria-hidden="true"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M7 4.8c0-.8.9-1.3 1.6-.8l11 7.2c.6.4.6 1.2 0 1.6L8.6 20c-.7.5-1.6 0-1.6-.8Z"/></svg></div>
    <p className={s.eyebrow}>ERİŞİM SÜREN SONA ERDİ</p>
    <h2 id="renewal-title">Kaldığın yerden<br/>devam et.</h2>
    <p id="renewal-description" className={s.description}>Sana uygun paketi seç,<br/>aynı hesabınla devam et.</p>
    <ul className={s.benefits}>
      <li><span aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m5 12 4 4L19 6"/></svg></span>Yeni hesap oluşturman gerekmez.</li>
      <li><span aria-hidden="true"><Icon name="heart"/></span>Favorilerin seni bekliyor.</li>
    </ul>
    <Link className={s.primary} href="/paketler" onClick={close}>Paketleri incele<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></Link>
    <button type="button" className={s.later} onClick={close}>Şimdi değil</button>
  </dialog>;
}
