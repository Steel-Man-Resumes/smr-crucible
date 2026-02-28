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
};

export default nextConfig;
