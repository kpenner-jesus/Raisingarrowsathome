import type { MetadataRoute } from "next";

const SITE = "https://raisingarrowsathome.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`,             lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${SITE}/apply/family`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/auth/login`,   lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: `${SITE}/privacy`,      lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${SITE}/terms`,        lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
