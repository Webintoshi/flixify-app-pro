import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    // Keep previous hashed assets so stale clients can still fetch older dynamic chunks.
    emptyOutDir: false
  },
  server: {
    allowedHosts: [".flixify.pro", "localhost", "127.0.0.1"]
  },
  preview: {
    allowedHosts: [".flixify.pro", "localhost", "127.0.0.1"]
  },
  resolve: {
    alias: {
      "@flixify/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@flixify/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts"),
      "@flixify/viewer-core": path.resolve(__dirname, "../../packages/viewer-core/src/index.ts")
    }
  }
});
