import type { MetadataRoute } from "next";

const SITE = "https://raisingarrowsathome.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        // Keep authenticated + admin surfaces out of search results.
        disallow: ["/admin/", "/portal/", "/auth/", "/api/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
