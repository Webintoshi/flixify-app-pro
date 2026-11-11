"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { Marquee } from "../../components/ui/3d-testimonails";
import { deviceReturnPath } from "../../lib/device-login-client";
import { readReferralCode } from "../../lib/referral-link";
import { DeviceLoginQr } from "../platform/device-login";
import { usePlatform } from "../platform/session";
import { trackAnalytics } from "../platform/analytics";
import { createPhoneAuthClient, hasTurkishTrunkPrefix, normalizePhone, phoneAuthError, phoneAuthRecoveryReason, type PhoneAuthClient, type PhoneChallenge, type PhoneIntent, type PhoneAuthRecoveryReason } from "./phone-auth-client";
import { createEmailAuthClient, emailAuthError, normalizeEmail, type EmailAuthClient, type EmailChallenge } from "./email-auth-client";
import { PhoneCountrySelect } from "./phone-country-select";
import { SegmentedOtpInput } from "./segmented-otp-input";
import { accountCodeError, createAccountCodeClient, normalizeAccountCode, type AccountCodeClient } from "./account-code-client";
import s from "./phone-login-cinematic.module.css";

const exampleReviews = [
  { name: "Elif K.", topic: "Canlı TV", text: "Aradığım kanala kumandayla kolayca ulaşabiliyorum.", image: 1 },
  { name: "Zeynep D.", topic: "Film akşamı", text: "Film ve dizilerin aynı yerde olması çok pratik.", image: 2 },
  { name: "Emre A.", topic: "Kaldığın yerden", text: "Maç bitince dizime aynı yerden devam ediyorum.", image: 3 },
  { name: "Deniz K.", topic: "Favoriler", text: "Listeme eklediklerimi yeniden bulmak çok kolay.", image: 4 },
  { name: "Mert B.", topic: "TV deneyimi", text: "Televizyonda menüler arasında gezinmek rahat.", image: 5 },
  { name: "Selin T.", topic: "Tek hesap", text: "Telefonumdan giriş yapıp televizyonda devam ediyorum.", image: 6 },
  { name: "Ali C.", topic: "Dizi akşamı", text: "Televizyonda kaldığım bölümü bulmak kolay.", image: 7 },
  { name: "Duru E.", topic: "Kumandayla kontrol", text: "Geri tuşuyla menüye rahatça dönebiliyorum.", image: 8 },
  { name: "Can Y.", topic: "Listem", text: "Akşam ne izleyeceğimi seçerken listeme bakıyorum.", image: 9 }
];

const ReviewBackdrop = memo(function ReviewBackdrop() {
  return <div className={s.backdrop} aria-hidden="true"><div className={s.reviewPlane}>
    {[0, 1, 2].map(column => <Marquee key={column} vertical pauseOnHover reverse={column % 2 === 1} durationSeconds={column % 2 ? 110 : 125} className={s.reviewColumn}>
      {exampleReviews.map((_, index) => {
        const review = exampleReviews[(index + column) % exampleReviews.length];
        return <article key={review.name} className={s.review}>
          <div className={s.reviewHeading}><img className={s.reviewAvatar} src={`/avatars/auth-preview/profile-${review.image}.jpg`} alt="" width="44" height="44"/><div><strong>{review.name}</strong><span>Örnek yorum</span></div><span className={s.reviewDots}>•••</span></div>
          <p>“{review.text}”</p><div className={s.reviewRating}><span>★★★★★</span><span>{review.topic}</span></div>
        </article>;
      })}
    </Marquee>)}
  </div><div className={s.backdropShade}/></div>;
});

const defaultClient = createPhoneAuthClient();
const defaultEmailClient = createEmailAuthClient();
const defaultCodeClient = createAccountCodeClient();
type AuthMode = "phone" | "email" | "account_code" | "qr";
type AnchoredChallenge = (PhoneChallenge | EmailChallenge) & { receivedAt: number };
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function installationId() {
  const key = "flixify-installation-id", stored = localStorage.getItem(key);
  if (stored) return stored;
  const created = crypto.randomUUID(); localStorage.setItem(key, created); return created;
}

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>;
}

function WhatsAppIcon() {
  return <img src="/icons/whatsapp.svg" alt="" aria-hidden="true" width="20" height="20"/>;
}

function QrIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 14v3h-2M14 20h3v1M20 20h1v1"/></svg>;
}

type PhoneLoginProps = {
  client?: PhoneAuthClient;
  emailClient?: EmailAuthClient;
  codeClient?: AccountCodeClient;
  initialIntent?: PhoneIntent;
  onAuthenticated?: () => void;
};

export default function PhoneLoginPreview({ client = defaultClient, emailClient = defaultEmailClient, codeClient = defaultCodeClient, initialIntent = "login", onAuthenticated }: PhoneLoginProps) {
  const router = useRouter(), { saveSession, session } = usePlatform();
  const [intent, setIntent] = useState<PhoneIntent>(initialIntent);
  const [selectedMode, setSelectedMode] = useState<AuthMode | null>(null);
  const [accountCode, setAccountCode] = useState("");
  const [phone, setPhone] = useState(""), [country, setCountry] = useState<CountryCode>("TR"), [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [emailAvailability, setEmailAvailability] = useState<"loading" | "ready" | "unavailable">("loading");
  const emailInput = useRef<HTMLInputElement>(null);
  const [phoneInputError, setPhoneInputError] = useState("");
  const [bindExisting, setBindExisting] = useState(false), [existingCode, setExistingCode] = useState("");
  const [challenge, setChallenge] = useState<AnchoredChallenge | null>(null), [now, setNow] = useState(0);
  const [recovery, setRecovery] = useState<PhoneAuthRecoveryReason | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [deviceReturn, setDeviceReturn] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [returnReady, setReturnReady] = useState(false);
  const [availability, setAvailability] = useState<"loading" | "ready" | "disabled" | "unavailable">("loading");
  const request = useRef<AbortController | null>(null), generation = useRef(0), otpInput = useRef<HTMLInputElement>(null), accountInput = useRef<HTMLInputElement>(null), pendingCode = useRef<number | null>(null), pendingOtp = useRef<number | null>(null);
  const defaultSignup = selectedMode === null && intent === "register";
  const emailEnabled = emailAvailability === "ready";
  const signupLoading = defaultSignup && emailAvailability === "loading";
  const mode = selectedMode ?? (defaultSignup && emailEnabled ? "email" : "phone");
  useEffect(() => {
    setDeviceReturn(deviceReturnPath(new URLSearchParams(window.location.search).get("device_code") ?? ""));
    setReferralCode(readReferralCode(window.location.search));
    setReturnReady(true);
    return () => { generation.current++; request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setAvailability("loading");
    client.status(controller.signal).then(value => { if (!controller.signal.aborted) setAvailability(value.enabled ? "ready" : "disabled"); }).catch(() => { if (!controller.signal.aborted) setAvailability("unavailable"); });
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    const controller = new AbortController();
    setEmailAvailability("loading");
    emailClient.status(controller.signal).then(value => {
      if (!controller.signal.aborted) setEmailAvailability(value.enabled ? "ready" : "unavailable");
    }).catch(() => {
      if (!controller.signal.aborted) setEmailAvailability("unavailable");
    });
    return () => controller.abort();
  }, [emailClient]);
  useEffect(() => {
    if (!challenge) return;
    otpInput.current?.focus();
    const update = () => setNow(performance.now()); update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);
  useEffect(() => {
    if (mode === "account_code") accountInput.current?.focus();
    if (mode === "email") emailInput.current?.focus();
  }, [mode]);
  const elapsed = challenge ? Math.max(0, (now - challenge.receivedAt) / 1000) : 0;
  const expires = challenge ? Math.max(0, Math.ceil(challenge.expiresInSeconds - elapsed)) : 0;
  const resend = challenge ? Math.max(0, Math.ceil(challenge.resendAfterSeconds - elapsed)) : 0;
  const expired = Boolean(challenge && expires === 0);
  const isEmail = mode === "email";
  const trustedBinding = intent === "register" && Boolean(session);
  const bindsWithCode = bindExisting && !trustedBinding;
  const destination = isEmail ? normalizeEmail(email) : normalizePhone(phone, country);
  const channelReady = isEmail ? emailEnabled : availability === "ready" && !phoneInputError;
  const canSend = !signupLoading && channelReady && (!bindsWithCode || existingCode.length === 16);
  const ready = Boolean(canSend && destination);
  const otpId = isEmail ? "email-otp" : "phone-otp";
  const changeDestinationLabel = isEmail ? "E-posta adresini değiştir" : "Numarayı değiştir";
  function chooseIntent(next: PhoneIntent) {
    const method = selectedMode === "phone" || selectedMode === "email" ? selectedMode : null;
    chooseMode(method, next);
  }

  function chooseMode(next: AuthMode | null, nextIntent: PhoneIntent = "login") {
    generation.current++;
    request.current?.abort();
    pendingCode.current = null;
    pendingOtp.current = null;
    setBusy(false);
    setIntent(nextIntent);
    setSelectedMode(next);
    setChallenge(null);
    setRecovery(null);
    setCode("");
    setError("");
    setPhoneInputError("");
    setBindExisting(false);
    setExistingCode("");
    setAccountCode("");
  }

  function changePhone(value: string, selectedCountry = country) {
    value = value.slice(0, 24); setError("");
    if (hasTurkishTrunkPrefix(value, selectedCountry)) {
      setPhone(""); setPhoneInputError("Başına 0 eklemeden yaz: 5xx xxx xx xx."); return;
    }
    const compact = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
    if (!/^\+?\d*$/.test(compact)) {
      setPhone(""); setPhoneInputError("Telefon numaranı yalnız rakamlarla yaz."); return;
    }
    setPhoneInputError("");
    if (compact.startsWith("+")) {
      const parsed = parsePhoneNumberFromString(compact, { extract: false });
      if (parsed?.country && parsed.isPossible()) {
        setCountry(parsed.country); setPhone(new AsYouType(parsed.country).input(parsed.nationalNumber)); return;
      }
      setPhone(new AsYouType().input(compact)); return;
    }
    setPhone(new AsYouType(selectedCountry).input(compact));
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (busy || pendingOtp.current !== null || !canSend || !destination || challenge && resend > 0) return;
    const serial = ++generation.current, controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    pendingOtp.current = serial;
    setSelectedMode(mode);
    setBusy(true);
    setError("");
    try {
      const input = {
        intent, platform: "web" as const, deviceName: "Flixify Web", installationId: installationId(),
        ...(bindsWithCode ? { existingCode } : {}),
        ...(intent === "register" && !trustedBinding && !bindsWithCode && referralCode ? { referralCode } : {})
      };
      const response = isEmail
        ? await emailClient.request({ ...input, email: destination }, controller.signal, trustedBinding ? session?.accessToken : undefined)
        : await client.request({ ...input, phone: destination }, controller.signal);
      if (controller.signal.aborted || serial !== generation.current) return;
      const receivedAt = performance.now();
      setNow(receivedAt);
      setChallenge({ ...response, receivedAt });
      setCode("");
    } catch (cause) {
      if (!controller.signal.aborted && serial === generation.current) setError(isEmail ? emailAuthError(cause) : phoneAuthError(cause));
    } finally {
      if (pendingOtp.current === serial) pendingOtp.current = null;
      if (serial === generation.current) setBusy(false);
    }
  }

  function finishAuthentication() {
    if (deviceReturn) router.replace(deviceReturn);
    else if (onAuthenticated) onAuthenticated();
    else router.replace("/");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || pendingOtp.current !== null || !challenge || code.length !== 6 || expired) return;
    const serial = ++generation.current, controller = new AbortController();
    const emailChallenge = "maskedEmail" in challenge;
    request.current?.abort();
    request.current = controller;
    pendingOtp.current = serial;
    setBusy(true);
    setError("");
    try {
      const initialSession = localStorage.getItem("flixify-public-session");
      const otpClient = emailChallenge ? emailClient : client;
      const response = await otpClient.verify({ challengeId: challenge.challengeId, challengeSecret: challenge.challengeSecret, code, installationId: installationId() }, controller.signal);
      if (controller.signal.aborted || serial !== generation.current || localStorage.getItem("flixify-public-session") !== initialSession) return;
      saveSession(response);
      trackAnalytics("login", { method: emailChallenge ? "email" : "whatsapp" });
      finishAuthentication();
    } catch (cause) {
      if (!controller.signal.aborted && serial === generation.current) {
        setError(emailChallenge ? emailAuthError(cause) : phoneAuthError(cause));
        const reason = phoneAuthRecoveryReason(cause);
        if (reason) { setChallenge(null); setCode(""); setRecovery(reason); }
      }
    } finally {
      if (pendingOtp.current === serial) pendingOtp.current = null;
      if (serial === generation.current) setBusy(false);
    }
  }

  async function loginByCode(event: FormEvent) {
    event.preventDefault(); if (busy || pendingCode.current !== null || mode !== "account_code" || accountCode.length !== 16) return;
    const serial = ++generation.current, controller = new AbortController(); request.current?.abort(); request.current = controller; pendingCode.current = serial; setBusy(true); setError("");
    try {
      const initialSession = localStorage.getItem("flixify-public-session");
      const response = await codeClient.login({ code: accountCode, deviceName: "Flixify Web", platform: "web", installationId: installationId() }, controller.signal);
      if (controller.signal.aborted || serial !== generation.current || localStorage.getItem("flixify-public-session") !== initialSession) return;
      saveSession(response); trackAnalytics("login", { method: "account_code" }); finishAuthentication();
    } catch (cause) { if (!controller.signal.aborted && serial === generation.current) setError(accountCodeError(cause)); }
    finally { if (pendingCode.current === serial) pendingCode.current = null; if (serial === generation.current) setBusy(false); }
  }

  const verifyTitle = isEmail ? "E-postanı doğrula" : "Telefonunu doğrula";
  const bindTitle = isEmail ? "E-postanı bağla" : "Telefonunu bağla";
  const bindAction = isEmail ? "E-postamı doğrula" : "Telefonumu doğrula";
  const authAction = `${isEmail ? "E-posta" : "WhatsApp"} ile ${intent === "login" ? "giriş yap" : "hesap oluştur"}`;
  const sendAction = trustedBinding || bindsWithCode ? bindAction : authAction;

  return <main className={s.scene}>
    <ReviewBackdrop/>
    <header className={s.topbar}><Link href="/" aria-label="Flixify ana sayfa"><Image src="/logo/flixify-logo.png" alt="Flixify Pro" width={156} height={41} priority/></Link></header>
    <section className={s.panel} aria-label="Flixify hesabına giriş">
      <div className={s.tabs} role="group" aria-label="Giriş veya kayıt seçimi"><button type="button" aria-pressed={intent === "login" && mode !== "qr"} onClick={() => chooseIntent("login")}>Giriş yap</button><button type="button" aria-pressed={intent === "register" && mode !== "qr"} onClick={() => chooseIntent("register")}>Hesap oluştur</button></div>
      {mode === "qr" ? <div className={s.qrPane}><button type="button" className={s.backButton} onClick={() => chooseMode("phone")}>Telefonla girişe dön</button><DeviceLoginQr save={saveSession} onSuccess={finishAuthentication} onManual={() => chooseMode("account_code")}/></div> : <>
        {(challenge || intent === "register") && <div className={s.intro}>
          <h1>{challenge ? verifyTitle : trustedBinding || bindsWithCode ? bindTitle : "Hesap oluştur"}</h1>
          {challenge && <p><strong style={isEmail ? { whiteSpace: "normal", overflowWrap: "anywhere" } : undefined}>
            {"maskedEmail" in challenge ? challenge.maskedEmail : challenge.maskedPhone}
          </strong></p>}
        </div>}
        {!challenge && returnReady && !deviceReturn && <div className={s.fieldTools}><button type="button" className={s.qrButton} disabled={busy} onClick={() => chooseMode("qr")}><QrIcon/>QR ile giriş</button></div>}
        {mode === "account_code" ? <form onSubmit={loginByCode} className={s.form}>
          <input ref={accountInput} id="login-account-code" className={s.codeField} aria-label="Kullanıcı kodun" type="password" autoComplete="current-password" autoCapitalize="characters" spellCheck={false} placeholder="16 haneli kullanıcı kodun" value={accountCode} onChange={event => setAccountCode(normalizeAccountCode(event.target.value))} required minLength={16} maxLength={24} disabled={busy} aria-invalid={Boolean(error)}/>
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.primary} type="submit" disabled={busy || accountCode.length !== 16}><span>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</span><ArrowIcon/></button>
        </form> : signupLoading ? <p className={s.availability} role="status">Kayıt seçenekleri hazırlanıyor…</p> : recovery ? <div className={s.form}>
          <p className={s.error} role="alert">{error}</p>
          {recovery === "registration_required" && <>
            <button className={s.primary} type="button" onClick={() => chooseIntent("register")}><span>{isEmail ? "Bu adresle hesap oluştur" : "Bu numarayla hesap oluştur"}</span><ArrowIcon/></button>
            <button className={s.backButton} type="button" onClick={() => { chooseIntent("register"); setBindExisting(!session); }}>Mevcut hesabımı bağla</button>
          </>}
          <button className={s.backButton} type="button" onClick={() => chooseIntent("login")}>{changeDestinationLabel}</button>
        </div> : challenge ? <form onSubmit={verify} className={s.form}>
          <label htmlFor={otpId}>Doğrulama kodu</label><SegmentedOtpInput ref={otpInput} id={otpId} value={code} onValueChange={setCode} required aria-describedby="otp-time" aria-invalid={Boolean(error)}/>
          <p id="otp-time" className={s.inputHelp}>{expired ? "Kodun süresi doldu. Yeni bir kod isteyebilirsin." : <>Kodun geçerlilik süresi <span role="timer" aria-live="off">{duration(expires)}</span></>}</p>
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.primary} disabled={busy || code.length !== 6 || expired} type="submit"><span>{busy ? "Doğrulanıyor…" : "Doğrula ve devam et"}</span><ArrowIcon/></button>
          <div className={s.otpActions}><button type="button" disabled={busy || resend > 0} onClick={() => void sendCode()}>{resend > 0 ? `Yeniden gönder (${duration(resend)})` : "Kodu yeniden gönder"}</button><button type="button" disabled={busy} onClick={() => { generation.current++; request.current?.abort(); setChallenge(null); setCode(""); setError(""); }}>{changeDestinationLabel}</button></div>
        </form> : <form onSubmit={sendCode} className={s.form}>
          {defaultSignup && emailAvailability === "unavailable" && <p className={s.inputHelp} role="status">E-posta doğrulaması şu anda kullanılamıyor.</p>}
          {isEmail ? <div className={s.phoneField}>
            <input ref={emailInput} id="email-address" aria-label="E-posta adresin" autoComplete="email" autoCapitalize="none"
              spellCheck={false} inputMode="email" type="email" placeholder="E-posta adresin" value={email}
              onChange={event => { setEmail(event.target.value); setError(""); }}
              maxLength={254} disabled={busy} required aria-invalid={Boolean(error)}/>
          </div> : <div className={s.phoneField}>
            <PhoneCountrySelect country={country} onChange={next => { setCountry(next); changePhone(phone, next); }} disabled={busy}/><span aria-hidden="true"/>
            <input id="phone-number" aria-label="Telefon numaran" autoComplete="tel-national" inputMode="tel" type="tel" placeholder={country === "TR" ? "5xx xxx xx xx" : "Telefon numaran"} value={phone} onChange={event => changePhone(event.target.value)} disabled={busy} required aria-invalid={Boolean(error || phoneInputError)} aria-describedby={phoneInputError ? "phone-format-error" : undefined}/>
          </div>}
          {!isEmail && phoneInputError && <p id="phone-format-error" className={s.error} role="alert">{phoneInputError}</p>}
          {intent === "register" && !trustedBinding && <div className={s.existingAccount}>
            <label><input type="checkbox" checked={bindExisting} onChange={event => setBindExisting(event.target.checked)} disabled={busy}/><span>{isEmail ? "Mevcut hesabımı e-posta adresime bağlayacağım" : "Mevcut hesabımı telefonuma bağlayacağım"}</span></label>
            {bindsWithCode && <><label htmlFor="existing-account-code">Mevcut kullanıcı kodun</label><input id="existing-account-code" className={s.oldCodeInput} type="password" autoComplete="current-password" placeholder="16 haneli kullanıcı kodun" value={existingCode} onChange={event => setExistingCode(normalizeAccountCode(event.target.value))} maxLength={16} minLength={16} required disabled={busy}/></>}
          </div>}
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.primary} disabled={busy || !ready} type="submit">{!isEmail && <WhatsAppIcon/>}<span>{busy ? "Kod gönderiliyor…" : !isEmail && availability === "loading" ? "Hazırlanıyor…" : sendAction}</span><ArrowIcon/></button>
          {!isEmail && (availability === "unavailable" || availability === "disabled") && <p className={s.availability} role="status">{intent === "register" ? "WhatsApp doğrulaması şu an kullanılamıyor. Biraz sonra tekrar dene." : "WhatsApp girişi şu an kullanılamıyor."}</p>}
          {intent === "register" && !trustedBinding && !bindExisting && <p className={s.accountRule}>Ücretsiz deneme: yalnız ilk üyelikte 3 saat.</p>}
        </form>}
        <div className={s.alternatives}>
          {(signupLoading || isEmail || emailEnabled) && <button type="button" className={s.legacyLink} onClick={() => chooseMode(signupLoading || isEmail ? "phone" : "email", intent)}>{signupLoading || isEmail ? "WhatsApp kullan" : "E-posta kullan"}</button>}
          <button type="button" className={s.legacyLink} onClick={() => chooseMode(mode === "account_code" ? "phone" : "account_code")}>{mode === "account_code" ? "Telefonla giriş" : "Kullanıcı koduyla giriş"}</button>
        </div>
      </>}
    </section>
    <footer className={s.previewFooter}><span>Yorum ve profiller tasarım örneğidir.</span></footer>
  </main>;
}
