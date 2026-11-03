"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {apiRequest,ApiRequestError} from '../../lib/api';
import {deviceReturnPath} from '../../lib/device-login-client';
import {usePlatform} from '../platform/session';
import styles from '../platform/device-login.module.css';

type Preview={requestId:string;userCode:string;deviceName:string;platform:'web'|'android_tv'|'macos'|'windows';expiresAt:string;accountSuffix:string;approvalNonce?:string;state:'pending'|'approved'|'issued'|'completed'|'denied'|'cancelled'|'expired'};
const platforms={web:'Web tarayıcısı',android_tv:'Android TV',macos:'Mac',windows:'Windows'};
function normalizeCode(value:string){const raw=value.toUpperCase().replace(/[^A-HJ-NP-Z]/g,'').slice(0,8);return raw.length>4?`${raw.slice(0,4)}-${raw.slice(4)}`:raw;}
export default function DeviceApprovalPage(){
  const {session,ready}=usePlatform();const [code,setCode]=useState('');const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [reauth,setReauth]=useState(false);const [result,setResult]=useState('');const [now,setNow]=useState(Date.now());
  const epoch=useRef(0),abort=useRef<AbortController|null>(null),currentToken=useRef(session?.accessToken);currentToken.current=session?.accessToken;
  const lookup=useCallback(async(value:string)=>{
    if(!deviceReturnPath(value)||!session?.accessToken)return;
    abort.current?.abort();const controller=new AbortController();abort.current=controller;const gen=++epoch.current,token=session.accessToken;
    setBusy(true);setError('');setReauth(false);setPreview(null);setResult('');
    try{const next=await apiRequest<Preview>('/auth/device/lookup',{method:'POST',body:{code:value},accessToken:token,skipAuthRefresh:true,signal:controller.signal});
      if(gen!==epoch.current||currentToken.current!==token)return;
      if(next.userCode!==value||!platforms[next.platform]||!['pending','approved','issued','completed','denied','cancelled','expired'].includes(next.state)||!Number.isFinite(Date.parse(next.expiresAt)))throw Error('invalid_preview');setPreview(next);
    }catch(e){if(gen===epoch.current&&!controller.signal.aborted){setError(e instanceof ApiRequestError&&e.status===403?'Bu cihazı bağlamak için telefonunda kullanıcı kodunla yeniden giriş yap.':e instanceof ApiRequestError&&e.status===404?'Kod bulunamadı veya süresi doldu. TV ya da bilgisayarındaki güncel kodu kontrol et.':'Giriş isteği kontrol edilemedi. Tekrar deneyebilirsin.');setReauth(e instanceof ApiRequestError&&(e.status===403||e.status===401));}}
    finally{if(gen===epoch.current)setBusy(false);}
  },[session?.accessToken]);
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('code')??'';if(deviceReturnPath(value))setCode(value);},[]);
  useEffect(()=>{epoch.current++;abort.current?.abort();setPreview(null);setReauth(false);setError('');setResult('');if(ready&&session?.accessToken){const value=new URLSearchParams(window.location.search).get('code')??'';if(deviceReturnPath(value))void lookup(value);}return()=>{epoch.current++;abort.current?.abort();};},[ready,session?.accessToken,lookup]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const loginHref=deviceReturnPath(code)?`/giris-yap?device_code=${code}`:'/giris-yap';
  async function decision(action:'approve'|'deny'){
    if(!preview?.approvalNonce||!session?.accessToken||busy)return;
    const token=session.accessToken,gen=epoch.current;const controller=new AbortController();abort.current=controller;setBusy(true);setError('');
    try{await apiRequest('/auth/device/decision',{method:'POST',accessToken:token,skipAuthRefresh:true,signal:controller.signal,body:{requestId:preview.requestId,userCode:preview.userCode,approvalNonce:preview.approvalNonce,action}});
      if(gen!==epoch.current||currentToken.current!==token)return;setPreview({...preview,state:action==='approve'?'approved':'denied',approvalNonce:undefined});setResult(action==='approve'?'Cihaz onaylandı. TV veya bilgisayarın girişini otomatik tamamlayacak.':'Giriş isteği reddedildi.');
    }catch{if(gen===epoch.current&&!controller.signal.aborted){setError('Yanıt alınamadı. Yeniden onaylamak yerine isteğin son durumunu kontrol et.');setPreview({...preview,approvalNonce:undefined});}}
    finally{if(gen===epoch.current)setBusy(false);}
  }
  const expired=preview?.state==='pending'&&Date.parse(preview.expiresAt)<=now;
  return <main className={styles.phone}>
    <Link href="/" aria-label="Flixify ana sayfa"><img src="/logo/flixify-logo.png" alt="Flixify Pro" width="160" height="42"/></Link>
    <h1>Cihaz bağla</h1><p>TV veya bilgisayarının ekranındaki kodu gir. Giriş, yalnız aşağıdaki onayından sonra açılır.</p>
    <form onSubmit={e=>{e.preventDefault();void lookup(code);}}><label htmlFor="device-code">Cihaz kodu</label><input id="device-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} placeholder="BCDF-GHJK" maxLength={9} onChange={e=>{epoch.current++;abort.current?.abort();setBusy(false);setPreview(null);setError('');setResult('');setCode(normalizeCode(e.target.value));}}/><button disabled={!ready||busy||!session||!deviceReturnPath(code)}>Kodu kontrol et</button></form>
    {!ready&&<p role="status">Hesabın kontrol ediliyor…</p>}
    {ready&&(!session||reauth)&&<p><Link href={loginHref}>Kullanıcı kodunla giriş yap ve buraya dön</Link></p>}
    {busy&&<p role="status">Giriş isteği kontrol ediliyor…</p>}
    {error&&<p role="alert">{error}</p>}
    {preview&&<><dl><dt>Giriş yapılacak cihaz</dt><dd>{preview.deviceName} · {platforms[preview.platform]}</dd><dt>Eşleşen ekran kodu</dt><dd>{preview.userCode}</dd><dt>Kullanılacak hesabın son 4 hanesi</dt><dd>•••• {preview.accountSuffix}</dd></dl>
      {preview.state==='pending'&&!expired&&preview.approvalNonce&&<><p className={styles.notice}>Yalnız kendi başlattığın giriş isteğini onayla. Cihazındaki kodla buradaki kodun aynı olduğundan emin ol.</p><div className={styles.actions}><button className={styles.approve} disabled={busy} onClick={()=>void decision('approve')}>Bu cihazda giriş yap</button><button disabled={busy} onClick={()=>void decision('deny')}>Reddet</button></div></>}
      {(expired||preview.state==='expired')&&<p role="status">Kodun süresi doldu. Giriş yapacağın cihazda yeni QR oluştur.</p>}
      {['approved','issued','completed'].includes(preview.state)&&<p role="status">{result||'Bu cihazın girişi onaylandı. TV veya bilgisayarına dönebilirsin.'}</p>}
      {['denied','cancelled'].includes(preview.state)&&<p role="status">{result||'Bu giriş isteği kapatıldı.'}</p>}
      {preview.state==='pending'&&!preview.approvalNonce&&<button disabled={busy} onClick={()=>void lookup(code)}>Son durumu kontrol et</button>}
    </>}
    <p><Link href="/ayarlar">Hesabıma dön</Link></p>
  </main>;
}
