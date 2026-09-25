"use client";
import { supportUrl } from '../../lib/account-model';
import { AccountPage, AccountLink, Loading, LoadError, useAccountResource } from '../account/components';
import s from '../account/account.module.css';
export default function ContactPage(){
  const {data,loading,error,reload}=useAccountResource<{supportWhatsappUrl:string|null;supportTelegramUrl:string|null}>('/settings/public');
  const channels=[{id:'whatsapp' as const,title:'WhatsApp',url:supportUrl(data?.supportWhatsappUrl,'whatsapp')},{id:'telegram' as const,title:'Telegram',url:supportUrl(data?.supportTelegramUrl,'telegram')}];
  return <AccountPage title="İletişim" subtitle="Hesabınız ve işlemleriniz için bize ulaşın.">
    {loading?<Loading/>:error?<LoadError onRetry={reload}/>:<section aria-label="Destek kanalları">{channels.map(channel=><article className={s.contactRow} key={channel.id}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{channel.id==='telegram'?<><path d="m22 3-4 18-6-5-4 3 1-6-7-3Z"/><path d="m9 13 9-7-6 10"/></>:<><path d="M21 11.5a9 9 0 0 1-13.5 7.8L3 21l1.6-4.6A9 9 0 1 1 21 11.5Z"/><path d="M8 7c0 5 3 8 8 8l1-2-3-1-1 1-2-2 1-1-1-3Z"/></>}</svg>
      <div><h2>{channel.title}</h2><p>{channel.url?'Hesap ve ödeme işlemleri için destek.':'Bu destek kanalı henüz kullanıma açılmadı.'}</p></div>
      {channel.url?<a className={s.secondary} href={channel.url} target="_blank" rel="noopener noreferrer" aria-label={channel.title+' aç (yeni sekme)'}>{channel.title}’ı aç</a>:<span className={s.muted}>Şu anda kullanılamıyor</span>}
    </article>)}</section>}
    <section className={s.help}><h2>Yardımcı bağlantılar</h2><AccountLink href="/ayarlar">Hesap bilgilerim</AccountLink><AccountLink href="/paketler">Paketleri incele</AccountLink><AccountLink href="/odeme-bildirimi">Ödeme bildirimi</AccountLink></section>
    <div className={s.footnote}>Destek için yalnızca bu sayfadaki resmi bağlantıları kullanın.</div>
  </AccountPage>;
}
