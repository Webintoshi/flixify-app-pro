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
