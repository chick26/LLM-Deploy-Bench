import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8090"
    }
  }
});
