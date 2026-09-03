import { defineConfig } from "vite";

// GitHub Pages serves the site under /morning-diner/ (.github/workflows/pages.yml sets
// GITHUB_PAGES=1). Local dev, `npm run build` and the capture harnesses keep the relative base.
const base = process.env.GITHUB_PAGES ? "/morning-diner/" : "./";

export default defineConfig({
  base,
  server: { port: 5211, strictPort: true, open: false },
  preview: { port: 5210, strictPort: true, open: false },
  build: { target: "es2022", sourcemap: false },
});
