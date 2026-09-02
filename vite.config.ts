import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5211, strictPort: true, open: false },
  preview: { port: 5210, strictPort: true, open: false },
  build: { target: "es2022", sourcemap: false },
});
