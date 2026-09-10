"use client";

import { useEffect, useState } from "react";
import HomeHeader from "../components/home/HomeHeader";
import DownloadsHero from "../components/downloads/DownloadsHero";
import PlatformCards from "../components/downloads/PlatformCards";
import DeviceBand from "../components/downloads/DeviceBand";
import InstallSteps from "../components/downloads/InstallSteps";
import DownloadsCTA from "../components/downloads/DownloadsCTA";
import HomeFooter from "../components/home/HomeFooter";
import styles from "../downloads.module.css";

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
    <div className={styles.flixifyDownloads}>
      {/* 1. Header (İndir link active) */}
      <HomeHeader activeRoute="/indir" userCode={userCode} onLogout={handleLogout} />

      <main>
        {/* 2. Sinematik Hero: "Her Ekranda, Aynı Eğlence." */}
        <DownloadsHero />

        {/* 3. Beş Platform Kartı: Windows, Android, iOS, macOS, Android TV */}
        <PlatformCards />

        {/* 4. Hesap ve Cihaz Bilgilendirme Bandı: "Farklı Ekranlarda Flixify Deneyimi" */}
        <DeviceBand />

        {/* 5. Üç Adımlı Kurulum Bölümü (#kurulum) */}
        <InstallSteps />

        {/* 6. Sinematik Çağrı Bandı: "Flixify Seninle, Her Ekranda." */}
        <DownloadsCTA />
      </main>

      {/* 7. Footer */}
      <HomeFooter />
    </div>
  );
}
