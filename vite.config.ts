import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 部署在 /yugioh-combo-checker/ 下，由 workflow 设置 BASE_PATH。
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
