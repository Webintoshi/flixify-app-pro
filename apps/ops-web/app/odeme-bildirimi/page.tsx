import { Suspense } from 'react';
import PaymentPage from '../account/payment';
export default function Page(){return <Suspense fallback={<p role="status">Ödeme bilgileri yükleniyor…</p>}><PaymentPage/></Suspense>;}
