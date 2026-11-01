"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeHeader from "../components/home/HomeHeader";
import HomeFooter from "../components/home/HomeFooter";
import styles from "./page.module.css";
import { tvDownload } from "../platform/tv-download";
import { macDownload } from "../platform/mac-download";

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
    if (id !== "macos" && id !== "android-tv") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
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
        <span className={styles.eyebrow}>FLIXIFY PRO · UYGULAMALAR</span>
        <h1>Flixify’ı cihazına indir.</h1>
        <p>TV’nde veya Mac’inde aynı kullanıcı kodunla giriş yap. Cihazına uygun sürümü seç.</p>
        <nav className={styles.platformLinks} aria-label="Uygulama seç"><a href="#android-tv">Android TV</a><a href="#macos">macOS · Test</a></nav>
        <div className={styles.platforms}>
          <section className={styles.platform} id="android-tv" aria-labelledby="android-tv-heading">
            <h2 id="android-tv-heading">Android TV</h2>
            <p>Canlı TV, filmler ve diziler için TV’ye özel arayüz. Yön tuşları, OK ve Geri ile gez.</p>
            <a className={styles.download} href={tvDownload.href} download={tvDownload.filename}>Android TV APK indir <span aria-hidden="true">↓</span></a>
            <p className={styles.release}>{tvDownload.version} · {tvDownload.minimumAndroid} · 32/64 bit için tek APK</p>
            <h3>TV veya box’a nasıl kurulur?</h3>
            <ol className={styles.steps}>
              <li>APK’yı indirip TV’ne aktar veya bu sayfayı TV’nin tarayıcısında aç.</li>
              <li>İndirilen dosyayı aç. TV isterse, yalnız dosyayı açtığın tarayıcı/dosya yöneticisi için uygulama yükleme izni ver.</li>
              <li>Flixify Pro’yu aç ve sitedeki 16 karakterli kullanıcı kodunu gir. Kurulumdan sonra yükleme iznini tekrar kapatabilirsin.</li>
            </ol>
          </section>
          <section className={styles.platform} id="macos" aria-labelledby="macos-heading">
            <div className={styles.platformTitle}><h2 id="macos-heading">macOS</h2><span className={styles.testBadge}>{macDownload.status}</span></div>
            <p>Film, dizi ve canlı TV’yi Mac’inde izle. Favorilerin ve kullanıcı kodun aynı hesapta.</p>
            <a className={styles.download} href={macDownload.href} download={macDownload.filename} aria-describedby="macos-release macos-notice">macOS DMG indir <span aria-hidden="true">↓</span></a>
            <p className={styles.release} id="macos-release">{macDownload.version} · {macDownload.minimumMacOS}<br/>{macDownload.architecture} · {macDownload.size}</p>
            <p className={styles.notice} id="macos-notice">{macDownload.notice}</p>
            <h3>Mac’e nasıl kurulur?</h3>
            <ol className={styles.steps}>
              <li>DMG dosyasını Mac’ine indir ve aç.</li>
              <li>Flixify Pro’yu Uygulamalar klasörüne sürükle.</li>
              <li>Uygulamalar’dan Flixify Pro’yu aç ve mevcut 16 karakterli kullanıcı kodunla giriş yap.</li>
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
