"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiRequest } from '../../lib/api';
import { copyText } from '../../lib/account-model';
import s from './account.module.css';
const accountGroups = [
  { label: 'Üyelik', links: [['/ayarlar', 'Hesabım'], ['/paketler', 'Paketler'], ['/odeme-bildirimi', 'Ödeme Bildirimi']] },
  { label: 'Hesap', links: [['/davet', 'Arkadaşını Davet Et']] },
  { label: 'Destek', links: [['/iletisim', 'İletişim']] }
] as const;

export function AccountNavigation() {
  const path = usePathname();
  return <nav className={s.accountNav} aria-label="Hesap menüsü">
    {accountGroups.map(group => <div className={s.navGroup} key={group.label}>
      <span className={s.navGroupLabel}>{group.label}</span>
      {group.links.map(([href, label]) => <Link key={href} href={href} className={s.navLink} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
    </div>)}
  </nav>;
}

export function AccountFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`${s.page} ${className}`.trim()}>
    <div className={s.accountTopbar}><span>Hesap</span><Link href="/"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 18-6-6 6-6" /></svg>İzlemeye dön</Link></div>
    <div className={s.accountLayout}><AccountNavigation /><div className={s.accountContent}>{children}</div></div>
  </main>;
}

export function AccountPage({ title, subtitle, children }: { title:string; subtitle:string; children:ReactNode }) {
  return <AccountFrame><header className={s.heading}><h1>{title}</h1><p>{subtitle}</p></header>{children}</AccountFrame>;
}
export function useAccountResource<T>(path:string) {
  const [state,setState]=useState<{data:T|null;loading:boolean;error:boolean}>({data:null,loading:true,error:false});
  const [version,setVersion]=useState(0);
  const reload=useCallback(()=>setVersion(v=>v+1),[]);
  useEffect(()=>{
    let current=true;const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    setState({data:null,loading:true,error:false});
    apiRequest<T>(path,{signal:controller.signal}).then(data=>{if(current)setState({data,loading:false,error:false});}).catch(()=>{if(current)setState({data:null,loading:false,error:true});}).finally(()=>clearTimeout(timer));
    return ()=>{current=false;clearTimeout(timer);controller.abort();};
  },[path,version]);
  return {...state,reload};
}
export function Loading(){return <div className={s.loading} role="status" aria-busy="true"><span/><span/><span/><p>Bilgiler yükleniyor…</p></div>;}
export function LoadError({onRetry}: {onRetry:()=>void}){return <div className={s.notice} role="alert"><h2>Bilgiler yüklenemedi</h2><p>Bağlantıyı kontrol edip tekrar deneyin. Hesap bilgileriniz değiştirilmedi.</p><button className={s.secondary} onClick={onRetry}>Tekrar dene</button></div>;}
export function CopyButton({value,label='Kopyala'}:{value:string;label?:string}){
  const [result,setResult]=useState('');useEffect(()=>{setResult('');},[value]);
  return <span className={s.copyControl}><button type="button" className={s.secondary} disabled={!value} onClick={async()=>{try{await copyText(value,navigator.clipboard);setResult('Kopyalandı');}catch{setResult('Kopyalanamadı. Metni seçerek kopyalayın.');}}}>{label}</button><span role="status" className={s.copyResult}>{result}</span></span>;
}
export function AccountLink({href,children}: {href:string;children:ReactNode}) {return <Link href={href} className={s.linkRow}><span>{children}</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m9 5 7 7-7 7"/></svg></Link>;}
export function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Tarih alınamadı':new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeZone:'Europe/Istanbul'}).format(date);}
