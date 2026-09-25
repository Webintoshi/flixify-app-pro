import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import SiteShell from "./site-shell";
import { Suspense } from "react";
import { PlatformProvider } from "./platform/session";
import { InstallProvider } from "./components/install/InstallProvider";
import { installBootstrap } from "./components/install/install-bootstrap";

export const viewport: Viewport = {
  themeColor: "#060708",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export const metadata: Metadata = {
  title: "Flixify — İçeriklerin. Tek yerde.",
  description: "Medyan için sade, kişisel bir alan. Flixify medya oynatıcı.",
  manifest: "/logo/site.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Flixify Pro"
  },
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/logo/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" style={{ colorScheme: "dark" }}>
      <head><script dangerouslySetInnerHTML={{ __html: installBootstrap }} /></head>
      <body>
        <Suspense fallback={<div style={{ minHeight: "100vh", background: "#07090c" }} />}><PlatformProvider><InstallProvider><SiteShell>{children}</SiteShell></InstallProvider></PlatformProvider></Suspense>
      </body>
    </html>
  );
}
