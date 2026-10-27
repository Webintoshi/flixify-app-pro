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
