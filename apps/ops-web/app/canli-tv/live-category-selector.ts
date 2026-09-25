export function categorySelectValue(categoryId: string) {
  return categoryId === "all" ? "" : categoryId;
}

export function categorySelectOptions(categories: readonly { id: string; label: string }[], categoryCounts: ReadonlyMap<string, number>, total: number) {
  return [
    { id: "", label: "Kategoriler", disabled: true },
    ...categories.map((category) => ({
      id: category.id,
      label: category.label,
      disabled: (category.id === "all" ? total : categoryCounts.get(category.id) ?? 0) === 0
    }))
  ];
}
