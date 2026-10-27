"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "./page.module.css";
import { tvDownload } from "../platform/tv-download";

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
        <span className={styles.eyebrow}>ANDROID TV · TEST SÜRÜMÜ</span>
        <h1>Flixify, kumandanın ucunda.</h1>
        <p>Canlı TV, filmler ve diziler için TV’ye özel arayüz. Yön tuşları, OK ve Geri ile gez; mevcut kullanıcı kodunla giriş yap.</p>
        <a className={styles.download} href={tvDownload.href} download={tvDownload.filename}>Android TV APK indir <span aria-hidden="true">↓</span></a>
        <p className={styles.release}>{tvDownload.version} · {tvDownload.minimumAndroid} · 32/64 bit için tek APK</p>
        <h2>TV veya box’a nasıl kurulur?</h2>
        <ol className={styles.steps}>
          <li>APK’yı indirip TV’ne aktar veya bu sayfayı TV’nin tarayıcısında aç.</li>
          <li>İndirilen dosyayı aç. TV isterse, yalnız dosyayı açtığın tarayıcı/dosya yöneticisi için uygulama yükleme izni ver.</li>
          <li>Flixify TV Test’i aç ve sitedeki 16 karakterli kullanıcı kodunu gir. Kurulumdan sonra yükleme iznini tekrar kapatabilirsin.</li>
        </ol>
        <p>Bu ilk test sürümü. Karşılaştığın sorunu <Link href="/iletisim">destek bölümünden</Link> iletebilirsin.</p>
        <Link href="/">Flixify’a dön <span aria-hidden="true">→</span></Link>
      </main>
      <HomeFooter />
    </div>
  );
}
