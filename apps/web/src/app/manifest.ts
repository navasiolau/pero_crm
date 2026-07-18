import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PERO CRM",
    short_name: "PERO",
    description: "CRM для производства корпусной мебели на заказ",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#171717",
    theme_color: "#171717",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
