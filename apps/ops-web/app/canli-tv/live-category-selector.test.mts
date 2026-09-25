import assert from "node:assert/strict";
import test from "node:test";
import { categorySelectValue, categorySelectOptions } from "./live-category-selector.ts";

const categories = [
  { id: "all", label: "Tümü" },
  { id: "national", label: "Ulusal" },
  { id: "sports", label: "Spor" }
];

test("unfiltered channels display Kategoriler while Tümü remains selectable", () => {
  const options = categorySelectOptions(categories, new Map([ ["national", 4], ["sports", 2] ]), 6);
  assert.equal(categorySelectValue("all"), "");
  assert.deepEqual(options.slice(0, 2), [
    { id: "", label: "Kategoriler", disabled: true },
    { id: "all", label: "Tümü", disabled: false }
  ]);
});

test("specific category still displays its own label and can return to all", () => {
  const options = categorySelectOptions(categories, new Map([ ["national", 4], ["sports", 2] ]), 6);
  assert.equal(categorySelectValue("sports"), "sports");
  assert.equal(options.find((option) => option.id === "sports")?.label, "Spor");
  assert.equal(options.find((option) => option.id === "sports")?.disabled, false);
  assert.equal(categorySelectValue("all"), "");
});
