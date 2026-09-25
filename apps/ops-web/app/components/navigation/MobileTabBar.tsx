"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./MobileTabBar.module.css";

const tabs = [
  {
    href: "/",
    label: "Ana Sayfa",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  },
  {
    href: "/filmler",
    label: "Filmler",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    )
  },
  {
    href: "/diziler",
    label: "Diziler",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    )
  },
  {
    href: "/canli-tv",
    label: "Canlı TV",
    hasLiveDot: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.93 4.93a10 10 0 0 1 14.14 0" />
        <path d="M7.76 7.76a6 6 0 0 1 8.48 0" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 14v8" />
      </svg>
    )
  }
];

export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabBarWrapper} aria-label="Mobil Gezinme">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tabItem} ${isActive ? styles.tabItemActive : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <span className={styles.tabIcon}>
              {tab.icon}
              {tab.hasLiveDot && <span className={styles.livePulse} aria-hidden="true" />}
            </span>
            <span className={styles.tabLabel}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
