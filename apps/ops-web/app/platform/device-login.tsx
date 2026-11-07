"use client";
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../lib/api';
import {DeviceLoginClient,type DeviceDisplay,type LinkedSession} from '../../lib/device-login-client';
import styles from './device-login.module.css';

export function DeviceLoginQr({save,onSuccess,onManual}:{save:(session:LinkedSession)=>void;onSuccess:()=>void;onManual:()=>void}){
  const [state,setState]=useState<DeviceDisplay>({phase:'loading'});
  const client=useRef<DeviceLoginClient|null>(null);const callbacks=useRef({save,onSuccess});callbacks.current={save,onSuccess};
  useEffect(()=>{
    let initial:string|null,installationId:string;
    try{initial=localStorage.getItem('flixify-public-session');installationId=localStorage.getItem('flixify-installation-id')||crypto.randomUUID();localStorage.setItem('flixify-installation-id',installationId);}catch{setState({phase:'error',message:'Giriş için tarayıcının depolama iznini açıp tekrar dene.'});return;}
    const active=new DeviceLoginClient((path,body,signal)=>apiRequest(path,{method:'POST',body:path.endsWith('/start')?{...(body as object),installationId}:body,signal,skipAuthRefresh:true}),session=>callbacks.current.save(session),next=>{setState(next);if(next.phase==='adopted')callbacks.current.onSuccess();},()=>performance.now(),()=>{try{return document.visibilityState!=='hidden'&&localStorage.getItem('flixify-public-session')===initial;}catch{return false;}});
    client.current=active;
    const changed=()=>{if(localStorage.getItem('flixify-public-session')!==initial)active.cancel();};
    const hidden=()=>{if(document.visibilityState==='hidden')active.pause();};
    const leave=()=>active.pause();
    window.addEventListener('storage',changed);window.addEventListener('flixify-session',changed);
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);
    if(document.visibilityState==='hidden')active.pause();else void active.start();
    return()=>{window.removeEventListener('storage',changed);window.removeEventListener('flixify-session',changed);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);active.cancel();client.current=null;};
  },[]);
  const pending=state.phase==='pending';
  const verificationLabel=(state.verificationUri??'https://flixify.vip/cihaz').replace(/^https?:\/\//,'');
  const localPreview=state.verificationUri?.startsWith('http://');
  const terminal={expired:'QR kodunun süresi doldu.',denied:'Giriş isteği telefonundan reddedildi.',cancelled:'Giriş isteği iptal edildi.',complete:'Bu giriş isteği tamamlandı.'};
  return <section className={styles.target} aria-label="Telefonla QR giriş">
    <h2>Telefonunla giriş yap</h2><p>Telefon kameranla QR kodunu tara. Açılan Flixify sayfasında bu cihazı onayla.</p>
    {pending&&<><img className={styles.qr} src={state.qr} alt="Flixify cihaz giriş QR kodu" width="240" height="240"/><p className={styles.code}>{state.code}</p><p>{localPreview?'Yerel önizlemede aynı bilgisayarda':'QR okutamıyorsan telefonunda'} <strong>{verificationLabel}</strong> adresini açıp bu kodu yaz.</p><p className={styles.countdown}>{state.remaining?`Kod ${state.remaining} saniye geçerli`:'Telefon onayının sonucu bekleniyor…'}</p></>}
    {state.phase==='loading'&&<p role="status">QR hazırlanıyor…</p>}
    {state.phase==='saving'&&<><p role="alert">{state.message}</p><button type="button" onClick={()=>client.current?.retrySave()}>Girişi kaydetmeyi tekrar dene</button></>}
    {state.phase==='error'&&<p role="alert">{state.message}</p>}
    {state.phase in terminal&&<p role="status">{terminal[state.phase as keyof typeof terminal]}</p>}
    {['expired','denied','cancelled','complete','error'].includes(state.phase)&&<button type="button" onClick={()=>void client.current?.start()}>Yeni QR oluştur</button>}
    <button type="button" className={styles.manual} onClick={()=>{client.current?.cancel();onManual();}}>Kullanıcı koduyla giriş yap</button>
  </section>;
}
