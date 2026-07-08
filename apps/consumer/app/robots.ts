import type { MetadataRoute } from "next";

// One app serves both forge. and refinery. subdomains. Only the public front
// door (/intro + the Forge flow entry) and the shareable /walkthrough should
// be crawlable; everything personal or partner-specific stays out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard/",
          "/login",
          "/check-email",
          "/forgot-password",
          "/reset-password",
          "/access",
          "/mini-forge",
          "/demo",
          "/processing",
          "/output",
        ],
      },
    ],
    sitemap: "https://forge.steelmanresumes.com/sitemap.xml",
  };
}
