async function verify() {
  const res = await fetch("https://flixify.vip", { cache: "no-store" });
  const html = await res.text();
  console.log("Homepage status:", res.status);
  console.log("Has 'Hesap Olustur':", html.includes("Hesap Oluþtur"));
  console.log("Has 'Giris Yap':", html.includes("Giriþ Yap"));

  const dl = await fetch("https://flixify.vip/downloads/Flixify-Pro-Setup-2.3.43-x64.exe", { method: "HEAD" });
  console.log("Setup 2.3.43 status:", dl.status);
  console.log("Setup 2.3.43 Content-Length:", dl.headers.get("content-length"));
}
verify().catch(console.error);
