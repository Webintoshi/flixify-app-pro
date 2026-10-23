import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCatalogCopy } from "./catalog-empty.ts";

test("an empty opted-in 18+ film group explains that content has not been added", () => {
  assert.deepEqual(emptyCatalogCopy("movie", "18+ Filmler", ""), {
    heading: "Henüz içerik eklenmedi",
    body: "Bu kategoriye filmler eklendiğinde burada görünecek."
  });
});

test("regular groups and searches keep the ordinary empty result", () => {
  assert.equal(emptyCatalogCopy("movie", "Yerli", ""), null);
  assert.equal(emptyCatalogCopy("movie", "18+ Filmler", "örnek"), null);
  assert.equal(emptyCatalogCopy("series", "18+ Filmler", ""), null);
});

test("an expired account sees a package action instead of a false empty search result", () => {
  assert.deepEqual(emptyCatalogCopy("series", "", "", {
    status: "active", active: false, hasAssignedLink: true, trialProvisionStatus: null
  }), {
    heading: "Aktif paketin yok",
    body: "İçeriklere erişmek için bir paket seçebilirsin.",
    action: { href: "/paketler", label: "Paketleri incele" }
  });
});

test("an account whose trial is being provisioned sees its actual status", () => {
  assert.deepEqual(emptyCatalogCopy("movie", "", "", {
    status: "active", active: false, hasAssignedLink: false, trialProvisionStatus: "pending"
  }), {
    heading: "Deneme erişimin hazırlanıyor",
    body: "İçerik bağlantın hazırlanıyor. Durumunu Hesabım sayfasından kontrol edebilirsin.",
    action: { href: "/ayarlar", label: "Hesabımı kontrol et" }
  });
});

test("a subscribed account waiting for its content connection is sent to account status", () => {
  assert.deepEqual(emptyCatalogCopy("movie", "", "", {
    status: "active", active: true, hasAssignedLink: false, trialProvisionStatus: null
  }), {
    heading: "İçerik bağlantın hazırlanıyor",
    body: "Paketin aktif. Bağlantı durumunu Hesabım sayfasından kontrol edebilirsin.",
    action: { href: "/ayarlar", label: "Hesabımı kontrol et" }
  });
});

test("a blocked account is sent to support instead of packages", () => {
  assert.deepEqual(emptyCatalogCopy("series", "", "", {
    status: "blocked", active: false, hasAssignedLink: true, trialProvisionStatus: null
  }), {
    heading: "Hesabın kısıtlı",
    body: "Hesap durumun için destek ekibimizle iletişime geçebilirsin.",
    action: { href: "/iletisim", label: "Destek al" }
  });
});

test("a subscribed account with its content connection ready does not get a package prompt", () => {
  assert.equal(emptyCatalogCopy("movie", "", "", {
    status: "active", active: true, hasAssignedLink: true, trialProvisionStatus: null
  }), null);
});
