"use client";
import { useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '../../lib/api';
import { accountState, type AccountUser } from '../../lib/account-model';
import { AccountPage, AccountLink, CopyButton, Loading, LoadError, formatDate, useAccountResource } from '../account/components';
import s from '../account/account.module.css';
export default function SettingsPage(){
  const {data,loading,error,reload}=useAccountResource<{user:AccountUser}>('/me');
  const billing=useAccountResource<{status:string;checkoutEnabled:boolean;periodEnd?:string|null;cancelAtPeriodEnd?:boolean}>('/me/billing/status');
  const [revealed,setRevealed]=useState(false);
  const [portalPending,setPortalPending]=useState(false);
  const [portalError,setPortalError]=useState(false);
  const user=data?.user??null;const state=accountState(user);
  return <AccountPage title="Hesabım" subtitle="Hesap bilgilerinizi ve paket durumunuzu buradan yönetin.">
    {loading?<Loading/>:error||!user?<LoadError onRetry={reload}/>:<div className={s.columns}><section aria-label="Hesap bilgileri"><h2>Kullanıcı kodu</h2>
      <div className={s.codeBlock}><code>{state.code?(revealed?state.code:'•••• •••• •••• '+state.code.slice(-4)):'Kod alınamadı'}</code><button className={s.secondary} disabled={!state.code} aria-expanded={revealed} onClick={()=>setRevealed(v=>!v)}>{revealed?'Gizle':'Göster'}</button><CopyButton value={state.code}/></div>
      <p>Bu kod hesabınızın anahtarıdır. Başkalarıyla paylaşmayın.</p>
      <div className={s.accountRows}><div className={s.accountRow}><h2>Hesap durumu</h2><span className={user.status==='blocked'?s.warning:state.active?s.positive:s.muted}>{user.status==='blocked'?'Kısıtlı':state.active?'Aktif':'Aktif paket yok'}</span></div><div className={s.accountRow}><h2>İçerik bağlantısı</h2><span className={user.hasAssignedLink?s.positive:s.warning}>{user.hasAssignedLink?'Tanımlı':'Tanımlanmayı bekliyor'}</span></div></div>
    </section><aside className={s.aside}><h2>Paketiniz</h2>{state.active&&user.activePackage?<><h3>{user.activePackage.title}</h3><div className={s.summaryRow}><span>Bitiş tarihi</span><strong>{formatDate(user.activePackage.endsAt)}</strong></div><div className={s.summaryRow}><span>Kalan süre</span><strong>{state.remainingDays} gün</strong></div><p>Paketiniz bitmeden yenileme seçeneklerini inceleyebilirsiniz.</p></>:<><h3>Aktif paketiniz yok</h3><p>{user.status==='blocked'?'Hesabınızın durumunu öğrenmek için destek ekibimizle iletişime geçin.':'Size uygun süreyi seçerek paket başvurunuzu oluşturabilirsiniz.'}</p></>}<Link className={s.primary} href={user.status==='blocked'?'/iletisim':'/paketler'}>{user.status==='blocked'?'Destek al':'Paketleri incele'}</Link></aside></div>}
    {user&&billing.data&&billing.data.status!=='none'&&<section className={s.notice} aria-label="Kartlı abonelik"><h2>Kartlı aboneliğiniz</h2>
      <p>{billing.data.status==='active'?(billing.data.cancelAtPeriodEnd?'Dönem sonunda iptal edilecek.':'Otomatik yenileme açık.'):
        billing.data.status==='past_due'?'Son ödeme tamamlanamadı. Kartınızı kontrol edin.':
        billing.data.status==='review_required'?'Ödemeniz alındı; erişim eşlemesi inceleniyor. Yeniden ödeme yapmayın.':'Ödeme ve erişim doğrulaması sürüyor.'}
      {billing.data.periodEnd?` Sonraki dönem: ${formatDate(billing.data.periodEnd)}.`:''}</p>
      <button type="button" className={s.secondary} disabled={portalPending} onClick={async()=>{setPortalPending(true);setPortalError(false);try{const result=await apiRequest<{url:string}>('/me/billing/portal-session',{method:'POST'});const target=new URL(result.url);if(target.protocol!=='https:'||target.hostname!=='billing.stripe.com')throw new Error('invalid_portal_url');window.location.assign(result.url);}catch{setPortalError(true);setPortalPending(false);}}}>{portalPending?'Açılıyor…':'Aboneliği ve kartı yönet'}</button>
      {portalError&&<p className={s.errorText} role="alert">Abonelik yönetimi şu anda açılamadı. Biraz sonra tekrar deneyin.</p>}
    </section>}
    <section className={s.shortcuts} aria-label="Hesap işlemleri"><AccountLink href="/davet">Arkadaşını davet et</AccountLink><AccountLink href="/odeme-bildirimi#gecmis">Ödeme bildirimlerim</AccountLink><AccountLink href="/iletisim">Destek al</AccountLink></section>
  </AccountPage>;
}
