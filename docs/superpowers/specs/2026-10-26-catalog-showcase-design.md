# Ortak günlük film ve dizi vitrini

## İstek ve kararlar

Kullanıcı film/dizi sayfalarında sürekli aynı içerikleri görmeyi düzelttirmeyi istedi. Yaklaşım sorusuna **“Herkese ortak, düzenli değişen vitrin”** yanıtını verdi. Kişiselleştirme yapılmaz. Günlük yenilenme, Türkiye saat dilimi ve aşağıdaki teknik ayrıntılar uygulama kararlarıdır; kullanıcı tarafından ayrı ayrı seçilmiş gibi sunulmaz.

## Mevcut sorun

Kişisel sağlayıcı istemcisi tam, doğrulanmış kataloğu zaten getiriyor. Arayüz sıralamadan ilk48 kaydı kesiyor; ilk12, ilk5 ve ilk karşılaşılan kategorileri tekrar kullanıyor. Film kategorileri ana satırdaki afişleri yineliyor. Normalize edilmiş veride puan, çıkış tarihi ve popülerlik yok.

## Yaklaşımlar

- Kullanıcının seçtiği ortak günlük vitrin: herkes için aynı günlük sıralama, kategori dengesi ve satırlar arasında tekrar azaltma.
- Favorilere göre kişiselleştirme: mevcut favoriler kullanılabilirdi; kullanıcı ortak vitrini seçtiğinden kapsam dışı.
- Her istekte rastgele karıştırma: ortak seçim ve kararlı sayfalama sağlamaz; uygulanmaz.

## Davranış

- Gün anahtarı Europe/Istanbul takviminden üretilir. Sıralama aynı katalog/gün için deterministiktir; girdi sırası değişmesi sonucu değiştirmez.
- Ortak sıralamada kişisel kaydın `personalRef.kind + id` kimliği kullanılır. Hesap, token, kaynak sürümü ve favoriler sıralamaya girmez. Önbellek ve asenkron yayın sahipliği hesap/sağlayıcı kaynağına bağlı kalır.
- Tüm kişisel katalog **48'lik kesimden önce** dengelenir: farklı kategorilerden ilk12, günlük dönüşümlü en fazla4 kategoriye ait12'şer seçim, kalan arşiv. Bütün özgün kayıtlar sıralama çıktısında korunur; arama/kategori filtreleri özgün sırayı ve sayıları korur.
- Öneri satırlarında aynı kimlik ve aynı türde aynı normalize edilmiş başlık tekrarlanmaz. Film devam numaraları/yılları silinmez. Engellenmiş/kullanılamayan kayıtlar önerilmez; hiçbir yeni oynatma yetkisi verilmez.
- Ana sayfanın mevcut büyük görseli ve film/dizi satırları da aynı ortak seçkiden beslenir; büyük görsel adayları öneri satırlarında tekrarlanmaz. Canlı TV sıralaması değişmez.
- Tek görünüm boyunca ham tam katalog ve günlük sıralama bir kez hesaplanır. Daha Fazla Göster aynı sırayı sürdürür; kaynak değişiminde eski yanıt gösterilmez.
- Tarih değişimi görünürlük/odaklanma ve hafif zamanlayıcıyla denetlenir. Arama, kategori, açık detay veya ilerlenmiş sayfalama sırasında sıra zıplamaz; sonraki güvenli ilk sayfa/gezinme yeni günü alır. Gün değişimi sağlayıcıya yeni istek atmaz.
- Eski API modu yalnız sunucu sayfalarını sağlar. Bu sürüm tüm eski sayfaları taramaz; ana sayfada eldeki sayfalar günlük sunulur; film/dizi keşfinde sağlayıcı sırası ve ortak tekrar önleme, sayfalama kararlılığı için korunur. Tam arşivden günlük seçim kişisel modda yapılır. Bu sınır gizlenmez.
- Ürün metni “Günün Seçkisi”dir; gerçek verisi olmayan popülerlik/yenilik iddiaları eklenmez.

## Sınırlar ve kabul

Renkler, afiş önizlemesi, kayıt, favori işlemleri, arama, kategori düğmeleri, erişim/süre ve oynatıcılar korunur. Yeni bağımlılık veya sağlayıcı isteği eklenmez. Gerçek yayın açılarak test yapılmaz.

Kabul: farklı kişisel kaynak sürümleri aynı sağlayıcı kimlikleri için aynı sırayı görür; ertesi gün değişir; ilk48 kataloğun tek önekine sıkışmaz; öneri satırları ayrışıktır; arama/kategori ve ardışık sayfalar kayıpsızdır; geç kalan eski hesap yanıtı ve süre bitişi görünümü sızdırmaz.
