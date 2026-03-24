import { PublicPreviewPage } from "../public-preview-page";

export default function MoviesPage() {
  return (
    <PublicPreviewPage
      eyebrow="Film Arsivi"
      title="Aksiyon, drama ve aile filmlerini tek katalogda toplayin."
      description="M3U snapshot mantigi ile gelen film arsivi kategori bazli ayrilir, poster yapisi ile sunulur ve aktif paketi olan kullanici oynatmaya hemen baslar."
      stats={["4K UHD", "Yeni eklenenler", "Kategori filtresi", "Hizli acilis"]}
      items={[
        {
          label: "Aksiyon",
          title: "Yuksek tempolu film rail'leri",
          description: "Kullanici daha ilk ekranda populer ve yeni eklenen aksiyon basliklarini ayri rail olarak gorur."
        },
        {
          label: "Aile",
          title: "Ortak izleme icin duzenli katalog",
          description: "Aile, cocuk ve genel izleme kategorileri daha temiz bir on yuz ile ayrilir."
        },
        {
          label: "4K",
          title: "Kalite odakli sunum",
          description: "Yuksek cozumurluk destekli icerikler one cikarilir, paket ve link durumu oynatma iznini belirler."
        }
      ]}
    />
  );
}
