import AppKit
import FlixifyCore
import SwiftUI

struct LoginView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var code = ""
    @FocusState private var codeFocused: Bool
    private var pairingMessage: String {
        switch store.deviceLoginStatus {
        case "starting": return "QR hazırlanıyor…"
        case "pending": return "Telefonundan QR’ı okut, eşleşen kodu kontrol edip onayla."
        case "delivery": return "Onayın sonucu kontrol ediliyor…"
        case "retrying": return "Bağlantı yeniden deneniyor…"
        case "denied": return "Telefonundan girişe izin verilmedi."
        case "expired": return "QR’ın süresi doldu. Yeni QR oluşturabilirsin."
        case "cancelled": return "QR girişi iptal edildi."
        case "bootstrap_error": return "Giriş kaydedildi. Hesap bilgileri yeniden yüklenebilir."
        case "authorized": return "Giriş onaylandı. Hesabın yükleniyor…"
        case "complete": return store.deviceLoginAdopted ? "Giriş onaylandı. Hesabın yükleniyor…" : "Bu QR tamamlandı. Yeni QR oluşturabilirsin."
        case "error": return "QR hazırlanamadı. Yeniden dene veya kullanıcı kodunla giriş yap."
        default: return "QR girişini başlat veya kullanıcı kodunla devam et."
        }
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                BrandLogo(width: 240).padding(.top, 20)
                Text("İçeriklerin. Tek yerde.").font(.system(size: 30, weight: .bold))
                HStack(alignment: .top, spacing: 50) {
                    VStack(spacing: 16) {
                        Text("Telefonunla giriş yap").font(.title2.bold())
                        ZStack {
                            Color.white
                            if let presentation = store.deviceLogin, let image = NSImage(data: presentation.png) {
                                Image(nsImage: image).interpolation(.none).resizable().scaledToFit()
                                    .padding(12).accessibilityLabel("Telefonunla okutabileceğin Flixify giriş QR kodu")
                            } else if store.deviceLoginStatus == "starting" { ProgressView().tint(.black) }
                            else { Image(systemName: "qrcode").font(.system(size: 72)).foregroundStyle(.black).accessibilityHidden(true) }
                        }.frame(width: 220, height: 220)
                        if let presentation = store.deviceLogin {
                            Text(presentation.userCode).font(.system(size: 26, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                                .accessibilityLabel("Eşleştirme kodu " + presentation.userCode)
                            Text(store.deviceLoginRemaining > 0 ? "Kalan süre: \(store.deviceLoginRemaining) sn" : "Onay sonucu bekleniyor")
                                .font(.system(size: 13)).foregroundStyle(FlixTheme.muted)
                        }
                        Text(pairingMessage).font(.system(size: 14)).foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center)
                        if store.deviceLoginAdopted {
                            Button("Hesabımı yeniden yükle") { store.retryDeviceBootstrap() }
                                .buttonStyle(PrimaryActionStyle()).disabled(store.signingIn)
                        } else {
                            HStack {
                                Button(store.deviceLogin == nil ? "QR ile giriş yap" : "QR’ı yenile") { code = ""; codeFocused = false; store.beginDeviceLogin() }
                                    .buttonStyle(PrimaryActionStyle(prominent: false)).disabled(store.deviceLoginStatus == "starting")
                                if store.deviceLogin != nil { Button("İptal") { store.endDeviceLogin(); codeFocused = true }.buttonStyle(.link) }
                            }
                        }
                    }.frame(width: 310)
                    VStack(spacing: 22) {
                        Text("Kullanıcı kodunla giriş yap").font(.title2.bold())
                        Text("Mevcut 16 karakterli kullanıcı kodunla devam et.").foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center)
                        VStack(alignment: .leading, spacing: 9) {
                            Text("Kullanıcı kodu").font(.system(size: 13, weight: .medium)).foregroundStyle(FlixTheme.muted)
                            SecureField("16 karakterli kodun", text: $code).font(.system(size: 22, design: .monospaced))
                                .textFieldStyle(.plain).padding(18).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 11))
                                .focused($codeFocused).onSubmit { submit() }.accessibilityLabel("16 karakterli kullanıcı kodu")
                                .disabled(store.deviceLoginAdopted || store.signingIn)
                                .onChange(of: code) { value in if !value.isEmpty, store.deviceLogin != nil || store.deviceLoginStatus == "starting" { store.endDeviceLogin() } }
                        }
                        Button(action: submit) {
                            HStack(spacing: 12) { if store.signingIn { ProgressView().controlSize(.small) }; Text(store.signingIn ? "Giriş yapılıyor…" : "Giriş yap") }.frame(minWidth: 250)
                        }.buttonStyle(PrimaryActionStyle()).disabled(store.deviceLoginAdopted || store.signingIn || code.trimmingCharacters(in: .whitespaces).count != 16)
                        Button("Hesap oluştur") { store.openWebsite("https://flixify.vip/kayit-ol") }.buttonStyle(.link)
                    }.frame(width: 350)
                }
                if let error = store.error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(FlixTheme.text).font(.system(size: 13)).multilineTextAlignment(.center) }
                Text("macOS için Flixify Pro").font(.system(size: 12)).foregroundStyle(FlixTheme.muted)
            }.padding(35).frame(maxWidth: .infinity)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(FlixTheme.background)
            .onAppear { if scenePhase == .active, NSApplication.shared.isActive, !store.deviceLoginAdopted { store.beginDeviceLogin() } }
            .onDisappear { store.endDeviceLogin() }
            .onChange(of: scenePhase) { phase in if phase != .active { store.endDeviceLogin() } else { store.resumeAdoptedDeviceLogin() } }
    }
    private func submit() {
        guard !store.signingIn, !store.deviceLoginAdopted else { return }
        let submittedCode = code; code = ""
        Task { await store.login(code: submittedCode) }
    }
}

struct WelcomeView: View {
    @EnvironmentObject var store: AppStore
    let offer: WelcomeOffer
    @State private var dual = false
    @State private var submitting = false
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                BrandLogo(width: 180)
                VStack(spacing: 10) {
                    Text("Güzel bir başlangıç yapalım.").font(.system(size: 34, weight: .bold)).multilineTextAlignment(.center)
                    Text("Denemeye devam et veya ilk ayına özel fiyatını seç.").foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center)
                }
                HStack(alignment: .top, spacing: 22) {
                    offerCard(free: true)
                    offerCard(free: false)
                }.frame(maxWidth: 900)
                if let error = store.error { Text(error).font(.system(size: 13)).foregroundStyle(FlixTheme.text) }
                Text("Aylık paket ödemesi sitede, aynı kullanıcı kodunla tamamlanır.").font(.system(size: 12)).foregroundStyle(FlixTheme.muted)
            }.padding(35).frame(maxWidth: .infinity)
        }.background(FlixTheme.background)
    }
    private func offerCard(free: Bool) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(free ? "3 Saat" : "1 Ay").font(.system(size: 26, weight: .bold))
                Spacer()
                if !free { Text("%50 İNDİRİM").font(.system(size: 11, weight: .bold)).padding(.horizontal, 10).padding(.vertical, 7).background(FlixTheme.accent, in: RoundedRectangle(cornerRadius: 7)) }
            }
            if free { Text("Ücretsiz").font(.system(size: 39, weight: .bold)) }
            else {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(Decimal(dual ? offer.dualPriceMinor : offer.singlePriceMinor) / 100, format: .currency(code: "TRY").locale(Locale(identifier: "tr_TR"))).font(.system(size: 39, weight: .bold))
                    Text("ilk ay").font(.system(size: 13)).foregroundStyle(FlixTheme.muted)
                }
            }
            Text(free ? "Flixify dünyasını keşfet." : "Bir ay boyunca favorilerinin keyfini çıkar.").font(.system(size: 15)).foregroundStyle(FlixTheme.muted)
            Divider().overlay(Color.white.opacity(0.15))
            VStack(alignment: .leading, spacing: 15) {
                feature("film", offer.movies > 0 ? "\(offer.movies.formatted()) film" : "Film arşivine erişim")
                feature("tv", offer.live > 0 ? "\(offer.live.formatted()) canlı kanal" : "Canlı TV kanalları")
                feature("play.rectangle.on.rectangle", offer.series > 0 ? "\(offer.series.formatted()) dizi" : "Dizi ve bölüm arşivi")
                if !free { feature("heart", "Favorilerin, kaldığın yer ve yeni bölümler") }
            }
            Spacer(minLength: 0)
            if !free { Toggle("İki cihazda eşzamanlı izle", isOn: $dual).font(.system(size: 13)).toggleStyle(.switch).tint(FlixTheme.accent) }
            Button {
                guard !submitting else { return }; submitting = true
                Task {
                    let accepted = await store.acknowledgeWelcome(monthly: !free); submitting = false
                    if accepted && !free { store.openWebsite(offer.paymentURL(users: dual ? 2 : 1).absoluteString) }
                }
            } label: {
                HStack { Spacer(); if submitting { ProgressView().controlSize(.small) }; Text(free ? "Ücretsiz denemeyi seç" : "İndirimli paketi seç"); Spacer() }
                    .padding(.vertical, 14).font(.system(size: 14, weight: .semibold))
                    .background(free ? FlixTheme.text : FlixTheme.accent, in: Capsule()).foregroundStyle(free ? FlixTheme.background : FlixTheme.text)
            }.buttonStyle(.plain).disabled(submitting)
        }.padding(27).frame(maxWidth: .infinity, minHeight: 440, alignment: .topLeading)
            .background(free ? FlixTheme.panel : Color(red: 0.16, green: 0.045, blue: 0.06), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(free ? Color(white: 0.57) : FlixTheme.accent, lineWidth: 1.5))
    }
    private func feature(_ icon: String, _ value: String) -> some View { Label(value, systemImage: icon).font(.system(size: 14)).foregroundStyle(FlixTheme.text) }
}

struct AccountView: View {
    @EnvironmentObject var store: AppStore
    @State private var refreshing = false
    @State private var showUpdate = false
    @State private var confirmLogout = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text("Hesabım").font(.system(size: 33, weight: .bold))
                if let account = store.account {
                    HStack(alignment: .top, spacing: 20) {
                        Image(systemName: "person.crop.circle").font(.system(size: 53, weight: .ultraLight)).foregroundStyle(FlixTheme.muted)
                        VStack(alignment: .leading, spacing: 12) {
                            Text(account.packageTitle.isEmpty ? (account.canPlay ? "Aktif paket" : "İzleme erişimi") : account.packageTitle).font(.title2.bold())
                            Text("Kullanıcı kodu: •••• \(account.codeSuffix)").foregroundStyle(FlixTheme.muted)
                            TrialCountdownLabel(countdown: account.trialCountdown).font(.title2.weight(.semibold))
                            Label(account.canPlay ? (account.trial ? "Deneme süren aktif" : "Paketin aktif") : "Aktif paketin bulunmuyor", systemImage: account.canPlay ? "checkmark.circle" : "clock")
                            if let end = account.expiresAt { Text("Bitiş: \(end.formatted(date: .abbreviated, time: .shortened))").foregroundStyle(FlixTheme.muted) }
                            if !account.message.isEmpty { Text(account.message).foregroundStyle(FlixTheme.muted) }
                        }
                        Spacer()
                    }.padding(27).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 16))
                    HStack(spacing: 15) {
                        Button("Paketleri görüntüle") { store.openWebsite("https://flixify.vip/paketler") }.buttonStyle(PrimaryActionStyle())
                        Button { refreshing = true; Task { await store.refreshAccess(); refreshing = false } } label: { HStack { if refreshing { ProgressView().controlSize(.small) }; Text("Paketimi yenile") } }.buttonStyle(PrimaryActionStyle(prominent: false)).disabled(refreshing)
                    }
                    if let offer = store.session?.welcomeOffer, offer.eligible {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("İlk ayına özel %50 indirim").font(.title3.bold())
                            Text("Tek veya çift kullanıcılı 1 aylık paketini indirimli alabilirsin.").foregroundStyle(FlixTheme.muted)
                            HStack {
                                Button("Tek kullanıcılı paket") { store.openWebsite(offer.paymentURL(users: 1).absoluteString) }
                                Button("Çift kullanıcılı paket") { store.openWebsite(offer.paymentURL(users: 2).absoluteString) }
                            }.buttonStyle(PrimaryActionStyle(prominent: false))
                        }.padding(24).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 16))
                    }
                }
                VStack(alignment: .leading, spacing: 16) {
                    Text("Uygulama").font(.title3.bold())
                    HStack { Text("Flixify Pro 1.0.0"); Spacer(); Button("Güncellemeleri denetle") { showUpdate = true } }
                    Text("Katalog ve favoriler önbellekte tutulur; video dosyası indirilmez.").font(.system(size: 13)).foregroundStyle(FlixTheme.muted)
                }.padding(24).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 16))
                HStack {
                    Button("Destek") { store.openWebsite("https://flixify.vip/iletisim") }
                    Spacer()
                    Button("Çıkış yap") { confirmLogout = true }.foregroundStyle(FlixTheme.text)
                }
            }.padding(35).frame(maxWidth: 1000, alignment: .leading)
        }.frame(maxWidth: .infinity, alignment: .leading).background(FlixTheme.background)
            .sheet(isPresented: $showUpdate) { UpdateView() }
            .confirmationDialog("Bu Mac’te oturumu kapatmak istiyor musun?", isPresented: $confirmLogout, titleVisibility: .visible) { Button("Çıkış yap", role: .destructive) { Task { await store.logout() } } }
    }
}
