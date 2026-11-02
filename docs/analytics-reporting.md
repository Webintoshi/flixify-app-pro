# Flixify Analytics kullanım rehberi

Bu rehber, web sitesi/PWA ile Android TV, macOS ve Windows için hazırlanan ölçümlerin nasıl okunacağını anlatır. Rehberin hazırlanması; canlı yayına geçildiği, tüm uygulamalardan Google’a veri ulaştığı veya raporların dolduğu anlamına gelmez. Bunlar yayımlama ve gerçek veri doğrulamasında ayrıca kontrol edilir.

## Doğru hesabı ve platformu seçme

[Google Analytics’i aç](https://analytics.google.com/analytics/web/#/p561894481). Hesap **414333504**, Flixify’a ayrılan GA4 mülkü **561894481** olmalıdır. Başka projelerin mülkleriyle karıştırma.

Dört ayrı veri akışı vardır:

| Akışın amacı | `client_platform` değeri | Gerekli sürüm |
| --- | --- | --- |
| Web sitesi ve kurulu PWA | `web`, `pwa` | Yeni web sürümü; açık eski sekmede yenileme gerekebilir |
| Android TV | `android_tv` | **1.4.8**, sürüm kodu 16 |
| macOS | `macos` | **1.0.1, Build 3** |
| Windows | `windows` | **1.0.2** |

Eski uygulama sürümlerinin yeni olayları göndermesi beklenmez. Uygulama güncellemesi ile ölçüm izni ayrı konulardır; kullanıcı güncel sürümde de izin vermeyebilir. Windows akışının Google’da “Web” türünde görünmesi normaldir: uygulama olayları güvenli sunucu aktarımıyla bu ayrı akışa gönderilir. macOS, Apple uygulama akışı altında görünebilir. Karşılaştırmalarda **akış adı** ve **`client_platform`** alanını birlikte kullan.

## İlk bakılacak ekranlar

**Raporlar → Gerçek zamanlı:** Son 5 ve 30 dakikanın kullanıcı/olay hareketlerini görmek için kullan. Bir platformu karşılaştırma veya akış filtresiyle ayır; `login`, `page_view`, `screen_view`, `app_screen_view`, `video_start` gibi olayları kontrol et. Mobil/uygulama ölçümleri toplu gönderilebildiği için her tıklamanın anında görünmesi beklenmez. Gerçek zamanlı görünüm tam gün raporu değildir. [Google’ın Gerçek zamanlı rapor açıklaması](https://support.google.com/analytics/answer/9271392?hl=tr).

**Raporlar → Etkileşim → Etkinlikler:** Hangi olayın kaç kez oluştuğunu gör. Menü iş hedeflerine göre düzenlenmişse aynı rapor “Kullanıcı davranışını inceleme” altında bulunabilir. Bir rapor görünmüyorsa yönetici/editör, **Raporlar → Kitaplık** üzerinden ilgili koleksiyonu yayımlayabilir. [Google’ın rapor koleksiyonları rehberi](https://support.google.com/analytics/answer/12924233?hl=tr).

**Raporlar → Etkileşim → Sayfalar ve ekranlar:** Web sayfaları ile Android/macOS ekranlarını incele. Windows için standart ekran raporu tek başına yeterli değildir; aşağıdaki `app_screen_view` keşfini kullan. [Google’ın sayfa ve ekran raporu rehberi](https://support.google.com/analytics/answer/12926732?hl=tr).

**Keşfet → Serbest biçim:** Platform, içerik, paket ve oynatıcı ayrıntıları için kullanacağın ana alan. Satırlara bir boyut, değerlere olay sayısı veya ilgili özel metriği ekle; ardından olay adına ve platforma filtre koy. Aynı kullanıcı davranışını farklı olaylardan toplarken filtreyi mutlaka kontrol et.

Standart raporların oturması ve yeni özel boyut/metriklerin kullanılabilir olması için **24–48 saat** gerekebilir. Bugünün eksik verisini dünün tamamlanmış verisiyle doğrudan karşılaştırma. Google’a bir isteğin başarıyla gönderilmesi de olayın raporda işlendiğinin tek başına kanıtı değildir. [Veri güncelliği](https://support.google.com/analytics/answer/11198161?hl=tr), [olay parametrelerinin raporlanması](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters).

## Özel boyut ve metrikler

**Yönetici → Verilerin gösterimi → Özel tanımlar** bölümünde, mevcut tanımları kontrol et. Eksik olanları editör/yönetici yetkisiyle ekle; aynı parametreyi farklı adlarla tekrar oluşturma. Aşağıdaki metin alanları **olay kapsamlı boyut**, sayısal ölçümler ise **özel metrik** olarak tanımlanır. Bunlar kodda gönderilen parametre adlarıdır; yazımlarını aynen kullan. [Google’ın özel boyut/metrik açıklaması](https://support.google.com/analytics/answer/14240153?hl=tr).

| Öncelikli boyut | Ne için kullanılır? |
| --- | --- |
| `client_platform` | Web, PWA, Android TV, macOS, Windows karşılaştırması |
| `app_version` | Sorunu belirli uygulama sürümüne ayırma |
| `screen_name` | Ana sayfa, filmler, diziler, canlı TV, favoriler, hesap gibi ekranlar |
| `content_type` | `live`, `movie`, `series`, `episode` ayrımı |
| `content_name` | Güvenlik filtresinden geçmiş katalog başlığıyla okunabilir içerik raporu |
| `category_name` | Güvenli katalog kategori adı |
| `reason` | Sabit hata/çıkış nedeni grupları |
| `timing_method` | Web’de ilk kare ölçüm yöntemini ayırma; her platformda bulunmaz |
| `package_id`, `package_months`, `package_users` | Paket, süre ve bir/iki eşzamanlı kullanıcı ayrımı |
| `offer_id` | Karşılama indirimi gibi teklifleri ayırma |
| `source_platform` | Uygulamadan web ödeme sayfasına gelen yönlendirme mevcutsa kaynağını görme |
| `download_platform` | APK, macOS ve Windows indirme ilgisi |

`content_id` ve `category_id`, katalog kimliklerinden üretilmiş anlamsızlaştırılmış değerlerdir. Kayıtlı kullanıcı kodu değildir. Başlık güvenli bulunmadığında `content_name` gönderilmeyebilir. Önce okunabilir adlarla raporla; binlerce farklı değer üreten kimlikleri gereksiz yere özel boyut olarak ekleme. Çok yüksek çeşitlilik, raporların “diğer” satırında birleşmesine neden olabilir.

| Özel metrik parametresi | Birim | Filtrelemen gereken olay |
| --- | --- | --- |
| `startup_ms` | Milisaniye | `video_start` |
| `buffer_ms` | Milisaniye | `playback_buffer` |
| `watch_ms` | Milisaniye | **Yalnız `playback_end`** |
| `result_count` | Standart sayı | `search` |
| `query_length` | Standart sayı | `search` |
| `progress_percent` | Standart sayı | `video_progress` |

GA’nın hazır satın alma geliri, satın alma sayısı ve olay sayısı alanlarını ayrıca özel metrik olarak çoğaltma. Milisaniye birimiyle özel metrik oluşturulabilir. Bu metrikleri daha sonra Keşfet’te içe aktarabilirsin. [Google’ın özel metrik oluşturma adımları](https://support.google.com/analytics/answer/14239619?hl=tr).

## Hazır kurulabilecek raporlar

### 1. Platform ve ekran kullanımı

Serbest biçimde satırları `client_platform`, ardından `screen_name` yap. Değerlere **Olay sayısı** ekle. Web için `page_view`, Android/macOS için `screen_view`, Windows için `app_screen_view` olaylarını seç. Bu sayılar ekran ziyaretini gösterir; filmi gerçekten izlemeye başlama sayısı değildir.

İlk ekran raporunda şu grupları izle: `home`, `movies`, `series`, `live`, `favorites`, `account`, `packages`, `search`. Bazı platformlarda arama veya detay, ayrı ekran olarak ölçülebilir. Kullanıcının hangi yolu izlediğini görmek için Keşfet’te ekranlar arasında yol analizi de yapılabilir.

### 2. Popüler içerikler ve favoriler

**Satırlar:** `content_name`, `content_type`. **Sütunlar:** `client_platform`. **Değer:** Olay sayısı.

- `select_content`: içeriğe ilgi/tıklama.
- `video_start`: oynatıcıdan ilk kare sinyali alınan başlangıç.
- `add_to_wishlist`, `remove_from_wishlist`: favoriye ekleme/çıkarma hareketleri.

“En çok izlenen” listesi için `video_start` filtresini kullan; afiş tıklamalarını izlenme diye sunma. `add_to_wishlist` sayısı da bugün favorilerde kayıtlı toplam içerik sayısı değildir. Bu, dönem içindeki ekleme hareketidir.

### 3. Arama ve kategoriler

`search` olayında aramanın **uzunluğu** ve varsa **sonuç sayısı** ölçülür. Kullanıcının yazdığı kelime gönderilmez; “Kullanıcılar tam olarak ne aradı?” raporu bu sistemde yoktur.

Arama sayısını platform/sürüm bazında takip et. `result_count` parametresi bulunan olaylarda sıfır sonuç oranını incele. `category_select` ile kategori tercihlerini, `catalog_page_loaded` ile katalogda ilerleme/yeni içerik yükleme hareketini karşılaştır. Bunları birbirine ekleyerek arama sayısı üretme.

### 4. Yayın açılışı, donmalar ve izleme süresi

Önce `content_type = live` filtresini koy; film/dizi ile canlı yayını ayrı incele. Ardından `client_platform` ve `app_version` ile daralt.

| Soru | Bakılacak ölçüm | Doğru yorum |
| --- | --- | --- |
| Yayın ne kadar sürede açılıyor? | `video_start` içindeki `startup_ms` | İzleme isteğinden ilk kare sinyaline kadar geçen süre |
| Kaç açma isteği var? | `playback_request` olay sayısı | Görüntü başlamadan iptal edilen/başarısız istekleri de kapsayabilir |
| Yayın sırasında bekleme var mı? | `playback_buffer` sayısı ve `buffer_ms` toplamı | Başlangıçtan sonraki tampon beklemeleri |
| Hata artmış mı? | `playback_error`, `reason` | Kontrollü neden grupları; ham hata/bağlantı metni değildir |
| Ne kadar izlenmiş? | `playback_end` üzerinde `watch_ms` | Oynayan süre; duraklama ve tampon beklemesi izleme süresine eklenmez |
| Film/bölüm tamamlanıyor mu? | `video_progress`, `video_complete` | İlerleme eşikleri ve doğal bitiş; canlı yayın için bitirme oranı aranmaz |

Özel metrikler toplam gösterebilir. Ortalama açılış süresi için, **`video_start` filtresindeki `startup_ms` toplamını aynı olay sayısına böl**. “Ortalama etkileşim süresi” farklı bir GA metriğidir; yayın açılış süresi yerine kullanılmaz.

`watch_ms` bazı platformlarda ilerleme olayında da bulunabilir. Bu yüzden bütün olaylardaki `watch_ms` değerlerini toplama; yalnız `playback_end` üzerinden hesapla. Aynı şekilde kümülatif `buffer_count` değerlerini olaylar arasında toplama; donma adedi için `playback_buffer` olay sayısını kullan. Cihaz kapanır veya uygulama çökerse son kapanış olayı gelmeyebilir ve izleme süresi eksik kalabilir.

Web’de desteklenen tarayıcılar gerçek kare geri çağrısını kullanır; diğerlerinde oynatma/veri sinyaliyle yaklaşık başlangıç ölçümü yapılır. `timing_method` bunu ayırır. Farklı oynatıcıların sinyalleri değişebildiği için önce aynı platform ve sürüm içinde kıyas yap. Bu veriler FPS, görüntü kalitesi veya sunucu kapasitesinin doğrudan ölçümü değildir.

### 5. Paket ilgisi, ödeme ve aktivasyon

Aşağıdaki basamakları ayrı takip et:

| Olay | Anlamı |
| --- | --- |
| `trial_select` | Ücretsiz deneme seçildi |
| `welcome_offer_select` | Karşılama indirimi seçildi |
| `package_open` | Yerel uygulamadan paket sayfası başarıyla açıldı; ödeme yapılmış değildir |
| `view_item_list` | Web’de paket listesi görüntülendi |
| `select_item` | Bir paket seçildi |
| `begin_checkout` | Ödeme akışı başlatıldı; para tahsil edildiği anlamına gelmez |
| `purchase` | Sunucuda doğrulanmış başarılı, gerçek moddaki ödeme |
| `package_activated` | Ödeme sonrası erişim tanımlama işlemi tamamlandı |

**Raporlar → Para kazanma → E-ticaret satın alma işlemleri** ekranında paket ve geliri inceleyebilirsin. Menüdeki adlar değişirse Keşfet’te `purchase` filtresi, satın alma sayısı ve satın alma geliriyle aynı incelemeyi yap.

Gelir TRY olarak gerçek tahsilat tutarıyla gönderilir; indirimli ödeme liste fiyatıyla şişirilmez. Tarayıcı veya uygulama kendi başına `purchase` üretemez. Aynı doğrulanmış ödemenin yeniden işlenen bildirimi ikinci satış olarak kaydedilmez. Test, ödenmemiş veya doğrulaması tutmayan işlemler satışa dahil edilmez.

Native uygulamadan başlasa bile web’de tamamlanan ödeme **web/PWA akışında** raporlanır; mevcutsa `source_platform` alanı uygulama kaynağını gösterir. Native `package_open` olayını web `purchase` olayına doğrudan bire bir bağladığını varsayma: hesap koduyla cihazlar arası kullanıcı eşleştirmesi yapılmaz.

Ölçüm izni olmayan veya geçerli ödeme ilişkilendirmesi bulunmayan satış GA raporuna girmeyebilir. Bu nedenle GA geliri tüm tahsilatların muhasebe toplamı değildir. İade/ters ibraz ve finansal mutabakat için Stripe ve uygulamanın ödeme kayıtları esas alınır. Bu sürümün satın alma ölçümü, otomatik bir iade raporu taahhüt etmez.

### 6. Trafik kaynağı ve indirmeler

**Raporlar → Edinme → Kullanıcı edinme / Trafik edinme** ekranları kaynak/ortam bilgilerini gösterir. Bu kurulumda ham yönlendiren adresler ve URL sorguları gizlilik amacıyla temizlenir; dolayısıyla kampanya/kaynak raporlarını eksiksiz reklam ilişkilendirmesi olarak yorumlama.

Windows yalnız Measurement Protocol üzerinden ölçülür. Otomatik tarayıcı/Firebase oturumu ve cihaz bağlamı bulunmayan bu aktarımda standart kullanıcı edinme, oturum, konum ve cihaz raporları sınırlı veya “atanmamış” olabilir. Windows kullanımını kendi akışı, `client_platform`, `app_version`, ekran ve oynatıcı olaylarıyla değerlendir. Google da tek başına sunucudan Measurement Protocol kullanımında raporların kısmi olabileceğini belirtir. [Google’ın Measurement Protocol kapsamı](https://developers.google.com/analytics/devguides/collection/protocol/ga4).

`file_download`, web’de indirme bağlantısına basılmasını gösterir; dosyanın kurulmasını kanıtlamaz. Uygulama güncelleme olaylarından `update_downloaded` doğrulanan indirmeyi, `update_completed` ise desteklenen akışta yeni sürümün açılışta algılanmasını anlatır. Platformun üretmediği güncelleme olayını eksik satış veya bozuk kurulum sayma.

## İzin ve raporların kapsamı

Analitik izni varsayılan olarak kapalıdır. Reddeden kullanıcı hizmeti kullanmaya devam edebilir; raporda görünmemesi hesabının olmadığı veya uygulamayı kullanmadığı anlamına gelmez. Ayarlardan izin geri alınabilir. İzin geri alındığında yeni ölçüm durur, bekleyen ölçümler ve ilgili anonim ödeme ilişkilendirmesi iptal edilir. Daha önce Google’a iletilmiş kayıtlar bu düğmeyle geriye dönük otomatik silinmez.

Özel olay alanlarında hesap kodu, e-posta, şifre, oturum anahtarı, yayın bağlantısı, ham arama kelimesi veya ham hata metni yer almaz. İçerik adları yalnız güvenli katalog verisinden alınır. Reklam kimliği ve reklam kişiselleştirmesi bu çalışmanın parçası değildir.

GA’daki “kullanıcı” sayısını toplam abone sayısı olarak okuma. Ölçüm anonim istemci/uygulama kimlikleriyle yapılır; aynı kişi farklı cihazlarda veya yenilenen anonim kimliklerle ayrı görünebilir. Günlük kararlar için önce izin veren ve güncel sürümü kullanan aynı platform grubunu önceki dönemle kıyasla; toplam üyelik ve tahsilatı uygulamanın kendi kayıtlarıyla kontrol et.
