import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteShell from "./site-shell";

export const metadata: Metadata = {
  title: "Flixify Pro",
  description: "Flixify public landing, anonim hesap olusturma ve operasyon paneli"
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
