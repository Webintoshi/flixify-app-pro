"use client";
import { useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { clickedDialogBackdrop, useCatalogDialog } from "./catalog-dialog";
import s from "./categories.module.css";

type Props = {
  groups: { title: string; count: number }[];
  selected: string;
  onSelect: (value: string) => void;
  open: boolean;
  onClose: () => void;
  title?: string;
  total?: number;
};

export function CategorySidebar({ groups, selected, onSelect, open, onClose, title, total }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const finder = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const unique = new Map<string, number>();
    for (const group of groups) if (group.title && !unique.has(group.title)) unique.set(group.title, Number.isFinite(group.count) ? Math.max(0, Math.floor(group.count)) : 0);
    return [{ title: "Tümü", value: "", count: total ?? [...unique.values()].reduce((sum, count) => sum + count, 0) }, ...[...unique].map(([title, count]) => ({ title, value: title, count }))];
  }, [groups, total]);
  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const filtered = useMemo(() => options.filter(option => option.title.toLocaleLowerCase("tr-TR").includes(needle)), [options, needle]);
  useCatalogDialog(open, dialog, () => dialog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? finder.current, onClose);
  const select = (value: string) => { onSelect(value); onClose(); };
  if (!open) return null;
  return <dialog ref={dialog} id="category-drawer" className={s.drawer} aria-labelledby="category-drawer-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (clickedDialogBackdrop(event)) onClose(); }}>
    <div className={s.drawerHeader}><div><h2 id="category-drawer-title">Kategoriler</h2><p>{title ? `${title} · ` : ""}{options.length - 1} kategori</p></div><button type="button" className={s.iconButton} aria-label="Kategorileri kapat" onClick={onClose}><Icon name="close"/></button></div>
    <div className={s.finder}><Icon name="search"/><input ref={finder} type="search" aria-label="Kategori bul" placeholder="Kategori bul" value={query} onInput={event => setQuery(event.currentTarget.value)} autoComplete="off"/>{query && <button type="button" className={s.clear} aria-label="Kategori aramasını temizle" onClick={() => { setQuery(""); finder.current?.focus(); }}><Icon name="close"/></button>}</div>
    <div className={s.list} role="group" aria-label="Kategoriler">
      {filtered.length ? filtered.map(option => <button type="button" key={option.value} data-category-value={option.value} aria-pressed={selected === option.value} aria-label={`${option.title}, ${option.count.toLocaleString("tr-TR")} içerik${selected === option.value ? ", seçili" : ""}`} onClick={() => select(option.value)}><span className={s.mark} data-selected-mark={selected === option.value ? "" : undefined}>{selected === option.value && <Icon name="check"/>}</span><span className={s.categoryTitle}>{option.title}</span><small>{option.count.toLocaleString("tr-TR")}</small></button>) : <p className={s.empty} role="status">Kategori bulunamadı</p>}
    </div>
    <div className={s.footer}><span>Enter ile seç</span><button type="button" onClick={onClose}>Vazgeç</button></div>
  </dialog>;
}
