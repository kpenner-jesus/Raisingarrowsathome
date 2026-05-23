import type { MetadataRoute } from "next";

// Dynamic PWA manifest. Icons reference the ImageResponse-generated
// /icon (192) + /icon2 (512) routes so install prompts on Android +
// add-to-home-screen on iOS get proper brand assets without a static
// PNG asset checked into the repo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Raising Arrows",
    short_name: "Raising Arrows",
    description:
      "Homeschool grant portal — apply for funding, upload receipts, " +
      "track reimbursements.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdf3e3",
    theme_color: "#e8793a",
    orientation: "portrait",
    icons: [
      { src: "/icon",  sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Portal", short_name: "Portal", url: "/portal", description: "Family portal" },
      { name: "Admin",  short_name: "Admin",  url: "/admin",  description: "Admin dashboard" },
      { name: "Apply",  short_name: "Apply",  url: "/apply/family", description: "Apply for a grant" },
    ],
  };
}
