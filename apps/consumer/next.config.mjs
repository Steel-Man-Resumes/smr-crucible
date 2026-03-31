/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@crucible/core", "@crucible/consumer-ui"],
  webpack: (config) => {
    // Worker-only deps in @crucible/core — not used by consumer app
    // tesseract.js not installed — handled gracefully at runtime
    config.externals = [
      ...(config.externals || []),
      "tesseract.js",
    ];
    return config;
  },
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "forge.steelmanresumes.com" }],
        destination: "/intro",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "host", value: "refinery.steelmanresumes.com" }],
        destination: "/login",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // Prevent browser caching of dashboard pages (back-button after signout)
        source: "/dashboard/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.anthropic.com; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
