import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// In development the API runs on :5080 (see README); Vite proxies API calls to it.
const api = "http://localhost:5080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": api,
      "/health": api,
    },
  },
  build: {
    // Built files are served by the API from its wwwroot.
    outDir: "../src/Ovi.Api/wwwroot",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
