import { PublicPreviewPage } from "../public-preview-page";

export default function LiveTvPage() {
  return (
    <PublicPreviewPage
      eyebrow="Canli TV"
      title="Spor, haber ve ulusal kanallari tek merkezde izleyin."
      description="Canli TV ekranlari grup bazli ayristirilir; kullaniciya link atanmadiysa katalog kapanir, aktif paket varsa yayin hemen acilir."
      stats={["1000+ kanal", "Spor ve haber", "Kesintisiz akis", "TV odakli arayuz"]}
      items={[
        {
          label: "Spor",
          title: "Mac gunleri icin hizli erisim",
          description: "Canli spor rail'leri one cikar, kullanici uzun liste icinde kanal aramak zorunda kalmaz."
        },
        {
          label: "Haber",
          title: "Ulusal ve uluslararasi yayinlar",
          description: "Haber ve gundem icerigi grup bazinda sunulur; kategori degisimi tek ekranda yapilir."
        },
        {
          label: "UHD",
          title: "Yayin kalitesi mesajlari net",
          description: "Paket aktif degilse oynatma acilmaz, kullanici buna gore dogrudan paket ve destek sayfalarina yonlenir."
        }
      ]}
    />
  );
}
