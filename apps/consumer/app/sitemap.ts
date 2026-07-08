import type { MetadataRoute } from "next";

// Public, indexable surfaces of the app. The marketing story lives on
// www.steelmanresumes.com; the app only exposes its front door and the
// shareable walkthrough is deliberately noindex (partner-share link).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://forge.steelmanresumes.com/intro",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
  ];
}
