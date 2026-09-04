import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  server: { host: "127.0.0.1", port: 8080, strictPort: true },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
