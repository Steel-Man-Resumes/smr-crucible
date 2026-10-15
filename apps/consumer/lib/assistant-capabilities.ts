import type { ToolSet } from "ai";
import { FORGE_PAGES, REFINERY_PAGES } from "./tools/assistant-tool-defs";
import manifest from "./skills/manifest.json";
import { selectSkills } from "./skills-loader";

/** Derived from the actual registered tools, route allowlist and shipped skill manifest. */
export function assistantCapabilities(tools: ToolSet, opts: { role: string; page: string; signedIn: boolean; hasCriminalRecord?: boolean }) {
  return {
    version: "2026-10-15.v1",
    role: opts.role,
    tools: Object.keys(tools),
    pages: opts.role === "participant" ? (opts.signedIn ? REFINERY_PAGES : FORGE_PAGES) : opts.role === "owner" ? { "Owner controls": "/dashboard/admin", "Directory coverage": "/dashboard/admin/directory-coverage" } : {},
    skills: selectSkills(manifest.skills, opts.page, !!opts.hasCriminalRecord, opts.role).map((s) => ({ id: s.id, version: s.version ?? 1 })),
    access: "Registered here; each execution still enforces authentication, scope, consent and operation policy.",
  };
}
