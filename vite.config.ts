import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  build: {
    target: "es2022",
    // Strict CSP (no inline script) is served by the admin backend; keep the build free of inline scripts.
    modulePreload: { polyfill: false },
  },
  server: {
    // The browser calls the admin backend on the same origin; in dev, proxy to the svc-admin double.
    proxy: { "/v1": { target: process.env.ADMIN_API_URL ?? "http://127.0.0.1:8080", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
