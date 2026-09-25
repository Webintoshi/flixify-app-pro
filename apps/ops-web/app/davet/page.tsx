"use client";

import Image from 'next/image';
import { useState } from 'react';
import { copyText } from '../../lib/account-model';
import { buildReferralUrl } from '../../lib/referral-link';
import { referralView, type ReferralSummary } from '../../lib/referral-view';
import { AccountFrame, Loading, formatDate, useAccountResource } from '../account/components';
import s from './referrals.module.css';

export default function ReferralPage() {
  const { data, loading, error, reload } = useAccountResource<ReferralSummary>('/me/referrals');
  const [shareMessage, setShareMessage] = useState('');
  const view = data ? referralView(data) : null;
  const url = data?.code ? buildReferralUrl('https://flixify.vip', data.code) : '';

  async function copyInvite() {
    try {
      await copyText(url, navigator.clipboard);
      setShareMessage('Davet bağlantısı kopyalandı.');
    } catch {
      setShareMessage('Kopyalanamadı. Bağlantıyı seçerek kopyalayın.');
    }
  }

  async function shareInvite() {
    if (!navigator.share) return copyInvite();
    try {
      await navigator.share({ title: 'Flixify davetim', text: 'Flixify davet bağlantım', url });
      setShareMessage('Davet bağlantısı paylaşıldı.');
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') await copyInvite();
    }
  }

  return <AccountFrame className={s.page}>
      <div className={s.content}>
        <section className={s.hero} aria-labelledby="referral-title">
          <div className={s.heroCopy}>
            <h1 id="referral-title">Arkadaşını davet et</h1>
            <p className={s.heroReward}>3 arkadaş, 1 ay Player Pro</p>
            <p className={s.heroDescription}>Davet bağlantını paylaş. Bağlantınla gelen ve ilk kez en az 1 aylık ücretli paket alan her 3 arkadaşın için 1 ay Player Pro kazan. Her yeni 3 arkadaş için tekrar kazanırsın.</p>
            <div className={s.shareArea}>
              <label htmlFor="referral-url">Davet bağlantını paylaş</label>
              {loading ? <Loading /> : error || !url ? <div className={s.shareError} role="alert"><span>Davet bağlantısı alınamadı.</span><button type="button" onClick={reload}>Tekrar dene</button></div> : <>
                <div className={s.shareControls}>
                  <input id="referral-url" value={url} readOnly onFocus={event => event.currentTarget.select()} aria-label="Davet bağlantın" />
                  <button type="button" className={s.copyButton} onClick={copyInvite}>Bağlantıyı kopyala</button>
                  <button type="button" className={s.shareButton} onClick={shareInvite}>Paylaş</button>
                </div>
                <span className={s.shareStatus} role="status">{shareMessage}</span>
              </>}
            </div>
          </div>
          <Image className={s.rewardImage} src="/images/referral-reward.png" alt="" aria-hidden="true" width={1536} height={1024} sizes="(max-width: 900px) 80vw, 42vw" priority />
        </section>

        <section className={s.how} aria-labelledby="how-title">
          <h2 id="how-title">Nasıl çalışır</h2>
          <ol className={s.steps}>
            <li><span className={s.stepNumber}>1</span><div><h3>Bağlantını gönder</h3><p>Davet bağlantını arkadaşlarınla paylaş.</p></div></li>
            <li><span className={s.stepNumber}>2</span><div><h3>Arkadaşın abone olsun</h3><p>Bağlantınla kayıt olup ilk kez en az 1 aylık ücretli paket alsın.</p></div></li>
            <li><span className={s.stepNumber}>3</span><div><h3>1 ay senin</h3><p>Her 3 onaylanan arkadaş için 1 ay Player Pro kazan. Ödüller tekrar eder.</p></div></li>
          </ol>
        </section>

        <section className={s.progressSection} aria-labelledby="progress-title">
          <div className={s.sectionHeading}><h2 id="progress-title">Davet ilerlemesi</h2>{view && <span>{view.progress}/3 onaylandı · Sonraki ödüle {view.remaining} arkadaş</span>}</div>
          {!view ? <div className={s.dataPlaceholder}>Davet bilgileri yükleniyor…</div> : <>
            <div className={s.progressTrack} role="progressbar" aria-label="Sonraki ödüle ilerleme" aria-valuemin={0} aria-valuemax={3} aria-valuenow={view.progress}><span style={{ width: `${view.progress / 3 * 100}%` }} /></div>
            <dl className={s.stats}>
              <div><dt>Davet edilen</dt><dd>{view.invited}</dd></div>
              <div><dt>Onaylanan arkadaş</dt><dd>{view.approved}</dd></div>
              <div><dt>Kazanılan ay</dt><dd>{view.earnedMonths}</dd></div>
              <div><dt>Bekleyen ödül</dt><dd>{view.pendingRewards}</dd></div>
            </dl>
            {view.pendingRewards > 0 && <p className={s.pendingNote}>Bekleyen ödül, içerik bağlantısı hesabına tanımlandığında uygulanır.</p>}
          </>}
        </section>

        <section className={s.historySection} aria-labelledby="history-title">
          <h2 id="history-title">Davet geçmişi</h2>
          {!view ? <div className={s.dataPlaceholder}>Geçmiş yükleniyor…</div> : view.history.length === 0 ? <div className={s.emptyHistory}><span aria-hidden="true">♡</span><h3>Henüz davet geçmişi yok</h3><p>Bağlantını paylaşmaya başla; davetlerin ve onay durumları burada görünsün.</p></div> : <ol className={s.historyList}>{view.history.map((item, index) => <li key={`${item.joinedAt}-${index}`}><div><strong>Davet #{view.invited - index}</strong><span>Katılım: {formatDate(item.joinedAt)}</span></div><span className={item.status === 'qualified' ? s.qualified : s.joined}>{item.status === 'qualified' ? 'Paket onaylandı' : 'Paket bekleniyor'}</span></li>)}</ol>}
          <p className={s.privacyNote}>Davet edilen kişilerin kimliği gizli tutulur. Deneme hesapları ve yalnızca ödeme bildirimi ödüle sayılmaz.</p>
        </section>
      </div>
  </AccountFrame>;
}
