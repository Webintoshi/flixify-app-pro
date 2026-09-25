"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import CatalogPage from "./platform/catalog";
import { Landing } from "./platform/landing";
import { usePlatform } from "./platform/session";
export default function HomePage() {
  const { session, ready } = usePlatform();
  const router = useRouter();
  useEffect(() => { if (!session) return; const intent = sessionStorage.getItem("flixify-search-intent"); if (intent) { sessionStorage.removeItem("flixify-search-intent"); router.replace(`/?q=${encodeURIComponent(intent)}`); } }, [session, router]);
  if (!ready) return <main aria-busy="true" style={{ minHeight: "100vh", display: "grid", placeContent: "center", justifyItems: "center", gap: 20, background: "#07090c", color: "#b3b7c0" }}>
    <img src="/logo/flixify-logo.png" alt="Flixify Pro" width="170" height="45" />
    <p>Flixify hazırlanıyor…</p>
  </main>;
  return session ? <CatalogPage kind="movie" overview/> : <Landing/>;
}
