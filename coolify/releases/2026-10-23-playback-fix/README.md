# 23 Ekim oynatma düzeltmesi: aktif Coolify hizmeti

Yalnız `eupquokyj7qegufqvqkjmuyr` hizmetindeki **api** ve **ops-web** imajları
güncellenir. Askıdaki sunucuya, db/worker/VPN konteynerlerine, sağlayıcı
ayarlarına ve yedeklemeye dokunulmaz. Bu komutları **87.76.130.252** aktif
sunucusunda çalıştırın. Coolify panelinde ayrıca Deploy düğmesine basmayın.

Kaynak olarak `39300d047403dc6c91618dd4a0fdad90ca131c63` commitini içeren bir
Git checkout ve bu klasördeki iki Python betiği gerekir. Kaynak checkout
değiştirilmez. Betikler mevcut API ve web imajlarının sabit imaj kimliklerini,
çalışan konteynerleri, değişen dosyaların commit öncesi içeriğini, aday imajın
commit etiketini ve Coolify Compose durumunu doğrular. Fark varsa durur.

```sh
git -C /data/flixify/source cat-file -e '39300d047403dc6c91618dd4a0fdad90ca131c63^{commit}'
python3 /data/flixify/releases/2026-10-23-playback-fix/build-api-web.py /data/flixify/source
python3 /data/flixify/releases/2026-10-23-playback-fix/release-api-web.py
python3 /data/flixify/releases/2026-10-23-playback-fix/release-api-web.py --apply
python3 /data/flixify/releases/2026-10-23-playback-fix/release-api-web.py --recreate
```

`/data/flixify/source` gerçek checkout yoluna göre değiştirilebilir. Build
betiği API kaynak dosyasını sabit canlı imajdan çıkarır, sabit temel commit ile
`39300d0` arasındaki API yamasını `git apply --check` ile sınayıp uygular ve
adayın bu yamanın tam sonucu olduğunu doğrular. Böylece canlı API'deki mevcut film
kataloğu koruması korunur. Web için committe değişen kaynak dosyalarını sabit
canlı imajın üzerine koyup yeniden derler. Aday API imajında, canlı sürümün
film kategori politikası için ayrıca veri tabanı gerektirmeyen bölüm rotasında
deneme ve ücretli hesap oynatma testini çalıştırır. Web derlemesinin `NEXT_PUBLIC_*`
değerlerini çalışan web konteynerinden bellek içinde okur; değerleri çıktıya
yazmaz. Docker build logları da gösterilmez. Çıktı yalnız aday imaj kimlikleri
ve sabit durum etiketleridir. Aday imajlar hâlihazırda varsa betik üzerine
yazmaz. Derleme API imajını başarıyla oluşturup webde durursa API adayı
kalır; **canlı konteynerler değişmez**. Bu durumda kaynak ve imaj kimliklerini
inceleyip yalnız web adayını `build-api-web.py /data/flixify/source --only
ops-web` komutuyla yeniden derleyin.

API adayı zaten derlenmiş ve yalnız eski test düzeni yüzünden doğrulama durmuşsa
yeniden imaj üretmeden kaynak katmanlarını, eklenen kodu ve yeni odaklı testi
doğrulayın:

```sh
python3 /data/flixify/releases/2026-10-23-playback-fix/build-api-web.py /data/flixify/source --verify-existing-api
```

İlk `release-api-web.py` çağrısı varsayılan **dry-run** olup hiçbir dosyayı,
Coolify kaydını veya konteyneri değiştirmez. `--apply` yalnız Coolify raw,
rendered ve generated Compose ile uygulama imaj kayıtlarını eşitler;
konteynerleri yeniden başlatmaz. `--recreate` yalnız API, sonra web
konteynerini `--no-deps --no-build --pull never` ile yeniler. API sağlıklı
olmazsa web aşamasına geçmez. Db ve worker konteyner kimlikleri değişirse
durur. Betikler kalıcı yedek dosyası oluşturmaz, gizli ayarları yazdırmaz.

API veya web yeni imajda sağlıksız kalırsa `--recreate` eski API ve web
imajlarını Coolify kayıtlarına geri yazar ve yalnız değişen konteynerleri
yeniden oluşturur. İşlem başka nedenle yarım kalırsa, Compose hâlâ aday
etiketleri gösterdiği sürece açık geri dönüş komutu:

```sh
python3 /data/flixify/releases/2026-10-23-playback-fix/release-api-web.py --rollback
```

Geri dönüş, bu yayından önce çalışan trial süre kısıtını içeren API imajına
gider; eski ve süre denetimsiz bir sürüme gitmez. `--rollback` db/worker'a
dokunmaz, kaynak imajlar veya Coolify kayıtları beklenen durumda değilse durur.

Canlı kabul testi: `https://api.flixify.vip/health`, `https://flixify.vip/`,
`/filmler`, `/diziler`, `/ayarlar` HTTP 200; girişli **ücretli** hesapta film
ve dizi oynatma; **aktif üç saatlik deneme** hesabında oynatma ve süre bitince
erişimin kapanması. Sağlayıcı aktif sunucudan gelen medyaya `403
FORCED_COUNTRY` verirse deneme oynatması bu kod dağıtımıyla düzelmiş sayılmaz;
doğrudan bağlantıyı süre sonu doğrulamadan denemeye açmayın.
