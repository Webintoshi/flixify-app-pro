"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "./page.module.css";

export default function DownloadsPage() {
  const [userCode, setUserCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("flixify-public-session");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.kryptoniteCode) {
          setUserCode(parsed.kryptoniteCode);
        }
      }
    } catch {}
  }, []);

  function handleLogout() {
    try {
      window.localStorage.removeItem("flixify-public-session");
    } catch {}
    setUserCode(null);
    window.location.href = "/giris-yap";
  }

  return (
    <div className={styles.page}>
      <HomeHeader activeRoute="/indir" userCode={userCode} onLogout={handleLogout} />
      <main className={styles.content}>
        <h1>Flixify her zaman yanında.</h1>
        <p>İndirme veya cihaz seçimi yapmadan tarayıcında devam edebilirsin.</p>
        <Link href="/">Flixify’a dön <span aria-hidden="true">→</span></Link>
      </main>
      <HomeFooter />
    </div>
  );
}
