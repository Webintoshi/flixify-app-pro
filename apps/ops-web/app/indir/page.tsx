"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "./page.module.css";
import { tvDownload } from "../platform/tv-download";
import { windowsDownload } from "../platform/windows-download";
import { phoneDownload } from "../platform/phone-download";
import { trackAnalytics, trackAnalyticsDownload } from "../platform/analytics";

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

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id !== "android-telefon" && id !== "android-tv" && id !== "windows") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function handleLogout() {
    trackAnalytics("logout");
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
        <span className={styles.eyebrow}>FLIXIFY PRO · UYGULAMALAR</span>
        <h1>Flixify’ı cihazına indir.</h1>
        <p>Telefonunda, TV’nde veya Windows bilgisayarında izle. Cihazına uygun sürümü seç.</p>
        <nav className={styles.platformLinks} aria-label="Uygulama seç"><a href="#android-telefon">Android Telefon</a><a href="#android-tv">Android TV</a><a href="#windows">Windows · Test</a></nav>
        <div className={styles.platforms}>
          <section className={styles.platform} id="android-telefon" aria-labelledby="android-phone-heading">
            <h2 id="android-phone-heading">Android Telefon</h2>
            <p>Canlı TV, film ve diziler için dokunmatik telefon arayüzü.</p>
            <a className={styles.download} href={phoneDownload.href} download={phoneDownload.filename} onClick={() => trackAnalyticsDownload("android_phone", phoneDownload)}>Android Telefon APK indir <span aria-hidden="true">↓</span></a>
            <p className={styles.release}>{phoneDownload.version} · {phoneDownload.minimumAndroid} · {phoneDownload.size}</p>
            <h3>Telefona nasıl kurulur?</h3>
            <ol className={styles.steps}>
              <li>APK dosyasını Android telefonuna indir.</li>
              <li>İndirilen dosyayı aç. Android izin isterse, yalnız indirmeyi yaptığın tarayıcı için uygulama yükleme izni ver.</li>
              <li>Flixify Pro’yu aç ve mevcut hesabınla giriş yap.</li>
            </ol>
          </section>
          <section className={styles.platform} id="android-tv" aria-labelledby="android-tv-heading">
            <h2 id="android-tv-heading">Android TV</h2>
            <p>Canlı TV, filmler ve diziler için TV’ye özel arayüz. Yön tuşları, OK ve Geri ile gez.</p>
            <a className={styles.download} href={tvDownload.href} download={tvDownload.filename} onClick={() => trackAnalyticsDownload("android_tv", tvDownload)}>Android TV APK indir <span aria-hidden="true">↓</span></a>
            <p className={styles.release}>{tvDownload.version} · {tvDownload.minimumAndroid} · 32/64 bit için tek APK</p>
            <h3>TV veya box’a nasıl kurulur?</h3>
            <ol className={styles.steps}>
              <li>APK’yı indirip TV’ne aktar veya bu sayfayı TV’nin tarayıcısında aç.</li>
              <li>İndirilen dosyayı aç. TV isterse, yalnız dosyayı açtığın tarayıcı/dosya yöneticisi için uygulama yükleme izni ver.</li>
              <li>Flixify Pro’yu aç ve sitedeki 16 karakterli kullanıcı kodunu gir. Kurulumdan sonra yükleme iznini tekrar kapatabilirsin.</li>
            </ol>
          </section>
          <section className={styles.platform} id="windows" aria-labelledby="windows-heading">
            <div className={styles.platformTitle}><h2 id="windows-heading">Windows</h2><span className={styles.testBadge}>{windowsDownload.status}</span></div>
            <p>Film, dizi ve canlı TV’yi Windows bilgisayarında izle. Mevcut kullanıcı kodunla giriş yap.</p>
            <p className={styles.notice} id="windows-notice">{windowsDownload.notice}</p>
            <a className={styles.download} href={windowsDownload.href} download={windowsDownload.filename} aria-describedby="windows-release windows-notice" onClick={() => trackAnalyticsDownload("windows", windowsDownload)}>Windows EXE indir <span aria-hidden="true">↓</span></a>
            <p className={styles.release} id="windows-release">{windowsDownload.version} · {windowsDownload.minimumWindows}<br/>{windowsDownload.architecture} · {windowsDownload.size}</p>
            <h3>Windows’a nasıl kurulur?</h3>
            <ol className={styles.steps}>
              <li>EXE kurulum dosyasını Windows bilgisayarına indir.</li>
              <li>İndirilen dosyayı aç ve kurulum sihirbazındaki adımları izle. Güvenlik uyarısı kurulumu engellerse korumaları kapatmadan destek bölümüne ulaş.</li>
              <li>Başlat menüsünden Flixify Pro’yu aç ve mevcut 16 karakterli kullanıcı kodunla giriş yap.</li>
            </ol>
          </section>
        </div>
        <p>Karşılaştığın sorunu <Link href="/iletisim">destek bölümünden</Link> iletebilirsin.</p>
        <Link href="/">Flixify’a dön <span aria-hidden="true">→</span></Link>
      </main>
      <HomeFooter />
    </div>
  );
}
