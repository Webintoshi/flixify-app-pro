export function Icon({ name, filled = false }: { name: string; filled?: boolean }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
    live: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 2 4 4 4-4M8 23h8"/></>,
    movie: <><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M7 5l3 5M14 5l3 5"/></>,
    series: <><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M6 4h12M9 1h6m-5 11 5 3-5 3Z"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    play: <path d="m8 4 13 8-13 8Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m7 10 5 5 5-5"/>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    back: <path d="m14 5-7 7 7 7"/>,
    settings: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></>,
    device: <><rect x="2" y="3" width="15" height="13" rx="2"/><path d="M7 20h6m-3-4v4"/><rect x="17" y="10" width="5" height="11" rx="1"/></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.movie}</svg>;
}
