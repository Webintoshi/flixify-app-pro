"use client";
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { PackageRecord, PaymentMethodOption } from '@flixify/contracts';
import { apiRequest } from '../../lib/api';
import { createSubmission, methodConfigured, paymentPayload, paymentStatus } from '../../lib/account-model';
import { AccountPage, CopyButton, Loading, LoadError, formatDate, useAccountResource } from './components';
import s from './account.module.css';
type PaymentRecord={id:string;status:string;packageTitle:string;createdAt:string;paymentMethodId:string|null;cryptoAssetId:string|null};
export default function PaymentPage(){
  const search=useSearchParams();
  const packages=useAccountResource<{items:PackageRecord[]}>('/admin/packages/public');
  const methods=useAccountResource<{items:PaymentMethodOption[]}>('/payment-methods/public');
  const history=useAccountResource<{items:PaymentRecord[]}>('/me/payment-requests');
  const [slug,setSlug]=useState<string|null>(null);
  const [methodId,setMethodId]=useState('');const [assetId,setAssetId]=useState('');
  const [confirmed,setConfirmed]=useState(false);const [error,setError]=useState('');
  const [stage,setStage]=useState<'idle'|'sending'|'saved'|'uncertain'>('idle');
  const guard=useRef(createSubmission());
  const activePackages=(packages.data?.items??[]).filter(p=>p.isActive);
  const availableMethods=(methods.data?.items??[]).filter(methodConfigured);
  const selectedSlug=slug??search.get('paket')??'';
  const selectedPackage=activePackages.find(p=>p.slug===selectedSlug);
  const method=availableMethods.find(m=>m.id===(methodId||availableMethods[0]?.id));
  const assets=method?.cryptoAssets?.filter(a=>a.walletAddress?.trim())??[];
  const asset=assets.find(a=>a.id===assetId);
  const locked=stage!=='idle';
  const pending=history.data?.items.some(item=>item.status==='pending-review')??false;
  async function submit(event:FormEvent){
    event.preventDefault();if(locked)return;
    let payload;try{payload=paymentPayload(selectedPackage,method,assetId||null,confirmed);}catch(e){setError(e instanceof Error?e.message:'Bilgileri kontrol edin.');return;}
    if(history.loading||history.error||pending){setError('Önce bildirim geçmişinizi kontrol edin. Bekleyen bildiriminiz varsa yeniden göndermeyin.');return;}
    setError('');setStage('sending');
    try{const saved=await guard.current.run(()=>apiRequest<{ok:boolean}>('/me/payment-requests',{method:'POST',body:payload,signal:AbortSignal.timeout(20000)}));if(saved){setStage('saved');setConfirmed(false);history.reload();}}
    catch{setStage('uncertain');history.reload();}
  }
  return <AccountPage title="Ödeme Bildirimi" subtitle="Ödemenizin kontrol edilmesi için bildirim oluşturun.">
    {stage==='saved'?<div className={`${s.notice} ${s.success}`} role="status"><h2>Bildiriminiz alındı</h2><p>Ödemeniz kontrol edilmeyi bekliyor. Sonucu aşağıdaki bildirim geçmişinden takip edebilirsiniz.</p><Link href="/ayarlar" className={s.secondary}>Hesabıma dön</Link></div>:null}
    {stage==='uncertain'?<div className={s.notice} role="alert"><h2>Gönderim sonucu doğrulanamadı</h2><p>Bildiriminiz kaydedilmiş olabilir. Tekrar göndermeden önce geçmişinizi yenileyin. Kayıt görünmüyorsa destek ekibimize ulaşın.</p><Link href="/iletisim" className={s.secondary}>Destek al</Link></div>:null}
    {packages.loading||methods.loading?<Loading/>:packages.error||methods.error?<LoadError onRetry={()=>{packages.reload();methods.reload();}}/>:!activePackages.length||!availableMethods.length?<div className={s.notice}><h2>{!activePackages.length?'Kullanılabilir paket bulunmuyor':'Ödeme yöntemleri henüz hazır değil'}</h2><p>İşleminizi tamamlamak için destek ekibimize ulaşın. Eksik bilgilerle ödeme yapmayın.</p><Link className={s.secondary} href="/iletisim">Destek al</Link></div>:<div className={s.columns}>
      <form className={s.form} onSubmit={submit}>
        <label htmlFor="payment-package">Paket<select id="payment-package" value={selectedPackage?.slug??''} disabled={locked} required onChange={e=>{setSlug(e.target.value);setConfirmed(false);setError('');}}><option value="">Paket seçin</option>{activePackages.map(p=><option key={p.id} value={p.slug}>{p.title} — {p.priceLabel??'Fiyat için destek'}</option>)}</select></label>
        {selectedSlug&&!selectedPackage?<p className={s.errorText} role="alert">Seçtiğiniz paket artık kullanılamıyor. Lütfen başka bir paket seçin.</p>:null}
        <fieldset disabled={locked}><legend>Ödeme yöntemi</legend><div className={s.methods}>{availableMethods.map(m=><label className={s.method} key={m.id}><input type="radio" name="method" value={m.id} checked={method?.id===m.id} onChange={()=>{setMethodId(m.id);setAssetId('');setConfirmed(false);setError('');}}/>{m.label}</label>)}</div></fieldset>
        {method?.id==='crypto'?<label htmlFor="payment-asset">Kripto varlık<select id="payment-asset" required value={assetId} disabled={locked} onChange={e=>{setAssetId(e.target.value);setConfirmed(false);}}><option value="">Varlık seçin</option>{assets.map(a=><option key={a.id} value={a.id}>{a.label} ({a.symbol})</option>)}</select></label>:null}
        {method?<div className={s.instructions}><h3>{method.id==='bank-transfer-eft'?'Banka bilgileri':'Ödeme bilgileri'}</h3>
          {method.id==='bank-transfer-eft'&&method.bankTransfer?<><dl><div><dt>Alıcı</dt><dd>{method.bankTransfer.recipientName}</dd></div><div><dt>Banka</dt><dd>{method.bankTransfer.bankName||'Belirtilmedi'}</dd></div><div><dt>IBAN</dt><dd>{method.bankTransfer.iban}</dd></div></dl><CopyButton value={method.bankTransfer.iban??''} label="IBAN’ı kopyala"/></>:null}
          {method.details?<p>{method.details}</p>:null}
          {method.id==='crypto'?(asset?<><dl><div><dt>Cüzdan adresi · {asset.label}</dt><dd>{asset.walletAddress}</dd></div></dl><CopyButton value={asset.walletAddress??''} label="Adresi kopyala"/><p>Ağ ve tutar bilgisini destek ekibimizle doğrulamadan transfer yapmayın.</p></>:<p>Cüzdan adresini görmek için varlık seçin.</p>):null}
        </div>:null}
        {pending&&stage==='idle'?<p className={s.warning} role="status">İncelenmeyi bekleyen bir bildiriminiz var. Yeni bildirim göndermeden önce sonucunu bekleyin veya destek alın.</p>:null}
        <label className={s.confirm}><input type="checkbox" required checked={confirmed} disabled={locked||pending} onChange={e=>setConfirmed(e.target.checked)}/><span>Ödemeyi yaptım, bilgileri kontrol ettim.</span></label>
        {error?<p role="alert" className={s.errorText}>{error}</p>:null}
        <button type="submit" className={s.primary} disabled={locked||pending||history.loading||history.error||!selectedPackage||!confirmed||(method?.id==='crypto'&&!asset)}>{stage==='sending'?'Gönderiliyor…':stage==='saved'?'Bildirim gönderildi':stage==='uncertain'?'Sonucu kontrol edin':'Bildirimi gönder'}</button>
      </form>
      <aside className={s.aside}><h2>Seçiminiz</h2><div className={s.summaryRow}><span>Paket</span><strong>{selectedPackage?.title??'Paket seçilmedi'}</strong></div><div className={s.summaryRow}><span>Tutar</span><strong>{selectedPackage?.priceLabel??'—'}</strong></div><p>Bu işlem hesabınızdan para çekmez. Onay ekibimiz tarafından yapılır.</p><Link className={s.textLink} href="/paketler">Paketleri karşılaştır</Link></aside>
    </div>}
    <section className={s.history} id="gecmis"><div className={s.historyHeading}><h2>Bildirim geçmişi</h2><button className={s.secondary} onClick={history.reload} disabled={history.loading||stage==='sending'}>Yenile</button></div>
      {history.loading?<Loading/>:history.error?<LoadError onRetry={history.reload}/>:history.data?.items.length?<ul className={s.historyList}>{history.data.items.map(item=><li key={item.id}><div><strong>{item.packageTitle}</strong><small>{formatDate(item.createdAt)}{item.paymentMethodId?` · ${methods.data?.items.find(m=>m.id===item.paymentMethodId)?.label??'Ödeme bildirimi'}`:''}</small></div><span className={item.status==='approved'?s.positive:item.status==='pending-review'?s.warning:s.muted}>{paymentStatus(item.status)}</span></li>)}</ul>:<p className={s.empty}>Henüz ödeme bildiriminiz yok.</p>}
    </section>
  </AccountPage>;
}
