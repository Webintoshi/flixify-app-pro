"use client";
import Link from "next/link";
import { useState } from "react";
import { LoginDialog } from "./login";
import { Icon } from "./icons";
import s from "./landing.module.css";

const examples = ["Uzak Yerler", "Sakin Şehirler", "Mavi Ufuk", "Doğanın Sesi", "Bir Gün Daha"];
function InterfacePreview({ compact = false }: { compact?: boolean }) {
  return <div className={`${s.interface} ${compact ? s.compact : ""}`} aria-hidden="true">
    <div className={s.previewNav}><img src="/logo/flixify-logo.png" alt="" width="110" height="29"/><div><span>Ana Sayfa</span><span>Canlı TV</span><span>Filmler</span><span>Diziler</span><span>Favoriler</span></div><Icon name="search"/></div>
    <div className={s.previewHero}><img src="/images/landing-v2/mountain-lake.webp" alt="" width="1536" height="1024" loading={compact ? "lazy" : "eager"}/><div><strong>Uzak Yerler</strong><span>Keşfetmenin her zaman yeni bir yolu vardır.</span></div></div>
    <div className={s.previewLibrary}><p>Örnek koleksiyon <Icon name="arrow"/></p><div className={s.previewRail}>{examples.map((name,index)=><div key={name}><div className={`${s.thumbnail} ${s[`thumb${index}`]}`}/><span>{name}</span></div>)}</div><p>Keşif notları <Icon name="arrow"/></p><div className={s.previewRail}>{[2,0,4,1,3].map(index=><div key={index}><div className={`${s.thumbnail} ${s[`thumb${index}`]}`}/></div>)}</div></div>
  </div>;
}
export function Landing() {
  const [login, setLogin] = useState(false);
  const open = () => setLogin(true);
  return <main className={s.landing}>
    <header className={s.header}><a href="#ozellikler" aria-label="Flixify ana sayfa"><img className={s.logo} src="/logo/flixify-logo.png" alt="Flixify Pro" width="170" height="45"/></a><nav aria-label="Ana sayfa bölümleri"><a href="#ozellikler">Özellikler</a><a href="#nasil-kullanilir">Nasıl Kullanılır</a><a href="#cihazlar">Cihazlar</a><Link href="/kayit-ol">Kayıt Ol</Link></nav><div className={s.authActions}><button className={s.login} onClick={open}>Giriş Yap</button><Link href="/kayit-ol" className={s.register}>Kayıt Ol</Link></div></header>
    <section className={s.hero} id="ozellikler"><div className={s.heroCopy}><h1>Medyan için<br/>kendi alanın<span>.</span></h1><p>İçeriklerini düzenle, favorilerini sakla.<br/> Flixify ile kontrol sende.</p><div className={s.actions}><button className={s.primary} onClick={open}>Oynatıcıyı Aç<Icon name="arrow"/></button></div></div><figure className={s.heroFigure}><div className={s.monitor}><InterfacePreview/></div><figcaption>Flixify · Örnek arayüz</figcaption></figure></section>
    <section className={s.steps} id="nasil-kullanilir"><h2>Üç adımda kendi alanın<span>.</span></h2><ol><li><div className={s.stepNumber}>01<i/></div><h3>Kodunu gir</h3><p>Kullanıcı kodunla kişisel alanını aç.</p></li><li><div className={s.stepNumber}>02<i/></div><h3>İçeriklerini düzenle</h3><p>Favorilerini seç; içeriklerini tek yerde bul.</p></li><li><div className={s.stepNumber}>03<i/></div><h3>Oynatıcıyı aç</h3><p>İçeriğini seç, oynatma kontrolünü eline al.</p></li></ol></section>
    <section className={s.devices} id="cihazlar"><div><h2>Hangi ekranı seçersen<span>.</span></h2><p>Telefonunda, tabletinde ve bilgisayarında aynı Flixify deneyimi.</p></div><figure className={s.deviceFigure} aria-label="Masaüstü, dizüstü ve telefonda örnek Flixify arayüzü"><div className={s.desktop}><InterfacePreview compact/></div><div className={s.laptop}><InterfacePreview compact/></div><div className={s.phone}><InterfacePreview compact/></div></figure></section>
    <footer className={s.footer}><img src="/logo/flixify-logo.png" alt="Flixify Pro" width="136" height="36"/><span>Flixify bir medya oynatıcıdır.</span><Link href="/iletisim">İletişim</Link></footer>
    {login && <LoginDialog onClose={() => setLogin(false)}/>}
  </main>;
}
