import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendBaseUrl = env.VITE_BACKEND_BASE_URL || "http://10.89.149.15:8080";
  const wsBaseUrl = env.VITE_WS_BASE_URL || backendBaseUrl.replace(/^http/, "ws");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/health": backendBaseUrl,
        "/logs": backendBaseUrl,
        "/api": backendBaseUrl,
        "/media": backendBaseUrl,
        "/ws": {
          target: wsBaseUrl,
          ws: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
