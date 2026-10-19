import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "public",
      filename: "sw.js",

      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "nudge-logo-192x192.png",
        "nudge-logo-512x512.png",
        "manifest.webmanifest",
      ],

      manifest: {
        name: "Nudge",
        short_name: "Nudge",
        description: "Personalised habit nudges",
        theme_color: "#0f172a",
        background_color: "#6c63ff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/nudge-logo-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/nudge-logo-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },

      devOptions: {
        enabled: true,
      },
    }),
  ],
});
