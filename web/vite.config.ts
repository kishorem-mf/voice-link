import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + webhook calls to the Express backend on :3000,
// so the browser talks to one origin and CORS never comes up.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/webhook": "http://localhost:3000",
    },
  },
});
