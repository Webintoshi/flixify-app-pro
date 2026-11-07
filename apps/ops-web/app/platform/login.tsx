"use client";
import { useEffect, useRef } from "react";
import PhoneLoginPreview from "../giris-onizleme/phone-login-preview";
import { Icon } from "./icons";
import s from "./platform.module.css";

export function LoginDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <dialog className={s.phoneLoginDialog} ref={dialog} aria-label="Flixify hesabına giriş" onCancel={onClose}>
    <button type="button" className={s.phoneLoginClose} onClick={onClose} aria-label="Girişi kapat"><Icon name="close"/></button>
    <PhoneLoginPreview onAuthenticated={onSuccess ?? onClose}/>
  </dialog>;
}
