/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@crucible/core", "@crucible/consumer-ui"],
  webpack: (config) => {
    // Worker-only deps in @crucible/core — not used by consumer app
    config.externals = [
      ...(config.externals || []),
      "pdf-parse",
      "mammoth",
      "tesseract.js",
    ];
    return config;
  },
};

export default nextConfig;
