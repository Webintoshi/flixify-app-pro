# 26 Ekim 2026 — Kişisel bağlantı yayını doğrulaması

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

- Sağlayıcı altı ulusal kanalın kısa EPG sorgusuna boş kayıt döndürdü. Kişisel XMLTV HTTP200,127bayt; kanal/program kaydı yok. Rehber bu durumda boş bilgisini gösterir.
- Departure11851 birinci sezon ikinci bölüm1305126.mp4, Mac Range sorgusunda HTTP206 verse de bağımsız Chrome native testinde metadata yüklenmeden MEDIA_ERR_SRC_NOT_SUPPORTED4 verdi. Aynı durum uygulamada görüldü. Dosyanın her tarayıcıda oynadığı iddia edilmez; birinci bölüm oynadı.
- Gerçek MKV veya Safari oynatma örneği doğrulanmadı. Sağlayıcı dosyalarının tamamının tarayıcı uyumluluğu garanti edilmez.

## İşletim notu

Derleme önbelleği diski doldurduğunda Coolify kontrol veritabanının mevcut konteyneri mount/no-space hatasıyla durmuştu. Yeniden üretilebilir önbellek temizlendi, aynı kontrol veritabanı başlatıldı ve hazır/sağlıklı olduğu doğrulandı. Flixify veritabanı yeniden oluşturulmadı. Yalnız bu çalışmanın kullanılmayan, hiçbir konteynerin referans vermediği eski aday imajları kaldırıldı; mevcut geri dönüş kaynak imajları korunuyor.

## Alınan kararlar

- Ruling: parallel Task1/API and Task2/new adapter under frozen JSON contract — developer requires useful independent delegation; disjoint files avoid conflicts — wrong contract requires reviewable rework, not production mutation.

- Ruling: no new arbitrary-ID server playback endpoint or trusted-client-category assertion — personal browser constructs fixed-origin URLs from fresh authorized bootstrap, same personal provider entitlement already exposed in media URLs — browser presentation is not claimed as tamper-resistant parental enforcement.

- Ruling: current effective movie policy stays general-only; exact known category aliases, unknown/adult fail closed everywhere — actual provider aliases observed in authenticated line bouquet UI — a missing alias hides a legitimate category until explicitly inspected.

- Ruling: split Task3 into API reference storage and frontend integration under frozen endpoints below — independent files except server versus frontend, developer delegation requirement — review each before integration gate.

- Ruling: Task4 live consumer proceeds in parallel under frozen context personalProvider/providerMode, disjoint canli-tv files from Task3b platform files — saves serial UI work without shared mutation; final integration TS/tests and browser gates remain.

- Ruling: release DB guard pins actual healthy runningpostgres:16-alpine digest721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea instead of comparing it to the newer downloaded floatingtag digestf4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36 — no database recreation/retag/ComposeDBmutation; exact configtag+immutableactualdigest and beforeaftercontaineridentity remain enforced — wrong baseline would stop release and require source inspection, never silently accept unknown DB image. Operational fix scopedreview pending, app5002unchanged.

- Mevcut branch üzerinde commit/push ve mevcut Coolify yayını kullanıcı tarafından önceden yetkilendirildiği için yeni bir PR/merge seçimi istenmedi. Branch ve yerel çalışma dizini korunur.
