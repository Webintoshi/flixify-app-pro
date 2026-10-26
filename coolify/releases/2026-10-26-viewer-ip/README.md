# 26 Ekim viewer IP oynatma yayını

Bu klasör yalnız aktif Coolify hizmeti `eupquokyj7qegufqvqkjmuyr` (id 1) için
API/web adaylarını hazırlar ve korumalı yayını yürütür. Uygulama sürümü
`74907d62d9bea36dd0ee1d4ab8fed4aaae53d269`, yama temeli
`51be56cfa2927c3f4a41a84e5a4f3acfaa4a0cea` olarak sabittir. Yayın betiklerini
ekleyen commitin uygulama imajındaki revision etiketiyle aynı olması gerekmez.

Kaynak imajlar `flixify-api:playback-fix-39300d0-20261023` ve
`flixify-ops-web:playback-fix-39300d0-20261023`; hedefler
`flixify-api:viewer-ip-74907d6-20261026` ve
`flixify-ops-web:viewer-ip-74907d6-20261026`. İmaj SHA256 kimlikleri ve iki
API kaynak SHA256 değeri betiklerde sabittir. Etiket başka imaja taşınırsa durur.

`server.ts` ve `repository.ts` canlıya özgü katalog/yetişkin içerik kuralları
içerir. Her biri sabit canlı imajdan alınır, SHA256 doğrulanır, yalnız belirtilen
iki commit arasındaki kendi Git yaması uygulanır. Aday dosyanın tam yama sonucu
olduğu byte düzeyinde yeniden doğrulanır; yama dışındaki tüm canlı içerik korunur.
Yeni `client-playback-access.ts` yokluk kontrolünden sonra kopyalanır. Webde
`detail.tsx` ve `canli-tv/page.tsx` temel commit ile eşit olmalıdır; yeni
`direct-playback-deadline.ts` ve `playback-transport.ts` yokluk kontrolünden sonra eklenir. Başka kaynak,
contracts veya bağımlılık kopyalanmaz.

Aktif hostta, gerçek checkout yolunu kullanarak sırasıyla:

```sh
python3 /data/flixify/source/coolify/releases/2026-10-26-viewer-ip/build-api-web.py /data/flixify/source
python3 /data/flixify/source/coolify/releases/2026-10-26-viewer-ip/release-api-web.py
python3 /data/flixify/source/coolify/releases/2026-10-26-viewer-ip/release-api-web.py --apply
python3 /data/flixify/source/coolify/releases/2026-10-26-viewer-ip/release-api-web.py --recreate
```

Build canlı konteynerleri değiştirmez. Aday API testi salt okunur olarak
`/app/coolify/releases/2026-10-26-viewer-ip/candidate-viewer-playback.test.ts`
yoluna bağlanır, `npx --no-install vitest run --root /app` ile açık dosya filtresi
ve kapalı ağ kullanılarak yürütülür. Göreli importlar bu dizilime bağlıdır.
Aday rota testleri LIVE için son canonical pathname uzantısını, çelişen query/dizin metnini ve desteklenmeyen dosya yolunu da doğrular. LIVE MP4/MKV tarayıcının native medya motorunu; TS MPEG-TS, HLS mevcut HLS seçimini kullanır.
Derleme logları ve ortam değerleri yazdırılmaz. Webin yalnız mevcut public
build ayarları bellekten kullanılır. Aday etiketi varsa üzerine yazılmaz;
yarım derleme için `--only api` veya `--only ops-web` kullanılabilir. Mevcut API
adayını kaynak/layer ve çalışma testiyle doğrulamak için `--verify-existing-api`
kullanılabilir.

Varsayılan release çağrısı salt okunur dry run yapar. `--apply`, mevcut raw ve
rendered Compose hashlerini kilit altında denetleyerek doğrudan imaj alanlarını
ve uygulama imaj kayıtlarını eşitler; `Service::parse()` çağırmaz. Üretilen
Compose, ortam dosyası ve konteyner kimlikleri işlem sonrasında doğrulanır.
`--recreate` yalnız API ardından web için `--no-deps --no-build --pull never`
kullanır. Sağlık başarısızlığında iki kaynak imaja geri döner. Açık geri dönüş:

```sh
python3 /data/flixify/source/coolify/releases/2026-10-26-viewer-ip/release-api-web.py --rollback
```

Db/worker kimlikleri korunur. Ortam/ağ değişimi, yedekleme ve emekli proxy
işlemi yoktur. Coolify panelinden ayrıca Deploy çalıştırmayın.

Yerel politika doğrulaması:

```sh
python3 coolify/releases/2026-10-26-viewer-ip/test-release-api-web.py
python3 -m py_compile coolify/releases/2026-10-26-viewer-ip/build-api-web.py coolify/releases/2026-10-26-viewer-ip/release-api-web.py coolify/releases/2026-10-26-viewer-ip/test-release-api-web.py
```

Yayın kabulünde API/site sağlığına ek olarak gerçek, uygun izleyici hesabıyla
MP4/MKV ilerleme ve seek gözlenmelidir. Kaynak adreslerini veya kimlik bilgilerini
loglamayın; native video denemesini sınırlı sürede kapatın. Saf politika testleri
ve aday rota testi gerçek tarayıcı oynatmasını kanıtlamaz. Safari codec/container
desteği ve sağlayıcının izleyici IP politikası ayrı kısıtlardır; uygun hesap veya
medya bulunamazsa gerçek oynatma doğrulamasının tamamlanmadığını raporlayın.

Recreate revalidates candidate revision labels before mutation, retains accepted image IDs, checks mutable tags before each recreate and health check, and checks both final running IDs. Operational Docker failures/timeouts trigger rollback only after protected container, Compose and environment guards pass. Explicit rollback permits target retag drift while source image IDs remain pinned.
