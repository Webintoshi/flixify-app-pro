export function emptyCatalogCopy(kind: string, group: string, search: string): {
  heading: string;
  body: string;
} | null {
  if(kind === "movie" && group === "18+ Filmler" && !search) return {
    heading: "Henüz içerik eklenmedi",
    body: "Bu kategoriye filmler eklendiğinde burada görünecek."
  };
  return null;
}
