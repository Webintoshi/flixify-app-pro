import { PhoneAuthError,normalizePhone } from './phone-auth.js';

export const VATANSMS_WHATSAPP_ORIGIN='https://api.toplusmspaketleri.com';
export type VatanSmsDiagnostic={
  phase:'accepted'|'http_rejected'|'unacknowledged'|'invalid_response'|'transport_failed';httpStatus:number|null;
  shape?:{success:'true'|'false'|'other'|'missing';status:'success'|'OK'|'200'|'other'|'missing';code:'200'|'other'|'missing';data:'array'|'object'|'other'|'missing';error:boolean};
};
export function verificationMessage(code:string){if(!/^[0-9]{6}$/.test(code))throw new Error('Invalid verification code');return `Doğrulama kodunuz: ${code}. Sorun yaşarsanız lütfen bu mesaja cevap veriniz.`;}
export class VatanSmsWhatsAppSender {
  constructor(private config:{apiKey:string;regId:string;baseUrl?:string},private request:typeof fetch=fetch,private diagnostic?:(value:VatanSmsDiagnostic)=>void){
    if(!config.apiKey||!/^[0-9]{1,30}$/.test(config.regId)||(config.baseUrl??VATANSMS_WHATSAPP_ORIGIN)!==VATANSMS_WHATSAPP_ORIGIN)throw new Error('WhatsApp delivery is not configured');
  }
  private report(value:VatanSmsDiagnostic){try{this.diagnostic?.(value);}catch{}}
  async send(phone:string,code:string){
    const diagnostic:VatanSmsDiagnostic={phase:'transport_failed',httpStatus:null};
    try{
      const response=await this.request(`${VATANSMS_WHATSAPP_ORIGIN}/bulk/wp/nton`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Api-Key':this.config.apiKey},body:JSON.stringify({messages:[{reg_id:this.config.regId,target:normalizePhone(phone).slice(1),message:verificationMessage(code)}]})});
      diagnostic.httpStatus=response.status;
      if(!response.ok){diagnostic.phase='http_rejected';throw new Error('Provider rejected request');}
      diagnostic.phase='invalid_response';
      if(Number(response.headers.get('content-length')??0)>16384||!response.body)throw new Error('Provider rejected request');
      const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
      try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>16384)throw new Error('Provider response exceeds limit');chunks.push(value.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid provider response');
      diagnostic.shape={success:payload.success===true?'true':payload.success===false?'false':payload.success===undefined?'missing':'other',status:payload.status==='success'?'success':payload.status==='OK'?'OK':payload.status===200?'200':payload.status===undefined?'missing':'other',code:payload.code===200?'200':payload.code===undefined?'missing':'other',data:payload.data===undefined?'missing':Array.isArray(payload.data)?'array':payload.data!==null&&typeof payload.data==='object'?'object':'other',error:Boolean(payload.error)};
      const statusAccepted=payload.status===undefined||payload.status==='success'||payload.status==='OK';
      const codeAccepted=payload.code===undefined||payload.code===200;
      const successAccepted=payload.success===undefined||payload.success===true;
      const acknowledged=payload.success===true||payload.code===200&&(payload.status==='success'||payload.status==='OK');
      if(payload.error||!statusAccepted||!codeAccepted||!successAccepted||!acknowledged){diagnostic.phase='unacknowledged';throw new Error('Provider did not acknowledge request');}
      diagnostic.phase='accepted';this.report(diagnostic);
    }catch{this.report(diagnostic);throw new PhoneAuthError(503,'delivery_unavailable');}
  }
}
