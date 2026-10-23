export type CatalogAccessState = {
  status: string;
  active: boolean;
  hasAssignedLink: boolean;
  trialProvisionStatus: "pending" | "review" | null;
};

export function emptyCatalogCopy(kind: string, group: string, search: string, access?: CatalogAccessState | null): {
  heading: string;
  body: string;
  action?: { href: string; label: string };
} | null {
  if (access?.status === "blocked") return {
    heading: "Hesabın kısıtlı",
    body: "Hesap durumun için destek ekibimizle iletişime geçebilirsin.",
    action: { href: "/iletisim", label: "Destek al" }
  };
  if (access && !access.active && access.trialProvisionStatus === "pending") return {
    heading: "Deneme erişimin hazırlanıyor",
    body: "İçerik bağlantın hazırlanıyor. Durumunu Hesabım sayfasından kontrol edebilirsin.",
    action: { href: "/ayarlar", label: "Hesabımı kontrol et" }
  };
  if (access && !access.active && access.trialProvisionStatus === "review") return {
    heading: "Deneme erişimin inceleniyor",
    body: "Erişimin henüz açılmadı. Yardım için destek ekibimizle iletişime geçebilirsin.",
    action: { href: "/iletisim", label: "Destek al" }
  };
  if (access?.active && !access.hasAssignedLink) return {
    heading: "İçerik bağlantın hazırlanıyor",
    body: "Paketin aktif. Bağlantı durumunu Hesabım sayfasından kontrol edebilirsin.",
    action: { href: "/ayarlar", label: "Hesabımı kontrol et" }
  };
  if (access && !access.active) return {
    heading: "Aktif paketin yok",
    body: "İçeriklere erişmek için bir paket seçebilirsin.",
    action: { href: "/paketler", label: "Paketleri incele" }
  };
  if(kind === "movie" && group === "18+ Filmler" && !search) return {
    heading: "Henüz içerik eklenmedi",
    body: "Bu kategoriye filmler eklendiğinde burada görünecek."
  };
  return null;
}
