"use client";

import { useEffect, useState } from "react";
import HomeHeader from "./components/home/HomeHeader";
import HomeHero from "./components/home/HomeHero";
import HomeAbout from "./components/home/HomeAbout";
import HomeBenefits from "./components/home/HomeBenefits";
import HomeDeviceShowcase from "./components/home/HomeDeviceShowcase";
import HomeGettingStarted from "./components/home/HomeGettingStarted";
import HomeFooter from "./components/home/HomeFooter";
import styles from "./home.module.css";

export default function HomePage() {
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
    <div className={styles.flixifyHome}>
      {/* 1. Header */}
      <HomeHeader userCode={userCode} onLogout={handleLogout} />

      <main>
        {/* 2. Sinematik Hero */}
        <HomeHero />

        {/* 3. Flixify Nedir? & Üç Kategori Kartı */}
        <HomeAbout />

        {/* 5. Neden Flixify? & Dört Özellik Kartı (#ozellikler) */}
        <HomeBenefits />

        {/* 6. Geniş Cihaz Deneyimi & Hedef Platformlar */}
        <HomeDeviceShowcase />

        {/* 7. Nasıl Başlarsın? & Dört Adım (#nasil-baslanir) */}
        <HomeGettingStarted />
      </main>

      {/* 8. Footer */}
      <HomeFooter />
    </div>
  );
}
