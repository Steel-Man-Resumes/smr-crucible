/**
 * Render a server page the way Next's App Router does (React Server
 * Components), outside Next: React's react-server build (run with
 * --conditions=react-server), Next's compiled react-server-dom-webpack
 * server, and "use client" modules turned into client references, as Next's
 * bundler would. Catches what a dynamic route hides from `next build`: a
 * server component handing a function (onClick and friends) to an element or
 * a client component throws here exactly as on the first real request.
 *
 * Usage: node --conditions=react-server --import tsx test/rsc/render-server-page.cts <page file> [export]
 * Prints "RSC_OK" (or "RSC_NOT_FOUND" when the page called notFound()) and
 * exits 0, or prints the error and exits 1.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("module");
const path = require("path");
const { PassThrough } = require("stream");

const server = require(path.join(path.dirname(require.resolve("next/package.json")), "dist/compiled/react-server-dom-webpack/server.node.js"));
const React = require("react");
(globalThis as any).React = React;

// "use client" modules become client references (what Next's bundler does).
const origCompile = Module.prototype._compile;
const fs = require("fs");
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
Module.prototype._compile = function (content: string, filename: string) {
  // Read the directive from the source file: the compiled text wraps it.
  let source = "";
  try { source = /node_modules/.test(filename) ? "" : fs.readFileSync(filename, "utf8"); } catch { source = ""; }
  if (USE_CLIENT.test(source)) {
    this.exports = server.createClientModuleProxy("file://" + filename);
    return;
  }
  return origCompile.call(this, content, filename);
};

// The server-only entry Next aliases next/navigation to inside server components.
const NAV_RSC = path.join(path.dirname(require.resolve("next/package.json")), "dist/client/components/navigation.react-server.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "next/navigation") return NAV_RSC;
  return origResolve.call(this, request, ...rest);
};

const manifest = new Proxy({}, { get: (_t, key) => ({ id: String(key), chunks: [], name: "*" }) });

async function main() {
  const [file, exportName = "default"] = process.argv.slice(2);
  const mod = require(path.resolve(file));
  const Page = mod[exportName];
  const errors: string[] = [];
  let notFound = false;
  const props = { children: React.createElement("main", null, "page") };
  const element = React.createElement(async function Root() { return await Page(props); });
  await new Promise<void>((resolve) => {
    const { pipe } = server.renderToPipeableStream(element, manifest, {
      onError(err: unknown) {
        const digest = (err as { digest?: unknown } | null)?.digest;
        if (typeof digest === "string" && digest.includes(";404")) { notFound = true; return; }
        errors.push(err instanceof Error ? err.message : String(err));
      },
    });
    const sink = new PassThrough();
    sink.on("data", () => {});
    sink.on("end", () => resolve());
    pipe(sink);
  });
  if (errors.length) {
    console.log("RSC_ERROR " + errors.join(" | "));
    process.exit(1);
  }
  console.log(notFound ? "RSC_NOT_FOUND" : "RSC_OK");
}
main().catch((e) => { console.log("RSC_ERROR " + (e?.message ?? e)); process.exit(1); });
