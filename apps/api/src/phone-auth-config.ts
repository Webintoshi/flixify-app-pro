type PhoneAuthConfiguration={
  PHONE_AUTH_ENABLED:boolean;APP_DEMO_MODE:boolean;PHONE_AUTH_LOCAL_ONLY:boolean;PHONE_AUTH_ALLOWED_ORIGINS:readonly string[];
  PHONE_AUTH_SECRET?:string;APP_JWT_SECRET:string;REGISTRATION_GUARD_SECRET:string;
  VATANSMS_WHATSAPP_API_KEY?:string;VATANSMS_WHATSAPP_REG_ID?:string;DEVICE_LOGIN_LOCAL_WEB_ORIGIN?:string;
};
export function validatePhoneAuthConfiguration(config:PhoneAuthConfiguration){
  if(!config.PHONE_AUTH_ENABLED||config.APP_DEMO_MODE)return;
  for(const key of ['PHONE_AUTH_SECRET','VATANSMS_WHATSAPP_API_KEY','VATANSMS_WHATSAPP_REG_ID'] as const){
    if(!config[key])throw new Error(`Phone authentication requires ${key}.`);
  }
  if(config.PHONE_AUTH_SECRET===config.APP_JWT_SECRET||config.PHONE_AUTH_SECRET===config.REGISTRATION_GUARD_SECRET)throw new Error('PHONE_AUTH_SECRET must be an independent stable secret.');
  const allowed=config.PHONE_AUTH_LOCAL_ONLY?['http://127.0.0.1:3192','http://localhost:3192']:['https://flixify.vip','https://www.flixify.vip'];
  if(!config.PHONE_AUTH_ALLOWED_ORIGINS.length||config.PHONE_AUTH_ALLOWED_ORIGINS.some(origin=>!allowed.includes(origin))||(!config.PHONE_AUTH_LOCAL_ONLY&&!config.PHONE_AUTH_ALLOWED_ORIGINS.includes('https://flixify.vip')))throw new Error('PHONE_AUTH_ALLOWED_ORIGINS must match the selected phone authentication environment.');
  if(!config.PHONE_AUTH_LOCAL_ONLY&&config.DEVICE_LOGIN_LOCAL_WEB_ORIGIN)throw new Error('DEVICE_LOGIN_LOCAL_WEB_ORIGIN must be absent outside the isolated local preview.');
}
