# 26 Ekim 2026 — Kişisel bağlantı yayını doğrulaması

> Bu dosyanın ilk bölümleri gün içindeki önceki incelemeyi kaydeder. Yeni Türkiye sunucusu ve son dağıtım durumu için aşağıdaki **Türkiye Edge ve kesinti sonrası toparlanma** bölümüne bakın.

## Yayın

Mevcut https://flixify.vip ve https://api.flixify.vip güncellendi. Uygulama sürümü `5002a7a32d2a54c1b882f375c2bd43dc71d9c59c`, yayın betiği `262088d`.

| Hizmet | Çalışan imaj |
| --- | --- |
| API | flixify-api:personal-viewer-5002a7a-20261026 |
| Web | flixify-ops-web:personal-viewer-5002a7a-20261026 |

API kimliği `sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53`; web kimliği `sha256:93f913bc8f06137b83187d656d44c139b008df1ed92483f5ac82638e81db41f8`.

Salt okunur ön denetim, yapılandırma eşitleme, API/web yeniden oluşturma ve yayın sonrası hedef denetimi başarılı. Flixify veritabanı ve worker konteyner kimlikleri korundu. Ortam değerleri değişmedi. Sunucuda son kontrolde 13,51 GiB boş alan var; Coolify veritabanı ve Redis sağlıklı.

## Değişiklikler

- Film, dizi, kanal kataloğu, dizi ayrıntıları ve seçili kanal EPG isteği, doğrulanmış kişisel hatla tarayıcıdan yapılır.
- Her oynatma/yeniden deneme/bölüm geçişinde güncel hesap ve hat doğrulanır. Mutlak üyelik bitişi ve doğrulanmış üç saat deneme süresi uygulanır.
- Kişisel sağlayıcı oturumu bellekte tutulur. Hesap/hat değişimi, çıkış ve süre bitişi istekleri ve oynatıcıyı temizler.
- Favori ve bölüm kayıtları kullanıcı/hat/kaynak kimliğiyle ayrılır. Eski UUID tabanlı favori/progress kayıtları korunur; yeni kişisel ad alanına otomatik taşınmaz.
- Mevcut tasarım, renkler, kayıt adımları, erişim kuralları ve canlıya özel oynatma motorları korunur.

## Kanıtlar

- Tam proje testleri: contracts 14, API 245, worker 64 başarılı.
- Son kişisel tarayıcı testleri 35, mevcut oynatma politikası/süre testleri 25, yayın politikası testleri 35 başarılı. Web TypeScript kontrolü başarılı.
- Gerçek API aday imajında, ağ kapalıyken 36 oynatma +18 kişisel oturum +23 kişisel kütüphane testi başarılı.
- Canlıya özel API kaynakları, sabit kaynak hashleri üzerinden standart bağlamlı Git yamasıyla korundu. Web kaynakları ve aday imaj dosyaları sabit commit ile doğrulandı.
- Gerçek Chrome ve kişisel sağlayıcı hattı: 11.955 film, 1.675 dizi, 16.070 kanal; sekiz katalog/ayrıntı/EPG eylemi HTTP200, ilk toplam 2.214 ms.
- Yerel Next arayüzü + yalnız bellekte tutulan yerel test kimliği + gerçek sağlayıcı: film1305279 ve dizi1303486 1920px görüntü/ilerleme; seri11851 iki sezon/24bölüm; favori ekleme ve sayfalar arasında koruma; AtvHD 1280px ve26,13→164,45sn ilerleme; testten çıkışta oynatıcı ve katalog temizlendi. Bu test üretimde kullanıcıya paket vermedi.
- Canlı API sağlık ve site kökü HTTP200. Yeni kişisel uç noktalar yetkisiz çağrıda HTTP401 ve private/no-store döndürüyor. Coolify giriş sayfası HTTP200.
- Gerçek yayındaki açık hesabın arayüzü: “Aktif paketin yok”. Bu hesapta pozitif oynatma yetkisi verilmedi; üretimde aktif üyelikli hesapla uçtan uca oynatma doğrulaması yapıldığı iddia edilmez.

## Sınırlar

### Aynı gün inceleme: yeni Edge kurulmadan önceki durum

- Aktif üç saatlik deneme hesabında uygulama ve doğrulanmış sağlayıcı bitişleri eşitti; kişisel kimlik bilgileri ortak hat değildi. Ancak canlı `shared_source_base_url` değeri `http://sifiriptvdns.com` olduğundan HTTPS isteyen kişisel bootstrap reddediliyordu. Yalnız bu alan, koşullu güncellemeyle `https://sifiriptvdns.com:2087` yapıldı. Bootstrap uygunluğu ve canlı kişisel katalogdaki 11.955 film doğrulandı; uygulama imajları değiştirilmedi.
- **Bu aşamada üretim HTTPS oynatma kabulü başarısızdı.** Gerçek Chrome ve uygulama içi tarayıcıda film1305279 görüntü vermedi. Aynı kişisel medya adresinin Mac üzerinden sınırlı Range ölçümü HTTP206/video/mp4 döndürdü; nihai adresin şeması **HTTP**, sunucusu `2.27.107.133` idi. Aynı video yerel HTTP test sayfasında Chrome'da 1920×1080, readyState4 ve zaman ilerlemesi verdi. Bu karşılaştırma, önceki localhost kabulünün üretim HTTPS yönlendirmesini doğrulamadığını gösteriyor. Sağlayıcı JSON yanıtı HTTPS portunu2087, yayın protokolünühttp bildiriyor; standart443 denemesi bağlantı hatası verdi. Tarayıcı güvenliği zayıflatılmadı.
- Sağlayıcı VPN panelindeki **Flixify Edge Yeni /191.44.68.249 /edge.flixify.vip** çevrimdışıydı;22/80/443 bağlantıları zaman aşımına uğradı. Kullanıcı bu sunucunun süresini yenilemediğini ve artık kullanılmayacağını bildirdi. Sunucu yenilenmeyecek, geri getirilmeyecek veya yeniden kurulmayacak. Askıdaki191.44.68.37 ayrı bir makinedir ve kapsam dışıdır.
- Panelin **How It Works** açıklaması temiz VPS, Ubuntu önerisi, boş80/443 portları, alan adının VPS'ye A kaydı, otomatikSSL ve yalnız **Private CDN** etkin hatların bu sunucudan geçeceğini söylüyor. Belirli Ubuntu sürümü yazmıyor. İncelenen canlı deneme hattında Private CDN kapalıydı; değiştirilmedi. Kullanıcı yeni Türkiye konumlu sunucu satın alacağını bildirdi; yeni kurulum ve üretimde HTTPS medya kabulü bu sunucu sağlandıktan sonra tamamlanmalı.
- Aktif87.76.130.252 üzerinde eski Zeng gateway/keeper/companion/guard konteynerleri yoktu. Ayrı `relay.flixify.vip` hizmeti sağlıklı görünse de üç proxy uç noktası yapılandırılmıştı; bu incelemede hiçbir proxy geri getirilmedi veya relay yapılandırması değiştirilmedi. Mevcut relay sağlığı, sağlayıcıdan çalışır medya aktarımı kanıtı değildir.
- Ayrı kod bulgusu: aynı hesapta ilk bootstrap uygun değilken daha sonra paket açılırsa, mevcut SPA yalnız hesap kimliği değişiminde yeniden bootstrap yapıyor; odaklanma bunu yeniden denetlemiyor. Bu turda kod değişmedi. Yeni altyapı kurulurken bu durum ayrıca düzeltilip aynı hesapla doğrulanmalı.
- Geçici yerel medya sunucusu kapatıldı; test adresleri yalnız bellekte kullanıldı ve temizlendi. Kullanıcıya oynatma sorununun çözüldüğü söylenmedi.

- Sağlayıcı altı ulusal kanalın kısa EPG sorgusuna boş kayıt döndürdü. Kişisel XMLTV HTTP200,127bayt; kanal/program kaydı yok. Rehber bu durumda boş bilgisini gösterir.
- Departure11851 birinci sezon ikinci bölüm1305126.mp4, Mac Range sorgusunda HTTP206 verse de bağımsız Chrome native testinde metadata yüklenmeden MEDIA_ERR_SRC_NOT_SUPPORTED4 verdi. Aynı durum uygulamada görüldü. Dosyanın her tarayıcıda oynadığı iddia edilmez; birinci bölüm oynadı.
- Gerçek MKV veya Safari oynatma örneği doğrulanmadı. Sağlayıcı dosyalarının tamamının tarayıcı uyumluluğu garanti edilmez.

## İşletim notu

Derleme önbelleği diski doldurduğunda Coolify kontrol veritabanının mevcut konteyneri mount/no-space hatasıyla durmuştu. Yeniden üretilebilir önbellek temizlendi, aynı kontrol veritabanı başlatıldı ve hazır/sağlıklı olduğu doğrulandı. Flixify veritabanı yeniden oluşturulmadı. Yalnız bu çalışmanın kullanılmayan, hiçbir konteynerin referans vermediği eski aday imajları kaldırıldı; mevcut geri dönüş kaynak imajları korunuyor.

## Türkiye Edge ve kesinti sonrası toparlanma

- Yeni, Türkiye çıkışlı `87.76.130.17` hazırlandı. Ubuntu22.04 resmi paketleri güncellendi, paket denetimi temiz; yeniden başlatma sonrası kernel5.15.0-198. Root disk mevcut mantıksal birim içinde18GiB yapıldı; önbellek temizliği sonrası11GiB boş. Yedek alınmadı. Askıdaki ve süresi biten sunuculara işlem yapılmadı.
- Cloudflare'da yalnız DNS-only `edge.flixify.vip` A kaydı yeni IP'ye taşındı; iki genel çözümleyicide doğrulandı. Sağlayıcı kaydı yeni IP ile çevrimiçi; GeoProxy80/443 dinliyor. TLS doğrulaması başarılı, sertifika24Ocak2027'ye kadar geçerli. Root isteğinin HTTP400 yanıtı, imzalı medya yolu gerektiren hizmetin davranışıdır.
- Sağlayıcı panelindeki yeni IP/port kaydı ile yazılım kurulumu, işletim sistemi bakımı sürerken ortak oturumda görünür hale geldi. Bu rapor, root bilgilerinin sağlayıcıya ajan tarafından gönderildiğini iddia etmez.
- Aktif uygulama deneme hattında Private CDN başlangıçta kapalıydı. İş sahipliği/kimlik/bitiş kontrollerinden sonra yalnız bu bayrak açıldı; o işlemde şifre, kullanıcı adı veya süre değişmedi. Gerçek HTTPS üretim Chrome kabulü: ATVHD1280×720 ve beINSPORTS1FHD1920×1080/78,924sn ilerleme. Önceki localhost kanıtının HTTPS sınırı bu canlı TV örneklerinde giderildi. Film/dizi üretim kabulü henüz tekrar edilmedi.
- Sonraki sağlayıcı okumasında aynı hat aktif, CDN açık ve deneme dışı/26Kasım bitişli göründü. Bu çalışmada paket yükseltme veya süre uzatma yapılmadı; yeni gözlemin nedeni doğrulanmadan hesap süresine müdahale edilmedi.
- Kullanıcının PC'de kısa kesintiden sonra ancak yenilemeyle düzelen donması yeniden üretildi: yalnız buffered aralığına bakan kontroller, ilerlemeyen HLS akışını kaçırabiliyor; yeniden deneme sayacı bağımsız kesintiler arasında sıfırlanmıyordu. Web uygulama commit'i `2a7c60e07826fc3dd81606f8eb5534641a931bb7`, sekiz saniye gerçek ilerleme olmamasını izler; mevcut geri çekilme aralığıyla aynı kanalı güncel yetki üzerinden tekrar açar. Eski motor temizlenir; duraklatma, çıkış, hesap değişimi ve mutlak bitiş korunur. Sekiz saniye sağlıklı ilerleme yeniden deneme bütçesini sıfırlar.
- Yeni denemeler `private_cdn=1` ve `allow_epg=1` ile açılır; sağlayıcının ayrıntı yanıtından CDN/kimlik/iş sahipliği/üç saatlik bitiş doğrulanmadan uygulama erişimi verilmez. Worker uygulama commit'i `7731936e27df42925405f0686ccb8b625cb24abc`.
- Worker adayı ağ kapalıyken20 sağlayıcı regresyonunu geçti ve canlıya alındı: `flixify-worker:edge-recovery-7731936e27df-20261026`, `sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3`. API/web/DB kimlikleri bu adımda korundu. Canlı Telegram botunda zaten CDN bayrağı bulunduğundan bot yeniden dağıtılmadı.
- Web canlıya alındı: `flixify-ops-web:edge-recovery-2a7c60e07826-20261026`, `sha256:1a1e54ab741b5564462ed62645a7590617420ea5005b68595676f6e63df52552`. Yalnız web yeniden oluşturuldu; API/worker/DB kimlikleri korundu. Tam bu konteynerin HTTP200 yanıtı ve kararlı kimliği doğrulandı; web ve worker yeniden başlama sayısı sıfır. Derleme tek RUN içinde1280MiB RAM/1536MiB toplam RAM+swap ile sınırlandı; gerçek cgroup sınırları derlemeden önce doğrulandı. Geçici Next ayarları geri yüklendi ve `.next/cache` temizlendi.
- Genel HTTPS `/canli-tv` HTTP200; sayfanın `page-74473dd45b3fc3e6.js` dosyası43.274bayt, SHA256 `9f98109229da9c534e5b2205e679699b6ade3378368797ea4af60e22de0641eb`.
- Derleme sonrasında ana sunucuda boş alan1,9GiB'ye indi; aday imaj kaynak imajdan yalnız12MB büyüktü. Yalnız bu derlemenin son kaydından erişilen,18:40:17–18:43:49UTC arasında oluşturulmuş390 kullanılmayan önbellek kaydı seçildi; eski beş kayıt kapsam dışı bırakıldı. Tam kimlik seçimi ön izlemede eşleştirildi, yalnız bu kimlikler temizlendi. Araç14,66GB temizlendiğini bildirdi; gerçek boş alan yaklaşık14GiB'ye döndü, çalışan web/worker korundu. Hiçbir imaj veya volume silinmedi. `inuse=false` filtresi kullanılmamalı; BuildKit bu alanı boolean metni olarak işlemez. Temizlenebilirlik doğrudan `Reclaimable=true` ile doğrulandı, aktif referansları araç kendi korur.
- Kullanıcı maç izlediğini, gerçek yayın testlerini kendisinin yapacağını söyledi. Bu talimattan sonra yayın testi yapılmadı. Geçici alt köşe “Yayın dengeleniyor…” rozetinin kaldırılması istendi; uygulama commit'i `f8737c27d1d161d5268e8003bf53ef0a7a91147d` yalnız bu rozeti kaldırır. Arka plandaki toparlanma ve kalıcı hata/tekrar deneme arayüzü korunur. Altı hedef regresyon ve TypeScript başarılı.
- **Son canlı web sürümü:** `flixify-ops-web:edge-recovery-f8737c27d1d1-20261026`, `sha256:854cb6904c119522baa442b3083551e4976657659476f3994150b080ebaeab4c`. Sessiz arayüz dağıtımının ön denetim, yapılandırma eşitleme ve yalnız web yeniden oluşturma adımları başarılı; API/worker/DB korundu. Genel HTTPS sayfa HTTP200, yeni `page-e00dc0a123fc17d4.js`43.122bayt/SHA256 `1f55eecc61ee414f1b254709a3523644840b75d701cd27e3252ece049c95f0c1`; geçici durum metni bu dosyada yok. Gerçek yayın açılarak doğrulama yapılmadı.
- İkinci derlemenin de yalnız kendi son kaydından erişilen392 yeni, temizlenebilir kaydı tam kimlik eşleştirmesiyle kaldırıldı; eski beş kayıt ve tüm imajlar korundu. Araç14,67GB temizleme bildirdi. Derleme için kullanılan küçük geçici PID/başlangıç/sonuç/kimlik dosyaları kaldırıldı. Açık kullanıcı sayfası mevcut JavaScript'i çalıştırmaya devam eder; yeni arayüz için kullanıcının uygun zamanda bir kez yenilemesi gerekir.
- Doğrulama:6 yeni gerçek React DOM donma regresyonu; session ile birlikte17 hedef test; tam proje330 test (14contracts/245API/71worker); TypeScript başarılı. Dağıtım araçlarında22worker/10webrelease/5gerçek Node builder testi başarılı ve bağımsız inceleme temiz.
- Sunucu ölçümünde düşük CPU/bellek ve gözlenen TCP bağlantılarında yeniden iletim yoktu; bu, sağlayıcının hiç kesilmeyeceği veya çok kullanıcılı yük kapasitesi garantisi değildir. Tek bağlantılı kullanıcı hattında eşzamanlı test oynatıcısı açılmadı. Otomatik toparlanma regresyonları geçse de gerçek kullanıcının yeni sürümdeki PC izlemesi ayrıca gözlenmelidir.

## Alınan kararlar

- Ruling: parallel Task1/API and Task2/new adapter under frozen JSON contract — developer requires useful independent delegation; disjoint files avoid conflicts — wrong contract requires reviewable rework, not production mutation.

- Ruling: no new arbitrary-ID server playback endpoint or trusted-client-category assertion — personal browser constructs fixed-origin URLs from fresh authorized bootstrap, same personal provider entitlement already exposed in media URLs — browser presentation is not claimed as tamper-resistant parental enforcement.

- Ruling: current effective movie policy stays general-only; exact known category aliases, unknown/adult fail closed everywhere — actual provider aliases observed in authenticated line bouquet UI — a missing alias hides a legitimate category until explicitly inspected.

- Ruling: split Task3 into API reference storage and frontend integration under frozen endpoints below — independent files except server versus frontend, developer delegation requirement — review each before integration gate.

- Ruling: Task4 live consumer proceeds in parallel under frozen context personalProvider/providerMode, disjoint canli-tv files from Task3b platform files — saves serial UI work without shared mutation; final integration TS/tests and browser gates remain.

- Ruling: release DB guard pins actual healthy runningpostgres:16-alpine digest721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea instead of comparing it to the newer downloaded floatingtag digestf4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36 — no database recreation/retag/ComposeDBmutation; exact configtag+immutableactualdigest and beforeaftercontaineridentity remain enforced — wrong baseline would stop release and require source inspection, never silently accept unknown DB image. Operational fix scopedreview pending, app5002unchanged.

- Mevcut branch üzerinde commit/push ve mevcut Coolify yayını kullanıcı tarafından önceden yetkilendirildiği için yeni bir PR/merge seçimi istenmedi. Branch ve yerel çalışma dizini korunur.
