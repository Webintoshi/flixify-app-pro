import { PublicPreviewPage } from "../public-preview-page";

export default function SeriesPage() {
  return (
    <PublicPreviewPage
      eyebrow="Dizi Koleksiyonu"
      title="Bolum yapisi korunmus dizileri sade ve hizli bir arayuzle gezin."
      description="Sezon ve bolum ayrimi backend tarafinda normalize edilir; kullanici diziler ekraninda karmasa yerine net bir kesit gorur."
      stats={["Sezon / bolum", "Drama rail'leri", "Yeni seri ekleme", "Tek tik oynatma"]}
      items={[
        {
          label: "Drama",
          title: "Devam etmesi kolay rail yapisi",
          description: "Diziler kategori ve grup basliklarina gore siralanir, uzun listelerde arama kaybolmaz."
        },
        {
          label: "Seri",
          title: "Bolum bilgisi net gorunur",
          description: "Sezon ve bolum numaralari kart ve oynatici tarafinda gorunur, yanlis icerik acilmaz."
        },
        {
          label: "Arama",
          title: "Buyuk katalogda hizli filtreleme",
          description: "Baslik ve grup filtreleri ile kullanici uzun M3U iceriginde hizli sonuc bulabilir."
        }
      ]}
    />
  );
}
