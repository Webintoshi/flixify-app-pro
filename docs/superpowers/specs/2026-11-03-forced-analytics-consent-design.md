# Geçici Otomatik Analiz İzni Tasarımı

## Amaç

Test süresince web/PWA, Android TV, macOS ve Windows istemcilerinde uygulamanın yönettiği kullanım analizi/çerez tercihini kullanıcı etkileşimi olmadan kabul edilmiş başlatmak. Giriş yapan kullanıcı izin banner'ı, popup'ı veya tercih kontrolü görmemeli; mevcut bir ret kaydı da analizi kapatmamalı.

## Hedefler

- Her istemcide mevcut analiz çalışma zamanını `accepted` durumunda başlatmak ve bu durumu saklamak.
- Önceden kaydedilmiş `unknown` veya `rejected` değerlerini otomatik kabul durumuna taşımak.
- İlk açılış/giriş izin ekranlarını, web altbilgi tercih düğmelerini ve hesap/ayar ekranlarındaki analiz tercih kontrollerini kaldırmak.
- Mevcut olay izin listelerini, hassas veri filtrelerini, kimlik sınırlarını ve analiz yapılandırması yokken kapalı kalma davranışını korumak.

## Kapsam Dışı ve Başarısızlık Ölçütleri

- Android paket kurucusu, işletim sistemi güvenlik onayı, çıkış onayı ve içerik detayları izin tercihi değildir; kaldırılmayacak veya atlanmayacak.
- Yeni reklam izleme, reklam kimliği izni, kamera, mikrofon, konum ya da dosya izni eklenmeyecek.
- Analiz yapılandırması bulunmayan veya doğrulanamayan istemci veri göndermeye zorlanmayacak.
- Eski bir ret kaydının analizi kapatması, herhangi bir izin yüzeyinin görünmesi veya izin değişikliğinin içerik erişimini etkilemesi başarısızlık sayılacak.

## Yaklaşımlar

1. **Seçilen: kaynak kodunda zorunlu kabul.** Her istemci çalışma zamanında kabul durumuna geçirilir ve izin arayüzleri kaldırılır. Tüm dağıtımlarda aynı davranışı verir, ek dağıtım anahtarı gerektirmez.
2. **Reddedilen: derleme/test anahtarı.** Geri dönüşü kolaylaştırır ancak dört istemcide anahtar taşıma ve yanlış yapılandırma riski yaratır.

## Uygulama Kararları

- Web çalışma zamanı, saklanan değerden bağımsız olarak kabul edilmiş başlayacak; depolama eşitlemesi ret durumunu geri getirmeyecek. Banner ve tüm tercih düğmeleri kaldırılacak.
- Android TV ve macOS analiz katmanları ilk kurulumda kabul durumunu kaydedip etkinleştirecek. Analiz popup'ı ile hesap/ayar tercih kontrolleri kaldırılacak.
- Windows analiz katmanı eski seçimi kabul durumuna taşıyacak. QML izin diyaloğu ve hesap anahtarı kaldırılacak.
- Zorunlu kabul sadece yapılandırılmış analiz hedefini etkinleştirir. Mevcut gizlilik filtreleri ve reklam amaçlı veri toplamama sınırları değişmez.
- Görsel yön korunur; yeni bileşen, metin veya görsel varlık oluşturulmaz. ENERGY/RHYTHM/MOTION değerleri mevcut ekranlarla aynı kalır.

## Doğrulama

- Önce her platformda eski ret/boş tercih ile otomatik kabulü ve izin yüzeylerinin yokluğunu kanıtlayan testler kırmızı çalıştırılacak.
- Ardından en küçük üretim değişikliğiyle testler yeşile getirilecek.
- Web test/build, Android birim derlemesi/testleri, macOS test/build ve Windows test/build imkan dahilinde tam olarak çalıştırılacak; çalıştırılamayan platform doğrulaması açıkça raporlanacak.
