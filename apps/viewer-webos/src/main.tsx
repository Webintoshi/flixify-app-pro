import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const CHUNK_RECOVERY_KEY = "flixify-chunk-recovery-at";

function shouldHandleChunkLoadError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("error loading dynamically imported module") ||
    normalized.includes("importing a module script failed")
  );
}

function tryRecoverFromChunkLoadError(trigger: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const now = Date.now();
    const lastAttempt = Number(window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) ?? "0");
    if (Number.isFinite(lastAttempt) && now - lastAttempt < 15_000) {
      return false;
    }
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(now));
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("_chunk_recover", String(now));
    console.warn("[flixify] Chunk load failed, reloading client bundle.", { trigger });
    window.location.replace(nextUrl.toString());
    return true;
  } catch {
    return false;
  }
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  tryRecoverFromChunkLoadError("vite:preloadError");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (!shouldHandleChunkLoadError(message)) {
    return;
  }

  const handled = tryRecoverFromChunkLoadError("unhandledrejection");
  if (handled) {
    event.preventDefault();
  }
});

const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
