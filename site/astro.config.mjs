// The landing page (docs/adr/0021 for the licence it states; PLAN for the
// app it describes). Static: every page is HTML at build time, and the only
// script is the platform guess in the download section.
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://synesis.vercel.app",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "fr"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss()],
    // The logo and the screenshots' sources live outside site/ (branding/).
    server: { fs: { allow: [".."] } },
  },
});
