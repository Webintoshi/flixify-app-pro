import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PhoneAuthError,type PhoneAuthOwner,type PhoneAuthService } from './phone-auth.js';
import { errors as joseErrors } from 'jose';
import { BlockedUserRouteError,UnauthorizedUserRouteError } from './user-route-error.js';

const requestSchema=z.object({phone:z.string().min(8).max(40),intent:z.enum(['login','register']),installationId:z.string().min(8).max(200),platform:z.enum(['web','android_tv','android_phone','macos','windows']),deviceName:z.string().trim().min(1).max(80),existingCode:z.string().regex(/^[A-Z0-9]{16}$/).optional(),referralCode:z.string().regex(/^[A-Z2-9]{12}$/).optional()}).strict();
const verifySchema=z.object({challengeId:z.string().uuid(),challengeSecret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code:z.string().regex(/^[0-9]{6}$/),installationId:z.string().min(8).max(200)}).strict();
const messages:Record<string,string>={invalid_phone:'Telefon numaranızı ülke koduyla girin.',invalid_input:'Bilgileri kontrol edip tekrar deneyin.',delivery_unavailable:'Doğrulama kodu şu anda gönderilemiyor. Biraz sonra tekrar deneyin.',temporarily_unavailable:'Telefonla giriş şu anda kullanılamıyor.',rate_limited:'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.',resend_cooldown:'Yeni kod istemeden önce bir dakika bekleyin.',invalid_or_expired:'Doğrulama kodu geçersiz veya süresi dolmuş.',registration_required:'Bu numarayla hesap bulunamadı. Kayıt seçeneğiyle devam edebilirsiniz.',account_conflict:'Telefon numarası başka bir hesapla eşleşiyor. Destek ile iletişime geçin.',existing_account_unverified:'Mevcut hesabın giriş kodunu kontrol edin.',reauthentication_required:'Hesabınızı bağlamak için mevcut giriş kodunuzla doğrulayın.',account_unavailable:'Bu hesaba şu anda giriş yapılamıyor.',installation_limit:'Bu cihazda daha önce hesap oluşturulmuş. Mevcut hesabınızla giriş yapın.',registration_ip_limit:'Bu internet bağlantısından en fazla iki hesap oluşturulabilir.'};
export function registerPhoneAuthRoutes(app:FastifyInstance,deps:{service:PhoneAuthService|null;enabled:boolean;localOnly:boolean;allowedOrigins:readonly string[];authenticate:(authorization?:string)=>Promise<PhoneAuthOwner>}){
  app.register(async(routes)=>{
    routes.addHook('onRequest',async(_request,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache').header('referrer-policy','no-referrer');});
    routes.setErrorHandler((error,_request,reply)=>{
      if(error instanceof PhoneAuthError){if(error.retryAfterSeconds)reply.header('retry-after',error.retryAfterSeconds);return reply.code(error.statusCode).send({reason:error.reason,message:messages[error.reason]??messages.temporarily_unavailable,...(error.retryAfterSeconds?{retryAfterSeconds:error.retryAfterSeconds}:{})});}
      const malformed=error instanceof z.ZodError||error&&typeof error==='object'&&'statusCode' in error&&(error.statusCode===400||error.statusCode===413);
      return reply.code(malformed?400:503).send({reason:malformed?'invalid_input':'temporarily_unavailable',message:messages[malformed?'invalid_input':'temporarily_unavailable']});
    });
    function ready(ip:string){return deps.enabled&&deps.service&&(!deps.localOnly||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip));}
    routes.get('/auth/phone/status',async(request)=>({enabled:Boolean(ready(request.ip)),deliveryChannel:'whatsapp',vendorMode:'linked-device',nativePhoneLogin:true,...(!ready(request.ip)?{reason:'not_configured'}:{})}));
    routes.addHook('preHandler',async(request)=>{
      if(request.method==='GET')return;
      if(!ready(request.ip))throw new PhoneAuthError(503,'temporarily_unavailable');
      const native=request.headers['x-flixify-client-runtime']==='android_phone';
      const nativePlatform=request.body&&typeof request.body==='object'&&'platform' in request.body&&request.body.platform==='android_phone';
      if(native){
        if(request.headers.origin!==undefined||request.url.split('?')[0]==='/auth/phone/request'&&!nativePlatform)throw new PhoneAuthError(403,'origin_forbidden');
      }else if(nativePlatform||!deps.allowedOrigins.includes(request.headers.origin??''))throw new PhoneAuthError(403,'origin_forbidden');
    });
    routes.post('/auth/phone/request',{bodyLimit:2048},async(request)=>{
      const input=requestSchema.parse(request.body);let owner:PhoneAuthOwner|undefined;
      if(request.headers.authorization){try{owner=await deps.authenticate(request.headers.authorization);}catch(error){if(error instanceof BlockedUserRouteError)throw new PhoneAuthError(403,'account_unavailable');if(error instanceof UnauthorizedUserRouteError||error instanceof joseErrors.JOSEError)throw new PhoneAuthError(401,'existing_account_unverified');throw new PhoneAuthError(503,'temporarily_unavailable');}}
      return deps.service!.request(input,request.ip,owner);
    });
    routes.post('/auth/phone/verify',{bodyLimit:2048},async(request)=>deps.service!.verify(verifySchema.parse(request.body),request.ip));
  });
}
