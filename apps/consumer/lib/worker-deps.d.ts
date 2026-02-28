// Type declarations for worker-only dependencies.
// These packages are installed in services/worker, not in the consumer app.
// The consumer's /api/parse route uses them server-side via dynamic import,
// and they're marked as webpack externals in next.config.mjs.
declare module "pdf-parse";
declare module "mammoth";
declare module "tesseract.js";
