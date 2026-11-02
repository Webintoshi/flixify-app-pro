import CryptoKit
import FirebaseAnalytics
import FirebaseCore
import FlixifyCore
import Foundation

@MainActor final class FlixifyAnalytics: ObservableObject {
    static let shared = FlixifyAnalytics()
    @Published private(set) var accepted = false
    @Published private(set) var asked = false
    let configured: Bool
    private let defaults = UserDefaults.standard
    private let options: FirebaseOptions?
    private var lastScreen = ""
    private lazy var policy = AnalyticsPolicy(configured: configured) { name, values in
        var params=values; params["client_platform"]="macos"; params["app_version"]=Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "1.0.1"
        Analytics.logEvent(name,parameters:params)
    }
    private init() {
        let path=Bundle.main.path(forResource:"GoogleService-Info",ofType:"plist")
        let loaded=path.flatMap { path -> FirebaseOptions? in guard let data=try? Data(contentsOf:URL(fileURLWithPath:path)),FirebaseClientConfiguration.valid(data,bundleID:"vip.flixify.mac") else { return nil }; return FirebaseOptions(contentsOfFile:path) }
        #if DEBUG
        options=nil; configured=false
        #else
        options=loaded
        configured=loaded != nil
        #endif
        asked=defaults.integer(forKey:"analyticsConsentVersion")==AnalyticsPolicy.version
        if asked, defaults.bool(forKey:"analyticsConsentAccepted") { apply(true,reset:false) }
    }
    var epoch: Int { policy.epoch }
    var status: String { !configured ? "Kullanım analizi henüz yapılandırılmadı." : accepted ? "İsteğe bağlı kullanım analizi açık." : "İsteğe bağlı kullanım analizi kapalı." }
    func choose(_ value: Bool) {
        defaults.set(AnalyticsPolicy.version,forKey:"analyticsConsentVersion"); defaults.set(value,forKey:"analyticsConsentAccepted"); asked=true
        apply(value,reset:true)
    }
    private func apply(_ value: Bool,reset: Bool) {
        policy.choice(accepted:false,version:AnalyticsPolicy.version)
        accepted=value && configured
        if accepted, FirebaseApp.app()==nil, let options { FirebaseApp.configure(options:options) }
        if FirebaseApp.app() != nil {
            Analytics.setAnalyticsCollectionEnabled(false)
            Analytics.setConsent([.analyticsStorage:accepted ? .granted:.denied,.adStorage:.denied,.adUserData:.denied,.adPersonalization:.denied])
            if !accepted, reset { Analytics.resetAnalyticsData() }
            Analytics.setAnalyticsCollectionEnabled(accepted)
        }
        policy.choice(accepted:accepted,version:AnalyticsPolicy.version); lastScreen=""
    }
    func event(_ name: String,_ values:[String:Any]=[:],epoch:Int?=nil) { policy.event(name,values,epoch:epoch) }
    func screen(_ name:String) { guard name != lastScreen else { return }; lastScreen=name; event("screen_view",["screen_name":name]) }
    static func opaque(_ value:String)->String { SHA256.hash(data:Data(value.utf8)).prefix(12).map { String(format:"%02x",$0) }.joined() }
    static func item(_ item:CatalogItem)->[String:Any] { var values:[String:Any]=["content_type":item.kind.rawValue,"content_id":opaque(item.kind.rawValue+":"+item.id)];if let label=AnalyticsPolicy.catalogLabel(item.title) { values["content_name"]=label };return values }
    func beginPlayback(_ item:CatalogItem)->PlaybackAnalyticsContext? {
        let ticket=epoch
        return PlaybackAnalyticsContext.begin(item:Self.item(item),startedAt:ProcessInfo.processInfo.systemUptime*1000,epoch:ticket,enabled:policy.enabled) { [weak self] name,values in self?.event(name,values,epoch:ticket) }
    }
    func playback(_ item:CatalogItem,context:PlaybackAnalyticsContext?)->PlaybackAnalytics? {
        guard let context else { return nil }
        return context.admit(item:Self.item(item),epoch:epoch,enabled:policy.enabled) { [weak self] name,params in self?.event(name,params,epoch:context.epoch) }
    }
    func finishPreflight(_ item:CatalogItem,context:PlaybackAnalyticsContext,reason:String,failed:Bool) {
        let sink:(String,[String:Any])->Void={ [weak self] name,params in self?.event(name,params,epoch:context.epoch) }
        if failed { context.fail(item:Self.item(item),epoch:epoch,enabled:policy.enabled,reason:reason,emit:sink) }
        else { context.end(item:Self.item(item),epoch:epoch,enabled:policy.enabled,reason:reason,emit:sink) }
    }
}
