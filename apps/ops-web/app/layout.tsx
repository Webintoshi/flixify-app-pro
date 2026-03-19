import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteShell from "./site-shell";

export const metadata: Metadata = {
  title: "Flixify Pro",
  description: "Flixify public landing, anonim hesap olusturma ve operasyon paneli",
  manifest: "/logo/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo/flixify-icon-only.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
