import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://lukaa98.github.io/NP-Intelligence/
export default defineConfig({
  base: "/NP-Intelligence/",
  plugins: [react()]
});
