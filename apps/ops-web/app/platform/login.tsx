"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiRequest } from "../../lib/api";
import { trackAnalytics } from "./analytics";
import { usePlatform } from "./session";
import { Icon } from "./icons";
import { DeviceLoginQr } from "./device-login";
import qrStyles from "./device-login.module.css";
import type { Session } from "./types";
import s from "./platform.module.css";

export function LoginDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const { saveSession } = usePlatform();
  const dialog = useRef<HTMLDialogElement>(null);
  const manualRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>manualRequest.current?.abort(),[]);
  const [qr,setQr]=useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, []);
  return <dialog className={s.loginDialog} ref={dialog} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={s.loginInner}><button className={s.close} onClick={onClose} aria-label="Girişi kapat"><Icon name="close"/></button>
      <img className={s.loginLogo} src="/logo/flixify-logo.png" alt="Flixify" width="142" height="37"/>
      {qr?<DeviceLoginQr save={saveSession} onSuccess={onSuccess??onClose} onManual={()=>setQr(false)}/>:<>
      <h2>Oynatıcıyı Aç</h2><p>Kişisel alanına kullanıcı kodunla giriş yap.</p>
      <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try {
        let installationId = localStorage.getItem("flixify-installation-id");
        if (!installationId) { installationId = crypto.randomUUID(); localStorage.setItem("flixify-installation-id", installationId); }
        const controller=new AbortController();manualRequest.current=controller;const initial=localStorage.getItem("flixify-public-session");
        const response = await apiRequest<Session>("/auth/login-by-code", { method: "POST", signal:controller.signal, body: { code, platform: "web", deviceName: "Flixify Web", installationId } });
        if(controller.signal.aborted||initial!==localStorage.getItem("flixify-public-session"))return;
        saveSession(response); trackAnalytics("login", { method: "account_code" }); (onSuccess ?? onClose)();
      } catch (error) { setError(error instanceof Error ? error.message : "Giriş yapılamadı."); } finally { setBusy(false); } }}>
        <label htmlFor="player-code">Kullanıcı kodu</label><input id="player-code" autoFocus type="password" autoComplete="current-password" spellCheck={false} value={code} onChange={e => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0,16))} maxLength={16} placeholder="16 haneli kodun" required minLength={16}/>
        {error && <p className={s.error} role="alert">{error}</p>}
        <button className={s.primary} disabled={busy || code.length !== 16}>{busy ? "Hazırlanıyor…" : "Giriş Yap"}<Icon name="arrow"/></button>
      </form>
      <button type="button" className={qrStyles.qrEntry} disabled={busy} onClick={()=>setQr(true)}>Telefonla QR giriş</button>
      </>}
      <p>Kodun yok mu? <Link href="/kayit-ol" className={s.registerLink}>Kayıt Ol</Link></p>
    </div>
  </dialog>;
}
