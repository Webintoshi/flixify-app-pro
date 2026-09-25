"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import s from "./categories.module.css";

type Props = {
  groups: { title: string; count: number }[];
  selected: string;
  onSelect: (value: string) => void;
  open: boolean;
  onClose: () => void;
};

export function CategorySidebar({ groups, selected, onSelect, open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const panel = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const desktop = window.matchMedia("(min-width: 851px)");
    const resized = () => { if (desktop.matches) closeRef.current(); };
    panel?.showModal();
    document.body.style.overflow = "hidden";
    desktop.addEventListener("change", resized);
    return () => { panel?.close(); document.body.style.overflow = previousOverflow; desktop.removeEventListener("change", resized); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [open]);
  const select = (value: string) => { onSelect(value); onClose(); };
  const list = <div className={s.list}>
    <button type="button" aria-pressed={selected === ""} onClick={() => select("")}><span>Tüm kategoriler</span></button>
    {groups.map(group => <button type="button" key={group.title} aria-pressed={selected === group.title} onClick={() => select(group.title)}><span>{group.title}</span><small>{group.count.toLocaleString("tr-TR")}</small></button>)}
  </div>;
  return <>
    <aside className={s.sidebar} aria-label="Kategoriler"><h2>Kategoriler</h2>{list}</aside>
    {open && <dialog ref={dialog} id="category-drawer" className={s.drawer} aria-labelledby="category-drawer-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
      <div className={s.drawerHeader}><h2 id="category-drawer-title">Kategoriler</h2><button type="button" autoFocus aria-label="Kategorileri kapat" onClick={onClose}><Icon name="close"/></button></div>{list}
    </dialog>}
  </>;
}
