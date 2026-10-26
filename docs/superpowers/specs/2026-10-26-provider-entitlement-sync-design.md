# Sağlayıcı paket ve süre eşitlemesi

## İstek ve doğrulanmış durum

Kullanıcı sağlayıcı panelinde yaptığı paket tanımı/uzatmanın otomatik olarak Flixify'a yansımasını istiyor. Mevcut olayda sağlayıcı ücretli ve gelecek tarihliydi; uygulamada yalnız sona ermiş üç saatlik deneme vardı. Sağlayıcının mevcut Reseller API'sindeki `get_lines` ve `get_line` okunabiliyor. Hat ayrıntısı `package_id`, `exp_date`, `is_trial`, `enabled`, `admin_enabled` alanlarını veriyor. Mevcut 34 atanmış hesabın31'i engellenmemiş durumda. Paket kimlikleri8/9/10/11 mevcut bot sözleşmesinde1/3/6/12 aya eşleniyor.

## Yaklaşım ve uygulama kararları

Mevcut worker içinde yaklaşık60 saniyelik, kalıcı zamanlama ve kiralama kullanan salt okunur sağlayıcı denetimi. İstek başına dış API çağrısı yapmaya göre kullanıcı beklemesini azaltır ve mevcut API imajını korur. Panel için doğrulanmış webhook sözleşmesi bulunmadığından webhook varsayılmaz. Kullanıcının otomatik eşitleme isteği uygulama yetkisidir; yeni hat/paket satın alma, sağlayıcıda değiştirme veya mesaj gönderme yapılmaz.

- Kapsam yalnız Flixify hesabına zaten atanmış kişisel kullanıcı adı/şifre çiftleridir; ilk kayıt otomatik denemesi ve elle atanmış hatlar dahildir. İlgisiz yeni sağlayıcı hesabının hangi Flixify kullanıcısına ait olduğu tahmin edilmez.
- Silinmiş/engellenmiş hesaplar, boş veya ortak referans kimliği, birden fazla kullanıcıya atanmış aynı kimlik çifti işlenmez. Uygulama engeli kaldırılmaz.
- İlk eşleme tam kullanıcı adı araması ardından ayrıntı okumasıyla yapılır. Ayrıntı kimliği, kullanıcı adı ve şifre bire bir doğrulanır; belirsiz/çift sonuç reddedilir. Başarılı eşleme hat kimliğini sabitler. Ücretliye çevrilmiş/elle atanmış hat için eski otomatik deneme notu zorunlu tutulmaz. Yeni deneme oluşturmanın mevcut katı kontrolü aynen korunur.
- `get_line` aktif ücretli ve gelecek tarihli ise bitiş doğrudan sağlayıcının UTC tarihidir. Yerel tarihe ay eklenmez. Bilinen paket kimliği ilgili mevcut pakete eşlenir; bilinmeyen kimlik için satışta görünmeyen nötr `Sağlayıcı Paketi` kaydı kullanılır, kalan günlerden ay sayısı uydurulmaz. Bu nötr kaydın zorunlu duration alanı yalnız mevcut şema uyumluluğudur; ücretli bitiş hesabında kullanılmaz.
- Önceki deneme ve abonelik geçmişi saklanır. İlk ücretli eşitlemede ayrı, worker tarafından yönetilen abonelik oluşturulur ve çakışan aktif abonelikler audit ile kapatılır. Sonraki uzatma/kısaltmalar aynı yönetilen kaydın kesin bitişini günceller. Tekrar çalıştırma ek abonelik/audit üretmez. Süresi biten veya sağlayıcıda açıkça kapatılan doğrulanmış hat erişimi kapatır. Sonradan yeniden aktif ücretli hale gelirse yalnız bu eşlemenin yönettiği kayıt geri açılır. Yönetici tarafından başka nedenle iptal edilmiş kaydı körlemesine yeniden açma; engellenmiş/silinmiş kullanıcıya hiç erişim verme.
- `is_trial=1` gözlemi yeni deneme oluşturmaz ve denemeyi uzatmaz/sıfırlamaz. Aynı hat ücretliye geçtiğinde yeni ücretli kayıt kullanılır. Tamamlanmış otomatik deneme işinin doğrulanmış eski bitişi değiştirilmez. Ücretliden denemeye dönüş yönetilen ücretli erişimi kapatır.
- Başarısız ağ/JSON/kimlik/biçim doğrulaması erişimi uzatmaz ve kapalı hatmış gibi yorumlanmaz. Son başarılı bilgi korunur; sınırlı artan geri çekilme ve güvenli hata kodu yazılır. Ham yanıt, şifre, anahtar, URL veya hata metni log/audit'e girmez.
- Sağlayıcı istekleri DB satır kilitleri dışında yapılır. Uygulama işlemi kullanıcı/kimlik/eşitleme kaydını kilitler; kiralama jetonu, güncel kimlik/sürüm ve engel durumunu tekrar doğrular. Geciken eski kaynak yanıtı iptal edilir. Hat kimliği benzersizdir. Başarılı işler60sn sonra, hatalar en fazla15dk geri çekilerek yeniden zamanlanır. En fazla5 iş, en fazla2 eşzamanlı hat denetimi; ayrı süreç içi kilit ve300sn DB kiralaması. İş döngüsü mevcut deneme ve katalog işlerini sağlayıcı beklemesiyle durdurmaz.

## Arayüzde görünürlük ve oynatma

Sadece DB eşitlemesi yeterli değildir: açık sayfa da mevcut API'nin `/me` ve `/me/provider-session` bilgilerini60sn/odakta yeniden okuyacak. Aynı kaynak kimliğinde istemci, katalog ve çalışan oynatıcı korunur; yalnız doğrulanmış son bitiş ve hesap görünümü güncellenir. Aktif yayın sırf süre yenilendi diye yeniden kurulmaz. Kesin erişim reddi oynatmayı kapatır; geçici ağ hatası hâlâ geçerli erişimi yok saymaz. Eski hesap/hat yanıtı yeni hesaba yayınlanmaz. Hesabım ekranı, katalog kapısı ve canlı/film/dizi mutlak bitişleri güncel bilgiyi kullanır. Üç saatlik sonlandırma korunur. Gerçek yayın açılarak test yapılmaz.

## Dağıtım ve kabul

Yeni bağımlılık yok. API/Telegram/Edge/DNS/proxy değişmez. Önce eklemeli SQL göçü, sonra yalnız worker, ardından yalnız web korumalı dağıtılır. Kaynak imajlar ve gerçek DB kimliği sabitlenir; diğer hizmet kimlikleri her adımda korunur. Üretim kabulü gerçek salt okunur sağlayıcı gözlemi + eşitleme tablosu/audit/abonelik tutarlılığı; olumsuz/uzatma/süre kısaltma/yarış senaryoları kontrollü çevrimdışı testlerdir. Sağlayıcıdaki ücret/süre/hat hiçbir testte değiştirilmez.
