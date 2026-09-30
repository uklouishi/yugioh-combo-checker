import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 部署在 /yugioh-combo-checker/ 下，由 workflow 设置 BASE_PATH。
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    // JSR 版的入口只转出具名导出，createCore 是 dist/index.js 的默认导出
    alias: [{ find: /^ocgcore-wasm$/, replacement: fileURLToPath(new URL("./node_modules/ocgcore-wasm/dist/index.js", import.meta.url)) }],
  },
});
