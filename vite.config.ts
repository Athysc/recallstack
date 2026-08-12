import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@lezer/")) return "editor-parser";
          if (/\/node_modules\/@codemirror\/(state|view|language)\//.test(id)) return "editor-core";
          if (id.includes("/node_modules/@codemirror/lang-markdown/")) return "editor-markdown";
          if (id.includes("/node_modules/@codemirror/")) return "editor-tools";
        },
      },
    },
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
