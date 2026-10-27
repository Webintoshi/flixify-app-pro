# Android TV test APK — 27 Ekim 2026

## Kapsam ve kararlar

Kullanıcı tek ortak, basit/hızlı, tamamen kumandayla yönetilen Android TV/box APK ve mevcut anasayfadan indirme istedi. Model bazlı dosya istemedi. Java native Views/Media3, Android6+/min23/target35, vip.flixify.tv,1.0.0-test.1/code1 uygulama kararlarıdır. Tek mimari bağımsız APK; yerel codec uzantısı yok. Cihazın medya codec/firmware desteği bu test sürümüyle evrensel olarak kanıtlanmış sayılmaz. Eski Qt/desktop ve APK dosyaları ayrı korunur.

Mevcut16karakter kodla giriş/yenileme, kişisel sağlayıcı metadatası+medyası TVIP'sindenHTTPS, exact webmovieallowlist, favoriler/izlenen bölümler mevcut API sözleşmesi; sunucu relay/proxy kullanılmaz. NativePlayer absoluteexpiry ve60sn/onresume/preplay güncelkontrolü,2snkontrolgizleme, canlızapping/VODseek/audiotext/next bölüm/localresume. TokenAndroidKeyStoreşifreli, sağlayıcıkimliği yalnızbellekte; testinjectionyalnıztrusteddebugJava, Intent/URLtetikleyicisiyok veR8release'dekaldırılmış.

Ruling: açık uygulama/yayın isteği altında aynıizole mevcutdal ve yetkiliCoolifykullanıldı; tekraronayakışıaçılmadı. Teknoloji/minAndroid6 ve yeniapkpaketkimliği builderkararıdır; yanlışvarsayım fizikselcihazgeri bildirimiyleiyileştirilir. Ruling: ayrıkdata/UI/player sahipliğinde donmuşinterface ileparaleluygulama developerdelegationgereği; sonentegrasyon/review/testgateskorundu. Ruling: gerçeksağlayıcı/yayın/hesapmutasyonu yapılmadı; fixture+yerelresmitestmedyası kullanıldı, fizikselTVtestinikullanıcıyapacak.

## Doğrulama ve düzeltmeler

Gradle8.13resmidağıtımSHA25620f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78doğrulandı; wrapperchecksumpinned. AGP8.13.2/Java17/SDK36/Media31.11.1resmiGoogleMavenbağımlılıkları. Kodtesti kaynak8f8f501tabanındanbaşladı.

Data6d2240b/73fe699:15parser/policy/source/cutofftesti; ilkreaderredmissingmodule,14green, nesting15thredsonra15green. ReviewikiP2buldu (geçAccountyayını/ilkfavoritetoggle);7gerçekrepositoryinstrumentationfixtureHTTPnesneleriyle4beklenenbehaviorRED/3passgörüldü;074cf54ikisinidüzeltti. TokenStore2şifreli/değiştirilmişvericasesgreen. Reviewsononaylı.

UI7432be3/58768ce: gerçeknativeTVIMEgörünürlüğü/kapanışınıbekleyenremoteOK/Back/Search,gridkategori/sezon/bölüm/favori/Back/retry/logout. İlkbootstrapkaynakbaşlatmanınbaşarılıhata/yüklenmesorunlarıveofflinehesaplogoutP2sbulunupregresyonlarıönceREDsonraGREENgörüldü. Player8c5bf17:12fixtureinstrumentationve19policyassertion; testfixtureItemidentityIntentserializationiledoğruanahtaraalındı,trackdialoggeçişlerikoşullabeklenir;livebaşlangıcıdefaultliveedge. Kodreviewtask1/2/3veTask4+broadfinalreviewonaylı; fizikselTV/uzunlistebütünkombinasyonlarınıkanıtladığıiddiaedilmez.

Parentsonkomut: testDebugUnitTest +connectedDebugAndroidTest +lintRelease.33/33emülatörinstrumentation (11UI+12player+7repository+2KeyStore+1realMedia3),16/16JUnit(15parser+1policy/19assertion),releaselint0error/15warning;1m32sbaşarılı. RealMedia3yalnızresmiAndroidXsample.mp4yereldosyayıaçtı,pause/seek/release/positionilerlemegeçti (101674baytSHA6aecd03e411743feec6e9d2bb0209ada82f176ad45a4a44cbd2df0ee8290c8f6,testAPKonly). RootwebTSC/diffcheckve9yeniartifactguardtestigreen.

İlkpre-fixoptimizerelease1,266,783bayt,nativeABI/testassetgirişi yok,min23/target35,debuggablefalse;imzav1/v2doğrulandı. FinalAPKbuilkdosyadanyayınlanmaz; onaylıkaynakcommitindensonratekrarderlenipkesinpinlerkaydedilecek.

## Yayın ön koşulu

YeniAPKyalnızversionedpublic/downloadsyoluve6webdosyasıoverlay. Kaynakweb44bd380/ad05c921,korunanworker539e01c/d5b9,API8cdbf9,gerçekDB721873.27Ekimsonsunucuokumasındadörthizmetrunning/0restart;disk9.83GiB. Coolifyoturumuetkin. API/bot/worker/Edge/DNS/sağlayıcı/askıdakisunucudeğiştirilmez. Sabitkaynak/byteshash/8GiBdisk/gerçekcgroupsınırlarıvefinalHTTP/MIME/range/digestgatesdağıtımöncesigereklidir.


## Final APK ve kaynak

- Android kaynak dondurma:041a8f85da4b47ddc0ce0200271d696b66cb5a87. Bu commit sonrasında assembleRelease37sn başarıyla bitti; uygulama Java/resources değişmedi.
- Versioned artifact: `/downloads/flixify-tv-1.0.0-test.1.apk`,1.266.867bayt, SHA256 `86d32ee772049a608ca5cd6b55632199766f61f5ca0e09cf298cdcf19dabb927`.
- OptimizeDEX içinde setRepositoryForTests/setEngineFactoryForTests/FakeTvRepository/NetworkTvRepositoryTest adları yok; nativeABI lib/ ve testMP4 yok. Final imza/kurulum/yayınkabulü aşağıda kaydedilecek.
- Final Task2 dalgası iki inceleme bulgusunu kapattı; iki gerçekREDregresyon ardından33/33instrumentation,16/16JUnitve lintRelease0error doğrulandı. Task1/2/3 ve broadcode/Task4 bağımsız onaylı.
- Ruling: sunucuda boş9,83GiB ve kaynakwebimaj13,91GiB; klasikBuildKit öncekiyayında~11,4GiBkopyaönbellek oluşturmuştu. Opsiyonelcontainer-build aynıimmutablekaynağıDocker'ınvarolan katmanlarıyla kullanır,network-none ve1280/1536MiBcgroupsınırında yalnız geçiciyapıkonteynerinde derler; özgünCmd/labelsrestored,sonadayconfig/ancestry/source/APKbytesveHTTPgatesaynenzorunlu. Böylece büyükkaynakönbelleğidublikatıyazılmaz ve diğeruygulamalara/önbelleklere dokunulmaz.11çevrimdışıguardtestibaşarılı; operasyoneldeltaincelemevekonteynergerçekkabulpending.


## Canlı yayın kabulü

- Final APK emülatöre kuruldu (`vip.flixify.tv/.MainActivity`,cold start1172ms/statusok); min23/target35/version1.0.0-test.1/code1, imza v1+v2 doğrulandı. Sertifika SHA256 `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`. Gerçek TV/box testi kullanıcıya aittir; gerçek sağlayıcı medyası veya hesap denemesi yapılmadı.
- Artifact/yayın kaynakcommit `04a5f5db46778332c20e011ba68c4d07ac38b62e`. Önce immutablebase/source/APKnewpath/hash ön kontrolü geçti. İncelemeli container-build actual1280MiB/1536MiB ve network-none ile geçti; özgün Nextconfig geri kondu, adayCmd/Env/labels/katmanataönek ve bütün kaynak/APKbytes doğrulandı. Geçici yapıkonteyneri ve salt yerel HEAD/MIME/GET/range kontrolkonteyneri kaldırıldı. BuildKit kaynakimajönbelleği duplikasyonu yapılmadı, eski cache/images/volumes silinmedi. Disk9,83→9,80GiB.
- Canlı web: `flixify-ops-web:edge-recovery-04a5f5db4677-20261026`, imaj `sha256:1d7a1fde872b02467cd245a28d45947468871fa35273e08b3f029fbd3a685034`. Korumalı dryrun/eşitleme/yalnızwebrecreate/HTTPsağlık+kararlı kimlik geçti. API8cdbf9, workerD5b9 ve gerçekDB721873 korundu. Son dört servis running/restart0; diğer hizmetler yeniden oluşturulmadı.
- Genel HTTPS APK HEAD200, MIME `application/vnd.android.package-archive`, Content-Length1266867 ve Accept-Rangesbytes. Aralık isteği206/`bytes 0-31/1266867`/32bayt. TamGET1266867bayt ve SHA256 `86d32ee772049a608ca5cd6b55632199766f61f5ca0e09cf298cdcf19dabb927` bire bir eşleşti. `/` ve `/indir`HTTP200.
- Canlı tarayıcı `/indir` yeni başlık, doğrudan APKanchor'ı, testversion/Android6+/tekAPK bilgisi ve kurulumadımlarını gösterdi. Oturumlu ana sayfa AndroidTVAPKindir+Kurulum bağlantısını gösterdi; yayın açılmadı. AnonymousLanding kaynak6dosyaoverlay/TSC ile doğrulandı; kullanıcıoturumu anonymouskontrolüiçin silinmedi. PublichomeilkserverHTMLclientbaşlangıçta downloadanchor içermez, gerçekhidrasyonluoturumluDOMiçerir. Ekrangörüntüsü `android-tv/public-download.png`, nativeReleaseLogin `android-tv/release-login.png` yerelvisualizationklasöründe saklandı.
- Kendi küçük start/PID/log/result/candidate/kilit kayıtları ve geçiciyapı/HTTPkontrolkonteynerleri temizlendi. Başlatılan emülatör kapatıldı; APK, kaynak, SDK ve imzalama anahtarı korundu. Çalışan veya geri dönüş imajı ve hiçbirvolume silinmedi.
