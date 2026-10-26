# 26 Ekim kişisel izleyici kataloğu ve oynatma yayını

Bu klasör yalnız aktif Coolify hizmeti `eupquokyj7qegufqvqkjmuyr` (id 1) için
API/web adaylarını hazırlar ve korumalı yayını yürütür. Uygulama sürümü
`464e34863834d87fc90cebe360eeb784119eda56`, yama temeli
`51be56cfa2927c3f4a41a84e5a4f3acfaa4a0cea` olarak sabittir. Yayın betiklerini
ekleyen commitin uygulama imajındaki revision etiketiyle aynı olması gerekmez.

Kaynak imajlar `flixify-api:playback-fix-39300d0-20261023` ve
`flixify-ops-web:playback-fix-39300d0-20261023`; hedefler
`flixify-api:personal-viewer-464e348-20261026` ve
`flixify-ops-web:personal-viewer-464e348-20261026`. İmaj SHA256 kimlikleri ve iki
API kaynak SHA256 değeri betiklerde sabittir. Etiket başka imaja taşınırsa durur.

`server.ts` ve `repository.ts` canlıya özgü katalog/yetişkin içerik kuralları
içerir. Her biri sabit canlı imajdan alınır, SHA256 doğrulanır, yalnız belirtilen
iki commit arasındaki kendi Git yaması uygulanır. Aday dosyanın tam yama sonucu
olduğu byte düzeyinde yeniden doğrulanır; yama dışındaki tüm canlı içerik korunur.
Yeni API modülleri `client-playback-access.ts`, `personal-provider-session.ts` ve
`personal-library.ts` yokluk kontrolünden sonra sabit committen kopyalanır.
Webde `detail.tsx`, `canli-tv/page.tsx`, `session.tsx`, `catalog.tsx`, `types.ts`
ve `live-tv-app.module.css` temel commit ile byte düzeyinde eşit olmalıdır.
Yeni `direct-playback-deadline.ts`, `playback-transport.ts`, `personal-provider.ts`,
`personal-integration.ts` ve `personal-live.ts` yokluk kontrolünden sonra eklenir. Başka kaynak,
contracts veya bağımlılık kopyalanmaz.

Aktif hostta, gerçek checkout yolunu kullanarak sırasıyla:

```sh
python3 /data/flixify/source/coolify/releases/2026-10-26-personal-viewer/build-api-web.py /data/flixify/source
python3 /data/flixify/source/coolify/releases/2026-10-26-personal-viewer/release-api-web.py
python3 /data/flixify/source/coolify/releases/2026-10-26-personal-viewer/release-api-web.py --apply
python3 /data/flixify/source/coolify/releases/2026-10-26-personal-viewer/release-api-web.py --recreate
```

Build canlı konteynerleri değiştirmez. Aday API testi salt okunur olarak
`/app/coolify/releases/2026-10-26-personal-viewer/candidate-viewer-playback.test.ts`
yoluna bağlanır, `npx --no-install vitest run --root /app` ile açık dosya filtresi
ve kapalı ağ kullanılarak yürütülür. Göreli importlar bu dizilime bağlıdır.
Aday testinde gerçek rota ve oynatma yöneticileri çalışır; dış ağ erişimi ve
veritabanı yazımları taklit edilir. Kurulu FFmpeg/FFprobe araçlarının eski fallback
yollarında ağ analizi başlatmasını önlemek için yalnız testin `env` dışa aktarımında
iki binary yolu mevcut olmayan dosyalara ayarlanır. Ortam değişkenlerini tek başına
ayarlamak araç keşfinin kurulu binary'ye dönmesini engellemez. Uygulama imajı,
sürüm etiketi ve yayın kapsamı bu test izolasyonundan etkilenmez.
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
python3 /data/flixify/source/coolify/releases/2026-10-26-personal-viewer/release-api-web.py --rollback
```

Db/worker kimlikleri korunur. Ortam/ağ değişimi, yedekleme ve emekli proxy
işlemi yoktur. Coolify panelinden ayrıca Deploy çalıştırmayın.

Yerel politika doğrulaması:

```sh
python3 coolify/releases/2026-10-26-personal-viewer/test-release-api-web.py
python3 -m py_compile coolify/releases/2026-10-26-personal-viewer/build-api-web.py coolify/releases/2026-10-26-personal-viewer/release-api-web.py coolify/releases/2026-10-26-personal-viewer/test-release-api-web.py
```

Yayın kabulünde API/site sağlığına ek olarak gerçek, uygun izleyici hesabıyla
MP4/MKV ilerleme ve seek gözlenmelidir. Kaynak adreslerini veya kimlik bilgilerini
loglamayın; native video denemesini sınırlı sürede kapatın. Saf politika testleri
ve aday rota testi gerçek tarayıcı oynatmasını kanıtlamaz. Safari codec/container
desteği ve sağlayıcının izleyici IP politikası ayrı kısıtlardır; uygun hesap veya
medya bulunamazsa gerçek oynatma doğrulamasının tamamlanmadığını raporlayın.

Recreate revalidates candidate revision labels before mutation, retains accepted image IDs, checks mutable tags before each recreate and health check, and checks both final running IDs. Operational Docker failures/timeouts trigger rollback only after protected container, Compose and environment guards pass. Explicit rollback permits target retag drift while source image IDs remain pinned.

## Birleşik yayın kapıları

Son uygulama commiti `464e34863834d87fc90cebe360eeb784119eda56` Task3b ve
sonraki düzeltme incelemelerinden geçti. Her iki betik aynı tam commit ve
`personal-viewer-464e348-20261026` etiketleriyle sabittir. CLI tam commit ve
etiket tutarlılığını doğrular; geçersiz/bekleyen pin ile durur. Test fixture
SHA256 değerleri bu tam committeki kaynakla doğrulanmıştır.
Önceki viewer-ip adayları yayınlanmadı; kaynak imajlar hâlâ 23 Ekim playback-fix
imajlarıdır. Mevcut aday etiketleri üzerine yazılmaz.

Her build öncesi `/var/lib/docker` dosya sisteminde en az 8 GiB boş alan gerekir.
Eksikse yalnız yeniden üretilebilir builder cache temizlenip tekrar denenir;
veritabanı, volume veya canlı konteyner temizliği yapılmaz. Web Dockerfile'ında
aynı RUN katmanı önce `/app/apps/ops-web/.next` dizinini kaldırır, build yapar ve
sonra `.next/cache` dizinini kaldırır. Böylece eski cache yeni katmana taşınmaz.

API adayı önce SHA256 `73cd04f3e75d474d91ae30673643397c36d762c8a5725f8d86a626ac26e0433a`
ile değişmeden korunan 36 oynatma vakasını çalıştırır. Sonra sabit uygulama
commitinden okunan `personal-provider-session-route.test.ts` (18 vaka) ve
`personal-library.test.ts` (23 vaka), SHA256 kontrolüyle kendi orijinal kaynak
yollarına salt okunur bağlanır. İki çalıştırmada da ağ kapalıdır; sağlayıcı
çağrıları ve kütüphane depolaması sentetik mocklarla sınanır. Bunlar gerçek
sağlayıcıya veya gerçek veritabanına yazım yetkisi vermez.

Recreate öncesi ve sırasında aday revision etiketleri ve kabul edilen imaj
kimlikleri tekrar doğrulanır. Public API `/health` ve web kök sayfası kontrolleri
sonrası, gerçek yetkili izleyici hesabıyla katalog, detay, canlı TV ve kişisel
kütüphane izolasyonunun tarayıcıda doğrulanmasını root yürütür.
Yedek, proxy/VPN, askıdaki host veya ticket işlemi bu yayının kapsamında değildir.
