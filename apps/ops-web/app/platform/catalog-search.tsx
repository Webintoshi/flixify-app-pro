"use client";
import { useEffect, useRef, useState } from "react";
import { Artwork } from "./artwork";
import { clickedDialogBackdrop, useCatalogDialog } from "./catalog-dialog";
import { Icon } from "./icons";
import { itemKey, type Catalog, type MediaItem } from "./types";
import s from "./catalog-panels.module.css";
type Props = {
  title: string;
  initialQuery: string;
  scope: string;
  preview: (query: string) => Promise<Catalog>;
  onSelect: (item: MediaItem) => void;
  onSubmit: (query: string) => void;
  onClose: () => void;
};
export function CatalogSearchDialog({ title, initialQuery, scope, preview, onSelect, onSubmit, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialQuery);
  const [result, setResult] = useState<{ query: string; data: Catalog } | null>(null);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useCatalogDialog(true, dialog, () => input.current, onClose);
  useEffect(() => {
    let cancelled = false;
    const query = draft.trim();
    setPending(true); setFailed(false); setResult(null);
    const timer = window.setTimeout(() => {
      Promise.resolve().then(() => previewRef.current(query)).then(data => {
        if (!cancelled) setResult({ query, data });
      }).catch(() => { if (!cancelled) setFailed(true); }).finally(() => { if (!cancelled) setPending(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft]);
  const visibleResult = result?.query === draft.trim() ? result.data : null;
  return <dialog ref={dialog} id="catalog-search-dialog" className={s.searchDialog} aria-labelledby="catalog-search-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (clickedDialogBackdrop(event)) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); onSubmit(draft.trim()); }}>
      <div className={s.dialogHeader}><div><span className={s.section}>{title}</span><h2 id="catalog-search-title">Ne izlemek istersin?</h2></div><button type="button" className={s.iconButton} aria-label="Aramayı kapat" onClick={onClose}><Icon name="close"/></button></div>
      <p className={s.scope}>{scope}</p>
      <div className={s.inputSurface}><Icon name="search"/><input ref={input} id="catalog-search" type="search" aria-label={`${title} içinde ara`} placeholder="İçerik adıyla ara" autoComplete="off" value={draft} onInput={event => setDraft(event.currentTarget.value)}/><button type="button" className={s.iconButton} disabled={!draft} aria-label="Aramayı temizle" onClick={() => { setDraft(""); input.current?.focus(); }}><Icon name="close"/></button></div>
      <div className={s.preview}>
        <p className={s.resultCount} aria-live="polite">{pending ? "Aranıyor…" : failed ? "Önizleme alınamadı" : draft.trim() ? `${(visibleResult?.total ?? 0).toLocaleString("tr-TR")} sonuç` : `Katalogda ${(visibleResult?.total ?? 0).toLocaleString("tr-TR")} içerik`}</p>
        {visibleResult?.items.length ? <ul className={s.previewList}>{visibleResult.items.slice(0, 3).map(item => <li key={itemKey(item)}><button type="button" className={s.previewResult} disabled={item.available === false} aria-label={`${item.title} oynat`} onClick={() => onSelect(item)}><div className={s.previewArtwork} aria-hidden="true"><Artwork item={item}/></div><div><span>{item.title}</span>{item.groupTitle && <small>{item.groupTitle}</small>}</div></button></li>)}</ul> : !pending && <p className={s.previewHint}>{failed ? "Aramayı yine de yapabilirsin." : "Farklı bir içerik adı deneyebilirsin."}</p>}
      </div>
      <div className={s.actions}><button type="button" className={s.cancel} onClick={onClose}>Vazgeç</button><button type="submit" className={s.apply}>Ara <Icon name="arrow"/></button></div>
    </form>
  </dialog>;
}
