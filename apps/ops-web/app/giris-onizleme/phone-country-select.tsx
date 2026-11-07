"use client";

import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import s from "./phone-country-select.module.css";

const turkishNames = new Intl.DisplayNames(["tr"], { type: "region" });
const englishNames = new Intl.DisplayNames(["en"], { type: "region" });
const searchText = (value: string) => value.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const aliases: Partial<Record<CountryCode, string>> = { GB: "İngiltere UK Britain England", US: "ABD USA Amerika", AE: "BAE UAE", TR: "Turkey Türkiye", KR: "Güney Kore South Korea", KP: "Kuzey Kore North Korea" };
const countries = getCountries().map(iso => {
  const name = turkishNames.of(iso) ?? iso, dial = `+${getCountryCallingCode(iso)}`;
  return { iso, name, dial, search: searchText(`${name} ${englishNames.of(iso) ?? ""} ${iso} ${dial} ${aliases[iso] ?? ""}`) };
}).sort((left, right) => left.name.localeCompare(right.name, "tr"));

export function PhoneCountrySelect({ country, onChange, disabled = false }: { country: CountryCode; onChange: (country: CountryCode) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [highlight, setHighlight] = useState(0);
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number; left?: number; width?: number }>({ above: false, maxHeight: 218 });
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId(), listId = `${id}-countries`;
  const selected = countries.find(item => item.iso === country)!;
  const filtered = useMemo(() => countries.filter(item => item.search.includes(searchText(query.trim()))), [query]);
  const active = filtered[highlight];

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const position = () => {
      const rect = root.current?.getBoundingClientRect?.();
      if (!rect || !window.innerHeight) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? window.innerHeight);
      const below = bottom - rect.bottom - 16, above = rect.top - top - 16;
      const useAbove = below < 260 && above > below;
      const field = root.current?.parentElement?.getBoundingClientRect?.() ?? rect;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportWidth = viewport?.width ?? window.innerWidth;
      const width = Math.min(field.width, viewportWidth - 24);
      const left = Math.max(viewportLeft + 12, Math.min(field.left, viewportLeft + viewportWidth - width - 12)) - rect.left;
      setPlacement({ above: useAbove, left, width, maxHeight: Math.max(72, Math.min(window.innerWidth <= 430 ? 218 : 244, (useAbove ? above : below) - 70)) });
    };
    position();
    const outside = (event: PointerEvent) => { if (event.target && !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position); window.visualViewport?.addEventListener("resize", position);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", position); window.visualViewport?.removeEventListener("resize", position); };
  }, [open]);
  useEffect(() => {
    if (open && active) document.getElementById(`${id}-${active.iso}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function show() { setQuery(""); setHighlight(countries.findIndex(item => item.iso === country)); setOpen(true); }
  function close() { setOpen(false); trigger.current?.focus(); }
  function choose(value: CountryCode) { onChange(value); close(); }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length) setHighlight(index => (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); setHighlight(event.key === "Home" ? 0 : Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter") { event.preventDefault(); if (active) choose(active.iso); }
  }

  return <div className={s.country} ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" className={s.trigger} disabled={disabled} aria-label={`Ülke: ${selected.name} (${selected.dial})`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } else if (event.key === "Escape" && open) close(); }}>
      <img src={`/flags/${country}.svg`} alt="" width="24" height="16"/><span>{selected.dial}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
    </button>
    {open && <div className={s.popover} data-above={placement.above} style={{ left: placement.left, width: placement.width }}>
      <div className={s.search}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input ref={search} role="combobox" aria-label="Ülke veya telefon kodu ara" aria-expanded="true" aria-controls={listId} aria-activedescendant={active ? `${id}-${active.iso}` : undefined} aria-autocomplete="list" autoComplete="off" spellCheck={false} placeholder="Ülke veya kod ara" value={query} onChange={event => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={navigate}/></div>
      <ul id={listId} role="listbox" aria-label="Ülkeler" className={s.list} style={{ maxHeight: placement.maxHeight }}>
        {filtered.map((item, index) => <li key={item.iso} id={`${id}-${item.iso}`} role="option" aria-selected={item.iso === country} data-active={index === highlight} className={s.option} onPointerDown={event => event.preventDefault()} onClick={() => choose(item.iso)}>
          <img src={`/flags/${item.iso}.svg`} alt="" width="24" height="16" loading="lazy"/><span>{item.name}</span><span className={s.dial}>{item.dial}</span>{item.iso === country && <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>}
        </li>)}
      </ul>
      {!filtered.length && <p className={s.empty} role="status">Ülke bulunamadı</p>}
    </div>}
  </div>;
}
